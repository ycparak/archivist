# Search experiments worksheet

Task: phase 6 of [Trigger.dev workflows](../../specs/trigger-workflows.md#phase-6-isolated-search-experiment-batches). Branch `phase-6-search-experiments`.

## Implementation

- **Ranking options.** `RankingOptions` and `PRODUCTION_RANKING` (`rrfK` 60, `prefix` false, `fuzzy` 0) were added to the search engine. Defaults reproduce production exactly, and nothing in the browser or site changes. The chunk size is a parameter of `embeddingChunks` and `buildSearchRelease`, defaulting to 384.
- **Experiment module (`experiments.ts`):**
  - a pinned, validated spec with one change per variant (RRF `k`, lexical prefix, lexical fuzzy, or chunk bytes from 128 to 500);
  - `readOnlyStore`;
  - deterministic held-out known-item cases;
  - invariant checks;
  - per-variant metrics and a suggestion rule: keep every fixture pass and invariant, and beat the control;
  - `investigateCase`.
- **Out of scope:** vision prompt or model variants, which would need paid regeneration.
- **CLI.** The CLI adds `experiment` and `investigate`. Experiment outputs are written only to `.maintenance/experiments/<spec hash>/`. A sample spec is in `scripts/fixtures/experiments/`.

## Evidence

- Tests cover:
  - spec validation and read-only storage;
  - held-out determinism and title filtering;
  - control and variant scoring, where only chunk variants embed;
  - an identical rerun from saved vectors, with no provider calls;
  - investigation evidence.
- `bun run check`, `bun run lint`, `bun run test` (714 passed, 2 skipped) and `bun run build` pass.

### Widget-grid investigation

`bun run hosted investigate vision-widget-grid` against job `daily-20261014` found:

- **Title.** The expected block `17698965` has a junk filename title (`original-0280b5e4….png?compress=1-resize=1905x1429`), and it appears twice at the start of its `search_text`.
- **Lexical match.** The query term "widget" does not match its "widgets" (no stemming or prefix), so only "dark", "grid", "of" and "and" match. That gives lexical rank 454.
- **Semantic and hybrid.** Its semantic rank is 49, and its hybrid rank is 116.
- **Leaders.** The top results are near-duplicates with informative titles, one of them a sibling block.

### Experiment run

Spec `scripts/fixtures/experiments/ranking-and-chunking.json` (hash `d60624c5`), with 200 held-out queries (seed 20261014). It ran in about 5 minutes and embedded 11,988 new chunks, for the 256-byte variant only.

| Variant           | Fixture | Held-out MRR | Held-out @1 | Widget-grid rank |
| ----------------- | ------- | ------------ | ----------- | ---------------- |
| control           | 14/15   | 0.987        | 98.0%       | 90               |
| RRF k 20          | 14/15   | 0.989        | 98.0%       | 78               |
| RRF k 120         | 14/15   | 0.986        | 98.0%       | 101              |
| lexical prefix    | 15/15   | 0.982        | 97.0%       | 24               |
| lexical fuzzy 0.2 | 14/15   | 0.983        | 97.5%       | 39               |
| chunk 256         | 14/15   | 0.991        | 98.5%       | 49               |

No variant violated an invariant. The tool suggested lexical prefix.

Assessment:

- **Lexical prefix is not adopted.** It passes widget-grid only at rank 24, the last first-page slot, and it loses 2 of 200 held-out top-1 hits.
- **Lexical fuzzy** doubles Node search time.
- **256-byte chunks** add 45% more vectors and 5.3 MB of gzip for a marginal held-out gain.
- **RRF `k`** barely matters.
- **Production stays unchanged.**

The evidence points at the junk filename title, which is the recorded next task.

### Reproducibility

The control ranked widget-grid at 90, while the standalone investigation ranked it at 116. The only difference was the batch the query was embedded in: Workers AI vectors vary slightly with batch composition. Experiments therefore persist query vectors, and first-page and held-out metrics are the signals to compare.

## Follow-up: uninformative titles, 2026-10-14

An experiment ran at source `940fb941` (spec hash `92f4e090`; the variant kind was removed after adoption, and that revision reproduces it). It dropped title and source-title lines that `titles.ts` classes as `filename` or `opaque`:

| Variant                   | Fixture | Held-out MRR | Held-out @1 | Widget-grid rank | Vectors | Gzip bytes |
| ------------------------- | ------- | ------------ | ----------- | ---------------- | ------- | ---------- |
| control                   | 14/15   | 0.987        | 98.0%       | 90               | 8,564   | 13,288,781 |
| drop uninformative titles | 14/15   | 0.987        | 98.0%       | 63               | 8,497   | 13,180,028 |
| lexical prefix            | 15/15   | 0.982        | 97.0%       | 24               | 8,564   | 13,288,781 |

- **Adopted:** dropping uninformative titles. It improved widget-grid with no fixture or held-out cost and a slightly smaller release, so `toSearchDocument` now omits such titles from `search_text` and the documented composition was updated.
- **Embeddings:** the embedding version is unchanged (same model and chunking). The change produces a new content-hashed release through the next daily sync's no-regression gate, and about 1,400 changed chunks are embedded within the Workers AI free allocation.
- **Still open:** widget-grid remains off the first page, because "widget" does not match "widgets" lexically. Lexical prefix would fix that, at a small held-out cost, which is a policy decision recorded under Needs Input.

## Prefix matching adopted, 2026-10-14

The maintainer chose to adopt lexical prefix matching, so `PRODUCTION_RANKING.prefix` is now `true`. It is a query-time option: the release format and embeddings are unchanged, and the browser worker and validation share the default.

The combined production configuration (prefix matching plus title exclusion) was measured against exact matching on job `daily-20261014` with 200 held-out queries:

| Variant                | Fixture | Fixture MRR | Held-out MRR | Held-out @1 | Widget-grid rank |
| ---------------------- | ------- | ----------- | ------------ | ----------- | ---------------- |
| production (prefix on) | 15/15   | 0.659       | 0.981        | 97.0%       | 14               |
| exact matching         | 14/15   | 0.602       | 0.987        | 98.0%       | 63               |

There were no invariant violations, and `vision-planner-ui` improved from rank 4 to 1. Together the two changes put widget-grid well inside the first page; prefix matching alone reached only rank 24.

The daily decision now compares the source revision as well as the release, so this code-only change, and any future one, reaches the live site even when the search content is unchanged. The sample spec now tests `exact-lexical` against the new control.
