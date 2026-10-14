# TODOs

Task backlog and work-in-progress tracking. See [agent loop](./workflows/agent-loop.md).

**Status marks:** `[ ]` not started · `[~]` code complete, waiting on a maintainer run · `[x]` finished.

## In Progress

_(none)_

## Up Next

- [ ] **Block retries and hosted media processing.** Implement phase 4 of the [Trigger.dev plan](./specs/trigger-workflows.md#phase-4-block-retries-and-hosted-media-processing).

## Needs Input

- [~] **Daily scheduled sync and automatic deployment.** Phase 3 code is complete; configure the production credentials and alert, merge to `main`, then record the first scheduled run in the [worksheet](./specs/worksheet-daily-sync.md).

## Backlog

_(none)_

## Done

- [x] **Durable hosted storage and manual sync.** Implemented phase 2 of the [Trigger.dev plan](./specs/trigger-workflows.md) and demonstrated a resumable hosted development run ([worksheet](./history/worksheets/worksheet-hosted-sync.md)).
- [x] **Extract maintenance services and candidate validation.** Implemented phase 1 of the [Trigger.dev plan](./specs/trigger-workflows.md) with guarded local promotion and a synthetic Trigger smoke task ([worksheet](./history/worksheets/worksheet-candidate-validation.md)).
- [x] **Align documentation and plan Trigger.dev workflows.** Consolidated current behavior, removed obsolete documents and recorded the [implementation plan](./specs/trigger-workflows.md).
