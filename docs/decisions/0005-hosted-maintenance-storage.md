# 0005: Hosted maintenance storage on private R2

Status: accepted and implemented on 2026-10-14; the `archivist-maintenance` bucket is provisioned and a hosted development run succeeded.

## Decision

Hosted maintenance persists to one private Cloudflare R2 bucket through the S3 API, using the official `@aws-sdk/client-s3`. The SDK replaces hand-written SigV4 signing, pagination and error mapping. It runs only in Node maintenance code (Trigger tasks and `scripts/`), never in the Worker. Public delivery stays on Worker Static Assets; the bucket is never public.

R2 evaluates `If-Match` and `If-None-Match: *` on `PutObject` atomically against committed state, and that is the coordination primitive. `src/lib/server/maintenance/store.ts` defines the small `ObjectStore` contract (get, conditional put, list) with an in-memory fake for tests. `r2.ts` is the only adapter.

## Layout

- `locks/archive.json`: the archive-wide lease, recording holder, monotonic token and expiry. Acquisition and renewal are conditional writes. Release expires the lease rather than deleting it, so tokens never repeat.
- `caches/current.json`: one fenced pointer to the canonical colour, connections and vision snapshots, stored as content-addressed `caches/<stage>/<sha256>.jsonl` files in the committed JSONL format.
- `jobs/<job>/`: the payload hash, pinned complete discovery, immutable per-record results keyed by stage and full cache key, a merge marker, candidate origin, validation reports and the final report.
- `embeddings/<version>/<sha256>.json`: content-addressed embedding deltas. Embeddings are a pure function of version and text, so these need no coordinator.
- `releases/<version>/`: immutable candidate and deployed release assets.
- `production/current.json`: a fenced pointer to the deployed release and the lease fence of the job that produced it.

## Safety rules

- Every canonical pointer records the writer's lease token. A write is refused if the pointer was written under a newer token or changed since it was read, or if the local lease deadline has passed.
- Renewal failure aborts the holder's signal, so the job fails closed.
- A retried attempt of the same job may take over its own unexpired lease. The new token fences off the dead attempt.
- A job merges its records into whichever snapshot is current, not the one it started from, so a newer merge is never rolled back.
- Only complete discovery is persisted, and it alone permits pruning. Stages a job did not run keep their snapshot.
- Deployment requires a completed, passing job report and a matching recomputed evaluation. The checkout must match the recorded source revision and fingerprint, and the candidate must not be older than the deployed release (by lease fence). The deploy also holds the lease.

## Consequences

Committed JSONL files become a portable seed and a reviewed export. `bun run hosted bootstrap` imports them once. `bun run hosted pull` imports hosted entries locally without replacing newer local work, and writes `.maintenance/cache-changes.json` for review.

Source identity for manually triggered candidates is computed from the clean local checkout that triggers the job. Scheduled jobs use the identity CI bakes into the Trigger bundle at deploy time, and refuse to run without it; they cross-check it against the deployment's commit. The deploy command enforces the same identity either way, so promotion is bound to reviewed source. A manual job can still run on a Trigger worker deployed from different code, so trigger manual production jobs only from the revision CI last deployed.

Provider charges are not exactly-once: a process can die after a provider call succeeds but before its record is persisted. Records are written as each entry settles, which bounds that loss to in-flight entries.

Credentials are separate:

- Provider: `ARENA_ACCESS_TOKEN`, plus Workers AI through `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN`.
- Storage: `MAINTENANCE_R2_*`, an R2 token scoped to the one bucket.
- Deployment: `CLOUDFLARE_DEPLOY_API_TOKEN` or `wrangler login`, never the Workers AI token.

On 2026-10-14 the maintainer enabled capped vision and Are.na write-back in the daily job. Write-back uses the existing `ARENA_ACCESS_TOKEN`, which therefore needs write scope in the Trigger production environment. Written blocks are recorded under `jobs/<job>/writeback/`, and vision spend under `jobs/<job>/spend.json`.
