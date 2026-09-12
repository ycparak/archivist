# Worksheet: Typed Are.na V3 page client with rate-limit-aware pagination

- TODO: `TODOS.md` — Slice 1, "Typed Are.na V3 page client with rate-limit-aware pagination (`src/lib/server/arena/`)."
- Spec: none pre-existing; this worksheet is the record.

## Workspace state at start

Clean. Fixed two pre-existing, unrelated `bun run check`/`bun run lint` baseline failures first (stale `worker-configuration.d.ts`, unformatted `docs/svelte-guidelines.md`) — committed separately (`72fa085`) before starting this task.

## Docs/code reviewed

- `AGENTS.md` — architecture boundaries, engineering guardrails, product boundary.
- `docs/architecture.md` — sync lifecycle, data-access model, rate-limit reasoning (personal token, explicit channel allowlist, manual invocation).
- `docs/prd.md` — V1 job to be done, non-goals (no live sync/webhooks/scheduled jobs).
- `docs/implementation_plan.md` — slice 1 ordering.
- `docs/workflows/agent-loop.md`, `docs/workflows/agent-review.md` — process and review personas.
- `src/lib/domain/archive.ts` — target normalized `ArchiveBlock`/`SearchDocument` shape (consumed by the _next_ TODO, the normalizer — not this one).
- `src/lib/server/search/contracts.ts`, `turbopuffer-schema.ts` — sibling module conventions (flat files, no barrel `index.ts`, Zod at the boundary).
- `.env.example` — `ARENA_ACCESS_TOKEN`, `ARENA_CHANNEL_SLUGS` are the maintainer-supplied config; this client takes them as explicit constructor args, not via `$env`, so it stays usable from both a SvelteKit context and a plain script (the sync command, a later TODO).
- Are.na V3 API docs (live, fetched via browser — see below): full markdown reference at `https://www.are.na/developers/all.md`, OpenAPI schema at `https://api.are.na/v3/openapi.json`.

## Important finding: Are.na Acceptable Use policy

The current Are.na API docs state: _"This API is intended for building applications that integrate with Are.na, not for scraping or bulk data collection. Automated crawling, systematic downloading of content, or any form of structured data harvesting is prohibited... contact us to discuss your use case."_ and explicitly says not to "loop through all pages at startup" or "set `per=100` and iterate until `has_more_pages` is false."

This directly describes the sync pattern in `docs/architecture.md`. Flagged to the human before writing code. Decision: **proceed**, but keep the client deliberately gentle — paced requests, no maxed-out page size by default, honor rate-limit/backoff signals proactively. This shaped the defaults below (see Plan). Not re-litigating architecture.md's product framing (personal token, explicit allowlist, manual/occasional invocation) here — just noting the constraint and the human's call.

## Are.na V3 API shape used (verified against the live OpenAPI spec, not assumed from V2 knowledge)

- Base URL: `https://api.are.na`. Auth: `Authorization: Bearer <token>`.
- `GET /v3/channels/{slug}/contents?page=&per=&sort=` → `{ data: ConnectableItem[], meta: PaginationMeta }`.
- `meta`: `current_page`, `next_page` (nullable), `per_page`, `total_pages`, `total_count`, `has_more_pages`.
- `data` items are a discriminated union on `type`: `Text | Image | Link | Attachment | Embed` (blocks) or `Channel` (nested sub-channel — not a block; out of scope for the normalizer per the product boundary, but the client still needs to parse/pass it through rather than choke on it).
- Rate-limit headers on every response: `X-RateLimit-Limit`, `X-RateLimit-Tier`, `X-RateLimit-Window`, `X-RateLimit-Reset`. **Correction (caught in review, see below):** the rendered docs page stops there, but the OpenAPI spec's own `info.description` additionally documents `X-RateLimit-Remaining` (plus `Bucket`/`Cost`/`Policy`) as present on every response — the spec is the more current source. `429` responses carry `Retry-After`; docs recommend a short delay (200–500ms) between sequential requests regardless.

## Plan

Scope: transport + pagination only, per `AGENTS.md`'s `src/lib/server/arena/` boundary. No normalization to `ArchiveBlock`/`SearchDocument` (that's the next TODO) and no sync orchestration/checkpointing (a later TODO) — this client is a dependency of both.

Files:

- `src/lib/server/arena/schemas.ts` — Zod schemas for the wire shape (snake_case, matching the API) of block variants, the nested-channel variant, and the paginated contents response. Exported as `arenaChannelContentsResponseSchema` + inferred types.
- `src/lib/server/arena/client.ts`:
  - `ArenaClient` — takes `{ accessToken, fetchFn?, baseUrl? }` explicitly (no `$env` coupling); `fetchChannelContentsPage(slug, { page, per, sort, signal })` does one validated request.
  - `ArenaRequestError` / `ArenaRateLimitError` — typed errors; the rate-limit one carries a computed `retryAfterMs` (from `Retry-After`, falling back to `X-RateLimit-Reset`, then a floor).
  - `paginateChannelContents(client, slug, options)` — async generator yielding one validated page at a time, stopping on `has_more_pages: false`, retrying a 429 up to `maxRetriesPerPage` by waiting `retryAfterMs`, and pacing every request with an injectable `delayFn` (default a real `setTimeout`, default delay conservative — smaller than Are.na's max `per` and with a real inter-request pause, per the "keep it gentle" decision above).
- Tests colocated: `schemas.spec.ts` (each block variant + the channel variant parse; malformed discriminator rejected) and `client.spec.ts` (URL/header construction, 429 → `ArenaRateLimitError` with both header-derivation paths, non-2xx → `ArenaRequestError`, malformed body fails explicitly via Zod, `paginateChannelContents` pages until exhaustion, retries a transient 429, gives up after `maxRetriesPerPage`, and paces between pages via the injected `delayFn` so tests don't sleep for real).

No doc changes anticipated unless implementation reveals `docs/architecture.md` needs a note about the client's default pacing — will add if so.

## Review

Given the contained, single-module scope (no route/UI/search-schema/cross-boundary changes), skipping the full multi-persona sub-agent review loop; self-reviewing implementation against the Data/Sync Expert checklist in `docs/workflows/agent-review.md` (rate-limit/backoff correctness, no `src/lib/domain/` or `search/` leakage, provider shapes not exposed past this module) before handoff, and will spawn a Data/Sync Expert sub-agent for a fresh-context implementation review before marking done, per the persona activation guidance ("Touching `src/lib/server/arena/` → include Data/Sync").

## Implementation notes

Implemented as planned: `src/lib/server/arena/schemas.ts` (wire-shape Zod schemas) and
`src/lib/server/arena/client.ts` (`ArenaClient`, `paginateChannelContents`, typed errors), with
`schemas.spec.ts` and `client.spec.ts`.

### Review round

Spawned a fresh-context Data/Sync Expert sub-agent per `docs/workflows/agent-review.md`. It found
and I fixed:

- **P1** — `arenaAttachmentBlockSchema`/`arenaEmbedBlockSchema` didn't declare `attachment`/`embed`
  as required, so Zod silently dropped the entire payload (download URL / embed HTML) for those
  two block types. The matching test fixtures had the same gap, so nothing caught it. Fixed by
  declaring `attachment: blockAttachmentSchema` and `embed: blockEmbedSchema` as required, with
  a rejection test for each when the payload is missing.
- **P2** — the worksheet's claim that Are.na has no `X-RateLimit-Remaining` header was wrong: the
  _rendered_ docs page omits it, but the OpenAPI spec's own `info.description` (fetched directly,
  more authoritative) documents it alongside `X-RateLimit-Bucket`/`Cost`/`Policy`. Corrected here
  and used it: `ArenaClient` now parses rate-limit headers on every response (`parseRateLimitInfo`),
  and `paginateChannelContents` proactively waits until the bucket resets once remaining budget
  drops to a safety margin (default 1), instead of only ever reacting after an actual 429. This
  is the real fix for the human's "keep it gentle" instruction — reactive-only backoff was always
  going to eat at least one 429 per exhausted bucket.
- **P2** — several wire fields the spec marks nullable-but-not-required (`title`, `description`,
  `alt_text`, `source.title`) were modeled `.nullable()` instead of `.nullable().optional()`. An
  omitted key (not just an explicit `null`) would have failed the whole page's parse. Fixed, with
  a regression test asserting an item with those keys entirely absent still parses.
- **P2** — the 429-backoff and inter-page pacing delays didn't check the abort signal while
  sleeping, so cancelling mid-wait wouldn't take effect until the sleep finished. `delay()` is now
  abort-aware (resolves immediately on the signal's `abort` event); verified with a fake-timers
  test that a 60s pacing delay resolves as soon as the caller aborts.
- **P3** — added a page-level test mixing a `Text` block and a nested `Channel` item in one
  response (the schema already handled it; the test hadn't exercised it), plus a network-failure
  propagation test and an abort-mid-pagination test.
- **P3** (declined, in-scope-for-later) — capturing `width`/`height`/`blurhash`/`small`/`square`
  image sizes: since I was already touching `blockImageSchema` for the P1/P2 fixes, added these
  now rather than deferring — cheap, and the gallery slice will need real dimensions for safe
  `<img>` sizing per `AGENTS.md`'s guardrails.

Second review pass (self, against the same checklist): clean — stays transport+pagination only,
no domain/search leakage, `bun run check`/`lint`/`test`/`build` all pass.

### Follow-up: SDK adoption and channel auto-discovery

After this task shipped, the maintainer asked (a) to auto-discover every channel their account
owns instead of maintaining `ARENA_CHANNEL_SLUGS`, and (b) whether `@aredotna/sdk` (Are.na's
official TypeScript SDK) should be used instead of the hand-rolled `fetch` client above. Both are
real decisions — see [SPECs/adr-arena-sdk-and-discovery.md](./adr-arena-sdk-and-discovery.md) for
the full reasoning. Short version: yes to both, and `client.ts` now wraps `createArena()` instead
of calling `fetch` directly, while keeping the Zod validation in `schemas.ts`, the pagination/
backoff/proactive-throttle logic in `paginateChannelContents`, and the module's own error types
unchanged — only what's underneath `fetchChannelContentsPage` changed. Re-ran the full validation
suite after the rework; see Final state below.

### Final state

- `bun run check`: 0 errors.
- `bun run lint`: clean.
- `bun run test`: 34/34 passing (3 files: existing `archive.spec.ts` + the two arena spec files;
  updated after the `@aredotna/sdk` rework — the injected fetch mock now receives a `Request`
  object per the SDK's calling convention, and network-failure assertions check `error.cause`
  since the SDK wraps failures in its own `ArenaNetworkError`).
- `bun run build`: succeeds.
