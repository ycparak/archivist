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

- Decode to a small RGB raster (about 64 × 64) and classify each pixel in OKLCH. Low chroma is
  neutral, split by lightness into `black` / `grey` / `white`. Chromatic pixels go by hue, with
  `brown` taken from the orange-yellow hues at low lightness. All boundaries are calibrated, not
  guessed (see [Calibration](#calibration)).
- `mono` = 1000 − the total chromatic share, so a fully black-and-white image scores 1000.
- A block with no image, or one that could not be measured, has every weight at 0 and never
  matches a colour filter.

### Media

| Block                                | Measured from                                                                                                   |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| Still image (JPEG, PNG, WebP)        | A small Are.na resizer rendition via `rendition.ts`; a non-resizer URL is fetched as is, with the 5 MB cap      |
| Animated GIF                         | The original (Are.na publishes no smaller rendition, 64 MB cap as in `video.ts`), about 8 frames sampled evenly |
| Video attachment                     | Its poster, `image_url`; the video file itself is not downloaded                                                |
| Link / Embed / Attachment with image | Its thumbnail or screenshot, `image_url`                                                                        |
| SVG, other types                     | Skipped, as in the vision stage                                                                                 |

### Nothing touches disk

The image is fetched into memory, piped to `ffmpeg` on stdin, and the raw `rgb24` raster is read
back from stdout (`-f rawvideo -pix_fmt rgb24 pipe:1`). No file is written, so there is nothing
to delete and no scratch folder to sweep. The fetched bytes and the raster go out of scope as soon
as the weights are computed.

`video.ts` only runs ffmpeg file-to-file today. Its `runFfmpeg` moves to a shared
`src/lib/server/indexing/ffmpeg.ts` and gains stdin/stdout piping. `FfmpegMissingError` stops
naming `--no-vision` as the only way out.

## Colour cache

`src/lib/server/indexing/colour-cache.jsonl`, committed. It follows the vision cache's rules:

- One entry per block, fixed key order, sorted by block id, so an unchanged run leaves no diff.
- Reused when `block_id`, `image_src_hash` and `colour_version` all match. `COLOUR_VERSION` is
  bumped when the classifier's boundaries change; that re-measures every block, which costs
  downloads but no money.
- Entries for blocks that left the archive are dropped, except when a channel failed or the sync
  was aborted.
- Saved every 25 entries, and only when the stage ran.

Entry: `block_id`, `image_src_hash`, `colour_version`, `input_mode` (`image` | `animation`),
`generated_at`, and `weights` (one per-mille value per colour).

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
  colour, inside the existing `And`. Thresholds live in query code, so they are tuned without a
  re-sync. `mono` has its own strict threshold (near 1000), which is what "no meaningful colour"
  means.
- **Browse ranking**: with colours selected, a plain attribute sort:
  `[['colour_<first>', 'desc'], …the other selected colours, ['connection_count', 'desc'], ['connected_at', 'desc'], ['id', 'asc']]`.
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

A read-only script lists blocks and their `image_url` from Turbopuffer, measures a sample of a few
hundred, and writes an HTML contact sheet (not committed) of the top 20 blocks per colour by weight,
plus blocks just above and below each threshold. It settles the OKLCH boundaries, the thresholds,
and whether `black` / `white` are worth showing. Measuring the whole archive is left to the sync.

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

## Maintainer run

After the index slice lands, run this to measure every image and write the attributes, with no
model calls and no Are.na write-back:

```sh
bun run sync --no-vision --no-push-arena
```
