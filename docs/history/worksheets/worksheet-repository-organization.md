# Repository documentation and fixture reorganization

## Scope

- TODO: repository-root simplification requested by the maintainer.
- Move `TODOS.md` and `CHANGELOG.md` under `docs/`.
- Archive completed worksheets under `docs/history/worksheets/`; place ADRs under
  `docs/decisions/`; reserve `docs/specs/` for future active worksheets/specs.
- Move the shared search-evaluation fixture from `tests/fixtures/` to `scripts/fixtures/`, because
  `scripts/evaluate-search.ts` owns its runtime use. Keep colocated unit tests in `src/`.

## Reviewed

- `AGENTS.md`, `docs/TODOS.md`, `docs/CHANGELOG.md`, `docs/workflows/agent-loop.md`,
  `docs/workflows/agent-review.md`
- All repository references to the moved paths and the search-evaluation fixture.

## Plan

1. Relocate records and fixtures with history-preserving renames.
2. Update repository instructions, documentation links, scripts, tests, and historical records.
3. Validate type checking, formatting/linting, tests, and production build.

## Result

- Kept `postcss.config.cjs` and its dependency unchanged, per maintainer preference.
- Moved root workflow records under `docs/`; archived all completed worksheets in
  `docs/history/worksheets/`; moved ADRs to `docs/decisions/`; and documented `docs/specs/` as the
  home for future active work.
- Moved the search fixture to `scripts/fixtures/` and its validation test to
  `src/lib/server/search/evaluation-fixture.spec.ts` so the root `tests/` directory is gone without
  mixing a CLI fixture into application source.
- Updated every active path reference and confirmed `bun run check`, `bun run lint`, `bun run test`
  (199 tests), and `bun run build` pass.
