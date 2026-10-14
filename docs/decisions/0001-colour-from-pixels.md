# 0001: Measure colour from pixels at sync time

Status: accepted; current implementation consolidated on 2026-10-14.

## Decision

Measure colour from image pixels instead of the vision model's unweighted palette. The colour stage fetches a 128px still rendition or an animation source, decodes up to eight 64 × 64 RGBA frames with ffmpeg, and classifies opaque pixels in OKLCH. Store per-mille weights in the committed colour cache, keyed by block ID, image source hash and classifier version.

Browser filters use these weights and shared thresholds. Default browse with colours compares selected weights in order, then the ordinary browse ties, ending with stable block ID. No provider-specific attributes or expression ranking are involved.

## Alternatives and consequences

Palette order cannot reliably express image coverage; asking a model for percentages adds paid generation and uncertainty. A separate native image dependency adds little while ffmpeg is already needed for animation processing. Pixel coverage does not measure visual prominence: a small red logo on a white page has a low red weight.

Four workers perform measurement; skipped/failed images are retried on later runs, preserving old successful entries. Changing the classifier requires a version bump and remeasurement. `--no-colour` reuses existing entries. Threshold-only changes do not require remeasurement.

See [colour indexing](../architecture.md#colour-indexing) for current limits and cache behavior.
