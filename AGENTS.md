# Archivist implementation contract

This file is the source of truth for coding agents. Read `docs/PRD.md`, `docs/ARCHITECTURE.md` before changing product code. `CLAUDE.md` deliberately points here instead of repeating it.

## Product boundary

- V1 is an open-source public gallery and search surface for one maintainer's Are.na archive.
- Results are original Are.na blocks. Do not introduce generated collections, summaries, tags, OCR, link crawling, auth, accounts, analytics, background queues, or a chat UI in V1.
- Sync is manual and maintainer-only. Public requests query Turbopuffer only; they must never proxy to Are.na.
- V2 may use Mastra for an evidence-first research mode. Keep V1 retrieval framework-agnostic so it can become a Mastra tool later.

## Architecture boundaries

- `src/lib/domain/`: framework-free domain types and transformations.
- `src/lib/server/arena/`: Are.na transport and pagination only.
- `src/lib/server/indexing/`: normalization, document construction, and sync orchestration.
- `src/lib/server/search/`: search request validation, Turbopuffer adapter, and result mapping.
- `src/routes/`: HTTP and UI composition only. Do not put provider calls or ranking expressions in route files.
- Keep provider API shapes private to adapter modules. UI code consumes `SearchResult`, never Turbopuffer rows.

## Search invariants

- Use the `search_text` schema in `docs/ARCHITECTURE.md` for both BM25 and native embeddings.
- Hybrid means one Turbopuffer `multiQuery` with BM25 + native ANN and `rerank_by: ['RRF']`; do not implement ad-hoc score arithmetic in the UI.
- Filter only `block_type`, `channel_slugs`, and `connected_at` in V1.
- Schema changes that alter an existing Turbopuffer attribute's type require a new versioned namespace. Record that migration in `docs/adr/`.

## Quality bar

- TypeScript strictness is non-negotiable. Validate untrusted API/config input at the boundary with Zod.
- Add a focused unit test for every normalizer, filter builder, and search-result mapper. Test behavior, not private implementation details.
- Use accessible native controls, URL-backed browse/search state, server-side data access, and responsive image dimensions.
- Keep secrets server-only; do not log tokens, full raw API payloads, or user search queries.
- Prefer the existing official SDKs. Add a dependency only when it removes meaningful production code; document why in an ADR if it changes the architecture.

## Required checks

Run these after a meaningful change and fix failures before handoff:

```sh
bun run check
bun run lint
bun run test
bun run build
```

## Pull request hygiene

- Keep the first V1 pull request to one vertical slice.
- State the changed behavior, test evidence, and any environment/configuration change.
- Never commit `.env`, local snapshots containing private blocks, or a populated Turbopuffer export.
