# Fix missing CI search assets

Task: [TODOs](../../TODOS.md), Fix missing CI search assets.

## Investigation and plan

The supplied Actions log fails while prerendering `/`: `loadSearchBootstrap` cannot fetch
`/search/manifest.json`. The workflow builds a fresh checkout, but `static/search` is ignored.
Reviewed the workflow, ignore rules, bootstrap loader, export CLI, release builder, file
publisher, export tests, README and architecture. The linked Actions page was unavailable;
the supplied log and local workflow identify the missing prerequisite.

Generate a single synthetic text block with deterministic normalized vectors using the
existing release builder and publisher before CI builds. Keep production build/export
behavior intact, require no secrets or network, and refuse to replace existing assets.
Document CI's fixture separately from production exports.

Validation: run all four required checks, then reproduce the clean-checkout build using
fixture assets while preserving the local real export. The actual CI build is the
regression check for workflow sequencing; existing export tests cover asset integrity.

## Results

Added `scripts/prepare-ci-search.ts` and ran it immediately before the CI build.
Documented the CI-only fixture in README. QA reviewed the plan and implementation
with fresh context and found no actionable issues.

- `bun run check`: passed, zero errors/warnings.
- `bun run lint`: passed.
- `bun run test`: 42 files passed, 641 tests passed, 2 existing skips.
- Fixture preparation followed by `bun run build`: passed, including prerendering
  and Cloudflare adaptation. The sandbox initially blocked localhost binding; the
  same build passed with escalation and a temporary Wrangler log path.
- Running preparation with an existing export failed as intended.

The local real export was preserved and restored around fixture validation. No
export/sync command or external inference was run. CI has not been rerun remotely.
