# Svelte & SvelteKit Guidelines

## Runes — State, Don't Stores

Archivist is Svelte 5. Use runes as the default state primitive.

- **`$state` for local reactive state**, `$derived` for anything computable from other state, `$effect` only for genuine side effects (DOM measurement, subscriptions, imperative third-party APIs). If a value can be `$derived`, it is a bug to store it in `$state` and keep it in sync by hand.
- **Shared reactive state that outlives one component** lives in a `.svelte.ts` module exporting a small object or class built from runes. Do not reach for a store (`writable`/`readable`) unless you specifically need its subscribe-based interop (e.g. a library that only accepts a `Readable`).
- **No `useEffect`-style watchers for things that are really actions.** If a user action (submit a search, select a filter) causes a state change and a side effect, perform the side effect in the action/handler, not in an `$effect` that reacts to the resulting state change. Reserve `$effect` for effects with no natural call site — window resize listeners, `IntersectionObserver`, syncing to `localStorage`.
- **Props via `$props()`**, destructured with defaults at the top of the component. Avoid `export let` (Svelte 4 syntax) in new code.

## Project Boundaries

These mirror the architecture boundaries in [`AGENTS.md`](../AGENTS.md) — this doc is about _how_ to write the Svelte/TypeScript inside them, not where things live.

- `src/lib/domain/`: plain TypeScript, no Svelte imports, no SvelteKit imports. If a domain file needs `$state`, it belongs somewhere else.
- `src/lib/server/`: server-only. Never import a `src/lib/server/**` module from a `.svelte` file or any code that ships to the client — SvelteKit's server-only enforcement will fail the build, and that failure is correct, not a false positive to work around.
- `src/routes/`: composition only. A `+page.svelte` renders `SearchResult`-shaped data from its `load` function; it does not call Turbopuffer, Are.na, or construct ranking expressions itself. A `+page.server.ts` / `+server.ts` calls into `src/lib/server/search/` or `src/lib/server/indexing/` rather than reimplementing adapter logic inline.
- `src/lib/components/`: shared presentation components. Client-safe by definition — never import `$lib/server/**` from one, not even a type. Types the UI needs (`SearchResult`, `ArchiveSearchState`) live in `src/lib/domain/`.

## Data Loading

- Fetch and validate in `+page.server.ts` / `+server.ts` `load`/handler functions. Validate untrusted input (query params, request bodies) with Zod at that boundary, per the Engineering Guardrails in `AGENTS.md`.
- Keep URL search params as the source of truth for browse/search/filter state (`?q=&mode=&channel=&type=&from=&to=`) so state survives reload and is linkable. Don't shadow that state in a separate client store that can drift from the URL.
- Use a plain `<form method="GET">` for URL-backed search state. SvelteKit intercepts GET submissions and navigates client-side, so the same markup works with and without JavaScript.
  **A GET submit replaces the entire query string with the form's own fields.** Any URL state that is not a control in that form — a `channel` in the URL that is not in the channel manifest, say — must be rendered as a hidden input, or submitting the form silently drops it. `SearchForm.svelte` does this.
- `navigating` from `$app/state` is an object whose _properties_ are null when idle; it is never itself null. (`$navigating` from the deprecated `$app/stores` behaves the opposite way — a common miswrite.)
- SvelteKit does not announce route changes. A page that swaps its content in place owns that announcement: keep a `role="status"` live region in the initial SSR markup, outside any `aria-busy` subtree (changes inside one are not announced), and make its text vary per request — identical text is not re-announced.
- Return only the fields the UI needs (`SearchResult`, not raw Turbopuffer rows or raw Are.na payloads) from `load` functions.

## Components

- Favor small, single-purpose components over one large page component with conditional branches. A result card, a filter control, and an empty/error state are separate components even if each is short.
- Accessible native controls first (`<button>`, `<select>`, `<a>`) — reach for ARIA roles only when no native element fits.
- Keep markup, styles (see `src/styles/`), and logic in the same `.svelte` file unless a piece of logic is reused elsewhere or is worth testing on its own, in which case extract it: shared vocabulary and transformations to `src/lib/domain/` (pure, client-shipped), presentation-only helpers to a plain `.ts` beside the components (`src/lib/components/format.ts`), reactive shared state to a `.svelte.ts` module. Branching that decides user-visible copy belongs in a tested function, not in a `$derived` the node test project cannot reach.

## Testing

- Unit test normalizers, filter builders, and search-result mappers in `src/lib/domain/` and `src/lib/server/` with Vitest — colocate as `*.spec.ts` next to the source file (see `src/lib/domain/archive.spec.ts`).
- Test behavior (given this input, this output/shape), not internal implementation details.
- Archivist intentionally has one node-based Vitest project and no separate component/browser test project. Markup contracts that matter (a form's `method`/`action`, hidden fields carrying URL state, `for`/`id` label association, `alt`, the live region) can still be asserted in the node project by server-rendering a component with `render()` from `svelte/server` — see `src/lib/components/markup.ssr.spec.ts`. Parse what you assert (`new URL(href).searchParams`, an attribute match) rather than matching raw HTML substrings, which pin Svelte's attribute order and parameter order rather than behavior. Genuinely interactive behavior (focus, announcement, reflow) stays manual; record what was checked in the task's worksheet or the commit message.

## Use the Svelte MCP Server

This project configures the official Svelte MCP server for both Claude Code (`.mcp.json`) and Codex (`.codex/config.toml`) — no extra setup is needed, it should already be available as MCP tools in your session.

- **Before writing an unfamiliar Svelte 5 / SvelteKit pattern** (a rune you haven't used in this codebase, a `load` function edge case, an adapter-specific API), use the server's documentation tool to pull the current official docs instead of relying on training data — Svelte 5's APIs changed enough from Svelte 4 that pretrained knowledge is a common source of subtly wrong code.
- **Before finalizing a non-trivial Svelte component or `.svelte.ts` change**, run the server's autofixer tool against the code. It catches the common classes of mistakes AI-generated Svelte code tends to make (stale Svelte 4 idioms, incorrect rune usage, reactivity mistakes) that type-checking and lint alone won't always flag.
- Prefer the MCP server's answer over guessing when the two disagree with what you remember about Svelte/SvelteKit APIs — it reflects the pinned version in `package.json`, not a generic latest.
- The server fetches `svelte.dev` at startup, so in a sandbox whose network policy blocks that host the documentation tool is unavailable. The autofixer still works through the package's CLI (`npx -y @sveltejs/mcp svelte-autofixer "<code>"`), which prints its findings before the docs fetch fails. When the docs tool is unreachable, read the pinned sources under `node_modules/@sveltejs/kit/` rather than relying on pretrained knowledge.
