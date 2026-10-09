# Browser search implementation worksheet

User accepted docs/specs/free-search-migration.md and requested implementation, preserving semantic search.

Plan: add client-safe snapshot schemas, MiniSearch/filter/browse/vector/RRF core and tests; add a dedicated Web Worker with lazy checked assets and a request client; add public-only export target to existing sync plus embedding cache/release writer; implement a rate-limited POST embedding endpoint using Workers AI; prerender browse from export assets and use URL-driven browser search and paging; retire public server search API explicitly while retaining legacy CLI/index for evaluation and rollback. Record ADR and update architecture, design, Svelte guidelines, setup and changelog.

Scope: no live deployment or deletion. Export must never call OpenRouter, push Are.na, upsert or prune Turbopuffer; excludes private channels even when allow-listed. Complete discovery is mandatory. Corpus embeddings and query embeddings share a versioned configuration. Conservatively chunk long text without discarding trailing OCR/descriptions, aggregate chunk cosine scores by block, filter before ranking, fuse ranked lists at a fixed depth.

Validation: baseline checks, meaningful unit coverage for export isolation, mapping, filter/sort parity, exact vector search/RRF, asset integrity, stale requests and embedding endpoint. Full check/lint/test/build, Svelte autofixer and browser preview. Live fixture and mobile benchmark require real release credentials/content and remain explicit gates if unavailable.

Implemented the opt-in browser backend, public-only export, immutable checked assets, chunked document embeddings, Worker ranking and guarded embedding endpoint. Legacy remains the default; no deployment or live namespace writes occurred.

Validation: check, lint, 723 unit tests (2 skipped), legacy build and browser build passed. Svelte autofixer found no errors. Actual browser browse, hybrid and semantic queries and history navigation worked. Systems Architect, Search Expert, Frontend and Data/Privacy reviews found no remaining P0/P1 after fixes.

Actual export: 2,202 blocks, 52 public channels, 8,450 vectors. Vector payload is 12,979,200 bytes, metadata 2,629,480 bytes and lexical index 2,844,484 bytes before compression. Real fixture: 14/15 passed; vision-widget-grid expected block ranked 112 rather than top 24. Local full hybrid ranking for that query took 36.7 ms on this machine; physical mobile performance remains unmeasured. Legacy comparison could not run because Turbopuffer returned HTTP 401. These are cutover gates, not hidden fallbacks. Do not enable production browser mode until relevance and mobile transfer/memory performance are accepted.

Commands: bun run export:search (public-only read/export with configured Workers AI credentials), bun run evaluate:search --browser and --compare. No sync command ran. Static public artifacts and local embedding cache remain ignored and uncommitted. Initial failed export printed an SDK credential-bearing exception; the user was told to rotate the Are.na token, and CLI errors now emit sanitized names/status only.
