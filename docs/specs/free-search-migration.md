# Free search migration investigation

Date: 2026-10-09. Status: recommendation, not an accepted architecture decision.
User requirement: replace Turbopuffer with a free architecture while preserving semantic search.
No runtime code, dependencies, deployed resources or live indexes changed.

## Recommendation

For the current archive, use **MiniSearch plus exact vector search in a browser Web Worker**, with an optional-infrastructure choice made explicit: a thin Cloudflare Worker endpoint backed by Workers AI generates query embeddings. Serve the gallery shell, public metadata, serialized lexical index and precomputed document vectors as versioned static assets. Prerender the default browse gallery for first paint and crawlers.

This is my preferred balance of free hosting, complete filtering and visitor experience. It is free **within the Workers and Workers AI allocations**, not unlimited semantic inference. If absolutely no usage-dependent service is acceptable, move query embedding into the browser with Transformers.js; this costs a substantial model download and needs a mobile benchmark before adoption.

Do not treat MiniSearch alone as a semantic replacement. It supplies lexical ranking, prefix matching and typo tolerance; vectors supply conceptual similarity. Existing vision descriptions, OCR and tags remain valuable inputs to both.

## Repository evidence

- Architecture docs record 2,550 blocks. The committed connections cache has 2,550 entries; this corroborates scale but is not a fresh live count. Channel manifest: 74 channels. Vision cache: 2,542 entries, 3.69 MB; this is **not** a complete searchable corpus or a measured MiniSearch index size.
- `domain/archive.ts` owns `toSearchDocument` and the canonical `search_text`. Reuse that composition, including its OCR cleanup and generated-tag normalization.
- `server/search/repository.ts` owns provider ranking, filters and mapping. `contracts.ts` already defines a repository interface, but `config.ts` and the unavailable-error import in `execute.ts` still depend on Turbopuffer.
- `execute.ts` slices a ranked prefix at the requested offset. A server adapter that returns an already paginated SQL page would be sliced twice unless that contract changes.
- `indexing/sync.ts` writes to Turbopuffer immediately after document construction, then prunes. A static export needs an explicit output target that bypasses both operations; neither existing opt-out flag disables live Turbopuffer writes.
- Existing behavior includes three query modes, seven browse orders, channel/type OR filters, colour AND filters, whole-UTC-day dates and stable ID tiebreaks. Keep these semantics.
- The current fixture has 15 cases, including OCR and visual-description queries. It is a starting point, not sufficient proof of semantic quality parity.

## Candidate comparison

| Architecture                                             | Semantic search             | Free basis                                   | Assessment                                                                                      |
| -------------------------------------------------------- | --------------------------- | -------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Browser MiniSearch alone                                 | No                          | Static assets                                | Insufficient for the stated requirement                                                         |
| MiniSearch + static vectors + Workers AI query embedding | Yes                         | Static assets and AI/Worker free allocations | Recommended at current scale; complete local filters and paging, no model download              |
| MiniSearch + static vectors + browser Transformers.js    | Yes                         | Static assets, visitor compute               | Strongest independence from service quotas; model download/startup is the main risk             |
| D1 FTS5 + Vectorize + Workers AI                         | Yes                         | Three service allocations                    | Best conventional SSR direction if capped semantic results and filter redesign are acceptable   |
| MiniSearch + vectors inside the request Worker           | Yes with external embedding | Workers allocation                           | Avoid until cold-load, CPU and memory are measured against the free runtime                     |
| Pagefind                                                 | Lexical only                | Static assets                                | Good for document sites; does not remove the need for vectors and gallery-specific browse logic |
| Self-hosted search server                                | Depends                     | Existing machine only                        | Adds uptime and operations responsibilities; infrastructure is not inherently free              |

MiniSearch is a library, not durable storage. Build its index offline and load the serialized artifact once per browser worker. Do not rebuild it per keystroke or HTTP request. Its relevance differs from Turbopuffer BM25; stemming requires an explicit tokenizer/term-processing choice. Keep the first experiment on the single canonical text field rather than simultaneously changing field weighting.

Sources: [MiniSearch](https://lucaong.github.io/minisearch/), [Pagefind](https://pagefind.app/), [Transformers.js](https://github.com/huggingface/transformers.js).

## Proposed data flow

```text
Manual maintainer export
  Are.na -> existing normalization + cached vision/colour/connections
         -> validated public documents -> MiniSearch index
         -> document embeddings -> normalized Float32 vector matrix
         -> versioned static release + prerendered browse page

Visitor
  static page + public metadata -> browse immediately
  browser Web Worker -> MiniSearch lexical ranking
  thin same-origin embedding endpoint -> Workers AI -> query vector
  browser Web Worker -> filter eligible IDs -> exact cosine ranking
                     -> RRF for Best match -> stable ID tiebreak -> page
```

At 2,550 documents and 384 dimensions, the matrix is 3,916,800 bytes (3.74 MiB). A full scan needs 979,200 dimension products per query; this is a calculation, **not** a measured latency. No ANN service is necessary at this scale. Metadata/index download size and in-memory expansion remain unknown.

Start evaluation with `@cf/baai/bge-small-en-v1.5`, a 384-dimensional, 512-token embedding model. Generate corpus and query embeddings through the same model/backend for the first experiment. Cache document vectors by text hash and model version to avoid re-embedding unchanged content. Pin model configuration, normalization and query instruction in the release manifest. A local ONNX substitute is a separate experiment: sharing a model name does not prove pooling, tokenization or quantization equivalence.

Long `search_text` can exceed 512 tokens, and generated text occurs last. Measure token lengths and evaluate chunking before adoption; silent truncation could discard the visual description or OCR. If chunking is necessary, keep chunk vectors linked to block IDs and aggregate semantic ranks to one block before fusion. Recalculate asset sizes for the actual chunk count.

Apply every metadata filter before selecting semantic or lexical top candidates. Fuse ranked lists with reciprocal-rank fusion in the search module, never by adding raw lexical and cosine scores in components. Fix candidate depth and tie handling for a query; pagination must slice one stable ranking rather than alter candidate depth page by page.

Preserve URL grammar, navigation and history through `domain/search.ts`. Cancel or ignore stale query responses using request/version IDs. Explicitly report semantic unavailability; never silently label lexical results as Related ideas. Lazy-load vectors on text search, keep them cached across filter changes, and use a dedicated worker to avoid main-thread inference/scanning. Metadata may be loaded independently to make browse usable sooner.

## Cost and platform limits

Current official limits, checked on the investigation date:

- Static asset requests are free and unlimited; asset storage has no additional charge. Each asset is limited to 25 MiB. Static routes must actually bypass Worker execution. [Static asset billing](https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/)
- Workers Free: 100,000 dynamic requests/day, 10 ms CPU per request, 128 MB isolate memory. Network waiting does not consume CPU, but parsing and SSR do. Benchmark the thin endpoint on the real runtime. [Workers limits](https://developers.cloudflare.com/workers/platform/limits/)
- Workers AI: 10,000 neurons/day on Free, shared with other AI use; further operations fail when exhausted. BGE-small is listed at 1,841 neurons/million input tokens. An illustrative 40-token query costs about 0.074 neurons, or about 135,000 such queries per AI allocation; the Worker request cap, actual tokenization and shared usage can bind earlier. Corpus embedding also consumes the allocation. [AI pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/), [model limits](https://developers.cloudflare.com/workers-ai/models/bge-small-en-v1.5/)
- D1 supports FTS5, including SQLite's BM25 and English Porter stemming. Free allocation: 5 million rows read/day, 100,000 rows written/day, 5 GB total storage; Free databases are limited to 500 MB each. Scanned rows and index maintenance count, not just returned rows. [D1 SQL support](https://developers.cloudflare.com/d1/sql-api/sql-statements/), [pricing](https://developers.cloudflare.com/d1/platform/pricing/), [limits](https://developers.cloudflare.com/d1/platform/limits/), [FTS5](https://www.sqlite.org/fts5.html)
- Vectorize Free includes 5 million stored dimensions and 30 million queried dimensions/month. At 384 dimensions, 2,550 single-vector blocks store 979,200 dimensions. Writes also contribute to queried-dimension accounting; this allocation supports roughly 78,125 query/write vector operations per month before other use. [Vectorize pricing](https://developers.cloudflare.com/vectorize/platform/pricing/)

Free means no search-service bill within these allocations; it does not cover a domain, Are.na membership or existing OpenRouter vision generation. Reuse the vision cache and disable new paid generation for a zero-spend export. Local document embedding is possible, but local compute and model distribution still have practical costs.

## Why Vectorize is not the first choice here

Its documented maximum is 100 matches without returned vectors/full metadata (50 with those). That cannot directly preserve current offset paging up to 2,000. It supports at most ten metadata indexes, fewer than Archivist's twelve colour fields even before type and date fields. Indexed metadata types are scalar string/number/boolean, so multi-channel membership needs a different representation or duplicated vectors; query `$in` does not imply array-valued document membership support.

Post-filtering the global top 100 is not equivalent to searching the filtered archive: a valid block ranked 101 globally can be first in its channel and disappear. Increasing `topK` cannot fix this beyond the service cap. Multiple indexes or per-channel copies add synchronization, quota and deduplication complexity. A conventional server migration must explicitly accept capped search and design filtered recall, or use an exhaustive alternative.

Sources: [Vectorize limits](https://developers.cloudflare.com/vectorize/platform/limits/), [metadata filtering](https://developers.cloudflare.com/vectorize/reference/metadata-filtering/).

## Strictly static alternative

Transformers.js can embed queries in the browser using ONNX and then scan the same static corpus. Use the same pinned inference configuration for offline document generation and client queries. BGE-small's published int8 ONNX file is about 33.8 MB, before runtime/tokenizer files, so it exceeds the 25 MiB individual asset limit. It needs a verified split/external-data packaging strategy or another model; do not assume it can be uploaded unchanged. External hosting adds another availability dependency.

This variant removes the query API and keeps queries on-device, but semantic startup, mobile memory and battery use are acceptance gates. Use WASM as a compatibility baseline, with WebGPU only where supported. Browser embeddings remain model inference, not generated answers. [ONNX model files](https://huggingface.co/Xenova/bge-small-en-v1.5/tree/main/onnx), [model usage](https://huggingface.co/Xenova/bge-small-en-v1.5).

## Migration plan and acceptance gates

1. Build an explicit export-only CLI path before running any corpus refresh. Preserve channel exclusion and completeness checks. Publish only approved public content; existing allow-listed private channels cannot be automatically bulk-exported. Keep credentials, provider payloads and internal cache bookkeeping out of assets and git.
2. Produce an ignored local snapshot and benchmark MiniSearch + vectors without replacing production. Run the existing fixture against both providers and extend it with real conceptual paraphrases, long OCR, rare channels, colour intersections and date boundaries. Agree recall@24 and ranking regression tolerance before choosing the model.
3. Measure compressed transfer, cold/warm search latency, worker memory and first semantic response on a modest phone. Provisional targets: warm ranking under 100 ms and no main-thread long task; these are proposed gates, not achieved measurements. Compare 384d small and 768d base if small loses too much relevance.
4. Build static browse/search integration and the embedding endpoint behind a preview. Preserve accessible controls and URL history. Validate response vectors with Zod; keep secrets and query logs server-only, and disable query-body logging. Debounce/submit queries and wire the embedding route into the edge rate limiter explicitly; do not assume existing route matching covers it.
5. Publish content-hashed assets with one manifest version. Validate counts, ID alignment, vector dimensions and hashes before switching releases. Hold a single version per browser session so infinite scrolling cannot mix snapshots; retain prior assets for open sessions and rollback. The embedding endpoint must support the model versions of retained releases, or explicitly require a reload before embedding against a different model.
6. Record an ADR and update owning docs only after the architecture is accepted. Current server-only data access and Turbopuffer-owned RRF invariants would change; merely replacing `createSearchRepository` cannot implement this design. Search modules may become client-safe, but `domain/archive.ts`, Zod/provider normalization and credentials must remain server/CLI-only.
7. Keep Turbopuffer intact through the preview and evaluation. Remove SDK, credentials, provider schema/tests and live sync target only after a successful cutover. Update evaluation CLI to use the new shared search core. Run check, lint, tests, build and browser QA for implementation.

The recommendation preserves search capabilities, not identical rankings or arbitrary-query SSR. Default gallery content can be prerendered; filtered/query URLs resolve interactively. The current JSON search API needs explicit retirement or a supported replacement contract. If arbitrary-query SSR or external API consumers are required, revisit the server design before implementation.
