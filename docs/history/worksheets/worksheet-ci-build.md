# CI build authentication

Task: Fix CI build authentication in TODOS.md.

## Investigation and plan

- Working tree started clean. Read CI workflow, Vite configuration, Svelte guidelines, architecture, local-development worksheet and installed adapter/Wrangler sources; consulted official Svelte adapter docs.
- Job 114766073125 passed check, lint and tests, then failed during build: adapter emulation opened a remote AI preview session and Cloudflare returned authentication error 10000.
- Set platformProxy.remoteBindings from Vite command: enabled for serve, disabled for build. Remove the unnecessary CI build token. Production bindings remain configured in wrangler.jsonc.
- Validate the actual production build with an intentionally invalid token, plus required checks. This is a small configuration correction; skip formal review and unit tests that would merely mirror configuration.

## Results

- Enabled remote emulation only for Vite serve and removed the CI build token.
- `bun run check` and `bun run lint` passed; `bun run test` passed (641 passed, 2 existing skips).
- `CLOUDFLARE_API_TOKEN=invalid-ci-regression-token bun run build` passed. Sandbox initially blocked the local emulator port (EPERM); reran with approved access.
- No sync, export or deployment was run. Local dev remote bindings remain enabled; live AI inference was not retested because its configuration is unchanged.
