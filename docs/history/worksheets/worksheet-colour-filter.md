# Worksheet: colour filter

Spec: [colour-filter.md](../../specs/colour-filter.md). TODO entries: the three colour tasks in
[TODOS.md](../../TODOS.md).

Started on branch `colour-filter` from a clean `main` (`0251f98`).

## Reviewed

- `AGENTS.md`, `docs/architecture.md` (schema, retrieval, sync lifecycle, vision indexing).
- `src/lib/domain/search.ts`, `src/lib/domain/archive.ts`.
- `src/lib/server/search/`: `repository.ts`, `request.ts`, `contracts.ts`, `execute.ts`,
  `turbopuffer-client.ts`, `turbopuffer-schema.ts`.
- `src/lib/server/indexing/`: `sync.ts`, `normalize.ts`, `vision/{index,cache,prompt,rendition,video}.ts`,
  `progress/events.ts`; `scripts/sync.ts`, `scripts/evaluate-search.ts`.
- `vision-cache.jsonl`: 2,542 entries, every `palette` valid hex, usually 5 swatches. Unweighted,
  so it cannot rank. That is why the spec measures pixels instead.

## Task 1: Turbopuffer spike (done)

Read-only queries against `arena-blocks-v1`; results are recorded in the spec under
"Turbopuffer spike (answered)". The finding that changed the plan: expression ranking (`Sum` of
`Attribute`) has undefined tie order that varies with `limit`. It cannot take a secondary sort, and
its scores are 32-bit floats. Browse with colours therefore uses a plain attribute sort ending in
`id`, which pages cleanly.

Side observation, out of scope: today's browse sort, `connection_count` then `connected_at`, has
no unique final key, so two blocks with identical `connected_at` could in principle straddle a page
edge.

## Task 2: Measure and calibrate (done)

- `indexing/ffmpeg.ts`: `runFfmpeg` moved out of `vision/video.ts`, now pipes stdin and stdout
  with an output cap. `video.ts` uses it unchanged in behaviour.
- `indexing/pool.ts`: the vision stage's worker pool, now shared.
- `domain/search.ts`: `ARCHIVE_COLOURS` (the vocabulary only; the URL grammar is task 3).
- `indexing/colour/`: `classify.ts` (OKLCH pixel classifier, per-mille weights), `extract.ts`
  (capped fetch of a 128px rendition, ffmpeg `select` sampling to 64 × 64 RGBA, all in memory),
  `cache.ts` (`colour-cache.jsonl` format and merge rules), `index.ts` (the stage, 4 workers).
- `search/colour-filter.ts`: per-colour thresholds, read by the calibration sheet now and by the
  filter in task 3.
- `scripts/calibrate-colour.ts` (`bun run calibrate:colour`): read-only contact sheet.

`fps=1` drops the only frame of a still read from a pipe; a `select` on
`prev_selected_t` keeps the first frame and one per second after it, for stills and GIFs alike.

Calibration on 400 blocks, recorded in the spec: green, yellow, blue, brown and mono rank well.
Two boundary changes came out of it: brown's hues end at 85° (dark yellow was reading as brown),
and mono's threshold is 995‰ (980‰ let in images with a clear accent).

Tests: classifier, weights, cache, stage (with an injected `measure`), extraction and
`runFfmpeg` against the real binary (skipped without ffmpeg, asserted present in CI).

## Task 3: Index and filter

- Grammar (`domain/search.ts`): `colour` parameter, `ArchiveSearchState.colours`,
  `ARCHIVE_MAX_COLOURS` (5, so browse stays within Turbopuffer's 8 sort keys). Unknown colours
  are dropped from UI state; the server rejects them with a 400, like an unknown `type`.
- Documents (`domain/archive.ts`): `colour_<name>` attributes, 0 when unmeasured; never in
  `search_text`. Schema: twelve filterable `uint`s.
- Query (`search/repository.ts`): one `Gte` threshold filter per colour inside the existing `And`;
  browse with colours sorts colours…, `connection_count`, `connected_at`, `id`. Text modes keep
  their ranking. Colour attributes are never requested back.
- Sync: the colour stage runs before vision; cache merge shares the vision stage's "a failed or
  aborted fetch drops nothing" rule. The CLI gains `--no-colour` and the colour cache file. The
  checkpoint writer now queues writes, so a slow checkpoint cannot land after the final write.
- `components/format.ts` counts colours in the results status, so `?colour=` reads as a filter.
- Docs: architecture (schema, filters, colour order, validation, sync lifecycle, new "Colour
  indexing"), AGENTS (layout, search invariant), README, CHANGELOG, ADR 0001.

Ran `bun run sync --no-vision --no-push-arena` on 2 October 2026: 2,542 images measured, 1 SVG
skipped, 0 failures; 2,546 documents upserted, nothing pruned. Checked against the live index
afterwards (read-only): colour browse paged to the end with no repeats for mono (954), white
(1,418) and blue (316); `blue`+`orange` returns 10; five colours return none; a text query with a
colour keeps relevance order; `colour=teal` is a 400. `bun run evaluate:search` passes every case.
`/?colour=blue` in the dev server leads with fully blue pages.

Not done, deliberately: no gallery control for colour (UI is out of scope). `SearchForm` rebuilds
the URL from its own fields, so typing a query on a `?colour=` page drops the colour until the UI
adds a field for it.
