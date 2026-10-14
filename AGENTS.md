---
title: AGENTS
---

Archivist is a SvelteKit app on Cloudflare Workers: a Spotlight-like search and gallery for one maintainer's Are.na archive, with MiniSearch and browser vector search for hybrid retrieval.

## This File

This is an **agent router**: concise context loaded every session, read by both Claude Code and Codex. It routes the agent to relevant docs based on task intent and states the rules that don't change per task. Deep product/architecture detail lives in linked docs — not here.

## Architecture (Brief)

Stack: SvelteKit + TypeScript, `@sveltejs/adapter-cloudflare`, MiniSearch and static vector snapshots (search datastore), Are.na V3 (source of truth for content).

- `src/lib/domain/`: framework-free domain types and transformations. `titles.ts` decides which Are.na titles carry no information; write-back and captions both use it. `search.ts` (the URL grammar, `SearchResult`, `ArchiveSearchState`) ships to the browser, so it must stay free of Zod schemas, provider shapes, and any runtime validation library. `archive.ts` (`ArchiveBlock`, `SearchDocument`, `toSearchDocument`) is used by server modules and maintenance CLIs and does use Zod; never import it from a component or route markup. Provider validation and provider shapes live under `src/lib/server/`.
- `src/lib/server/arena/`: Are.na transport, payload schemas, and pagination only.
- `src/lib/server/indexing/`: normalization, channel filtering, the channel manifest, sync orchestration, the colour stage (`colour/`), the connections stage (`connections/`), the vision stage (`vision/`), and CLI progress reporting (`progress/`). It also holds the four committed files the sync writes: `channel-manifest.json`, `colour-cache.jsonl`, `connections-cache.jsonl` and `vision-cache.jsonl`.
- `src/lib/search/`: client-safe search validation, snapshot schemas, lexical/vector ranking, RRF, colour thresholds and the browser Web Worker/client. Keep provider normalization and credentials server-only.
- `src/lib/server/search/`: public snapshot export, release building, query embedding validation and evaluation schemas.
- `src/lib/server/maintenance/`: Node-only maintenance services: candidate validation, the R2 object store, the archive lease, hosted caches, hosted sync and deployment staging. Never import it from Worker routes.
- `src/lib/server/rate-limit.ts`: edge rate limiting, wired in through `src/hooks.server.ts`.
- `src/lib/components/`: client-safe presentation components. They never import `src/lib/server/**`, and they consume `SearchResult` / `ArchiveSearchState` rather than provider rows.
- `src/routes/`: HTTP and UI composition only. Provider calls and ranking expressions do not belong in route files.
- `src/styles/`: fonts, Tailwind theme tokens and the semantic colour roles.
- `src/trigger/`: Trigger.dev task entrypoints (hello-world, synthetic validation, the manual `archive-sync`, the scheduled `daily-archive-sync`, the `archive-enrich-batch` child and the manual, budget-capped `archive-vision-backfill`); `source-identity.ts` is overwritten by CI. Later maintenance workflows are planned in [docs/specs/trigger-workflows.md](./docs/specs/trigger-workflows.md).
- `scripts/`: the manual CLIs (`sync.ts`, `evaluate-search.ts`, `candidate-search.ts`, `hosted-maintenance.ts`, `calibrate-colour.ts`), the search evaluation fixture, and `worktree.sh`.

Full technical detail: [docs/architecture.md](./docs/architecture.md).

## Docs Index

All project documentation lives in `./docs/`. Keep active feature specs and worksheets in
`./docs/specs/`, completed worksheets in `./docs/history/worksheets/`, and architecture decisions
in `./docs/decisions/`.

**Product & architecture**

- [docs/architecture.md](./docs/architecture.md) — data access model, snapshot schema, retrieval behavior, sync lifecycle, vision indexing

**Workflow**

- [docs/workflows/agent-loop.md](./docs/workflows/agent-loop.md) — repeatable autonomous task execution loop
- [docs/workflows/agent-review.md](./docs/workflows/agent-review.md) — review personas, findings format, quality checklist, escalation rules
- [docs/workflows/worktrees.md](./docs/workflows/worktrees.md) — creating and managing parallel worktrees

**Guidelines**

- [docs/svelte-guidelines.md](./docs/svelte-guidelines.md) — Svelte 5 runes, component/data-loading conventions, and how to use the Svelte MCP server

**Cross-cutting**

- [docs/TODOS.md](./docs/TODOS.md) — task backlog and work-in-progress tracking
- [docs/CHANGELOG.md](./docs/CHANGELOG.md) — user-visible changes log
- [docs/specs/](./docs/specs/) — active feature and bug specs, and in-progress worksheets
- [docs/history/worksheets/](./docs/history/worksheets/) — completed task worksheets
- [docs/decisions/](./docs/decisions/) — architecture decision records

## Hard Rules

- Check [`docs/TODOS.md`](./docs/TODOS.md) before starting work to see current tasks.
- Move tasks between sections (Up Next → In Progress → Done) as you work.
- For non-trivial work, create a spec in [`docs/specs/`](./docs/specs/) and link it from the task.
  Move its worksheet to `docs/history/worksheets/` when the task is complete.
- Update [`docs/CHANGELOG.md`](./docs/CHANGELOG.md) when completing user-visible work.
- Load only docs relevant to the current task and scope.
- If a behavior or rule changes in practice, update the owning doc in the same task.
- Never run a plain `bun run sync`: it calls OpenRouter and writes titles/descriptions to Are.na. Use both `--no-vision --no-push-arena` unless those stages are explicitly needed. Sync always rebuilds public search assets with Workers AI embeddings. `bun run export:search` uses existing caches without vision generation or Are.na write-back. Run only after code/tests and report the command in the handoff.
- In autonomous/loop mode, complete exactly one task at a time and commit immediately. Do not batch unless the user explicitly asks.
- When coding or reviewing, follow the Engineering Guardrails and Product/Search rules below and the guidelines in linked docs.

## Scope

Archivist is a public gallery and search surface for one maintainer's Are.na archive. The points below describe current behavior. The accepted maintenance scope and proposed implementation are in [Trigger.dev workflows](./docs/specs/trigger-workflows.md); phases 1–2 (candidate validation, hosted storage and manual sync) are implemented. Phase 3 (a daily 06:00 UTC hosted sync with automatic regression-gated deployment) is live in production, phase 4 (per-block outcomes, retries and batched children) is implemented, phase 5 (coverage reports and budget-capped vision backfills) is implemented, and phase 6 (read-only search experiments) is implemented. An experiment suggestion never changes production ranking on its own. Never start a paid backfill without the maintainer's explicit approval of its block cap and budget. Anything beyond them needs the maintainer's explicit go-ahead.

- Results are original Are.na blocks. Nothing generated is ever presented as a result.
- Query time is free of generative LLMs. Browser search uses Workers AI only to embed queries; the sync-time vision stage, which describes blocks that are already synced and indexes that text (description, OCR, tags) for retrieval. Read [Vision indexing](./docs/architecture.md#vision-indexing) before touching `src/lib/server/indexing/vision/`; generated tags are indexed but not exposed in the UI.
- The production `daily-archive-sync` is the maintainer-approved hosted equivalent of a plain sync. It generates vision within a daily cap and writes back to Are.na. Do not change its caps or write-back without the maintainer. A plain local `bun run sync` is maintainer-only; agents may run the flagged variants described under Hard Rules. Public requests download versioned public assets and call a bounded embedding endpoint. Public requests must never proxy to Are.na.

## Search Invariants

- Use the canonical `search_text` composition in `docs/architecture.md` for lexical indexing and embeddings; browser embeddings use bounded complete-text chunks.
- `src/lib/domain/search.ts` owns the URL search grammar (parameter names, the implicit-mode rule, the date format). The server parser and the UI both consume it; do not restate a parameter name anywhere else.
- Filter the complete eligible corpus before lexical/vector ranking, aggregate chunk scores to one block, and fuse complete ranked lists with RRF (`k=60`) in `src/lib/search/`, with stable ID ties and release pinning. No raw score arithmetic belongs in UI components.
- Hybrid uses ranked-list RRF in the search Worker; ranking never belongs in UI markup.
- Filters cover kind, channel membership, connected/created dates and colour weights. Query results always rank by relevance; browse sorts use stable ID tiebreaks.
- Incompatible snapshot or embedding changes require a new release/version.

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
- Use accessible native controls, URL-backed browse/search state, server-only provider access, and responsive image dimensions.
- Write every Tailwind class in its canonical form: `@container-size`, not `[container-type:size]`; `max-h-lh`, not `max-h-[1lh]`. This is Tailwind IntelliSense's `suggestCanonicalClasses` rule, and `bun run lint` enforces it through `bun run check:classes`, which prints the canonical spelling for each offender. Never silence it with a raw arbitrary property when a utility exists.
- Keep secrets server-only; do not log tokens, full raw API payloads, or user search queries.
- When changing `docs/CHANGELOG.md` or `docs/TODOS.md`, keep one consistent format by matching the existing entries: the changelog sits under `## Unreleased` in `Added` / `Changed` / `Removed` / `Fixed` groups, newest first, one past-tense line per change; TODOs keep their fixed sections, with items written as `- [ ] **Title.** One sentence.`
- Prefer the existing official SDKs. Add a dependency only when it removes meaningful production code; document why in an ADR if it changes the architecture.

## Tooling — Svelte MCP Server

This repo configures the official Svelte MCP server for **both** Claude Code (`.mcp.json`) and Codex (`.codex/config.toml`) — it should already be available as MCP tools in your session, no setup required.

- Use its documentation-lookup tool before writing an unfamiliar Svelte 5 / SvelteKit pattern instead of relying on pretrained knowledge (Svelte 5's API surface changed enough from Svelte 4 that stale patterns are a common source of subtly wrong code).
- Run its autofixer tool against non-trivial Svelte/`.svelte.ts` changes before finalizing them.
- Full guidance: [docs/svelte-guidelines.md](./docs/svelte-guidelines.md#use-the-svelte-mcp-server).

## Validation

Run after a meaningful change and fix failures before handoff:

```sh
bun run check   # wrangler types, svelte-kit sync, svelte-check, tsc on scripts/
bun run lint    # prettier --check, eslint, canonical Tailwind classes
bun run test    # vitest
bun run build   # wrangler types, vite build
```

`worker-configuration.d.ts` is generated, not committed. `check` and `build` regenerate it through `bun run gen` before type-checking. Wrangler's output depends on machine state twice over: it infers `Env`'s plain-var shape from whichever env file it reads, and it emits a `Cloudflare.GlobalProps` block only when the built Worker entry (`.svelte-kit/cloudflare/_worker.js`) already exists. A committed copy plus `wrangler types --check` therefore cannot hold: the file a contributor generates after building never matches the one CI generates before building.

`wrangler types` stays pinned to `--env-file=.env.example`, not your local `.env`, so `Env` is identical everywhere regardless of which keys you happen to have. Don't drop the flag when touching these scripts.

`bun run check` type-checks `scripts/` (the manual CLI entrypoints, e.g. `bun run sync`) as a second, separate `tsc --noEmit --project scripts/tsconfig.json` step after `svelte-check`. `scripts/` is intentionally outside `svelte-check`'s scope and needs Node globals (`process`) that the root `tsconfig.json` deliberately excludes from `types` — leaking Node globals into `src/`, which is Cloudflare Workers code, would be a real correctness hazard, not just noise. Keep new CLI scripts under `scripts/` so this coverage applies to them automatically.

## Pull Request Hygiene

- Keep each pull request to one vertical slice.
- State the changed behavior, test evidence, and any environment/configuration change.
- Never commit `.env`, local snapshots containing private blocks, or a private archive export.

## Session Wrap

Wrap per [agent-loop.md](./docs/workflows/agent-loop.md). One commit per completed task with a clear message. See the existing commit history for style.
