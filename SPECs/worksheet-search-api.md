# Search repository and API worksheet

## Scope

- TODO: Slice 2 — `SearchRepository` and `/api/search`, modes/filters, evaluation fixture, and focused retrieval/API tests. The endpoint cannot safely expose the default hybrid mode without its retrieval behavior, so these coupled items are one vertical slice.
- No linked human feature spec; the retrieval contract in `docs/architecture.md` and V1 requirements in `docs/prd.md` are authoritative.

## Reviewed

- `AGENTS.md`, `TODOS.md`, `docs/workflows/agent-loop.md`, `docs/workflows/agent-review.md`
- `docs/architecture.md`, `docs/prd.md`, `docs/svelte-guidelines.md`
- Existing search contracts, Turbopuffer client/schema, archive domain types, and existing test patterns.
- Baseline: lint and 70 unit tests pass. `bun run check` initially found stale generated Wrangler types; regenerated with the pinned `.env.example` command before implementation.
- Wrangler's refreshed generated types import the SvelteKit Worker bundle. Disabled TypeScript checking of generated JavaScript in `tsconfig.json`; authored JavaScript remains covered by ESLint, and TypeScript/Svelte source remains strict-checked.

## Plan

1. Define a server-side Turbopuffer-backed `SearchRepository` implementation while retaining `contracts.ts` as the internal typed seam. Construct its provider client from server-only configuration and enforce a request deadline.
2. Define one URL grammar: `q`, `mode`, repeated `channel`/`type`, and `from`/`to` ISO dates. Validate it through a public request schema that excludes `limit`, rejects reversed ranges, and add the fixed server-owned limit only when constructing the repository input.
3. Implement browse, lexical, semantic, and hybrid retrieval. All modes share one `And` filter built only from V1 fields. Repeated `channel` or `type` values are ORed within their category; categories compose with AND. Hybrid issues one `multiQuery` with provider-owned RRF. Non-browse modes require a non-empty query.
4. Validate selected Turbopuffer presentation rows with Zod, map them to `SearchResult` in the repository, and return a typed success envelope from the route.
5. Return a typed, generic 400 or 503 error envelope. Generate a correlation ID for unavailable-provider errors without logging credentials, raw provider payloads, or a visitor query.
6. Add ten non-private evaluation expectations and behavior tests for parsing, filters, row mapping, mode selection, endpoint responses, malformed provider rows, and timeout/service failures. Assert each mode's provider payload; test no filters, each filter, repeated values, category composition, inclusive bounds, and the omission of empty filters. Prove the URL cannot control limits; prove 400 and 503 errors redact visitor queries and provider details; and schema-validate the fixture. Update `CHANGELOG.md`, move all Slice 2 TODOs to Done, and commit the completed user-requested vertical slice.

## Risks

- The installed Turbopuffer SDK types and exact query payload must be verified against its local type declarations before implementation.
- Date-only `to` values must include their full UTC day so the public filter is intuitive and inclusive.

## Result

- Added the server-only Turbopuffer repository, URL request parser, safe API handler, and `GET /api/search` composition route.
- Implemented browse, lexical, semantic, and hybrid/RRF retrieval with only the three permitted V1 filters. The endpoint has a server-owned limit, a ten-second provider deadline, one retry, and generic 503 responses paired with sanitized correlation/status logging.
- Added a public ten-case fixture plus `bun run evaluate:search`; all expectations passed against the configured namespace, and the six referenced Are.na blocks returned 200 without authentication.
- Review fixes added explicit no-result evaluation semantics, fixture test discovery, date/channel filter coverage, the default namespace fallback, and sanitized correlation reporting. The only remaining non-blocking tradeoff is `checkJs: false`: Wrangler-generated Worker bundle imports otherwise cause SvelteKit to type-check generated JavaScript. Authored JavaScript remains linted and TypeScript/Svelte source remains strictly checked.
- Validation: `bun run check`, `bun run lint`, `bun run test` (11 files, 100 tests), `bun run build`, and `bun run evaluate:search` all pass.
