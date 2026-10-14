# Changelog

User-visible changes, newest first. The format is set in [AGENTS.md](../AGENTS.md#engineering-guardrails).
Superseded unreleased implementation notes were consolidated on 2026-10-14; Git retains the earlier history.

## Unreleased

### Changed

- Changed `bun run sync` to be read-only toward Are.na and free of vision spend by default: `--vision` and `--push-arena` are now opt-in, and the old `--no-vision` and `--no-push-arena` flags were removed.
- Changed the enrichment caches in `data/` to be git-ignored local files rather than committed, since they hold generated text and OCR of other people's blocks.
- Changed the Trigger.dev deploy job to skip itself when `TRIGGER_ACCESS_TOKEN` is not set, pinned GitHub Actions and the MCP servers to exact versions, and turned off `workers.dev` and preview URLs.
- Rewrote the README getting-started path so a plain sync with three credentials is enough.
- Split `src/lib/server/search/` so release-building code lives in `src/lib/server/release/` and only request-time Worker code stays in `search/`; moved the sync summary printing out of `scripts/sync.ts` into `progress/summary.ts`.
- Moved the committed enrichment caches from `src/lib/server/indexing/` to `data/`.
- Changed keyword search to match word prefixes, so a search for "widget" also finds "widgets".
- Changed the daily sync to deploy new site code even when the search content is unchanged.
- Changed search indexing to omit upload filenames and opaque tokens used as titles, which only diluted the text of the blocks that had them.
- Changed the daily hosted sync to describe new images and animations within a daily cap and write generated titles and descriptions back to Are.na, matching `bun run sync`.
- Changed search evaluation to report each expected block's rank in the complete ranking rather than the first page only.
- Aligned documentation with the implemented browser search architecture and added the plan for manually triggered Trigger.dev maintenance workflows.
- Changed search to submit on Enter or when the input lost focus instead of searching while typing.
- Aligned sans typography, colour primitives, spacing, capsule actions and date-slider controls with Yusufparak while preserving Archivist serif styling.
- Redesigned the gallery as a horizontal sheet with channel shelves, captions and reveal motion.

### Removed

- Trimmed the generic guidance in `AGENTS.md` and condensed the review protocol.
- Removed the retired `/api/search` endpoint, the `hosted experiment` and `hosted investigate` commands, and the example experiment spec.
- Removed the `export:search` and `calibrate:colour` package scripts: use `bun run sync --export`, and `bun run scripts/calibrate-colour.ts` for the read-only colour contact sheet.
- Removed the local `prepare:search`, `validate:search`, `promote:search` and `evaluate:search` commands; `bun run hosted sync` and `hosted deploy` run the same validation.
- Removed the `hello-world` and `validate-search-smoke` Trigger.dev tasks.
- Removed the unused committed channel manifest and the always-empty private channel allow-list.
- Removed the TODO list, feature specs, worksheets and the agent loop after consolidating current behavior into the owning docs.
- Removed Turbopuffer and the backend opt-in switch, making browser search the sole backend and retiring `/api/search`.

### Added

- Added `site.config.ts` as the single place that names the deployment, plus `CONTRIBUTING.md`, `SECURITY.md`, a bug report template and Dependabot updates for GitHub Actions.
- Added reproducible, read-only search experiments with held-out known-item scoring, and a per-case ranking investigation.
- Added a read-only enrichment coverage report and budget-capped hosted vision backfills with cost estimates.
- Added per-block enrichment outcomes, `bun run hosted retry` for failed blocks only, and batched child tasks for large backlogs.
- Added a daily 06:00 UTC hosted archive sync that deploys the site through GitHub Actions when the new release introduces no search regressions.
- Added the manually triggered `archive-sync` Trigger.dev task with leased, resumable R2-backed caches and a `bun run hosted` CLI for bootstrap, cache import, sync and guarded deployment.
- Added separate search candidate preparation, full-ranking validation reports and guarded local promotion, plus a non-mutating Trigger.dev validation smoke task.
- Added the production deployment at archivist.yusufparak.com and the `bun run deploy` command.
- Added Trigger.dev development support with a typed `hello-world` task.
- Added public-only static releases with MiniSearch, chunked semantic browser search, Workers AI query embeddings and a prerendered default gallery.
- Added My connection orders and Most connected sorting with cached total Are.na connection counts.
- Added connected/created date filters, block-kind filters and pixel-derived colour filtering.
- Added sync-time vision descriptions, OCR and tags for retrieval, with optional owner-only title/description write-back to Are.na.
- Added visible-only muted video playback and reduced-motion support.

### Fixed

- Fixed animation downloads buffering oversized sources and ignoring timeouts and cancellation.
- Fixed CI builds by generating synthetic search assets without provider credentials and disabling remote binding emulation during builds.
- Stabilized local development with remote Workers AI and disabled persisted platform-proxy state.
