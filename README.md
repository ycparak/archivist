# Archivist

A SvelteKit gallery and hybrid search for an Are.na archive, hosted on Cloudflare Workers. MiniSearch and static document vectors rank original blocks in a browser Worker; Workers AI generates query embeddings.

## Setup

Install dependencies with bun install. Copy .env.example to .env and configure ARENA_ACCESS_TOKEN, CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN (a Workers AI API token). Never commit credentials or private exports.

Generate the public snapshot, then start the app:

```sh
bun run export:search
bun run dev
```

Export reads public/closed owned channels, skips all private channels and uses committed vision/colour/connections caches. It never generates vision text or writes to Are.na. Content-hashed static/search assets and .search-cache embeddings are ignored by Git. Unchanged embedding chunks are reused.

## Maintenance

```sh
bun run evaluate:search
bun run calibrate:colour
bun run sync --no-vision --no-push-arena
```

Sync refreshes colour/connection caches and publishes static search assets. Plain sync also calls OpenRouter and writes generated titles/descriptions to Are.na; it is maintainer-only. Existing vision generation is separate from the free search architecture.

## Build and deploy

```sh
bun run check
bun run lint
bun run test
bun run build
bun run deploy
```

A generated public snapshot must exist when building. CI prepares a small synthetic release with `bun run scripts/prepare-ci-search.ts` before the build, without credentials or external API calls. The script refuses to overwrite an existing export; its output is for CI validation only and must never be deployed. `bun run deploy` builds and publishes the Worker and static assets to https://archivist.yusufparak.com, with AI and ARCHIVE_SEARCH_RATE_LIMITER bindings. Authenticate first with `bunx wrangler login`. Deployment uses `.env.example` so the local Workers AI token does not override your deployment login or upload local credentials. Wrangler manages the custom domain's DNS and TLS in the configured Cloudflare account. REST API credentials are only needed locally; production query inference uses the AI binding. The default gallery is static; interactive search/filtering requires JavaScript. /api/search is retired with HTTP 410.

Free hosting/inference depends on Cloudflare allocations. A previous evaluation found the widget-grid expected block at rank 112; rerun the fixture to measure the current release. Physical mobile performance remains to be measured. See [architecture](./docs/architecture.md) and [tasks](./docs/TODOS.md).

## Trigger.dev

The SDK and Node 24 configuration are installed; `src/trigger/example.ts` is the only current task. Start development with `bunx trigger.dev@4.7.3 dev`. Archive maintenance workflows are proposed in the [implementation plan](./docs/specs/trigger-workflows.md), not implemented yet.
