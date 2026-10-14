# Trigger.dev maintenance workflows

Status: phase 1 implemented locally; phases 2–5 planned; scope selected by the maintainer on 2026-10-14.
The current runtime is described in [architecture](../architecture.md). Phase 1 provides local candidate commands and a synthetic Trigger validation task (evidence in the [phase 1 worksheet](../history/worksheets/worksheet-candidate-validation.md)); remaining phases are proposed work.

## Outcome and scope

Move long-running archive maintenance into manually triggered, observable jobs while preserving browser search, original Are.na results and public-only releases. Implement these selected ideas:

| Original idea | Deliverable                                                                      |
| ------------- | -------------------------------------------------------------------------------- |
| 1             | Manually triggered archive sync with explicit stage options and durable progress |
| 2             | Candidate search release validation before promotion                             |
| 3             | Retry failed enrichment blocks without repeating successful work                 |
| 4             | Targeted, bounded vision backfills                                               |
| 5             | Hosted colour measurement and animation preparation with ffmpeg                  |
| 8             | Enrichment coverage and freshness reports                                        |
| 9             | Isolated search experiment batches and comparison reports                        |

Automatic scheduled sync, Are.na write-back preview/approval UI, uptime monitoring, backup/pruning automation and a public admin interface are outside this plan. Keep existing owner-only write-back code, but disable it in the initial hosted tasks. This planning request does not execute paid vision, provision services or deploy anything.

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

## Phase 3: Block retries and hosted media processing

Implement ideas 3 and 5 on the phase 2 persistence foundation.

1. Extract single-block execution from the existing vision/colour/connections stages with typed success/skip/failure outcomes; keep local batch APIs and behavior. Persist each success before acknowledging completion.
2. Add bounded child tasks for colour measurement and connection counting. Install ffmpeg using Trigger's build extension, retaining the shared subprocess implementation and current download/output/time limits. Test the actual deployed binary with a tiny generated fixture.
3. Add vision media preparation for animations within the block task's scratch lifecycle. Preserve still rendition rules, GIF motion input, unsupported/oversize skips and cleanup on success/failure/cancellation. Keep image/video input-mode cache keys distinct. Before hosted use, fix the existing animation downloader: it currently buffers the entire response before its 64 MiB rejection and does not pass timeout/cancellation to fetch. Add content-length and streamed byte limits, a bounded download timeout, cancellation through body consumption, and cleanup tests; enforce the MP4 file-size limit before reading it into memory.
4. Add retry-failed-blocks using original immutable inputs and verified current cache keys. Retry transient failures only; terminal skips appear in the report. Merge results through the coordinator, without rewriting successful entries or pruning the rest of the corpus.

Acceptance: partial failure does not regenerate successful work; a duplicate child task cannot corrupt caches; retries respect provider budgets; real ffmpeg tests cover output limits, decode failure, timeout and cleanup.

## Phase 4: Targeted vision backfills and coverage reports

Implement ideas 4 and 8.

1. Add a read-only report using the pinned complete corpus and existing cache planners. Break down eligible, valid-cached, missing, stale-by-source/version/model/input-mode, terminally skipped and failed entries, plus connections older than seven days. Show coverage by channel/kind and bounded block-ID lists.
2. Store per-block skip/failure reasons in operational stage records; aggregate summaries alone cannot support targeted follow-up. Report connection freshness separately from deterministic image-cache validity. Distinguish no-image/ineligible blocks from missing work.
3. Add a backfill planner for selected IDs/channels, missing/stale entries or an explicit model/prompt version. Report planned counts, image/video split, cache hits, estimated calls and a cost range based on available provider pricing/observed usage. Mark unknown cost explicitly.
4. Require explicit vision enablement, bounded selection/max-block count and a run budget. Stop scheduling at budget/call limits, including retry allowance and in-flight exposure. Do not bump the production prompt globally to select a subset. Reuse `planVisionWork`, schema validation and durable cache-key records.
5. Persist successful backfill entries; build/validate a new candidate only as an explicit follow-on action. Generated tags/text stay retrieval inputs, not result fields. The coverage task makes no model calls or Are.na writes; it may reuse stored discovery or explicitly perform read-only discovery.

Acceptance: a report explains why each gap exists; a backfill touches only its selected eligible blocks, preserves untargeted caches, observes limits and can resume; the default sync still generates no vision.

## Phase 5: Isolated search experiment batches

Implement idea 9 after reliable evaluation and backfills exist.

1. Pin one public corpus, fixture, baseline release and source revision. Define a small validated matrix with one variable changed at a time: chunking, vision prompt/model or ranking parameter. Store all artifacts/caches under an experiment ID; never mutate canonical caches or Are.na.
2. Reuse unchanged enrichment and embedding chunks. Version candidate embedding/chunk configurations explicitly; candidate engines and query embeddings must match, rather than bypassing current release-version validation. Production retains RRF `k=60` unless a separately reviewed decision changes it.
3. Run full fixture rankings; compare first-page successes, per-case expected ranks, aggregate reciprocal-rank/recall metrics, payload size, measured runtime and provider cost/call counts. Include hard filter/sort/paging invariants and keep Node timing distinct from browser timing.
4. Investigate the widget-grid miss with rank/lexical/chunk evidence before proposing a change. Use held-out queries to avoid optimizing only the existing fixture. An experiment may suggest a winner; it never promotes automatically or changes production config.

Acceptance: the same pinned inputs/config reproduce the comparison, experiment cancellation/retries cannot alter production artifacts, and adopting a candidate requires ordinary validation/versioning and review.

## Validation and rollout

For each vertical slice, run `bun run check`, `bun run lint`, `bun run test` and `bun run build`, plus focused tests for new normalizers/mappers and meaningful persistence/failure contracts. Exercise restart, duplicated scheduling, lease loss, old-job takeover, subset merges, task failure classification and promotion integrity using fake provider/storage dependencies; use real ffmpeg where subprocess behavior matters.

Perform hosted smoke tests first on synthetic fixtures, then a small public subset, then a full cached-vision run. Never substitute synthetic CI evidence for real-corpus relevance. Record commands, source/candidate versions, provider calls and environments in each worksheet. Update architecture/docs alongside each implementation phase; keep proposed details here until they exist in code. Tasks remain manual; notification integrations and recurring runs need separate scope.

## References checked

Trigger.dev docs checked on 2026-10-14. Use APIs supported by the installed 4.7.3 SDK; current documentation may describe newer APIs.

- [Tasks and lifecycle hooks](https://trigger.dev/docs/tasks/overview)
- [Batch triggering and waiting](https://trigger.dev/docs/triggering#yourtask-batchtriggerandwait)
- [Waiting parents release concurrency slots](https://trigger.dev/docs/concurrency#waiting-for-a-subtask)
- [Idempotency](https://trigger.dev/docs/idempotency)
- [FFmpeg build extension](https://trigger.dev/docs/config/extensions/ffmpeg)

This plan proposes R2 and a deployment handoff; neither is provided automatically by Trigger's retry/task features.
