# Architecture

Archivist is a SvelteKit app on Cloudflare Workers. Are.na V3 is the source of truth; manual sync creates a public static search release. MiniSearch, metadata and chunk vectors run in a browser Web Worker. No Turbopuffer code or service is required.

## Data access

The default gallery is prerendered from a checked bootstrap snapshot. After mount, URL state drives browser search and paging. Public requests never proxy Are.na. JavaScript is required for interactive search/filtering. The retired /api/search returns 410; /api/embedding accepts bounded query text and returns a versioned normalized Workers AI vector. Rate limiting fails closed for embeddings.

## Retrieval behavior

Canonical `search_text` is assembled by `toSearchDocument` in `src/lib/domain/archive.ts`, in this order: block title, description, content, source title, deduplicated channel titles, cached vision description, bounded OCR, and normalized tags joined with commas. Each field has whitespace collapsed, empty fields are omitted, and fields are joined with newlines. Generated vision titles, medium and palette are not part of this text. Tags are lowercased, dehyphenated, deduplicated and sorted; OCR is capped at 6,000 characters and discarded when its bounded sample has at least 100 words but fewer than 10% unique words. MiniSearch ranks lexical matches. Semantic retrieval computes exact cosine similarity over all eligible chunk vectors and aggregates the maximum score per original block. Hybrid fuses full ranked lists with RRF (k=60). Filter before ranking; preserve type/channel OR, colour AND, UTC dates, colour thresholds and stable ID tiebreaks. Paging uses the full ranking rather than a top-100 cap.

## Releases and sync

Public-only discovery excludes all private channels and refuses incomplete or empty exports. Releases contain checked metadata, serialized lexical index, Float32 vector shards and a first-page bootstrap. Stage immutable content-hashed releases before atomically replacing the manifest. Retain previous versions for open browser sessions. Static files and the local embedding cache are ignored by Git; generate them before building/deploying.

Run bun run export:search for cached descriptions/colours/connections without any Are.na write-back or vision generation. Full sync optionally refreshes these caches and writes generated descriptions back to Are.na, then publishes the same release format. Cloudflare REST credentials are local CLI inputs; deployed query inference uses the AI binding.

See the [browser search decision](./decisions/0004-browser-search.md). Free operation depends on Workers/Workers AI allocations. Candidate validation on 2026-10-14 placed the widget-grid expected block at rank 116 of the 2,213-block public corpus, unchanged from the active baseline, so that candidate failed the gate and was not promoted. Physical mobile performance has not been verified.

Document embeddings use `@cf/baai/bge-small-en-v1.5`, 384 dimensions and at most 384 UTF-8 bytes per chunk, covering the complete canonical text. The builder embeds missing unique chunks in batches of 32 and caches them by embedding version plus text hash. Query embeddings use the same model/version with the configured query prefix. The endpoint accepts at most 400 characters and a 4,096-byte JSON body.

### Local publication and live deployment

`scripts/publish-search.ts` writes to `static/search/` and `.search-cache/`; it does not deploy. `scripts/search-files.ts` stages immutable releases and atomically replaces the local manifest. The builder caps each asset at 25 MiB and vector shards at about 8 MiB. Metadata contains result fields, filter/sort metadata and vector-to-block mappings; the lexical file holds the searchable text index. Generated vision fields are absent from the result shape, but their indexed text is downloadable in the lexical asset.

`bun run deploy` builds the app (including its prerendered bootstrap) and uploads the Worker and static assets together. Replacing a remote manifest alone is not the current publication model. Retain previous release directories in the build output to keep old sessions working; local publication does not delete them, but a fresh checkout will not recover them automatically.

CI installs ffmpeg, runs check/lint/tests, then creates a synthetic search release for its build. This proves buildability, not real-corpus relevance; synthetic assets must never be deployed.

## Vision indexing

Many image blocks have a filename for a title and no description. Text search cannot find them. The vision stage (`src/lib/server/indexing/vision/`) has a model describe each block that has an image. That text is indexed for search.

It runs only during sync. Search itself uses no model, and a result is always the original Are.na block. The gallery never shows the `vision_*` fields. Generated titles/descriptions become visible gallery copy only through write-back: it puts them on the Are.na block, and the next sync indexes and shows them like other block metadata. Indexed vision description, OCR and tags are also present in downloadable lexical assets, even though the gallery does not render those fields.

**Model.** `xiaomi/mimo-v2.5` through OpenRouter. The code uses plain `fetch` and Zod, with no SDK.

- It pins the providers `deepinfra`, `streamlake` and `venice`, and sets `require_parameters: true`. OpenRouter's cheapest route for this model cannot return structured output, so it would sometimes return plain prose.
- Reasoning is off. `max_tokens` is 2,048, which stops a runaway reply.
- A request times out after 240 seconds.
- A 408, 429 or 5xx is retried up to 4 times, with growing waits. `Retry-After` is honoured.
- A timeout gets 2 attempts in all. A request that stalls usually stalls again.

**Input.**

- Stills are not downloaded. Are.na resizes images with a URL that holds a base64 JSON payload. `rendition.ts` rewrites it to fit inside 768 × 768 and the provider fetches that smaller image. A URL that is not an Are.na resizer URL is sent unchanged.
- Skipped: a non-resizable image over 5 MB, and any type except JPEG, PNG, WebP or GIF. An unknown type is let through.
- Animated blocks (`image/gif`) are read as motion. `video.ts` downloads the source and uses ffmpeg to make a silent MP4: at most 512 px wide, 6 fps, CRF 32, killed after 60 s. A non-success HTTP response is skipped. The full source is currently buffered before rejecting sources over 64 MiB, and the output file is read before rejecting MP4s over 4 MiB. The source fetch currently has no timeout or cancellation signal; fetch exceptions become stage failures. These resource/cancellation gaps must be fixed before hosted media processing. The MP4 is sent inline as a data URL.
- The scratch folder is deleted on every exit. A killed run can leave one behind. The next run with animations to describe deletes any that are over an hour old before it starts on them.
- ffmpeg must be on `PATH`. Without it, each animated block fails with a message that names ffmpeg. The run goes on. Use `--no-vision` to skip the stage.

**Prompt and output.** `prompt.ts` holds `PROMPT_VERSION`, the system prompt and a structured-output schema. The prompt requests:

- `title`: at most 70 characters, and never the title we supplied.
- `description`: 200 to 500 characters.
- `ocr`: every readable word.
- `palette`: 3 to 5 hex colours. It is cached but not used: it has no weights, so colour comes from the pixels instead (see [Colour indexing](#colour-indexing)).
- `medium`: one of nine values.
- `tags`: 3 to 8.

The block's type, title, description and source title go along as context, each cut to 400 characters. They are fenced and labelled as untrusted text that must not be obeyed. These are prompt targets, not all enforced schema bounds: the cache schema accepts a nonempty title up to 200 characters, a nonempty description, arbitrary string arrays for palette/tags and one of nine media. The client rejects a copied title or a title over 140 characters and truncates descriptions to 500 characters. A reply that is not valid JSON or fails validation is rejected. A rejected reply is retried within the same budget as a 5xx, and is never cached.

**Cache.** `vision-cache.jsonl` is the record of every description. It is committed, so a fresh clone can reuse existing descriptions. It has one entry per block, in a fixed key order and sorted by block id, so an unchanged run leaves no diff.

An entry is reused only when all of these match: block id, `image_src_hash`, `prompt_version`, `model` and `input_mode`. The check happens before any network call. `image_src_hash` hashes the resizer payload's bucket and key, not the URL, so changing the width invalidates nothing. To redo one block, delete its line. Changing `PROMPT_VERSION` or the model redoes every block, so check the cost first.

When the cache is merged, entries for blocks that left the archive are dropped. If a channel failed or the sync was aborted, nothing is dropped, since a block in that channel only looks gone. A block whose description failed this run keeps its old entry.

**Running it.** Concurrency is fixed at 32. A description takes 20 to 160 seconds, and speed per worker stays about flat as workers are added. A failed or skipped block is logged and gets no cache entry, so the next run tries it again. The script saves the cache every 25 entries, so an interrupted run loses at most that many.

**Write-back** (`writeback.ts`, and `src/lib/domain/titles.ts`, which the gallery captions also use to skip titles with no information). This is the only code that writes to the maintainer's archive. It is on by default. `--no-push-arena` skips it.

- It only touches blocks the token's owner made. Are.na rejects edits to anyone else's.
- A title is replaced only if it has no information: a filename, a hash, a bare URL, platform boilerplate (`… on X: "…"`, a `(1) ` prefix, `- YouTube`, Instagram), or a title over 80 characters that contains the opening of the description.
- A missing title is filled in. A description is written only if the block has none. A block with no cache entry is skipped.
- Each write also sets `metadata.vision_v`, `vision_at` and `vision_src`.
- Writes are paced at 500 ms, because the free tier allows 120 a minute. A rate-limited block waits as long as Are.na asks, up to 3 times. Any other error fails that block without a retry.
- If the first 5 writes all fail, the sync stops before indexing. This almost always means a read-only token.
- There is no preview and no cap on how many blocks one run writes.

## Colour indexing

The colour stage (`src/lib/server/indexing/colour/`) measures how much of each image is each colour. It runs only during sync, uses no model, and costs nothing but downloads. The decision and its alternatives are in [ADR 0001](./decisions/0001-colour-from-pixels.md).

- **Input.** A still is fetched as a 128px Are.na rendition (`rendition.ts`); an animation on the CDN has no rendition, so its original is fetched. Every download is capped at 64 MB, by `content-length` and again while streaming. Video attachments and embeds are measured from their poster or thumbnail. Formats the vision stage skips are skipped here too.
- **Nothing touches disk.** The bytes are piped to ffmpeg on stdin, which writes 64 × 64 RGBA frames to stdout: the first frame, then one a second, up to 8. Both buffers are dropped once weighed. `runFfmpeg` (`src/lib/server/indexing/ffmpeg.ts`) is shared with `video.ts`.
- **Weights.** Each opaque pixel is classified in OKLCH (`classify.ts`): low chroma is black, grey or white by lightness; the rest go by hue band, with dark or muted warm hues as brown. A weight is that colour's share of the opaque pixels, in per-mille. `mono` is 1000 minus the chromatic share. A block with no image or no measurement weighs 0 everywhere and never matches.
- **Cache.** `colour-cache.jsonl` is committed, one entry per block, fixed key order, sorted by block id. An entry is reused when block id, `image_src_hash` and `COLOUR_VERSION` match; bump the version when the classifier changes. Merge rules match the vision cache: entries for blocks that left are dropped unless a channel failed or the run was aborted, and a failure keeps the old entry. The CLI checkpoints every 25 entries.
- **Running it.** 4 workers. A failed or skipped block gets no entry and is retried next run. ffmpeg must be on `PATH`; without it every block fails with a message naming ffmpeg and `--no-colour`.
- **Calibrating.** `bun run calibrate:colour` lists blocks from the search snapshot, measures a stable sample and writes a contact sheet outside the repo. It is read-only.

Colour filters are ANDed. On the default browse order, selected colours sort lexicographically by descending weight before connection count/date/ID; there is no sum. The leading colour needs weight 1, except mono; other chromatic thresholds are 10, grey/black/white 150 and mono 995. Other browse sorts and query modes use ordinary thresholds. The URL accepts at most five colours; the UI offers nine swatches.

## Connection counts

`connections/` fetches every block's total Are.na connections with four workers. `connections-cache.jsonl` stores block ID, total and timestamp; entries are reused for seven days. Failures preserve old entries, and incomplete discovery prevents removal of unseen cached blocks. `connection_count` counts deduplicated owned-channel memberships; `total_connection_count` is at least that count even if the remote total is missing or stale. My most connected is the default browse order, followed by newest connected and ID; Most connected uses total count, newest created and ID.

## Candidate validation

Shared services under `src/lib/server/maintenance/` validate canonical release hashes, every asset's bytes/hash/schema, MiniSearch scoring/posting relationships, vector normalization/mappings and bootstrap equality with default browse. Evaluation uses complete rankings, reports expected-block ranks against a pinned baseline, and shares query embeddings across cases. Production fixtures retain the existing ten-case minimum and unique case IDs. Mobile performance remains explicitly unverified; Node timings/heap and gzip byte counts are diagnostic measurements.

`bun run prepare:search .maintenance/<candidate>` discovers a complete public archive using existing caches and generates a separate candidate. It never generates vision or writes Are.na. `bun run validate:search .maintenance/<candidate>` writes JSON/Markdown reports, then fails if a mandatory fixture fails. `bun run promote:search .maintenance/<candidate>` revalidates all files and recomputes outcomes using saved query vectors before replacing the local active manifest; it checks working-tree source, fixture, origin and active baseline identity. This is local preparation evidence, not cryptographic attestation against someone with write access to the workspace.

All manifest writers use an exclusive publication lock and fail explicitly on contention. A process killed without cleanup may leave `.publication-lock`; remove it only after verifying no writer is active. Embedding checkpoints use a separate lock, merge latest persisted entries and atomically write the union. Existing `sync`/`export:search` still publish directly locally; use candidate commands for the relevance gate. No command here deploys the site.

## Trigger.dev

The current integration is SDK/build package 4.7.3, `trigger.config.ts` using Node 24, task discovery under `src/trigger/`, a 3,600-second maximum duration and three default attempts (also enabled in development). Tasks are:

- `hello-world`, the typed example.
- `validate-search-smoke`, which checks a synthetic release with no provider calls or publication.
- `archive-sync`, the manual hosted sync.
- `daily-archive-sync`, the scheduled production sync.
- `archive-enrich-batch`, a 50-block child used when a stage has a large backlog.
- `archive-vision-backfill`, the only task that spends OpenRouter credit. It runs only when triggered manually.

### Hosted maintenance

`archive-sync` runs on the `archive-maintenance` queue (concurrency 1) with two attempts. Its payload selects the colour and connections stages, and optionally vision (with a per-run block cap and budget) and Are.na write-back; both default off for manual jobs. Persistence and coordination are described in [ADR 0005](./decisions/0005-hosted-maintenance-storage.md). A job:

1. Takes the archive lease.
2. Pins one complete discovery via `discoverArchive`; incomplete or empty discovery persists nothing.
3. Overlays its own settled records on the canonical caches, then runs `enrichArchive`, persisting every settled entry immediately.
4. Merges those records into the latest canonical snapshot under the fence.
5. Builds a candidate with hosted embedding deltas.
6. Validates the candidate against the bundled fixture and the deployed baseline. When no production pointer exists, it first adopts the release the public site serves as that baseline, verifying every asset.
7. Writes a final job report with a decision: `deploy` (passed, and differs from live), `unchanged` or `rejected`.

A restarted attempt reuses the pinned discovery, settled records and recorded stage results.

Each enrichment stage is built from one-block functions (`measureBlock`, `countBlock`, `describeBlock`). These return a `done` entry, a terminal `skipped` outcome (unsupported, too large, or unreachable with a 4xx), or a retryable outcome (a thrown error, or a source that answered 5xx or 429). Hosted jobs persist every non-done outcome in `outcomes.json` and report the retryable count.

`bun run hosted retry <job>` re-runs only that job's retryable blocks on its pinned discovery. It merges without pruning, and builds and validates a candidate as usual.

A stage with more than 500 pending blocks fans out into 50-block `archive-enrich-batch` children (`small-1x`, two at a time). The children only add job records and outcomes; a retried colour batch skips blocks already recorded. The parent merges under the lease, which it explicitly renews after the wait, since Trigger may suspend a waiting parent. While a parent waits, its queue slot is released, so another maintenance job fails on the lease rather than overlapping.

Media downloads share `downloadCapped`, which refuses a declared or streamed body over the limit without buffering it and applies the timeout and cancellation to the whole body. The animation transcoder checks the encoded size on disk before reading it, and ffmpeg reports timeouts distinctly. Progress is exposed as run metadata (`phase`, `position`). Lease conflicts, invalid configuration and reused job IDs fail without retry.

Validation uses one of two gate policies, recorded in the candidate origin:

- `strict` (manual default and local `promote:search`) requires every non-pending case on the first page.
- `no-regression` (scheduled jobs) keeps integrity checks mandatory and requires cases the live release passes to stay on the first page. A case that already fails live is reported as a known failure and passes if its expected ranks drop by at most 10.

### Coverage and vision backfills

`bun run hosted coverage [--job <id>]` is read-only. It classifies every block of a job's pinned corpus against the canonical caches:

- **Vision:** valid, missing, stale (source, prompt, model or input mode), unsupported, or no image.
- **Colour:** valid, missing, stale (source or version), unsupported, or no image.
- **Connections:** fresh, stale (older than 7 days), or missing.

It also reports the job's recorded failures and coverage by channel and block type, with bounded ID lists, and writes `.maintenance/coverage.{json,md}`. Jobs that predate per-block outcomes are reported as not recorded rather than as zero failures.

`bun run hosted backfill --plan` selects describable blocks by IDs, channels, and missing or stale state, using the production model and prompt version. It never bumps the prompt to select a subset. It estimates cost from OpenRouter's public pricing with stated token assumptions, and spends nothing.

`--run` requires an explicit `--max-blocks` (at most 1,000) and `--budget-usd` (at most $20), and triggers `archive-vision-backfill`. That task:

- **Spending:**
  - reserves each block's worst case before starting it (every retry at maximum length, or the costliest block seen so far if larger);
  - books OpenRouter's reported `usage.cost`, charging requests of unknown cost at the ceiling;
  - stops scheduling when spend plus in-flight reservations would exceed the budget;
  - keeps a spend ledger in R2, so a resumed attempt counts earlier in-flight exposure as spent.
- **Resuming:** it persists every generated entry immediately and skips them on resume.
- **Merging:** it takes the archive lease only to merge without pruning, waiting out a running daily sync.

It refuses to run without pricing, never writes to Are.na, and does not build a candidate: the next daily sync publishes the new text through the usual gate.

### Daily sync and deployment

`daily-archive-sync` runs at 06:00 UTC in production only, as job `daily-YYYYMMDD`, so a duplicate fire or retry resumes the same job. It is the hosted equivalent of `bun run sync`:

- **Enrichment:** colour (ffmpeg comes from the Trigger build extension) and connections.
- **Vision:** describes missing or stale blocks through the spend limiter, at most 50 blocks and $0.50 a day. Anything beyond waits for the next morning. If pricing is unavailable, vision is skipped for the run rather than spending blind.
- **Write-back:** sends generated titles and descriptions to the maintainer's own Are.na blocks, under the owner-only rules in `writeback.ts`, with no cap on writes. Each successful write is recorded under the job, so a resumed attempt never repeats it, and that morning's build uses the written text.
- **Gate:** the `no-regression` gate applies before deployment.

Then:

- `rejected` fails the run, which triggers Trigger's alert email.
- `deploy` dispatches the `Deploy site` GitHub workflow (`.github/workflows/deploy-site.yml`) with the job ID and revision.
- Finally, retention prunes releases (keeping live, previous and the 7 newest candidates) and job directories older than 30 days.

The job refuses to run without the source identity that CI bakes into `src/trigger/source-identity.ts` (`bun run hosted identity`) before each production Trigger deploy. The CI `deploy-trigger` job does this on every push to `main` after the quality checks pass. The site workflow checks out the recorded revision and runs `bun run hosted deploy`, which repeats every check. A job that is already live is a no-op.

`bun run hosted` is the maintainer CLI:

- `bootstrap` imports committed caches and the local embedding cache once.
- `pull` imports hosted caches locally without replacing newer local entries, and writes `.maintenance/cache-changes.json`.
- `retry <job> [--no-regression]` re-runs only a job's retryable blocks.
- `sync` triggers a job from a clean checkout, with `--no-colour`, `--no-connections`, `--no-regression`, and `--resume <job>` (which uses a fresh run key).
- `identity` writes the clean checkout's source identity into the Trigger bundle; CI runs it.
- `deploy <job> [--dry-run]` stages and deploys a job's candidate. It verifies the job report, checkout identity, supersession and recomputed evaluation, moves existing local search assets aside, and publishes only the deployed baseline and the candidate. It then builds, deploys, and records the production pointer.

Only the daily schedule runs automatically, and only it writes to Are.na. Paid vision runs only in that capped daily stage or in a manually triggered, budgeted backfill. Only the site workflow deploys.

## Build and local binding emulation

The Cloudflare adapter enables remote bindings only for Vite `serve`. Production builds disable remote binding emulation, so prerendering does not open a Workers AI preview session or require Cloudflare credentials. Local development keeps remote Workers AI enabled and disables persisted platform-proxy state. Deployed bindings are supplied by `wrangler.jsonc`.
