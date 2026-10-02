# TODOs

Task backlog and work-in-progress tracking. See
[`workflows/agent-loop.md`](./workflows/agent-loop.md) for how to work this list.

Keep this list current: move items between sections as you work, don't let it drift from reality.

**Status marks:** `[ ]` not started · `[~]` code complete, waiting on a run only the maintainer can
do · `[x]` finished.

---

## In Progress

- [ ] **Measure colour weights and calibrate them.** Build the in-memory ffmpeg extraction, the colour cache and the contact-sheet script from [the colour filter spec](./specs/colour-filter.md), and settle boundaries and thresholds on a sample.

---

## Up Next

- [ ] **Index and filter by colour.** Add the sync stage, the `colour_*` attributes, the `colour` grammar, AND filters and browse ranking by weight per [the colour filter spec](./specs/colour-filter.md), then run `bun run sync --no-vision --no-push-arena`.

---

## Needs Input

_(none)_

---

## Backlog

_(none)_

---

## Done

_Newest first._

- [x] **Check Turbopuffer's colour ranking behaviour.** Answered in [the colour filter spec](./specs/colour-filter.md#turbopuffer-spike-answered): attribute sums work but tie order is undefined, so browse with colours uses a plain attribute sort.
