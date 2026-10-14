# TODOs

Task backlog and work-in-progress tracking. See [agent loop](./workflows/agent-loop.md).

**Status marks:** `[ ]` not started · `[~]` code complete, waiting on a maintainer run · `[x]` finished.

## In Progress

_(none)_

## Up Next

_(none)_

## Needs Input

- [ ] **Decide on lexical prefix matching.** It moves widget-grid onto the first page (rank 24, the last slot) but costs 2 of 200 held-out top-1 results; adopting it is a ranking-policy choice ([worksheet](./history/worksheets/worksheet-search-experiments.md)).

## Backlog

_(none)_

## Done

- [x] **Exclude uninformative titles from search text.** An experiment improved widget-grid from rank 90 to 63 with unchanged held-out results; adopted in `toSearchDocument` ([worksheet](./history/worksheets/worksheet-search-experiments.md)).
- [x] **Isolated search experiment batches.** Implemented phase 6 of the [Trigger.dev plan](./specs/trigger-workflows.md) ([worksheet](./history/worksheets/worksheet-search-experiments.md)).
- [x] **Targeted vision backfills and coverage reports.** Implemented phase 5 of the [Trigger.dev plan](./specs/trigger-workflows.md) ([worksheet](./history/worksheets/worksheet-vision-backfills.md)).
- [x] **Block retries and hosted media processing.** Implemented phase 4 of the [Trigger.dev plan](./specs/trigger-workflows.md): per-block outcomes, `hosted retry`, batched children and bounded animation downloads ([worksheet](./history/worksheets/worksheet-block-retries.md)).
- [x] **Daily scheduled sync and automatic deployment.** Implemented phase 3 of the [Trigger.dev plan](./specs/trigger-workflows.md); the first production run deployed the site automatically ([worksheet](./history/worksheets/worksheet-daily-sync.md)).
- [x] **Durable hosted storage and manual sync.** Implemented phase 2 of the [Trigger.dev plan](./specs/trigger-workflows.md) and demonstrated a resumable hosted development run ([worksheet](./history/worksheets/worksheet-hosted-sync.md)).
- [x] **Extract maintenance services and candidate validation.** Implemented phase 1 of the [Trigger.dev plan](./specs/trigger-workflows.md) with guarded local promotion and a synthetic Trigger smoke task ([worksheet](./history/worksheets/worksheet-candidate-validation.md)).
- [x] **Align documentation and plan Trigger.dev workflows.** Consolidated current behavior, removed obsolete documents and recorded the [implementation plan](./specs/trigger-workflows.md).
