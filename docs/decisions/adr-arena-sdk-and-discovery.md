# ADR: Adopt @aredotna/sdk; auto-discover channels instead of an explicit allowlist

**Status:** Accepted

## Context

Two related decisions came up while building the Are.na ingestion path, after the initial typed
page client (`src/lib/server/arena/`, hand-rolled `fetch` + Zod) was already implemented, tested,
reviewed, and committed:

1. The maintainer asked to sync every channel their Are.na account owns rather than maintain an
   explicit `ARENA_CHANNEL_SLUGS` list. `docs/prd.md` and `docs/architecture.md` had called the
   explicit allowlist out as an intentional, deliberate choice (reviewable scope, no open-ended
   discovery), so this reverses a documented decision rather than filling in an open one.
2. Are.na publishes an official TypeScript SDK, `@aredotna/sdk` (`github.com/aredotna/sdk`,
   generated from the same OpenAPI spec), which duplicates a meaningful share of the hand-rolled
   client: URL/query construction, pagination, normalized error classes, rate-limit header
   parsing. `AGENTS.md` requires preferring an official SDK when it removes meaningful production
   code.

## Decision

**Auto-discover, don't enumerate manually.** The sync resolves the maintainer's own user id
(`GET /v3/me`) and lists every channel they own (`GET /v3/users/{id}/contents?type=Channel`,
paginated), then syncs each one — no `ARENA_CHANNEL_SLUGS` config. `docs/prd.md` and
`docs/architecture.md` are updated accordingly. This _increases_ Are.na Acceptable-Use exposure
(see the [Are.na page-client worksheet](./worksheet-arena-page-client.md) for the original ToS
discussion): a reviewable, human-maintained scope is gone. The maintainer made this call
knowingly, trading it for convenience; the mitigations from that first discussion (manual/
occasional invocation only, paced requests, proactive rate-limit throttling) become load-bearing
rather than defense-in-depth, since scope is no longer human-reviewed per run.

**Adopt `@aredotna/sdk` for transport, keep our own Zod validation on top.** `src/lib/server/arena/client.ts`
now wraps `createArena()` instead of calling `fetch` directly: request/URL construction, the
`channels.contents()` operation, and normalized error classes (`ArenaApiError`,
`ArenaRateLimitError`, `ArenaNetworkError`) all come from the SDK. `src/lib/server/arena/schemas.ts`
is unchanged and still validates every response at the boundary — the SDK is a typed HTTP client
generated from the OpenAPI spec, not a runtime validator, and `AGENTS.md` requires Zod validation
of untrusted API responses regardless of what produced them.

Two things this repo's `client.ts` deliberately does _not_ delegate to the SDK, because the SDK's
own behavior (as of `0.1.1`, read from its source) is weaker than what was already built and
reviewed here:

- **Rate-limit backoff.** The SDK's `retry.respectRateLimits` option only ever waits based on
  `X-RateLimit-Reset`, with no floor and no `Retry-After` support at all. `resolveRateLimitRetryDelayMs`
  (unchanged from the original implementation) prefers `Retry-After`, falls back to
  `X-RateLimit-Reset`, and floors both — kept as this module's own error-mapping step instead.
- **Proactive throttling.** The SDK's exposed `Arena.rateLimit` never parses `X-RateLimit-Remaining`
  (confirmed against its source), even though the OpenAPI spec's `info.description` documents that
  header as present on every response. This module wraps the `fetch` it hands the SDK purely to
  read that header itself (`wrapFetchForRateLimitTracking` in `client.ts`), so `paginateChannelContents`
  can still slow down _before_ the budget is exhausted, not just react to an eventual 429 — the
  behavior the maintainer specifically asked for when this was first discussed.

Everything else in `client.ts` (`paginateChannelContents`, the per-page retry loop, the
abort-aware pacing delay) is unchanged from the version that was already reviewed — only what's
underneath `ArenaClient.fetchChannelContentsPage` changed.

## Consequences

- New runtime dependency: `@aredotna/sdk@0.1.1`. It is early (v0.1.1, ~114 weekly downloads at
  time of writing) but is the vendor's own package, generated from the same spec this project
  already treats as authoritative, with CI/tests/typecheck in its own repo. If it proves
  unreliable, the adapter boundary (`src/lib/server/arena/client.ts`) is the only place that would
  need to change back — nothing outside `src/lib/server/arena/` depends on SDK types directly.
- `ArenaClientOptions.baseUrl` now means the SDK's base (no `/v3` suffix), not the previous
  `https://api.are.na/v3` convention. No other code set this option yet.
- The channel-discovery TODO (`TODOS.md`, Slice 1) should use `arena.users.contents(id, { type: 'Channel' })`
  / `arena.users.paginateContents` (via a new method on `ArenaClient`, not a second hand-rolled
  fetch path) and `arena.me()` to resolve the maintainer's own id.
- No Turbopuffer schema or search-invariant changes; this is entirely within
  `src/lib/server/arena/`.
