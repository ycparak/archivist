# Worksheet: Concise architecture notes on the about surface

- TODO: `TODOS.md` — Slice 4, "Concise architecture notes on the product's about surface."
- Ties to PRD goal 3 ("make the technical choices legible in the repository") and the design

## Approach

No about surface existed yet, so this adds one: `src/routes/about/+page.svelte`, linked from the
home page masthead ("How this works").

Three short sections, each sourced from an existing doc rather than restating it verbatim, written
for a portfolio visitor rather than a contributor:

- **Where the archive comes from** — Are.na as source of truth, maintainer-only manual sync, no
  generated metadata, no live proxying to Are.na for visitor requests (from
  [docs/architecture.md](./architecture.md#why-this-data-access-model) and the PRD content policy).
- **How search works** — the four retrieval modes and Turbopuffer RRF, in plain language (from
  [docs/architecture.md](./architecture.md#retrieval-behavior)).
- **How it's built** — SvelteKit on Cloudflare Workers, Turbopuffer as the sole datastore (from
  [docs/architecture.md](./architecture.md#decision-summary)).

`reading-width` prose, `.divider` between sections instead of cards, no new components or tokens.
Internal links use `resolve()` from `$app/paths`, matching `ResultCard`/`ActiveFilters`.

No new unit test: the page is static content with no normalizer, filter builder, or result mapper
to exercise, and the existing SSR markup spec file only covers `src/lib/components/*`. Verified
manually in the dev server instead (screenshot below reflects what was checked).

## Outcome

`bun run check`, `lint`, `test`, and `build` all pass. Manually verified in the browser: `/about`
renders with the intended headings/copy, the home page's "How this works" link navigates to it,
and "Back to search" returns to `/` without breaking the existing gallery/search flow.
