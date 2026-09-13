# Worksheet: Channel manifest for a complete channel filter

- TODO: `TODOS.md` — Slice 4, "Give the UI a complete channel list."
- `docs/architecture.md` (Retrieval behavior) already names the intended shape: "V1 has no channel
  enumeration... A complete channel list would come from the sync command emitting a channel
  manifest, not from a request-time provider call." This worksheet implements that.

## Investigation

- Today the only channel affordance is: (1) `ResultCard.svelte` links each result's own
  `channelSlugs` to `withChannel(state, slug)`, and (2) `ActiveFilters.svelte` renders a chip per
  already-active `state.channelSlugs` entry with a remove link. `SearchForm.svelte` never lists
  channels — it only round-trips already-active ones via hidden inputs (`src/lib/components/SearchForm.svelte:99-101`).
  So a visitor can only narrow _into_ a channel they already see a result from; they can never
  browse the full channel list, matching the TODO's complaint.
- `src/lib/domain/search.ts` already owns `withChannel`/`withoutChannel` and the URL grammar for
  `channel` (repeated, ORed). No grammar change needed — this task is about _listing_ channels, not
  changing how the filter is expressed or matched.
- `syncArchive` (`src/lib/server/indexing/sync.ts:102-107`) already discovers every channel the
  maintainer owns via `paginateOwnedChannels` before syncing each one's contents, so the maintainer
  never re-enters this data — it collects `{ slug, title }` and currently only returns
  `{ blocks, summary }`, discarding the list itself after computing `summary.channelsDiscovered`.
- Precedent for a checked-in, script-written JSON data file already exists:
  `scripts/fixtures/search-cases.json`, read by `scripts/evaluate-search.ts` via `node:fs/promises`
  `readFile` + `searchEvaluationCasesSchema.parse(...)`. That script runs under Bun/Node, not on
  Cloudflare Workers.
- The distinction that matters for _this_ task: `+page.server.ts` runs as part of the deployed
  Worker, which has no filesystem access at request time (only whatever Vite bundled in at build
  time). So the manifest has to be consumed as a build-time import
  (`resolveJsonModule: true` is already set in `tsconfig.json`), not a runtime `readFile` — Vite
  inlines the JSON into the built worker bundle. `scripts/sync.ts` (Bun/Node, maintainer-only,
  never deployed) is the only place that _writes_ the file, with `node:fs/promises`.
- Channel slugs/titles aren't secret — they're already visible on every result card and in
  `arena_url`s. Committing the manifest is not a new exposure.

## Decision

- New pure module `src/lib/server/indexing/channel-manifest.ts`:
  - `ChannelManifestEntry = { slug: string; title: string }`.
  - `buildChannelManifest(channels)` — dedupes by slug (last write wins, matching `mergeBlock`'s
    existing dedupe-by-key style elsewhere in this file's neighborhood) and sorts by slug for a
    stable, low-diff-noise commit each sync.
  - `serializeChannelManifest(manifest)` — pretty JSON with a trailing newline (matches Prettier's
    file-ending expectation so `bun run lint` doesn't flag the generated file).
  - `channelManifestSchema` (Zod) + a `channelManifest` export that imports
    `./channel-manifest.json` and parses it — this is the one runtime read, done once at module
    load, validated at the boundary per `AGENTS.md`'s Zod rule (guards against a hand-edited or
    corrupted generated file, not just "trusted because we wrote it").
  - Ship `channel-manifest.json` seeded as `[]` so a fresh clone builds and runs before anyone has
    ever synced.
- `syncArchive` returns the raw discovered `channels` list alongside `blocks`/`summary` (no
  shaping — shaping is `buildChannelManifest`'s job, kept pure and unit-tested on its own). Decided
  to return _every discovered channel_, not just ones that synced successfully this run: a channel
  that fails this run may still have blocks indexed from a prior run, so dropping it from the
  filter list would make already-visible content unfilterable. This mirrors the existing
  `channelsDiscovered` vs. `channelsSynced` distinction in `SyncSummary`.
- `scripts/sync.ts` writes `channel-manifest.json` after a successful sync, logs the channel count
  written.
- `+page.server.ts` adds `channels: channelManifest` to the page data (a plain re-export of already
  bundled data, not a provider call — no new request-time cost).
- `SearchForm.svelte` gets a real "Channel" filter: a scrollable checkbox fieldset (same pattern as
  the existing "Block type" fieldset) listing every manifest entry, checked against
  `state.channelSlugs`, submitted the same way (`name={ARCHIVE_SEARCH_PARAM.channel}`). Removes the
  old hidden-input echo, which is now redundant — checked boxes carry the value through submission
  themselves. Chose checkboxes over a native multi-select for consistency with the existing control
  and because a multi-select's discoverability/interaction (ctrl/cmd-click) is worse on an
  archive that may have 100+ channels; a scrollable box keeps it from dominating the form
  regardless of count.
- `docs/architecture.md`'s "V1 has no channel enumeration" paragraph is now stale — update it to
  describe the manifest now that it exists (Hard Rule: update the owning doc in the same task when
  behavior changes).

## Non-goals

- No change to `channel_slugs` filter semantics, Turbopuffer schema, or the search grammar.
- No validation of `?channel=` values against the manifest at the API boundary — an unknown slug in
  the URL still just yields zero results, same as today. Validating against a list that can only
  ever be as fresh as the last sync would make a stale manifest reject an otherwise-valid filter.
- Not running the real `bun run sync` as part of this task unless the maintainer OKs it — it writes
  to their live Turbopuffer namespace and spends their Are.na API quota. Flagged in the outcome
  section below.

## Outcome

Implemented as planned:

- `src/lib/domain/search.ts` — added `ChannelManifestEntry` (framework-free, so both server code and
  `SearchForm.svelte` can reference the type without the component importing `$lib/server/**`,
  which `AGENTS.md` forbids even for a type-only import).
- `src/lib/server/indexing/channel-manifest.ts` (new) — `buildChannelManifest` (dedupe by slug, sort),
  `serializeChannelManifest` (pretty JSON, trailing newline), and `channelManifest` (the parsed,
  Zod-validated contents of the sibling `channel-manifest.json`, seeded as `[]`).
- `src/lib/server/indexing/sync.ts` — `syncArchive` now returns `channels: ChannelManifestEntry[]`
  (every discovered owned channel, mapped to `{slug, title}` only — was leaking the raw
  `{id, type, slug, title}` Are.na shape through the declared type before this; the test that
  asserts the returned shape caught it immediately).
- `scripts/sync.ts` — writes the manifest file after a successful sync and logs the count.
- `src/routes/+page.server.ts` / `+page.svelte` — thread `channels` through to `SearchForm`.
- `src/lib/components/SearchForm.svelte` — new "Channel" fieldset (scrollable checkbox list,
  `max-block-size: 9rem`, own row above the Ranking/Block type/Date controls — putting it inside
  that flex row broke the row's `align-items: end` for every other control once one item got tall).
  Kept a hidden-input fallback for any active `state.channelSlugs` entry the manifest doesn't list,
  so a shared URL from before the last sync (or one crafted by hand) can't silently lose a filter on
  the next submit.
- Tests: `channel-manifest.spec.ts` (new), `sync.spec.ts` (+1 case), `markup.ssr.spec.ts` (+3 cases,
  updated the rest for the new required `channels` prop). Ran the Svelte MCP autofixer on the
  `SearchForm.svelte` edit — no issues.
- `docs/architecture.md`'s "V1 has no channel enumeration" paragraph rewritten to describe the
  manifest now that it exists.
- Added `.claude/launch.json` (`bun run dev` on 5173) — didn't exist yet, needed it to verify this
  in the Browser pane; kept it since it's generically useful for future UI work on this repo.

Verified in the dev server against the real Turbopuffer namespace with a fixture manifest (8 fake
channel entries): checkbox list renders, scrolls correctly past ~6 visible rows, submitting a
checked channel round-trips through the URL (`?channel=found-objects`) and produces the correct
"No blocks match" state (that fake slug doesn't exist in the real archive), and "Clear all filters"
resets it. Reverted the fixture back to `[]` afterward — see below.

`bun run check`, `lint`, `test` (189 passed, 9 new across `channel-manifest.spec.ts`,
`sync.spec.ts`, and `markup.ssr.spec.ts`), and `build` all pass. `lint`'s one remaining warning
(`docs/history/worksheets/worksheet-image-metadata-indexing.md`) predates this task and is untouched by it.

### Deliberately not done: running the real sync

`channel-manifest.json` ships as `[]` in this change, so the channel fieldset won't render in
production until the maintainer runs a real sync. Generating real content requires `bun run sync`,
which authenticates as the maintainer against their live Are.na account and writes to their live
Turbopuffer namespace (`arena-blocks-v1`, per the image-metadata worksheet's prior run: 104
channels). That's a live external write on a shared, previously-populated namespace — not something
to do without asking, even though it's idempotent. Flagging this as the follow-up: maintainer should
run `bun run sync` (or approve it being run) to populate the manifest for real once this ships.
