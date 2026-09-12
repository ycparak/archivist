# TODOs

Task backlog and work-in-progress tracking. See [`docs/workflows/agent-loop.md`](./docs/workflows/agent-loop.md) for how to work this list.

Seeded from [`docs/implementation_plan.md`](./docs/implementation_plan.md) — vertical slices, smallest first. Keep this list current: move items between sections as you work, don't let it drift from reality.

## Up Next

### Slice 1 — ingest one real channel

- [ ] Turbopuffer schema creation (`search_text` full-text + native embed, per `docs/architecture.md`) and batch upsert.
- [ ] Verify a known block round-trips via a direct SDK query. Include an Embed and a filename-only Attachment block in the spot-check — confirm `toArchiveBlock`'s title fallback (`SPECs/worksheet-arena-block-normalizer.md`) matches what Are.na's own UI shows for those blocks; it's only been verified against hand-built fixtures so far.

### Slice 2 — search API and evaluation

- [ ] `SearchRepository` and `/api/search` (`src/lib/server/search/`).
- [ ] Browse, lexical, semantic, hybrid modes; the three V1 filters (`block_type`, `channel_slugs`, `connected_at`).
- [ ] Committed, non-private `tests/fixtures/search-cases.json` with ten query expectations.
- [ ] Tests for request parsing, filter construction, document mapping, mode selection.

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

- [x] Typed Are.na V3 page client with rate-limit-aware pagination (`src/lib/server/arena/`). `e60ec40`. See [SPECs/worksheet-arena-page-client.md](./SPECs/worksheet-arena-page-client.md).
- [x] `toSearchDocument` normalizer covering all supported block shapes, with tests. `39cce35`. See [SPECs/worksheet-arena-block-normalizer.md](./SPECs/worksheet-arena-block-normalizer.md).
- [x] Manual `bun run sync` command that discovers and syncs every channel the maintainer's Are.na account owns. See [SPECs/worksheet-sync-command.md](./SPECs/worksheet-sync-command.md).

## Needs Input

_(none)_

## Backlog — V2 (only after V1 is stable)

- Add Mastra and one `archive-research` agent.
- Wrap V1 retrieval in the read-only `search_archive` tool.
- Stream responses with block citations; cap retrieval calls at three.
- Add an agent evaluation set for groundedness and citation coverage.

Do not start V2 items until the human explicitly starts the V2 milestone — see the Product boundary in [`AGENTS.md`](./AGENTS.md).
