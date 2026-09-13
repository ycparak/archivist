# Claude Code instructions

Read and follow [AGENTS.md](AGENTS.md) before making changes. It is intentionally shared with Codex so implementation rules do not drift — treat it, not this file, as the source of truth for project rules, docs index, and validation commands.

Before starting a feature, read the relevant section of `docs/prd.md` and `docs/architecture.md`. Do not install Mastra or add agent behavior until the V2 milestone is explicitly started.

Check [docs/TODOS.md](docs/TODOS.md) for current work and use the Svelte MCP server (configured in [`.mcp.json`](.mcp.json)) for Svelte 5/SvelteKit documentation lookups and its autofixer on non-trivial Svelte edits — see [AGENTS.md#tooling--svelte-mcp-server](AGENTS.md#tooling--svelte-mcp-server).
