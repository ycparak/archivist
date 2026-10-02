# Colour filter

Filter the archive by colour, and rank colour-filtered browse results by how much of each image is
that colour. This spec covers the data and query side only; the UI comes later.

## Decisions

- **Colours.** `red`, `orange`, `yellow`, `green`, `blue`, `purple`, `pink`, `brown`, `grey`,
  `black`, `white`, and `mono` (shown as "Black & white": the image has no meaningful colour).
  The UI may hide `black` / `white` later if their results turn out polluted; the grammar keeps
  them either way.
- **Multiple colours are ANDed**, unlike `channel` and `type`. `?colour=blue&colour=orange` means
  blocks with both.
- **Weights come from pixels**, measured at sync time. The vision model's `palette` is unweighted
  (3-5 swatches, all equal), so it cannot rank. Asking the model for percentages would regenerate
  every block and still be a guess.
- **Ranking.** Browse with colours ranks by colour weight, highest first. With several colours,
  the first one chosen leads and the rest break its ties (see [Query](#query) for why it is not a
  sum). With a text query, relevance keeps the order and colour only filters.

## Weights

For each block with an image, the sync measures the share of the image in each colour, as a
per-mille `uint` (0-1000).

- Decode to a 64 × 64 RGBA raster and classify each opaque pixel in OKLCH
  (`colour/classify.ts`). Chroma under 0.045 is neutral, split by lightness into `black` (under
  0.33), `white` (over 0.93) and `grey`. Chromatic pixels go by hue band. `brown` takes the warm
  hues (30-85°) when they are dark (lightness under 0.6) or muted (chroma under 0.09), which also
  catches tan and beige. Transparent pixels are ignored.
- `mono` = 1000 − the total chromatic share, so a fully black-and-white image scores 1000.
- A block with no image, or one that could not be measured, has every weight at 0 and never
  matches a colour filter.

### Media

| Block                                | Measured from                                                                                     |
| ------------------------------------ | ------------------------------------------------------------------------------------------------- |
| Still image (JPEG, PNG, WebP)        | A 128px Are.na resizer rendition via `rendition.ts`; a non-resizer URL is fetched as is           |
| Animated GIF                         | The original (Are.na publishes no smaller rendition): the first frame, then one a second, up to 8 |
| Video attachment                     | Its poster, `image_url`; the video file itself is not downloaded                                  |
| Link / Embed / Attachment with image | Its thumbnail or screenshot, `image_url`                                                          |
| SVG, other types                     | Skipped, as in the vision stage                                                                   |

Every download is capped at 64 MB, the same ceiling `video.ts` uses, checked against
`content-length` and again while streaming.

### Nothing touches disk

The image is fetched into memory, piped to `ffmpeg` on stdin, and the raw RGBA raster is read
back from stdout (`-f rawvideo -pix_fmt rgba pipe:1`). No file is written, so there is nothing
to delete and no scratch folder to sweep. The fetched bytes and the raster go out of scope as soon
as the weights are computed.

`runFfmpeg` lives in `src/lib/server/indexing/ffmpeg.ts`, shared with `video.ts`, and pipes stdin
and stdout. Its `FfmpegMissingError` names both `--no-vision` and `--no-colour`.

## Colour cache

`src/lib/server/indexing/colour-cache.jsonl`, committed. It follows the vision cache's rules:

- One entry per block, fixed key order, sorted by block id, so an unchanged run leaves no diff.
- Reused when `block_id`, `image_src_hash` and `colour_version` all match. `COLOUR_VERSION` is
  bumped when the classifier's boundaries change; that re-measures every block, which costs
  downloads but no money.
- Entries for blocks that left the archive are dropped, except when a channel failed or the sync
  was aborted.
- Saved every 25 entries, and only when the stage ran.

Entry: `block_id`, `image_src_hash`, `colour_version`, `frames` (1 for a still),
`measured_at`, and `weights` (one per-mille value per colour, all twelve required).

## Sync stage

A new colour stage (`src/lib/server/indexing/colour/`) runs after normalize, alongside the vision
stage and independent of it. `--no-colour` skips measuring and uses the cache as is.

- Concurrency is low (4) to stay well clear of "systematic downloading". Only uncached blocks are
  fetched, so after the first run a sync downloads only new or changed images.
- A failed or skipped block is logged and gets no entry, so the next run retries it.
- The summary reports measured, cached, skipped and failed counts.

## Index

Twelve new attributes, `colour_red` … `colour_white` and `colour_mono`, each
`{ type: 'uint', filterable: true }`. They are new attributes, not type changes, so the namespace
stays `arena-blocks-v1`. Every sync writes them from the cache, even with `--no-colour`, as the
`vision_*` fields are.

They are never added to `include_attributes` and never enter `search_text`: the generated
descriptions already name the palette in prose.

## Query

- **Grammar** (`src/lib/domain/search.ts`): `ARCHIVE_COLOURS` and a repeated `colour` parameter.
  `ArchiveSearchState` gains `colours`; `toArchiveSearchHref`, `readArchiveSearchState` and
  `hasActiveFilters` follow.
- **Validation** (`request.ts`): `z.enum(ARCHIVE_COLOURS)`, deduplicated, at most
  `ARCHIVE_MAX_COLOURS` (5).
- **Filter** (`buildSearchFilters`): one `['colour_<name>', 'Gte', threshold]` per selected
  colour, inside the existing `And`. The colour that leads a default browse uses a threshold of
  1 instead (any of it at all), because ranking already sinks weak matches to the end of the
  scroll; `mono` is the exception and keeps its own. Thresholds live in query code, so they are tuned without a
  re-sync. `mono` has its own strict threshold (near 1000), which is what "no meaningful colour"
  means.
- **Browse ranking**: with colours selected, a plain attribute sort:
  `[['colour_<first>', 'desc'], …the other selected colours, ['created_at', 'desc'], ['id', 'asc']]`.
  Turbopuffer allows 8 sort attributes, which is where the cap of 5 colours comes from.
- **Text queries**: lexical, semantic and hybrid keep their current `rank_by`; colours only add
  filters. Fusing a colour ranking into RRF is deferred until relevance-only ordering is shown to
  fall short.

### Why not `Sum`

Ranking by the sum of the selected weights
(`['Sum', [['Attribute', 'colour_blue'], ['Attribute', 'colour_orange']]]`) works, but it cannot
page. Turbopuffer leaves the order of equal scores undefined, and the spike showed it: a 49-row
query was not a prefix of a 200-row query. Paging re-fetches `offset + limit + 1` rows, so a tie at
a page edge would show a block twice or never. Ties are common: every fully black-and-white image
has `mono` = 1000. An expression ranking cannot take a secondary sort (the API returns 422), and its
scores are 32-bit floats, too coarse for a tiebreak term small enough never to outrank a real
weight. A plain attribute sort ending in `id` is a total order, so it pages cleanly.

## Turbopuffer spike (answered)

Read-only queries against `arena-blocks-v1`, 2 October 2026, with `connection_count` and
`image_width` standing in for colour attributes:

1. `rank_by: ['Sum', [['Attribute', …], …]]` works with no BM25 term, alongside filters, and on
   unfilterable attributes too.
2. Tie order is not stable across `limit`, and Turbopuffer documents it as undefined. Hence the
   plain sort above.
3. A filter or rank on an attribute that was never written fails the whole query with a 400
   (`filter error in key colour_blue: attribute not found`). Until the sync writes the attributes, a
   `?colour=` URL returns the search-unavailable page. The sync must run before the code is
   deployed.

## Calibration

`bun run calibrate:colour [--sample 300] [--out path]` is read-only. It lists blocks and their
`image_url` from Turbopuffer, measures a stable sample the way the sync does, and writes an HTML
contact sheet outside the repo: the 20 strongest blocks per colour, and the blocks either side of
each threshold.

Run on 400 blocks, 2 October 2026, with the thresholds in `colour-filter.ts`:

| Colour | Threshold | Match | Colour | Threshold | Match |
| ------ | --------- | ----- | ------ | --------- | ----- |
| red    | 50‰       | 3%    | pink   | 50‰       | 1%    |
| orange | 50‰       | 1%    | brown  | 50‰       | 18%   |
| yellow | 50‰       | 6%    | grey   | 150‰      | 52%   |
| green  | 50‰       | 6%    | black  | 150‰      | 36%   |
| blue   | 50‰       | 11%   | white  | 150‰      | 56%   |
| purple | 50‰       | 4%    | mono   | 995‰      | 39%   |

What the sheet showed:

- The strongest results for green, yellow, blue, brown and mono are what the name promises:
  green products and forests, yellow packaging, wood interiors, genuinely black-and-white pages.
- Shares are small. The archive is mostly screenshots on white or black, so a strongly red image
  is 10-15% red. That is why chromatic thresholds sit at 5%.
- Skin in flash photographs counts towards red. Accepted: ranking puts genuinely red images first.
- Mono at 980‰ let in images with a clear accent (a red tag, purple UI); 995‰ (about 20 of 4,096
  pixels) keeps them out.
- Dark yellow first read as brown and put yellow bottles in brown; brown's hues now stop at 85°.
- White and black are dominated by UI screenshots, as predicted. Whether to show them is a UI
  decision.

Retuned the same day: the chromatic thresholds dropped from 50‰ to 10‰, and the colour that
leads a default browse is no longer thresholded at all (see [Query](#query)). Across all 2,542
measured blocks, 10‰ matches 5% (pink) to 30% (brown) of the archive; any amount at all would
match 19% (orange) to 46% (brown), which is why the floor stays where colour only filters.

## Rule and doc changes

- `AGENTS.md` search invariants: filters grow from `block_type`, `channel_slugs`, `connected_at`
  to include the `colour_*` attributes; browse may rank by colour weight.
- `docs/architecture.md`: schema table, system shape, sync lifecycle (new stage and cache file),
  retrieval behaviour (filter and ranking), validation list; note that `palette` remains cached
  and unused.
- ADR in `docs/decisions/`: the sync now downloads images itself, and why pixels were chosen over
  the model's palette.

## Tests

- Classifier: known colours at and around each boundary, pure neutrals, `mono` arithmetic.
- Raster to weights: a synthetic buffer with known shares.
- Extraction with a fake fetch and a fake ffmpeg runner: stills, animations, skips, failures.
- Cache: hit rules, merge and drop rules, stable serialisation.
- `toSearchDocument`: weights present, absent, partial.
- Grammar round-trip, request validation, `buildSearchFilters`, browse `rank_by` with colours.

## Sync run

This measures every image and writes the attributes, with no model calls and no Are.na write-back.
Agents may run it (see `AGENTS.md`). It first ran on 2 October 2026: 2,542 measured, 1 SVG skipped,
no failures.

```sh
bun run sync --no-vision --no-push-arena
```
