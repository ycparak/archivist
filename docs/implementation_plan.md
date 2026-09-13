# First implementation plan

Keep the work in vertical slices. Stop after a slice is usable and reviewable.

## Slice 1 — ingest one real channel

- Implement typed Are.na V3 page client and rate-limit-aware pagination.
- Add `toSearchDocument` and tests for all supported block shapes.
- Add a manual `bun run sync` command for configured channel slugs.
- Create/update the Turbopuffer schema and batch upsert documents.
- Verify a known block can be retrieved with a direct SDK query.

## Slice 2 — search API and evaluation

- Implement `SearchRepository` and `/api/search`.
- Support browse, lexical, semantic, hybrid, and the three V1 filters.
- Add a small committed, non-private `scripts/fixtures/search-cases.json` with ten query expectations.
- Test request parsing, filter construction, document mapping, and mode selection.

## Slice 3 — gallery surface

- Build the search-first home page with URL-backed state.
- Add responsive result cards, loading, no-result, and unavailable-service states.
- Ensure image dimensions/alt behavior are safe and links go to the original block.
- Confirm keyboard behavior and narrow-screen layout.

## Slice 4 — portfolio polish

- Add concise architecture notes to the product’s about surface.
- Add edge rate limiting and basic error telemetry before public deployment.
- Run the full quality suite and manually test the evaluation queries.

## V2 — only after V1 is stable

- Add Mastra and one `archive-research` agent.
- Wrap V1 retrieval in the read-only `search_archive` tool.
- Stream responses with block citations; cap retrieval calls at three.
- Add an agent evaluation set for groundedness and citation coverage.
