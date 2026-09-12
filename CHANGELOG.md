# Changelog

User-visible changes, newest first.

## Unreleased

- Added `bun run sync`: discovers every channel your Are.na account owns, fetches and normalizes
  their contents, deduplicates blocks across channels, and prints a summary (channels
  discovered/synced/failed, blocks fetched, unique blocks). Read-only and non-destructive — does
  not yet persist anything to Turbopuffer, so results aren't searchable yet (that's next).
