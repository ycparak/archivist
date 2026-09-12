# Changelog

User-visible changes, newest first.

## Unreleased

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
