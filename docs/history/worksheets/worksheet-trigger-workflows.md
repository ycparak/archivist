# Documentation parity and Trigger.dev planning worksheet

Task: [TODOs](../../TODOS.md); scope: documentation cleanup and the [implementation plan](../../specs/trigger-workflows.md), not implementation or live task execution.

## Investigation

The working tree was clean. Reviewed the repository documentation, package/config/CI files, manual CLIs, sync orchestration, enrichment/cache code, search document composition, snapshot builder/loader, ranking engine, embedding endpoint, and Trigger.dev example/config. Compared design measurements and pretext behavior with the component/style sources.

Found obsolete provider rules in review guidance, completed proposals in active specs, contradictory opt-in/cutover instructions, obsolete TODO history, incomplete canonical search-text documentation, missing connection-cache documentation, and an inaccurate claim that vision output bounds are enforced by the schema.

## Plan

Consolidate current implementation facts in architecture and accepted decisions; remove completed worksheets/specs and obsolete migration decision; prune obsolete changelog entries; reset TODOs to this task and the first implementation slice. Keep actual known search/mobile limitations as validation requirements in the new plan, without presenting historical measurements as a current run. Preserve design, Svelte and worktree guidance after correcting drift.

Use R2 as a proposed private maintenance artifact store while retaining Worker Static Assets for public delivery. Specify candidate validation before promotion, durable cache ownership, retry boundaries, lock fencing, and explicit opt-in for paid vision. No sync, export, Are.na write-back or deployment is required for this documentation task.

## Validation and review

Completed independent Systems Architect and Data/Search reviews. Fixed both findings: qualified public vision-text exposure and documented animation download/cancellation limits with explicit remediation in phase 3. No unresolved findings.

`bun run check` passed with zero Svelte diagnostics; `bun run lint` passed; `bun run test` passed (42 files, 641 passed, 2 existing skipped). `bun run build` initially hit sandbox loopback EPERM, then passed with approved local port access and `WRANGLER_LOG_PATH` redirected to `/tmp`. No sync/export, paid model calls, write-back, provisioning or deployment ran. Relative documentation targets and formatting were checked.

Removed twelve completed worksheets, four superseded specs and the obsolete separate backend-removal ADR; consolidated current decisions and unreleased changelog entries. Git retains deleted history. The first implementation slice is the only new Up Next task; later phases and the unresolved relevance/mobile requirements live in the plan. Runtime source/configuration is unchanged.
