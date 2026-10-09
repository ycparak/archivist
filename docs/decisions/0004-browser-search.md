# Browser search with static archive assets and Workers AI

Date: 2026-10-09. Status: accepted implementation; production cutover gated on evaluation.

The maintainer requested replacing Turbopuffer with a free architecture while preserving semantic search, and accepted the [investigation](../specs/free-search-migration.md).

Use MiniSearch for lexical search and an exhaustive normalized cosine scan for semantic search in a browser Web Worker. Fuse the full eligible ranked lists with RRF (`k = 60`), with stable block ID ties. At this archive's scale this preserves filters and deep paging without an ANN datastore. Query embeddings come from a thin Workers AI endpoint; document embeddings are generated during a manual public export with the same versioned model/configuration.

`@cf/baai/bge-small-en-v1.5` produces 384-dimensional vectors. Split canonical `search_text` into at most 384 UTF-8 bytes per chunk, safely below BERT WordPiece's 512-token window, then take the maximum cosine score across a block's chunks. This retains descriptions/OCR at the end of long documents. Short chunks and maximum aggregation may favor long blocks; evaluate this against the live fixture before cutover. All query modes continue to return original Are.na blocks only.

A public export reads only public/closed owned channels, ignores private allow-lists, uses existing vision/colour/connections caches and refuses partial discovery. It never generates vision text, writes Are.na metadata, or modifies Turbopuffer. Artifacts/cache are gitignored. Content-hashed releases carry metadata, MiniSearch JSON, little-endian Float32 shards and a first-page bootstrap; checksums/counts/IDs are validated. Publication stages a release before switching the manifest and reuses verified immutable existing versions. Retained versions support open sessions and rollback; incompatible endpoint model versions fail explicitly and require reload.

Add MiniSearch as a dependency because it supplies the maintained inverted index, BM25-family ranking and serialization rather than implementing those primitives ourselves. Shared URL validation, snapshot schemas, colour thresholds and ranking live in client-safe `src/lib/search/`; `domain/search.ts` remains validation-free and `domain/archive.ts` remains server/CLI-only. Are.na/provider adapters and credentials never ship to clients. Web Worker cancellation and page ownership guards prevent stale query/page results from replacing newer searches.

The browser build prerenders the default gallery and resolves query/filter URLs in the browser. It requires JavaScript for interactive search/filtering. The old `/api/search` returns 410 in this build; there are no known external consumers. The legacy build and sync CLI remain available until real-corpus relevance, browser behavior and mobile performance are accepted. `PUBLIC_ARCHIVE_SEARCH=browser` is a build-time opt-in (`build:browser`, `dev:browser`), not a per-request mutable switch.

The deployed embedding endpoint uses the `AI` binding, validates request/version and provider output, and requires a working rate limiter. It is disabled outside browser builds and fails closed when the limiter is missing or fails. Local dev may use the locally configured REST credentials; they are not required on the deployed Worker. Requests carry query text in a bounded POST body, never in diagnostic logs or URL strings. Static assets bypass request compute; the embedding route invokes the Worker. Static release headers are immutable; the current manifest is not cached.

Free hosting remains subject to Workers and Workers AI allocations. Existing OpenRouter vision generation is outside that promise. The browser approach adds an initial corpus transfer and changes SSR/API behavior, but avoids Vectorize's 100-result cap and insufficient metadata indexes for twelve colours plus channel/type/date filters. A fully static query model was rejected initially because its download and mobile startup are substantial and the candidate ONNX file exceeds the 25 MiB asset limit.

## First real release validation

The public export contained 2,202 blocks across 52 channels and 8,450 chunk vectors (12.98 MB of vectors before compression). The existing fixture passed 14/15 cases; the widget-grid vision query ranked its expected block at 112. Turbopuffer comparison returned HTTP 401. The browser build and basic hybrid/semantic browser flows passed, but physical mobile performance is unmeasured. Production activation remains gated on these checks.
