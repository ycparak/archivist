# Technical architecture

## Decision summary

**SvelteKit + TypeScript on Cloudflare Workers** (`@sveltejs/adapter-cloudflare`) serves the public app. **Are.na V3** is the source of truth, read only by a manually run sync CLI. The official **Turbopuffer TypeScript SDK** is the sole search datastore: native embeddings and full-text BM25 over one canonical text field, with its `multiQuery` endpoint and reciprocal-rank fusion for hybrid retrieval. A vision model, called only from the sync CLI, describes images so they can be found by what they look like.

## System shape

```text
Maintainer CLI (bun run sync, manual)
  -> Are.na V3 (personal access token)
  -> normalize original block metadata, dedupe across channels
  -> colour weights measured with ffmpeg, cached in colour-cache.jsonl (skip: --no-colour)
  -> total connections per block from Are.na, cached in connections-cache.jsonl (skip: --no-connections)
  -> OpenRouter vision model, cached in vision-cache.jsonl (skip: --no-vision)
  -> write generated titles/descriptions back to Are.na (skip: --no-push-arena)
  -> Turbopuffer namespace: arena-blocks-v1
  -> channel-manifest.json, vision-cache.jsonl, colour-cache.jsonl, connections-cache.jsonl (committed)

Public SvelteKit app on Cloudflare Workers
  -> GET /?q=&mode=&channel=&type=&colour=&from=&to=&created_from=&created_to=&sort= (SSR gallery)
  -> GET /api/search?...&offset=                     (JSON, used for infinite scroll)
  -> executeArchiveSearch -> SearchRepository -> Turbopuffer multiQuery / query
  -> original blocks shelved by channel (see docs/design.md)
```

Code layout:

| Path                                 | Owns                                                                                                                                                                                                                                       |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/lib/domain/`                    | `search.ts`: the URL grammar, modes, `SearchResult`, shared with the browser. `titles.ts`: which titles carry no information. `archive.ts`: `ArchiveBlock`, `SearchDocument`, `toSearchDocument` (server-only in practice)                 |
| `src/lib/server/arena/`              | Are.na transport (SDK wrapper), Zod schemas for Are.na payloads, pagination, rate-limit handling                                                                                                                                           |
| `src/lib/server/indexing/`           | normalization, channel filter, channel manifest, sync orchestration, `colour/`, `connections/`, `vision/` and `progress/`; the committed `channel-manifest.json`, `colour-cache.jsonl`, `connections-cache.jsonl` and `vision-cache.jsonl` |
| `src/lib/server/search/`             | request parsing, env config, `executeArchiveSearch` (dedupe, paging), `SearchRepository` (read path), result mapping, the Turbopuffer write client and schema, eval cases                                                                  |
| `src/lib/server/rate-limit.ts`       | edge rate limiting, invoked from `src/hooks.server.ts`                                                                                                                                                                                     |
| `src/lib/components/`, `src/routes/` | presentation and composition; the visual system is in [`design.md`](./design.md)                                                                                                                                                           |
| `src/styles/`                        | fonts, Tailwind theme tokens and the semantic colour roles, imported by `src/routes/layout.css`                                                                                                                                            |
| `scripts/`                           | `sync.ts` and `evaluate-search.ts`, the manual CLIs; `fixtures/search-cases.json`; `worktree.sh`                                                                                                                                           |

## Why this data-access model

The sync uses a personal Are.na access token. It only reads, with one exception: it writes generated titles and descriptions back to Are.na. That write-back is on by default, so the token needs write access. `--no-push-arena` turns it off.

The token only runs in the sync, on the maintainer's machine. It never runs in a deployed request. A visitor's search never calls Are.na.

Are.na allows 30 requests a minute without a token and 120 a minute on a free account. A token is the simplest route for a personal script.

The sync finds its own scope. It looks up the token's owner (`GET /v3/me`), lists every channel they own (`GET /v3/users/{id}/contents?type=Channel`), and syncs each one. There is no channel list to keep up to date.

The cost is that nobody reviews the scope on each run. Are.na's Acceptable Use policy warns against "systematic downloading", and a full sync is close to that. So the sync is gentle:

- It only runs by hand, and only now and then.
- It waits 300 ms between requests and between channels.
- It waits for the limit to reset when `X-RateLimit-Remaining` is 1 or lower.
- On a 429 it waits as long as Are.na asks, and retries up to 5 times per page.

Pages hold 50 blocks (the maximum is 100). Channels nested inside a channel are counted as skipped. They are not followed. The code is in `src/lib/server/arena/client.ts`.

After discovery, `src/lib/server/indexing/channel-filter.ts` drops some channels:

- A `private` channel is skipped unless its slug is in `ARENA_ALLOW_PRIVATE_CHANNELS`.
- A slug in `ARENA_IGNORE_CHANNELS` is always skipped. The ignore list wins.
- A `closed` channel is public on Are.na, so it is treated as public.

Both variables are comma-separated and live in `.env`, so private slugs stay out of the repo. Skipped channels are left out of the channel manifest.

## Turbopuffer namespace

The namespace is `arena-blocks-v1` by default. Set `TURBOPUFFER_NAMESPACE` to change it. The schema is in `src/lib/server/search/turbopuffer-schema.ts`. It is sent with every write, so the first sync creates the namespace.

`kind` is what a block is to a reader, set at sync by `blockKind` in `src/lib/domain/archive.ts`: `Video` for a block with a playable file, `GIF` for an Image or Attachment whose image is `image/gif`, and otherwise Are.na's type with `Link` called `Web`. `created_at` was made filterable in place with a schema update on the next upsert; that changes indexing, not the type, so it needed no new namespace.

Turbopuffer cannot change an attribute's type in place. A breaking change needs a new namespace, such as `arena-blocks-v2`. Change the default in `src/lib/server/search/namespace.ts`, re-run the sync, and record the move in an ADR in [`docs/decisions/`](./decisions/). Changing the embedding model or its size is also a breaking change.

| Attribute                | Type / index                                                       | Purpose                                    |
| ------------------------ | ------------------------------------------------------------------ | ------------------------------------------ |
| `id`                     | string, `block:<Are.na id>`                                        | document key                               |
| `search_text`            | string, full-text (English, stemmed, no stopwords), native `embed` | the one text field for keyword and meaning |
| `block_type`             | string, filterable                                                 | Are.na's type; untitled labels             |
| `kind`                   | string, filterable                                                 | Block type filter (`blockKind`)            |
| `channel_slugs`          | `[]string`, filterable                                             | channel filter                             |
| `connection_count`       | uint, filterable                                                   | the `my-` connected sorts (the default)    |
| `total_connection_count` | uint, filterable                                                   | most connected sort                        |
| `connected_at`           | datetime, filterable                                               | Connected filter, sorts and tiebreak       |
| `created_at`             | datetime, filterable                                               | Created filter and sorts                   |
| `title`                  | string, unindexed                                                  | card text                                  |
| `description`            | string, unindexed                                                  | card text when the block has no image      |
| `source_url`             | string, unindexed                                                  | returned with results, not shown           |
| `arena_url`              | string, unindexed                                                  | link to the block on Are.na                |
| `image_url`              | string, unindexed                                                  | gallery image, and a video's poster        |
| `image_alt`              | string, unindexed                                                  | Are.na's alt text, if any                  |
| `image_width`            | uint, unindexed                                                    | image size, so cards hold their space      |
| `image_height`           | uint, unindexed                                                    | image size                                 |
| `video_url`              | string, unindexed                                                  | playable file for a video attachment       |
| `video_content_type`     | string, unindexed                                                  | the video's MIME type                      |
| `source_title`           | string, unindexed                                                  | returned with results, not shown           |
| `vision_title`           | string, unindexed                                                  | generated title (never shown)              |
| `vision_description`     | string, unindexed                                                  | generated description (never shown)        |
| `vision_ocr`             | string, unindexed                                                  | text read from the image (never shown)     |
| `vision_medium`          | string, filterable                                                 | generated medium; unreliable, not read     |
| `vision_tags`            | `[]string`, filterable                                             | generated tags; not read back yet          |
| `colour_<name>`          | uint, filterable; one per colour, 12 in all                        | colour filter and colour browse order      |

`connection_count` is how many synced channels hold the block: the maintainer's own connections. `total_connection_count` is every connection to the block on Are.na, by the maintainer and by anyone else; see [Connection counts](#connection-counts). It is never lower than `connection_count`, because the maintainer's channels are among the connections it counts. `connected_at` is set per channel, so a block in several channels keeps the newest one.

`search_text` joins these parts in order, with new lines. Empty parts are dropped and spaces are tidied:

1. title
2. description
3. text content, if Are.na gives any
4. source title
5. titles of the block's channels
6. generated description
7. generated OCR
8. generated tags, joined with `, `

Generated text goes last. A block that already describes itself keeps leading. Display fields are stored apart from `search_text`. Never scrape a source URL.

Generated text has limits:

- A description is cut to 500 characters at a sentence end when it is generated.
- OCR is cut to 6,000 characters. It is dropped entirely if it is a loop of repeats: 100 or more words with under 10% distinct. This runs when it is generated and again when a block is indexed, because a cache hit never regenerates it.
- Tags are lowercase, with hyphens turned into spaces, no repeats, and sorted. This runs when a block is indexed, and holds in the attribute and in the text.

Turbopuffer fails a whole query with a 400 if it asks for an attribute that was never written. A new field can therefore take search down if the code ships before the sync. `repository.ts` treats these fields as optional. It asks for them, and if Turbopuffer rejects the query, it stops asking until the process restarts. `video_url` and `video_content_type` work this way. `vision_tags` has the same risk, so it is never requested.

The `vision_*` fields come from `src/lib/server/indexing/vision-cache.jsonl`, which is committed. Every sync writes them, even with `--no-vision`. Otherwise a sync would wipe text that earlier runs made.

The embedding model is `nvidia/nemotron-3-embed-8b` with 1024 dimensions and cosine distance. It is set in the schema file, not in the query route.

## Retrieval behavior

Hybrid mode sends one Turbopuffer `multiQuery`:

```ts
{
  queries: [
    { rank_by: ['search_text', 'BM25', query], ...shared },
    { rank_by: ['search_text', 'ANN', ['Embed', query]], ...shared }
  ],
  rerank_by: ['RRF']
}
```

`shared` holds the result limit, the fields to return, and the filters. Lexical and semantic modes send one query each. Browse sends no text query. By default it sorts by `connection_count`, then `connected_at`, both highest or newest first, then `id`. Turbopuffer leaves the order of rows tied on every sort key undefined, and it shifts with `limit`, which paging re-fetches with every page; the archive has 104 blocks in 33 groups tied on both of the first two keys, so without `id` one could repeat or vanish at a page edge.

RRF runs inside Turbopuffer, never in our code. It merges two ranked lists without comparing their raw scores.

**Filters.** Only these fields are filtered: `kind` (`In`, from `type`), `channel_slugs` (`ContainsAny`), `connected_at` (`Gte` and `Lte`, from `from` and `to`), `created_at` (`Gte` and `Lte`, from `created_from` and `created_to`) and the `colour_*` weights (`Gte` a per-colour threshold in `src/lib/server/search/colour-filter.ts`, except that the colour leading a default browse only needs a weight of 1; see Colour order). Repeated `channel` or `type` values are ORed. Repeated `colour` values are ANDed: `?colour=blue&colour=orange` is blocks with both. Different filters are ANDed. A date covers its whole UTC day.

**Sort.** `sort` sets the browse order, and the gallery lists the seven in this order: `my-most-connected`, `my-least-connected`, `my-newest-connected`, `my-oldest-connected`, `most-connected`, `newest-created` and `oldest-created`. `my-most-connected` is the default and never written to a URL. The `my-` orders are about the maintainer's own channels: `my-most-connected` and `my-least-connected` sort on `connection_count`, then newest connected first, and `my-newest-connected` and `my-oldest-connected` sort on `connected_at`. `most-connected` counts every connection on Are.na (`total_connection_count`) and breaks ties newest created first; 1,328 of the 2,550 blocks have a total of exactly 1, so that tiebreak orders over half the archive. `newest-created` and `oldest-created` sort on `created_at`. Each ends on `id`; colours lead only the default and otherwise only filter. A text query ranks by relevance, so `sort` beside a ranking with a query is a 400, and the UI drops it from any URL with a query.

**Colour order.** Browse with colours and the default sort sorts by the first colour's weight, then each further colour's, then `connection_count` descending, `connected_at` descending and `id`. That first colour is filtered at a weight of 1, not its threshold, so weaker matches sink down the scroll instead of being cut; `mono` keeps its threshold because near 1000 is what black and white means. The other colours, every other sort and text queries keep the thresholds, since there colour does not set the order. With a text query, relevance keeps the order and colours only filter. A `Sum` of the weights would rank several colours better, but Turbopuffer leaves the order of equal scores undefined and it shifts with `limit`, which paging re-fetches with every page; ending a plain sort on `id` makes it a total order. Turbopuffer sorts on at most 8 attributes, so a request carries at most 5 colours: with the default sort that is 5 weights, the two tiebreaks and `id`, exactly 8.

**Mode.** With no `mode` and a non-empty `q`, the request is hybrid. With no `q` it is browse whatever `mode` says: a ranking chosen before a query is kept in the URL and applies once a query arrives. The UI offers three choices: Best match (hybrid), Exact words (lexical) and Related ideas (semantic), and writes `mode` without a query only for the latter two.

**Paging.** `offset` must be a whole number no larger than `ARCHIVE_MAX_OFFSET` (2000); anything else is a 400. The page size is 24 (`ARCHIVE_RESULT_LIMIT`) and is set by the server. Visitors cannot change it. The server asks Turbopuffer for `offset + limit + 1` rows and drops the first `offset` after de-duplication. If a row is left over, `hasMore` is true, unless `offset + limit` is past 2000. The home page loads the next page through `/api/search` as the reader scrolls. `/` reads `offset` too, but the UI never sends it there.

**Validation** (`src/lib/server/search/request.ts`):

- `q` is at most 400 characters.
- At most 20 `channel` values and 20 `type` values.
- `type` must be `Image`, `Video`, `GIF`, `Web`, `Text`, `Attachment` or `Embed`.
- `colour` must be one of the twelve colours, at most 5 of them. A repeated colour counts once.
- `mode` must be one of the four modes.
- `sort` must be one of the seven orders, and only when the request browses.
- `from`, `to`, `created_from` and `created_to` must look like `YYYY-MM-DD`. Neither range may end before it starts.
- A blank value counts as missing. A form sends every field, so `?q=&from=` is the same as `/`.
- A blank value still counts toward "at most once" for `q`, `mode`, `from`, `to`, `sort` and `offset`. `?from=&from=2024-01-02` is a 400.
- Any other bad value is a 400. It never silently returns nothing.

**Results.** Results are de-duplicated by block id in `executeArchiveSearch`, keeping the first, highest-ranked occurrence, so a block never appears twice.

`/api/search` returns `{ results, hasMore }`, or 400 `{ error }`, or 503 `{ error, correlationId }`. The gallery page shows a search failure as page content with HTTP 200. That keeps the form and its values on screen. Any page that is not `ok` is sent with `cache-control: no-store`, so an outage is never cached.

**Archive size.** The home page also asks Turbopuffer for one `Count` aggregate of the namespace, for the footer. It is cached for ten minutes per Worker isolate (`src/lib/server/search/archive-size.ts`); a failure is logged as `archive_size_unavailable` and the page renders without the count.

**Channel filter list.** The UI cannot list channels by querying Turbopuffer, and a visitor's request may never call Are.na. So `bun run sync` writes the channels it synced to `src/lib/server/indexing/channel-manifest.json`, sorted by slug. The file is committed and bundled at build time. The Channel filter lists every channel in the archive, at no cost per request. The list includes channels that failed in that run, since they may have blocks from an earlier run. It is only written when a sync finishes.

## Reliability and security

- Validate URL query parameters and Are.na responses with Zod at their boundary.
- Return a generic 503 for unavailable Turbopuffer credentials/service; log a correlation ID and provider status, never a token or raw archive response.
- Queries time out after 10 seconds and the SDK retries once. Do not retry client validation errors.
- Rate-limit `GET /` and `GET /api/search` at the edge before Turbopuffer is constructed. The Cloudflare `ARCHIVE_SEARCH_RATE_LIMITER` binding allows 60 requests per minute per `archive-search:<client address>` key (from `cf-connecting-ip`; requests without one share `archive-search:unknown`), shared by both search surfaces. It is local to a Cloudflare location and eventually consistent, so it is an abuse brake rather than an accounting or security boundary. There is no user identity; IP-based keys can group legitimate visitors behind shared networks and are never logged. Local development bypasses an absent binding; a thrown limiter call fails open after a privacy-safe error event. A rejection returns a no-store 429 with `retry-after: 60` (JSON at `/api/search`, minimal retry HTML at `/`).
- Workers observability is enabled with logs and traces persisted at full sampling while traffic is low, and request query strings are redacted. Application telemetry is structured and allowlisted: unavailable search logs only its event name, correlation ID, and provider status; rate-limit logs only their event name, route, and (for rejections) 429 status. Never log a URL, query string, headers, client address, rate-limit key, credentials, provider payload, or raw error.
- Use SSR/server API routes for all provider access. Only public image and Are.na URLs are sent to the browser.
- Escape/avoid raw block HTML. Render normalized text as text.

## Sync lifecycle

`bun run sync` runs `scripts/sync.ts`, which calls `syncArchive`.

1. **Check settings.** The script needs `ARENA_ACCESS_TOKEN`, `TURBOPUFFER_API_KEY` and `TURBOPUFFER_REGION`. It also needs `OPENROUTER_API_KEY`, unless `--no-vision` is set. It rejects unknown flags, because a default run writes to Are.na.
2. **Find and fetch channels.** Look up the token's owner and list their channels. Drop ignored and private ones. Fetch each remaining channel's pages in turn. If the first 3 channels all fail, stop: that is a token problem. Any other failed channel is logged and skipped. A reply that does not match the expected schema stops the run.
3. **Normalize and merge.** Turn blocks into documents. Merge duplicates by Are.na block ID and combine their channels. A block in several channels keeps its newest `connected_at`. Every other field comes from the block itself.
4. **Measure colour.** Unless `--no-colour` is set, the colour stage measures the blocks. See [Colour indexing](#colour-indexing). With `--no-colour`, the existing colour cache is used as is.
5. **Count connections.** Unless `--no-connections` is set, the connections stage asks Are.na how many connections each block has. See [Connection counts](#connection-counts). With `--no-connections`, the existing cache is used as is.
6. **Describe.** Unless `--no-vision` is set, the vision stage describes the blocks. See [Vision indexing](#vision-indexing). With `--no-vision`, the existing cache is used as is.
7. **Write back.** Unless `--no-push-arena` is set, send generated titles and descriptions to Are.na. This uses the cache, so with `--no-vision` it sends what earlier runs made. A block that fails is recorded and the run goes on. If the first 5 writes all fail, the sync stops here, before anything is indexed. This run indexes the titles it fetched; the written titles reach the index on the next sync.
8. **Upsert.** Write documents in batches of 200, with generated text folded into `search_text` and colour weights and connection totals as attributes. Running it again is safe.
9. **Prune.** List every document id in the namespace. That is ids only, ordered by `id`, 10,000 per page. Delete ids that are not in this sync, in batches of 1,000. Pruning runs after the upsert. A failure leaves extra documents, never a half-built index. It also removes blocks from channels that are now ignored or private. A block still in any synced channel is never pruned.
10. **Save and report.** Write the merged colour, connections and vision caches, each only if its stage ran. Write the channel manifest. Print a summary of channels, blocks, upserts, prunes, and connection, vision and write-back counts.

Pruning is skipped, with the reason shown, in these cases:

- A channel failed.
- The sync was aborted.
- No blocks were fetched.
- The delete would remove more than half the namespace. There is no override.

We chose pruning over wiping and reloading. A reload would recompute every embedding, and search would be empty or partial meanwhile.

**Progress output.** Each stage reports in two ways. A `log` callback prints details. A structured event stream (`src/lib/server/indexing/progress/events.ts`) reports the phase, the position and each vision block's life cycle. `scripts/sync.ts` turns the events into a status area that redraws in place. It shows what is running now and how long the oldest block has waited. That is how you tell a stalled request from slow work. The pipeline knows nothing about terminals. Without a TTY, or with `NO_COLOR` set, output falls back to plain lines.

## Connection counts

The channel contents Are.na returns say when a block joined that channel, and nothing about its other connections, so the total comes from one request per block: `GET /v3/blocks/:id/connections?per=1`, read only for `meta.total_count`. That counts every connection the token can see, by the maintainer and by anyone else; Are.na decides what the token can see. The stage lives in `src/lib/server/indexing/connections/`.

- **Cache.** `connections-cache.jsonl` is committed, one entry per block (`block_id`, `total`, `counted_at`), fixed key order, sorted by block id. Unlike colour and vision it cannot be keyed on the block's content, because a total changes while the block does not. An entry is reused until it is a week old (`CONNECTION_COUNT_MAX_AGE_MS`); a routine sync therefore counts only new blocks and the ones that have gone stale. Merge rules match the other caches: entries for blocks that left are dropped unless a channel failed or the run was aborted, and a failure keeps the old entry. The CLI checkpoints every 25 entries.
- **Running it.** 4 workers. The maintainer's tier allows 300 reads a minute, so a first run over about 2,500 blocks is paced to roughly nine minutes whatever the worker count. `countBlockConnections` waits for the window to reset before the allowance runs out, and waits out any 429 it still meets. A block whose request fails is logged, left without an entry and counted again next run.
- **Never below the maintainer's own.** The indexed total is the larger of the cached count and `connection_count`. A block whose count failed, or whose entry predates a new connection of the maintainer's, is therefore ordered by what is certainly true instead of by a stale or missing number.

Turbopuffer fails a query that sorts on an attribute it has never had. Only the Most connected sort orders on `total_connection_count`, so until the first sync that writes it that one option fails while the default browse, which sorts on `connection_count`, keeps working. Sync before deploying code that sorts on a new attribute.

## Vision indexing

Many image blocks have a filename for a title and no description. Text search cannot find them. The vision stage (`src/lib/server/indexing/vision/`) has a model describe each block that has an image. That text is indexed for search.

It runs only during sync. Search itself uses no model, and a result is always the original Are.na block. The gallery never shows the `vision_*` fields. Generated text reaches a reader in one way: write-back puts it on the Are.na block, where it becomes the block's own title or description, and the next sync indexes and shows it like any other.

**Model.** `xiaomi/mimo-v2.5` through OpenRouter. The code uses plain `fetch` and Zod, with no SDK.

- It pins the providers `deepinfra`, `streamlake` and `venice`, and sets `require_parameters: true`. OpenRouter's cheapest route for this model cannot return structured output, so it would sometimes return plain prose.
- Reasoning is off. `max_tokens` is 2,048, which stops a runaway reply.
- A request times out after 240 seconds.
- A 408, 429 or 5xx is retried up to 4 times, with growing waits. `Retry-After` is honoured.
- A timeout gets 2 attempts in all. A request that stalls usually stalls again.

**Input.**

- Stills are not downloaded. Are.na resizes images with a URL that holds a base64 JSON payload. `rendition.ts` rewrites it to fit inside 768 × 768 and the provider fetches that smaller image. A URL that is not an Are.na resizer URL is sent unchanged.
- Skipped: a non-resizable image over 5 MB, and any type except JPEG, PNG, WebP or GIF. An unknown type is let through.
- Animated blocks (`image/gif`) are read as motion. `video.ts` downloads the source and uses ffmpeg to make a silent MP4: at most 512 px wide, 6 fps, CRF 32, killed after 60 s. A source that fails to download or is over 64 MB is skipped, as is an MP4 over 4 MB. The MP4 is sent inline as a data URL.
- The scratch folder is deleted on every exit. A killed run can leave one behind. The next run with animations to describe deletes any that are over an hour old before it starts on them.
- ffmpeg must be on `PATH`. Without it, each animated block fails with a message that names ffmpeg. The run goes on. Use `--no-vision` to skip the stage.

**Prompt and output.** `prompt.ts` holds `PROMPT_VERSION`, the system prompt and a strict JSON schema:

- `title`: at most 70 characters, and never the title we supplied.
- `description`: 200 to 500 characters.
- `ocr`: every readable word.
- `palette`: 3 to 5 hex colours. It is cached but not used: it has no weights, so colour comes from the pixels instead (see [Colour indexing](#colour-indexing)).
- `medium`: one of nine values.
- `tags`: 3 to 8.

The block's type, title, description and source title go along as context, each cut to 400 characters. They are fenced and labelled as untrusted text that must not be obeyed. A reply that copies the supplied title, or whose title is over 140 characters, is rejected. So is a reply that is not valid JSON or fails the schema. A rejected reply is retried within the same budget as a 5xx, and is never cached.

**Cache.** `vision-cache.jsonl` is the record of every description. It is committed, so a fresh clone or a namespace move costs nothing. It has one entry per block, in a fixed key order and sorted by block id, so an unchanged run leaves no diff.

An entry is reused only when all of these match: block id, `image_src_hash`, `prompt_version`, `model` and `input_mode`. The check happens before any network call. `image_src_hash` hashes the resizer payload's bucket and key, not the URL, so changing the width invalidates nothing. To redo one block, delete its line. Changing `PROMPT_VERSION` or the model redoes every block, so check the cost first.

When the cache is merged, entries for blocks that left the archive are dropped. If a channel failed or the sync was aborted, nothing is dropped, since a block in that channel only looks gone. A block whose description failed this run keeps its old entry.

**Running it.** Concurrency is fixed at 32. A description takes 20 to 160 seconds, and speed per worker stays about flat as workers are added. A failed or skipped block is logged and gets no cache entry, so the next run tries it again. The script saves the cache every 25 entries, so an interrupted run loses at most that many.

**Write-back** (`writeback.ts`, and `src/lib/domain/titles.ts`, which the gallery captions also use to skip titles with no information). This is the only code that writes to the maintainer's archive. It is on by default. `--no-push-arena` skips it.

- It only touches blocks the token's owner made. Are.na rejects edits to anyone else's.
- A title is replaced only if it has no information: a filename, a hash, a bare URL, platform boilerplate (`… on X: "…"`, a `(1) ` prefix, `- YouTube`, Instagram), or a title over 80 characters that contains the opening of the description.
- A missing title is filled in. A description is written only if the block has none. A block with no cache entry is skipped.
- Each write also sets `metadata.vision_v`, `vision_at` and `vision_src`.
- Writes are paced at 500 ms, because the free tier allows 120 a minute. A rate-limited block waits as long as Are.na asks, up to 3 times. Any other error fails that block without a retry.
- If the first 5 writes all fail, the sync stops before indexing. This almost always means a read-only token.
- There is no preview and no cap on how many blocks one run writes.

## Colour indexing

The colour stage (`src/lib/server/indexing/colour/`) measures how much of each image is each colour. It runs only during sync, uses no model, and costs nothing but downloads. The decision and its alternatives are in [ADR 0001](./decisions/0001-colour-from-pixels.md); calibration is in [the colour filter spec](./specs/colour-filter.md#calibration).

- **Input.** A still is fetched as a 128px Are.na rendition (`rendition.ts`); an animation on the CDN has no rendition, so its original is fetched. Every download is capped at 64 MB, by `content-length` and again while streaming. Video attachments and embeds are measured from their poster or thumbnail. Formats the vision stage skips are skipped here too.
- **Nothing touches disk.** The bytes are piped to ffmpeg on stdin, which writes 64 × 64 RGBA frames to stdout: the first frame, then one a second, up to 8. Both buffers are dropped once weighed. `runFfmpeg` (`src/lib/server/indexing/ffmpeg.ts`) is shared with `video.ts`.
- **Weights.** Each opaque pixel is classified in OKLCH (`classify.ts`): low chroma is black, grey or white by lightness; the rest go by hue band, with dark or muted warm hues as brown. A weight is that colour's share of the opaque pixels, in per-mille. `mono` is 1000 minus the chromatic share. A block with no image or no measurement weighs 0 everywhere and never matches.
- **Cache.** `colour-cache.jsonl` is committed, one entry per block, fixed key order, sorted by block id. An entry is reused when block id, `image_src_hash` and `COLOUR_VERSION` match; bump the version when the classifier changes. Merge rules match the vision cache: entries for blocks that left are dropped unless a channel failed or the run was aborted, and a failure keeps the old entry. The CLI checkpoints every 25 entries.
- **Running it.** 4 workers. A failed or skipped block gets no entry and is retried next run. ffmpeg must be on `PATH`; without it every block fails with a message naming ffmpeg and `--no-colour`.
- **Calibrating.** `bun run calibrate:colour` lists blocks from Turbopuffer, measures a stable sample and writes a contact sheet outside the repo. It is read-only.

Turbopuffer fails a query that filters or sorts on an attribute it has never had. The `colour_*` attributes are never requested in results, so only a `colour` request is affected, and only until the first sync that writes them. Sync before deploying code that sends `colour`.

## Sources checked

- [Are.na API documentation](https://www.are.na/developers/explore): authentication, tiers, pagination, caching, and rate limits.
- [Turbopuffer vector search](https://turbopuffer.com/docs/vector): native embedding configuration and filtered ANN.
- [Turbopuffer query API](https://turbopuffer.com/docs/query): filters and multi-query support.
- [Turbopuffer write API](https://turbopuffer.com/docs/write): schema behavior, index costs, and migration constraint.
