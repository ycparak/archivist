# 0002: Measure text layout with pretext

- **Status:** accepted
- **Date:** 2026-10-02

## Context

The redesign puts the filters in fixed-height columns, as the reference site does. The channel list
(74 titles, several wrapping to two lines) has to flow into as many columns as the viewport height
needs, without cutting an entry in half. Captions clamp to three lines, and a caption whose keyword
falls past the clamp has to start partway through so the keyword stays visible.

Both need to know how text will wrap before it is laid out. Doing that with the DOM means
rendering every entry, reading its height and re-rendering, which costs a layout per title on every
resize. CSS multi-column flows a list sideways, but splits entries across columns and gives no
control over where a column ends.

## Decision

Add `@chenglou/pretext`, a dependency-free library that segments and measures text with canvas
metrics and computes line breaks in plain arithmetic. The UI uses it in two places, both in
`src/lib/components/index-layout.ts`: wrapped label heights for packing the channel columns, and
natural widths for the caption lead-in. The reference site uses the same library for its index.

## Consequences

- The channel split is decided in one pass over cached measurements, with no layout reads per
  entry. It runs after `document.fonts.ready` and on resize.
- The server renders the channel list in one clipped column; the browser splits it after fonts
  load, so the columns settle a moment after first paint. The page keeps a reader parked at the
  shelf when that happens.
- Canvas metrics ignore the Areal `ss09` feature and variation settings, so a pixel is shaved off
  every measured width to absorb rounding.
- pretext is pre-1.0 (0.0.9). Its use is confined to one module, so replacing it is a contained
  change.
