# 0004: Browser search with static assets and Workers AI

Status: accepted and implemented; consolidated on 2026-10-14 after removal of the legacy backend.

## Decision

Use MiniSearch for lexical search and exact normalized cosine similarity over chunk vectors in a browser Web Worker. Filter the eligible corpus first, aggregate maximum chunk similarity per block and fuse complete lexical/semantic lists with RRF (`k=60`) and stable ID ties. Results are always original Are.na blocks.

Generate public-only content-hashed releases during manual maintenance. Use versioned Workers AI embeddings for documents and bounded query inference through the deployed AI binding. Ship metadata, a serialized lexical index, Float32 vector shards and a default-gallery bootstrap as Worker Static Assets. Validate schemas, sizes, hashes, IDs and vector mappings. Stage local files before replacing the local manifest; deploy the app/bootstrap/assets together.

MiniSearch replaces custom inverted-index/ranking/serialization code. Exact scanning avoids an external search datastore and preserves complete filtered rankings and deep paging at this archive's scale. The cost is initial corpus transfer and browser memory/CPU, which need measurement on mobile.

## Boundaries and consequences

Browser search is the sole backend; there is no opt-in switch or legacy fallback. Interactive search/filtering requires JavaScript; the default gallery is prerendered. `/api/search` is retired with HTTP 410, subject to the shared GET rate limiter. Query embeddings fail closed when their limiter is unavailable. Provider payloads and credentials remain server-only.

Chunking covers complete canonical text; maximum aggregation may favor long blocks. A previous evaluation found a widget-grid relevance miss, and physical mobile performance remains unverified. These are quality issues to evaluate, not a pending backend cutover.

Retain prior immutable releases for open sessions and rollback. Incompatible snapshot or embedding changes require versioning. Cloudflare allocations bound free operation; OpenRouter vision generation and planned Trigger.dev compute/storage have separate costs.

Current behavior is detailed in [architecture](../architecture.md). The [Trigger.dev plan](../specs/trigger-workflows.md) extends maintenance without moving visitor search out of the browser.
