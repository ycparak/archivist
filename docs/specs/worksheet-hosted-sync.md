# Hosted storage and manual sync worksheet

Task: phase 2 of [Trigger.dev workflows](./trigger-workflows.md#phase-2-durable-hosted-storage-and-manual-sync). Branch `trigger`.

## Implementation

- Recorded [ADR 0005](../decisions/0005-hosted-maintenance-storage.md): a private R2 bucket via the S3 SDK, with atomic conditional writes as the lease and fencing primitive.
- Split `syncArchive` into `discoverArchive` and `enrichArchive`, with explicit `complete` status and a shared `buildDocuments`. CLI behaviour is unchanged; the indexing suite passes.
- `src/lib/server/maintenance/`:
  - `store.ts`: the store contract and in-memory fake.
  - `r2.ts`: the adapter, with sanitized errors.
  - `lease.ts`: lease, renewal, fencing and same-job takeover.
  - `caches.ts`: snapshots, per-job records, fenced merge, embedding deltas and local import.
  - `hosted-release.ts`: release storage, the production pointer, and deployment staging and recording.
  - `hosted-sync.ts`: the orchestrator.
- The candidate origin now records hosted `job` provenance (ID and lease fence), so supersession is part of report identity.
- `src/trigger/sync.ts` (`archive-sync`) maps progress into run metadata and classifies non-retryable errors.
- `scripts/hosted-maintenance.ts` (`bun run hosted`) provides `bootstrap`, `pull`, `sync` and `deploy`.

## Verification

- Focused tests (`hosted.spec.ts`) use the in-memory store and fake providers. They cover:
  - lease exclusion, expiry takeover and stale-writer fencing;
  - renewal loss aborting the holder;
  - merging against a changed pointer;
  - export/parse round-trip and local import never replacing newer entries;
  - completion with pruning;
  - restart reusing pinned discovery and records without repeating work;
  - incomplete discovery persisting nothing and pruning nothing;
  - cancelled jobs being unreportable and undeployable;
  - lease contention and reused job IDs;
  - deployment recording, superseded candidates and source mismatch.
- Mutation checks confirmed the incomplete-discovery and supersession tests fail when their guards are removed.
- The Trigger dev worker `20261014.8` built on Node 24 and registered `archive-sync`.
- The full validation results are recorded in the commit.

## Remaining maintainer steps

1. Run `wrangler login` (expired on this machine), then create the bucket: `bunx wrangler r2 bucket create archivist-maintenance`.
2. In the Cloudflare dashboard, create an R2 API token with Object Read & Write scoped to that bucket. Put `MAINTENANCE_R2_BUCKET`, `MAINTENANCE_R2_ACCESS_KEY_ID` and `MAINTENANCE_R2_SECRET_ACCESS_KEY` in `.env`.
3. Run `bun run hosted bootstrap`.
4. With `bunx trigger.dev@4.7.3 dev` running, run `bun run hosted sync --no-colour` from a clean checkout and record the run, job ID, provider calls and report here.
5. Run `bun run hosted deploy <job> --dry-run`. A production deploy also needs a passing fixture; `vision-widget-grid` currently fails.
6. Set the same variables in the Trigger production environment before any production run.
