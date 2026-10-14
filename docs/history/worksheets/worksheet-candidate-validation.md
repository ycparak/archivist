# Candidate validation worksheet

Task: Extract maintenance services and candidate validation, phase 1 of [Trigger.dev workflows](../../specs/trigger-workflows.md).

## Baseline and investigation

Clean working tree at 83b666b. Baseline check/lint/tests running. Reviewed sync/export/publisher, snapshot schema/builder/loader, search engine, evaluation fixture/CLI, Trigger config and installed SDK. No UI or ranking changes intended.

## Implementation plan

Extract shared validated release loading and full-ranking evaluation into server maintenance modules with injected file/embedding dependencies. Add strict versioned candidate/report contracts, checksum and cross-file validation (recomputed canonical descriptor hash, unique asset names and nonempty document channel memberships), fixture and baseline rank comparisons, asset/compressed-byte metrics and Node-only performance labeling. Reports pin code/fixture/candidate/baseline identity. Promotion revalidates the candidate and recomputes outcomes using persisted query vectors; no editable pass flag alone permits publication.

Extract filesystem cache/read-write adapters for existing publisher/export CLI reuse. Add `prepare:search`, `validate:search`, `promote:search` commands with explicit candidate directories; preparation never changes the active manifest. Retain existing sync/export command semantics. Baseline is pinned from the current local manifest when present; promotion refuses a changed active baseline. All local manifest writers share an exclusive output-root lock; promotion verifies the baseline inside that lock. Code identity hashes relevant working-tree source/config/lockfile contents, including dirty files, rather than trusting HEAD alone. Candidate provenance records complete public discovery; synthetic/existing-only artifacts cannot be promoted.

Add a schema-validated non-mutating Trigger validation smoke task with a generated synthetic release, without embedding/provider calls. Validate Trigger Node24 imports through dev build/synthetic run. Follow with a real-public current-release fixture evaluation using bounded Workers AI calls; do not promote when widget-grid fails.

Plan reviewed independently by Search, Systems and QA; incorporated shared writer lock, dirty-source fingerprint, completeness provenance and filesystem acceptance coverage.

Focused tests cover candidate corruption, lexical mismatch, bootstrap mismatch, unnormalized vectors, full ranks, pending/no-result cases, baseline regressions and report identity/outcome tampering. Filesystem acceptance tests cover unchanged/readable active release after incomplete discovery, embedding/validation/publication failure, report mutation, changed baseline and concurrent writer exclusion. Existing unit suites and check/lint/build remain required. Hosted persistence, enrichment and deployment are later independently committed tasks.

## Results

Removed `scripts/browser-search.ts` and `matchesEvaluationCase`, which the shared full-ranking evaluator replaced. `bun run check`, `bun run lint`, `bun run test` (657 passed, 2 skipped) and `bun run build` pass.

Trigger: `trigger.dev dev` 4.7.3 built the local worker on Node 24 with `$lib` imports resolved. Development run `run_06gjktd125917cgfgsochjc501` of `validate-search-smoke` completed and passed with no provider calls.

Real public candidate, 2026-10-14:

- `bun run prepare:search .maintenance/candidate-2026-10-14` completed read-only discovery using existing caches (no vision, no Are.na write-back) and produced candidate `d8ce5da6…` with 2,213 blocks and 8,561 vectors. The active release `4241d946…` (2,211 blocks) was unchanged.
- `bun run validate:search .maintenance/candidate-2026-10-14` passed 14 of 15 cases with no baseline regressions. `vision-widget-grid` failed: `block:17698965` ranked 116 in both the candidate and the baseline. Raw assets were 18.7 MB (13.3 MB gzip). Node search time was 122 ms and heap 170 MB. Mobile performance is unverified.
- `bun run promote:search .maintenance/candidate-2026-10-14` was refused ("Candidate evaluation does not pass"). The active manifest was unchanged and the publication lock was released.

The widget-grid miss is a phase 5 investigation; the fixture was not weakened. Production promotion needs a passing real-public candidate.
