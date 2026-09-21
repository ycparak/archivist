# Changelog

User-visible changes, newest first.

## Unreleased

- Search now finds blocks by what the image actually looks like, not just what Are.na says about it. A vision model describes
  every block with an image — subject, composition, palette, typography, medium, and any text it can
  read — and that description is indexed alongside the block's own metadata. This mostly helps image
  blocks, which usually arrive titled with a filename (`cleanshot-2025-02-28-at-17.36.56.png`) and
  no description. `bun run sync` generates a description once per block and never again unless the
  image changes or you pass `--revision`, so re-running it is free; `--vision-dry-run` reports what
  a run would cost before spending anything. Where the maintainer owns the block, `--push-arena`
  can write a short, specific title and a description back to Are.na (`--push-arena` to preview,
  `--push-arena-apply` to write), replacing the ones that carry no information: upload filenames, hashes and bare URLs, and the platform boilerplate you get from
  a shared post (`Seth Thompson on X: "Searching my library is now fast enough…" / X`), where the
  title is a 250-character copy of the description. Titles that already say something are left
  alone, however long they are, and a description you have written is never overwritten. 2,526 of
  the 2,576 blocks with an image now carry a generated description; the rest are oversized animated
  GIFs, which a later change will read as video rather than a single frame.
- `bun run sync` now deletes documents that are no longer in your Are.na archive, including blocks from channels you ignore or make private. Pruning is skipped if any channel failed to sync, and when it would delete more than half the index; pass `--allow-large-prune` to override that limit.
- Removed the active-filter pills under the search bar (the Channel and Block type menus show a count instead), made checkboxes 16px, and moved component styling to Tailwind utilities. Filter-row text is now cap-height trimmed throughout, so labels, menus, selects and date fields share one baseline.
- The gallery now loads more blocks as you scroll instead of stopping at 24, and with no search term it lists the most-connected blocks first (ties go to the newest). Ordering needs a re-sync (`bun run sync`) to index the new `connection_count` attribute; until then, browse returns "Search is unavailable". The rule above the sidebar and page headings sits 16px from the top of the page.
- The result status at the right of the filter row now shows Turbopuffer timings (`time: 0.85s (query: 0.02s, rerank: 0.00s)`); the sentence it replaced is still announced to screen readers. The search bar is 32px, the Ranking label is visually hidden, filters share one centered row, and the sidebar and pane rules line up 12px above their headings.
- Removed the `/about` page and its sidebar link, opened all links in a new tab, dropped focus
  styling from form fields, moved the canvas to `gray-100`, rounded and whitened form fields,
  widened the pane padding to 24px, kept the sidebar fixed while scrolling, and merged
  `tokens.css` and `primitives.css` into `globals.css`.
- Restyled the app with the design system from the maintainer's personal site: ABC Areal (with
  Neureal Mono, copied to `static/fonts/`), a 13px interface size, an oklch gray ramp, blue
  accents, and square 1px-bordered controls. Color tokens are now role-based (surfaces, text,
  rules, controls, action/state) instead of the previous ad-hoc aliases; see `docs/design.md`.
- New layout: a recessed sidebar beside a gray pane, with the search field and one row of filters
  above a justified-row gallery where each image row shares a height. Result cards now show only
  the block's image and title; the introduction paragraph, the type/source/date/channel metadata,
  and the clickable channel links on cards are gone. Channels are filtered from the form's Channel
  control (shown once `bun run sync` has written the channel manifest), and the result status now
  sits at the right of the filter row. The `/about` page is linked from the sidebar.
- `bun run sync` now skips private channels by default. Set `ARENA_ALLOW_PRIVATE_CHANNELS` to a
  comma-separated list of channel slugs to index specific private channels, and
  `ARENA_IGNORE_CHANNELS` to exclude any channel (the ignore list wins). Skipped channels are also
  left out of the channel manifest. Blocks already indexed from a channel that is now skipped are
  removed on the next sync.
- Hybrid search results are now capped at the same server-owned limit as other modes after
  deduplication, so the result count and status message stay aligned.
- Protected the gallery and search API with a shared edge request limit before they query the
  archive. When the limit is reached, the gallery shows a short retry page and the API returns a
  429 response. Added privacy-safe operational telemetry so the maintainer can diagnose unavailable
  search or limiter issues without recording search terms or visitor addresses.
- The channel filter now lists every channel in the archive, not just the ones on the current
  results page — `bun run sync` writes a channel manifest (`src/lib/server/indexing/channel-manifest.json`)
  that the gallery bundles at build time, with no added Are.na calls or request-time cost.
- Result images now use Are.na's own alt text when a block has it, and render at their real
  width/height instead of a fixed crop when Are.na supplies dimensions (falling back to the
  previous fixed box otherwise). Re-synced the archive to backfill this for existing blocks.
- Added an `/about` page with concise notes on where the archive comes from, how the four search
  modes work, and how the app is built. Linked from the home page ("How this works").
- Added the search-first home page: a gallery of original Are.na blocks with a search box, ranking
  choice (best match, exact words, related ideas), block-type and connected-date filters, and
  channel filters you add by clicking a channel on a result. All of it lives in the URL
  (`?q=&mode=&channel=&type=&from=&to=`), so a search is shareable, survives reload, and works with
  the browser's back button. The page works without JavaScript.
- Result cards show the block's own title, description, type, source, channels, and connected date,
  and link to the original block on Are.na. Untitled blocks are labelled by their own type; nothing
  about a block is invented. Images reserve their space before loading, so the grid does not jump.
- Added loading, no-result, unreadable-search, and search-unavailable states. An unavailable search
  keeps your query and filters on screen and shows a reference you can quote to the maintainer.
- `GET /api/search` now treats blank parameters as omitted (`?q=&from=` is the same as no filter),
  and rejects a `type` outside Are.na's five block types instead of returning an empty result.
- Added `GET /api/search` backed by the server-only Turbopuffer repository. It supports browse,
  lexical, semantic, and hybrid/RRF retrieval; repeated channel/type filters; and inclusive
  connected-date bounds. Responses contain original Are.na block metadata only, while malformed
  requests return 400 and unavailable search returns a generic 503 with a correlation ID.
- Added ten public evaluation cases and `bun run evaluate:search` to check their expected original
  Are.na blocks against the configured namespace.
- `bun run sync` discovers every channel your Are.na account owns, fetches and normalizes their
  contents, deduplicates blocks across channels, and batch-upserts the result into Turbopuffer —
  re-running it is idempotent. Prints a summary (channels discovered/synced/failed, blocks
  fetched, unique blocks, documents upserted). Now requires `TURBOPUFFER_API_KEY` and
  `TURBOPUFFER_REGION` in `.env` in addition to `ARENA_ACCESS_TOKEN`; `TURBOPUFFER_NAMESPACE`
  defaults to `arena-blocks-v1` if unset. Search over the synced archive isn't built yet — that's
  next.
