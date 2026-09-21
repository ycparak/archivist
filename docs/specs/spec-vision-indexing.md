# Spec: Vision indexing for blocks with images

**Status:** Ready to build
**Decision record:** [adr-vision-indexing.md](../decisions/adr-vision-indexing.md)
**Tasks:** [TODOS.md](../TODOS.md) — "Vision indexing" group

## Problem

Search is metadata-only, and the metadata is weakest where images are strongest: 915 Image blocks
have 906 titles (almost all upload filenames) and 48 descriptions. Roughly 900 blocks contribute
noise rather than signal to `search_text`, and no visual query can succeed. Full evidence and the
decision rationale are in the ADR; this spec is the build.

## Scope

**In:** every block with an `imageUrl` (2,585 of 2,594) — Image, Link preview cards, Attachment
previews, Embed thumbnails. Generated title, visual description, OCR, palette, medium and tags.
Indexing into Turbopuffer. A committed cache. Are.na write-back for owned blocks.

**Out:** the 9 blocks with no image (6 Text, 3 others); audio; video frame extraction (phase 2);
link crawling; query-time LLM use; UI changes beyond what retrieval already renders.

## Design

### Pipeline placement

One new stage inside [`syncArchive`](../../src/lib/server/indexing/sync.ts), between normalization
and document construction, operating on the deduplicated `blocksById` map so a block in five
channels is considered once:

```
fetch channels → normalize → [vision stage] → toSearchDocument → upsert → prune
                                   ↓
                         vision-cache.jsonl (committed)
                                   ↓
                     optional: PUT /v3/blocks/:id (owned only)
```

The stage is skipped entirely without `--vision`, so existing sync behavior is unchanged by default
until the backfill task flips it on.

### Modules

```
src/lib/server/indexing/vision/
  index.ts        describeBlocks() — the stage entry point, concurrency pool, progress log
  client.ts       OpenRouter adapter: request shape, provider pinning, Zod response validation
  prompt.ts       PROMPT_VERSION, system prompt, JSON schema
  cache.ts        JSONL read/write, skip key, deterministic serialization
  rendition.ts    Are.na image payload decode/re-encode, source key extraction, hashing
  titles.ts       isLowQualityTitle — the four replacement triggers
  writeback.ts    ownership filter, per-type field policy, Are.na PUT
```

Every module is pure and injectable — `fetchFn`, clock and model client passed in — so the whole
stage is testable without network access, matching how `src/lib/server/arena/` is structured.

### Image rendition

`rendition.ts` decodes the base64 payload in an `images.are.na` URL, rewrites
`edits.resize.width/height` to 768, re-encodes, and hands **the URL** to the model. OpenRouter
fetches it, so the sync downloads no image bytes. Base64 upload is the fallback if a provider
rejects remote URLs.

The 134 animated GIFs are served from `d2w9rnfcy7mm78.cloudfront.net` with no edit payload, so
`renditionUrl` returns them untouched and the model sees the first frame. Motion understanding is
phase 2.

**They need a size guard, and 43 of them cannot be processed in phase 1.** An earlier draft assumed
GIFs were ~1 MB and safely under every provider's ceiling. Measuring all 134 non-resizable images:

|           |               |
| --------- | ------------- |
| median    | 2.70 MB       |
| p90       | 11.23 MB      |
| max       | 24.15 MB      |
| over 5 MB | **43 of 134** |
| total     | 615 MB        |

Are.na publishes no smaller rendition for these: `thumb`, `square`, `small`, `medium` and `large`
are all the same CloudFront URL, confirmed against the API for two GIF blocks. Downscaling would
mean decoding and re-encoding locally, which means a native image dependency —
[`AGENTS.md`](../../AGENTS.md) asks that a dependency remove meaningful production code, and this
one would add it for 43 blocks.

So phase 1 **skips** any non-resizable image over `MAX_IMAGE_BYTES` (5 MB, the common provider
ceiling) and reports it, leaving 2,542 of 2,585 blocks processed. The right fix is phase 2's video
input: these are animated GIFs, and sending them as video is both more accurate and the path that
already has a task.

The guard needs no network round-trip — `image.file_size` comes back on the block payload, and is
now carried through `ArchiveBlock.imageBytes`.

Implemented in [`rendition.ts`](../../src/lib/server/indexing/vision/rendition.ts) and verified
against live Are.na: 10 of 10 sampled blocks returned HTTP 200 at width 768, with resizable images
averaging ~70% smaller.

`imageSourceKey(url)` returns the decoded `key` field (e.g.
`49584987/original_2d9ddb6bcb56040702d60239b006789e.png`), falling back to the URL path for
non-`images.are.na` hosts. `image_src_hash` is SHA-256 of that key. **It must not hash the full
URL** — the URL contains the resize width, which is ours and will be tuned; hashing it would
invalidate the entire cache on the first tuning pass.

### Model request

```
POST https://openrouter.ai/api/v1/chat/completions
model:    "xiaomi/mimo-v2.5"
provider: { require_parameters: true, order: ["deepinfra", "streamlake", "venice"] }
reasoning:{ enabled: false }
response_format: { type: "json_schema", json_schema: { strict: true, schema: … } }
```

`require_parameters: true` is mandatory, not defensive. OpenRouter's default route for this model is
GMICloud, which supports neither `structured_outputs` nor `response_format`; without the flag the
pipeline receives prose where it expects JSON, intermittently. The explicit `order` makes runs
reproducible.

Concurrency defaults to **32**, with exponential backoff on 429/5xx and per-block failures recorded
and reported in the sync summary rather than aborting the run.

That default is measured, not assumed. A single description takes 20–160s (mean ~60s) because the
model emits several hundred completion tokens; per-slot throughput stays roughly flat as slots are
added, so wall time scales close to linearly with concurrency. At 8 the full backfill projected to
~16 hours; at 32 it completed in a few. `--vision-concurrency=N` overrides it.

**The prompt carries the block's existing text alongside the image.** The user turn includes the
current title, description and source title (truncated, clearly labelled as untrusted context) so
the model can write a title that accounts for what the block already says. This matters most for
the trigger-4 blocks: a screenshot of a tweet is largely unreadable as pixels alone, but with the
tweet text in hand the model can produce `Live search over 100k paragraphs in 10–30ms` instead of
describing a white rectangle. Cost is ~50 extra input tokens per block.

Two guards, because that context is scraped text the pipeline does not control: it is passed as
data with an explicit instruction that it may be wrong or adversarial and must never be treated as
instructions, and the generated `title` is rejected by validation if it merely reproduces the
supplied title.

### Output schema

```jsonc
{
	"title": "string, ≤70 chars, short and specific, no filename, no platform chrome, not a copy of the supplied title",
	"description": "string, 200–500 chars: subject, composition, palette, typography, medium, mood",
	"ocr": "string, verbatim legible text, empty when none",
	"palette": ["#rrggbb", "…"], // 3–5 dominant colours
	"medium": "photograph|illustration|screenshot|diagram|typography|3d|painting|collage|other",
	"tags": ["string", "…"] // 3–8 lowercase single concepts
}
```

The 200–500 character cap on `description` is a retrieval decision, not a style one — see Risks
below — and it is **enforced in code, not requested**. A first live call returned 640 characters
against a 500-character instruction, so `client.ts` clamps at the last sentence that fits.

`medium` proved the least reliable field in the first live batch: a grainy film photograph came
back as `painting`. It is stored, but nothing should depend on it until its accuracy is measured.

### Cache format

`src/lib/server/indexing/vision-cache.jsonl`, one object per line, sorted by `block_id`, written
atomically after the stage completes. Sorting and key order are deterministic so diffs stay small
and reviewable across runs.

```jsonc
{
	"block_id": "49584987",
	"image_src_hash": "sha256:ab12…",
	"prompt_version": 1,
	"model": "xiaomi/mimo-v2.5",
	"provider": "deepinfra",
	"generated_at": "2026-09-21T14:02:11.000Z",
	"title": "…",
	"description": "…",
	"ocr": "…",
	"palette": ["#1a1a1a"],
	"medium": "screenshot",
	"tags": ["…"]
}
```

**Skip rule.** A block is skipped when a cache line exists and `block_id`, `image_src_hash`,
`prompt_version` and `model` all match. The lookup runs **before any network call**, so a skipped
block costs zero — not a cheap call, no call. A second `bun run sync` immediately after a first
processes zero blocks.

Regeneration happens only when the prompt version is bumped, the model changes, the image on Are.na
is replaced, or `--revision` is passed.

### Turbopuffer schema

Four additive attributes in
[`turbopuffer-schema.ts`](../../src/lib/server/search/turbopuffer-schema.ts):

| Attribute            | Type / index       | Purpose                               |
| -------------------- | ------------------ | ------------------------------------- |
| `vision_description` | string, unindexed  | generated visual description          |
| `vision_ocr`         | string, unindexed  | text read out of the image            |
| `vision_title`       | string, unindexed  | generated title (card copy fallback)  |
| `vision_medium`      | string, filterable | future facet (photo / screenshot / …) |

Adding attributes does not change an existing attribute's type, so **no namespace version bump**.

`search_text` becomes the existing five sources plus `vision_description` and `vision_ocr`, same
whitespace normalization, same deterministic order. Every document therefore re-embeds on the next
upsert — sync already upserts all rows each run.

`vision_title` is indexed for display fallback only; it is not added to `search_text` separately
because the description already contains its content.

### Are.na write-back

`--push-arena` prints a diff and writes nothing. `--push-arena-apply` performs the writes.

Ownership is determined by `block.user.id === me.id` — `can.manage` is not returned on
channel-contents responses. Blocks authored by others are filtered out before any request is built.

Field policy: replace `title` when `titles.ts` classifies the current one as low-quality (or there
is none), write `description` only when empty. Block type is not part of the decision — see the
ADR amendment. A title is only touched when a trigger fires **and** the block is owned **and** a
vision result exists for it.

`isLowQualityTitle(title, description)` fires on any of four triggers. Counts are over the 2,577
titled blocks in the live archive; the union covering blocks with an image is **939**, plus 16
blocks with an image and no title.

| #   | Trigger                   | Test                                                                                                                                                                                                             |   n |
| --- | ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --: |
| 1   | **Filename-shaped**       | media extension (`.jpg .jpeg .png .gif .gifv .webp .avif .tif .tiff .pdf .mp4 .mov .webm`) with or without query junk; CDN fragments `?format=` `?_nc_` `?stp=` `?compress=`; the `(1800×1800)` dimension suffix | 783 |
| 2   | **Opaque token**          | ≤2 whitespace-separated words, ≥20 chars, contains a digit, and only `[\w\-.,:/~%]` — catches hashes, base64 blobs and bare URLs used as titles                                                                  | 308 |
| 3   | **Social boilerplate**    | `on X:`, ` / X` suffix, `^(1) `, `- YouTube` suffix, `on Instagram: `, `• Instagram`                                                                                                                             | 116 |
| 4   | **Verbose and redundant** | length > 80 **and** the block has a description of > 25 chars whose opening the title contains                                                                                                                   |  70 |

Trigger 4 is the X/Twitter case. The title is platform chrome wrapped around a copy of the
description:

> **title:** `Seth Thompson on X: "Searching my library is now fast enough for live searches as I type! Querying 100k paragraphs and 20k figures takes ~10-30ms. The bottleneck is now 600-800ms for multi-modal reranking... https://t.co/sm1Zo9WVyB" / X`
> **description:** `Searching my library is now fast enough for live searches as I type! …`

Length alone is **not** a trigger. A long title that is informative and does not restate its
description is left alone — the goal is a short title over a detailed description, not short titles
for their own sake.

The classifier is unit-tested against real corpus samples in both directions. Positives:
`cleanshot-2025-02-28-at-17.36.56.png`, `G3AldfRbwAA80YA (1024×683)`,
`eyjidwnrzxqioijhcmvuyv9pbwfnzxmilcjrzxkioii1odc2odkv…`,
`digitalassets.tesla.com/tesla-contents/video/upload/f_auto…`, `alexey on X (formerly Twitter): "…"`.
Negatives that must survive: `George Bellows`, `by @henrikruscon`, `Home / X`,
`Vincent van Gogh | L'Arlésienne: Madame Joseph-Michel Ginoux (Marie Julien, 1848-1911)`,
`Screen As Room: An Architectural Perspective on User Interfaces — Christoph Labacher`,
`Subway performer stuns crowd with Fleetwood Mac's "Landslide" - Chicago, Il`.

Writes also set `metadata.vision_v`, `metadata.vision_at`, `metadata.vision_src` as a secondary
marker. Requests are paced through the existing rate-limit machinery in
[`arena/client.ts`](../../src/lib/server/arena/client.ts) and a new `ArenaClient.updateBlock`.

### CLI flags

| Flag                 | Effect                                                                 |
| -------------------- | ---------------------------------------------------------------------- |
| `--vision`           | run the vision stage (off until the backfill task lands)               |
| `--vision-dry-run`   | report how many blocks would be processed and est. cost, spend nothing |
| `--vision-limit=N`   | process at most N uncached blocks this run                             |
| `--revision`         | ignore the cache for every block                                       |
| `--revision=<slug>`  | ignore the cache for one channel                                       |
| `--push-arena`       | print the write-back diff, write nothing                               |
| `--push-arena-apply` | perform the Are.na writes                                              |

The sync summary gains: blocks with an image, cache hits, generated, failed, estimated cost, and
write-back counts.

## Cost

|                                 | tokens/block | cost          |
| ------------------------------- | ------------ | ------------- |
| input (768px image + prompt)    | ~850         | $0.000119     |
| output (structured JSON)        | ~250         | $0.000070     |
| **per block**                   |              | **$0.000189** |
| **full backfill, 2,585 blocks** |              | **≈ $0.49**   |
| incremental sync (~30 blocks)   |              | ≈ $0.006      |

Prompt caching is not used: the system prompt is ~250 tokens, below every provider's minimum
cacheable prefix, so it would never trigger.

## Risks

| Risk                                                                             | Mitigation                                                                                                        |
| -------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Generated prose dilutes retrieval for the 1,494 Link blocks with good human text | 200–500 char cap; baseline and re-run `evaluate:search`; fall back to a separate embedded field if measured worse |
| Default provider route silently returns prose instead of JSON                    | `require_parameters: true` + explicit `order`; Zod validation fails loudly per block                              |
| Reasoning tokens multiply output cost                                            | `reasoning: { enabled: false }` set explicitly                                                                    |
| Cache invalidated wholesale by a rendition tweak                                 | hash the decoded source key, never the URL                                                                        |
| Write-back overwrites good human metadata                                        | per-type policy; Links excluded entirely; dry-run default                                                         |
| Write-back floods the maintainer's Are.na activity feed                          | flagged in the ADR; paced; `--vision-limit` allows staged rollout                                                 |
| A model failure poisons the cache                                                | per-block failures are recorded and skipped, never written as a cache line                                        |

## Validation

1. `bun run evaluate:search` baselined before any schema change; scores recorded in the worksheet.
2. New image-only evaluation cases that fail today and should pass after.
3. Unit tests: rendition decode/re-encode, source-key hashing, skip rule, title heuristic, write-back
   policy, `search_text` composition, response validation. Per `AGENTS.md`, every normalizer and
   mapper gets one.
4. `--vision-limit=25` first, and 25 outputs read by hand before the remaining spend is approved.
5. Full suite: `bun run check`, `lint`, `test`, `build`.

## Open questions

- Should `vision_title` replace a filename title in gallery card copy, or only on Are.na? Deferred
  until the backfill exists and the copy can be judged against real output.
- Is `vision_medium` worth a UI facet? Deferred to phase 2 pending whether the values cluster
  usefully.
