# Changelog

User-visible changes, newest first. The format is set in [AGENTS.md](../AGENTS.md#engineering-guardrails).
Superseded unreleased implementation notes were consolidated on 2026-10-14; Git retains the earlier history.

## Unreleased

### Changed

- Changed search evaluation to report each expected block's rank in the complete ranking rather than the first page only.
- Aligned documentation with the implemented browser search architecture and added the plan for manually triggered Trigger.dev maintenance workflows.
- Changed search to submit on Enter or when the input lost focus instead of searching while typing.
- Aligned sans typography, colour primitives, spacing, capsule actions and date-slider controls with Yusufparak while preserving Archivist serif styling.
- Redesigned the gallery as a horizontal sheet with channel shelves, captions and reveal motion.

### Removed

- Removed superseded feature specs, completed worksheets and obsolete TODO history after consolidating current behavior into the owning docs.
- Removed Turbopuffer and the backend opt-in switch, making browser search the sole backend and retiring `/api/search`.

### Added

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
