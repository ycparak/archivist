# Technical architecture

## Decision summary

**SvelteKit + TypeScript on Cloudflare Workers** (`@sveltejs/adapter-cloudflare`) serves the public app. **Are.na V3** is the source of truth, read only by a manually run sync CLI. The official **Turbopuffer TypeScript SDK** is the sole search datastore: native embeddings and full-text BM25 over one canonical text field, with its `multiQuery` endpoint and reciprocal-rank fusion for hybrid retrieval. An optional vision model, called only from the sync CLI, describes images so they can be found by what they look like.

## System shape

```text
Maintainer CLI (bun run sync, manual)
  -> Are.na V3 (personal access token)
  -> normalize original block metadata, dedupe across channels
  -> [optional] OpenRouter vision model, cached in vision-cache.jsonl
  -> [optional] write generated titles/descriptions back to Are.na
  -> Turbopuffer namespace: arena-blocks-v1
  -> channel-manifest.json, vision-cache.jsonl (committed)

Public SvelteKit app on Cloudflare Workers
  -> GET /?q=&mode=&channel=&type=&from=&to=         (SSR gallery)
  -> GET /api/search?...&offset=                     (JSON, used for infinite scroll)
  -> executeArchiveSearch -> SearchRepository -> Turbopuffer multiQuery / query
  -> typed original-block result cards
```

Code layout:

| Path                                 | Owns                                                                                                                                                                       |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/lib/domain/`                    | `search.ts`: the URL grammar, modes, `SearchResult`, shared with the browser. `archive.ts`: `ArchiveBlock`, `SearchDocument`, `toSearchDocument` (server-only in practice) |
| `src/lib/server/arena/`              | Are.na transport (SDK wrapper), Zod schemas for Are.na payloads, pagination, rate-limit handling                                                                           |
| `src/lib/server/indexing/`           | normalization, channel filter, channel manifest, sync orchestration, `vision/` and `progress/`                                                                             |
| `src/lib/server/search/`             | request parsing, `SearchRepository` (read path), the Turbopuffer write client and schema (used by sync), result mapping                                                    |
| `src/lib/server/rate-limit.ts`       | edge rate limiting, invoked from `src/hooks.server.ts`                                                                                                                     |
| `src/lib/components/`, `src/routes/` | presentation and composition                                                                                                                                               |
| `scripts/`                           | `sync.ts` and `evaluate-search.ts`, the manual CLIs; `fixtures/search-cases.json`                                                                                          |

## Why this data-access model

The sync uses a **personal access token**. Everything it does is read-only, including the whole indexing path, except `--push-arena-apply`, which writes generated titles and descriptions back to Are.na and so needs a token with write scope. Are.na documents personal tokens as the simplest route for personal scripts. A public unauthenticated path is limited to 30 requests per minute and can omit private or archive-specific content; an authenticated free account is documented at 120 requests per minute. The token runs only in the manually invoked sync, never in a deployed request. Do not send a live Are.na request for a visitor's query.

The sync discovers its own scope: it resolves the token owner's user id (`GET /v3/me`), lists every channel that user owns (`GET /v3/users/{id}/contents?type=Channel`, paginated), and syncs each one's contents. There is no channel allowlist to hand-maintain. The cost is a scope that is bounded but not reviewed per run, which sits closer to what Are.na's Acceptable Use policy calls "systematic downloading" / "structured data harvesting". That policy already applies to any full-channel-history sync regardless of size, and the mitigations in place matter more because scope is not reviewed: manual, occasional invocation only; a 300ms pause between requests and between channels; proactive waiting when `X-RateLimit-Remaining` is at or below 1 until `X-RateLimit-Reset`; and up to 5 retries per page on a 429, waiting as long as `Retry-After` (or the reset header) says (see `src/lib/server/arena/client.ts`). Pages are requested 50 at a time (the API maximum is 100). Nested channels inside a channel are counted as skipped items, not followed.

Channel scope is filtered after discovery (`src/lib/server/indexing/channel-filter.ts`): channels with `visibility: private` are skipped unless their slug is in `ARENA_ALLOW_PRIVATE_CHANNELS`, and any slug in `ARENA_IGNORE_CHANNELS` is skipped regardless (the ignore list wins). Both are comma-separated env vars read by `scripts/sync.ts`, kept out of the repo so private slugs are not committed. Skipped channels are omitted from the channel manifest. `closed` channels are publicly readable on Are.na and are treated as public.

## Turbopuffer namespace

Namespace: `arena-blocks-v1` by default, configurable with `TURBOPUFFER_NAMESPACE`. The schema lives in `src/lib/server/search/turbopuffer-schema.ts` and is sent with every write, so the namespace is created and extended by the first sync.

Turbopuffer requires stable types per attribute and does not permit in-place type changes. A breaking schema change therefore needs a new versioned namespace (`arena-blocks-v2`): change the default in `src/lib/server/search/namespace.ts`, re-run the sync to populate it, and document the migration in an ADR in [`docs/decisions/`](./decisions/).

| Attribute            | Type / index                                                        | Purpose                                          |
| -------------------- | ------------------------------------------------------------------- | ------------------------------------------------ |
| `id`                 | string, `block:<Are.na id>`                                         | deterministic document key                       |
| `search_text`        | string, full-text (English, stemmed, stopwords out), native `embed` | single canonical lexical + semantic corpus       |
| `block_type`         | string, filterable                                                  | type filter                                      |
| `channel_slugs`      | `[]string`, filterable                                              | membership filter                                |
| `connection_count`   | uint, filterable                                                    | browse ordering (most connected first)           |
| `connected_at`       | datetime, filterable                                                | browse tiebreak and date filter                  |
| `created_at`         | datetime, unindexed                                                 | stored, not currently read                       |
| `title`              | string, unindexed                                                   | card copy                                        |
| `description`        | string, unindexed                                                   | card copy                                        |
| `source_url`         | string, unindexed                                                   | original source link                             |
| `arena_url`          | string, unindexed                                                   | canonical result link                            |
| `image_url`          | string, unindexed                                                   | gallery image, and the poster for a video        |
| `image_alt`          | string, unindexed                                                   | Are.na's alt text, when it has any               |
| `image_width`        | uint, unindexed                                                     | intrinsic size, so cards reserve their space     |
| `image_height`       | uint, unindexed                                                     | intrinsic size                                   |
| `video_url`          | string, unindexed                                                   | playable file for a video attachment             |
| `video_content_type` | string, unindexed                                                   | `<source type>` for the video                    |
| `source_title`       | string, unindexed                                                   | attribution                                      |
| `vision_title`       | string, unindexed                                                   | generated short title (indexed, never displayed) |
| `vision_description` | string, unindexed                                                   | generated visual description (never displayed)   |
| `vision_ocr`         | string, unindexed                                                   | text read out of the image (never displayed)     |
| `vision_medium`      | string, filterable                                                  | generated medium; unreliable, nothing reads it   |
| `vision_tags`        | `[]string`, filterable                                              | generated tags; nothing reads it back yet        |

`connection_count` is the number of distinct synced channels a block is in. `connected_at` is a per-channel connection timestamp, so a block in several channels keeps the most recent one.

`search_text` is the deterministic, whitespace-normalized concatenation (newline-joined, empties dropped) of, in order: `title`, `description`, plain text content (only if supplied by Are.na), `source_title`, the titles of every channel the block is in, then — when a generated description exists — `vision_description`, `vision_ocr`, and the tags joined with `, `. Generated text goes last so a block that already describes itself keeps leading the corpus. Display fields are retained separately; never scrape a source URL.

Generated text is bounded before it is indexed (`src/lib/domain/archive.ts`, `vision/client.ts`):

- Descriptions are clamped to 500 characters at a sentence boundary.
- OCR is clamped to 6,000 characters, and discarded entirely when it is degenerate repetition (at least 100 words with fewer than 10% distinct). The clamp runs at index time too, because a cache hit never regenerates.
- Tags are lowercased, hyphens collapsed to spaces, deduplicated and sorted, in the attribute as well as in the text, so a future facet cannot filter on a value the index never wrote.

A presentation attribute is not additive the way a written attribute is: Turbopuffer rejects an entire query with a 400 when `include_attributes` names an attribute the namespace has never been written, so shipping a read before the sync that creates it takes search down rather than degrading it. `repository.ts` therefore treats such attributes as optional. It asks for them, drops them for the life of the process once the namespace says it has never heard of them, and asks again after a restart (a fresh Worker isolate) following a sync that has written them. `video_url` and `video_content_type` are handled this way. `vision_tags` is the same hazard and is deliberately not requested at all.

The `vision_*` attributes are populated from `src/lib/server/indexing/vision-cache.jsonl`, which is committed. They are written on every sync, not only when the vision stage runs, so a sync without `--vision` still indexes what earlier runs generated rather than stripping it back out.

The embedding model is `nvidia/nemotron-3-embed-8b` with 1024 dimensions and cosine distance, set in the schema file and not in the query route. A model or dimension change is a namespace migration.

## Retrieval behavior

`mode=hybrid` makes one Turbopuffer `multiQuery` request:

```ts
{
  queries: [
    { rank_by: ['search_text', 'BM25', query], ...shared },
    { rank_by: ['search_text', 'ANN', ['Embed', query]], ...shared }
  ],
  rerank_by: ['RRF']
}
```

`shared` includes a result limit, the presentation attributes, and an `And` filter built from the optional filters. Lexical and semantic modes issue their respective single query. Browse does no text query: it orders matching records by `connection_count` descending, then `connected_at` descending.

The only filterable attributes the query path uses are `block_type` (`In`), `channel_slugs` (`ContainsAny`) and `connected_at` (`Gte` / `Lte`). Repeated `channel` or `type` parameters are ORed within their category, and categories compose with AND. Date-only `from` and `to` parameters cover their full UTC day.

Paging is offset-based. The API accepts a bounded `offset` (at most `ARCHIVE_MAX_OFFSET`, 2000), each query asks Turbopuffer for `offset + limit + 1` rows, the server drops the first `offset` after de-duplication, and `hasMore` reports whether a row remained past the page. The page size is server-owned (`ARCHIVE_RESULT_LIMIT`, 24); there is no public knob for it. The home page appends the next page as the reader scrolls, via `/api/search`.

The endpoint selects hybrid when `q` is non-empty and `mode` is omitted; an empty request selects browse. The UI offers three ranking choices (Best match = hybrid, Exact words = lexical, Related ideas = semantic) and reaches browse by leaving the query empty.

Request validation (`src/lib/server/search/request.ts`):

- `q` is at most 400 characters and is required unless `mode` is `browse`.
- At most 20 `channel` values and 20 `type` values.
- `type` must be one of the five Are.na block types (`Image`, `Link`, `Text`, `Attachment`, `Embed`); `mode` must be one of the four modes; `from` and `to` must be `YYYY-MM-DD`, and `to` must not precede `from`.
- Blank parameters are treated as omitted (`?q=&mode=&from=&to=` is the same request as `/`), because an HTML form submits every field whether or not it was filled in. A blank value still counts toward the "at most once" rule for `q`, `mode`, `from`, `to` and `offset`, so `?from=&from=2024-01-02` is a 400.
- Malformed non-blank values fail with 400 rather than silently returning nothing.

Results are deduplicated by block id before they leave the seam, so a block returned by both halves of a hybrid query appears once, keeping its higher-ranked position. Both surfaces share that guarantee (`executeArchiveSearch`).

`/api/search` answers `{ results, hasMore }`, or 400 `{ error }`, or 503 `{ error, correlationId }`. The gallery page renders a search failure as page content at HTTP 200 rather than a 4xx/5xx, so the form and its values survive and the visitor can correct or retry. Non-`ok` page responses are sent `cache-control: no-store` so a transient outage is not cached as the archive's content.

Turbopuffer offers no facet we rely on over the `channel_slugs` array attribute, and a public request may never call Are.na, so the UI cannot enumerate channels at request time. Instead `bun run sync` writes the channels it syncs to `src/lib/server/indexing/channel-manifest.json`, sorted by slug. That file is committed and bundled into the app at build time (a plain JSON import), so the Channel filter lists every channel in the archive, not just the ones the current result page carries, at no request-time cost. The manifest lists every channel that passed the ignore/private filter, regardless of that run's per-channel sync outcome, since a channel that fails one run may still have blocks indexed from a prior one. It is written only when a sync completes.

RRF belongs in Turbopuffer, not in client code. It combines independently ranked lists without assuming BM25 and vector distance are numerically comparable.

## Reliability and security

- Validate URL query parameters and Are.na responses with Zod at their boundary.
- Return a generic 503 for unavailable Turbopuffer credentials/service; log a correlation ID and provider status, never a token or raw archive response.
- Queries time out after 10 seconds and the SDK retries once. Do not retry client validation errors.
- Rate-limit `GET /` and `GET /api/search` at the edge before Turbopuffer is constructed. The Cloudflare `ARCHIVE_SEARCH_RATE_LIMITER` binding allows 60 requests per minute per `archive-search:<client address>` key, shared by both search surfaces. It is local to a Cloudflare location and eventually consistent, so it is an abuse brake rather than an accounting or security boundary. There is no user identity; IP-based keys can group legitimate visitors behind shared networks and are never logged. Local development bypasses an absent binding; a thrown limiter call fails open after a privacy-safe error event. A rejection returns a no-store 429 with `retry-after: 60` (JSON at `/api/search`, minimal retry HTML at `/`).
- Workers observability is enabled with logs and traces persisted at full sampling while traffic is low, and request query strings are redacted. Application telemetry is structured and allowlisted: unavailable search logs only its event name, correlation ID, and provider status; rate-limit logs only their event name, route, and (for rejections) 429 status. Never log a URL, query string, headers, client address, rate-limit key, credentials, provider payload, or raw error.
- Use SSR/server API routes for all provider access. Only public image and Are.na URLs are sent to the browser.
- Escape/avoid raw block HTML. Render normalized text as text.

## Sync lifecycle

`bun run sync` (`scripts/sync.ts` driving `syncArchive`):

1. The script requires `ARENA_ACCESS_TOKEN`, `TURBOPUFFER_API_KEY` and `TURBOPUFFER_REGION`, plus `OPENROUTER_API_KEY` only when a vision flag is given, and exits with an explanation otherwise.
2. Resolve the token owner's user id and discover every channel they own, then drop ignored and (by default) private channels. Fetch each remaining channel's pages in turn. If the first three channels all fail, abort: that is a token problem, not three broken channels. Any other failed Are.na request for a channel is recorded and the sync continues; a response that does not match the expected schema aborts the run.
3. Normalize blocks into stable documents and deduplicate by Are.na block ID while unioning channel membership. When the same block is in several channels, keep the most recent `connected_at`; every other field comes from the block resource itself.
4. With `--vision` (or `--vision-dry-run`), the vision stage runs over the deduplicated blocks. See [Vision indexing](#vision-indexing). Without a vision flag this step is skipped and the existing cache is indexed as-is.
5. With `--push-arena` / `--push-arena-apply`, plan (and for apply, perform) the write-back to Are.na. This runs before the upsert so that a failure here does not cost the upsert.
6. Upsert documents in batches of 200, folding generated text into `search_text`. Re-running the same sync is idempotent.
7. Prune: page through every document id in the namespace (id-only, `rank_by id asc`, advancing `id Gt` filter, 10,000 ids per page) and delete in batches of 1,000 the ids not in this sync's deduplicated set. This runs after the upsert, so a failure leaves a superset of the truth, never a partial index. It also removes blocks from channels that are now ignored or private. Because ids are deduplicated across channels before the diff, a block still in any synced channel is never pruned.
8. The script writes the merged vision cache (only when the vision stage actually ran), writes the channel manifest, and prints a summary: channels discovered/ignored/private-skipped/synced/failed, blocks fetched, nested items skipped, unique blocks, documents upserted and pruned, plus vision and write-back counts when those stages ran.

Pruning is skipped, with the reason in the summary, when a channel failed, the sync was aborted, no blocks were fetched, or the delete would remove more than half the namespace. Pass `--allow-large-prune` to override the last guard, e.g. after deliberately ignoring most channels. The alternative of wiping and reloading the namespace was rejected: native embeddings would be recomputed for every document, and search would be empty or partial during the reload.

Every stage reports through two channels: a human-readable `log` callback for detail worth keeping in the scroll-back, and a structured event stream (`src/lib/server/indexing/progress/events.ts`) carrying phase, position, and the lifecycle of each vision block. `scripts/sync.ts` folds the events into a snapshot and draws a status region that is redrawn in place, so the screen can answer what is running right now, including how long the oldest in-flight block has been waiting, which is the only way a stalled request is distinguishable from slow work. Presentation lives entirely on the reporter's side of that seam; the pipeline knows nothing about terminals, and degrades to line-based progress when stdout is not a TTY or `NO_COLOR` is set.

## Vision indexing

Image blocks usually arrive titled with a filename and no description, which makes them unfindable by text. The vision stage (`src/lib/server/indexing/vision/`) has a model describe each block that has an image, and that text is indexed for retrieval. It is a sync-time stage only: query time stays LLM-free, and a result is always the original Are.na block. Generated text is never displayed by the gallery; the one way it reaches a reader is write-back, which puts it on the Are.na block itself.

**Model and routing.** `xiaomi/mimo-v2.5` through OpenRouter, called with plain `fetch` and validated with Zod, no SDK. The request pins a provider order (`deepinfra`, `streamlake`, `venice`) with `require_parameters: true`, because OpenRouter's cheapest route for this model supports neither structured outputs nor `response_format` and would return prose intermittently. Reasoning is disabled and `max_tokens` is capped at 2,048, the only thing that reliably stops a runaway decode. Requests time out at 240s; 408, 429 and 5xx retry up to 4 times with exponential backoff (honouring `Retry-After`), but a timeout gets only 2 attempts in total, since a request that stalls tends to stall every time.

**Input.** Stills are not downloaded. Are.na serves images through a resizer whose request is a base64 JSON payload in the URL path, so `rendition.ts` rewrites the resize width to 768 and the provider fetches the smaller image itself. A non-resizable image over 5 MB is skipped, as is any content type other than JPEG, PNG, WebP or GIF (an unknown type is let through). Animated blocks (`image/gif`) are read as motion by default: `video.ts` downloads the source (at most 64 MB), transcodes it with ffmpeg to a silent MP4 (at most 512px wide, 6 fps, CRF 32, 60s timeout), rejects it above 4 MB, and sends it inline as a data URL. The scratch directory is removed on every exit path; directories left by a killed run are swept at the start of the next one once they are an hour old. ffmpeg must be on PATH. A missing binary is reported as a failure of each animated block, naming ffmpeg, and does not stop the run; `--no-vision-video` falls back to a single frame.

**Prompt and output.** `prompt.ts` holds `PROMPT_VERSION`, the system prompt and a strict JSON schema: `title` (at most 70 characters, never the supplied title), `description` (200 to 500 characters), `ocr` (every legible word), `palette` (3 to 5 hex colours, cached and not otherwise used), `medium` (one of nine values) and `tags` (3 to 8). The block's existing title, description and source title ride along as context, fenced and labelled as untrusted scraped text that must not be obeyed. A title that echoes the supplied one is rejected, and outputs that are not valid JSON or fail validation are retried and never cached.

**Cache.** `vision-cache.jsonl` is the system of record, committed so a fresh clone or a namespace migration costs nothing. One entry per block, serialized with fixed key order and sorted by block id so an unchanged run produces an empty diff. An entry is a hit only when block id, `image_src_hash` (a hash of the resizer payload's bucket and key, not of the URL, so retuning the rendition width invalidates nothing), `prompt_version`, `model` and `input_mode` all match, and that decision is made before any network call. `--revision` bypasses it for everything or for named channels. The merge drops entries for blocks no longer in the archive and keeps the previous entry for a block that failed this run. Bumping `PROMPT_VERSION` or changing the model regenerates every block, so check the cost first.

**Running it.** Concurrency is 32 by default (`--vision-concurrency`), measured: one description takes 20 to 160 seconds and per-slot throughput is roughly flat as slots are added. Per-block failures are collected, not fatal, and leave no cache entry, so the next run retries them. The script checkpoints the cache to disk every 25 entries, so an interrupted run loses at most that many. `--vision-limit=N` caps how many uncached blocks a run pays for, and `--vision-dry-run` reports the plan and spends nothing.

**Write-back** (`writeback.ts`, `titles.ts`, `--push-arena[-apply]`). The one part of the project that writes to the maintainer's archive. Only blocks the token's owner authored are touched, since Are.na rejects updates to anyone else's. A title is replaced only when it carries no information: an upload filename, an opaque hash or bare URL, platform boilerplate (`… on X: "…"`, `- YouTube`, Instagram), or a long title that merely restates the description. A missing title is filled in. A description is written only when the block has none. Each write also stamps `metadata.vision_v`, `vision_at` and `vision_src`. Writes are paced at 500ms (Are.na's free tier is 120 per minute), a rate-limited block waits out `Retry-After` up to 3 times, and the run aborts if the first 5 writes all fail, which almost always means a read-only token. Without `-apply` it prints the plan and writes nothing.

## Sources checked

- [Are.na API documentation](https://www.are.na/developers/explore): authentication, tiers, pagination, caching, and rate limits.
- [Turbopuffer vector search](https://turbopuffer.com/docs/vector): native embedding configuration and filtered ANN.
- [Turbopuffer query API](https://turbopuffer.com/docs/query): filters and multi-query support.
- [Turbopuffer write API](https://turbopuffer.com/docs/write): schema behavior, index costs, and migration constraint.
