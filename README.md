# Archivist

An open-source, public-facing search and gallery for a personal Are.na archive.

V1 is deliberately small: a manual Are.na sync indexes original blocks in Turbopuffer, and visitors can browse or search them using lexical, semantic, filtered, and hybrid retrieval. V2 adds an evidence-first “Ask my Are.na” mode powered by Mastra.

## Start here

1. Read [the PRD](docs/PRD.md), then [the architecture](docs/ARCHITECTURE.md).
2. Copy `.env.example` to `.env` and populate the server-only credentials.
3. Run `bun run check`, `bun run lint`, and `bun run test` before opening a pull request.

## Commands

```sh
bun run dev
bun run check
bun run lint
bun run test
bun run build
```

## Design constraints

- The Turbopuffer and Are.na tokens never reach the browser.
- Search results are always original Are.na blocks, never generated cards.
- V1 does not crawl linked pages, run OCR, or create image captions.
- A manual sync is an explicit maintainer action; public traffic never calls Are.na.

See [AGENTS.md](AGENTS.md) for the implementation contract shared by Codex and Claude Code.

See [docs/design.md](docs/design.md) for the light-only visual and interaction contract.
