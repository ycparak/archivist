# Agent Review Protocol

## When To Run Review

Run review when:

- User or agent explicitly asks for review.
- Finishing feature or bugfix work before handoff.
- Significant refactor, schema change, or search-behavior change lands.

**Skip formal review** for trivial fixes (typos, one-line changes, obvious single-file corrections) where the risk of regression is negligible. Note the skip reason in the commit message.

## Context Isolation

Each review persona **must run in a separate sub-agent with fresh context**. Do not run review inside the agent that performed investigation or wrote the implementation.

Why this matters: the implementing agent has already rationalized its design decisions and internalized its assumptions. A reviewer sharing that context will echo those assumptions instead of challenging them. The whole point of peer review is an unpolluted perspective — different vantage points catch blind spots, spec drift, and unconsidered alternatives that the author cannot see.

Concretely:

- Spawn one sub-agent per activated persona.
- Give each sub-agent: this file (agent-review.md), the TODO, human spec (if any), agent worksheet, and the diff.
- The sub-agent should load its own persona's owned docs (listed below), plus `git log --oneline -20` and the `git diff` for the target change set.
- Do **not** pass the implementing agent's full investigation trail, chat history, or reasoning.

## Review Personas

Activate only the personas relevant to the changed surface area. Each persona owns specific docs and should load them as context for every review. Reviewers should also flag improvements to their own docs (clarity, conciseness, correctness, missing info) as part of their findings.

- **SvelteKit/Frontend Expert**: Svelte 5 rune correctness, component structure, `load`-function boundaries, accessibility, URL-backed state, reactivity mistakes.
  Owned docs: `docs/svelte-guidelines.md`.

- **Search & Retrieval Expert**: Turbopuffer schema and query correctness, hybrid `multiQuery`/RRF usage, filter construction, namespace-versioning discipline for attribute-type changes.
  Owned docs: `docs/architecture.md` (Turbopuffer namespace, Retrieval behavior), the Search Invariants section of `AGENTS.md`.

- **Data/Sync Expert**: Are.na V3 transport and pagination correctness, rate-limit/backoff handling, normalization and deduplication in `src/lib/server/indexing/`, sync idempotency.
  Owned docs: `docs/architecture.md` (Sync lifecycle, Why this data-access model, Vision indexing).

- **Systems Architect**: ownership boundaries between `src/lib/domain/`, `src/lib/server/*/`, and `src/routes/`; wrong-layer placement (provider calls or ranking logic leaking into routes); scope drift.
  Owned docs: `AGENTS.md` (Architecture (Brief), Scope, Search Invariants).

- **QA Engineer**: coverage quality, regression risk, test adequacy and test selection. Validates that tests are legitimate (no hardcoded expected values, no skipped assertions) and exercise behavior, not implementation details.
  Owned docs: `*.spec.ts` files colocated under `src/`, `scripts/fixtures/`.

Each persona should also load any spec or doc directly relevant to the files being changed, even if not listed above.

**Persona activation guidance:**

- Touching `.svelte` files, `src/routes/`, or `src/styles/` → include SvelteKit/Frontend.
- Touching `src/lib/server/search/` or the Turbopuffer schema → include Search & Retrieval.
- Touching `src/lib/server/arena/` or `src/lib/server/indexing/` → include Data/Sync.
- Touching cross-directory boundaries or adding a new top-level concept → include Systems Architect.
- Any change with regression risk → include QA.

## Findings Format

Review output is findings-first and ordered by severity.

For each finding include:

- Severity (`P0` critical, `P1` high, `P2` medium, `P3` low)
- File and line reference
- Impact/risk
- Root cause (not just symptom)
- Recommended fix direction

If there are no findings, explicitly say so and list residual risks/testing gaps.

## Quality Checklist

- Scope in `AGENTS.md` respected: no auth, accounts, analytics, background queues, link crawling, query-time LLM, agent behavior, or chat UI introduced without an explicit decision from the maintainer.
- Correct ownership: `src/lib/domain/` stays framework-free, `src/lib/server/` stays server-only and provider-shape-private, `src/routes/` stays composition-only.
- Provider API shapes (Are.na, Turbopuffer) never leak past their adapter module — UI and route code consume `SearchResult`, never raw rows/payloads.
- Turbopuffer attribute-type changes are versioned into a new namespace with an ADR in `docs/decisions/`, never an in-place type change.
- Hybrid ranking uses Turbopuffer's `multiQuery` + `rerank_by: ['RRF']`; no ad-hoc score arithmetic in application code.
- Untrusted input (query params, Are.na responses) validated with Zod at the boundary.
- Secrets stay server-only; no tokens, full raw API payloads, or user search queries in logs.
- Relevant docs updated when behavior or rules changed.
- Reviewers should recommend updates to their own persona's docs whenever they notice gaps, stale info, unclear language, or missing coverage.
- Commit cadence verified: in loop mode, one commit per completed task (unless user explicitly requested batching).
- For user-visible work, [`CHANGELOG.md`](../CHANGELOG.md) updated in the same task/commit.
- `bun run check` and `bun run lint` pass.
- `bun run test` passes; tests are appropriate for risk and scope, gaps are called out.
- No unused variables or dead-code declarations remain in changed files.
- Svelte MCP autofixer run on non-trivial Svelte edits (see `docs/svelte-guidelines.md`).

## Output Template

1. **Findings** (ordered high to low severity)
2. **Open Questions / Assumptions**
3. **Residual Risk / Testing Gaps**
4. **Overall Assessment** (one short verdict)

Keep summaries brief. The primary deliverable is actionable findings.

## Escalation Rules

Block handoff when:

- A `P0` or unresolved `P1` finding remains.
- A likely regression risk is untested in a high-impact path (search ranking, sync idempotency, provider-shape leakage).
- Ownership or architecture boundaries regress materially, or the scope in `AGENTS.md` is crossed without explicit human sign-off.

Warn (non-blocking) when:

- Only `P2/P3` issues remain with clear follow-up path.
- Risks are minor and explicitly documented.
