# Spec: autoplaying, looping video in the gallery

Status: not started. Tracked in [`TODOS.md`](../TODOS.md).

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
