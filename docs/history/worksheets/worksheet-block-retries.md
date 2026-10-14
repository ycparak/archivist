# Block retries and hosted media worksheet

Task: phase 4 of [Trigger.dev workflows](../../specs/trigger-workflows.md#phase-4-block-retries-and-hosted-media-processing). Branch `phase-4-block-retries`.

## Implementation

- **Bounded downloads.** `downloadCapped` (`src/lib/server/indexing/download.ts`) is shared by colour measurement and the animation transcoder. It:
  - refuses a declared or streamed body over the limit without buffering it;
  - applies the timeout and caller's signal to the whole body;
  - reports the HTTP status.

  The transcoder now checks the encoded file's size on disk before reading it, and ffmpeg reports `timed out after Nms`.

- **One-block outcomes.** `measureBlock`, `countBlock` and `describeBlock` return `done`, a terminal `skipped`, or a retryable outcome. The batch stages are rebuilt on them, with unchanged summaries and an optional `onOutcome` sink.
- **Retries.** Hosted jobs persist non-done outcomes (`jobs/<job>/outcomes.json`) and report `retryable`. `retryOf` jobs (`bun run hosted retry <job>`) reuse the original pinned discovery, enrich only its retryable blocks and merge without pruning, then build and validate a candidate.
- **Batched children.** Stages with more than 500 pending blocks fan out into `archive-enrich-batch` children: 50 blocks each, two at a time, on `small-1x`.
  - Children add only job records and per-batch outcomes. A retried colour batch skips blocks already recorded.
  - The parent merges under the lease and calls `lease.renew()` after waiting.
  - Daily runs (about 300 stale connection counts) stay in-process.
- **Shared schemas.** Job schemas moved to `job-schemas.ts` to avoid an import cycle.

## Evidence

- New tests cover:
  - capped downloads: declared over the limit, streamed past the limit, a stalled body timing out, 404;
  - real-ffmpeg timeout and cancellation;
  - retryable status classification (429 and 5xx retryable; 403 and 404 terminal);
  - one-block outcomes and the outcome sink;
  - persisted outcomes and the `retryable` count;
  - a retry touching only failed blocks, not rediscovering, not pruning, and refusing an empty retry;
  - fan-out of 502 blocks into 50-block batches with every record merged and one retryable failure;
  - a batch refusing blocks outside its job, and a retried colour batch skipping recorded blocks;
  - explicit lease renewal failing after a takeover.
- `bun run check`, `bun run lint`, `bun run test` (693 passed, 2 skipped) and `bun run build` pass.
- Development runs on worker `20261014.15` against job `sync-20261014135316-4r4atd`:
  - `run_06gjlr6umag0g7slca8486t301`: real colour batch, 3 entries.
  - `run_06gjlr7egll6dj5vcdmm2vag01`: real connections batch, 3 entries.
  - `run_06gjlr939dofgl8crvjahmsl01`: the same colour batch again, 0 entries, because it skipped the recorded blocks.

## Not exercised

The production fan-out path (a parent suspended in `batchTriggerAndWait`, then renewing its lease) only occurs with a backlog over 500 blocks. Its logic is covered by the in-process test above.
