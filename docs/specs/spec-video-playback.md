# Spec: autoplaying, looping video in the gallery

Status: built, pending the maintainer's `bun run sync`. Tracked in [`TODOS.md`](../TODOS.md).

## Goal

Video blocks in the gallery play instead of showing a still: autoplay, muted, looping, inline.

## Why this is not a UI-only change

`ResultCard.svelte` renders only `<img>`, and the index has no video URL to hand it. For an
`Attachment` block, `extractTypeSpecificFields` in
[`normalize.ts`](../../src/lib/server/indexing/normalize.ts) keeps just `item.image?.large.src` (the
thumbnail). `attachment.url`, `attachment.content_type` and `attachment.file_extension` are parsed by
`blockAttachmentSchema` in [`arena/schemas.ts`](../../src/lib/server/arena/schemas.ts) and then dropped.
`SearchResult` (`src/lib/domain/search.ts`) has no media field either.

So the URL has to be indexed, and that means a re-sync.

## What has to change

1. **Domain.** Add nullable `videoUrl` (and, if useful for `<source type>`, `videoContentType`) to
   `archiveBlockSchema` in `src/lib/domain/archive.ts`.
2. **Normalize.** In the `Attachment` case, set it when `attachment.content_type` starts with `video/`.
   Embed blocks (YouTube/Vimeo) have no playable file, so they stay thumbnail-only.
3. **Turbopuffer schema.** Add the attribute as a new additive, non-indexed attribute in
   `turbopuffer-schema.ts`. Additive means no namespace bump (same as the `vision_*` attributes); see
   the schema-change rule in [`AGENTS.md`](../../AGENTS.md).
4. **Search path.** Carry it through `repository.ts`, `contracts.ts` and `SearchResult`.
5. **UI.** In `ResultCard.svelte`, when `videoUrl` is set render
   `<video autoplay muted loop playsinline preload="metadata" poster={imageUrl}>` in place of the
   `<img>`, keeping the existing aspect-ratio box. Notes:
   - `muted` must be present for autoplay to be allowed. In Svelte the `muted` attribute is
     unreliable at hydration, so set it as a property/attribute the SSR markup also carries.
   - 24 results per page can mean 24 concurrent decoders. Consider only playing cards in the
     viewport (IntersectionObserver) and honouring `prefers-reduced-motion` (no autoplay, show the
     poster with controls).
   - Update the static-markup assertions in `markup.ssr.spec.ts`.
6. **Sync.** Existing blocks only gain the field after `bun run sync`; nothing else backfills it. A
   plain sync is enough (`--vision` is not needed). Hand back to the maintainer to run it, per the
   sync rule in [`AGENTS.md`](../../AGENTS.md), then verify playback in the gallery.

## Open questions (verify before building)

- Which blocks are actually videos? Confirm against live data: how many `Attachment` blocks have
  `video/*` content types, and whether Are.na serves them from a URL a `<video>` can load
  cross-origin without auth or hotlink restrictions (the `<img>` already uses
  `referrerpolicy="no-referrer"`; do the same).
- The 134 GIFs are `Image` blocks, not videos, and already render fine as `<img>` (they animate and
  loop natively). Confirm nothing is needed there.
- File sizes: the largest GIFs reach 24 MB. Check the video size distribution before deciding whether
  `preload` and viewport gating are enough.
- Related but separate: the phase-2 backlog item on sending video to the vision model. That is about
  indexing, not playback.

## What the build found

Answers to the open questions above, verified against live data rather than assumed.

- **Population.** 52 `Attachment` blocks in the whole archive, against 918 `Image`, 46 `Embed` and
  roughly 1,550 `Link`. Seven of the 52 are PDFs; about thirteen are video. The spec's concern about
  24 concurrent decoders is therefore theoretical. Viewport gating was kept anyway — it is a few
  lines and it is the correct behaviour — but it is not load-bearing.
- **Delivery.** Video attachments are served from `attachments.are.na` with no auth, no hotlink
  protection, `accept-ranges: bytes` and `cache-control: max-age=31536000`. Two sampled files were
  220KB and 800KB. `<video>` can load and seek them directly, so `preload="metadata"` is enough and
  nothing cleverer is needed. `referrerpolicy` is not available on `<video>` and turned out not to
  be needed: the image CDN serves a request carrying a referer identically.
- **A hazard the spec missed.** Turbopuffer rejects the _entire_ query with a 400 when
  `include_attributes` names an attribute the namespace has never been written, saying the
  attribute was not found in the schema. Adding a presentation attribute is therefore not additive
  in the way a written attribute is: shipping the read before the sync would have taken search down
  completely. `repository.ts` now asks for these attributes, drops them once the
  namespace says it has never heard of them, and remembers that for the life of the process, so the
  next sync heals it. This was caught by running the real gallery against the live namespace, where
  it failed exactly as described.
- **Controls.** None, deliberately. The card is a link to Are.na, and a control strip inside it
  fights every click. Reduced-motion readers get the poster frame rather than controls; the block
  plays properly on Are.na, one click away.
- **GIFs.** Confirmed unaffected: the 134 GIFs are `Image` blocks and animate natively in `<img>`.
