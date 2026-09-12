# Changelog

User-visible changes, newest first.

## Unreleased

- `bun run sync` discovers every channel your Are.na account owns, fetches and normalizes their
  contents, deduplicates blocks across channels, and batch-upserts the result into Turbopuffer —
  re-running it is idempotent. Prints a summary (channels discovered/synced/failed, blocks
  fetched, unique blocks, documents upserted). Now requires `TURBOPUFFER_API_KEY` and
  `TURBOPUFFER_REGION` in `.env` in addition to `ARENA_ACCESS_TOKEN`; `TURBOPUFFER_NAMESPACE`
  defaults to `arena-blocks-v1` if unset. Search over the synced archive isn't built yet — that's
  next.
