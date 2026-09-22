# TODOs

Task backlog and work-in-progress tracking. See
[`workflows/agent-loop.md`](./workflows/agent-loop.md) for how to work this list.

Seeded from [`implementation_plan.md`](./implementation_plan.md) — vertical slices, smallest first.
Keep this list current: move items between sections as you work, don't let it drift from reality.

**Status marks:** `[ ]` not started · `[~]` code complete, waiting on a run only the maintainer can
do · `[x]` finished.

---

## In Progress

### Generated tags in the index

> **Waiting on:** one more `bun run sync`, then `bun run evaluate:search`.
> Tags shipped and were measured: all 15 cases passed, but `semantic-material` fell from `@2 of 25`
> to `@11 of 25`, which failed the bar. The cause was tag vocabulary split by hyphenation; the fix
> is in and needs a re-upsert to take effect. Full diagnosis in
> [`worksheet-vision-eval-baseline.md`](./history/worksheets/worksheet-vision-eval-baseline.md).

Tags were generated and cached for every block from the start but reached neither Turbopuffer nor
`search_text` — an oversight in the spec rather than a decision. They now go into both: a
filterable `[]string` attribute for a future tag facet, and the tail of `search_text`.

- [x] Fold `vision_tags` into `search_text`, last in the composition, and add the filterable
      attribute. Nothing reads it back yet, so it cannot trip the `include_attributes` 400 that
      video playback hit.
- [x] Lowercase, deduplicate and sort, so a facet treats `UI` and `ui` as one value and an unchanged
      block re-upserts byte-identically.
- [x] Record a second evaluation baseline — all 15 cases green, with ranks — in
      [`worksheet-vision-eval-baseline.md`](./history/worksheets/worksheet-vision-eval-baseline.md).
- [x] Synced and re-evaluated. The two cases predicted to be at risk — `exact-phrase-link` and
      `combined-filter`, Link blocks with real human descriptions — held their rank exactly. The
      regression landed somewhere the prediction did not look.
- [x] Collapse hyphens in tag normalization, in the attribute as well as the embedded text, so a
      facet cannot filter on a value the index never wrote. 153 distinct tags merge away; the
      `semantic-material` target's three orphans join groups 10x, 12x and 16x larger.
- [ ] **For the maintainer:** re-sync and re-evaluate. The bar is `semantic-material` recovering
      materially from `@11 of 25`, and nothing else regressing. This does nothing for
      `vision-widget-grid` (`dark theme` against `dark mode` is synonymy, not spelling), so `@16` is
      expected to stay roughly where it is.

**Why it is worth the re-embed.** Measured over a 596-block sample of the live index: 2,273 of
4,298 tag instances (53%) use wording found nowhere else in that block's indexed text, and 99% of
blocks gain some. The cost is 10% more text — 86 characters against a median `search_text` of 890.

---

## Up Next

_Nothing queued. Pick from the backlog below._

---

## Backlog

### Vision indexing — phase 2

- **Batch/async backfill mode.** A `--vision-batch` path for large regenerations, if a prompt
  revision ever makes a full 2,585-block re-run routine.
- **trigger.dev**, if sync moves off the maintainer's machine. Revisit only when there is an
  unattended or scheduled run to make durable — see the ADR for why it is not phase 1.
- **`vision_medium` as a UI facet**, if the generated values cluster usefully. Measure first: a
  grainy photograph came back labelled `painting`.
- **A separate embedded field** for generated text, if measurement shows it dilutes retrieval for
  the Link blocks that already have good human descriptions.
- **Native PDF input** for the seven PDF attachments, instead of describing Are.na's preview image.

### V2 — agents

> Do not start these until the human explicitly starts the V2 milestone — see the Product boundary
> in [`AGENTS.md`](../AGENTS.md).

- Add Mastra and one `archive-research` agent.
- Wrap V1 retrieval in the read-only `search_archive` tool.
- Stream responses with block citations; cap retrieval calls at three.
- Add an agent evaluation set for groundedness and citation coverage.

### V3 — colour

- **Colour search via `vision_palette`.** The model already returns 3–5 dominant colours per block
  as hex, cached and otherwise unused. A colour picker resolves the chosen colour to a bucket and
  queries that bucket plus its neighbours, which is what "or closely related colours" means in
  practice.

  _The design constraint to solve first:_ Turbopuffer string filters are exact-match, so `#b494e4`
  cannot match "a slightly different purple". Storing raw hex alone gives you nothing. The workable
  shape is to **quantize at index time** — map each palette entry to a coarse bucket (a dozen or so
  hue names plus black/white/grey, with saturation and lightness bands where it matters) and store
  those as a filterable `[]string` alongside the raw hex. Keep the raw hex too: it is what lets you
  re-bucket later without regenerating anything, and what a swatch strip on a result card would
  render.

  _Unresolved before building:_ how many buckets before neighbouring ones stop feeling distinct;
  whether a block should match on any palette entry or only a dominant one; and whether the picker
  belongs in the existing filter row or somewhere of its own. This is as much a design question as
  an indexing one — see [`design.md`](./design.md).

  Nothing here needs the model again: an additive attribute, a bucketing function with tests, a
  re-upsert, and UI.

---

## Done

_Newest first._

### Video playback in the gallery

Video attachments play in the gallery instead of showing a still — muted, looping, inline, with the
block's own thumbnail as the poster so a card looks identical before the first frame paints.

- [x] **Verified live after the sync: 40 of the 52 attachments carry a playable video**, and 20
      render on one filtered page. That is three times the pre-build estimate of ~13, which came
      from matching filenames — low because the Are.na write-back had already retitled most of them.
- [x] Playback is driven by an `IntersectionObserver` attachment rather than the `autoplay`
      attribute: with `autoplay`, every card below the fold starts decoding on mount and is only
      paused afterwards, and the `prefers-reduced-motion` check has to win a race it does not
      reliably win. Reduced motion keeps the poster frame.
- [x] No controls at all — the whole card is a link to Are.na, and a control strip inside it would
      fight every click.
- [x] `muted` is asserted in the SSR markup, not just set on the client: an unmuted video is not
      allowed to autoplay, and a missing attribute would make the first paint wrong before any
      script runs. That is the one failure here that would only ever appear in production.
- [x] **The new attributes are requested optionally.** Turbopuffer rejects an entire query with a
      400 when `include_attributes` names an attribute the namespace has never been written, so
      asking for `video_url` before the re-sync would have taken search down completely rather than
      costing one feature. Caught by running the real gallery against the live namespace, where it
      did exactly that.

### Sync progress you can actually read

`bun run sync` keeps a redrawn status region pinned below the log instead of only appending to it.

- [x] Three separate times during the vision work a healthy run was reasonably mistaken for a hung
      one: progress fired only every 25 completions, so a 2,090-block run sat on `2075/2090` in
      silence while its tail finished; the same fixed interval meant a 12-block run printed nothing
      at all until it was done; and a genuinely stalled socket looked identical to slow work,
      because nothing reported what was in flight.
- [x] The region answers "what is happening, and is it healthy?" at any instant: phase and position
      (`fetching 42/74`, `describing 180/2569`, `upserting 3/13`), what is in flight this second
      (`1 transcoding · 31 awaiting model · oldest 1m 24s`, the oldest wait turning amber past two
      minutes), a rate and projection measured over the run rather than extrapolated from one
      sample, and running totals coloured by outcome — generated green, skipped amber, failed red.
      It says `measuring rate` rather than quoting a number from fewer than five completions.
- [x] Presentation moved out of the pipeline. `describeBlocks` and `syncArchive` emit structured
      events (`progress/events.ts`); `SyncProgress` folds them into a snapshot and `formatSnapshot`
      turns that into lines, both pure and directly tested. The renderer degrades to line-based
      progress when stdout is not a TTY or `NO_COLOR` is set, writes escape codes directly rather
      than taking a dependency, clamps every line to the terminal width so a wrap cannot break the
      redraw, restores the cursor on `SIGINT`, and tears the region down before the final summary so
      it stays copyable.
- [x] Timeouts capped at two attempts rather than sharing the retry budget of four. Three blocks
      timed out on five attempts out of five at four minutes each, holding a worker for twenty
      minutes after everything else had finished. Failures worth retrying keep the full budget.

### GIF handling — video input

Animated blocks (134, all `image/gif`, all non-resizable) are downloaded, transcoded locally to a
small MP4 with ffmpeg, and sent as a `video_url` part.

- [x] Fixes both halves at once: the 43 skipped for exceeding the 5 MB image ceiling now fit — a
      24.2 MB GIF becomes 145 KB in ~0.5s — and the other 91 are read as motion rather than a single
      frame. A description like "a man running in a park while various data metrics dynamically
      appear and update" is not something one frame can say.
- [x] `input_mode` joins the cache entry and the skip key, so only these 134 regenerated rather than
      all 2,526. ffmpeg is required and failure names it; `--no-vision-video` falls back to stills.
- [x] Cost ~2x an image call, so ~$0.07 for all 134. **Backfill complete: 135 cached entries now
      carry `input_mode: video`.**
- [x] Fixed along the way: odd source widths broke libx264 at yuv420p (`-2` only forces the height
      even), and the stale-scratch sweep needed an age threshold so two concurrent runs could not
      delete each other's in-flight files.

### Vision indexing — phase 1

Generate visual descriptions for the blocks with an image and fold them into retrieval.
Spec: [`specs/spec-vision-indexing.md`](./specs/spec-vision-indexing.md) ·
Decision: [`decisions/adr-vision-indexing.md`](./decisions/adr-vision-indexing.md).

- [x] **1. Baseline the search evaluation.** The evaluation was red before this work started (3
      cases stranded past the 24-result limit by the browse-ordering change, 1 expecting a block
      that pruning had removed). Repaired those 4 to be ordering-independent, added rank reporting
      so dilution is visible, added a `pending` field so target cases can be recorded without
      holding the gate red, and added 5 pending vision cases grounded in the actual images.
      [Worksheet](./history/worksheets/worksheet-vision-eval-baseline.md).
- [x] **2. Rendition and cache primitives.**
      [`vision/rendition.ts`](../src/lib/server/indexing/vision/rendition.ts) (payload
      decode/rewrite/re-encode, source-key extraction, SHA-256; passes non-resizer URLs through
      untouched) and [`vision/cache.ts`](../src/lib/server/indexing/vision/cache.ts) (JSONL
      parse/serialize with fixed key order, the skip rule, and a merge that keeps entries for blocks
      skipped this run while dropping ones that left the archive). The rendition rewrite verified
      against live Are.na, 10 of 10 at HTTP 200 and ~70% smaller.
- [x] **3. OpenRouter client.**
      [`vision/prompt.ts`](../src/lib/server/indexing/vision/prompt.ts) (`PROMPT_VERSION`, system
      prompt, strict JSON schema, fenced untrusted-context builder) and
      [`vision/client.ts`](../src/lib/server/indexing/vision/client.ts) (`xiaomi/mimo-v2.5`,
      `require_parameters: true` with an explicit provider order, reasoning disabled, Zod validation
      at the boundary, and rejection of a title that echoes the supplied one). `fetch` + Zod, no new
      dependency. `image.file_size` and `content_type` carried through `ArchiveBlock` so the size
      guard costs no network call.
- [x] **4. Wire the stage into sync behind `--vision`.**
      [`vision/index.ts`](../src/lib/server/indexing/vision/index.ts) (`describeBlocks`,
      `planVisionWork`, bounded concurrency pool, per-block failures collected not fatal) wired into
      [`sync.ts`](../src/lib/server/indexing/sync.ts) on the deduplicated block set. Without
      `--vision`, sync behaves exactly as before.
      Two findings carried forward: the model overruns the description cap (a first call came back
      640 chars), so the client clamps at a sentence boundary; and `medium` is the least reliable
      field — a grainy photograph was labelled `painting`.
- [x] **5. Schema, `search_text`, and the full backfill.** Four additive `vision_*` attributes (no
      namespace bump); `toSearchDocument(block, vision?)` folding `vision_description` and
      `vision_ocr` into `search_text` after the block's own metadata; retry with exponential backoff
      on 429/5xx honouring `Retry-After`; cache checkpointing every 25 entries so a multi-hour run
      survives interruption.
      Fixed along the way: sync now indexes the vision cache on **every** run, not only with
      `--vision`. Previously a plain `bun run sync` after the backfill would have silently stripped
      every generated description back out of the namespace.
      **Backfill complete:** 2,526 of 2,576 blocks with an image carry a generated description; all
      five pending evaluation cases pass, four at rank 1.
- [x] **6. Are.na write-back.** `ArenaClient.updateBlock`, `ownerId` threaded from the Are.na
      payload through `ArchiveBlock`,
      [`vision/titles.ts`](../src/lib/server/indexing/vision/titles.ts) implementing
      `lowQualityTitleReason` with its four triggers, and
      [`vision/writeback.ts`](../src/lib/server/indexing/vision/writeback.ts) planning and applying
      per-block updates with `metadata.vision_v` / `vision_at` / `vision_src`. Block type is not
      part of the decision (ADR amendment); a description is written only when empty. Writes are
      paced, not parallelised.
      Three classifier rules were wrong on first write and were corrected against real titles: a
      bare ` / X` suffix was flagging `Home / X`, a false positive that was dropped; the suffix
      `on X (formerly Twitter)` was missed; and a bare URL with no digits was missed.
      **Apply complete:** 609 blocks written across three runs. A rate-limit bug cost 171 writes on
      the second run — pacing was 300ms against a documented 120/min — and they were recovered on
      the third.
- [x] **7. Product boundary follow-through.** [`prd.md`](./prd.md) and [`AGENTS.md`](../AGENTS.md)
      record the reversed non-goal and point at the ADR; the README documents the whole thing for
      someone running it themselves. The five vision evaluation cases lost their `pending` field and
      now gate the run alongside the original ten.

### Earlier slices

- [x] Repository documentation and fixture reorganization: `TODOS.md` and `CHANGELOG.md` moved to
      `docs/`, completed worksheets archived under `docs/history/worksheets/`, ADRs in
      `docs/decisions/`, `docs/specs/` added for active work. The search-evaluation fixture now
      lives with its CLI consumer in `scripts/fixtures/`.
      [Worksheet](./history/worksheets/worksheet-repository-organization.md).
- [x] Testing approach decision: keep one node-based Vitest project. Server-rendered markup
      assertions cover static component contracts; focus, live-region announcement and reflow remain
      manual browser checks. See [`svelte-guidelines.md`](./svelte-guidelines.md).
- [x] Slice 4 quality pass: the full check/lint/test/build suite and all ten live evaluation cases
      pass, with a manual browser pass over every fixture URL. Hybrid results are capped after
      deduplication so the UI's result limit and status stay aligned.
      [Worksheet](./history/worksheets/worksheet-quality-suite.md).
- [x] Edge rate limiting and basic error telemetry before public deployment: the shared limiter
      protects both the gallery and API before Turbopuffer, and Cloudflare observability redacts
      query strings while retaining safe structured failure events. `f5fefdc`.
      [Worksheet](./history/worksheets/worksheet-edge-rate-limiting-telemetry.md).
- [x] Slice 4 channel manifest: `bun run sync` writes every owned channel it discovers to
      `src/lib/server/indexing/channel-manifest.json`, bundled at build time (no request-time Are.na
      call). The gallery's Channel filter lists every channel in the archive instead of only the
      ones present in current results.
      [Worksheet](./history/worksheets/worksheet-channel-manifest.md).
- [x] Slice 4 image metadata: index `image.alt_text`/`width`/`height` (from `image.large`, matching
      the version `imageUrl` already uses) and thread them through to `ResultCard` — real `alt` text
      when Are.na has it, real intrinsic dimensions replacing the fixed 4:3 crop when it doesn't.
      [Worksheet](./history/worksheets/worksheet-image-metadata-indexing.md).
- [x] Slice 4 about surface: `/about` page with notes on where the archive comes from, how the four
      search modes work, and how the app is built. _(Since removed.)_
      [Worksheet](./history/worksheets/worksheet-about-surface.md).
- [x] Slice 3 gallery surface: URL-backed search-first home page, result cards,
      loading/no-result/invalid/unavailable states, and the shared `executeArchiveSearch` seam behind
      both the page and `/api/search`.
      [Worksheet](./history/worksheets/worksheet-gallery-surface.md).
- [x] Slice 2 search API and evaluation: `SearchRepository`, `/api/search`, four retrieval modes, V1
      filters, public evaluation fixture, and focused tests.
      [Worksheet](./history/worksheets/worksheet-search-api.md).
- [x] Typed Are.na V3 page client with rate-limit-aware pagination (`src/lib/server/arena/`).
      `e60ec40`. [Worksheet](./history/worksheets/worksheet-arena-page-client.md).
- [x] `toSearchDocument` normalizer covering all supported block shapes, with tests. `39cce35`.
      [Worksheet](./history/worksheets/worksheet-arena-block-normalizer.md).
- [x] Prune stale documents on every `bun run sync`: after the upsert, delete namespace ids not in
      the synced set (skipped when a channel failed, and above a 50% safety limit unless
      `--allow-large-prune`).
- [x] Channel ignore list (`ARENA_IGNORE_CHANNELS`) and private-channel allow list
      (`ARENA_ALLOW_PRIVATE_CHANNELS`); private channels are skipped by default.
- [x] Manual `bun run sync` command that discovers and syncs every channel the maintainer's Are.na
      account owns. `ec7a0b9`. [Worksheet](./history/worksheets/worksheet-sync-command.md).
- [x] Turbopuffer schema creation (`search_text` full-text + native embed, per
      [`architecture.md`](./architecture.md)) and batch upsert. `97601ad`.
      [Worksheet](./history/worksheets/worksheet-turbopuffer-upsert.md).
- [x] Verify a known block round-trips via a direct SDK query (Embed and filename-only Attachment
      spot-checked against Are.na's own UI — no bug found).
      [Worksheet](./history/worksheets/worksheet-roundtrip-verification.md).
