# TODOs

Task backlog and work-in-progress tracking. See
[`workflows/agent-loop.md`](./workflows/agent-loop.md) for how to work this list.

Keep this list current: move items between sections as you work, don't let it drift from reality.

**Status marks:** `[ ]` not started · `[~]` code complete, waiting on a run only the maintainer can
do · `[x]` finished.

---

## In Progress

_(none)_

---

## Up Next

- [ ] **Validate browser search cutover.** Resolve the widget-grid relevance miss and measure mobile transfer/memory performance.

---

## Needs Input

_(none)_

---

## Backlog

_(none)_

---

## Done

_Newest first._

- [x] **Submit search on Enter or blur.** Removed automatic search while typing; [worksheet](./history/worksheets/worksheet-search-submit.md).

- [x] **Stabilize Cloudflare local development.** Marked Workers AI as remote, disabled persisted local platform-proxy state, and verified concurrent requests; [worksheet](./history/worksheets/worksheet-cloudflare-local-dev.md).

- [x] **Set up Trigger.dev.** Added a typed hello task, ran it successfully in development, and confirmed it appears in the dashboard; [worksheet](./history/worksheets/worksheet-trigger-dev-setup.md).

- [x] **Align the design system.** Matched Yusufparak sans primitives and ASCII controls while preserving serif styling; [worksheet](./history/worksheets/worksheet-design-system-parity.md).

- [x] **Remove Turbopuffer.** Made browser search the sole default backend and migrated sync, evaluation and calibration to public snapshots.

- [x] **Implement free browser search.** Added the opt-in migration and generated public assets; production cutover remains gated on relevance and mobile validation.

- [x] **Investigate free search hosting.** Recommended MiniSearch with browser vector search and Workers AI query embeddings, preserving semantic search within free allocations. Proposal: [free search migration](./specs/free-search-migration.md); worksheet: [investigation](./history/worksheets/worksheet-free-search-migration.md).

- [x] **Sort by every connection on Are.na.** Blocks now carry a `total_connection_count`, counted per block by a new sync stage, and Most connected joins the Sort by list beside four My orders for the maintainer's own channels; the default browse is My most connected. Spec: [connection count](./specs/connection-count.md).
- [x] **Redesign the gallery as a horizontal library.** The UI now follows Seth Thompson's Library: a sideways sheet of filter columns fitted with pretext, results shelved by channel with captions and reveal motion, and a browse `sort`. Design: [design.md](./design.md); worksheet: [library redesign](./history/worksheets/worksheet-library-redesign.md).
- [x] **Index and filter by colour.** Colour weights are indexed as `colour_*` attributes and filtered with `?colour=` (ANDed), browse ranks by weight; synced with `bun run sync --no-vision --no-push-arena` and checked against the live index. Worksheet: [colour filter](./history/worksheets/worksheet-colour-filter.md).
- [x] **Measure colour weights and calibrate them.** Pixel colour weights are measured in memory with ffmpeg and calibrated on 400 blocks with `bun run calibrate:colour`; findings are in [the colour filter spec](./specs/colour-filter.md#calibration).
- [x] **Check Turbopuffer's colour ranking behaviour.** Answered in [the colour filter spec](./specs/colour-filter.md#turbopuffer-spike-answered): attribute sums work but tie order is undefined, so browse with colours uses a plain attribute sort.
