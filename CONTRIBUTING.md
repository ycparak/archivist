# Contributing

Thanks for taking an interest in Archivist. It is built around one maintainer's archive, so small,
focused changes are easiest to review; open an issue before starting anything large.

## Setup

Follow [Getting started](./README.md#getting-started). You can work on most of the code without any
credentials: `bun run check`, `bun run lint` and `bun run test` need none.

## Before you open a pull request

```sh
bun run check
bun run lint
bun run test
```

- Keep each pull request to one change and describe the behaviour it changes and how you tested it.
- Add a focused unit test for every normalizer, filter builder and search-result mapper.
- Add a line under `## Unreleased` in [docs/CHANGELOG.md](./docs/CHANGELOG.md) for user-visible work, and
  update the doc that owns any rule you change.
- Do not commit `.env`, the `data/*.jsonl` caches or anything exported from a private archive.
- Never run `bun run sync --vision` or `--push-arena` as part of a contribution: they spend credit and
  edit Are.na blocks.

[AGENTS.md](./AGENTS.md) holds the full engineering rules and architectural boundaries; it applies to
people as much as to coding agents.
