# Cloudflare local development worksheet

- Task: Stop the Workers AI acknowledgement warning and investigate recurring local `workerd` SQLite lock crashes.
- Working tree was clean before the task.

## Reviewed

- `wrangler.jsonc`, `vite.config.ts`, and the installed Wrangler config schema/runtime.
- Cloudflare local development docs and local tracing docs.
- Wrangler's installed source confirms `X_LOCAL_OBSERVABILITY` controls whether Miniflare attaches local observability to each user Worker.

## Findings

- The Workers AI binding was configured without `remote: true`, despite Workers AI using remote resources in local development.
- SvelteKit's Cloudflare adapter calls Wrangler's `getPlatformProxy()` and accepts `platformProxy.persist`; local binding state is persisted to `.wrangler/state` by default.
- The stack trace identifies a workerd SQLite lock but not the specific local binding store. Disabling local persistence avoids concurrent access to the persisted SQLite state while retaining local bindings in memory.

## Plan

Set the AI binding to remote and disable filesystem persistence for the SvelteKit local platform proxy. Preserve the existing deployed observability settings. Verify config and project checks, then restart/reload the dev server if its existing process picks up the config change.

## Results

- Set the Workers AI binding to `remote: true`, which explicitly acknowledges its remote behavior during local development.
- Set SvelteKit's Cloudflare adapter to `platformProxy: { persist: false }`, leaving production observability and runtime configuration unchanged. Local binding state, including the development rate-limit state, now resets when the dev process restarts.
- `bun run check` passed with 0 Svelte diagnostics. `bun run lint` passed after formatting the existing `.mcp.json`; the file's MCP configuration values were unchanged.
- The existing Vite dev server stayed up and returned HTTP 200 for seven requests, including six concurrent requests, after the configuration reload.
