# Changelog

User-visible changes, newest first.

## Unreleased

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
