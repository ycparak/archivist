# Technical architecture — Archivist V1

## Decision summary

Use **SvelteKit + TypeScript + Cloudflare Workers adapter** for the public app, **Are.na V3** for explicit manual ingestion, and the official **Turbopuffer TypeScript SDK** as the sole V1 search datastore. Use Turbopuffer native embeddings and full-text BM25 over one canonical text field; use its `multiQuery` endpoint with reciprocal-rank fusion for hybrid retrieval.

SvelteKit is the preferred stack over React + TanStack for this project: it supplies SSR, URL routing, server-only endpoints, and a light client surface in one TypeScript codebase. React’s ecosystem does not unlock a V1 requirement here.

## System shape

```text
Maintainer CLI (manual sync)
  -> Are.na V3, read-only personal token
  -> normalize original block metadata
  -> Turbopuffer namespace: arena-blocks-v1

Public SvelteKit app on Cloudflare Workers
  -> GET /api/search?mode=&q=&channel=&type=&from=&to=
  -> SearchRepository
  -> Turbopuffer multiQuery / query
  -> typed original-block result cards

V2 only: Mastra agent
  -> read-only search_archive tool
  -> same SearchRepository
  -> cited answer + original Are.na links
```

## Why this data-access model

Use a **read-only personal access token** for the maintainer’s sync. Are.na documents personal tokens as the simplest route for personal scripts, and its read scope can access resources available to the owner without mutation. A public unauthenticated path can power a demo but can omit private/archive-specific content and is limited to 30 requests per minute; an authenticated free account is documented at 120 requests per minute. The token runs only in the manually invoked sync, never in a deployed public request.

The sync auto-discovers scope: it resolves the maintainer's own user id (`GET /v3/me`), lists every channel that user owns (`GET /v3/users/{id}/contents?type=Channel`, paginated), and syncs each one's contents. This supersedes an earlier explicit `ARENA_CHANNEL_SLUGS` allowlist design — traded deliberately for convenience (no channel list to hand-maintain) after the maintainer requested it, at the cost of a reviewable, bounded scope. That tradeoff sits closer to what Are.na's Acceptable Use policy calls "systematic downloading" / "structured data harvesting," which already applies to any full-channel-history sync regardless of scope size; the mitigations already in place — manual/occasional invocation only, paced per-request delays, and proactive rate-limit throttling off `X-RateLimit-Remaining` (see `src/lib/server/arena/client.ts`) — matter more, not less, once scope is no longer human-reviewed per run. The sync requests pages of at most 100, checkpoints progress, uses response rate-limit headers, backs off on 429, and upserts in batches. Do not send a live Are.na request for a visitor's query.

## Turbopuffer namespace

Namespace: `arena-blocks-v1` by default, configurable with `TURBOPUFFER_NAMESPACE`.

Turbopuffer requires stable types per attribute and does not permit in-place type changes. Therefore version the namespace for a breaking schema change (`arena-blocks-v2`) and document the migration in an ADR in [`SPECs/`](../SPECs/).

| Attribute       | Type / index                               | Purpose                                    |
| --------------- | ------------------------------------------ | ------------------------------------------ |
| `id`            | string, `block:<Are.na id>`                | deterministic document key                 |
| `search_text`   | string, `full_text_search`, native `embed` | single canonical lexical + semantic corpus |
| `block_type`    | string, filterable                         | type filter                                |
| `channel_slugs` | `[]string`, filterable                     | membership filter                          |
| `connected_at`  | datetime, filterable                       | browsing and date filter                   |
| `created_at`    | datetime, unindexed                        | result metadata                            |
| `title`         | string, unindexed                          | card copy                                  |
| `description`   | string, unindexed                          | card copy                                  |
| `source_url`    | string, unindexed                          | original source link                       |
| `arena_url`     | string, unindexed                          | canonical result link                      |
| `image_url`     | string, unindexed                          | gallery image                              |
| `source_title`  | string, unindexed                          | attribution                                |

`search_text` is deterministic whitespace-normalized concatenation of non-empty `title`, `description`, plain text content (only if supplied by Are.na), `source_title`, and channel titles. Retain display fields separately; never attempt to parse media or scrape a source URL during V1.

The initial native embedding model is `nvidia/nemotron-3-embed-8b` with 1024 dimensions, as shown in Turbopuffer’s current native embedding guide. Keep the model in the schema creator, not the query route. A model/dimension change is a namespace migration.

## Retrieval behavior

`mode=hybrid` makes one Turbopuffer `multiQuery` request:

```ts
{
  queries: [
    { rank_by: ['search_text', 'BM25', query], ...shared },
    { rank_by: ['search_text', 'ANN', ['Embed', query]], ...shared }
  ],
  rerank_by: ['RRF']
}
```

`shared` includes a result limit, presentation attributes, and an `And` filter built from the optional V1 filters. Lexical and semantic modes issue their respective single query. Browse does no text query: it orders matching records by `connected_at` descending. Keep candidate/result limits server-owned to prevent an expensive public-query knob.

RRF belongs in Turbopuffer, not in client code. It combines independently ranked lists without assuming BM25 and vector distance are numerically comparable.

## Reliability and security

- Validate URL query parameters and Are.na responses with Zod at their boundary.
- Return a generic 503 for unavailable Turbopuffer credentials/service; log a correlation ID and provider status, never a token or raw archive response.
- Set a request timeout below the platform limit and use the SDK’s bounded retry behavior. Do not retry client validation errors.
- Rate-limit the public search endpoint at the edge before public launch. The exact Cloudflare binding is deployment infrastructure, not a reason to add user accounts.
- Use SSR/server API routes for all provider access. Only public image and Are.na URLs are sent to the browser.
- Escape/avoid raw block HTML. Render normalized text as text.

## Sync lifecycle

1. Validate `ARENA_ACCESS_TOKEN`, Turbopuffer config, and the namespace schema.
2. Resolve the maintainer's own user id and discover every channel they own; fetch each channel's pages, checkpointing each completed page locally.
3. Normalize blocks into stable documents; deduplicate by Are.na block ID while unioning channel membership. `connected_at` is a per-channel connection timestamp, not stable block metadata — when the same block is connected to more than one channel, keep the most recent `connected_at` across those channels, matching browse mode's newest-first ordering. Every other field comes from the block resource itself and doesn't need this treatment.
4. Upsert batched rows. Re-running the same sync is idempotent.
5. Report fetched, normalized, upserted, skipped, and failed counts.

Deletion reconciliation is explicitly deferred: V1 upserts current known blocks and does not silently delete a document because one partial sync did not see it. Add a separately reviewed `--prune` workflow only after export/diff behavior is tested against multi-channel membership.

## V2 seam: Mastra

Do not make Turbopuffer a UI concern. Expose an internal, typed `SearchRepository.search(input)` contract. In V2, wrap it as a Mastra `search_archive` tool with a strict input/output schema. An `archive-research` agent may call it at most three times, must cite `arena_url` for every claim, and must say when retrieval lacks evidence. Mastra supports registered agents callable from route handlers and streamed responses; its Turbopuffer package is available, but V2 should reuse the V1 repository rather than duplicate indexing prematurely.

## Sources checked

- [Are.na API documentation](https://www.are.na/developers/explore): authentication, tiers, pagination, caching, and rate limits.
- [Turbopuffer vector search](https://turbopuffer.com/docs/vector): native embedding configuration and filtered ANN.
- [Turbopuffer query API](https://turbopuffer.com/docs/query): filters and multi-query support.
- [Turbopuffer write API](https://turbopuffer.com/docs/write): schema behavior, index costs, and migration constraint.
- [Mastra agent overview](https://mastra.ai/docs/agents/overview): registered agents, tools, and streaming.
