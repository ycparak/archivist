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

## Result

_(filled in after implementation)_
