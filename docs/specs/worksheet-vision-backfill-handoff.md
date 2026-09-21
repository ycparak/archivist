# Handoff: running the vision backfill

**Task:** [TODOS.md](../TODOS.md) — Vision indexing phase 1, task 5
**Spec:** [spec-vision-indexing.md](./spec-vision-indexing.md)
**Baseline to compare against:** [worksheet-vision-eval-baseline.md](./worksheet-vision-eval-baseline.md)

The code is written, tested and committed. The backfill itself is long-running, so it is yours to
run. This is everything you need to run it, judge it, and back it out.

## The command

```bash
bun run sync --vision
```

That describes every block with an image that is not already cached, folds the text into
`search_text`, and writes `src/lib/server/indexing/vision-cache.jsonl`.

Expect **~2,570 blocks** and **about $0.50**. Twelve blocks are already cached and will be skipped
for free.

**Duration: a few hours** at the default concurrency of 32.

This estimate was wrong the first time. It was extrapolated from a single 39s call; the real
distribution is 20–160s per description (mean ~60s), because the model emits several hundred
completion tokens. At the original default of 8 the backfill projected to ~16 hours. Per-slot
throughput stays roughly flat as slots are added, so 32 is now the default and
`--vision-concurrency=N` overrides it. Sustained 429s are retried with backoff honouring
`Retry-After`, so raising it degrades to slower rather than broken.

## Interrupting it is safe

The three properties that make this survivable:

- **Checkpoints every 25 descriptions.** A crash, a Ctrl-C or a closed laptop costs at most 25
  descriptions, not the run.
- **Resume is automatic and free.** Re-run the same command; every cached block is skipped before
  any network call. There is no resume flag and no partial state to clean up.
- **A failed block writes no cache entry**, so the next run retries exactly those.

If you want to stop early on purpose, Ctrl-C is fine. Note that the Turbopuffer upsert happens
_after_ the vision stage, so an interrupted run leaves the cache updated but the index not yet
rebuilt — just run `bun run sync` afterwards to index what you have.

## Before you start

Optional, costs nothing, confirms the plan:

```bash
bun run sync --vision-dry-run
```

It reports how many blocks have an image, how many are cached, and how many would be described.

## After it finishes

**1. Check the summary.** It prints cache hits, generated, too-large skips and failures. Expect
around **43 "Vision too large"** — those are the oversized GIFs, covered by the phase-2 task, not a
bug. A handful of failures is normal; re-run to pick them up.

**2. Re-run the evaluation.**

```bash
bun run evaluate:search
```

Two things to look for, and the second matters more:

- The five `vision-*` cases should now **pass** and report `PENDING CASE NOW PASSES`. Remove their
  `pending` field in `scripts/fixtures/search-cases.json` once they do.
- **No gating case's rank should get materially worse.** Compare against the baseline:

  | Case                | Baseline rank |
  | ------------------- | ------------- |
  | `exact-phrase-text` | `@1 of 3`     |
  | `exact-phrase-link` | `@2 of 44`    |
  | `semantic-material` | `@1 of 25`    |
  | `semantic-place`    | `@2 of 43`    |
  | `combined-filter`   | `@2 of 32`    |

  `exact-phrase-link` and `combined-filter` are the ones to watch. Both are Link blocks with real
  human descriptions — exactly the population that ~500 characters of generated prose could drown
  out. If either sinks, that is the dilution risk landing, and the fix is in the spec: tighten the
  length cap, or move generated text to a separate embedded field rather than concatenating it.

**3. Commit the cache.** `vision-cache.jsonl` will be ~2 MB. It is the expensive artifact and the
reason a rebuild is free.

**4. Spot-check some output.**

```bash
head -5 src/lib/server/indexing/vision-cache.jsonl | python3 -m json.tool --json-lines
```

## If you want to undo it

Nothing here is destructive to Are.na — write-back is task 6 and has not run. To back the change
out of search: `git revert` the commit, delete `vision-cache.jsonl`, and run `bun run sync`. The
next upsert rewrites every document without the `vision_*` attributes. The namespace was not
versioned because the attributes are additive.

## What is knowingly not handled

- **43 oversized GIFs** are skipped, reported, and owned by the phase-2 GIF task.
- **`vision_medium` is unreliable** — a grainy photograph came back as `painting` in the first
  batch. It is stored and filterable but nothing reads it. Do not build a facet on it without
  measuring it first.
- **Cost is not metered per run.** The estimate comes from OpenRouter's published per-token price,
  not from the response's `usage` block. If the bill matters to you more than the estimate does,
  check your OpenRouter dashboard after the run.
