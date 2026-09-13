# Worksheet: Manual `bun run sync` command

- TODO: `TODOS.md` — Slice 1, "Manual `bun run sync` command that discovers and syncs every
  channel the maintainer's Are.na account owns."
- Depends on: [worksheet-arena-page-client.md](./worksheet-arena-page-client.md) (page
  client), [worksheet-arena-block-normalizer.md](./worksheet-arena-block-normalizer.md)
  (`toArchiveBlock`), [adr-arena-sdk-and-discovery.md](../../decisions/adr-arena-sdk-and-discovery.md)
  (auto-discovery decision).

## Investigation

`docs/implementation_plan.md`'s Slice 1 ordering puts the sync command _before_ "Turbopuffer
schema creation and batch upsert" as a separate later item — even though
`docs/architecture.md`'s Sync lifecycle describes upsert and a fetched/normalized/upserted/
skipped/failed count report as part of "the sync command." Reading the two together: this task
builds discovery → fetch → normalize → dedupe → report; the _next_ TODO adds the Turbopuffer
schema and wires actual persistence into this same command. Scoping this task that way — nothing
here writes to Turbopuffer yet. The CLI output says so explicitly so running it today isn't
mysterious about why nothing becomes searchable.

**Verified the real discovery response shape** (live probe against the maintainer's account, `me.id`
= 558206, `yusuf-parak`, 104 owned channels — matches the `/v3/me` check from the previous task):

`arena.users.contents(meId, { type: 'Channel' })` returns Channel resources with `id`, `type`,
`slug`, `title`, plus many fields we don't need (`owner`, `counts`, `_links`, etc.) — critically,
**no `connection` field at all**, not even `null`. The Are.na OpenAPI spec's description for
`Channel.connection` says "only present when returned as part of _another channel's_ contents" —
a user's own contents isn't a channel's contents, so it's correctly absent here. This confirms
`arenaChannelItemSchema` (built for the page-client task, which _does_ require `connection` since
that's the nested-channel-inside-a-channel case) is the wrong schema to reuse for this — a
dedicated, smaller schema is needed.

## Plan

**`src/lib/server/arena/schemas.ts`** — add:

- `arenaMeSchema`: `{ id: number, slug: string }` (only what discovery needs from `/v3/me`).
- `arenaOwnedChannelSchema`: `{ id: number, type: 'Channel', slug: string, title: string }` — no
  `connection`, per the verified shape above.
- `arenaOwnedChannelsResponseSchema`: `{ data: arenaOwnedChannelSchema[], meta }`.

**`src/lib/server/arena/client.ts`**:

- `ArenaClient.me(): Promise<{ id: number; slug: string }>` — wraps `arena.me()`, Zod-validated.
- `ArenaClient.fetchOwnedChannelsPage(userId, { page, per, signal })` — wraps
  `arena.users.contents(userId, { page, per, type: 'Channel' }, { signal })`, mirrors
  `fetchChannelContentsPage`'s validation/rate-limit-tracking/error-mapping.
- Generalize `mapSdkError(error, slug, page)` → `mapSdkError(error, context: string)` (a
  human-readable phrase instead of a hardcoded "channel contents" message) since it's now shared
  by three operations (`me`, channel contents, owned channels).
- **Refactor to de-duplicate pagination**: `paginateChannelContents`'s retry/backoff/proactive-
  throttle/abort-aware-pacing logic is identical to what owned-channel pagination needs. Extract a
  generic `paginate<T extends { meta; rateLimit }>(fetchPage, options)` async generator; both
  `paginateChannelContents` and the new `paginateOwnedChannels` become thin wrappers over it. Kept
  the same exported names/behavior for `paginateChannelContents` so the existing, reviewed test
  suite for it should keep passing unchanged — a regression safety net for the refactor.

**`src/lib/server/indexing/sync.ts`** (new) — `syncArchive(options)`:

1. Resolve `me.id` via `client.me()`.
2. Collect every owned channel via `paginateOwnedChannels` (104 channels fits comfortably in
   memory — no need to interleave discovery with content sync).
3. For each channel, walk its contents via `paginateChannelContents`; for each item:
   - `type === 'Channel'` (a nested sub-channel) → not a block, **skip** (counted, not an error —
     matches the product boundary: index only blocks, never generated collections).
   - Otherwise → `toArchiveBlock(item, { slug, title })`, merge into a `Map<id, ArchiveBlock>` that
     unions `channels` (dedupe by slug) when the same block id is seen from more than one channel
     — this is the "deduplicate by block ID while unioning channel membership" step from
     `docs/architecture.md`'s Sync lifecycle.
4. **Per-channel failure isolation**: wrap each channel's walk in try/catch. A channel that errors
   (e.g. a 404 for something the token no longer has access to, out of 104 channels) is recorded
   as failed and the sync continues with the rest — aborting a 104-channel run over one bad
   channel would be worse than reporting it and moving on. Considered aborting the whole sync
   instead (simpler, more "fail explicitly") but rejected it: `docs/architecture.md` explicitly
   asks for "failed" _counts_ in the summary, implying partial failure is an expected, trackable
   outcome here, not a fatal condition — and this is exactly the kind of unattended multi-resource
   batch job where isolating one bad item is the safer default.
5. Returns `{ blocks: ArchiveBlock[], summary: SyncSummary }` — `summary` covers channels
   discovered/synced/failed, blocks fetched/normalized, items skipped (nested channels), and
   unique blocks after dedup. No `upserted` count yet — nothing persists in this task.
6. Optional `log?: (message: string) => void` (default no-op) for progress lines as it goes —
   104 channels at ~300ms pacing is roughly half a minute, worth some feedback.
7. **Caught during implementation, not in the original plan**: `paginateChannelContents`'s pacing
   is _between pages within one channel_. Most owned channels are a single page, so without a
   separate delay _between channels_, syncing ~100 channels would fire their first request
   back-to-back with zero pacing — exactly the "keep it gentle" property this whole ingestion path
   is built around. Added `channelDelayMs`/`delayFn` (same shape and default as the existing
   per-page delay) so a pause happens between every channel too, not just between pages of one.
   Exported `delay` from `client.ts` (was a private helper) to reuse the same abort-aware sleep.

**`scripts/sync.ts`** (new) + `package.json`'s `"sync"` script: reads `ARENA_ACCESS_TOKEN` from
`process.env` (Bun loads `.env` automatically — confirmed in the previous task's SDK probes),
fails explicitly with a clear message if missing, calls `syncArchive` with `console.log`, prints
the final summary, and explicitly notes Turbopuffer upsert isn't wired in yet.

**Also caught during implementation**: `.svelte-kit/tsconfig.json`'s generated `include` only
covers `src/`, `test/`, `tests/` — `scripts/` was invisible to `svelte-check`, so a type error in
`scripts/sync.ts` would silently pass `bun run check`. Separately, `scripts/sync.ts` needs Node
globals (`process`) that the root `tsconfig.json` deliberately excludes from `types` (this is a
Cloudflare Workers app; leaking Node globals into Workers-deployed `src/` code would be a real
correctness hazard, not just noise). Both point to `scripts/` being a genuinely different runtime
target from `src/`, not an oversight to route around. Added `scripts/tsconfig.json` (extends the
root config, overrides `types` to `["node"]`) and a second `tsc --noEmit --project
scripts/tsconfig.json` step in the `check` script, after `svelte-check` — so `scripts/` is
actually covered going forward instead of being a silent gap.

**Not doing in this task** (explicitly deferred, noted so it isn't lost):

- Turbopuffer persistence / `upserted` count — the next TODO.
- Local on-disk checkpointing across separate process runs — `docs/architecture.md` mentions
  "checkpoints progress," but checkpointing has no value until there's a persisted destination to
  resume _into_; a 429 mid-run is already handled by the existing per-page retry/backoff, which is
  what the PRD's "resumes safely after a rate-limit response" acceptance signal actually asks for.
  Revisit real checkpointing when Turbopuffer upsert lands.
- CLI flags (`--dry-run`, `--channel <slug>`) — not requested, adds surface area V1 doesn't need;
  every run of this command is inherently a dry run today since nothing persists yet.

**Testing**: unit tests only, mocking the SDK's injected `fetch` (matching `client.spec.ts`'s
existing pattern) and mocking `ArenaClient`/pagination for `sync.spec.ts`. Deliberately **not**
running a real full sync against the maintainer's 104-channel account as part of implementing
this — unit tests can fully exercise discovery, dedup/union, and per-channel failure isolation
without burning real API quota on every iteration. The command is there for the maintainer to run
themselves once it's built.

**Unintentional real-world validation**: while checking the CLI's missing-token error path,
`env -u ARENA_ACCESS_TOKEN bun run scripts/sync.ts` was meant to simulate no token set — but Bun
loads `.env` itself regardless of the shell env, so this ran a genuine full sync against the
maintainer's real account instead. Entirely read-only (no writes to Are.na, nothing persisted
anywhere), so no harm done, and it's a strong end-to-end signal: **104/104 channels synced, 0
failures, 3706 blocks fetched, 65 nested-channel items correctly skipped, 2961 unique blocks after
dedup, no rate-limit errors.** Completed the whole run without needing the retry/backoff path at
all — the pacing alone kept it under Are.na's limits.

## Review

Spawning a fresh-context review before handoff, given this is the first task that actually wires
multiple previously-reviewed modules together into a real orchestration path with a new failure-
handling policy (per-channel isolation) — Data/Sync Expert (rate-limit/backoff reuse correctness,
dedup/union correctness, sync-lifecycle fidelity) and Systems Architect (indexing/ boundary,
`scripts/` placement, no provider-shape leakage in `SyncSummary`).

## Implementation notes

Fresh-context Data/Sync Expert + Systems Architect review (spawned per plan above). Verdict: no
P0, two real P1s fixed before handoff, everything else clean.

- **P1** — `mergeBlock` kept whichever occurrence's `connectedAt` was processed first when the same
  block appeared in multiple channels. `connected_at` is a per-channel connection timestamp, not
  stable block metadata (unlike title/content) — it genuinely differs across occurrences, and
  Are.na's owned-channel listing order isn't guaranteed stable across runs, so this was both wrong
  (silently affects browse-mode ordering for the ~20% of blocks that live in more than one
  channel, per the live run's 3706-fetched/2961-unique numbers) and non-deterministic. Fixed:
  merge now keeps the _most recent_ `connectedAt` across occurrences, matching browse mode's
  newest-first semantics. Documented in `docs/architecture.md`'s Sync lifecycle step 3. Added a
  test asserting the merged result is the same regardless of which occurrence is processed first.
- **P1** — the per-channel `catch` caught _any_ thrown error uniformly, isolating real Are.na
  transport failures (403/404/exhausted-retry 429s — the intended case) exactly the same as a
  schema-validation exception or a normalizer bug, which would silently masquerade as "104
  individually-logged channel failures" instead of one clear, fast error — a real violation of
  `AGENTS.md`'s "fail explicitly" guardrail, and indistinguishable from an expired/invalid token
  failing every channel. Fixed two ways: (1) narrowed the catch to `instanceof ArenaRequestError`
  only (covers both plain request failures and rate-limit errors that exhausted their retries) —
  anything else now propagates and fails the whole sync loudly; (2) added a `maxLeadingChannelFailures`
  circuit breaker (default 3): if that many channels in a row fail _before any channel has synced
  successfully_, abort with one clear error naming the likely cause (token problem) instead of
  grinding through the rest of a systemically-broken run. Once at least one channel has synced,
  isolated failures go back to being tolerated for the remainder — matches
  `docs/architecture.md`'s "failed counts" language for the case that's actually expected (a few
  individually broken channels among ~100 that mostly work). Added tests for: the breaker tripping
  and stopping further requests, the breaker _not_ tripping once something has already succeeded,
  and a non-transport error (schema validation failure) propagating instead of being isolated.
- Noted, not fixed: `signal`/abort support in `syncArchive` is real but currently untested at this
  level and unreachable from `scripts/sync.ts` (which doesn't construct an `AbortSignal` yet) —
  reviewer flagged this as a P2. Left as inert-but-correct plumbing consistent with how
  `paginateChannelContents`/`paginateOwnedChannels` already thread `signal` through; the P1 catch-
  narrowing fix above has the side effect of making an in-flight abort propagate as an error rather
  than being misrecorded as a channel failure, matching how the lower-level pagination generators
  already behave (pre-flight `aborted` checks stop new work; an already-in-flight abort throws).
  Revisit real `syncArchive`-level abort testing once something actually calls it with a live
  signal (the reviewer's own suggested resolution).
- Reviewer's P3 (two separate `tsc` invocations in `check` slightly duplicate `$lib` type-checking)
  — accepted as-is, low-risk and worth the coverage; added a short note to `AGENTS.md#Validation`
  explaining the split so it doesn't get "simplified" away later.
- Everything else the reviewer checked directly against the code (not just this worksheet's
  claims) came back clean: the generic `paginate()` refactor genuinely preserves 429 backoff,
  proactive throttling, and abort-aware pacing (the pre-existing `paginateChannelContents` test
  suite passed unchanged against it); the channel-to-channel pacing addition correctly skips after
  the last channel and after abort; module placement and `SyncSummary`'s lack of Are.na wire-shape
  leakage both match `AGENTS.md`.

### Final state

- `bun run check`: 0 errors (including the new `scripts/tsconfig.json` pass).
- `bun run lint`: clean.
- `bun run test`: 64/64 passing (5 files).
- `bun run build`: succeeds.
- `bun run scripts/sync.ts` verified against the real account twice: once by accident (see the
  real-world validation note above, before the P1 fixes — 104/104 channels, 0 failures), and the
  missing-token error path verified deliberately afterward (renaming `.env` aside) with the
  expected clean exit-1 failure.
