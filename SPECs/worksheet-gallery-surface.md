# Gallery surface worksheet

## Scope

- TODO: Slice 3 — gallery surface. All four items describe one page: URL-backed search
  state, result cards with loading/no-result/unavailable states, safe image and link
  behavior, and keyboard/narrow-screen behavior. They cannot land separately without
  shipping a half-wired page, so they are one vertical slice.
  `docs/prd.md` the product stance, `docs/svelte-guidelines.md` the implementation rules.

## Reviewed

- `AGENTS.md`, `TODOS.md`, `docs/workflows/agent-loop.md`, `docs/workflows/agent-review.md`
- `docs/prd.md`, `docs/architecture.md` (retrieval behavior, reliability),
  `docs/svelte-guidelines.md`
- `src/lib/server/search/*` (contracts, request parser, handler, repository),
  `src/lib/domain/archive.ts`, `src/lib/server/indexing/normalize.ts`,
  `src/routes/api/search/+server.ts`, `src/routes/+page.svelte`, `src/styles/*`
- Baseline: main's CI was already failing (`wrangler types --check`) for every run since
  `b1e3134`. Root-caused and fixed first, in its own commit `616dfa2` — the generated
  file's content depends on whether a build has run, so it cannot be committed. Local
  `check`/`lint`/`test`/`build` all pass before starting this task.
- Svelte MCP server: its documentation tool is unusable in this environment (the server
  fetches `svelte.dev`, which the network policy blocks). The autofixer half works when
  invoked through the package's CLI, so it is used on every component here. Local
  SvelteKit sources in `node_modules` were read directly instead of the docs tool for the
  two patterns that mattered — see below.

## Investigation findings

- **SvelteKit intercepts GET form submissions.** `node_modules/@sveltejs/kit/src/runtime/client/client.js`
  handles `submit` for `method === 'get'` and navigates client-side with
  `url.search = new URLSearchParams(formData)`. A plain `<form method="GET" action="/">`
  therefore gives URL-backed state, shareable links, working back/forward, and a
  no-JS fallback with no client-side navigation code of our own.
- **Empty form fields submit as empty params** (`?q=&from=&to=`). Today
  `parseArchiveSearchRequest` rejects `from=` / `mode=` (empty string fails
  `z.iso.date()` / the mode enum), so the natural form submission would 400. The parser
  must treat blank values as absent. This also hardens `/api/search`.
- **`navigating` from `$app/state`** is the loading signal for a navigation already in
  flight; no request state of our own.
- **Filter option sources.** Block types are a closed set of five (`Text`, `Image`,
  `Link`, `Attachment`, `Embed`) fixed by Are.na's own schema, so the type filter can be
  a real checkbox group. There is no cheap source of "every channel in the archive":
  Turbopuffer has no facet query we can rely on for an array attribute, and a public
  request may not call Are.na. So channels are filtered by clicking a channel on a
  result card (which is honest — it only offers channels the archive actually returned),
  and active channel filters are removable from a filter summary row.
- Repository/query behavior is slice 2's and is not touched.

## Plan

1. **Reuse the search pipeline, don't duplicate it.** Extract the env → repository wiring
   from `src/routes/api/search/+server.ts` into `src/lib/server/search/config.ts`, and add
   `executeArchiveSearch(url, …)` to `handler.ts` returning a discriminated outcome
   (`ok` / `invalid` / `unavailable`). `handleSearchRequest` becomes a thin JSON mapper
   over it; `+page.server.ts` maps the same outcome to page state. One parser, one error
   policy, one correlation-ID/logging path for both surfaces.
2. **Normalize blank query params** in `parseArchiveSearchRequest`: treat empty or
   whitespace-only `mode`, `from`, `to` as absent and drop empty repeated
   `channel`/`type` values. Keeps the existing grammar, makes a plain HTML form valid.
3. **`src/routes/+page.server.ts`** returns `{ state, results | correlationId, status, limit }`
   where `state` is the server-validated search state echoed back for the form
   (dates as `yyyy-mm-dd`). No Turbopuffer or ranking concepts cross into the route.
4. **`src/lib/domain/search-params.ts`** (framework-free, unit-tested): `ArchiveSearchState`,
   `ARCHIVE_BLOCK_TYPES`, `toArchiveSearchHref(state)` building canonical hrefs (omit
   empty values, omit `mode` when it is the implicit default), and `formatConnectedAt`
   for card dates in UTC. Components compute patches inline and hand them to the href
   builder, so there is one tested URL-grammar owner shared by the form, the card channel
   links, and the filter chips.
5. **Components** under `src/lib/components/`: `SearchForm.svelte` (query, mode, block
   types, date range), `ActiveFilters.svelte` (removable channel/type/date chips),
   `ResultCard.svelte`, `ArchiveMessage.svelte` (no-result / unavailable / invalid).
   The page composes them, renders the result count in an `aria-live` status, and marks
   the grid `aria-busy` while `navigating.to` is set.
6. **Design contract.** Light-only tokens and primitives only; no new global selectors.
   Continuous canvas, no cards-in-cards: a result is an `<article>` with a fixed
   `aspect-ratio` media box (prevents CLS without intrinsic dimensions, which the schema
   does not store), `loading="lazy"`, `decoding="async"`, and `alt=""` because the image
   sits inside a link whose text already names the block — the archive has no alt text
   from their own block type, marked as a label, never presented as archive metadata.
7. **Keyboard/narrow screen.** `data-sveltekit-keepfocus` on the form so focus is not
   thrown to `<body>` on submit; the result count is an `aria-live="polite"` status so the
   change is still announced. Native controls throughout, one `h1`, visible focus rings
   from the global token. Grid reflows to one column; no horizontal overflow.
8. **Tests** (node environment only — the project has no component test setup and adding
   one is out of this slice's scope): parser blank-value normalization, the new
   `executeArchiveSearch` outcomes, the href builder and date formatter, and a drift test
   asserting `ARCHIVE_BLOCK_TYPES` still equals the Are.na schema's block union.
9. Update `AGENTS.md` only where this task actually establishes a rule
   (component directory), `CHANGELOG.md` for the user-visible surface, and `TODOS.md`.

## Risks

- Blank-param normalization touches the shared parser — `/api/search`'s existing
  behavior must not change for non-blank input; cover with tests.
- `keepfocus` can hide a navigation from screen readers; paired with the live region.
- The channel filter has no global channel list. Accepted for V1 and recorded as a
  follow-up TODO rather than inventing a facet source.

## Plan review

Three reviewers (SvelteKit/Frontend, Systems Architect, QA) ran against the plan above. What
changed as a result — all of it is in the implementation:

- **The form would have wiped active channel filters (P1, frontend).** A GET submit replaces the
  whole query string with the form's own fields, and channels are not form controls. Active
  channels now render as hidden inputs, asserted in `markup.ssr.spec.ts`, and verified in a real
  browser (submitting with a channel filter keeps it in the URL).
- **Clearing the query would have 400'd (P1, frontend + QA).** The mode control's default option
  now submits `""`, which the parser reads as "no mode" and resolves to browse. The parser's
  existing guard is untouched: an explicitly chosen exact-words/related-ideas ranking with no query
  is still a 400, which with JS cannot be reached (the canonical href drops a ranking that cannot
  apply) and without JS renders the invalid state with the filters preserved.
- **Two owners of the URL grammar (P1, architect + QA + frontend).** `src/lib/domain/search.ts` now
  owns parameter names, the implicit-mode rule, and the date format; `request.ts` consumes them. A
  round-trip test drives a table of states through `toArchiveSearchHref` → `parseArchiveSearchRequest`.
- **`ArchiveSearchState` vs `ArchiveSearchInput` (P1, architect).** `executeArchiveSearch` returns
  the view state alongside results, so there is one mapping, tested, rather than a parallel type.
- **`/api/search` contract tests must survive the split (P1, QA).** `handler.spec.ts` is unchanged
  and still drives `handleSearchRequest` at the `Response` level; outcome-level tests were added
  beside it, including repeated-parameter → invalid, no repository construction and no correlation
  ID on the 400 path, and a misconfigured service reported as `providerStatus: null`.
- **Blank-normalization could have swallowed malformed input (P1, QA).** It drops only
  whitespace-only values; `mode=fuzzy`, `from=not-a-date`, `from=2024-13-45`, `from=2024-1-2`,
  `from=2024-01-02T00:00:00Z`, and a leading-space date all still 400, each with a test.
- **`type` was open-ended (P2, architect).** `?type=Photo` used to return an empty gallery; it is
  now a 400 against the five-type closed set, with a drift test next to the Are.na schema.
- **Silent unavailability (P2, architect).** The logger is now the default reporter rather than a
  no-op, so omitting it cannot lose a 503.
- **The `alt=""` rationale was factually wrong (P2, architect + frontend).** Are.na _does_ expose
  `image.alt_text`, `width`, and `height`; our normalizer discards them. `alt=""` inside a
  title-named link stays the right V1 call, but the reason is our indexing choice, and indexing
  them is now a Slice 4 TODO.
- Also adopted: dedupe results by id before a keyed `{#each}`; a text-forward card for blocks with
  no image; `resolve()` on internal hrefs and `rel="external"` on Are.na links; a reader-facing
  ranking label instead of retrieval jargon; honest "showing the first 24" wording; pure state
  transitions (`withChannel`, `withoutChannel`, …) tested rather than inline in components;
  `resolveSearchConfig` split out so environment precedence is observable in a test; `kind` rather
  than `status` for the outcome discriminant.

Not adopted: demoting an explicit non-browse mode with a blank query to browse (QA's option (a)).
It would relax a guard Slice 2 added deliberately, and the form no longer produces that URL.

## Result

- Added `src/routes/+page.server.ts`, a rewritten `src/routes/+page.svelte`, and
  `src/lib/components/` (`SearchForm`, `ResultCard`, `ActiveFilters`, `ArchiveMessage`, `format.ts`).
  The old placeholder page's hardcoded dark palette is gone; everything reads tokens.
- Added `src/lib/domain/search.ts` as the URL-grammar and search-vocabulary owner (state type, mode
  and block-type vocabularies, href builder, lenient reader, pure state transitions, `SearchResult`
  moved here from the server contract so components never import `$lib/server/**`).
- Added `src/lib/server/search/execute.ts` (`executeArchiveSearch`, transport-neutral) and
  `config.ts` (`resolveSearchConfig` / `createSearchRepository`). `handler.ts` is now only the JSON
  mapper; both the page and `/api/search` share one parser, one error policy, and one sanitized
  correlation-ID path.
- Tests: 150 pass (was 100). New coverage for the URL round trip, state transitions, blank-value
  and malformed-value parsing, outcome shapes, environment resolution, date/title formatting, the
  block-type drift between the Are.na schema and the UI vocabulary, and server-rendered markup
  contracts.
- Docs: `AGENTS.md` (components directory, grammar-ownership invariant), `docs/architecture.md`
  (blank parameters, closed type set, why V1 has no channel enumeration),
  `docs/svelte-guidelines.md` (components boundary, the GET-form caveat, `navigating` shape, no
  route announcer, SSR markup testing, MCP CLI fallback), `CHANGELOG.md`, `TODOS.md`.

### Manual verification

Run against `bun run dev` with a temporary stubbed `load` (no Turbopuffer credentials exist in this
environment), driving a real Chromium. The stub was removed afterwards; the real load was then
re-verified against the running dev server.

- Tab order: query → Search → ranking → five type checkboxes → date inputs → chips → cards. No
  positive `tabindex`, no trap.
- Submitting with `channel=materials` active produced `?q=concrete&channel=materials` — the filter
  survives, which is the bug the plan would have shipped.
- Focus stays on the search input across a submit (`keepFocus`), so the live region is the only
  announcement: mid-navigation it reads `Searching for “concrete”…` (the _pending_ query, not the
  stale one), the grid carries `aria-busy="true"` and dims to 0.5, and the region sits outside that
  subtree. After it settles: `Showing the first 24 blocks for “concrete”.`
- No horizontal overflow at 320px or 1280px; the grid reflows to one column and controls stack.
- Unavailable, no-result, and unreadable-search states all keep the form and its values on screen;
  the unavailable state shows the correlation ID in mono.
- Real (unstubbed) load with no credentials renders the unavailable state and logs only
  `{ correlationId, providerStatus }` — no query text, no token. `/api/search?q=felt` returns 503
  with a correlation ID; `/api/search?type=Photo` returns 400.
- Not verified here: a screen reader, and results from a live Turbopuffer namespace (no
  credentials). The evaluation pass over real data stays a Slice 4 item.
- Validation: `bun run check`, `bun run lint`, `bun run test`, `bun run build` all pass.
