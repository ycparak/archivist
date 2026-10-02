# Worksheet: colour filter

Spec: [colour-filter.md](./colour-filter.md). TODO entries: the three colour tasks in
[TODOS.md](../TODOS.md).

Started on branch `colour-filter` from a clean `main` (`0251f98`).

## Reviewed

- `AGENTS.md`, `docs/architecture.md` (schema, retrieval, sync lifecycle, vision indexing).
- `src/lib/domain/search.ts`, `src/lib/domain/archive.ts`.
- `src/lib/server/search/`: `repository.ts`, `request.ts`, `contracts.ts`, `execute.ts`,
  `turbopuffer-client.ts`, `turbopuffer-schema.ts`.
- `src/lib/server/indexing/`: `sync.ts`, `normalize.ts`, `vision/{index,cache,prompt,rendition,video}.ts`,
  `progress/events.ts`; `scripts/sync.ts`, `scripts/evaluate-search.ts`.
- `vision-cache.jsonl`: 2,542 entries, every `palette` valid hex, usually 5 swatches. Unweighted,
  so it cannot rank. That is why the spec measures pixels instead.

## Task 1: Turbopuffer spike (done)

Read-only queries against `arena-blocks-v1`; results are recorded in the spec under
"Turbopuffer spike (answered)". The finding that changed the plan: expression ranking (`Sum` of
`Attribute`) has undefined tie order that varies with `limit`. It cannot take a secondary sort, and
its scores are 32-bit floats. Browse with colours therefore uses a plain attribute sort ending in
`id`, which pages cleanly.

Side observation, out of scope: today's browse sort, `connection_count` then `connected_at`, has
no unique final key, so two blocks with identical `connected_at` could in principle straddle a page
edge.

## Task 2: Measure and calibrate

_(in progress)_

## Task 3: Index and filter

_(not started)_
