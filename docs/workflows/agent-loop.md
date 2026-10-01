# Agent Loop

Repeatable loop for autonomous task execution. The agent works through the task queue while the human is away, then the human reviews the work and queues new tasks and specs for the next session.

- [`AGENTS.md`](../../AGENTS.md) — mode routing and project guidelines (read by both Claude Code and Codex)
- [`TODOS.md`](../TODOS.md) — task backlog
- [`specs/`](../specs/) — active human-written feature/bug specs and worksheets
- [`decisions/`](../decisions/) — architecture decision records
- [`history/worksheets/`](../history/worksheets/) — completed task worksheets
- [`agent-review.md`](./agent-review.md) — review personas, findings format, escalation rules

## Agent Worksheet

For every non-trivial task, create an agent worksheet at `docs/specs/worksheet-<spec-slug>.md` to track progress and understanding. It is your scratch pad and handoff artifact; move it to `docs/history/worksheets/` when the task is complete.

A worksheet should include:

- Reference to the TODO entry and any linked spec
- Docs, code, and files reviewed (note anything investigated but found irrelevant)
- Your plan: what changes, where, and why
- A concise summary of implementation and results when done

Keep it tight. Another agent should be able to retrace your steps by reading the worksheet alone. Iterate as you go — don't write it all up front.

## Step 0: Prepare

1. Check the git workspace state. If the working tree is dirty with WIP, either finish it cleanly or stash it. Note this in your worksheet.
2. Run validation to confirm the project is healthy before starting:
   - `bun run check` — svelte-kit sync, wrangler types, and svelte-check (TypeScript)
   - `bun run lint` — prettier + eslint
   - `bun run test` — Vitest
3. Fix any failures before entering the loop.

## Step 1: Pick the next task

1. Open [`TODOS.md`](../TODOS.md). Pick the smallest uncompleted item from **Up Next**.
2. Move it to **In Progress**.
3. Create the agent worksheet in `docs/specs/` (hard prerequisite, even for small fixes).

## Step 2: Investigate

1. Read the linked spec (if any), relevant docs (`docs/architecture.md`, `docs/decisions/` for prior ADRs), and code. Understand the root cause or design space, not just the surface symptom.
2. For bugs: write a failing test that reproduces the issue when practical. If a test is genuinely impractical, document why in the worksheet.
3. For spec-driven features: identify the spec's non-negotiable constraints — the scope, architecture boundaries, and search invariants in [`AGENTS.md`](../../AGENTS.md) are non-negotiable unless the human explicitly changes them.
4. If a Svelte/SvelteKit pattern is unfamiliar, use the Svelte MCP server's documentation tool before writing it — see [Use the Svelte MCP Server](../svelte-guidelines.md#use-the-svelte-mcp-server).
5. If investigation reveals the task is too ambiguous or severely underspecified, move it back to **Up Next** (or a new **Needs Input** section) with a concise `[AGENT NOTE: ...]` explaining findings, blockers, and what decision is needed. Leave the worksheet so the human can review. Commit both and return to Step 1. This should be rare — make good autonomous decisions unless human input is truly required.

## Step 3: Plan

Produce a plan before writing implementation code. Skip formal planning only for trivial fixes (typos, one-line changes) where the path is obvious.

Cover:

- What we are trying to accomplish
- Summary of investigation findings
- What code changes are needed, where, and why (respect the `src/lib/domain/`, `src/lib/server/*/`, `src/routes/` boundaries in `AGENTS.md`)
- What docs need updating
- Test strategy (prefer the cheapest effective approach)
- Risks or edge cases to watch for

For non-trivial changes, pause and ask: "Is there a more elegant, maintainable way to solve this?" If the current path feels hacky, redesign using what you learned during investigation.

All of this goes into the agent worksheet.

## Step 4: Plan Review

Skip for trivial fixes. For everything else, spawn a separate sub-agent for each relevant review persona defined in [`agent-review.md`](./agent-review.md). Each reviewer must start with fresh context — do not self-review inside the agent that wrote the worksheet. Give each sub-agent: this loop doc, the review protocol, the TODO, spec, and worksheet. Do **not** pass your full investigation trail.

Take the feedback, determine what is valid, and update the worksheet. Iterate until reviewers give the plan a green light.

## Step 5: Implement

Re-read the spec and worksheet. Implement in small validated steps. Run targeted tests as you go.

- Follow the [Engineering Guardrails](../../AGENTS.md#engineering-guardrails)
- Follow [Svelte & SvelteKit Guidelines](../svelte-guidelines.md) for frontend and `load`-function work
- Use the Svelte MCP server's autofixer tool on non-trivial Svelte edits before moving to review
- Prefer adapting existing tests unless a new test is clearly warranted
- If you get stuck after reasonable investigation, move the task to **Needs Input** with an `[AGENT NOTE: ...]`, update the worksheet, commit both, and return to Step 1

If you encounter adjacent issues not part of the current task (code quality problems, missing docs, potential bugs), add them as new TODOs. Do not scope-creep the current task. The exception is fixing clearly wrong docs — do that immediately.

## Step 6: Implementation Review

Run an implementation review using the personas and process in [`agent-review.md`](./agent-review.md). As with plan review, each reviewer must have fresh context — spawn separate sub-agents, do not self-review.

- Address `P0`/`P1` findings before proceeding
- Capture `P2`/`P3` findings as follow-up TODOs if not immediately fixable
- Verify tests pass legitimately — no hardcoded expected values, no skipped assertions
- Challenge whether the final solution is the cleanest version now that you understand the problem fully. Be willing to redesign.
- Review blocks handoff if any `P0` or unresolved `P1` remains (see escalation rules in `agent-review.md`).

## Step 7: Document and Wrap Up

1. Update relevant docs if behavior or rules changed (including an ADR in `docs/decisions/` if a schema or architecture decision changed — see `AGENTS.md`).
2. Update [`CHANGELOG.md`](../CHANGELOG.md) if the work is user-visible.
3. Move the task from **In Progress** to **Done** in [`TODOS.md`](../TODOS.md), with a shortened commit hash.
4. Add follow-up TODOs if you found adjacent issues.
5. Commit with a clear message — one commit per completed task. See the existing commit history for style.

Example commit message:

```
Add hybrid search RRF query to SearchRepository

Summary:
- Added multiQuery BM25 + native-ANN request with rerank_by RRF
- Mapped Turbopuffer rows to SearchResult in one place
- Added unit tests for filter construction and result mapping

Risks:
- No end-to-end test against a live Turbopuffer namespace (unit-level only)
```

## Step 8: Repeat

Return to Step 1 and continue with the next task. Keep progress clear and avoid carrying unresolved ambiguity between tasks. Continue until **Up Next** is empty or every remaining item is in **Needs Input**.

## Step 9: Final Validation and Summary

Once the queue is exhausted:

1. Run the full validation suite:
   - `bun run check`
   - `bun run lint`
   - `bun run test`
   - `bun run build`
2. Fix any regressions before wrapping up.
3. Write a session summary:
   - Tasks completed (with commit hashes)
   - Tasks deferred to **Needs Input** and why
   - Risks, regressions, or areas needing human attention
   - Follow-up TODOs added during the session

This summary is how the human reviewer starts their day.

## Notes

- One commit per task. Do not batch unless explicitly asked.
- Be concise. Follow existing code patterns. This is a maturing codebase — use established patterns instead of inventing new ones.
- Keep the scope in `AGENTS.md` in mind: no auth, accounts, analytics, background queues, link crawling, query-time LLM, or chat UI without an explicit decision from the maintainer.
- For UI changes, test in the browser via `bun run dev` before reporting the task as complete.
- When in doubt about scope or intent, move to **Needs Input** rather than guessing — but this should be rare. The cost is a lost day.
