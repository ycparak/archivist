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

_(none)_

---

## Needs Input

_(none)_

---

## Backlog

_(none)_

---

## Done

_Newest first._

- [x] **Index and filter by colour.** Colour weights are indexed as `colour_*` attributes and filtered with `?colour=` (ANDed), browse ranks by weight; synced with `bun run sync --no-vision --no-push-arena` and checked against the live index. Worksheet: [colour filter](./history/worksheets/worksheet-colour-filter.md).
- [x] **Measure colour weights and calibrate them.** Pixel colour weights are measured in memory with ffmpeg and calibrated on 400 blocks with `bun run calibrate:colour`; findings are in [the colour filter spec](./specs/colour-filter.md#calibration).
- [x] **Check Turbopuffer's colour ranking behaviour.** Answered in [the colour filter spec](./specs/colour-filter.md#turbopuffer-spike-answered): attribute sums work but tie order is undefined, so browse with colours uses a plain attribute sort.
