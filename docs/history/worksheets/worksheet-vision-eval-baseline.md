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

## Second baseline: before `vision_tags` is indexed

Recorded so the tag change has a clean before/after. All 15 cases pass against the live namespace
as of this run, with `vision_*` text indexed but tags not:

```
exact-phrase-text: block:50290366@1 of 3
exact-phrase-link: block:50207334@2 of 47
semantic-material: block:47027380@2 of 25
semantic-place: block:50231202@2 of 43
channel-filter: block:32253420@16 of 16
multi-channel-filter: block:32253420@22, block:43484078@7 of 22
block-type-filter: block:31353299@2 of 9
date-filter: block:50368557@1 of 6
combined-filter: block:50207334@2 of 40
no-result: passed
vision-widget-grid: block:17698965@12 of 41
vision-ocr-refugee-document: block:13214360@1 of 42
vision-poster-sans-theme: block:21165584@1 of 47
vision-planner-ui: block:23363409@3 of 41
vision-time-machine: block:32633860@1 of 45
```

**What tags are expected to change.** Measured over a 596-block sample of the live index: 2,273 of
4,298 tag instances (**52.9%**) contain wording that appears nowhere else in that block's indexed
text, and **99.3%** of blocks gain at least some new vocabulary. The cost is 10% more text —
86 characters against a median `search_text` of 890 — which is why tags go last and why dilution
risk is judged low rather than zero.

**The bar after the re-upsert:** all 15 still pass, and no case's rank gets materially worse. The
two to watch are the same two as before, `exact-phrase-link` (`@2 of 47`) and `combined-filter`
(`@2 of 40`) — Link blocks with real human descriptions, the population most exposed to dilution.

## Result after `vision_tags` was indexed

All 15 cases pass, but **the bar was not met**: it asked that no rank get materially worse, and one
did.

| Case                 | Before      | After       |                      |
| -------------------- | ----------- | ----------- | -------------------- |
| `semantic-material`  | `@2 of 25`  | `@11 of 25` | **materially worse** |
| `vision-widget-grid` | `@12 of 41` | `@16 of 37` | worse                |
| `vision-planner-ui`  | `@3 of 41`  | `@2 of 39`  | better               |
| `exact-phrase-link`  | `@2 of 47`  | `@2 of 45`  | held                 |
| `combined-filter`    | `@2 of 40`  | `@2 of 42`  | held                 |
| the other ten        | unchanged   | unchanged   | held                 |

The two cases predicted to be at risk — `exact-phrase-link` and `combined-filter`, Link blocks with
real human descriptions — held their rank exactly. The damage landed somewhere the prediction did
not look.

### What actually happened

Not dilution in the sense the spec feared. Tags did not bury the targets under unrelated blocks;
they lifted the targets' near-neighbours more than the targets themselves, because the targets are
tagged in minority vocabulary.

**`semantic-material`** (`independent product designer and engineer`, target `block:47027380`).
Every one of the top 14 is a designer-or-engineer portfolio page, so the ordering within that
cluster was always going to be delicate. The target carries three hyphenated tags, and each is the
rare spelling of a far more common spaced form:

| Target's tag       | Count | Majority form      | Count |
| ------------------ | ----: | ------------------ | ----: |
| `design-engineer`  |     1 | `design engineer`  |     9 |
| `dark-theme`       |     6 | `dark theme`       |    65 |
| `personal-website` |     4 | `personal website` |    62 |

`design-engineer` occurs exactly once in the whole archive — on this block. The tag that most
precisely answers the query is written in a form nothing else shares, while the blocks above it are
tagged `product design`, `designer`, `portfolio` in the spelling the query uses.

**`vision-widget-grid`** (`dark mode widget grid of small bar charts and complications`, target
`block:17698965`). The target is tagged `dark theme`; the query says "dark mode", and nine of the
blocks that outrank it are tagged `dark mode` (237 blocks carry it, against 65 for `dark theme`).
This is synonymy rather than hyphenation, so it is not fixed by the same change.

### Measured: hyphenation splits the tag vocabulary

Across the 2,561 cached entries: **153 tag pairs differ only by a hyphen, covering 3,587
instances** — `web-design` (26) against `web design` (549), `dark-mode` (20) against `dark mode`
(237), `ui-design` (19) against `ui design` (274). Normalization already collapses case so a facet
treats `UI` and `ui` as one value; it does not collapse hyphens, so the same facet would list
`web design` and `web-design` separately.

Collapsing hyphens to spaces is one line, costs no model calls, and is independently correct for
the facet. It would move all three of `semantic-material`'s minority tags onto the majority form.
Whether that recovers the rank is an empirical question that needs another sync — it is not a
promise.

It does nothing for `vision-widget-grid`, whose problem is `dark theme` against `dark mode`. A
synonym map would address that, but tuning one against two evaluation cases is over-fitting, and
the structural answer if this recurs is the backlog item on giving generated text its own embedded
field rather than sharing `search_text`.

### The fix, applied

Hyphens are collapsed to spaces in tag normalization — in the attribute as well as in
`search_text`. Two normalizations would have been a trap for whoever builds the facet: they would
filter on `web-design` and get different results than search finds. One normalization means the
filter value and the indexed wording cannot disagree.

Across the cache that merges **153 distinct tags** away, 5,285 down to 5,132, and the
`semantic-material` target's three orphans each join a much larger group:

| Before             | Instances | After              | Instances |
| ------------------ | --------: | ------------------ | --------: |
| `design-engineer`  |         1 | `design engineer`  |        10 |
| `dark-theme`       |         6 | `dark theme`       |        71 |
| `personal-website` |         4 | `personal website` |        66 |

The cost, stated rather than hidden: genuine compounds are respelled. `e-commerce` becomes
`e commerce`, `sans-serif` becomes `sans serif`, `sci-fi` becomes `sci fi` — 158 instances against
the 332 the merge repairs. A hardcoded exception list would fix the cosmetics, but that is the kind
of hand-tuning that ages badly, and a facet can prettify its own labels.

**Still to verify:** whether this recovers `semantic-material`'s rank. It is a plausible mechanism,
not a proven outcome, and only a re-sync and re-evaluation will say. `vision-widget-grid` is not
expected to move — `dark theme` against `dark mode` is synonymy, which spelling does not touch.

## Result after the hyphen collapse

The fix worked mechanically and partially in effect. Nothing regressed against the previous run.

| Case                 | Pre-tags    | Post-tags   | Post-collapse |
| -------------------- | ----------- | ----------- | ------------- |
| `semantic-material`  | `@2 of 25`  | `@11 of 25` | `@8 of 25`    |
| `vision-widget-grid` | `@12 of 41` | `@16 of 37` | `@15 of 39`   |
| `vision-planner-ui`  | `@3 of 41`  | `@2 of 39`  | `@2 of 39`    |
| `exact-phrase-link`  | `@2 of 47`  | `@2 of 45`  | `@2 of 45`    |
| `combined-filter`    | `@2 of 40`  | `@2 of 42`  | `@2 of 42`    |
| the other ten        | unchanged   | unchanged   | unchanged     |

`semantic-material` recovered three of the nine positions it lost, overtaking four blocks, and its
tags now read `design engineer`, `dark theme`, `personal website` as intended.
`vision-widget-grid` moved one place, which is the "no meaningful change" that was predicted for
it — spelling does not touch `dark theme` against `dark mode`.

### Why the remaining six positions are not a bug

The seven blocks still above the target match the query's wording better than it does. The query is
`independent product designer and engineer`:

| Rank | Block                                             | Why it wins                                      |
| ---: | ------------------------------------------------- | ------------------------------------------------ |
|    1 | Social media post advertising design services     | tagged `designer for hire`, `product design`     |
|    2 | Siddharth Arun                                    | tagged `designer`, `product design`              |
|    3 | Grant Custer                                      | tagged `designer` **and** `engineer`, separately |
|    4 | KPRKR                                             | tagged `product designer`                        |
|    6 | Wireframe Design Studio — **Independent** studio… | carries "independent" in its title               |

The target is `bt norris, design engineer` — a design engineer, not described as a product designer
and not described as independent. All 25 results are designer-or-engineer portfolio pages, so which
one is "most" the query is close to arbitrary.

The `@2` baseline was measured before tags existed. Tags did not make the target worse; they made
its neighbours better described. **Accepted as the new reference**, rather than pursued further: the
remaining candidate fix is the backlog item on giving generated text its own embedded field, which
is a large change to shift one case inside a homogeneous cluster.

Worth knowing for later: `semantic-material` is a weak gate. Its target is one of 25 near-identical
documents, so its rank will keep moving on any retrieval change, and movement there says less than
movement in a case whose answer is distinctive. It still passes and still earns its place — the
rank is just not the signal it looks like.
