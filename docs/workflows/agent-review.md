# Review Protocol

Review feature or bugfix work before handoff, and any significant refactor, schema change or search-behavior change. Skip it for trivial fixes (typos, one-line changes) and say so in the commit message.

Run the review in a fresh context, such as a separate sub-agent, not in the one that wrote the change: a reviewer that shares the author's assumptions will echo them. Give it the intended change, the diff, `git log --oneline -20` and the docs below that match the changed area.

## Focus by area

- `.svelte`, `src/routes/`, `src/styles/`: Svelte 5 rune correctness, `load` boundaries, accessibility, URL-backed state ([docs/svelte-guidelines.md](../svelte-guidelines.md)).
- `src/lib/search/`, `src/lib/server/search/`, `src/lib/server/release/`: snapshot integrity, filter-before-rank, chunk aggregation, complete-list RRF, stable ties, release and embedding versioning (Search Invariants in [AGENTS.md](../../AGENTS.md)).
- `src/lib/server/arena/`, `src/lib/server/indexing/`: pagination and backoff, normalization and dedup, sync idempotency.
- Cross-directory changes: ownership boundaries and scope drift (Boundaries and Scope in [AGENTS.md](../../AGENTS.md)).
- Anything with regression risk: do the tests exercise behavior, with no hardcoded expectations or skipped assertions?

## Checklist

- [Scope](../../AGENTS.md#scope) respected: no auth, accounts, analytics, link crawling, query-time LLM, agent behavior or chat UI without an explicit maintainer decision.
- Provider shapes never leak past their adapter; secrets stay server-only; untrusted input is validated with Zod at the boundary.
- Incompatible snapshot or embedding changes carry a new release version and an ADR.
- Maintenance retries preserve completed enrichment, incomplete discovery cannot prune caches or publish, and publication is tied to the evaluated candidate.
- Docs and [CHANGELOG.md](../CHANGELOG.md) updated with the behavior change; `bun run check`, `lint` and `test` pass; no dead code left in changed files.

## Findings

Order by severity: `P0` critical, `P1` high, `P2` medium, `P3` low. For each, give the file and line, the impact, the root cause and a fix direction. With no findings, say so and list residual risks and test gaps. Block handoff on an unresolved `P0` or `P1`, an untested regression risk in a high-impact path, or a boundary or scope breach without maintainer sign-off.
