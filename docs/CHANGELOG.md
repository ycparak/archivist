# Changelog

User-visible changes, newest first. The format is set in [`AGENTS.md`](../AGENTS.md#engineering-guardrails).

## Unreleased

### Added

- Added the number of blocks in the archive to the footer, beside the number of channels. It replaces the results sentence and Turbopuffer timings, which screen readers still hear.
- Added a Sort by filter for browsing: most connected (the default), newest or oldest, as `?sort=`. A search term still ranks by relevance.
- Added colour swatches and a connected-date slider to the filters, so the colour filter finally has a control.

- Added a colour filter to search. `?colour=blue` lists blocks with enough blue, and browsing with a colour puts the most strongly coloured first; repeat `colour` for blocks with every colour named. The colours are red, orange, yellow, green, blue, purple, pink, brown, grey, black, white and `mono` for black and white. There is no control for it in the gallery yet. Takes effect after `bun run sync`.
- Added a colour stage to `bun run sync`, which measures how much of each image is each colour with ffmpeg, in memory, and caches the result in `colour-cache.jsonl`. Skip it with `--no-colour`.
- Added `bun run calibrate:colour`, which writes a read-only contact sheet of measured colours for checking the colour boundaries by eye.
- Added a favicon, with an `.ico` next to the SVG for browsers that cannot show an SVG icon.
- Added search over the tags the vision model makes, such as `cyberpunk` and `dark mode`. Tags match without regard to case or hyphens, so `web design` and `web-design` are the same. Takes effect after `bun run sync`.
- Added video playback in the gallery. Video blocks play muted, looping and inline, only while visible, and stay still when reduced motion is on. Takes effect after `bun run sync`.
- Added a live status area to `bun run sync` that shows the phase, what is running now and an estimated finish time. It falls back to plain lines when piped or when `NO_COLOR` is set.
- Added search by what an image looks like. A vision model describes every block with an image, and that text is indexed with the block's own metadata. Takes effect after `bun run sync`.
- Added write-back of generated titles and descriptions to Are.na for blocks you own. It only replaces titles that carry no information, such as filenames and hashes, and never overwrites a description you wrote.
- Added pruning to `bun run sync`, which deletes documents for blocks that left your archive or sit in ignored or private channels. Pruning is skipped if a channel failed or if it would delete more than half the index.
- Added infinite scroll to the gallery. With no search term it lists the most-connected blocks first, and the newest first on ties. Takes effect after `bun run sync`.
- Added `ARENA_ALLOW_PRIVATE_CHANNELS` and `ARENA_IGNORE_CHANNELS` to choose which channels `bun run sync` indexes. Private channels are now skipped by default, and the ignore list wins.
- Added a shared edge rate limit for the gallery and `/api/search`, with a short retry page and a 429 reply. Logs never record search terms or visitor addresses.
- Added Are.na alt text and real image sizes to result images, so cards no longer use a fixed crop. Takes effect after `bun run sync`.
- Added an `/about` page with notes on the archive, the search modes and how the app is built.
- Added the search-first home page. It shows original Are.na blocks with a search box, a ranking choice, and block-type and date filters, all kept in the URL, and it works without JavaScript.
- Added result cards that link to the original block on Are.na and label untitled blocks by their type.
- Added loading, no-result, unreadable-search and unavailable states that keep your query and filters on screen.
- Added `GET /api/search` with browse, lexical, semantic and hybrid modes, channel, type and date filters, and a 400 or 503 reply for bad or failed requests.
- Added public evaluation cases and `bun run evaluate:search` to check expected blocks against your namespace.
- Added `bun run sync`, which finds every channel your account owns, merges duplicate blocks and upserts them into Turbopuffer. It needs `ARENA_ACCESS_TOKEN`, `TURBOPUFFER_API_KEY` and `TURBOPUFFER_REGION`.

### Changed

- Changed the whole UI to a horizontal library modelled on Seth Thompson's: one sideways-scrolling sheet with the filters as columns of links on the left, and results on a grey shelf, grouped by channel behind a channel cover, captioned above and below with the date and the matched words. Shelves slide in as they scroll into view, a search glides the sheet to the shelf, and dark mode follows the system.
- Changed the colour swatches to nine that fill the column: pink, black and white are no longer offered, even from a URL.
- Changed the shelf to a pale grey band with pages a fifth shorter than their row, closer in height to the reference. Channel names lose their leading symbols, black and white are no longer offered as colours, all filters sit in the first column, and captions use one weight with black headings over grey text.
- Changed all text to trim to cap height and baseline, on a 14px line height, with spacing set to keep a baseline grid.
- Changed the type to ABC Areal at 14–15px for the app, with Newsreader for the search box, the wordmark and channel covers.

- Changed the sync rules so agents may run `bun run sync` with `--no-vision`, `--no-push-arena` or both. A plain `bun run sync` is still the maintainer's alone.
- Changed `bun run sync` to run the vision stage and the Are.na write-back by default. Opt out with `--no-vision` and `--no-push-arena`. It now needs `OPENROUTER_API_KEY` and a read + write Are.na token unless opted out, and it rejects unknown flags.
- Changed a stalled vision request to retry once instead of four times, so one stuck block no longer holds a worker for twenty minutes. Rate limits and 503s keep the full retry budget.
- Changed the result status to show Turbopuffer timings, such as `time: 0.85s (query: 0.02s, rerank: 0.00s)`. Screen readers still hear the sentence it replaced.
- Changed the look of the app to ABC Areal, a 13px size, an oklch gray ramp, blue accents and square 1px-bordered controls. Colour tokens are role-based and live in `src/styles/globals.css`.
- Changed the layout to a recessed sidebar beside a gray pane, with a justified-row gallery where each row of images shares a height. Cards show only the image and title.
- Changed the form and page details: links open in a new tab, fields are rounded and white, pane padding is 24px, the sidebar stays fixed while scrolling, and filter-row text lines up on one baseline.
- Changed the Channel filter to list every channel in the archive, using a manifest that `bun run sync` writes. It adds no Are.na calls and no cost per request.

### Removed

- Removed the `bun run sync` flags `--vision-dry-run` and `--no-vision-video`. Animated blocks are always read as video, which needs ffmpeg.
- Removed the `bun run sync` flags `--vision-limit`, `--vision-concurrency`, `--revision`, `--push-arena`, `--push-arena-limit` and `--allow-large-prune`. Vision uses 32 workers and describes every uncached block, and deleting a line from `vision-cache.jsonl` redoes one block. A prune of more than half the index is still refused, with no override.
- Removed the active-filter pills under the search bar. The Channel and Block type menus show a count instead.
- Removed the `/about` page and its sidebar link.

### Fixed

- Fixed clamped captions and channel covers that showed the top of a hidden line or cut off descenders, and the search clear button sitting below the search text.

- Fixed browsing so a block can no longer appear twice, or never, while scrolling. 104 blocks share both their connection count and the time they were added with another block, and Turbopuffer may return such ties in a different order on each page; browse now breaks ties by block id.
- Fixed the `bun run sync` summary counting an animation that could not be downloaded as "media too large". It now has its own line.
- Fixed `bun run sync` dropping saved vision descriptions for blocks in a channel that failed that run. Nothing is dropped from the cache unless every channel synced.
- Fixed the missing-ffmpeg error from `bun run sync`, which suggested the removed `--no-vision-video` flag. It now suggests `--no-vision`.
- Fixed runaway generated text. Three blocks had text that repeated one phrase, one of them 270,000 characters long, and all of it was indexed. Generated text is now capped and repetition is discarded. Takes effect after `bun run sync`.
- Fixed hybrid results so they are capped at the same server limit as other modes after de-duplication, which keeps the result count and status in step.
- Fixed `GET /api/search` so blank parameters count as missing, and a `type` outside Are.na's five block types returns a 400 instead of an empty result.
