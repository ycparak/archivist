# Daily sync and automatic deployment worksheet

Task: phase 3 of [Trigger.dev workflows](../../specs/trigger-workflows.md#phase-3-daily-scheduled-sync-and-automatic-deployment). Branch `trigger`. Decisions (maintainer, 2026-10-14): daily at 06:00 UTC; deploy when there is no regression against the live release; stay within free plans.

## Implementation

- **Gate.** `evaluateRelease` and the candidate origin carry a `strict` or `no-regression` gate. Under `no-regression`, a known failure needs an explicit tolerance (10). Reports mark known failures. The local `promote:search` command stays strict.
- **Job decisions.** `adoptLiveRelease` verifies and adopts the public site's release as the first production baseline. Job reports carry `decision` and `sourceRevision`. Production pointers carry `previousVersion`. Deployment staging returns `already-live` for a redeploy of the live job.
- **Retention and handoff.**
  - `retention.ts` prunes releases (keeping live, previous and the 7 newest candidates) and jobs older than 30 days.
  - `github.ts` dispatches `deploy-site.yml`.
  - `ObjectStore.delete` was added.
- **Trigger tasks.**
  - `src/trigger/hosted.ts` shares dependency wiring, the live site URL and error classification.
  - `daily.ts` adds the production-only schedule, the source identity check against the deployment commit, dispatch on `deploy`, and failure on `rejected`.
  - The `ffmpeg()` build extension is in `trigger.config.ts`.
- **CLI and workflows.** The CLI gained `identity` and `sync --no-regression`. CI's `deploy-trigger` job runs on pushes to `main`, and `deploy-site.yml` is dispatched by the daily job.
- **Colour download audit.** No change was needed. `measureImageColours` already rejects an oversized `content-length`, streams with a cap and cancellation, bounds fetch and body reading with a timeout, and ffmpeg enforces timeout, output cap and kill on cancellation.
- **R2 diagnostics.** R2 errors now keep safe network codes. Resumed attempts report the stage results recorded at merge.

## Evidence

- Tests cover:
  - known failures within tolerance, slipping or disappearing;
  - strict rejection, and passing cases staying on the first page;
  - tolerance required for `no-regression`;
  - live adoption via a fake site;
  - `unchanged`, `deploy` and `rejected` decisions;
  - already-live redeploys;
  - retention keep and expiry sets;
  - dispatch URL and body, with the token absent from errors;
  - stage results surviving a post-merge failure.
- The Trigger dev worker `20261014.10` built with the ffmpeg extension and registered `daily-archive-sync`.
- Development run `run_06gjlc2k3lpaqvnrqfikornc01` (job `sync-20261014135316-4r4atd`, colour and connections, `no-regression`):
  - It adopted the live release `4241d946…` as the production pointer with fence 0.
  - It measured 3 new images with ffmpeg and built candidate `75b321b4…` with 2,213 blocks.
  - It passed with 1 known failure (widget-grid at rank 116, unchanged), with decision `deploy`.
  - Attempt 1 failed writing `origin.json` to R2 with an undiagnosed network error. Attempt 2 resumed after the merge and completed in 35 s. Diagnostics were added afterwards.
- `bun run hosted deploy sync-20261014135316-4r4atd --dry-run` at `cf3e161` passed every check and built the site with exactly the live baseline and the candidate. It did not deploy.

## Production activation, 2026-10-14

- The maintainer configured the Trigger production variables, the GitHub secrets and the failure alert, then merged #6. CI run `38579353256` passed `quality` and `deploy-trigger`, and Trigger production worker `20261014.1` registered `daily-archive-sync`.
- Test run `run_06gjlju1nl7l82hv9ote53age1` (job `daily-20261014`, $0.0076, 1.5 min) synced 2,213 blocks:
  - colour: 2,210 cache hits; connections: 2,213 cache hits;
  - candidate `75b321b4…` passed the no-regression gate (decision `deploy`).
  - The run then failed to dispatch because `GITHUB_DEPLOY_TOKEN` was missing in Production. [#7](https://github.com/ycparak/archivist/pull/7) makes such errors name the setting.
- After the token was added, a rerun reused the completed job and dispatched the site deploy. `Deploy site` run `38581958586` succeeded in 1m21s, which verified wrangler token handling in GitHub Actions.
- Afterwards:
  - the live `/search/manifest.json` serves `75b321b4…`, and the previous release `4241d946…` is still served for open sessions;
  - the R2 production pointer records job `daily-20261014`, previous `4241d946`, source `e5ad94d`.
- The scheduled 06:00 UTC runs continue without local action.
