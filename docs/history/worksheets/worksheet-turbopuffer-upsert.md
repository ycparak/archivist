# Worksheet: Turbopuffer schema creation and batch upsert

- TODO: `TODOS.md` — Slice 1, "Turbopuffer schema creation (`search_text` full-text + native
  embed, per `docs/architecture.md`) and batch upsert."
- Depends on: [worksheet-sync-command.md](./worksheet-sync-command.md) (discovers/normalizes/
  dedupes blocks; this task adds the persistence step it explicitly deferred).

## Investigation

`archiveNamespaceSchema` (`src/lib/server/search/turbopuffer-schema.ts`) already existed, matching
`docs/architecture.md`'s schema table exactly — pre-existing work, not something to design from
scratch. `SearchRepository`/`SearchResult` contracts (`src/lib/server/search/contracts.ts`) also
pre-exist for the _next_ TODO (the search API), unrelated to this one. Nothing anywhere actually
calls Turbopuffer yet (confirmed via `grep -rl turbopuffer src/`).

**Verified real write/query behavior live** against a disposable scratch namespace
(`archivist-scratch-probe`, deleted afterward via `deleteAll()`), using the real `@turbopuffer/turbopuffer`
SDK and the maintainer's real credentials:

- `distance_metric` **must** be passed on every write once the namespace has any vector-producing
  attribute — including `search_text`'s auto-embedded vector, which isn't something we ourselves
  supply. Omitting it fails with `"distance_metric must be specified for write to namespace with a
vector"`. Not mentioned anywhere in `docs/architecture.md` or the existing schema file's
  comments. `cosine_distance` is the conventional choice for text embeddings.
- The namespace and its schema are created implicitly by the first `write()` call that includes a
  `schema` param — no separate "create namespace" step exists or is needed. The existing comment
  in `turbopuffer-schema.ts` ("The first write creates the namespace schema") already reflected
  this correctly.
- `null` attribute values (e.g. `title: null`) are accepted without error and stored as if the
  attribute were absent — confirmed by writing one document with an explicit `null` and one with
  the same keys omitted entirely, then querying both back; neither surfaced the field. This means
  `SearchDocument`'s `string | null` fields can be sent to Turbopuffer as-is, no stripping needed.
- `Row` (`upsert_rows` array entries) has no separate `attributes` wrapper — `{ id, ...attributes }`
  flat, which is exactly `SearchDocument`'s shape already (`id` + the same attribute names as the
  schema). No mapping function needed between the two; `SearchDocument[]` can be passed as
  `upsert_rows` directly.
- Per Turbopuffer's docs (`https://turbopuffer.com/docs/write`, fetched live): write payloads can
  be up to 512MB and large batches are encouraged — no hard row-count ceiling documented for
  plain writes. **Correction, found by actually running the real sync**: the _native-embedding_
  path has its own, separate, account-tier-dependent batch cap — a real 500-document batch against
  the maintainer's account was rejected with `"cowardly refusing to embed a large batch of
documents(500). your batch limit is currently 256, please reach out to us about raising it"`.
  This has nothing to do with the 512MB payload ceiling; it's specific to `embed`-configured
  attributes like `search_text`. Lowered `DEFAULT_BATCH_SIZE` from the original 500 to 200 (some
  headroom below the observed 256, since that cap is described as account-specific and could
  differ per tier/region). Nothing was written before this was caught — the very first batch of
  the real sync failed outright, so there's no partial-write cleanup to worry about.
- The client's injected `fetch` receives `(urlString, init)` with a JSON string body — a different
  calling convention from `@aredotna/sdk`, which passes a `Request` object. Verified with a probe
  before writing tests, to avoid guessing at the mock shape.
- The client-_construction_-level `maxRetries` option has **no effect on `write()`'s retry count**
  — verified by probing `maxRetries: undefined/0/1` against a mock that always 500s: exactly 7
  calls every time. **Correction (caught in review):** this isn't an independent backpressure retry
  loop as first assumed — `Namespace.write()` simply hardcodes `maxRetries: 6` on its own request
  call (`resources/namespaces.js`: `this._client.post(..., { body, maxRetries: 6, ...options })`),
  shadowing the client-level default via the same generic HTTP retry mechanism every endpoint uses
  (408/409/429/5xx, exponential backoff, `Retry-After`-aware). A per-call override is possible —
  `namespace.write(params, { maxRetries: N })` — just not something `upsertSearchDocuments` exposes
  today. Still not adding a `TurbopufferConfig.maxRetries` passthrough for V1: 7 attempts with a
  sensible built-in backoff is a reasonable default for a batch job, and there's no evidence yet
  that it needs tuning. Tests needing a deterministic single-attempt failure use a 400 (not
  auto-retried, per the SDK's own retry table) rather than fighting the hardcoded 6 retries.

## Plan

**`src/lib/server/search/turbopuffer-schema.ts`** — add `archiveDistanceMetric = 'cosine_distance'`
export alongside the existing schema, since both the write path (here) and the future ANN query
path (`SearchRepository` TODO) need the same value — a namespace's distance metric is fixed at
creation, so keeping it next to the schema it belongs to avoids the two ever drifting apart.

**`src/lib/server/search/turbopuffer-client.ts`** (new) — `upsertSearchDocuments(documents, config, options)`:

- `TurbopufferConfig = { apiKey, region, namespace, fetchFn? }` — explicit constructor args, not
  `$env`, matching `ArenaClient`'s established pattern (portable between the SvelteKit app and this
  plain script, testable).
- Chunks `documents` into batches (default 500) and calls `namespace.write({ schema, distance_metric,
upsert_rows: batch })` per batch — `schema`/`distance_metric` included on every batch, not just
  the first, since Turbopuffer requires them whenever the namespace has a vector attribute and
  there's no cost to repeating an idempotent schema declaration.
- No per-batch failure isolation (unlike the sync command's per-channel isolation): every batch
  targets the same namespace, so a failure is almost certainly systemic (auth, quota, a schema
  conflict), not specific to one batch's documents — isolating it would just mean silently losing
  part of the archive from the index instead of surfacing the real problem.
- Returns `{ batches, rowsUpserted }` for the caller to report.

**`src/lib/server/indexing/sync.ts`** — extend `syncArchive`:

- `SyncOptions.turbopuffer: TurbopufferConfig` becomes required (this is what completes the Sync
  lifecycle the previous task explicitly deferred; no other caller depends on the old "no
  Turbopuffer" shape).
- After the existing dedup step, map deduped `ArchiveBlock[]` through `toSearchDocument` (already
  existed, unchanged) and call `upsertSearchDocuments`. Add `documentsUpserted`/`upsertBatches` to
  `SyncSummary`.
- Deliberately not isolated in a try/catch the way per-channel failures are — a Turbopuffer failure
  should fail the whole sync loudly, not get folded into `channelsFailed`, which is specifically
  about "this one of ~100 Are.na channels had a problem," a different kind of failure.

**`scripts/sync.ts`** — read `TURBOPUFFER_API_KEY`/`TURBOPUFFER_REGION` (fail explicitly if either
is missing, matching the existing `ARENA_ACCESS_TOKEN` check) and `TURBOPUFFER_NAMESPACE` (default
`arena-blocks-v1`, matching `.env.example` and `docs/architecture.md`). Print the upsert count/
batches in the final summary.

**Not doing in this task**:

- The `SearchRepository`/query side (browse/lexical/semantic/hybrid) — a separate TODO, already
  scaffolded in `contracts.ts`.
- Running the real, full upsert against the maintainer's production `arena-blocks-v1` namespace as
  part of implementing this. Verified the write mechanics live against a disposable scratch
  namespace instead (see Investigation) — a real production upsert writes real, billed data to
  their account, which is their call to trigger (`bun run sync`), not something to do unprompted
  while building the feature. Matches how the previous task treated the real 104-channel Are.na
  sync (unit tests for correctness; left the real run to the maintainer).

## Review

Spawning a fresh-context review before handoff — Data/Sync Expert (Turbopuffer write correctness,
batching/idempotency, `SyncOptions` becoming a required-turbopuffer breaking change) and Systems
Architect (`search/` vs `indexing/` boundary for the new client — is the write adapter correctly
homed in `search/` alongside the schema, with orchestration staying in `indexing/`).

## Implementation notes

Fresh-context Data/Sync Expert + Systems Architect review. Verdict: no P0/P1, two P2s fixed:

- **P2** — `CHANGELOG.md`'s existing `bun run sync` entry still said "does not yet persist
  anything to Turbopuffer... that's next," which this task makes false. Updated the entry in
  place (not a new one) to describe the new persist-and-idempotent-reupsert behavior and the two
  new required env vars.
- **P2** — the multi-batch test asserted row counts per batch but never checked that `schema`/
  `distance_metric` are sent on the _second_ batch, not just the first (trivially covered by the
  single-batch test) — exactly the kind of accidental "only the first write needs schema"
  regression that could ship unnoticed. Added the assertion.
- **P3** — the worksheet's own theory that `write()` has an independent "backpressure retry loop"
  was wrong; the reviewer traced it to the vendored SDK source and found `Namespace.write()`
  simply hardcodes `maxRetries: 6` per call, shadowing the client-level default through the same
  generic HTTP retry path every endpoint uses. No code changed (not exposing a `maxRetries`
  passthrough was still the right call), but corrected the Investigation section above so this
  doesn't propagate a wrong mental model to a future reader.
- **P3** (accepted, fixed) — added optional per-batch progress logging to `upsertSearchDocuments`
  (`log` in its `options`), wired from `syncArchive`'s existing `log`. Without it, a mid-run batch
  failure gave zero indication of how many documents were already durably (and billably) written
  before the failure — a real gap against "fail explicitly" for an operation with real cost per
  write, even though idempotent re-sync makes it safe to just run again.
- Confirmed via the review (not just this worksheet's own claims): schema fidelity vs.
  `docs/architecture.md`'s table, `SearchDocument`↔`Row` field-for-field compatibility (including
  datetime-as-ISO-string), idempotency reasoning, the failure-isolation call path (Turbopuffer
  errors genuinely propagate uncaught, not folded into `channelsFailed`), the `search/` vs
  `indexing/` boundary, and that no `SyncOptions` call site was missed when `turbopuffer` became
  required.

### Final state

- `bun run check`: 0 errors.
- `bun run lint`: clean.
- `bun run test`: 70/70 passing (6 files).
- `bun run build`: succeeds.
- Real write/query mechanics verified live against a disposable scratch namespace (see
  Investigation); the real production upsert against `arena-blocks-v1` was deliberately left for
  the maintainer to trigger via `bun run sync` themselves, not run as part of implementing this.
