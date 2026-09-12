# Svelte & SvelteKit Guidelines

## Runes — State, Don't Stores

Archivist is Svelte 5. Use runes as the default state primitive.

- **`$state` for local reactive state**, `$derived` for anything computable from other state, `$effect` only for genuine side effects (DOM measurement, subscriptions, imperative third-party APIs). If a value can be `$derived`, it is a bug to store it in `$state` and keep it in sync by hand.
- **Shared reactive state that outlives one component** lives in a `.svelte.ts` module exporting a small object or class built from runes. Do not reach for a store (`writable`/`readable`) unless you specifically need its subscribe-based interop (e.g. a library that only accepts a `Readable`).
- **No `useEffect`-style watchers for things that are really actions.** If a user action (submit a search, select a filter) causes a state change and a side effect, perform the side effect in the action/handler, not in an `$effect` that reacts to the resulting state change. Reserve `$effect` for effects with no natural call site — window resize listeners, `IntersectionObserver`, syncing to `localStorage`.
- **Props via `$props()`**, destructured with defaults at the top of the component. Avoid `export let` (Svelte 4 syntax) in new code.

## Project Boundaries

These mirror the architecture boundaries in [`AGENTS.md`](../AGENTS.md) — this doc is about *how* to write the Svelte/TypeScript inside them, not where things live.

- `src/lib/domain/`: plain TypeScript, no Svelte imports, no SvelteKit imports. If a domain file needs `$state`, it belongs somewhere else.
- `src/lib/server/`: server-only. Never import a `src/lib/server/**` module from a `.svelte` file or any code that ships to the client — SvelteKit's server-only enforcement will fail the build, and that failure is correct, not a false positive to work around.
- `src/routes/`: composition only. A `+page.svelte` renders `SearchResult`-shaped data from its `load` function; it does not call Turbopuffer, Are.na, or construct ranking expressions itself. A `+page.server.ts` / `+server.ts` calls into `src/lib/server/search/` or `src/lib/server/indexing/` rather than reimplementing adapter logic inline.

## Data Loading

- Fetch and validate in `+page.server.ts` / `+server.ts` `load`/handler functions. Validate untrusted input (query params, request bodies) with Zod at that boundary, per the Quality bar in `AGENTS.md`.
- Keep URL search params as the source of truth for browse/search/filter state (`?q=&mode=&channel=&type=&from=&to=`) so state survives reload and is linkable. Don't shadow that state in a separate client store that can drift from the URL.
- Return only the fields the UI needs (`SearchResult`, not raw Turbopuffer rows or raw Are.na payloads) from `load` functions.

## Components

- Favor small, single-purpose components over one large page component with conditional branches. A result card, a filter control, and an empty/error state are separate components even if each is short.
- Accessible native controls first (`<button>`, `<select>`, `<a>`) — reach for ARIA roles only when no native element fits.
- Keep markup, styles (see `src/styles/`), and logic in the same `.svelte` file unless a piece of logic is reused elsewhere, in which case extract it to `src/lib/domain/` (pure) or a `.svelte.ts` module (reactive).

## Testing

- Unit test normalizers, filter builders, and search-result mappers in `src/lib/domain/` and `src/lib/server/` with Vitest — colocate as `*.spec.ts` next to the source file (see `src/lib/domain/archive.spec.ts`).
- Test behavior (given this input, this output/shape), not internal implementation details.

## Use the Svelte MCP Server

This project configures the official Svelte MCP server for both Claude Code (`.mcp.json`) and Codex (`.codex/config.toml`) — no extra setup is needed, it should already be available as MCP tools in your session.

- **Before writing an unfamiliar Svelte 5 / SvelteKit pattern** (a rune you haven't used in this codebase, a `load` function edge case, an adapter-specific API), use the server's documentation tool to pull the current official docs instead of relying on training data — Svelte 5's APIs changed enough from Svelte 4 that pretrained knowledge is a common source of subtly wrong code.
- **Before finalizing a non-trivial Svelte component or `.svelte.ts` change**, run the server's autofixer tool against the code. It catches the common classes of mistakes AI-generated Svelte code tends to make (stale Svelte 4 idioms, incorrect rune usage, reactivity mistakes) that type-checking and lint alone won't always flag.
- Prefer the MCP server's answer over guessing when the two disagree with what you remember about Svelte/SvelteKit APIs — it reflects the pinned version in `package.json`, not a generic latest.
