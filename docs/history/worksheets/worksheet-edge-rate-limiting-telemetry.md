# Edge rate limiting and error telemetry

## Task

[`TODOS.md`](../../TODOS.md): “Edge rate limiting and basic error telemetry before public deployment.”

## Initial state

- Working tree was clean before this task. Baseline `bun run check` and `bun run test` passed.
- Baseline lint exposed formatting drift in the completed image-metadata worksheet; it was
  normalized before implementation.
- Relevant references reviewed: `AGENTS.md`, `docs/workflows/agent-loop.md`,
  `docs/architecture.md`, and Cloudflare/Workers best-practices guidance.

## Investigation and plan

- Both `/` (the SSR gallery) and `/api/search` invoke `SearchRepository`; limiting only the API
  would leave the expensive public path exposed. A `handle` hook is the narrow shared boundary
  before either route executes.
- Cloudflare's Workers Rate Limiting binding accepts a string key and is local to a Cloudflare
  location/eventually consistent. Because V1 has no user identities or API keys, use
  `cf-connecting-ip` when present, with an `unknown` fallback. Both protected paths use the same
  `archive-search:<identity>` key, so SSR and API requests consume one upstream-protection budget.
  This is less fair to visitors behind a shared address but is the only request identity available;
  the modest limit reduces the impact. Never log this key or its source address.
- Add a `ARCHIVE_SEARCH_RATE_LIMITER` binding in `wrangler.jsonc`: 60 requests per 60 seconds,
  namespace `"1"`. It covers `GET /` and `GET /api/search` only, leaving static assets, the about
  page, and other methods untouched. An exceeded request returns `429`, `Retry-After: 60`, and
  `Cache-Control: no-store` before Turbopuffer is instantiated. `/api/search` retains a JSON
  error envelope; `/` receives a minimal HTML retry message.
- When the binding is absent (ordinary `bun run dev`) or its `limit` call throws, fail open so a
  deployment/configuration incident does not turn search into a new 500. A failed call emits a
  safe structured error event. Production validation must confirm the binding is present and
  namespace `"1"` is otherwise unused in the deployer's account.
- Enable Cloudflare Workers observability with persisted logs/traces and 100% head sampling while
  traffic is low. Set `redact_query_string` so provider-bound search terms never enter platform
  request telemetry.
- Add a testable server-only rate-limit module for route matching, key construction, response
  shape, binding failure, and structured telemetry. The hook merely composes it with SvelteKit's
  platform binding. Rate-limit events may contain only `{ event, route, status }`; unavailable
  search events may contain only `{ event, correlationId, providerStatus }`. They must never
  include a raw URL, query string, headers, client address, limiter key, provider payload, or raw
  error. Existing unavailable-search logging becomes the latter explicit event shape.
- Add focused Vitest coverage for the module and hook behavior, update the reliability section of
  `docs/architecture.md`, `docs/CHANGELOG.md`, and this worksheet. No schema migration or provider
  behavior changes are involved. The pre-launch checklist will require generated-type/config
  validation, a controlled over-limit sequence in the deployed environment, an Observability
  inspection for query-redacted events, and manual full-page plus enhanced-navigation 429 checks.

### Risks and decisions

- The binding's counter is per Cloudflare location and can briefly over-admit bursts by design;
  this is an abuse brake, not an accounting/security boundary.
- `namespace_id` must be unique within the deployer's Cloudflare account. `1` is the initial
  Archivist-only namespace; change it before deployment if that account already uses it.
- This is an availability-preserving abuse brake, not a security/accounting boundary. The task's
  telemetry is operational error logging, not visitor analytics or a new data store.

## Plan review

- SvelteKit/Frontend, Systems Architect, and QA reviews all approved the hook boundary but required
  the missing/throwing binding policy and concrete response/logging contracts. The plan above now
  addresses those P1 findings; route-matching and deployment-verification P2 feedback is included
  in test and handoff coverage.

## Implementation and results

- Added `ARCHIVE_SEARCH_RATE_LIMITER` (60 per 60 seconds, namespace `"1"`) plus full, persisted
  Workers Logs/Traces sampling with query-string redaction in `wrangler.jsonc`.
- Added the server-only `rate-limit` seam and the thin SvelteKit `handle` hook. It protects only
  `GET /` and `GET /api/search`, uses the shared client key, returns route-appropriate cache-safe
  429 responses, bypasses a missing local binding, and fails open after a safe event if the binding
  call fails.
- Replaced the unavailable-search console message with an allowlisted structured event.
- Added unit coverage for key sharing/fallback, eligibility, absent and throwing bindings, both 429
  response contracts, exact telemetry shape, and hook composition (an exceeded limit does not call
  `resolve`; an allowed or missing binding does). Focused tests pass.
- `bun run dev` smoke-tested the local gallery: it rendered successfully with the expected missing-
  binding bypass. The 429 behavior requires the configured Cloudflare binding and remains a
  deployed-edge check.
- Full validation passed: `bun run check`, `bun run lint`, `bun run test`, `bun run build`, and
  `git diff --check`. Wrangler's debug-log file could not be written from the filesystem sandbox,
  but type generation, checking, and builds completed successfully.
- Implementation review: SvelteKit review approved. Systems review found no code/design issue but
  requires the maintainer to verify that namespace `"1"` is unused in the deployment account before
  public deployment. QA review requested hook coverage and gallery-header assertions; both were
  added and verified.

## Before public deployment

1. Confirm rate-limit namespace `"1"` is not used by another Worker in the target Cloudflare
   account; choose a different dedicated positive integer if it is.
2. Deploy to a non-production Worker and send more than 60 requests within a minute from one edge
   location. Confirm `GET /` receives the retry HTML and `GET /api/search` receives the documented
   JSON 429 response.
3. In Workers Observability, confirm the structured events are present and request query strings
   are redacted. Check both a full-document navigation and enhanced gallery navigation after a 429.
