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
