# TODOs

Task backlog and work-in-progress tracking. See [`workflows/agent-loop.md`](./workflows/agent-loop.md) for how to work this list.

Seeded from [`implementation_plan.md`](./implementation_plan.md) — vertical slices, smallest first. Keep this list current: move items between sections as you work, don't let it drift from reality.

## Up Next

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
      [worksheet](./specs/worksheet-vision-eval-baseline.md).
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
- [ ] **4. Wire the stage into sync behind `--vision`.** `describeBlocks()` between normalization
      and `toSearchDocument`, concurrency 8, per-block failures recorded not fatal. Add
      `--vision-dry-run`, `--vision-limit=N`, `--revision[=<slug>]` and the new summary lines.
      Verify with `--vision-limit=25` and read all 25 outputs by hand before going further.
- [ ] **5. Schema, `search_text`, and the full backfill.** Add `vision_description`, `vision_ocr`,
      `vision_title`, `vision_medium` to the Turbopuffer schema (additive — no namespace bump);
      extend `toSearchDocument`; run the full backfill (≈ $0.49); commit
      `src/lib/server/indexing/vision-cache.jsonl`. Re-run `evaluate:search` and compare against
      the step-1 baseline. If retrieval regressed for Link blocks, tighten the length cap or move
      to a separate embedded field before continuing. Update the schema table and sync lifecycle in
      [`architecture.md`](./architecture.md) in the same change.
- [ ] **6. Are.na write-back.** `ArenaClient.updateBlock`, ownership filter
      (`block.user.id === me.id` — only 2,050 of 2,594 blocks qualify), and
      `vision/titles.ts` implementing `isLowQualityTitle` with its four triggers — filename-shaped
      (783), opaque token (308), social boilerplate (116), and verbose-and-redundant (70), the last
      being the `… on X: "…" / X` case where the title is platform chrome wrapped around a copy of
      the description. 939 processable blocks are flagged, plus 16 untitled. Block type is **not**
      part of the decision (see the ADR amendment); Link and Attachment blocks are in scope now.
      Unit-test both directions against the real corpus samples listed in the spec — false
      negatives are fine, false positives are not. `description` is still only written when empty.
      `--push-arena` prints a diff; `--push-arena-apply` writes.
      Also sets `metadata.vision_v` / `vision_at` / `vision_src`. Note this bumps `updated_at` on
      2,050 blocks and will show up in the maintainer's Are.na activity — stage it with
      `--vision-limit`.
- [ ] **7. Product boundary follow-through.** Confirm [`prd.md`](./prd.md) and
      [`AGENTS.md`](../AGENTS.md) reflect what actually shipped, and move this group to Done with
      its worksheet archived to [`history/worksheets/`](./history/worksheets/).

## In Progress

_(none)_

## Done

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

- **Video input for animated GIFs.** `xiaomi/mimo-v2.5` accepts video as a native input modality
  (`text+image+audio+video`), so the 134 animated GIFs currently described from their first frame
  could be understood as motion instead — pacing, loop structure, what actually changes between
  frames. Send the GIF as a video part rather than an image part, confirm the pinned providers
  accept it, and bump `PROMPT_VERSION` so only those 134 blocks regenerate. Audio is explicitly
  out of scope. The 46 Embed blocks stay thumbnail-only regardless: they are YouTube/Vimeo links,
  not files the pipeline can hand over.
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
