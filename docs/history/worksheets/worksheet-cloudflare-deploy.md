# Cloudflare deployment

Task: deploy Archivist to `archivist.yusufparak.com`.

Reviewed TODOs, agent loop/review, architecture deployment notes, README, package scripts, Wrangler configuration, and the existing public search manifest. Workspace started clean.

Plan: add the custom domain and verified Cloudflare account to Wrangler, add a repeatable deployment command using `.env.example` to avoid the local AI-only token overriding OAuth, validate/build/package, deploy, and verify the public gallery, snapshot assets and embedding endpoint. Use the existing public-only snapshot (2,202 blocks); no sync/export is needed. No runtime secrets are needed because inference uses the AI binding.

Formal review is skipped for the small declarative deployment change: no application logic or Svelte code changes. Validate through the full existing suite, Wrangler dry run, and live HTTP checks. Deployment may be blocked if the hostname already has a conflicting DNS record; do not replace another service without checking.

Completed: deployed Worker version `ef355cde-ec2d-43bc-9f1e-621ac62bec0e` to the custom domain and `https://archivist.yusuf-parak.workers.dev`. Cloudflare public DNS resolves the custom domain; the machine resolver initially cached its absence, so custom-domain HTTPS was verified with curl's `--resolve` using the published address and normal certificate validation.

Validation: `bun run check`, `bun run lint`, `bun run test` (641 passed, two existing skips), `bun run build`, and `bunx wrangler deploy --dry-run --env-file=.env.example` passed. The build required sandbox escalation for the adapter's local socket and remote connection. Live custom-domain checks passed for the gallery, 2,202-block manifest, exact sizes/SHA-256 checksums of all five snapshot assets, and a 384-dimensional Workers AI query embedding. The live gallery rendered in the browser at the Workers URL. Existing relevance/mobile validation backlog remains unchanged. No sync/export or secret upload was performed.

Deployment command: `bunx wrangler deploy --env-file=.env.example`. Future deployments: `bun run deploy`.
