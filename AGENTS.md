---
title: AGENTS
---

Archivist is a SvelteKit app on Cloudflare Workers: a Spotlight-like search and gallery for one maintainer's Are.na archive, backed by Turbopuffer for hybrid (lexical + semantic) retrieval.

## This File

This is an **agent router**: concise context loaded every session, read by both Claude Code and Codex. It routes the agent to relevant docs based on task intent and states the rules that don't change per task. Deep product/architecture detail lives in linked docs — not here.

## Architecture (Brief)

Stack: SvelteKit + TypeScript, `@sveltejs/adapter-cloudflare`, Turbopuffer (search datastore), Are.na V3 (source of truth for content).

- `src/lib/domain/`: framework-free domain types and transformations.
- `src/lib/server/arena/`: Are.na transport and pagination only.
- `src/lib/server/indexing/`: normalization, document construction, and sync orchestration.
- `src/lib/server/search/`: search request validation, Turbopuffer adapter, and result mapping.
- `src/lib/components/`: client-safe presentation components. They never import `src/lib/server/**`, and they consume `SearchResult` / `ArchiveSearchState` rather than provider rows.
- `src/routes/`: HTTP and UI composition only. Provider calls and ranking expressions do not belong in route files.

Full technical detail: [docs/architecture.md](./docs/architecture.md).

## Docs Index

All docs except this file, `CLAUDE.md`, `TODOS.md`, and `CHANGELOG.md` live in `./docs/`. Feature specs and agent worksheets live in `./SPECs/`.

**Product**

- [docs/prd.md](./docs/prd.md) — product requirements, audience, V1 job to be done
- [docs/architecture.md](./docs/architecture.md) — data access model, Turbopuffer schema, retrieval behavior, sync lifecycle
- [docs/design.md](./docs/design.md) — visual and interaction contract

**Workflow**

- [docs/workflows/agent-loop.md](./docs/workflows/agent-loop.md) — repeatable autonomous task execution loop
- [docs/workflows/agent-review.md](./docs/workflows/agent-review.md) — review personas, findings format, quality checklist, escalation rules
- [docs/workflows/worktrees.md](./docs/workflows/worktrees.md) — creating and managing parallel worktrees

**Guidelines**

- [docs/svelte-guidelines.md](./docs/svelte-guidelines.md) — Svelte 5 runes, component/data-loading conventions, and how to use the Svelte MCP server

**Cross-cutting**

- [TODOS.md](./TODOS.md) — task backlog and work-in-progress tracking
- [CHANGELOG.md](./CHANGELOG.md) — user-visible changes log
- [SPECs/](./SPECs/) — human-written feature and bug specs, architecture decision records, and agent worksheets

## Hard Rules

- Check [`TODOS.md`](./TODOS.md) before starting work to see current tasks.
- Move tasks between sections (Up Next → In Progress → Done) as you work.
- For non-trivial work, create a spec in [`SPECs/`](./SPECs/) and link it from the task.
- Update [`CHANGELOG.md`](./CHANGELOG.md) when completing user-visible work.
- Load only docs relevant to the current task and scope.
- If a behavior or rule changes in practice, update the owning doc in the same task.
- In autonomous/loop mode, complete exactly one task at a time and commit immediately. Do not batch unless the user explicitly asks.
- When coding or reviewing, follow the Engineering Guardrails and Product/Search rules below and the guidelines in linked docs.

## Product Boundary

- V1 is an open-source public gallery and search surface for one maintainer's Are.na archive.
- Results are original Are.na blocks. Do not introduce generated collections, summaries, tags, OCR, link crawling, auth, accounts, analytics, background queues, or a chat UI in V1.
- Sync is manual and maintainer-only. Public requests query Turbopuffer only; they must never proxy to Are.na.
- V2 may use Mastra for an evidence-first research mode. Keep V1 retrieval framework-agnostic so it can become a Mastra tool later. Do not start V2 work until the human explicitly starts that milestone.

## Search Invariants

- Use the `search_text` schema in `docs/architecture.md` for both BM25 and native embeddings.
- `src/lib/domain/search.ts` owns the URL search grammar (parameter names, the implicit-mode rule, the date format). The server parser and the UI both consume it; do not restate a parameter name anywhere else.
- Hybrid means one Turbopuffer `multiQuery` with BM25 + native ANN and `rerank_by: ['RRF']`; do not implement ad-hoc score arithmetic in the UI.
- Filter only `block_type`, `channel_slugs`, and `connected_at` in V1.
- Schema changes that alter an existing Turbopuffer attribute's type require a new versioned namespace. Record that migration as an ADR in `SPECs/`.

## Engineering Guardrails

- Prefer the smallest change that is correct, robust, and easy to reason about.
- Avoid fragile logic, hidden coupling, edge-case traps, and assumptions about incidental execution order.
- Keep async flows and shared state race-safe. Use explicit sequencing, cancellation, idempotency, or clear ownership where needed.
- Do not introduce unnecessary performance regressions. Avoid extra renders, allocations, subscriptions, scans, blocking work, or I/O unless clearly justified.
- Fail explicitly. Surface invalid states and unexpected errors clearly instead of silently swallowing them or masking them with fallback behavior.
- Preserve testability. Keep side effects at the boundaries, make dependencies explicit, and structure logic so it can be exercised in isolation when practical.
- Maintain clear boundaries, but prefer minimal designs. Split modules when responsibilities meaningfully diverge, not as a reflex.
- If a tradeoff is unavoidable, call it out explicitly and choose the option with the lowest long-term correctness and maintenance risk.
- When a fix doesn't work after one iteration, add a debug log before changing the approach again. Don't iterate on guesses — let the runtime tell you which term is wrong.
- TypeScript strictness is non-negotiable. Validate untrusted API/config input at the boundary with Zod.
- Keep code comments exceptionally rare. Add one only when it records non-obvious reasoning, an external constraint, or a deliberate tradeoff that cannot be made clear through names and structure; never narrate what the code already says.
- Add a focused unit test for every normalizer, filter builder, and search-result mapper. Test behavior, not private implementation details.
- Use accessible native controls, URL-backed browse/search state, server-side data access, and responsive image dimensions.
- Keep secrets server-only; do not log tokens, full raw API payloads, or user search queries.
- Prefer the existing official SDKs. Add a dependency only when it removes meaningful production code; document why in an ADR if it changes the architecture.

## Tooling — Svelte MCP Server

This repo configures the official Svelte MCP server for **both** Claude Code (`.mcp.json`) and Codex (`.codex/config.toml`) — it should already be available as MCP tools in your session, no setup required.

- Use its documentation-lookup tool before writing an unfamiliar Svelte 5 / SvelteKit pattern instead of relying on pretrained knowledge (Svelte 5's API surface changed enough from Svelte 4 that stale patterns are a common source of subtly wrong code).
- Run its autofixer tool against non-trivial Svelte/`.svelte.ts` changes before finalizing them.
- Full guidance: [docs/svelte-guidelines.md](./docs/svelte-guidelines.md#use-the-svelte-mcp-server).

## Validation

Run after a meaningful change and fix failures before handoff:

```sh
bun run check   # wrangler types, svelte-kit sync, svelte-check (TypeScript)
bun run lint    # prettier --check, eslint
bun run test    # vitest
bun run build   # wrangler types, vite build
```

`worker-configuration.d.ts` is generated, not committed. `check` and `build` regenerate it through `bun run gen` before type-checking. Wrangler's output depends on machine state twice over: it infers `Env`'s plain-var shape from whichever env file it reads, and it emits a `Cloudflare.GlobalProps` block only when the built Worker entry (`.svelte-kit/cloudflare/_worker.js`) already exists. A committed copy plus `wrangler types --check` therefore cannot hold: the file a contributor generates after building never matches the one CI generates before building.

`wrangler types` stays pinned to `--env-file=.env.example`, not your local `.env`, so `Env` is identical everywhere regardless of which keys you happen to have. Don't drop the flag when touching these scripts.

`bun run check` type-checks `scripts/` (the manual CLI entrypoints, e.g. `bun run sync`) as a second, separate `tsc --noEmit --project scripts/tsconfig.json` step after `svelte-check`. `scripts/` isn't in `svelte-check`'s scope (its generated tsconfig only covers `src/`/`test/`/`tests/`) and needs Node globals (`process`) that the root `tsconfig.json` deliberately excludes from `types` — leaking Node globals into `src/`, which is Cloudflare Workers code, would be a real correctness hazard, not just noise. Keep new CLI scripts under `scripts/` so this coverage applies to them automatically.

## Pull Request Hygiene

- Keep the first V1 pull request to one vertical slice.
- State the changed behavior, test evidence, and any environment/configuration change.
- Never commit `.env`, local snapshots containing private blocks, or a populated Turbopuffer export.

## Session Wrap

Wrap per [agent-loop.md](./docs/workflows/agent-loop.md). One commit per completed task with a clear message. See the existing commit history for style.
