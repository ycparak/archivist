# TODOs

Task backlog and work-in-progress tracking. See [`docs/workflows/agent-loop.md`](./docs/workflows/agent-loop.md) for how to work this list.

Seeded from [`docs/IMPLEMENTATION_PLAN.md`](./docs/IMPLEMENTATION_PLAN.md) — vertical slices, smallest first. Keep this list current: move items between sections as you work, don't let it drift from reality.

## Up Next

### Slice 1 — ingest one real channel

- [ ] Typed Are.na V3 page client with rate-limit-aware pagination (`src/lib/server/arena/`).
- [ ] `toSearchDocument` normalizer covering all supported block shapes, with tests.
- [ ] Manual `bun run sync` command for configured `ARENA_CHANNEL_SLUGS`.
- [ ] Turbopuffer schema creation (`search_text` full-text + native embed, per `docs/ARCHITECTURE.md`) and batch upsert.
- [ ] Verify a known block round-trips via a direct SDK query.

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

_(none yet — project is pre-V1)_

## Needs Input

_(none)_

## Backlog — V2 (only after V1 is stable)

- Add Mastra and one `archive-research` agent.
- Wrap V1 retrieval in the read-only `search_archive` tool.
- Stream responses with block citations; cap retrieval calls at three.
- Add an agent evaluation set for groundedness and citation coverage.

Do not start V2 items until the human explicitly starts the V2 milestone — see the Product boundary in [`AGENTS.md`](./AGENTS.md).
