# Enrichment caches

`bun run sync` writes three git-ignored files here: `colour-cache.jsonl`, `connections-cache.jsonl` and
`vision-cache.jsonl`. They describe one Are.na archive (the vision cache holds generated descriptions
and OCR text of saved images, including blocks other people authored), so they are never committed.

To move them to hosted maintenance, run `bun run hosted bootstrap`; `bun run hosted pull` brings the
hosted copies back down.
