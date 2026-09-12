# Worksheet: `toSearchDocument` normalizer covering all supported block shapes

- TODO: `TODOS.md` — Slice 1, "`toSearchDocument` normalizer covering all supported block shapes, with tests."

## Investigation

`toSearchDocument` (`src/lib/domain/archive.ts`) and its `ArchiveBlock` input type already exist
and already are shape-agnostic — it consumes a normalized `ArchiveBlock` and doesn't care which
Are.na block type produced it. It has exactly one test (an `Image`-shaped block).

The actual gap: nothing converts a real Are.na block (`ArenaContentItem` from
`src/lib/server/arena/schemas.ts` — the `Text | Image | Link | Attachment | Embed | Channel`
discriminated union) into an `ArchiveBlock`. Without that mapping, `toSearchDocument` can never
run on real synced data. That mapping is the actual deliverable here — re-scoping the TODO
slightly based on what building the arena client (previous task) revealed about the real wire
shapes. Per `AGENTS.md`'s architecture boundaries, this belongs in `src/lib/server/indexing/`
(new directory — "normalization, document construction, and sync orchestration"), not in
`src/lib/domain/` (framework/provider-shape-free) or `src/lib/server/arena/` (transport only).

## Plan

New file `src/lib/server/indexing/normalize.ts`:

- `toArchiveBlock(item: ArenaBlockItem, channel: ChannelContext): ArchiveBlock` — pure function,
  one block occurrence in one channel in, one `ArchiveBlock` out. `ChannelContext = { slug, title }`
  (not the full Are.na `Channel` resource — keeps this decoupled from needing a schema for it).
- Per `docs/prd.md`'s Content Policy (title, description, plain-text content where supplied,
  source title/URL, block type, public image URL, channel membership) and what's actually on each
  block variant per `schemas.ts`:
  - `title`/`description` (as `.plain`)/`createdAt`/`connectedAt`/`arenaUrl` (`https://www.are.na/block/<id>`,
    matching the existing `archive.spec.ts` fixture format) are uniform across all 5 types.
  - `content`: `Text` → `content.plain` (always present); `Link` → `content?.plain ?? null`
    (Are.na only sometimes extracts link text); `Image`/`Attachment`/`Embed` → `null` (no text
    content field on those variants).
  - `sourceUrl`/`sourceTitle`: uniformly `item.source?.url ?? null` / `item.source?.title ?? null`
    for every type. Considered special-casing `Attachment` to fall back to `attachment.url` (the
    file's own download link) when there's no `source`, but that conflates "download link" with
    "source" and there's no field in the Turbopuffer schema for it anyway — dropped, keep it
    uniform.
  - `imageUrl`: `Image` → `image.large.src` (required field on that variant); `Link`/`Attachment`/`Embed`
    → `image?.large.src ?? null` (optional preview/thumbnail); `Text` → `null`. Picks the `large`
    size as the one canonical URL, since the Turbopuffer schema (`docs/architecture.md`) has a
    single `image_url` string, not multiple sizes — a real gallery/responsive-image need is Slice
    3's job and would be a schema change, not this task's.
  - `channels`: single-entry `[channel]` — merging a block's membership across multiple channels
    it appears in (dedup by id) is sync-orchestration's job (a later TODO), not this function's.
  - `id`: `String(item.id)`; `type`: `item.type`.
- Exhaustive `switch` over `item.type` for `content`/`imageUrl` with a `never`-asserting default,
  so a future Are.na block type added to the union fails to compile instead of silently returning
  `null`/`undefined` (per `AGENTS.md`'s "fail explicitly" guardrail).
- Tests (`normalize.spec.ts`): one case per block type covering the type-specific fields, plus a
  shared-fields case (title/description/dates/channels/arenaUrl) and a fully-empty-optional-fields
  case per type.

No `archiveBlockSchema.parse(...)` re-validation of the output — the input was already
Zod-validated at the arena/schemas.ts boundary, and the output is our own internally-constructed,
TypeScript-checked shape, not untrusted input. Matches how `toSearchDocument` itself doesn't
re-validate `ArchiveBlock`.

## Review

Single new pure-function module, no route/schema/search changes. Self-reviewing against the
Data/Sync Expert and Systems Architect checklists (normalization staying out of `src/lib/domain/`
and `src/lib/server/arena/`, no provider-shape leakage past this module's return type) rather than
spawning sub-agents, given the contained scope — consistent with how the page-client task judged
review weight.

## Implementation notes

Implemented `src/lib/server/indexing/normalize.ts` (`toArchiveBlock`) and `normalize.spec.ts` per
the plan above.

### Review

Spawned a fresh-context Data/Sync Expert + Systems Architect sub-agent per
`docs/workflows/agent-review.md` (both personas apply: arena-shape correctness, and this is the
first file in a brand-new directory). Verdict: approve, one P2 fixed before handoff:

- **P2** — `title` was mapped uniformly from `item.title` for every type, but `Embed`/`Attachment`
  variants carry their own title-shaped field (`embed.title`, `attachment.filename`) that Are.na
  doesn't necessarily mirror onto the block-level `title`. An untitled upload or embed could end
  up with no searchable title text at all even though Are.na supplied one under a different key.
  Fixed: `title` now falls back to `embed.title` / `attachment.filename` when `item.title` is
  empty, with tests for both the fallback firing and staying `null` when neither is set. (Flagged
  by the reviewer as unverified against real data — worth a spot-check once the sync command
  lands and something has actually gone through this function against a real Are.na channel.)
- Consolidated `extractContent`/`extractImageUrl` (two separate switches over the same union) into
  one `extractTypeSpecificFields` switch returning `{ title, content, imageUrl }` — the reviewer's
  P3 style note, folded in since I was already touching this code for the P2 fix.
- P3 (test-coverage breadth on mixed independent-optional-field states) — reviewer called this low
  risk given each field is an independent one-line `?? null` expression; left as-is.
- Boundary/placement checks (Systems Architect): clean — `src/lib/server/indexing/` is the correct
  home per `AGENTS.md`, no provider-shape leakage past `toArchiveBlock`'s return type, import
  direction correct, `ChannelContext` deliberately decoupled from the full Are.na `Channel` shape.
- Scope cut (deferring cross-channel `channels` unioning to sync orchestration): reviewer confirmed
  reasonable, not a gap in this task's actual deliverable.

### Final state

- `bun run check`: 0 errors.
- `bun run lint`: clean.
- `bun run test`: 44/44 passing (4 files).
- `bun run build`: succeeds.
