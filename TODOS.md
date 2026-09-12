# TODOs

Task backlog and work-in-progress tracking. See [`docs/workflows/agent-loop.md`](./docs/workflows/agent-loop.md) for how to work this list.

Seeded from [`docs/implementation_plan.md`](./docs/implementation_plan.md) — vertical slices, smallest first. Keep this list current: move items between sections as you work, don't let it drift from reality.

## Up Next

### Slice 3 — gallery surface

- [ ] Search-first home page with URL-backed state (`?q=&mode=&channel=&type=&from=&to=`).
- [ ] Responsive result cards, loading, no-result, and unavailable-service states.
- [ ] Safe image dimensions/alt behavior; links go to the original Are.na block.
- [ ] Keyboard behavior and narrow-screen layout confirmed.

### Slice 4 — portfolio polish

- [ ] Concise architecture notes on the product's about surface.
- [ ] Edge rate limiting and basic error telemetry before public deployment.
- [ ] Full quality suite (`bun run check && bun run lint && bun run test && bun run build`) and manual pass over the evaluation queries.

## In Progress

_(none)_

## Done

- [x] Slice 2 search API and evaluation: `SearchRepository`, `/api/search`, four retrieval modes, V1 filters, public evaluation fixture, and focused tests. See [SPECs/worksheet-search-api.md](./SPECs/worksheet-search-api.md).
- [x] Typed Are.na V3 page client with rate-limit-aware pagination (`src/lib/server/arena/`). `e60ec40`. See [SPECs/worksheet-arena-page-client.md](./SPECs/worksheet-arena-page-client.md).
- [x] `toSearchDocument` normalizer covering all supported block shapes, with tests. `39cce35`. See [SPECs/worksheet-arena-block-normalizer.md](./SPECs/worksheet-arena-block-normalizer.md).
- [x] Manual `bun run sync` command that discovers and syncs every channel the maintainer's Are.na account owns. `ec7a0b9`. See [SPECs/worksheet-sync-command.md](./SPECs/worksheet-sync-command.md).
- [x] Turbopuffer schema creation (`search_text` full-text + native embed, per `docs/architecture.md`) and batch upsert. `97601ad`. See [SPECs/worksheet-turbopuffer-upsert.md](./SPECs/worksheet-turbopuffer-upsert.md).
- [x] Verify a known block round-trips via a direct SDK query (Embed + filename-only Attachment spot-checked against Are.na's own UI — no bug found). See [SPECs/worksheet-roundtrip-verification.md](./SPECs/worksheet-roundtrip-verification.md).

## Needs Input

_(none)_

## Backlog — V2 (only after V1 is stable)

- Add Mastra and one `archive-research` agent.
- Wrap V1 retrieval in the read-only `search_archive` tool.
- Stream responses with block citations; cap retrieval calls at three.
- Add an agent evaluation set for groundedness and citation coverage.

Do not start V2 items until the human explicitly starts the V2 milestone — see the Product boundary in [`AGENTS.md`](./AGENTS.md).
