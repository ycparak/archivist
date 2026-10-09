# Architecture

Archivist is a SvelteKit app on Cloudflare Workers. Are.na V3 is the source of truth; manual sync creates a public static search release. MiniSearch, metadata and chunk vectors run in a browser Web Worker. No Turbopuffer code or service is required.

## Data access

The default gallery is prerendered from a checked bootstrap snapshot. After mount, URL state drives browser search and paging. Public requests never proxy Are.na. JavaScript is required for interactive search/filtering. The retired /api/search returns 410; /api/embedding accepts bounded query text and returns a versioned normalized Workers AI vector. Rate limiting fails closed for embeddings.

## Retrieval behavior

Canonical search_text contains the normalized title, description, source text, cached vision description, OCR and tags. MiniSearch ranks lexical matches. Semantic retrieval computes exact cosine similarity over all eligible chunk vectors and aggregates the maximum score per original block. Hybrid fuses full ranked lists with RRF (k=60). Filter before ranking; preserve type/channel OR, colour AND, UTC dates, colour thresholds and stable ID tiebreaks. Paging uses the full ranking rather than a top-100 cap.

## Releases and sync

Public-only discovery excludes all private channels and refuses incomplete or empty exports. Releases contain checked metadata, serialized lexical index, Float32 vector shards and a first-page bootstrap. Stage immutable content-hashed releases before atomically replacing the manifest. Retain previous versions for open browser sessions. Static files and the local embedding cache are ignored by Git; generate them before building/deploying.

Run bun run export:search for cached descriptions/colours/connections without any Are.na write-back or vision generation. Full sync optionally refreshes these caches and writes generated descriptions back to Are.na, then publishes the same release format. Cloudflare REST credentials are local CLI inputs; deployed query inference uses the AI binding.

See [browser search decision](./decisions/0004-browser-search.md) and [removal decision](./decisions/0005-remove-turbopuffer.md). Free operation depends on Workers/Workers AI allocations. Current limitations: widget-grid fixture expected block ranks 112; physical mobile performance remains unmeasured.

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
- **Calibrating.** `bun run calibrate:colour` lists blocks from the search snapshot, measures a stable sample and writes a contact sheet outside the repo. It is read-only.

the search snapshot fails a query that filters or sorts on an attribute it has never had. The `colour_*` attributes are never requested in results, so only a `colour` request is affected, and only until the first sync that writes them. Sync before deploying code that sends `colour`.

## Sources checked

- [Are.na API documentation](https://www.are.na/developers/explore): authentication, tiers, pagination, caching, and rate limits.
- [the search snapshot vector search](https://search snapshot.com/docs/vector): native embedding configuration and filtered ANN.
- [the search snapshot query API](https://search snapshot.com/docs/query): filters and multi-query support.
- [the search snapshot write API](https://search snapshot.com/docs/write): schema behavior, index costs, and migration constraint.
