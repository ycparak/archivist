# Daily sync and automatic deployment worksheet

Task: phase 3 of [Trigger.dev workflows](./trigger-workflows.md#phase-3-daily-scheduled-sync-and-automatic-deployment). Branch `trigger`. Decisions (maintainer, 2026-10-14): daily at 06:00 UTC; deploy when there is no regression against the live release; stay within free plans.

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

## Production activation (maintainer)

1. **Trigger production environment variables:** `ARENA_ACCESS_TOKEN`, `ARENA_IGNORE_CHANNELS`, `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN` (Workers AI), the three `MAINTENANCE_R2_*` values, and `GITHUB_DEPLOY_TOKEN`. That last one is a fine-grained token for `ycparak/archivist` with Actions: read and write.
2. **GitHub repository secrets:**
   - `TRIGGER_ACCESS_TOKEN` (a deploy-only Trigger access token);
   - `CLOUDFLARE_ACCOUNT_ID`;
   - `CLOUDFLARE_DEPLOY_API_TOKEN` (Workers Scripts: Edit, for this account);
   - the three `MAINTENANCE_R2_*` values.
3. **Alert:** in Trigger, add an email alert for failed runs in production. The free plan allows one destination.
4. **Activate:** merge `trigger` into `main`. CI deploys the tasks with their source identity, and the schedule syncs on deploy.
5. **Record the first run:** record the first 06:00 UTC run here, with its run ID, decision, deploy workflow run, live manifest version and Trigger cost. Then move this worksheet to history.
