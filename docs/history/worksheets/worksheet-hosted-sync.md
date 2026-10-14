# Hosted storage and manual sync worksheet

Task: phase 2 of [Trigger.dev workflows](../../specs/trigger-workflows.md#phase-2-durable-hosted-storage-and-manual-sync). Branch `trigger`.

## Implementation

- Recorded [ADR 0005](../../decisions/0005-hosted-maintenance-storage.md): a private R2 bucket via the S3 SDK, with atomic conditional writes as the lease and fencing primitive.
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

## Hosted development run, 2026-10-14

- Bucket `archivist-maintenance` was created with OAuth wrangler outside the project. Inside the project, both Bun and wrangler load `.env`, whose `CLOUDFLARE_API_TOKEN` is the Workers AI token and cannot read the account (403). Account commands therefore run with that variable unset plus `--env-file=.env.example`; `hosted deploy` does this.
- `bun run hosted bootstrap` uploaded 2,207 colour, 2,211 connections and 2,207 vision entries plus the local embedding cache in 15 s.
- `bun run hosted pull` then reported zero changes in every stage and an empty git diff, so the hosted export round-trips exactly.
- Job `sync-20261014132324-wd7u44` (run `run_06gjl57s2egmh6h9i4cfnmmv01`, connections only, worker `20261014.8`) persisted discovery and 3 connection records, merged them, and was OOM-killed while building on the default 0.5 GB machine. The task now uses `medium-1x`; the reported heap was 484 MB.
- Resuming that job from the new commit failed without retry: "Job ID was reused with a different payload". The source identity is part of the payload, so a resumed job cannot claim different code.
- A fresh job, `sync-20261014132600-c1w3nz` (run `run_06gjl5qv134k2iphgq24meaa01`), completed in 108 s:
  - 52 channels and 2,213 blocks.
  - Connections: 2,213 cache hits and 0 counted, so the crashed job's settled work was reused.
  - Candidate `a50c79f5…` with 8,561 vectors and 18.7 MB raw (13.2 MB gzip).
  - Validation: 14 of 15 cases passed. `vision-widget-grid` ranked 116, identical to the local candidate. There was no baseline, because nothing has been deployed through this path yet.
- `bun run hosted deploy sync-20261014132600-c1w3nz --dry-run` refused with "Job candidate failed validation". Local assets and the tree were unchanged.
- No vision calls and no Are.na writes were made. Provider calls were read-only Are.na discovery and connection counts, plus Workers AI embeddings for changed chunks and fixture queries.

## Before production activation

1. Set `ARENA_ACCESS_TOKEN`, `ARENA_IGNORE_CHANNELS`, `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN` and the `MAINTENANCE_R2_*` variables in the Trigger production environment.
2. Deploy the Trigger worker from the same revision used to trigger jobs.
3. A production site deploy additionally needs a passing fixture (widget-grid, phase 5) and a deployment credential: `CLOUDFLARE_DEPLOY_API_TOKEN` or OAuth wrangler.
