# Design

The visual system for Archivist's UI. Read this before any UI work and keep it current: if a change
alters a token, a measurement, a motion or a layout rule below, update this file in the same task.

The design is modelled closely on Seth Thompson's [Library](https://library.seththompson.com/): a
single horizontally scrolling sheet, a quiet grey index of filters on the left, and a grey shelf
on the right where results sit like books with their pages laid out beside them. Archivist departs
from it in a few places: the type is ABC Areal and Newsreader, books become Are.na channels, the
index lists our filters instead of subject headings, the band is a pale grey, every text box is
trimmed to cap height and baseline, and captions use one weight.

## Principles

- **One sheet, scrolled sideways.** The page never scrolls vertically. Everything lives on one
  horizontal strip inside `[data-shelf-scroller]`: the filter index first, then the shelf. A vertical
  mouse wheel scrolls it sideways.
- **The archive is the colour.** Chrome is white, grey and black. Colour comes from the blocks and,
  sparingly, from the colour swatches and the keyword highlight.
- **Grey until it matters.** Text is grey (`foreground`) by default and turns black
  (`foreground-strong`) when it is chosen, hovered or heads something: active filters, caption
  headings, the query. Filter state stays typographic; action buttons use the shared capsule surface.
- **Measured, not guessed.** Layout lengths derive from the shelf height or the column grid, never
  from one-off pixel values. Text that has to fit is measured with pretext before it is laid out.
- **URL-backed browser search.** Filters remain links and search uses a GET form. Interactive filtering/search requires JavaScript; the default gallery is prerendered.

## Type

| Role            | Family     | Size                               | Line height | Use                                        |
| --------------- | ---------- | ---------------------------------- | ----------- | ------------------------------------------ |
| Body / app      | ABC Areal  | `text-body` / `text-base` (13.2px) | 15px        | Filters, captions, footer counts, messages |
| Search          | Newsreader | `text-2xl` (1.5rem)                | 2rem        | The search field only                      |
| Wordmark        | Newsreader | `text-3xl` (1.875rem)              | 1.2         | "Archivist" in the footer                  |
| Channel cover   | Newsreader | `11cqw` of the cover               | 1.1         | Channel title on a shelf cover             |
| Text block page | Newsreader | `6.5cqw` of the page               | 1.35        | The body of a Text block set as a page     |

- The root size is **14px**, and **15px** from 40rem up. Serif sizes and shelf geometry retain these responsive rem values. Sans body type is fixed at
  **13.2px / 15px**, matching yusufparak. Utility spacing uses a fixed **4px** unit.
- All sans text sits on a **15px** line height.
- Weight is 400, including filter headings, which use `foreground-strong` to match Yusufparak hierarchy. Captions use one weight, 400. There is no medium, no italic in the chrome, no letter-spacing.
- Serif means Newsreader (`font-serif`), and only for the roles above. Everything else is Areal
  (`font-app`, which is also `font-sans`).
- Fonts are self-hosted in `static/fonts/` and declared in `src/styles/fonts.css`.

### Trimmed text

Every element has `text-box: trim-both cap alphabetic` (a base rule on `:where(*)`), so a text
box runs from the cap height of its first line to the baseline of its last. Spacing is therefore
measured from ink, and has to be set to keep a baseline grid:

- **Stacked lines** (a heading over its options, a list of links, footer counts) go in a `lines`
  container: a block whose children keep whole 15px line boxes (`text-box-trim: none`) while the
  container trims its outer edges. Lines then fall exactly 15px apart. Flex and grid containers do
  not trim, so a stack must be a block.
- **Separate boxes** in a flex column are spaced with `gap-(--gap-line)` (`1lh − 1cap`) to read as
  the next line, or `gap-(--gap-paragraph)` (`2lh − 1cap`) for one blank line between.
- **Clamped text** uses `clamp-<n>`, not `line-clamp-<n>`. A clamped box keeps its last visible
  line box whole, so the utility trims only the start, cuts later lines with a `clip-path` at that
  line box's bottom, moved to `--clip-below-baseline` (below the deepest descender, above where
  the next line's letters begin), lets ascenders above the trimmed top show, and pulls the
  following content up by `--line-below-baseline` so the box lays out as if trimmed to its
  baseline. Overflow clipping with a margin cannot do this: at 15px
  Areal leaves about 1.5px between one line's descenders and the next line's capitals.
- **Other clipped text** uses `clip-trimmed`, which clips at the same place below the baseline,
  and only at the bottom: a column of controls is never clipped at all, so focus rings, selected
  swatch rings and slider thumbs can reach past it.
- Both variables come from each font's metrics. Areal: ascent 0.88em, descent 0.21em, so
  `--line-below-baseline` is `0.5lh − 0.335em` and `--clip-below-baseline` 0.27em. Newsreader, as
  overridden: ascent 0.98em, descent 0.26em, so `0.5lh − 0.36em` and 0.3em, both set by
  `font-serif`. A new typeface needs its own values.
- **Newsreader's metrics are overridden** in `fonts.css` (`ascent-override: 98%`,
  `descent-override: 26%`) so its capitals sit centred in the line box: ascent minus cap height
  equals descent. A caret and a selection then centre on the text. Trimmed text does not move,
  since trimming measures from cap height and baseline.
- `mark`, the search form and its textarea keep `text-box: normal`: a highlight paints its whole
  line, and trimming the line that holds a field only shifts the field. The field is lowered by
  `annotation padding − (1lh − 1cap) ÷ 2`, so its cap height lands on the annotation padding,
  level with the top-row captions. The clear button uses the 26px capsule action primitive; its 14px icon centres on the
  search capitals independently of its sans body typography.

## Colour

All colours are tokens in `src/styles/globals.css`. Components use the **semantic roles**, never the
raw ramp, except for the fixed swatch and page colours noted below.

| Role                          | Light    | Dark     | Use                                                            |
| ----------------------------- | -------- | -------- | -------------------------------------------------------------- |
| `background`                  | white    | black    | Page                                                           |
| `backdrop`                    | gray-100 | gray-900 | Reserved for raised surfaces                                   |
| `foreground-secondary-detail` | gray-300 | gray-800 | Hairlines: cover-caption rule, search-field edge, slider track |
| `foreground-secondary`        | gray-400 | gray-750 | Unavailable options                                            |
| `foreground-detail`           | gray-500 | gray-650 | Column rules, swatch outlines                                  |
| `foreground`                  | gray-550 | gray-600 | Default text: filters, caption text, messages                  |
| `foreground-elevated`         | gray-600 | gray-550 | Icons (the clear button), the search placeholder               |
| `foreground-strong`           | black    | white    | Active filters, hover, caption headings, query, wordmark       |
| `band`                        | gray-100 | gray-100 | The shelf band, in both schemes                                |

- Dark mode follows `prefers-color-scheme` by swapping the role variables on `:root`. The band stays
  pale grey and pages stay white in dark mode.
- Pages, covers and text blocks are always `bg-white` with black text: they are objects on the
  shelf, not chrome.
- The keyword highlight is `mark`: yellow at 30% under black text.
- Selection is blue with white text.
- Swatches use the palette tokens: `red`, `paprika` (orange), `yellow`, `green`, `blue`, `lilac`
  (purple), `brown`, `gray-500` (grey) and a black-and-white diagonal with a `foreground-detail`
  outline for mono. They sit in a nine-column grid, `gap-1.75`, filling the column's width, so two
  selected neighbours keep clear of each other's rings. A selected swatch's ring is its own colour
  (`foreground-strong` for mono), 1px with a 2px offset. Pink, black and white are never offered,
  even when a URL asks for one; the URL still filters by it.

## Layout

### The sheet

```
┌ search field (fixed, top-left, one column wide) ─┐
│ Search...                                        │      top-row captions ──────────▶
├──────────────────────────────────────────────────┼─────────────────────────────────────
│ ─────────  ─────────  ─────────                  │ ▇▇▇▇▇▇ shelf band (grey) ▇▇▇▇▇▇▇▇▇
│ Search type Channel    Channel                   │  ▬ ▬ ▬ ▬ ▬      [cover][p][p][p]   …
│ Sort by    …          …                          │  [cover][p][p]        [cover][p] …
│ Connected                                        │ ▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇
│ Block type                                       │      bottom-row captions ───────▶
│ Colours                                          │
│ Archivist   74 channels / 2,546 blocks           │
└──────────────────────────────────────────────────┴─────────────────────────────────────
```

- The page is `fixed inset-0`. Below 40rem it is a column: the search field (`h-12`) on top, the
  scroller below. From 40rem the search field floats over the scroller's top-left.
- The scroller is a `container-type: size` element, so `cqi` and `cqh` inside it mean the viewport
  of the sheet. It holds `flex h-full w-max`: the index, then the shelf after `--column-gap`.
- Both the index and the shelf are three rows: `--annotation-area-height` (up to 10rem), the rest, and
  `--annotation-area-height` again. The top row of the index is under the search field; the bottom
  row holds the footer.

### The column grid

| Token                      | Value                                                                     |
| -------------------------- | ------------------------------------------------------------------------- |
| `--column-count`           | 2; 3 from 52rem; 4 from 70rem; 5 from 88rem; 6 from 106rem; 7 from 124rem |
| `--page-gutter`            | 2rem (left padding of the sheet, padding of the search field)             |
| `--column-gap`             | 4rem                                                                      |
| `--column-width`           | `(100cqi − 2 × gutter − (count − 1) × gap) ÷ count`                       |
| `--annotation-area-height` | `clamp(4rem, (100svh − 28rem) / 2, 10rem)`                                |
| `--annotation-padding`     | 16px: the page's vertical padding (search, captions, footer)              |

Breakpoint rems in media queries resolve against the browser's 16px, not the root size.

### The index

- Each column is `w-(--column-width)`, topped with the `rule` utility (a `foreground-detail`
  border, `pt-3 mt-1`), and stacks lists `gap-(--gap-paragraph)` apart, one blank line.
- A list is a regular `foreground-strong` heading over its options. An option is a link: `foreground`, black
  on hover, black and `aria-current="true"` when active. An option that cannot apply to the
  current search (browse order beside a query, a sixth colour) is a non-link span in
  `foreground-secondary` with `aria-disabled`. Search type is always choosable: without a query
  the choice is kept in the URL for the next search, and Best match shows as active by default.
- **Filters, in order:** Search type (Best match, Exact words, Related ideas); Sort by (My most
  connected, My least connected, My newest connected, My oldest connected, Most connected, Newest
  created, Oldest created; the first is the default);
  Connected and Created, each a two-thumb month slider (`DateRangeSlider`); Block type (Image,
  Video, GIF, Web, Text, Attachment, Embed); Colours.
- **Arrangement.** All of them share the first column. The `spread:` variant (viewports under
  56rem tall) moves Block type and Colours to a second column, so nothing overflows.
- **Channels** flow sideways into as many columns as the viewport height needs, each headed
  "Channel". The split is computed with pretext (below), so no title is ever cut mid-entry.
- **Channel names** drop the symbols the maintainer prefixes them with on Are.na (`✦`, `❋`, `𖤛`,
  ``): everything before the first Latin letter or digit goes (`channelLabel` in `format.ts`).
- **Footer.** "Archivist" in the wordmark style, one column wide; then the number of channels and
  the number of blocks in the archive, baselines aligned. Both counts come from the checked public
  snapshot. The results status is only announced to screen readers.

### The shelf

Every shelf length is a fraction of the band height `h`, held in the registered `--shelf-h`
property (`100cqh − 2 × annotation height`), so the layout scales with the window and renders on
the server. The constants live in `SHELF` in `src/lib/components/shelf.ts`.

| Measure     | Value                     | Meaning                                            |
| ----------- | ------------------------- | -------------------------------------------------- |
| padding     | 0.05h                     | Band edge to the first row, the scale bar, the end |
| row height  | 0.425h                    | Two rows: `(1 − 2 × 0.05 − 0.05) ÷ 2`              |
| page height | 0.34h                     | Pages and covers, top-aligned in their row         |
| row gap     | 0.05h                     | Between the two rows                               |
| item gap    | h ÷ 60                    | Between pages on one shelf                         |
| group gap   | h ÷ 3                     | Between shelves on one row                         |
| cover       | 0.7 : 1                   | A channel cover's shape                            |
| text page   | 0.75 : 1                  | A block with no image                              |
| scale bar   | 10 segments, 0.283h × 6px | Alternating black and white, top-left of the band  |

- **Shelves.** A page of results is grouped by channel in order of first appearance; inside a
  channel, rank order holds. A block's channel is the first one the reader filtered by, else the
  first in the manifest. A channel with more than 12 blocks is split. Every shelf opens with its
  channel's cover, which links to that channel's filter.
- **Rows.** Each shelf goes onto whichever row is shorter, judged by its estimated width: every
  image page counts as 4 : 3, whatever the image is. The rows are two flex lists, so the browser
  lays the shelves out, not script. Later pages are grouped on their own and appended, so loading
  more never moves a shelf already on screen.
- **Inset.** Both rows start `(column − 4rem) ÷ 2` in, where column is `100cqi ÷ column-count`, so
  the first shelf on each row lines up. The band is at least the sheet's width.
- **Pages** are `bg-white` with `shadow-page` (2px 2px 2px rgb(0 0 0 / 0.25)). An image or video
  page is `0.34h` tall and as wide as the image's own aspect ratio makes it, so nothing is cropped,
  however wide or narrow it gets. No width is computed: the media is `h-full w-auto`, and its
  `width` and `height` attributes give the browser the ratio before the file loads. A block Are.na
  has no size for starts at 4 : 3 (`aspect-[auto_4/3]`), and `auto` hands over to the file's own
  ratio once it loads, which also corrects a size Are.na has wrong. That moves the shelves after
  it. Covers and text pages are the only pages with a fixed width, from `cover` and `text page`
  above.
- **Covers** show the channel title in Newsreader at the top, and at the bottom the channel's
  symbol (the `✦`, `❋`, `𖤛` its Are.na title starts with), or "Are.na" when it has none, beside
  the block count.

### Captions

Captions sit outside the band, in the annotation rows: above it for the top row, below it for the
bottom row. Each is as wide as its page (at most `max-w-56` for blocks) and `annotation height − 2 ×
annotation padding` tall. Captions have one weight, 400, and two colours: `foreground-strong` for
the heading, `foreground` for the text.

- **Cover caption.** A `foreground-secondary-detail` left rule with `pl-2`, then one paragraph of
  lines: the channel title as the heading, the block count, the years connected. Bottom-row
  captions align to the bottom.
- **Block caption.** The connection date as the heading, one blank line (`--gap-paragraph`), then
  the block's words clamped to three lines with the query marked. The words are the first of title, description and source
  title that names the query, passing over titles that are only filenames or hashes.
- **Lead-in.** When the first keyword would fall past the clamp, the caption starts at the latest
  word boundary that leaves most of a line of context, prefixed with "… ". The widths come from
  pretext.
- Top-row captions carry `data-top-annotation`. While one straddles the search field's right edge,
  the field shows a one-pixel `foreground-secondary-detail` hairline there.

In the browser-search build, the default gallery is prerendered, but query/filter changes and infinite loading require JavaScript. A noscript notice makes this explicit. Search URLs, controls, busy feedback and announcements retain the same visual behavior.

## Motion

| Token                | Value                            |
| -------------------- | -------------------------------- |
| `--ease-out-expo`    | `cubic-bezier(0.22, 1, 0.36, 1)` |
| `--duration-reveal`  | 400ms                            |
| `--duration-caption` | 250ms                            |
| `--delay-caption`    | 480ms                            |
| `--delay-row`        | 60ms per row                     |
| `--duration-fast`    | 150ms                            |

- **Shelf reveal.** A shelf starts at opacity 0, shifted right by the band padding. The first time
  it enters the scroller it fades and slides in over `--duration-reveal` on `--ease-out-expo`,
  delayed by `row × --delay-row`. It never animates again for the same search; a new search keys
  new shelves, so they reveal again.
- **Caption reveal.** Captions fade in linearly over `--duration-caption` after
  `--delay-caption + row × --delay-row`, once their shelf is revealed.
- **Search.** A new query smooth-scrolls the sheet so the shelf starts at the gutter; clearing it
  scrolls back to the filters. On first load the scroll is instant.
- **Busy.** While a search is in flight the shelves drop to 50% opacity over `--duration-fast`.
- **Hover.** Text and action surface colour changes over 150ms. The clear button fades in on hover of the
  search field, and is always visible on coarse pointers.
- **Reduced motion.** Shelves and captions appear without movement, scrolls are instant and video
  keeps its poster frame.

## Pretext

[pretext](https://github.com/chenglou/pretext) (`@chenglou/pretext`) measures and wraps text with
canvas metrics, without touching the DOM. The helpers are in `src/lib/components/index-layout.ts`:

- `createLabelMeasure(style, width)` returns a label's wrapped height at a width (`prepare` +
  `layout`), cached per label. `packIntoColumns` fills each column with whole entries and starts the
  next one when the next entry would not fit. The index uses both to split the channel list.
- `createWidthMeasure(style)` returns a string's natural width (`prepareWithSegments` +
  `measureNaturalWidth`). Captions use it for the lead-in.
- `readTextStyle(element)` turns computed style into the canvas font string, line height and
  letter spacing pretext needs. Measure after `document.fonts.ready` and again on resize; shave a
  pixel off the width to absorb rounding between canvas and DOM line breaking.

Use pretext whenever a layout decision depends on how text will wrap. Do not reach for it when CSS
already does the job (`clamp-<n>`, `text-balance`). A label's measured height is whole lines; a
trimmed stack is a little shorter, so packing by it errs on the safe side.

## Components

| Component                | Role                                                                                       |
| ------------------------ | ------------------------------------------------------------------------------------------ |
| `SearchField.svelte`     | The serif search box: debounced live search, Enter submits, clear button, overlap hairline |
| `ArchiveIndex.svelte`    | Filter columns, colour swatches, channel fitting, footer                                   |
| `DateRangeSlider.svelte` | Two native range inputs over whole months; Connected starts June 2024, Created Feb 2014    |
| `Shelf.svelte`           | The band, scale bar, shelves, captions, reveal and infinite load                           |
| `ShelfCover.svelte`      | A channel cover                                                                            |
| `ShelfBlock.svelte`      | One block as a page: image, muted looping video, or a page of text                         |
| `CaptionText.svelte`     | Clamped caption words with marks and the pretext lead-in                                   |
| `ArchiveMessage.svelte`  | Empty, invalid and unavailable states, set inside the band                                 |

Copy that depends on state lives in tested functions (`filters.ts`, `caption.ts`, `format.ts`), not
in markup.

## Accessibility

- Filters are links with `aria-current`, swatches have `aria-label` and `title`, the slider thumbs
  are labelled "Connected from", "Connected until", "Created from" and "Created until" with month
  `aria-valuetext`.
- Focus is a 2px blue outline offset 2px; pages offset it 4px. Capsule actions use a blue focus border.
- A `role="status"` live region outside the busy subtree announces each result.
- Every block page is a link to Are.na named by its title; every cover is a link named "Show only
  …" or "Stop filtering by …".

## Do and don't

- Do use the semantic colour roles and the spacing tokens; don't add raw hex in components. Fixed ASCII slider primitives use the documented grey steps.
- Do express shelf geometry in `--shelf-h` units and grid geometry in `--column-width`; don't hard
  code pixels.
- Do keep chrome flat: capsule actions, swatches and slider thumbs are rounded; action focus and slider thumbs have borders. Shadows belong only to shelf objects.
- Don't introduce a new typeface, weight or size; extend the table above first if one is needed.
- Don't animate layout properties other than the reveal translate and the scale bar's width. Capsule press feedback uses transforms.

## Shared primitives and controls

Yusufparak is the source for ABC Areal body type (13.2px / 15px, MONO 0), its oklch grey/accent palette, and 4px utility spacing. Areal uses the same font file and default feature settings. Archivist retains its semantic light/dark roles, responsive root sizes, layout breakpoints, and all existing Newsreader typography and metric overrides.

`control-button` supplies the shared 26px capsule, 12px horizontal padding, grey-150 surface, grey-200 hover surface, blue focus border and spring press motion (reduced motion disables transforms). Search clear and shelf retry use it. In dark mode surfaces use grey-850 by default, grey-800 on hover and grey-900 on focus through semantic roles. Filter links and colour swatches retain their native selection semantics.

Date controls retain two native month ranges. Their 20px control area contains a 1px grey-500 track and 11px white thumbs outlined in grey-700, matching ASCII Patterns; keyboard focus is blue. Coincident thumbs retain their existing endpoint stacking.

For text rhythm, prefer `lines` for contiguous lines and `gap-(--gap-line)` / `gap-(--gap-paragraph)` for independently trimmed boxes. The gaps are `1lh - 1cap` and `2lh - 1cap`: at this font size they are approximately the 6px and 21px margins (`mb-1.5`, `mb-5.25`) used in SiteAbout, but they adjust automatically with font metrics. Keep these expressions on the container whose typography sets the intended rhythm. Do not replace them with fixed spacing utilities.

Annotation bands contract on short screens to leave room for the 15px filter rhythm; their maximum remains 10rem and their minimum is 4rem.
