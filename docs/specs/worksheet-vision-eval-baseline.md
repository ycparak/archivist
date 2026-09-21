# Worksheet: Search evaluation baseline for vision indexing

**Task:** [TODOS.md](../TODOS.md) — Vision indexing phase 1, task 1
**Spec:** [spec-vision-indexing.md](./spec-vision-indexing.md)
**Namespace:** `arena-blocks-v1`, 2,594 documents
**Date:** 2026-09-21

## Why this exists

The spec's validation plan compares retrieval before and after generated text enters `search_text`.
That comparison needs a trustworthy before-state. It did not exist: the evaluation was red, and the
harness reported only pass/fail, which cannot see the regression the spec is most worried about —
an expected block staying in the results but sinking down the ranking.

## The evaluation was already failing

`bun run evaluate:search` failed 4 of 10 cases before any vision work. Two distinct causes, both
pre-existing drift, neither related to this feature:

| Case                   | Cause                                                                       |
| ---------------------- | --------------------------------------------------------------------------- |
| `channel-filter`       | Expected block ranked **91 of 282** in browse; `ARCHIVE_RESULT_LIMIT` is 24 |
| `multi-channel-filter` | Expected blocks ranked **92** and **26** of 297                             |
| `block-type-filter`    | Expected block ranked **160 of 915**                                        |
| `date-filter`          | Expected `block:50358785` **no longer exists** in the namespace — pruned    |

The first three are fallout from the browse-ordering change (most-connected first, replacing
most-recently-connected). The fixture was written when a freshly connected block sat at rank 1;
under connection ordering those low-connection blocks sank far below the 24-result limit. The
fourth block was removed from Are.na and pruned by `eee2c5c`.

`TODOS.md` records "all ten live evaluation cases pass" from the Slice 4 quality pass. That was
true when written. The fixture then drifted silently, because nothing re-runs it automatically.

## What changed

**Repaired the four stale cases so they assert what they are actually testing.** Each now uses
filters whose result set fits inside the 24-result limit, making them independent of global browse
ordering — a channel-filter case should not fail because ranking changed:

| Case                   | Now                                                                  |
| ---------------------- | -------------------------------------------------------------------- |
| `channel-filter`       | `hci-density` (16 blocks — every one returned)                       |
| `multi-channel-filter` | `hci-density` + `cyberpunk-aesthetics` (22 combined)                 |
| `block-type-filter`    | `hci-density` + type `Image` (9 of 16; the 7 Links must be excluded) |
| `date-filter`          | 2026-09-12 (6 blocks) → `block:50368557`, which still exists         |

**Added rank reporting** to `evaluate-search.ts`. Output now carries each expected block's position
(`block:50207334@2 of 44`). Pass/fail alone cannot detect dilution: a block can hold its place in
the result set while dropping twenty ranks, which is exactly the failure mode the spec flags for
the 1,494 Link blocks with good human descriptions.

**Added a `pending` field** to the evaluation case schema. A pending case that fails is reported
and does not fail the run; a pending case that _passes_ is reported as ready to promote. This lets
the fixture record what the backfill must achieve without holding the gate red for the whole build.

**Added five pending vision cases.** Each was grounded by fetching the block's 768px rendition and
looking at it — the queries describe what is actually in the image, not an invention — and each was
verified to return zero of its expected block today:

| Case                          | Block            | Actually depicted                                                |
| ----------------------------- | ---------------- | ---------------------------------------------------------------- |
| `vision-widget-grid`          | `block:17698965` | 20 dark-mode watch complications: pace, sleep, weather, Spotify  |
| `vision-ocr-refugee-document` | `block:13214360` | Overprinted editorial spread of refugee-convention legal text    |
| `vision-poster-sans-theme`    | `block:21165584` | "SANS THÉME" fashion-exhibition poster, Philadelphia, 05.28.2022 |
| `vision-planner-ui`           | `block:23363409` | Task planner, day columns, orange gradient wallpaper             |
| `vision-time-machine`         | `block:32633860` | macOS Time Machine restore, receding Finder windows, timeline    |

A sixth candidate, `block:17436125` (Ortto brand shape specimen), was **dropped**: it already
passes at rank 7 because its source title carries the Brand New article name. It would not have
isolated the vision signal.

## Baseline

`bun run evaluate:search` — 10 gating cases pass, 5 pending, exit 0.

```
exact-phrase-text: passed (block:50290366@1 of 3)
exact-phrase-link: passed (block:50207334@2 of 44)
semantic-material: passed (block:47027380@1 of 25)
semantic-place: passed (block:50231202@2 of 43)
channel-filter: passed (block:32253420@16 of 16)
multi-channel-filter: passed (block:32253420@22, block:43484078@6 of 22)
block-type-filter: passed (block:31353299@2 of 9)
date-filter: passed (block:50368557@1 of 6)
combined-filter: passed (block:50207334@2 of 32)
no-result: passed
vision-widget-grid: pending
vision-ocr-refugee-document: pending
vision-poster-sans-theme: pending
vision-planner-ui: pending
vision-time-machine: pending
```

**After the backfill (task 5), the bar is:** all five pending cases pass and lose their `pending`
field, and no gating case's rank gets materially worse. The two to watch are `exact-phrase-link`
(`@2 of 44`) and `combined-filter` (`@2 of 32`) — both Link blocks with real human descriptions,
the exact population the spec predicts generated prose could drown out.

## Incidental findings for later tasks

- **The rendition rewrite works on real archive images.** Rewriting `edits.resize` to 768 returned
  valid PNG, JPEG and WebP across 11 sampled blocks, 21–104 KB each. Confirms the task-2 approach.
- **GIFs are a size problem.** `block:36923691` (`browser.gif`) is **5,069 KB** at source, over the
  5 MB image ceiling several providers enforce, and CloudFront serves no resize payload. Task 3
  needs a size guard and a downscale path for the 134 GIFs — not just the first-frame assumption
  currently in the spec.
- **757 Image blocks** have a filename-shaped title and no description, confirming the audit's
  scale estimate for the task-6 write-back.

## Validation

`bun run check`, `bun run lint`, `bun run test`, `bun run build` — all pass. `bun run evaluate:search`
exits 0.
