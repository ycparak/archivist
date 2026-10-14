# Coverage reports and vision backfills worksheet

Task: phase 5 of [Trigger.dev workflows](../../specs/trigger-workflows.md#phase-5-targeted-vision-backfills-and-coverage-reports). Branch `phase-5-vision-backfills`.

## Implementation

- **`coverage.ts`.** Vision, colour and connection states per block, with the cache-key reason for staleness. The report counts recorded job failures, with a "not recorded" state for older jobs, and gives coverage by channel and block type with bounded lists, plus a Markdown formatter. It makes no model or Are.na calls.
- **Cost reporting.** The vision client reports each possibly billed request's cost through `onCost`: OpenRouter's always-included `usage.cost` (credits, priced 1:1 with USD), or null on timeouts or network failures.
- **`backfill.ts`:**
  - selection (IDs, channels, missing and/or stale) planned with the production model and prompt version, in stable order;
  - public-pricing estimates with stated token assumptions;
  - a spend limiter that reserves each block's worst case (or the costliest block seen so far, if larger) and books actual cost, charging unknown cost at the ceiling;
  - a persisted ledger, where a resumed attempt counts prior in-flight exposure as spent;
  - `runVisionBackfill`, which persists each entry, resumes, takes the lease only for a no-prune merge (waiting out a held lease), and refuses to run without pricing.
- **Hard caps:** 1,000 blocks and $20 per run, enforced by the payload schema.
- **Trigger and CLI.** The Trigger task is `archive-vision-backfill`: manual only, `small-2x`, queue concurrency 1, needs `OPENROUTER_API_KEY`. The CLI adds `coverage` and `backfill --plan|--run`; a run requires an explicit block cap and budget.

## Evidence

- Tests cover:
  - every vision state, list bounding, connection freshness and unrecorded outcomes;
  - selection by channel and IDs, the cap, and stable order;
  - estimates with and without pricing, and the payload ceilings;
  - limiter reservation, unknown-cost charging, adaptive reservation and crash exposure;
  - a backfill stopping at its budget ($0.30 blocks, $1 budget: 3 generated, 1 stopped, $0.90 spent);
  - a no-prune merge, resuming after cancellation without re-describing, waiting out a held lease, and refusing without pricing.
- `bun run check`, `bun run lint`, `bun run test` (704 passed, 2 skipped) and `bun run build` pass. Trigger dev worker `20261014.16` registered `archive-vision-backfill`.
- `bun run hosted coverage` against production R2 (job `daily-20261014`, 2,213 blocks):
  - vision: 2,207 of 2,210 describable blocks valid; 3 missing (`50429510`, `20429537`, `17343625`); 132 animations; 3 blocks without images;
  - colour: 2,210 valid; connections: all fresh;
  - outcomes: not recorded, because the job predates phase 4.
- `bun run hosted backfill --plan --missing`: 3 blocks (2 images, 1 animation), expected $0.0031, worst case $0.034. Nothing was spent.

## Not yet run

No paid backfill has run. The first one needs the maintainer's approval and `OPENROUTER_API_KEY` in the Trigger environment that executes it.
