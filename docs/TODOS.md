# TODOs

Task backlog and work-in-progress tracking. See [agent loop](./workflows/agent-loop.md).

**Status marks:** `[ ]` not started · `[~]` code complete, waiting on a maintainer run · `[x]` finished.

## In Progress

_(none)_

## Up Next

- [ ] **Block retries and hosted media processing.** Implement phase 3 of the [Trigger.dev plan](./specs/trigger-workflows.md#phase-3-block-retries-and-hosted-media-processing).

## Needs Input

- [~] **Durable hosted storage and manual sync.** Phase 2 code is complete; provision the R2 bucket and credentials, then run the hosted development smoke test in the [worksheet](./specs/worksheet-hosted-sync.md).

## Backlog

_(none)_

## Done

- [x] **Extract maintenance services and candidate validation.** Implemented phase 1 of the [Trigger.dev plan](./specs/trigger-workflows.md) with guarded local promotion and a synthetic Trigger smoke task ([worksheet](./history/worksheets/worksheet-candidate-validation.md)).
- [x] **Align documentation and plan Trigger.dev workflows.** Consolidated current behavior, removed obsolete documents and recorded the [implementation plan](./specs/trigger-workflows.md).
