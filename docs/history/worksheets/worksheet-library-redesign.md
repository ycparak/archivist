# Worksheet: library redesign

Design: [design.md](../../design.md). Decision: [0002 pretext](../../decisions/0002-pretext-for-text-layout.md).
TODO entry: "Redesign the gallery as a horizontal library" in [TODOS.md](../../TODOS.md).

Started on `main` (`d5da044`).

## Brief

Rebuild the UI to look like Seth Thompson's [Library](https://library.seththompson.com/), with
ABC Areal for the app face and Newsreader for serif text. Filters: search type, channel, block type,
connected at (a slider), colours and sort by. Lay results out per channel the way the reference lays
out pages per book, with its captions, scroll effects and animation, and use pretext where it does.

## Reference, as inspected

Read from the live site's bundle (Vike + React + Tailwind + framer-motion) and a screen recording.

- Root 14px, 15px from 40rem; body 0.888888rem; Univers Next for the app, FF Meta Serif for the
  search and wordmark. Grey ramp and palette identical to ours.
- `fixed inset-0` page; a horizontal scroller holding a grid of `--column-count` columns
  (2 → 7 at 52/70/88/106/124rem), `px-8 gap-16`, rows `10rem / 1fr / 10rem`.
- Index columns topped with a `border-foreground-detail` rule; lists of `leading-none` links; a
  pretext pass decides how many entries fit each column (`prepare` + `layout` per label).
- Results: a `#D8D8D8` band in units of its height `h`: padding 0.05h, two rows of 0.425h,
  0.05h row gap, h/60 between pages, h/3 between books. Books go on the shorter row. Top row inset
  one column, bottom row `(column − 4rem) / 2`. A 10-segment scale bar top-left.
- Captions above the top row and below the bottom row: book caption with a left rule (title bold,
  authors, year); page caption with `p{n}` bold, a `1lh` gap, three clamped lines with the keyword
  marked yellow/30, started with "… " so the keyword is visible.
- Motion: books fade in from `x: 0.05h` over 400ms on `[.22, 1, .36, 1]`, delayed 60ms per row,
  once in view; captions fade over 250ms after 480ms + 60ms per row. A query smooth-scrolls the
  sheet to the results. A hairline appears on the search field's edge while a caption passes
  under it.

## Changes

- `domain/search.ts`: `sort` (`connections`, `newest`, `oldest`), dropped from any URL with a
  ranking query; `request.ts` rejects it beside a ranking; `repository.ts` sorts by date then `id`.
- `domain/titles.ts`: moved from `server/indexing/vision/` so captions can skip filename titles.
- `styles/`: Newsreader faces; a new theme with the reference's semantic colour roles, dark mode,
  column grid tokens, motion tokens, the `rule` utility and a `spread` variant.
- `components/`: `SearchField`, `ArchiveIndex`, `ConnectedAtSlider`, `Shelf`, `ShelfCover`,
  `ShelfBlock`, `CaptionText`; pure `shelf.ts`, `caption.ts`, `filters.ts`, `index-layout.ts`,
  `reveal.ts`. `SearchForm`, `FilterMenu` and `ResultCard` are gone.
- `routes/`: the sidebar layout is gone; the page composes the sheet, scroll-to-shelf, a wheel that
  scrolls sideways, and per-page shelf grouping for infinite load.

## Checked by hand

In the browser at 1440 × 900, 1200 × 640 and 375 × 812, light and dark:

- Browse shows the filters and the shelf starting in the last column; a query slides to the shelf
  and the top row clears the search field.
- Channel columns split to fit the height with no entry cut (two at 900px tall, three at 640px);
  short viewports spread the other filters over two columns.
- Captions sit above and below the band, bottom-row ones aligned to the bottom; the query is
  marked; the search field's hairline appears once a caption straddles its edge.
- The slider moves by keyboard and commits whole months to `from`.

Not run: a sync. No index change was needed.

## Revision after review

- Channel names drop their leading symbols (`channelLabel`); black and white leave the swatches.
- The footer shows the archive's block count, from a cached Turbopuffer `Count` aggregate, in place
  of the results sentence and timings.
- Pages are 0.34h tall in a 0.425h row; the band is `gray-100`.
- Block type and Colours join the first column; only short viewports spread them to a second.
- Every text box is trimmed (`text-box: trim-both cap alphabetic`) on a 14px line height, with the
  `lines` stack, `--gap-line`, `--gap-paragraph` and `clamp-<n>` keeping a baseline grid. Checked
  in the browser: stacked index lines measure exactly 14px apart, the first and last trimmed.
- Captions use weight 400 only: black headings, `foreground` text.

## Third pass

- `bun run check:classes` (in `bun run lint`) loads the Tailwind design system and fails on any
  class with a canonical spelling, the IntelliSense `suggestCanonicalClasses` rule; AGENTS.md says so.
- Sort has six orders (`newest-created` … `least-connected`); Search type is choosable without a
  query and a request without one browses whatever `mode` says.
- Block type filters a new `kind` attribute (Image, Video, GIF, Web, Text, Attachment, Embed) set
  by `blockKind`; `created_at` became filterable for the Created slider and sorts. Ran
  `bun run sync --no-vision --no-push-arena` to write both: 2,546 documents upserted, 11 images
  measured, 5 stale documents pruned. Read back: every document has a kind (832 Image, 46 Video,
  88 GIF, 1,523 Web, 2 Text, 12 Attachment, 43 Embed); the oldest block was created February 2014.
  `bun run evaluate:search` passes all 15 cases.
- Covers show the channel's symbol; the placeholder is `foreground-elevated`; the annotation
  padding is 16px; the first column no longer clips rings or thumbs.
- Newsreader's ascent and descent are overridden so its capitals centre in the line box; measured,
  the search cap top is 16.4px and the clear icon sits within 0.5px of the cap centre.
