# SPECs

Human-written feature and bug specs, architecture decision records, and agent worksheets, for non-trivial work.

- **Feature/bug specs** live directly in `SPECs/` as `<slug>.md`, written by a human (or by an agent with explicit human sign-off) before implementation starts on non-trivial work. Link the spec from its [`TODOS.md`](../TODOS.md) entry.
- **Architecture decision records (ADRs)** also live directly in `SPECs/` as `<slug>.md` (e.g. [`sveltekit-turbopuffer.md`](./sveltekit-turbopuffer.md)) — no numeric prefix, just a descriptive slug. Required for any Turbopuffer schema/namespace migration or other architecture-level decision, per [`AGENTS.md`](../AGENTS.md).
- **Agent worksheets** live in `SPECs/Agent/worksheet-<spec-slug>.md` — one per non-trivial task, created and maintained by the implementing agent per [`docs/workflows/agent-loop.md`](../docs/workflows/agent-loop.md). A worksheet is scratch pad plus handoff artifact: what was investigated, the plan, and a summary of the result. It is not a substitute for a human-written spec when one is warranted.

Keep both tight enough that another agent (or the human) can retrace the reasoning by reading the file alone.
