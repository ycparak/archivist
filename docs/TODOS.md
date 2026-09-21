# TODOs

Task backlog and work-in-progress tracking. See [`workflows/agent-loop.md`](./workflows/agent-loop.md) for how to work this list.

Seeded from [`implementation_plan.md`](./implementation_plan.md) — vertical slices, smallest first. Keep this list current: move items between sections as you work, don't let it drift from reality.

## Up Next

### Video playback in the gallery

- [ ] **Autoplaying, looping, muted video in result cards.** The UI only renders `<img>`, and the index
      stores no video URL (only the thumbnail), so this needs a new indexed field and a re-sync — not
      just a component change. Plan, open questions and the exact touch points are in
      [`specs/spec-video-playback.md`](./specs/spec-video-playback.md).

## In Progress

_(none)_

## Done

### Vision indexing — phase 1

Generate visual descriptions for the 2,585 blocks with an image and fold them into retrieval.
Spec: [`specs/spec-vision-indexing.md`](./specs/spec-vision-indexing.md).
Decision: [`decisions/adr-vision-indexing.md`](./decisions/adr-vision-indexing.md).
Work these in order — each one is shippable on its own.

- [x] **1. Baseline the search evaluation.** Done — the evaluation was red before this work started
      (3 cases stranded past the 24-result limit by the browse-ordering change, 1 expecting a block
      that pruning had removed). Repaired those 4 to be ordering-independent, added rank reporting
      so dilution is visible, added a `pending` field so target cases can be recorded without
      holding the gate red, and added 5 pending vision cases grounded in the actual images. Baseline
      and the promotion bar for task 5 are in
      [worksheet](./history/worksheets/worksheet-vision-eval-baseline.md).
- [x] **2. Rendition and cache primitives.** Done —
      [`vision/rendition.ts`](../src/lib/server/indexing/vision/rendition.ts) (payload
      decode/rewrite/re-encode, source-key extraction, SHA-256; passes non-resizer URLs through
      untouched) and [`vision/cache.ts`](../src/lib/server/indexing/vision/cache.ts) (JSONL
      parse/serialize with fixed key order, the skip rule, and a merge that keeps entries for
      blocks skipped this run while dropping ones that left the archive). 31 unit tests; the
      rendition rewrite also verified against live Are.na, 10 of 10 at HTTP 200 and ~70% smaller.
- [x] **3. OpenRouter client.** Done — [`vision/prompt.ts`](../src/lib/server/indexing/vision/prompt.ts)
      (`PROMPT_VERSION`, system prompt, strict JSON schema, fenced untrusted-context builder) and
      [`vision/client.ts`](../src/lib/server/indexing/vision/client.ts) (`xiaomi/mimo-v2.5`,
      `require_parameters: true` with an explicit provider order, reasoning disabled, Zod validation
      at the boundary, and rejection of a title that echoes the supplied one). `fetch` + Zod, no new
      dependency. `image.file_size` and `content_type` are now carried through `ArchiveBlock` so the
      size guard costs no network call. 39 new tests.
      **Not yet verified against the live API** — `OPENROUTER_API_KEY` is an empty placeholder in
      `.env`. Fill it in, then task 4's `--vision-limit=25` is the first real call.
      GIF finding: 43 of the 134 non-resizable images exceed 5 MB (max 24 MB, 615 MB total) and
      Are.na publishes no smaller rendition for them, so phase 1 skips and reports them. Phase 2's
      video input is the fix.
- [x] **4. Wire the stage into sync behind `--vision`.** Done —
      [`vision/index.ts`](../src/lib/server/indexing/vision/index.ts) (`describeBlocks`,
      `planVisionWork`, bounded concurrency pool, per-block failures collected not fatal) wired into
      [`sync.ts`](../src/lib/server/indexing/sync.ts) on the deduplicated block set, with
      `--vision`, `--vision-dry-run`, `--vision-limit=N`, `--revision[=<slugs>]` and the new summary
      lines. Without `--vision`, sync behaves exactly as before.
      **Verified live end to end:** a dry run planned 2,581 blocks at zero cost; `--vision-limit=6`
      generated and cached 6; a re-run reported those 6 as free cache hits. Twelve outputs read by
      hand and two checked against the images — titles 29–60 chars, descriptions 429–497 chars,
      OCR present where there is text.
      Two findings for task 5: the model overruns the description cap (a first call came back 640
      chars), so the client now clamps at a sentence boundary; and `medium` is the least reliable
      field — a grainy photograph was labelled `painting`. Do not promote `vision_medium` to a UI
      facet without measuring it.
- [x] **5. Schema, `search_text`, and the full backfill.** Code complete and committed; the
      backfill run is handed off — see
      [handoff worksheet](./history/worksheets/worksheet-vision-backfill-handoff.md).
      Done: four additive `vision_*` attributes in the Turbopuffer schema (no namespace bump);
      `toSearchDocument(block, vision?)` folding `vision_description` and `vision_ocr` into
      `search_text` after the block's own metadata; retry with exponential backoff on 429/5xx
      honouring `Retry-After`; cache checkpointing every 25 entries so a multi-hour run survives
      interruption; `--vision-concurrency=N`; architecture.md schema table and sync lifecycle
      updated. 305 tests pass.
      Fixed along the way: sync now indexes the vision cache on **every** run, not only with
      `--vision`. Previously a plain `bun run sync` after the backfill would have silently stripped
      every generated description back out of the namespace. Verified against the live namespace.
      **Remaining, for the maintainer:** run `bun run sync --vision` (~2,570 blocks, ~$0.50,
      roughly 1–3.5h), commit `vision-cache.jsonl`, re-run `evaluate:search`, promote the five
      pending cases, and check `exact-phrase-link` / `combined-filter` ranks against the baseline
      for dilution.
- [x] **6. Are.na write-back.** Code complete and tested; the apply run is handed off — see
      [handoff worksheet](./history/worksheets/worksheet-vision-backfill-handoff.md#are-na-write-back).
      `ArenaClient.updateBlock`, `ownerId` threaded from the Are.na payload through `ArchiveBlock`,
      [`vision/titles.ts`](../src/lib/server/indexing/vision/titles.ts) implementing
      `lowQualityTitleReason` with its four triggers, and
      [`vision/writeback.ts`](../src/lib/server/indexing/vision/writeback.ts) planning and applying
      per-block updates with `metadata.vision_v` / `vision_at` / `vision_src`. Block type is not
      part of the decision (ADR amendment); a description is written only when empty. Writes are
      paced, not parallelised. `--push-arena` prints a diff, `--push-arena-apply` writes,
      `--push-arena-limit=N` stages it. 370 tests.
      Validated against the live archive: 892 titles would be replaced (782 filename, 89
      boilerplate, 13 opaque, 8 restating their description), 15 added, and a dry run plans
      **609 blocks**. The longest titles it leaves alone are all legitimate.
      Three classifier rules were wrong on first write and were corrected against real titles: a
      bare ` / X` suffix was flagging `Home / X` (a false positive, now dropped),
      `on X (formerly Twitter)` was missed, and a bare URL with no digits was missed.
      **Remaining, for the maintainer:** `bun run sync --push-arena` to review the diff, then
      `--push-arena-apply`, ideally staged with `--push-arena-limit=25` first.
- [x] **7. Product boundary follow-through.** [`prd.md`](./prd.md) and [`AGENTS.md`](../AGENTS.md)
      record the reversed non-goal and point at the ADR; the README documents the whole thing for
      someone running it themselves. The five vision evaluation cases lost their `pending` field
      and now gate the run alongside the original ten. Worksheets archived.

- [x] Repository documentation and fixture reorganization: moved `TODOS.md` and `CHANGELOG.md`
      to `docs/`, archived completed worksheets under `docs/history/worksheets/`, placed ADRs in
      `docs/decisions/`, and added `docs/specs/` for active work. The search-evaluation fixture
      now lives with its CLI consumer in `scripts/fixtures/`; its validation test is colocated in
      `src/lib/server/search/`. See
      [worksheet](./history/worksheets/worksheet-repository-organization.md).
- [x] Testing approach decision: keep one node-based Vitest project. Server-rendered markup
      assertions cover static component contracts; focus, live-region announcement, and reflow
      remain manual browser checks. See [svelte-guidelines.md](./svelte-guidelines.md).
- [x] Slice 4 quality pass: the full check/lint/test/build suite and all ten live evaluation cases
      pass, with a manual browser pass over every fixture URL. Hybrid results are capped after
      deduplication so the UI's result limit and status stay aligned. See
      [worksheet](./history/worksheets/worksheet-quality-suite.md).
- [x] Edge rate limiting and basic error telemetry before public deployment: the shared limiter
      protects both the gallery and API before Turbopuffer, and Cloudflare observability redacts
      query strings while retaining safe structured failure events. See
      [worksheet](./history/worksheets/worksheet-edge-rate-limiting-telemetry.md).
      `f5fefdc`.
- [x] Slice 4 channel manifest: `bun run sync` now writes every owned channel it discovers to
      `src/lib/server/indexing/channel-manifest.json`, bundled at build time (no request-time
      Are.na call). The gallery's "Channel" filter lists every channel in the archive instead of
      only ones present in current results. See
      [worksheet](./history/worksheets/worksheet-channel-manifest.md).
- [x] Slice 4 image metadata: index `image.alt_text`/`width`/`height` (from `image.large`, matching
      the version `imageUrl` already uses), thread them through to `ResultCard` (real `alt` text
      when Are.na has it, real intrinsic dimensions replacing the fixed 4:3 crop when it doesn't),
      and re-sync. See [worksheet](./history/worksheets/worksheet-image-metadata-indexing.md).
- [x] Slice 4 about surface: `/about` page with concise notes on where the archive comes from, how
      the four search modes work, and how the app is built, linked from the home page. See
      [worksheet](./history/worksheets/worksheet-about-surface.md).
- [x] Slice 3 gallery surface: URL-backed search-first home page, result cards, loading/no-result/invalid/unavailable states, and the shared `executeArchiveSearch` seam behind both the page and `/api/search`. See [worksheet](./history/worksheets/worksheet-gallery-surface.md).
- [x] Slice 2 search API and evaluation: `SearchRepository`, `/api/search`, four retrieval modes, V1 filters, public evaluation fixture, and focused tests. See [worksheet](./history/worksheets/worksheet-search-api.md).
- [x] Typed Are.na V3 page client with rate-limit-aware pagination (`src/lib/server/arena/`). `e60ec40`. See [worksheet](./history/worksheets/worksheet-arena-page-client.md).
- [x] `toSearchDocument` normalizer covering all supported block shapes, with tests. `39cce35`. See [worksheet](./history/worksheets/worksheet-arena-block-normalizer.md).
- [x] Prune stale documents on every `bun run sync`: after the upsert, delete namespace ids not in the synced set (skipped when a channel failed, and above a 50% safety limit unless `--allow-large-prune`).
- [x] Channel ignore list (`ARENA_IGNORE_CHANNELS`) and private-channel allow list (`ARENA_ALLOW_PRIVATE_CHANNELS`); private channels are skipped by default.
- [x] Manual `bun run sync` command that discovers and syncs every channel the maintainer's Are.na account owns. `ec7a0b9`. See [worksheet](./history/worksheets/worksheet-sync-command.md).
- [x] Turbopuffer schema creation (`search_text` full-text + native embed, per `docs/architecture.md`) and batch upsert. `97601ad`. See [worksheet](./history/worksheets/worksheet-turbopuffer-upsert.md).
- [x] Verify a known block round-trips via a direct SDK query (Embed + filename-only Attachment spot-checked against Are.na's own UI — no bug found). See [worksheet](./history/worksheets/worksheet-roundtrip-verification.md).

## Needs Input

- [ ] `channel-manifest.json` ships empty (`[]`) — the channel filter won't appear until the
      maintainer runs a real `bun run sync`. That writes to the live Turbopuffer namespace and
      authenticates against the maintainer's own Are.na account, so it wasn't run as part of the
      channel-manifest task without their go-ahead (see
      [worksheet](./history/worksheets/worksheet-channel-manifest.md#deliberately-not-done-running-the-real-sync)).
      [AGENT NOTE: run `bun run sync` (or approve running it) to populate the manifest for real.]

## Backlog — Vision indexing phase 2 (only after phase 1 has shipped and been measured)

- **GIF handling — video input.** Owns both halves of the GIF problem, and phase 1 leaves real work
  here:
  1. **43 blocks are unprocessed.** Phase 1's size guard skips any non-resizable image over 5 MB.
     Measured across all 134 GIFs: median 2.70 MB, p90 11.23 MB, max 24.15 MB, 615 MB total. Are.na
     publishes no smaller rendition — `thumb`, `square`, `small`, `medium` and `large` are all the
     same CloudFront URL — so there is nothing to shrink without decoding locally.
  2. **The other 91 are described from a single frame**, which is the wrong reading of an animation.
     `xiaomi/mimo-v2.5` takes video as a native input modality (`text+image+audio+video`), so sending
     these as a video part rather than an image part fixes both: motion, pacing and loop structure
     become visible, and the video path may carry a different size ceiling than the 5 MB image one.
     Confirm the pinned providers accept video, re-check the ceiling against the 24 MB worst case, and
     decide then whether a local transcode (a native image dependency for a handful of blocks) is
     still needed. Bump `PROMPT_VERSION` or scope the revision so only these 134 regenerate, not the
     whole archive. Audio is explicitly out of scope. The 46 Embed blocks stay thumbnail-only
     regardless: they are YouTube/Vimeo links, not files the pipeline can hand over.
- **Index `vision_tags`.** Tags are generated and cached on every block already but reach neither
  Turbopuffer nor `search_text`, which was an oversight in the spec rather than a decision.
  Measured over the 2,526 cached entries: **44% of tags (7,992 of 18,143) contain wording that
  appears nowhere else in the indexed text** — `cyberpunk`, `dark mode`, `typography`,
  `web design`, `user interface`. That is search vocabulary being thrown away.
  Costs **nothing to generate**: the values are in `vision-cache.jsonl`, so no `PROMPT_VERSION`
  bump and no OpenRouter spend. Add a `vision_tags` `[]string` attribute (filterable, for a future
  tag facet), fold it into `search_text`, and re-upsert. Re-run `evaluate:search` afterwards and
  compare against the baseline — eight short tags is far less text than a 500-character
  description, so dilution risk is low, but it is not zero and the baseline exists for this.

- **Colour search via `vision_palette`.** Viable, and worth doing after tags. The model already
  returns 3-5 dominant colours per block as hex, cached and otherwise unused.
  The design constraint to solve first: Turbopuffer string filters are exact-match, so
  `#b494e4` cannot match "a slightly different purple". Storing raw hex alone gives you nothing.
  The workable shape is to **quantize at index time**: map each palette entry to a coarse bucket
  (a dozen or so hue names plus black/white/grey, with saturation and lightness bands where it
  matters) and store those as a filterable `[]string` alongside the raw hex. A colour picker then
  resolves the chosen colour to its bucket and queries that bucket plus its neighbours, which is
  what "or closely related colours" means in practice.
  Keep the raw hex too — it is what lets you re-bucket later without regenerating anything, and
  what a swatch strip on a result card would render.
  Unresolved before building: how many buckets before neighbouring ones stop feeling distinct;
  whether a block should match on any palette entry or only a dominant one; and whether the picker
  belongs in the existing filter row or somewhere of its own. This is as much a design question as
  an indexing one.
  Nothing here needs the model again: it is an additive attribute, a bucketing function with
  tests, a re-upsert, and UI.

- **Batch/async backfill mode.** A `--vision-batch` path for large regenerations if a prompt
  revision ever makes a full 2,585-block re-run routine.
- **trigger.dev**, if sync moves off the maintainer's machine. Revisit only when there is an
  unattended or scheduled run to make durable — see the ADR for why it is not phase 1.
- **`vision_medium` as a UI facet**, if the generated values cluster usefully.
- **A separate embedded field** for generated text, if phase-1 measurement shows it dilutes
  retrieval for the 1,494 Link blocks that already have good human descriptions.
- **Native PDF input** for the 50 Attachment blocks, instead of describing Are.na's preview image.

## Backlog — V2 (only after V1 is stable)

- Add Mastra and one `archive-research` agent.
- Wrap V1 retrieval in the read-only `search_archive` tool.
- Stream responses with block citations; cap retrieval calls at three.
- Add an agent evaluation set for groundedness and citation coverage.

Do not start V2 items until the human explicitly starts the V2 milestone — see the Product boundary in [`AGENTS.md`](./AGENTS.md).
