# ADR: Index what images look like, not just what Are.na says about them

**Status:** Accepted

## Context

V1 search is metadata-only. [`toSearchDocument`](../../src/lib/domain/archive.ts) builds `search_text`
from exactly five sources — `title`, `description`, `content`, `sourceTitle`, and channel titles —
and that one field feeds both BM25 and the native embedding. No pixel reaches the index.
`image_alt` is stored for the gallery's `alt` attribute but deliberately excluded from retrieval.

A live audit of all 2,594 blocks in the archive shows the gap is worst exactly where images matter
most:

| Type       |     n | has title | has description | avg description |
| ---------- | ----: | --------: | --------------: | --------------: |
| Image      |   915 |       906 |          **48** |          105 ch |
| Link       | 1,577 |     1,571 |           1,494 |          130 ch |
| Attachment |    50 |        50 |              22 |          106 ch |
| Embed      |    46 |        45 |              44 |          170 ch |
| Text       |     6 |         5 |               1 |           68 ch |

Image blocks are nominally titled, but the titles are upload filenames —
`cleanshot-2025-02-28-at-17.36.56.png`, `gkjzlakwaaabkhy?format=jpg-name=large`,
`tumblr_n99eocobrf1qiz04po1_1280.jpg`, `G3AldfRbwAA80YA (1024×683)`. Roughly 900 blocks therefore
contribute pure noise to `search_text`. A visual query ("that grid of orange type specimens") cannot
succeed, because nothing describing the image exists in the corpus.

This reverses a documented decision rather than filling in an open one. [`docs/prd.md`](../prd.md)
lists "OCR … generated captions, auto-tagging" as an explicit V1 non-goal, and
[`AGENTS.md`](../../AGENTS.md) restates it in the Product Boundary. Both were written to keep V1
buildable in about six hours and to keep results strictly original Are.na content.

Three facts from the audit constrain any design, and two of them are hard external limits:

1. **Are.na block writes are owner-only.** `PUT /v3/blocks/:id` rejects blocks authored by other
   users. Of 2,594 blocks, 544 (21%) are not the maintainer's — and the skew is against us:
   **483 of 915 Image blocks (53%) were authored by other Are.na users.** The highest-value
   targets are majority unwritable.
2. **Are.na blocks carry arbitrary `metadata`** (50 keys, 32 KB, scalar values, merge semantics,
   `null` deletes), and it is returned inline on channel-contents responses — verified against the
   live API. Currently 0 of 2,594 blocks have any metadata, so the key namespace is clean.
3. **Are.na image URLs are base64-encoded sharp payloads.** Decoding
   `https://images.are.na/eyJidWNrZXQiOi…` yields
   `{"bucket":"arena_images","key":"…","edits":{"resize":{"width":1800,…}}}`. Re-encoding with
   `width: 768` returns HTTP 200 and cuts a sample image from 19 KB to 3.7 KB, so the rendition
   handed to the model is ours to choose.

## Decision

**Generate a visual description for every block with an image, fold it into `search_text`, and keep
the generated text in a committed artifact — with Are.na write-back as a scoped export, not the
system of record.**

### Reverse the non-goal, narrowly

[`docs/prd.md`](../prd.md) and [`AGENTS.md`](../../AGENTS.md) are updated in the same change to
permit machine-generated visual description and OCR of blocks the maintainer has already synced.
The rest of the boundary stands: no link crawling, no clustering, no LLM reranking at query time,
no agent UI, and results remain original Are.na blocks. The model reads images the archive already
contains; it does not reach anywhere new.

### `xiaomi/mimo-v2.5` via OpenRouter

Native omnimodal (`text+image+audio+video`), 1.05M context, $0.14/$0.28 per MTok. At roughly 850
input and 250 output tokens per block the **entire 2,585-block backfill costs about $0.49**, and an
incremental sync costs fractions of a cent. Cost is therefore not a design constraint; the
expensive failure mode is redoing work, which the cache below exists to prevent.

Two provider-routing details are load-bearing and are set explicitly rather than inherited:

- **`provider: { require_parameters: true }`.** OpenRouter fans this model out across six providers
  that do not support the same parameters. DeepInfra, StreamLake and Venice advertise
  `structured_outputs`; Xiaomi and Novita offer `response_format` only; GMICloud — the cheapest, and
  therefore the default route — supports neither. Left to default routing the pipeline would
  intermittently receive free-text prose where it expects JSON. `require_parameters` restricts
  routing to providers honouring every parameter sent.
- **Reasoning disabled.** MiMo is a reasoning model and reasoning tokens bill as completion tokens.
  This is a perception task, not a reasoning task; leaving the provider default in place would
  multiply output cost and latency for no gain.

The model is reached through an adapter in `src/lib/server/indexing/vision/`, so swapping providers
is a single-module change. OpenRouter is OpenAI-wire-compatible, so no SDK dependency is added —
`fetch` plus Zod validation at the boundary, consistent with how `src/lib/server/arena/` treats
untrusted responses.

### No orchestration framework

Neither Mastra nor trigger.dev is adopted.

- **Mastra** is an agent framework; this is a deterministic map over 2,585 items with no planning,
  no tool selection, and no branching. [`docs/prd.md`](../prd.md) reserves Mastra for the V2
  evidence-first research agent, and spending that seam on a batch job forfeits the thing it was
  reserved for. `AGENTS.md` requires that a dependency remove meaningful production code; a
  concurrency pool is roughly 40 lines.
- **trigger.dev** buys durable retries, queue concurrency, scheduling and a dashboard — all of which
  matter when sync runs unattended in the cloud. Sync is a manual local script, and the committed
  cache already makes a crashed run resumable: re-running skips completed work. It is recorded as a
  phase-2 option, to be revisited if sync moves off the maintainer's machine.

### A committed JSONL cache is the system of record

Generated output is written one line per block, sorted by block id, to
`src/lib/server/indexing/vision-cache.jsonl` (~2 MB), and committed. There is precedent:
[`channel-manifest.json`](../../src/lib/server/indexing/channel-manifest.json) is already
generated-and-committed.

The alternatives were considered and rejected:

- **Turbopuffer as the ledger.** This ADR's own schema rule requires a _new namespace_ for a
  breaking schema change. A Turbopuffer-only ledger would be destroyed by exactly the migration the
  architecture doc mandates, forcing a full paid regeneration.
- **Are.na `metadata` as the ledger.** Impossible for 21% of blocks and 53% of Image blocks
  (constraint 1). Splitting the ledger across two stores by ownership adds a branch to every read
  for no benefit.

Are.na `metadata` is still written for owned blocks as a secondary marker, because it is free,
survives a repository rewrite, and makes the provenance visible from Are.na itself.

### The skip key hashes the source, not the URL

A cache line is reused when `block_id`, `image_src_hash`, `prompt_version` and `model` all match.
`image_src_hash` is taken from the **decoded `key` field** of the Are.na image payload, not the URL
— the URL encodes the resize edits, which are ours and will change. Hashing the URL would silently
invalidate the entire cache the first time the rendition width is tuned.

### Are.na write-back is scoped by ownership and by title shape

Write-back ships, restricted to the 2,050 blocks the maintainer authored, dry-run by default.

**Amended 2026-09-21** — see "Amendment: title quality, not block type" below. The original rule
keyed off block type and exempted every Link. Measurement showed that exempted the second-largest
population of bad titles, so the rule now keys off the shape of the title itself:

| Condition (owned blocks only)                      | `title`     | `description`  |
| -------------------------------------------------- | ----------- | -------------- |
| Title is low-quality (see the four triggers below) | **replace** | write if empty |
| Title is absent                                    | **write**   | write if empty |
| Title is good                                      | leave       | write if empty |
| Any block authored by another user                 | impossible  | impossible     |

`description` is only ever written when empty. A description that exists is human or scraped prose
the maintainer chose to keep, and the archive is the source of truth for it.

### Amendment: title quality, not block type

The original rule — "replace filename-shaped titles on Image and Attachment blocks, never touch a
Link" — rested on the claim that Link titles are real scraped page metadata and therefore good.
That is true of most of them and false of a specific, large minority. A full pass over all 2,577
titled blocks found:

| Trigger                                                                             |   count |
| ----------------------------------------------------------------------------------- | ------: |
| **Filename-shaped** — media extension, CDN query junk, `(1800×1800)` suffix         |     783 |
| **Opaque token** — ≤2 words, ≥20 chars, contains digits (hashes, base64, bare URLs) |     308 |
| **Social boilerplate** — `on X:`, ` / X`, `(1) `, `- YouTube`, Instagram            |     116 |
| **Verbose and redundant** — >80 chars and restates its own description              |      70 |
| **Union (blocks with an image, so actually processable)**                           | **939** |

Plus 16 blocks with an image and no title at all.

The fourth trigger is the one that forced the amendment. 112 titles are X/Twitter-shaped and 111
titles embed the opening of their own description — nearly the same set. The canonical case:

> **title:** `Seth Thompson on X: "Searching my library is now fast enough for live searches as I type! Querying 100k paragraphs and 20k figures takes ~10-30ms. The bottleneck is now 600-800ms for multi-modal reranking... https://t.co/sm1Zo9WVyB" / X`
> **description:** `Searching my library is now fast enough for live searches as I type! …`

The title is a 250-character duplicate of the description wrapped in platform chrome. These are
`Link`, `Attachment` and `Embed` blocks, so the original rule exempted every one of them. Under the
amended rule 93 Link, 37 Attachment and 4 Embed blocks become eligible.

The intended shape is **a short descriptive title over a detailed description** — the two fields
doing different jobs, rather than the title being a truncated copy of the description.

The protection that matters is not block type, it is the trigger set being conservative. All four
were validated against the real corpus: the 939 flagged titles were reviewed and are uniformly
junk, and the longest _unflagged_ titles are all legitimate — `Vincent van Gogh | L'Arlésienne: …`,
`Screen As Room: An Architectural Perspective on User Interfaces — …`, `Subway performer stuns
crowd with Fleetwood Mac's "Landslide" …`. False negatives are acceptable; false positives are not.

A title is only replaced when a trigger fires **and** the block is owned **and** a vision result
exists for it, so the 16 Text blocks with no image are never touched.

## Consequences

- **Search quality must be measured, not assumed.** Folding ~500 characters of generated prose next
  to a 130-character human description lets the generated text dominate both BM25 and the
  embedding. This could make retrieval _worse_ for the 1,494 Link blocks that already have good
  text. [`bun run evaluate:search`](../../scripts/evaluate-search.ts) is baselined before the
  change and re-run after, with image-only cases added. If dilution shows, the mitigations are a
  tighter length cap and a separate embedded field rather than one concatenated blob.
- **`search_text` changes for every document, so every document re-embeds** on the next upsert. Sync
  already upserts all rows each run, so this is a one-time latency and Turbopuffer cost, not a new
  behavior.
- **New Turbopuffer attributes are additive** (`vision_description`, `vision_ocr`, `vision_title`,
  `vision_medium`). Adding attributes does not change an existing attribute's type, so no namespace
  version bump is required and no migration ADR follows from this one.
- **Write-back touches 2,050 blocks on Are.na and bumps their `updated_at`.** This will generate a
  large burst of activity on the maintainer's Are.na account and is visible to anyone following
  those channels. It is paced through the existing rate-limit machinery in
  [`src/lib/server/arena/client.ts`](../../src/lib/server/arena/client.ts), and it is irreversible
  without the cache — which is one more reason the cache is committed.
- **The archive gains a machine-authored layer.** Card copy in the gallery still shows Are.na's own
  title and description; generated text is a retrieval signal. Where write-back has replaced a
  filename title on Are.na, the two converge by design.
- **A new secret, `OPENROUTER_API_KEY`.** `.env.example` gains it. The existing `OPENAI_API_KEY`
  placeholder, reserved for a V2 that no longer needs it, is removed.
- **Accepting a non-Anthropic, non-vendor-official provider.** MiMo is served by third parties whose
  parameter support varies and can change. `require_parameters` plus an explicit provider order
  makes the failure loud rather than silent, and the adapter boundary keeps a swap local.
