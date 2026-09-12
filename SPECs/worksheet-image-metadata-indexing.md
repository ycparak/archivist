# Worksheet: Index image alt text, width, and height

- TODO: `TODOS.md` — Slice 4, "Index `image.alt_text`, `width`, and `height` from Are.na's block
  image payload."
- `src/lib/server/arena/schemas.ts` already validated `alt_text`/`width`/`height` on
  `blockImageSchema` (both top-level and per size version) before this task — only the normalizer
  discarded them.

## Approach

Threaded the three fields end to end, following the existing shape for every other display field
(`imageUrl` et al.):

- `src/lib/server/indexing/normalize.ts` — added an `imageFields()` helper reading `alt_text` from
  the top-level `image` object and `width`/`height` from `image.large` specifically, not the
  top-level `image.width`/`height`. Reasoning: `imageUrl` is already `image.large.src`, so the
  dimensions must describe that same asset, not Are.na's original upload.
- `src/lib/domain/archive.ts` — `imageAlt`/`imageWidth`/`imageHeight` on `ArchiveBlock` and
  `SearchDocument` (as `image_alt`/`image_width`/`image_height`), same nullable/optional shape as
  the other display fields.
- `src/lib/server/search/turbopuffer-schema.ts` — three new unindexed attributes (`string`, `uint`,
  `uint`). New attributes on an existing namespace don't need a version bump, per the TODO and
  `docs/architecture.md`'s migration rule (only a *type change* on an existing attribute does).
- `src/lib/server/search/repository.ts` and `contracts.ts` — added to `presentationAttributes`,
  the Turbopuffer row schema, `toSearchResult`, and the public `SearchResult`/`searchResultSchema`.
- `src/lib/components/ResultCard.svelte` — `alt` now uses `result.imageAlt ?? ''` (was always `""`);
  `width`/`height` attributes are set from the result when both are present. CSS: a
  `.card-media--fixed` modifier keeps the old 4:3 `object-fit: cover` box only when Are.na supplied
  no dimensions; otherwise the image renders at its own aspect ratio (`block-size: auto`). This
  layout shift*, not *force every card into an identical crop* — the TODO explicitly called the
  fixed box a stand-in for missing real dimensions, and object-fit: cover would still be lossy
  cropping of the maintainer's original image now that we don't have to guess.
- Tests added/extended: `normalize.spec.ts`, `archive.spec.ts`, `repository.spec.ts`,
  `turbopuffer-client.spec.ts`, `execute.spec.ts`, `handler.spec.ts`, `markup.ssr.spec.ts` (new
  cases for real alt text, real dimensions, and the fixed-box fallback). Ran the Svelte MCP
  autofixer on the `ResultCard.svelte` edit — no issues.

## Re-sync (required, and blocking — found during verification)

Before running the real sync, I checked the change against the live namespace and found it would
have broken production search entirely, not just left the new fields empty. Turbopuffer's `query`
rejects `include_attributes` entries that aren't yet in the namespace's registered schema:

```
💔 attribute "image_alt" not found in schema, cannot be part of `include_attributes`.
consider passing `include_attributes=True` to return all attribute data instead
```

Reproduced directly against the real `arena-blocks-v1` namespace (400, confirmed via local dev
server logs too: `Search unavailable { providerStatus: 400 }`). So this task's own "needs a
re-sync" note was load-bearing in a way stricter than "the new fields will just be null until
then" — every search request would 503 until either the schema or the code shipped in the same
step. Flagged this to the maintainer and ran `bun run sync` with their go-ahead (writes to their
live Turbopuffer namespace with their own read-only Are.na token — confirmed before running rather
than assumed).

Sync result: 104/104 channels synced, 0 failures, 3,708 blocks fetched, 2,963 unique blocks
upserted across 15 batches. Confirmed via a direct read-only query afterward:

- **1,168 of 1,186** image-bearing blocks (98%) now carry real `image_width`/`image_height`.
- **`image_alt` is null on every block checked (0 of 1,200 sampled).** This account's Are.na blocks
  simply don't have alt text set — Are.na's `alt_text` field is optional and this maintainer never
  populated it. Not a bug: the normalizer correctly passes through whatever Are.na provides, and
  Are.na provides nothing here. Same pattern the round-trip-verification worksheet found with the
  title fallback fields — the plumbing is confirmed correct even though this account's data doesn't
  exercise every branch. `ResultCard`'s `alt={result.imageAlt ?? ''}` fallback (empty, link still
  named by the block title) is what actually renders today; it'll pick up real alt text
  automatically if the maintainer ever adds it on Are.na, with no further code change.

## Outcome

Verified in the dev server after the sync: search works again, and an `Image`-type block now
renders at its own portrait/landscape aspect ratio (e.g. 828×1800) instead of the fixed 4:3 crop.
`bun run check`, `lint`, `test` (180 passed, 5 new), and `build` all pass.
