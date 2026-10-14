# Trigger.dev maintenance workflows

Status: phase 1 implemented locally; phase 2 implemented with a hosted development run (production Trigger environment not yet configured); phase 3 implemented and live in production since 2026-10-14 ([worksheet](../history/worksheets/worksheet-daily-sync.md)); phase 4 implemented ([worksheet](../history/worksheets/worksheet-block-retries.md)); phase 5 implemented ([worksheet](../history/worksheets/worksheet-vision-backfills.md)); phase 6 implemented ([worksheet](../history/worksheets/worksheet-search-experiments.md)); scope selected by the maintainer on 2026-10-14 and revised the same day to add a daily scheduled sync with automatic deployment.
The current runtime is described in [architecture](../architecture.md). Phase 1 provides local candidate commands and a synthetic Trigger validation task (evidence in the [phase 1 worksheet](../history/worksheets/worksheet-candidate-validation.md)); phase 2 code, its storage [ADR](../decisions/0005-hosted-maintenance-storage.md) and [worksheet](../history/worksheets/worksheet-hosted-sync.md) exist; remaining phases are proposed work.

## Outcome and scope

Move archive maintenance into observable hosted jobs. Every morning a scheduled job syncs the archive and the site updates with new content, with no local sync and no manual deployment. Preserve browser search, original Are.na results and public-only releases. Implement these selected ideas:

| Original idea | Deliverable                                                                     |
| ------------- | ------------------------------------------------------------------------------- |
| 1             | Hosted archive sync with explicit stage options and durable progress, run daily |
| —             | Automatic deployment of each regression-free daily release                      |
| 2             | Candidate search release validation before promotion                            |
| 3             | Retry failed enrichment blocks without repeating successful work                |
| 4             | Targeted, bounded vision backfills                                              |
| 5             | Hosted colour measurement and animation preparation with ffmpeg                 |
| 8             | Enrichment coverage and freshness reports                                       |
| 9             | Isolated search experiment batches and comparison reports                       |

Are.na write-back preview/approval UI, uptime monitoring, backups and a public admin interface are outside this plan. On 2026-10-14 the maintainer made the daily sync a full hosted equivalent of `bun run sync`. It generates vision for missing or stale blocks (at most 50 blocks and $0.50 a day) and writes generated titles and descriptions back to the maintainer's own Are.na blocks, under the existing owner-only rules, with no cap on writes. Release retention (phase 3) is the only automated pruning.

Cost constraint: everything runs within free allowances:

- the Trigger.dev Free plan ($5 monthly credit, runs blocked rather than billed when exhausted);
- R2 free tier (10 GB storage, 1M Class A and 10M Class B operations a month);
- GitHub Actions minutes for this private repository (2,000 a month);
- the Workers AI free allocation.

Prefer the smallest Trigger machine that works, schedule only blocks that need work, and batch child tasks rather than starting one per block.

## Code baseline and gaps

- `trigger.config.ts` discovers `src/trigger/`, uses Node 24 and currently limits runs to 3,600 seconds with three default attempts. SDK/build packages are pinned to 4.7.3. The original baseline had only `example.ts`; the setup worksheet recorded a successful development run, not an archive workflow deployment.
- `scripts/sync.ts` parses opt-out flags, loads/writes committed caches, renders terminal progress, calls `syncArchive`, publishes local assets and writes the channel manifest. CLI vision/write-back are enabled by default; the reusable `syncArchive` does not enable either unless requested.
- `syncArchive` discovers owned public/closed channels, deduplicates blocks, runs colour → connections → vision → optional write-back, then constructs documents. Export mode rejects vision/write-back and refuses incomplete/empty discovery. Normal sync checks completeness in the CLI before local publication, after cache persistence.
- Enrichment stages use an in-process pool and collect failures in summaries instead of throwing. Current default concurrency is 32 for vision and 4 each for colour/connections. Cache merges preserve old entries on failures and unseen entries on incomplete discovery.
- `scripts/publish-search.ts` embeds missing text chunks and writes local files. `buildSearchRelease` is already independently callable; publication and local embedding persistence need explicit adapters.
- `scripts/browser-search.ts` reads the fixed local manifest and returns only enough results for requested pagination. `evaluate-search.ts` prints fixture results and exits; it has no structured comparison output or publication gate. Full-corpus ranks require using the engine's complete ranking rather than the sliced repository result.
- The widget-grid case is an ordinary failing fixture if its expected block misses the first page; it is not currently marked pending. Rank 112 is from a previous run, not a new measurement. Physical mobile performance remains unverified.
- Public delivery uses Worker Static Assets. Deploying builds the prerendered gallery and assets together. Current GitHub Actions validate builds with synthetic data; there is no production deployment workflow or R2 storage integration.

## Proposed ownership and persistence

Keep `src/trigger/` thin: validated task entrypoints, queue/retry settings and progress metadata. Keep provider normalization and enrichment logic in their existing server modules. Introduce `src/lib/server/maintenance/` for shared maintenance orchestration, artifact contracts and reports. Manual CLIs call the same services, with filesystem adapters under `scripts/`; they retain their current flag semantics. Trigger tasks use Node-compatible adapters with explicit dependencies, without SvelteKit runtime env imports or Cloudflare bindings. Resolve `$lib` imports in the Trigger build and verify deployment bundling in phase 1.

Use a private Cloudflare R2 bucket as the proposed hosted store for normalized discovery snapshots, enrichment entries, embedding chunks, candidate assets and reports. Use the official S3 SDK only if it meaningfully replaces custom signing/storage code; record the persistence decision in an ADR during implementation. No storage resources exist in the current code. Keep public delivery through Worker Static Assets initially, avoiding a new public asset router.

Bootstrap hosted caches from the committed JSONL files once, without paid regeneration. Hosted operational caches then become the live maintenance source; committed files remain a portable seed and deterministic export, not a second mutable authority. Add an explicit download/merge command to update local caches and a cache-change artifact for review/commit. CLIs retain local operation and can explicitly import hosted snapshots; never silently overwrite a newer local entry. Record dataset/config/version identifiers in every export. Do not automatically create commits or PRs from Trigger tasks in the initial version.

Store successful work as immutable records keyed by stage and full cache key, rather than letting concurrent children rewrite one JSONL file. A single fenced coordinator creates the canonical merged snapshot. Include old entries for failed or skipped blocks; prune only after complete discovery of the full eligible archive. Subset backfills must not prune untargeted blocks. Separate operational caches from experiment caches. Persist embedding chunks by version/text hash so worker replacement cannot discard paid work.

Use small task payloads containing IDs, artifact references and configuration versions; do not embed the corpus, media data URLs or credentials. Zod validates payloads, artifact keys, loaded records and reports. Worker-local files are scratch space only. Keep raw provider errors, tokens and URLs containing credentials out of logs; store sanitized block IDs/reasons instead.

## Concurrency, retries and publication safety

- Acquire an archive-wide durable lease before production cache merges/promotion, with renewal, expiry and fencing tokens; fail closed on lease loss. Select an atomic conditional-write or coordination primitive in the persistence ADR and test takeover. A parent queue limit alone is insufficient: Trigger releases a waiting parent's concurrency slot while children execute.
- One block task processes one block with internal stage concurrency set to 1; apply bounded stage queues instead of nesting a 32-worker pool inside every child. Start hosted concurrency conservatively and tune from measured provider/CPU limits. Concurrency is not requests-per-minute limiting: retain Are.na pacing/backoff and coordinate account-wide request budgets across task types.
- Keep provider-level bounded retries for transient HTTP failures. Give block tasks an explicit outer retry budget that accounts for those inner attempts; do not multiply the current four provider retries by unexamined default task retries. Authentication/configuration errors fail the run; unsupported/oversize media are terminal skips; transient failures remain retryable.
- Adapt collected stage failures into typed outcomes; throw retryable failures at the task boundary so Trigger records failure/retries. Parent summaries distinguish completed, skipped, failed and cancelled, and offer a retry set for failed IDs only. Retrying a failed Trigger run and deliberately starting a new retry batch need distinct run keys so the latter does not reuse an exhausted failed run.
- Trigger idempotency keys reduce duplicate scheduling; persisted cache-key checks prevent repeat successful work after key expiry, retries or replacement workers. Provider charging cannot be exactly-once if a process dies after the API succeeds but before persistence; report that residual risk and bound attempts/spend.
- Persist a job's discovery snapshot, cache snapshot versions and stage completion markers. A resumed parent reuses them instead of rediscovering a changed corpus mid-run. Cancellation stops scheduling, signals in-flight I/O/subprocesses, preserves settled work and blocks promotion.
- Validation results bind to candidate hash, source revision, fixture hash, embedding/ranking configuration and baseline release ID. Promotion refuses changed candidates, missing/failed checks or an expired fence. Serialize deployment and reject superseded candidates so a slower old job cannot overwrite a newer release.
- Preserve current strict incomplete/empty discovery rejection. Optional enrichment failures preserve available cached values and produce a degraded coverage report; they do not masquerade as complete enrichment. Release promotion may proceed only if mandatory candidate checks pass and the explicitly configured enrichment policy accepts those reported gaps.

## Phase 1: Shared maintenance services and release validation

Implement idea 2 first, locally, without provisioning services or requiring paid vision.

1. Extract reusable preparation, cache I/O contracts and report-producing evaluation from CLI entrypoints. Keep argument parsing, terminal rendering and process exits in `scripts/`. Allow candidate output root and pinned manifest as explicit inputs instead of replacing `static/search/manifest.json` during preparation.
2. Build a candidate using `buildSearchRelease`; validate every file hash/size/schema, unique IDs, channel memberships, vector counts/mappings/norms/dimensions and lexical IDs against metadata. Validate bootstrap results/count/channels against the default browse ranking. Current checks are reusable but do not cover all these cross-file relationships.
3. Evaluate the existing fixture against full candidate rankings and a pinned baseline, sharing query embeddings under the same version. Report expected-block ranks, first-page success and rank changes. Gate on every non-pending fixture and any configured baseline regression tolerance; do not weaken the widget-grid expectation to make the gate pass. A missing expected block requires an intentional fixture review if the archive changed.
4. Record raw and compressed asset bytes, corpus/vector counts, Node evaluation timings and memory separately from actual browser/mobile measurements. Preserve the 25 MiB per-asset limit. Measure mobile startup/transfer/memory on a real device before setting an aggregate size budget; unverified performance remains explicit in the report. Synthetic data proves validator behavior, not production search quality.
5. Write versioned JSON plus a short Markdown report. Failed candidates remain inspectable; the active local manifest is unchanged. Add an explicit promotion command that verifies the report/candidate identity before using the existing filesystem publisher.
6. Test Trigger's Node 24 build/import compatibility with a non-mutating validation task and temporary synthetic candidate. Do not execute the CLI modules via imports: they perform top-level side effects.

Acceptance: corruption, incomplete discovery, a relevance failure or wrong candidate identity blocks promotion; the prior release remains readable. The full fixture is rerun on a real public candidate before any production promotion. The CLI check and report can run without Trigger.

## Phase 2: Durable hosted storage and manual sync

Implement idea 1 with cached vision and no Are.na write-back.

1. Record the storage/ownership ADR; provision private storage only during the implementation task. Add validated credentials, immutable artifacts, deterministic cache import/export and the durable lease/fence. Separate provider, storage and deployment credentials.
2. Add a schema-validated manual sync task and a local trigger CLI. Payload selects colour/connections stages; vision defaults off and write-back is rejected initially. Keep discovery and provider calls outside public routes. Adapt structured `SyncEvent` progress into phase/count metadata and a final report.
3. Split discovery from enrichment/document assembly as needed so the parent persists one complete, normalized corpus for subsequent tasks. Use existing pagination/filter/deduplication logic rather than reimplementing it. Add explicit completeness status rather than inferring it from counts.
4. Persist canonical merged caches, candidate releases and validation reports. Always stage a candidate; production deployment is a separate explicit action tied to a passing report.
5. Add a maintainer-run deployment workflow/command that downloads the validated candidate and retained previous release assets, builds at the recorded source revision, rechecks identity, and deploys the Worker/bootstrap/assets together. CI synthetic assets must be excluded. Do not introduce public R2 delivery or manifest-only promotion in this phase.

Acceptance: a remote run survives restart without losing settled work, incomplete discovery cannot publish/prune, cancelled or superseded jobs cannot promote, and downloaded cache exports parse identically to local caches. Demonstrate one hosted development run before production activation.

## Phase 3: Daily scheduled sync and automatic deployment

Requested by the maintainer on 2026-10-14: each morning the sync runs, and the site updates with new content. Decisions:

- The schedule is 06:00 UTC daily.
- Deployment requires intact files and no regression against the live release, rather than every fixture case passing. A pre-existing miss such as widget-grid is reported but does not block new content.

1. **Schedule.** Add `daily-archive-sync` as a `schedules.task` with `cron: { pattern: "0 6 * * *", environments: ["PRODUCTION"] }`, so it never fires in development.
   - It calls `runHostedSync` with colour and connections enabled. Since 2026-10-14 it also enables capped vision and Are.na write-back (see the scope note above).
   - The job ID is derived from the scheduled date (`daily-YYYYMMDD`), so a duplicate fire or a retry resumes the same job instead of starting a second one.
   - It uses the `archive-maintenance` queue, so it cannot overlap a manual job; the lease already enforces this durably.
   - Measure peak memory and use `small-2x` if it fits; otherwise keep `medium-1x`. One run is about 2 minutes, roughly $0.01 a day and $0.30 a month of the $5 credit.

2. **Source identity without a local checkout.** A GitHub Actions workflow deploys the Trigger worker on every push to `main` (`trigger.dev deploy --external-id <sha>`, using a deploy-only `TRIGGER_ACCESS_TOKEN`).
   - Before deploying, it writes a generated, gitignored `source-identity.json` (revision and fingerprint, computed by `sourceIdentity` at that commit) into the bundle.
   - Scheduled jobs record that identity. A worker bundle without it may sync and validate but must not hand off a deployment.
   - The manual `bun run hosted sync` keeps working, for ad-hoc runs from a clean checkout.

3. **Colour every morning.** Install ffmpeg with Trigger's `ffmpeg()` build extension, keeping the shared subprocess implementation and its limits.
   - Before enabling colour hosted, audit the colour download path. Add a content-length check, a streamed byte limit, a bounded timeout and cancellation if any are missing.
   - Test the deployed binary with a tiny generated fixture.
   - A daily run touches only new or changed images, so in-process stages suffice. Batched child tasks wait for phase 4.

4. **Regression gate.** Extend validation with an explicit gate policy recorded in the candidate origin, so it is bound into the report identity. Under the `no-regression` policy:
   - File, schema, mapping and bootstrap integrity remain mandatory.
   - A case that passes on the live release must still pass on the first page.
   - A case that already fails on the live release may keep failing, but its expected ranks may drop by at most a configured tolerance (default 10). It is reported as a known failure.
   - A case missing from the baseline, or any missing baseline, falls back to strict.

   Do not mark widget-grid `pending` or weaken its expectation. The local `promote:search` command keeps the strict policy.

5. **Adopt the live release as baseline.** The live site serves release `4241d946…`, identical to the local release on 2026-10-14. When no production pointer exists, the job downloads the public `/search/manifest.json` and its assets from the site URL. It verifies them with `loadValidatedRelease`, stores them under `releases/`, and records them as the production baseline. This needs no manual deploy and no credentials.

6. **Decide and hand off.** After validation:
   - If the candidate version equals the live version, there is nothing to deploy: report `unchanged` and stop.
   - If the gate fails, fail the run so Trigger's alert email fires (the free plan allows one destination), and leave the live site unchanged.
   - Otherwise, dispatch the GitHub deploy workflow with the job ID. This uses a fine-grained GitHub token limited to Actions on this repository, stored in the Trigger production environment.

7. **Deploy workflow** (`.github/workflows/deploy-site.yml`):
   - Triggered by `workflow_dispatch` with a job ID input, under concurrency group `production-site` with no cancellation.
   - It checks out the job's recorded revision and runs `bun run hosted deploy <job>`, which keeps every phase 2 check: lease, completed report, gate, supersession, source identity and recomputed evaluation. It then builds with the baseline and candidate assets only, deploys using a scoped `CLOUDFLARE_DEPLOY_API_TOKEN`, and records the production pointer.
   - Secrets: `MAINTENANCE_R2_*`, `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_DEPLOY_API_TOKEN`. No Are.na or Workers AI credentials are needed, because the recorded query vectors are reused.
   - It uses about 4 of the 2,000 monthly minutes per deploy. GitHub emails on failure.
   - Site code changes reach production through the next morning's run, or through a manual workflow or `hosted sync` run.

8. **Retention.** Daily candidates add about 19 MB each. Add `ObjectStore.delete`, and have the scheduled job prune after a successful run:
   - Keep the production release, the previous production release and the 7 newest candidates.
   - Keep 30 days of job directories.
   - Never prune canonical caches or embedding deltas.

   This keeps storage far below 10 GB.

9. **Rollback.** Revert the cause on `main` and let the next run publish, or run the deploy workflow for an earlier successful job after explicitly resetting the production pointer with a maintainer command. Supersession otherwise rejects older candidates. For emergencies, `wrangler rollback` restores the previous Worker version.

Acceptance:

- A production schedule fire produces exactly one job, even if fired twice.
- An unchanged archive deploys nothing.
- A new block appears on the live site after a passing run, with no local action.
- A regression or integrity failure leaves the site unchanged and sends an alert.
- An older job cannot overwrite a newer deployment.
- CI synthetic assets never ship.
- Retention never removes the live or previous release.
- Demonstrate one production scheduled run end to end, from schedule to live manifest, and record its cost.

## Phase 4: Block retries and hosted media processing

Implement idea 3 and the rest of idea 5 on the phase 2–3 foundation. Phase 3 already installs ffmpeg and runs colour measurement daily.

1. Extract single-block execution from the existing vision/colour/connections stages with typed success/skip/failure outcomes; keep local batch APIs and behavior. Persist each success before acknowledging completion.
2. Add bounded, batched child tasks (for example 50 blocks each, not one task per block, to stay within the free plan) for colour measurement and connection counting, used when a run has many pending blocks. Each block's outcome is still recorded individually, so retries stay per block. Children run on `small-1x` unless measurements require more.
3. Add vision media preparation for animations within the block task's scratch lifecycle. Preserve still rendition rules, GIF motion input, unsupported/oversize skips and cleanup on success/failure/cancellation. Keep image/video input-mode cache keys distinct. Before hosted use, fix the existing animation downloader: it currently buffers the entire response before its 64 MiB rejection and does not pass timeout/cancellation to fetch. Add content-length and streamed byte limits, a bounded download timeout, cancellation through body consumption, and cleanup tests; enforce the MP4 file-size limit before reading it into memory.
4. Add retry-failed-blocks using original immutable inputs and verified current cache keys. Retry transient failures only; terminal skips appear in the report. Merge results through the coordinator, without rewriting successful entries or pruning the rest of the corpus.

Acceptance: partial failure does not regenerate successful work; a duplicate child task cannot corrupt caches; retries respect provider budgets; real ffmpeg tests cover output limits, decode failure, timeout and cleanup.

## Phase 5: Targeted vision backfills and coverage reports

Implement ideas 4 and 8.

1. Add a read-only report using the pinned complete corpus and existing cache planners. Break down eligible, valid-cached, missing, stale-by-source/version/model/input-mode, terminally skipped and failed entries, plus connections older than seven days. Show coverage by channel/kind and bounded block-ID lists.
2. Store per-block skip/failure reasons in operational stage records; aggregate summaries alone cannot support targeted follow-up. Report connection freshness separately from deterministic image-cache validity. Distinguish no-image/ineligible blocks from missing work.
3. Add a backfill planner for selected IDs/channels, missing/stale entries or an explicit model/prompt version. Report planned counts, image/video split, cache hits, estimated calls and a cost range based on available provider pricing/observed usage. Mark unknown cost explicitly.
4. Require explicit vision enablement, bounded selection/max-block count and a run budget. Stop scheduling at budget/call limits, including retry allowance and in-flight exposure. Do not bump the production prompt globally to select a subset. Reuse `planVisionWork`, schema validation and durable cache-key records.
5. Persist successful backfill entries; build/validate a new candidate only as an explicit follow-on action. Generated tags/text stay retrieval inputs, not result fields. The coverage task makes no model calls or Are.na writes; it may reuse stored discovery or explicitly perform read-only discovery.

Acceptance: a report explains why each gap exists; a backfill touches only its selected eligible blocks, preserves untargeted caches, observes limits and can resume; the scheduled sync still generates no vision. Backfills stay manually triggered because they spend OpenRouter credit.

## Phase 6: Isolated search experiment batches

Implement idea 9 after reliable evaluation and backfills exist.

1. Pin one public corpus, fixture, baseline release and source revision. Define a small validated matrix with one variable changed at a time: chunking, vision prompt/model or ranking parameter. Store all artifacts/caches under an experiment ID; never mutate canonical caches or Are.na.
2. Reuse unchanged enrichment and embedding chunks. Version candidate embedding/chunk configurations explicitly; candidate engines and query embeddings must match, rather than bypassing current release-version validation. Production retains RRF `k=60` unless a separately reviewed decision changes it.
3. Run full fixture rankings; compare first-page successes, per-case expected ranks, aggregate reciprocal-rank/recall metrics, payload size, measured runtime and provider cost/call counts. Include hard filter/sort/paging invariants and keep Node timing distinct from browser timing.
4. Investigate the widget-grid miss with rank/lexical/chunk evidence before proposing a change. Use held-out queries to avoid optimizing only the existing fixture. An experiment may suggest a winner; it never promotes automatically or changes production config.

Acceptance: the same pinned inputs/config reproduce the comparison, experiment cancellation/retries cannot alter production artifacts, and adopting a candidate requires ordinary validation/versioning and review.

## Validation and rollout

For each vertical slice, run `bun run check`, `bun run lint`, `bun run test` and `bun run build`, plus focused tests for new normalizers/mappers and meaningful persistence/failure contracts. Exercise restart, duplicated scheduling, lease loss, old-job takeover, subset merges, task failure classification and promotion integrity using fake provider/storage dependencies; use real ffmpeg where subprocess behavior matters.

Perform hosted smoke tests first on synthetic fixtures, then a small public subset, then a full cached-vision run. Never substitute synthetic CI evidence for real-corpus relevance. Record commands, source/candidate versions, provider calls and environments in each worksheet. Update architecture/docs alongside each implementation phase; keep proposed details here until they exist in code. The daily schedule and automatic deployment are the only recurring automation. Failure notification uses Trigger's built-in alert email and GitHub's workflow failure emails; any other notification integration needs separate scope.

## References checked

Trigger.dev docs checked on 2026-10-14. Use APIs supported by the installed 4.7.3 SDK; current documentation may describe newer APIs.

- [Tasks and lifecycle hooks](https://trigger.dev/docs/tasks/overview)
- [Batch triggering and waiting](https://trigger.dev/docs/triggering#yourtask-batchtriggerandwait)
- [Waiting parents release concurrency slots](https://trigger.dev/docs/concurrency#waiting-for-a-subtask)
- [Idempotency](https://trigger.dev/docs/idempotency)
- [FFmpeg build extension](https://trigger.dev/docs/config/extensions/ffmpeg)

- [Scheduled tasks](https://trigger.dev/docs/tasks/scheduled)
- [Deploying from GitHub Actions](https://trigger.dev/docs/github-actions)
- [Pricing and machine sizes](https://trigger.dev/pricing), checked on 2026-10-14

This plan uses R2 and a GitHub Actions deployment handoff; neither is provided automatically by Trigger's retry or task features.
