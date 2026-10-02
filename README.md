# Archivist

A fast, public search engine and gallery for a personal [Are.na](https://www.are.na) archive.

Are.na is good at collecting and bad at finding. Archivist syncs every channel you own into
[Turbopuffer](https://turbopuffer.com) and puts lexical, semantic and hybrid search over it — and
has a vision model describe each image so you can find a block by what it _looks like_, not just by
whatever filename it arrived with.

That last part matters more than it sounds. In the archive this was built for, 915 image blocks had
906 titles — and almost all of them looked like `cleanshot-2025-02-28-at-17.36.56.png`. Roughly a
third of the archive was unfindable. After indexing generated descriptions, a query like
"macOS Time Machine restore with receding stacked windows" returns the right block at rank 1.

**This indexes _your own_ Are.na account.** The sync resolves whoever owns the access token and
syncs every channel that user owns. Run it and you get your archive, not anyone else's.

---

## What you need

|                                                  | Why                                                 | Cost                                |
| ------------------------------------------------ | --------------------------------------------------- | ----------------------------------- |
| [Bun](https://bun.sh) 1.4+                       | runtime and package manager                         | free                                |
| [ffmpeg](https://ffmpeg.org) on PATH             | reads animations and measures colour                | free                                |
| An Are.na account                                | the source of truth (read + write token; see below) | free tier is fine                   |
| A [Turbopuffer](https://turbopuffer.com) account | search index + embeddings                           | free tier covers a personal archive |
| An [OpenRouter](https://openrouter.ai) account   | vision descriptions — skip with `--no-vision`       | ~$0.50 for 2,600 images             |
| A [Cloudflare](https://cloudflare.com) account   | deploying the public site — **optional**            | free tier is fine                   |

You can run everything locally without Cloudflare. `bun run sync --no-vision --no-push-arena --no-colour`
is the metadata-only sync: no OpenRouter account, no ffmpeg, and a read-only Are.na token is enough.

## Setup

```bash
git clone <your-fork> && cd archivist
bun install
cp .env.example .env
```

Fill in `.env`:

```bash
ARENA_ACCESS_TOKEN=          # dev.are.na -> your application -> personal access token (read + write)
TURBOPUFFER_API_KEY=
TURBOPUFFER_REGION=          # e.g. gcp-us-central1, from your Turbopuffer dashboard
TURBOPUFFER_NAMESPACE=arena-blocks-v1

ARENA_IGNORE_CHANNELS=       # comma-separated slugs to skip
ARENA_ALLOW_PRIVATE_CHANNELS= # private channels are skipped unless listed here

OPENROUTER_API_KEY=          # needed unless you pass --no-vision
```

**Are.na token scope.** A plain `bun run sync` writes generated titles and descriptions back to
Are.na, so `ARENA_ACCESS_TOKEN` needs **read + write** scope — see
[the gotcha below](#gotcha-a-read-only-token-cannot-write-back). With a read-only token, pass
`--no-push-arena`.

Private channels are excluded by default, so nothing private is published by accident — you have to
name a channel explicitly to include it.

## First run

```bash
bun run sync          # fetch your archive, describe it, write titles back, and index it
bun run dev           # http://localhost:5173
```

A plain `bun run sync` does everything: it describes every block with an image, writes generated
titles and descriptions back to Are.na where they are missing, and indexes the result. Read the
sections below before the first run — vision costs money and write-back changes your archive. Three
opt-outs:

```bash
bun run sync --no-vision          # skip the vision stage; index whatever the cache already holds
bun run sync --no-push-arena      # never write to Are.na
bun run sync --no-colour          # skip measuring colour; index whatever the colour cache holds
```

Unknown flags are rejected rather than ignored, because a mistyped opt-out would otherwise run the
stage anyway. The sync is idempotent: run it again whenever your archive changes and it will upsert
what is new and prune what is gone.

The first run with vision takes hours; with `--no-vision` it takes a few minutes, mostly paced
Are.na requests.

## Vision descriptions

On by default, and the most useful thing this project does. There is no cost preview, so work out
the bill before the first run: roughly one model call per block with an image.

For a ~2,600-block archive expect **about $0.50** and a few hours. It is safe to interrupt: results
are checkpointed every 25 descriptions, and re-running skips everything already done **before
making any network call**, so a resumed run costs nothing for work already paid for.

Results land in `src/lib/server/indexing/vision-cache.jsonl`, which is committed on purpose. It is
the expensive artifact — keeping it in the repo means a teammate, a fresh clone or a rebuilt search
index costs nothing to restore.

A block is only ever described again if its image changed, you bump `PROMPT_VERSION`, you switch
models, or the way it is read changes (see animations below). To redo one block by hand, delete its
line from the cache file.

#### Animations are read as motion, not as one frame

Are.na keeps animated GIFs on a CDN that publishes no smaller version. Many are over the
provider's 5 MB limit, and a single still is not a useful reading of an animation anyway.

So animated blocks are transcoded locally with **ffmpeg** to a small MP4 first and sent as video.
A 24.2 MB GIF becomes a 145 KB clip in about half a second, which both fits comfortably and lets
the model see what actually happens:

> "A side-view depiction of a male runner… Overlaid on the scene is a semi-transparent, dark-themed
> user interface simulating a heads-up display."

Downloads are temporary: each animation is fetched to a scratch directory, the source is deleted as
soon as ffmpeg has read it, and the directory is removed whether the transcode succeeds, is rejected
for size, or fails. A run that is killed outright cannot clean up after itself, so the next run that
has animations to describe sweeps anything it left behind (once it is an hour old) before it starts
on them. Nothing is written to the repository.

ffmpeg must be on PATH. Without it every animated block is reported as failed, with a message
naming ffmpeg, while the rest of the run carries on; pass `--no-vision` to skip the stage.
Animations cost roughly twice an image (~$0.0005 each) and take longer, since the source is
downloaded before it is transcoded.

### Writing the descriptions back to Are.na

Also on by default, and the only thing here that modifies your actual archive. Pass
`--no-push-arena` to skip it:

```bash
bun run sync --no-push-arena
```

There is no preview and no cap: a plain `bun run sync` writes to every eligible block as soon as the
vision stage has produced something for it, so be sure before you run it. The summary's `skipped`
line accounts for the rest of your archive, so the numbers should reconcile against your block
count.

It replaces titles that carry no information — filenames, hashes, bare URLs, and the platform
boilerplate you get from a shared post (`Seth Thompson on X: "…" / X`, where the title is a
250-character copy of the description) — and adds titles and descriptions where there are none.

It will **not** touch a title that says something real, however long, and it will **never**
overwrite a description you wrote. Blocks authored by other people are skipped automatically:
Are.na only allows a block's author to update it.

There is no undo. Your original titles exist only in Are.na until they are replaced, so export them
first if that matters to you.

#### Gotcha: a read-only token cannot write back

This is the one thing most likely to waste your time, because everything _else_ in the project works
fine with a read-only token, so you may well have one.

`ARENA_ACCESS_TOKEN` needs **read + write** scope unless you pass `--no-push-arena`. Create a
personal access token with both at [dev.are.na](https://dev.are.na) and put it in `.env`. Nothing
else in the project exercises the write scope.

With a read-only token every update is rejected. The write-back stops after five consecutive
failures and the sync fails with this message, before anything is indexed:

```
Sync failed: Aborting Are.na write-back: the first 5 writes all failed (most recently block
36703616: Are.na request failed with status 401 updating block 36703616). This usually means
ARENA_ACCESS_TOKEN is read-only — writing titles and descriptions needs write scope (use a read +
write token, or pass --no-push-arena) — not that these blocks are individually broken.
```

Always read the summary line rather than assuming success — it reports what was written against what
was planned:

```
Are.na written:      5 of 5 planned block(s)     ← worked
Are.na written:      0 of 5 planned block(s)     ← wrote nothing; see FAILED below it
```

To confirm independently, open one of the blocks the diff listed and check its title actually
changed. `updated_at` on the block is the giveaway.

#### If some blocks come back rate limited

Are.na allows 120 requests per minute on a free account, so writes are paced at 500ms and a block
that gets rate limited waits out the delay Are.na asks for before being recorded as failed. If any
still fail, just run the command again — write-back re-plans from your archive's current state, so
blocks already written are simply "already fine" and skipped, and only the failures are retried.

## Colour

The sync measures how much of each image is each colour, so the archive can be filtered by colour
(`?colour=blue`, or several for blocks with all of them). It costs nothing but downloads: each
image is fetched as a 128px copy (an animated GIF as its original, sampled once a second), piped
through ffmpeg in memory and thrown away. Nothing is written to disk.

The colours are red, orange, yellow, green, blue, purple, pink, brown, grey, black, white and
`mono` (black and white: almost no colour at all). Browsing with a colour lists the most strongly
coloured blocks first; with a search term, relevance keeps the order and colour only filters.

Results land in `src/lib/server/indexing/colour-cache.jsonl`, committed like the vision cache, so
only new or changed images are fetched again. `bun run calibrate:colour` writes a contact sheet of
a sample, read-only, for judging the colour boundaries and thresholds by eye.

## Commands

| Command                        | What it does                                            |
| ------------------------------ | ------------------------------------------------------- |
| `bun run dev`                  | local dev server                                        |
| `bun run preview`              | run the built Worker locally with wrangler              |
| `bun run sync`                 | fetch Are.na, describe images, write titles back, index |
| `bun run sync --no-vision`     | skip the vision stage; index the existing cache as-is   |
| `bun run sync --no-push-arena` | do not write generated titles back to Are.na            |
| `bun run sync --no-colour`     | skip measuring colour; index the existing cache as-is   |
| `bun run evaluate:search`      | run the search evaluation against your index            |
| `bun run calibrate:colour`     | write a contact sheet of measured colours, read-only    |
| `bun run check`                | generate types, then typecheck `src/` and `scripts/`    |
| `bun run lint`                 | prettier + eslint                                       |
| `bun run format`               | prettier, writing changes                               |
| `bun run test`                 | vitest                                                  |
| `bun run build`                | production build                                        |

Run `check`, `lint`, `test` and `build` before opening a pull request.

### A note on `evaluate:search`

The fixture in `scripts/fixtures/search-cases.json` asserts specific Are.na **block IDs from the
original author's archive**, so against your own archive every case will fail. That is expected.
Either replace the fixture with blocks from your archive, or ignore the command. The harness itself
is generic — it reports the rank of each expected block within the first page of 24 results, which
is what makes it possible to tell whether a change improved retrieval or quietly buried something.
A case with a `pending` reason records a target the index cannot meet yet: its failure does not fail
the run, and the run tells you when it starts passing.

## Deploying

The app targets Cloudflare Workers via `@sveltejs/adapter-cloudflare`.

```bash
bun run build
bunx wrangler deploy
```

Set the runtime secrets on the Worker — **not** your Are.na or OpenRouter keys, which the deployed
site never needs:

```bash
bunx wrangler secret put TURBOPUFFER_API_KEY
bunx wrangler secret put TURBOPUFFER_REGION
bunx wrangler secret put TURBOPUFFER_NAMESPACE
```

`wrangler.jsonc` already configures a 60-requests-per-minute rate limiter and observability with
query strings redacted.

## How it works

```
Are.na V3  ──►  sync (manual, local)  ──►  Turbopuffer  ──►  SvelteKit on Cloudflare
                      │
                      ├─ normalize + dedupe blocks across channels
                      ├─ measure how much of each image is each colour
                      ├─ vision model describes each image
                      ├─ writes generated titles back to Are.na
                      └─ prune blocks that left the archive
```

- **Sync is manual and local.** A visitor's search never calls Are.na, and your tokens never reach
  the browser.
- **One canonical text field.** `search_text` concatenates the block's own title, description,
  content, source title and channel titles, then any generated description, OCR and tags. It feeds
  both BM25 and the native embedding.
- **Hybrid search** is a single Turbopuffer `multiQuery` with BM25 + ANN fused by reciprocal rank.
- **Results are always original Are.na blocks.** Nothing generated is presented as a result; the
  generated text is a retrieval signal that helps the real block surface. The one exception is
  write-back: a title it writes to Are.na becomes the block's own, and shows on the next sync.

## Known limits

- **Animated blocks need ffmpeg.** Without it they fail to be described, and are retried on the next
  run once it is installed. An animation that still comes out over 4 MB after transcoding is skipped.
- **Colour is share of the image, not prominence.** A small red logo on a white page scores low
  for red, and skin in flash photographs counts towards red. Blocks without an image never match
  a colour.
- **`vision_medium` is unreliable.** A grainy photograph came back labelled `painting`. It is
  stored but nothing depends on it — don't build a facet on it without measuring first.
- **Generated descriptions are capped at 500 characters** so they cannot drown out a block's own
  description in the index. Measured: the two evaluation cases most at risk held rank exactly.
- **The Are.na sync auto-discovers every channel you own.** There is no allowlist to review per
  run. See the Acceptable Use discussion in [docs/architecture.md](docs/architecture.md).

## Documentation

| Document                                               | What's in it                                                      |
| ------------------------------------------------------ | ----------------------------------------------------------------- |
| [AGENTS.md](AGENTS.md)                                 | the implementation contract, shared by Claude Code and Codex      |
| [docs/architecture.md](docs/architecture.md)           | data model, Turbopuffer schema, retrieval, sync lifecycle, vision |
| [docs/svelte-guidelines.md](docs/svelte-guidelines.md) | Svelte 5 and SvelteKit conventions for this repo                  |
| [docs/workflows/](docs/workflows/)                     | agent task loop, review protocol, worktrees                       |
| [docs/specs/](docs/specs/)                             | active feature specs and in-progress worksheets                   |
| [docs/decisions/](docs/decisions/)                     | architecture decision records                                     |
| [docs/TODOS.md](docs/TODOS.md)                         | current backlog                                                   |
| [docs/CHANGELOG.md](docs/CHANGELOG.md)                 | user-visible changes                                              |

## License

[MIT](LICENSE).
