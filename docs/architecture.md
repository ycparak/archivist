# Technical architecture

## Decision summary

**SvelteKit + TypeScript on Cloudflare Workers** (`@sveltejs/adapter-cloudflare`) serves the public app. **Are.na V3** is the source of truth, read only by a manually run sync CLI. The official **Turbopuffer TypeScript SDK** is the sole search datastore: native embeddings and full-text BM25 over one canonical text field, with its `multiQuery` endpoint and reciprocal-rank fusion for hybrid retrieval. A vision model, called only from the sync CLI, describes images so they can be found by what they look like.

## System shape

```text
Maintainer CLI (bun run sync, manual)
  -> Are.na V3 (personal access token)
  -> normalize original block metadata, dedupe across channels
  -> OpenRouter vision model, cached in vision-cache.jsonl (skip: --no-vision)
  -> write generated titles/descriptions back to Are.na (skip: --no-push-arena)
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

Turbopuffer cannot change an attribute's type in place. A breaking change needs a new namespace, such as `arena-blocks-v2`. Change the default in `src/lib/server/search/namespace.ts`, re-run the sync, and record the move in an ADR in [`docs/decisions/`](./decisions/). Changing the embedding model or its size is also a breaking change.

| Attribute            | Type / index                                         | Purpose                                    |
| -------------------- | ---------------------------------------------------- | ------------------------------------------ |
| `id`                 | string, `block:<Are.na id>`                          | document key                               |
| `search_text`        | string, full-text (English, stemmed), native `embed` | the one text field for keyword and meaning |
| `block_type`         | string, filterable                                   | type filter                                |
| `channel_slugs`      | `[]string`, filterable                               | channel filter                             |
| `connection_count`   | uint, filterable                                     | browse order (most connected first)        |
| `connected_at`       | datetime, filterable                                 | browse tiebreak and date filter            |
| `created_at`         | datetime, unindexed                                  | stored, not read                           |
| `title`              | string, unindexed                                    | card text                                  |
| `description`        | string, unindexed                                    | card text                                  |
| `source_url`         | string, unindexed                                    | link to the original source                |
| `arena_url`          | string, unindexed                                    | link to the block on Are.na                |
| `image_url`          | string, unindexed                                    | gallery image, and a video's poster        |
| `image_alt`          | string, unindexed                                    | Are.na's alt text, if any                  |
| `image_width`        | uint, unindexed                                      | image size, so cards hold their space      |
| `image_height`       | uint, unindexed                                      | image size                                 |
| `video_url`          | string, unindexed                                    | playable file for a video attachment       |
| `video_content_type` | string, unindexed                                    | the video's MIME type                      |
| `source_title`       | string, unindexed                                    | where the block came from                  |
| `vision_title`       | string, unindexed                                    | generated title (never shown)              |
| `vision_description` | string, unindexed                                    | generated description (never shown)        |
| `vision_ocr`         | string, unindexed                                    | text read from the image (never shown)     |
| `vision_medium`      | string, filterable                                   | generated medium; unreliable, not read     |
| `vision_tags`        | `[]string`, filterable                               | generated tags; not read back yet          |

`connection_count` is how many synced channels hold the block. `connected_at` is set per channel, so a block in several channels keeps the newest one.

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

Generated text has limits. They run when a block is indexed, because a cache hit never regenerates it:

- A description is cut to 500 characters at a sentence end.
- OCR is cut to 6,000 characters. It is dropped entirely if it is a loop of repeats: 100 or more words with under 10% distinct.
- Tags are lowercase, with hyphens turned into spaces, no repeats, and sorted. This holds in the attribute and in the text.

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

`shared` holds the result limit, the fields to return, and the filters. Lexical and semantic modes send one query each. Browse sends no text query. It sorts by `connection_count`, then `connected_at`, both newest or highest first.

RRF runs inside Turbopuffer, never in our code. It merges two ranked lists without comparing their raw scores.

**Filters.** Only three fields are filtered: `block_type` (`In`), `channel_slugs` (`ContainsAny`) and `connected_at` (`Gte` and `Lte`). Repeated `channel` or `type` values are ORed. Different filters are ANDed. A date covers its whole UTC day.

**Mode.** With no `mode` and a non-empty `q`, the request is hybrid. With nothing at all, it is browse. The UI offers three choices: Best match (hybrid), Exact words (lexical) and Related ideas (semantic). Browse is an empty query.

**Paging.** `offset` is capped at `ARCHIVE_MAX_OFFSET` (2000). The page size is 24 (`ARCHIVE_RESULT_LIMIT`) and is set by the server. Visitors cannot change it. The server asks Turbopuffer for `offset + limit + 1` rows and drops the first `offset` after de-duplication. If a row is left over, `hasMore` is true. The home page loads the next page through `/api/search` as the reader scrolls.

**Validation** (`src/lib/server/search/request.ts`):

- `q` is at most 400 characters. It is required unless `mode` is `browse`.
- At most 20 `channel` values and 20 `type` values.
- `type` must be `Image`, `Link`, `Text`, `Attachment` or `Embed`.
- `mode` must be one of the four modes.
- `from` and `to` must look like `YYYY-MM-DD`. `to` cannot be before `from`.
- A blank value counts as missing. A form sends every field, so `?q=&from=` is the same as `/`.
- A blank value still counts toward "at most once" for `q`, `mode`, `from`, `to` and `offset`. `?from=&from=2024-01-02` is a 400.
- Any other bad value is a 400. It never silently returns nothing.

**Results.** Results are de-duplicated by block id in `executeArchiveSearch`. If both halves of a hybrid query return a block, it appears once, at its better rank.

`/api/search` returns `{ results, hasMore }`, or 400 `{ error }`, or 503 `{ error, correlationId }`. The gallery page shows a search failure as page content with HTTP 200. That keeps the form and its values on screen. Any page that is not `ok` is sent with `cache-control: no-store`, so an outage is never cached.

**Channel filter list.** The UI cannot list channels by querying Turbopuffer, and a visitor's request may never call Are.na. So `bun run sync` writes the channels it synced to `src/lib/server/indexing/channel-manifest.json`, sorted by slug. The file is committed and bundled at build time. The Channel filter lists every channel in the archive, at no cost per request. The list includes channels that failed in that run, since they may have blocks from an earlier run. It is only written when a sync finishes.

## Reliability and security

- Validate URL query parameters and Are.na responses with Zod at their boundary.
- Return a generic 503 for unavailable Turbopuffer credentials/service; log a correlation ID and provider status, never a token or raw archive response.
- Queries time out after 10 seconds and the SDK retries once. Do not retry client validation errors.
- Rate-limit `GET /` and `GET /api/search` at the edge before Turbopuffer is constructed. The Cloudflare `ARCHIVE_SEARCH_RATE_LIMITER` binding allows 60 requests per minute per `archive-search:<client address>` key, shared by both search surfaces. It is local to a Cloudflare location and eventually consistent, so it is an abuse brake rather than an accounting or security boundary. There is no user identity; IP-based keys can group legitimate visitors behind shared networks and are never logged. Local development bypasses an absent binding; a thrown limiter call fails open after a privacy-safe error event. A rejection returns a no-store 429 with `retry-after: 60` (JSON at `/api/search`, minimal retry HTML at `/`).
- Workers observability is enabled with logs and traces persisted at full sampling while traffic is low, and request query strings are redacted. Application telemetry is structured and allowlisted: unavailable search logs only its event name, correlation ID, and provider status; rate-limit logs only their event name, route, and (for rejections) 429 status. Never log a URL, query string, headers, client address, rate-limit key, credentials, provider payload, or raw error.
- Use SSR/server API routes for all provider access. Only public image and Are.na URLs are sent to the browser.
- Escape/avoid raw block HTML. Render normalized text as text.

## Sync lifecycle

`bun run sync` runs `scripts/sync.ts`, which calls `syncArchive`.

1. **Check settings.** The script needs `ARENA_ACCESS_TOKEN`, `TURBOPUFFER_API_KEY` and `TURBOPUFFER_REGION`. It also needs `OPENROUTER_API_KEY`, unless `--no-vision` is set. It rejects unknown flags, because a default run writes to Are.na.
2. **Find and fetch channels.** Look up the token's owner and list their channels. Drop ignored and private ones. Fetch each remaining channel's pages in turn. If the first 3 channels all fail, stop: that is a token problem. Any other failed channel is logged and skipped. A reply that does not match the expected schema stops the run.
3. **Normalize and merge.** Turn blocks into documents. Merge duplicates by Are.na block ID and combine their channels. A block in several channels keeps its newest `connected_at`. Every other field comes from the block itself.
4. **Describe.** Unless `--no-vision` is set, the vision stage describes the blocks. See [Vision indexing](#vision-indexing). With `--no-vision`, the existing cache is used as is.
5. **Write back.** Unless `--no-push-arena` is set, send generated titles and descriptions to Are.na. This uses the cache, so with `--no-vision` it sends what earlier runs made. It runs before the upsert, so a failure here does not cost the upsert.
6. **Upsert.** Write documents in batches of 200, with generated text folded into `search_text`. Running it again is safe.
7. **Prune.** List every document id in the namespace. That is ids only, ordered by `id`, 10,000 per page. Delete ids that are not in this sync, in batches of 1,000. Pruning runs after the upsert. A failure leaves extra documents, never a half-built index. It also removes blocks from channels that are now ignored or private. A block still in any synced channel is never pruned.
8. **Save and report.** Write the merged vision cache, but only if the vision stage ran. Write the channel manifest. Print a summary of channels, blocks, upserts, prunes, and vision and write-back counts.

Pruning is skipped, with the reason shown, in these cases:

- A channel failed.
- The sync was aborted.
- No blocks were fetched.
- The delete would remove more than half the namespace. There is no override.

We chose pruning over wiping and reloading. A reload would recompute every embedding, and search would be empty or partial meanwhile.

**Progress output.** Each stage reports in two ways. A `log` callback prints details. A structured event stream (`src/lib/server/indexing/progress/events.ts`) reports the phase, the position and each vision block's life cycle. `scripts/sync.ts` turns the events into a status area that redraws in place. It shows what is running now and how long the oldest block has waited. That is how you tell a stalled request from slow work. The pipeline knows nothing about terminals. Without a TTY, or with `NO_COLOR` set, output falls back to plain lines.

## Vision indexing

Many image blocks have a filename for a title and no description. Text search cannot find them. The vision stage (`src/lib/server/indexing/vision/`) has a model describe each block that has an image. That text is indexed for search.

It runs only during sync. Search itself uses no model, and a result is always the original Are.na block. The gallery never shows generated text. It reaches a reader in one way: write-back puts it on the Are.na block.

**Model.** `xiaomi/mimo-v2.5` through OpenRouter. The code uses plain `fetch` and Zod, with no SDK.

- It pins the providers `deepinfra`, `streamlake` and `venice`, and sets `require_parameters: true`. OpenRouter's cheapest route for this model cannot return structured output, so it would sometimes return plain prose.
- Reasoning is off. `max_tokens` is 2,048, which stops a runaway reply.
- A request times out after 240 seconds.
- A 408, 429 or 5xx is retried up to 4 times, with growing waits. `Retry-After` is honoured.
- A timeout gets 2 attempts in all. A request that stalls usually stalls again.

**Input.**

- Stills are not downloaded. Are.na resizes images with a URL that holds a base64 JSON payload. `rendition.ts` sets the width to 768 and the provider fetches that smaller image.
- Skipped: a non-resizable image over 5 MB, and any type except JPEG, PNG, WebP or GIF. An unknown type is let through.
- Animated blocks (`image/gif`) are read as motion. `video.ts` downloads the source (64 MB at most) and uses ffmpeg to make a silent MP4: at most 512 px wide, 6 fps, CRF 32, 60 s limit. A result over 4 MB is rejected. The MP4 is sent inline as a data URL.
- The scratch folder is deleted on every exit. A killed run can leave one behind. The next run deletes any that are over an hour old.
- ffmpeg must be on `PATH`. Without it, each animated block fails with a message that names ffmpeg. The run goes on. Use `--no-vision` to skip the stage.

**Prompt and output.** `prompt.ts` holds `PROMPT_VERSION`, the system prompt and a strict JSON schema:

- `title`: at most 70 characters, and never the title we supplied.
- `description`: 200 to 500 characters.
- `ocr`: every readable word.
- `palette`: 3 to 5 hex colours. It is cached but not used.
- `medium`: one of nine values.
- `tags`: 3 to 8.

The block's own title, description and source title go along as context. They are fenced and labelled as untrusted text that must not be obeyed. A reply that copies the supplied title is rejected. A reply that is not valid JSON, or fails the schema, is retried. It is never cached.

**Cache.** `vision-cache.jsonl` is the record of every description. It is committed, so a fresh clone or a namespace move costs nothing. It has one entry per block, in a fixed key order and sorted by block id, so an unchanged run leaves no diff.

An entry is reused only when all of these match: block id, `image_src_hash`, `prompt_version`, `model` and `input_mode`. The check happens before any network call. `image_src_hash` hashes the resizer payload's bucket and key, not the URL, so changing the width invalidates nothing. To redo one block, delete its line. Changing `PROMPT_VERSION` or the model redoes every block, so check the cost first.

When the cache is merged, entries for blocks that left the archive are dropped. A block that failed this run keeps its old entry.

**Running it.** Concurrency is fixed at 32. A description takes 20 to 160 seconds, and speed per worker stays about flat as workers are added. A failed block is logged and gets no cache entry, so the next run retries it. The script saves the cache every 25 entries, so an interrupted run loses at most that many.

**Write-back** (`writeback.ts`, `titles.ts`). This is the only code that writes to the maintainer's archive. It is on by default. `--no-push-arena` skips it.

- It only touches blocks the token's owner made. Are.na rejects edits to anyone else's.
- A title is replaced only if it has no information: a filename, a hash, a bare URL, platform boilerplate (`… on X: "…"`, `- YouTube`, Instagram), or a long title that repeats the description.
- A missing title is filled in. A description is written only if the block has none.
- Each write also sets `metadata.vision_v`, `vision_at` and `vision_src`.
- Writes are paced at 500 ms, because the free tier allows 120 a minute. A rate-limited block waits as long as `Retry-After` says, up to 3 times.
- If the first 5 writes all fail, the sync stops before indexing. This almost always means a read-only token.
- There is no preview and no cap on how many blocks one run writes.

## Changelog and TODO format

`docs/CHANGELOG.md` and `docs/TODOS.md` must keep one consistent format. When you change either file, match the entries already there. Do not invent a new shape.

**`CHANGELOG.md`**

- Everything sits under `## Unreleased`, in `###` groups in this order: `Added`, `Changed`, `Removed`, `Fixed`. Leave out empty groups.
- Newest entries first within a group.
- One bullet per change, on one line, with no blank lines between bullets.
- Write one or two sentences in the past tense. Start with a verb and say what the user sees or does differently.
- Put commands, flags, files and values in backticks.
- If a change needs a re-sync to show up, end with ``Takes effect after `bun run sync`.``

**`TODOS.md`**

- Keep the sections in this order: In Progress, Up Next, Needs Input, Backlog, Done. Write `_(none)_` under an empty one.
- Write each item as `- [ ] **Title.** One sentence.` Use `[~]` and `[x]` as the header describes.
- Link a spec or worksheet at the end of the line when one exists.
- Done items go newest first, and end with the short commit hash in parentheses.

## Sources checked

- [Are.na API documentation](https://www.are.na/developers/explore): authentication, tiers, pagination, caching, and rate limits.
- [Turbopuffer vector search](https://turbopuffer.com/docs/vector): native embedding configuration and filtered ANN.
- [Turbopuffer query API](https://turbopuffer.com/docs/query): filters and multi-query support.
- [Turbopuffer write API](https://turbopuffer.com/docs/write): schema behavior, index costs, and migration constraint.
