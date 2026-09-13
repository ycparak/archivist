# TODOs

Task backlog and work-in-progress tracking. See [`docs/workflows/agent-loop.md`](./docs/workflows/agent-loop.md) for how to work this list.

Seeded from [`docs/implementation_plan.md`](./docs/implementation_plan.md) — vertical slices, smallest first. Keep this list current: move items between sections as you work, don't let it drift from reality.

## Up Next

### Slice 4 — portfolio polish

- [ ] Consider a second vitest project (`jsdom` + `@testing-library/svelte`) for interactive
      component behavior. `vite.config.ts` already reserves the slot by excluding
      `src/**/*.svelte.spec.ts` from the node project. Server-rendered markup assertions
      (`src/lib/components/markup.ssr.spec.ts`) cover the static contract today; focus, live-region
      announcement, and reflow remain manual.

## In Progress

_(none)_

## Done

- [x] Slice 4 quality pass: the full check/lint/test/build suite and all ten live evaluation cases
      pass, with a manual browser pass over every fixture URL. Hybrid results are capped after
      deduplication so the UI's result limit and status stay aligned. See
      [SPECs/worksheet-quality-suite.md](./SPECs/worksheet-quality-suite.md).
- [x] Edge rate limiting and basic error telemetry before public deployment: the shared limiter
      protects both the gallery and API before Turbopuffer, and Cloudflare observability redacts
      query strings while retaining safe structured failure events. See
      [SPECs/worksheet-edge-rate-limiting-telemetry.md](./SPECs/worksheet-edge-rate-limiting-telemetry.md).
      `f5fefdc`.
- [x] Slice 4 channel manifest: `bun run sync` now writes every owned channel it discovers to
      `src/lib/server/indexing/channel-manifest.json`, bundled at build time (no request-time
      Are.na call). The gallery's "Channel" filter lists every channel in the archive instead of
      only ones present in current results. See
      [SPECs/worksheet-channel-manifest.md](./SPECs/worksheet-channel-manifest.md).
- [x] Slice 4 image metadata: index `image.alt_text`/`width`/`height` (from `image.large`, matching
      the version `imageUrl` already uses), thread them through to `ResultCard` (real `alt` text
      when Are.na has it, real intrinsic dimensions replacing the fixed 4:3 crop when it doesn't),
      and re-sync. See [SPECs/worksheet-image-metadata-indexing.md](./SPECs/worksheet-image-metadata-indexing.md).
- [x] Slice 4 about surface: `/about` page with concise notes on where the archive comes from, how
      the four search modes work, and how the app is built, linked from the home page. See
      [SPECs/worksheet-about-surface.md](./SPECs/worksheet-about-surface.md).
- [x] Slice 3 gallery surface: URL-backed search-first home page, result cards, loading/no-result/invalid/unavailable states, and the shared `executeArchiveSearch` seam behind both the page and `/api/search`. See [SPECs/worksheet-gallery-surface.md](./SPECs/worksheet-gallery-surface.md).
- [x] Slice 2 search API and evaluation: `SearchRepository`, `/api/search`, four retrieval modes, V1 filters, public evaluation fixture, and focused tests. See [SPECs/worksheet-search-api.md](./SPECs/worksheet-search-api.md).
- [x] Typed Are.na V3 page client with rate-limit-aware pagination (`src/lib/server/arena/`). `e60ec40`. See [SPECs/worksheet-arena-page-client.md](./SPECs/worksheet-arena-page-client.md).
- [x] `toSearchDocument` normalizer covering all supported block shapes, with tests. `39cce35`. See [SPECs/worksheet-arena-block-normalizer.md](./SPECs/worksheet-arena-block-normalizer.md).
- [x] Manual `bun run sync` command that discovers and syncs every channel the maintainer's Are.na account owns. `ec7a0b9`. See [SPECs/worksheet-sync-command.md](./SPECs/worksheet-sync-command.md).
- [x] Turbopuffer schema creation (`search_text` full-text + native embed, per `docs/architecture.md`) and batch upsert. `97601ad`. See [SPECs/worksheet-turbopuffer-upsert.md](./SPECs/worksheet-turbopuffer-upsert.md).
- [x] Verify a known block round-trips via a direct SDK query (Embed + filename-only Attachment spot-checked against Are.na's own UI — no bug found). See [SPECs/worksheet-roundtrip-verification.md](./SPECs/worksheet-roundtrip-verification.md).

## Needs Input

- [ ] `channel-manifest.json` ships empty (`[]`) — the channel filter won't appear until the
      maintainer runs a real `bun run sync`. That writes to the live Turbopuffer namespace and
      authenticates against the maintainer's own Are.na account, so it wasn't run as part of the
      channel-manifest task without their go-ahead (see
      [SPECs/worksheet-channel-manifest.md](./SPECs/worksheet-channel-manifest.md#deliberately-not-done-running-the-real-sync)).
      [AGENT NOTE: run `bun run sync` (or approve running it) to populate the manifest for real.]

## Backlog — V2 (only after V1 is stable)

- Add Mastra and one `archive-research` agent.
- Wrap V1 retrieval in the read-only `search_archive` tool.
- Stream responses with block citations; cap retrieval calls at three.
- Add an agent evaluation set for groundedness and citation coverage.

Do not start V2 items until the human explicitly starts the V2 milestone — see the Product boundary in [`AGENTS.md`](./AGENTS.md).
