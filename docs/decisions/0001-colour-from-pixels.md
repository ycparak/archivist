# 0001: Measure colour from pixels at sync time

- **Status:** accepted
- **Date:** 2026-10-02
- **Spec:** [colour filter](../specs/colour-filter.md)

## Context

The maintainer wants to filter the archive by a few common colours, with colour-filtered results
ranked from the most to the least of that colour. Ranking needs a weight per block per colour.

The vision cache already holds a `palette` for every described block: 3 to 5 hex swatches. They
are unweighted, so a speck of blue counts the same as a blue background. Counting any swatch
matched white in 86% of blocks and blue in 34%; even the first two swatches matched white in 64%.
The order of the swatches only hints at dominance and was never verified.

## Decision

The sync measures colour itself. It fetches each image once (a 128px rendition, or a GIF's original
sampled once a second), decodes it in memory with ffmpeg to 64 × 64 RGBA, and classifies every
pixel in OKLCH. A block's weight for a colour is that colour's share of its opaque pixels, in
per-mille. The weights are cached in the committed `colour-cache.jsonl` and indexed as twelve
filterable `uint` attributes, `colour_<name>`. Filters apply a per-colour threshold at query time.

Browse with colours sorts on the weights as plain attributes ending in `id`, not on a `Sum`
expression. A read-only spike showed Turbopuffer's expression ranking leaves ties unordered, with
the order varying by `limit`. It cannot take a secondary sort, and its scores are 32-bit floats.
The paging re-fetches with a growing `limit`, so ties at a page edge would show a block twice or
drop it.

## Alternatives

- **Weights from the palette's order** (first swatch heaviest). Free, but only five coarse levels,
  resting on an unverified assumption.
- **Ask the model for percentages.** Bumping `PROMPT_VERSION` re-describes all ~2,540 blocks at 20
  to 160 seconds each, and a model's estimate of coverage is still a guess.
- **A native image library such as sharp.** It would decode without a subprocess, but adds a
  dependency where ffmpeg, already required for animations, does the job.

## Consequences

- The sync now downloads images itself, at 4 workers, and only for blocks not already cached. Each
  image is held in memory and dropped; nothing is written to disk.
- ffmpeg becomes needed for colour as well as for animations. `--no-colour` skips the stage and
  indexes the cache as is.
- Colour is share of the image, not visual prominence: a small red logo on a white page scores low
  for red.
- With several colours chosen, browse orders by the first colour and breaks ties on the rest,
  rather than by their sum.
- Filtering on an attribute Turbopuffer has never had fails the query, so the sync must write the
  attributes before code that sends `colour` is deployed.
- Changing the classifier means bumping `COLOUR_VERSION` and re-downloading every image: minutes,
  and no cost.
