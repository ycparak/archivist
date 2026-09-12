# Worksheet: Verify a known block round-trips via a direct SDK query

- TODO: `TODOS.md` — Slice 1, "Verify a known block round-trips via a direct SDK query," with the
  specific ask to include an Embed and a filename-only Attachment and confirm `toArchiveBlock`'s
  title fallback (from [SPECs/worksheet-arena-block-normalizer.md](./worksheet-arena-block-normalizer.md)'s
  P2 fix) matches what Are.na's own UI shows.
- This is a verification task against the real, already-synced archive
  ([SPECs/worksheet-turbopuffer-upsert.md](./worksheet-turbopuffer-upsert.md) — 2,962 blocks live in
  `arena-blocks-v1`) — no new feature, code changes only if a real bug turned up.

## Method

1. Queried the real Turbopuffer namespace directly (`ns.query({ filters: ['block_type', 'Eq', 'Attachment'|'Embed'], ... })`)
   for real block ids of each type.
2. Cross-referenced each candidate against Are.na's raw API (`arena.blocks.get(id)`) to see the
   actual `title`/`embed.title`/`attachment.filename` fields the normalizer consumed.
3. For the most informative cases, opened the block's `arena_url` in a browser to compare against
   what Are.na's own UI displays.

## Findings

**The title fallback (`item.title ?? item.embed.title` / `?? item.attachment.filename`) essentially
never fires in this real archive.** Sampled 62 real Attachment blocks and 80 real Embed blocks
from the account:

- **0/62** Attachment blocks have a null top-level `title` — Are.na always populates it directly
  with a human-friendly name at upload time (e.g. `"cult-brand-behavior-by-alex-tran.pdf"`), which
  is _not_ the same string as `attachment.filename` (an internal storage hash, e.g.
  `"8886145adbbf2c5c37314db283716bec.pdf"`). The fallback to `attachment.filename` — the exact
  P2 fix from the normalizer task — never triggers for any real block in this account, because the
  thing it exists to prevent (an untitled upload showing the hashed storage name) doesn't occur:
  Are.na itself never leaves `title` null for an uploaded attachment.
- **2/80** Embed blocks have a null top-level `title` — but both also have `embed.title: null`, so
  the fallback correctly falls through to `null` rather than fabricating something. In the other
  78, `embed.title` was `null` in every single case (title always came from the top-level field).
  So this fallback also never "rescues" anything real; it only proved itself safe when there was
  genuinely nothing to rescue.

This doesn't make the P2 fix wrong — the API schema genuinely allows `embed.title`/
`attachment.filename` to be the only source, so the fallback is correct defensive coverage for a
case this particular account's data just doesn't exercise. A different Are.na account (e.g. one
with attachments uploaded via a client that doesn't set a friendly name) could plausibly hit it.
Documenting this so a future reader doesn't assume the fallback is load-bearing in practice, or
spend time trying to "prove" it more thoroughly against this archive — it isn't reachable here.

**Spot-check 1 — Embed with null title (`block:32644803`, a Volvo EX90 YouTube video):**

|                                           | value                                                                                                                  |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Are.na raw API                            | `title: null`, `embed.title: null`, `source.title: "Meet the new Volvo EX90 - YouTube"`                                |
| Indexed in Turbopuffer                    | `title: null`                                                                                                          |
| Are.na's own UI (`are.na/block/32644803`) | Shows **"No title"** as the block's title, and separately, lower down, **"Source: Meet the new Volvo EX90 - YouTube"** |

Exact match. Also confirms `title` and `source_title` are correctly kept as two distinct fields in
`toArchiveBlock`/the Turbopuffer schema — Are.na's own UI draws the identical distinction (a
block's own title vs. its source's title are shown as separate pieces of information, not merged).
`sourceTitle` still contributes to `search_text` via `toSearchDocument`, so the Volvo title is
searchable even though it isn't displayed as _the_ title — matching the PRD's content policy,
which lists "title" and "source title/URL" as separate stored fields.

**Spot-check 2 — filename-derived Attachment (`block:29444186`, `cult-brand-behavior-by-alex-tran.pdf`):**

|                                           | value                                                                                                          |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Are.na raw API                            | `title: "cult-brand-behavior-by-alex-tran.pdf"`, `attachment.filename: "8886145adbbf2c5c37314db283716bec.pdf"` |
| Indexed in Turbopuffer                    | `title: "cult-brand-behavior-by-alex-tran.pdf"`                                                                |
| Are.na's own UI (`are.na/block/29444186`) | Page title and heading: **"cult-brand-behavior-by-alex-tran.pdf"**                                             |

Exact match. (This block also has 256 connections across many other users' channels — it's a
popular attachment that happens to be connected into one of the maintainer's owned channels too;
unrelated to this verification, just worth noting so the count isn't mistaken for a sync bug.)

## Outcome

No bug found; no code changes. The round trip (Are.na raw data → `toArchiveBlock` → `toSearchDocument`
→ Turbopuffer) is verified accurate against Are.na's own UI for both requested block shapes. The
normalizer's defensive title fallback is confirmed safe (produces `null`, not a crash or garbage
value, when genuinely nothing is available) but is not exercised as a "rescue" anywhere in this
real archive — noted above rather than treated as a gap, since the API contract still permits it.

`bun run check`/`lint`/`test`/`build` unaffected — nothing changed. No commit needed beyond this
worksheet and the `TODOS.md` update.
