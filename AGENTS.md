---
title: AGENTS
---

Archivist is a SvelteKit app on Cloudflare Workers: a public gallery and hybrid search for one maintainer's Are.na archive. MiniSearch and exact vector search run in a browser Web Worker over static, versioned search releases; Workers AI embeds queries.

## This File

This is an **agent router**, read every session by both Claude Code and Codex. It states the rules that hold for every task and routes to the docs that hold the detail. Read [docs/architecture.md](./docs/architecture.md) for how the system works and where each module lives before starting a feature.

## Docs Index

- [README.md](./README.md) — what the project is, setup and commands
- [docs/architecture.md](./docs/architecture.md) — repository layout, query path, releases, sync and enrichment, hosted maintenance, build and CI
- [docs/svelte-guidelines.md](./docs/svelte-guidelines.md) — Svelte 5 runes, component and data-loading conventions, the Svelte MCP server
- [docs/decisions/](./docs/decisions/) — architecture decision records
- [docs/workflows/agent-review.md](./docs/workflows/agent-review.md) — review focus areas, checklist and findings format
- [docs/workflows/worktrees.md](./docs/workflows/worktrees.md) — parallel worktrees with `scripts/worktree.sh`
- [docs/CHANGELOG.md](./docs/CHANGELOG.md) — user-visible changes

## Boundaries

- `src/lib/domain/search.ts` ships to the browser: keep it free of Zod, provider shapes and any runtime validation library. `src/lib/domain/archive.ts` uses Zod and is server-only; never import it from a component or route markup.
- Provider validation and shapes (Are.na, OpenRouter, Workers AI) live under `src/lib/server/` and never leak past their adapter module.
- `src/lib/components/` never imports `src/lib/server/**`, not even a type; components consume `SearchResult` and `ArchiveSearchState`.
- `src/routes/` is composition only: no provider calls or ranking logic.
- `src/lib/server/maintenance/` is Node-only; never import it from Worker routes.
- Keep CLI entrypoints under `scripts/`, which is type-checked separately with Node globals. Never leak Node globals into `src/`, which is Workers code.

## Hard Rules

- Load only the docs relevant to the task. If a behavior or rule changes, update the owning doc in the same change.
- Update [docs/CHANGELOG.md](./docs/CHANGELOG.md) for user-visible work.
- A plain `bun run sync` is read-only toward Are.na: it measures colour and connections and rebuilds the public search assets with Workers AI embeddings. Never add `--vision` (calls OpenRouter and spends credit) or `--push-arena` (writes titles and descriptions to Are.na) unless those stages are explicitly needed. `bun run sync --export` uses the local caches without vision generation, colour or connection measurement, or Are.na write-back. Run either only after code and tests pass, and report the command in the handoff.
- Never start a paid vision backfill without the maintainer's explicit approval of its block cap and budget.
- Do not install Mastra or add agent behavior unless the maintainer explicitly asks for it.

## Scope

- Results are original Are.na blocks. Nothing generated is ever presented as a result.
- Query time is free of generative LLMs. Browser search uses Workers AI only to embed queries. The sync-time vision stage describes blocks that are already synced and indexes that text (description, OCR, tags) for retrieval; generated tags are indexed but not shown. Read [Vision indexing](./docs/architecture.md#vision-indexing) before touching `src/lib/server/indexing/vision/`.
- Public requests download versioned public assets and call a bounded embedding endpoint. They never proxy to Are.na.
- The production `daily-archive-sync` is the maintainer-approved hosted equivalent of `bun run sync --vision --push-arena`: it generates vision within a daily cap and writes back to Are.na. Do not change its caps or write-back without the maintainer.
- Auth, accounts, analytics, link crawling, query-time LLMs and chat UI need an explicit maintainer decision.

## Search Invariants

- Use the canonical `search_text` composition in [docs/architecture.md](./docs/architecture.md#retrieval) for lexical indexing and embeddings; embeddings use bounded complete-text chunks.
- `src/lib/domain/search.ts` owns the URL search grammar (parameter names, the implicit-mode rule, the date format). The request parser and the UI both consume it; do not restate a parameter name anywhere else.
- Filter the complete eligible corpus before lexical or vector ranking, aggregate chunk scores to one block, and fuse complete ranked lists with RRF (`k=60`) in `src/lib/search/`, with stable ID ties and release pinning. No ranking or raw score arithmetic belongs in UI code.
- Filters cover kind, channel membership, connected and created dates, and colour weights. Query results always rank by relevance; browse sorts use stable ID tiebreaks.
- Incompatible snapshot or embedding changes require a new release version.
- A failing evaluation fixture case is a failure: never weaken a case to let a release through.

## Engineering Guardrails

- Prefer the smallest change that is correct and easy to reason about. Fail explicitly: surface invalid states instead of masking them with fallbacks.
- Keep async flows and shared state race-safe: explicit sequencing, cancellation, idempotency or clear ownership.
- When a fix doesn't work after one iteration, add a debug log before changing the approach again.
- TypeScript strictness is non-negotiable. Validate untrusted API, config, payload and stored input at the boundary with Zod.
- Keep code comments exceptionally rare: only non-obvious reasoning, an external constraint or a deliberate tradeoff.
- Add a focused unit test for every normalizer, filter builder and search-result mapper. Test behavior, not private implementation.
- Use accessible native controls, URL-backed browse and search state, server-only provider access and responsive image dimensions.
- Write every Tailwind class in its canonical form: `@container-size`, not `[container-type:size]`; `max-h-lh`, not `max-h-[1lh]`. `bun run lint` enforces this (`scripts/check-classes.ts`) and prints the canonical spelling for each offender.
- Keep secrets server-only; never log tokens, full raw API payloads or user search queries.
- Prefer the existing official SDKs. Add a dependency only when it removes meaningful production code; record why in an ADR if it changes the architecture.
- Keep the changelog under `## Unreleased` in `Added` / `Changed` / `Removed` / `Fixed` groups, newest first, one past-tense line per change.

## Tooling — Svelte MCP Server

This repo configures the official Svelte MCP server for both Claude Code (`.mcp.json`) and Codex (`.codex/config.toml`).

- Use its documentation tool before writing an unfamiliar Svelte 5 or SvelteKit pattern instead of relying on pretrained knowledge.
- Run its autofixer against non-trivial Svelte or `.svelte.ts` changes before finalizing them.
- Full guidance: [docs/svelte-guidelines.md](./docs/svelte-guidelines.md#use-the-svelte-mcp-server).

## Validation

Run after a meaningful change and fix failures before handoff:

```sh
bun run check   # wrangler types, svelte-kit sync, svelte-check, tsc on scripts/
bun run lint    # prettier, eslint, canonical Tailwind classes
bun run test    # vitest
bun run build   # vite build; needs a release in static/search (bun run sync --export)
```

`worker-configuration.d.ts` is generated, not committed: Wrangler's output depends on which env file it reads and on whether a built Worker entry already exists, so a committed copy could never match. `wrangler types` stays pinned to `--env-file=.env.example` so `Env` is identical everywhere; don't drop the flag.

## Commits and Pull Requests

- One coherent change per commit, with a clear message; see the commit history for style.
- Keep each pull request to one vertical slice, and state the changed behavior, test evidence, and any environment or configuration change.
- Never commit `.env`, the `data/*.jsonl` enrichment caches, local snapshots containing private blocks, or a private archive export.
