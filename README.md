# Archivist

A fast, public search engine and gallery for a personal [Are.na](https://www.are.na) archive.

Are.na is good at collecting and bad at finding. Archivist syncs every channel you own into
[Turbopuffer](https://turbopuffer.com) and puts lexical, semantic and hybrid search over it — and,
optionally, has a vision model describe each image so you can find a block by what it _looks like_,
not just by whatever filename it arrived with.

That last part matters more than it sounds. In the archive this was built for, 915 image blocks had
906 titles — and almost all of them looked like `cleanshot-2025-02-28-at-17.36.56.png`. Roughly a
third of the archive was unfindable. After indexing generated descriptions, a query like
"macOS Time Machine restore with receding stacked windows" returns the right block at rank 1.

**This indexes _your own_ Are.na account.** The sync resolves whoever owns the access token and
syncs every channel that user owns. Run it and you get your archive, not anyone else's.

---

## What you need

|                                                  | Why                                                                | Cost                                |
| ------------------------------------------------ | ------------------------------------------------------------------ | ----------------------------------- |
| [Bun](https://bun.sh) 1.4+                       | runtime and package manager                                        | free                                |
| [ffmpeg](https://ffmpeg.org) on PATH             | transcodes animated blocks before describing them — **optional**   | free                                |
| An Are.na account                                | the source of truth (read token; read + write only for write-back) | free tier is fine                   |
| A [Turbopuffer](https://turbopuffer.com) account | search index + embeddings                                          | free tier covers a personal archive |
| An [OpenRouter](https://openrouter.ai) account   | vision descriptions — **optional**                                 | ~$0.50 for 2,600 images             |
| A [Cloudflare](https://cloudflare.com) account   | deploying the public site — **optional**                           | free tier is fine                   |

You can run everything locally without Cloudflare, and skip OpenRouter entirely if you only want
metadata search.

## Setup

```bash
git clone <your-fork> && cd archivist
bun install
cp .env.example .env
```

Fill in `.env`.

## First run

```bash
bun run sync          # fetch your archive and index it
bun run dev           # http://localhost:5173
```

The first sync takes a few minutes, mostly paced Are.na requests. It is idempotent: run it again
whenever your archive changes and it will upsert what is new and prune what is gone.

## Adding vision descriptions

Optional, and the most useful thing this project does. Preview the cost first:

```bash
bun run sync --vision-dry-run     # reports how many blocks would be described; no model calls
bun run sync --vision             # actually describes them
```

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

Are.na keeps animated GIFs on a CDN that publishes no smaller version, so the image path had to skip
anything over the provider's 5 MB limit and describe the rest from a single still. Neither is a
useful reading of an animation.

With **ffmpeg on PATH**, animated blocks are transcoded locally to a small MP4 first and sent as
video. A 24.2 MB GIF becomes a 145 KB clip in about half a second, which both fits comfortably and
lets the model see what actually happens:

> "A side-view depiction of a male runner… Overlaid on the scene is a semi-transparent, dark-themed
> user interface simulating a heads-up display."

Downloads are temporary: each animation is fetched to a scratch directory, the source is deleted as
soon as ffmpeg has read it, and the directory is removed whether the transcode succeeds, is rejected
for size, or fails. A run that is killed outright cannot clean up after itself, so the next run
sweeps anything it left behind (once it is an hour old) before it starts. Nothing is written to the
repository.

This is on by default. Without ffmpeg every animated block is reported as failed, with a message
naming ffmpeg, while the rest of the run carries on; pass `--no-vision-video` to fall back to
single-frame stills instead. Animations cost roughly twice an
image (~$0.0005 each) and take longer, since the source is downloaded before it is transcoded.

### Writing the descriptions back to Are.na

Also optional, and the only thing here that modifies your actual archive:

```bash
bun run sync --push-arena-apply
```

There is no preview and no cap: it writes to every eligible block as soon as it runs, so be sure
before you start. The summary's `skipped` line accounts for the rest of your archive, so the numbers
should reconcile against your block count.

It replaces titles that carry no information — filenames, hashes, bare URLs, and the platform
boilerplate you get from a shared post (`Seth Thompson on X: "…" / X`, where the title is a
250-character copy of the description) — and adds descriptions where there are none.

It will **not** touch a title that says something real, however long, and it will **never**
overwrite a description you wrote. Blocks authored by other people are skipped automatically:
Are.na only allows a block's author to update it.

There is no undo. Your original titles exist only in Are.na until they are replaced, so export them
first if that matters to you.

#### Gotcha: a read-only token cannot write back

This is the one thing most likely to waste your time, because everything _else_ in the project works
fine with a read-only token, so you will probably have one.

`ARENA_ACCESS_TOKEN` needs **read + write** scope for `--push-arena-apply`. Create a personal access
token with both at [dev.are.na](https://dev.are.na) and put it in `.env`. The rest of the project
never exercises the write scope.

With a read-only token every update is rejected. The run now stops after five consecutive failures
and says so:

```
Aborting Are.na write-back: the first 5 writes all failed (most recently block 36703616:
Are.na request failed with status 401 updating block 36703616). This usually means
ARENA_ACCESS_TOKEN is read-only — writing titles and descriptions needs write scope.
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

## Commands

| Command                           | What it does                                               |
| --------------------------------- | ---------------------------------------------------------- |
| `bun run dev`                     | local dev server                                           |
| `bun run preview`                 | run the built Worker locally with wrangler                 |
| `bun run sync`                    | fetch Are.na, index into Turbopuffer, prune what is gone   |
| `bun run sync --vision`           | also generate descriptions for blocks with images          |
| `bun run sync --vision-dry-run`   | report what vision would cost; makes no model calls        |
| `bun run sync --no-vision-video`  | describe animations from one frame instead of transcoding  |
| `bun run sync --push-arena-apply` | write generated titles back to Are.na (read + write token) |
| `bun run evaluate:search`         | run the search evaluation against your index               |
| `bun run check`                   | generate types, then typecheck                             |
| `bun run lint`                    | prettier + eslint                                          |
| `bun run format`                  | prettier, writing changes                                  |
| `bun run test`                    | vitest                                                     |
| `bun run build`                   | production build                                           |

Run `check`, `lint`, `test` and `build` before opening a pull request.

### A note on `evaluate:search`

The fixture in `scripts/fixtures/search-cases.json` asserts specific Are.na **block IDs from the
original author's archive**, so against your own archive every case will fail. That is expected.
Either replace the fixture with blocks from your archive, or ignore the command. The harness itself
is generic — it reports the rank of each expected block, which is what makes it possible to tell
whether a change improved retrieval or quietly buried something.

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
                      ├─ [optional] vision model describes each image
                      └─ prune blocks that left the archive
```

- **Sync is manual and local.** A visitor's search never calls Are.na, and your tokens never reach
  the browser.
- **One canonical text field.** `search_text` concatenates the block's own title, description,
  content, source title and channel titles, then any generated description, OCR and tags. It feeds
  both BM25 and the native embedding.
- **Hybrid search** is a single Turbopuffer `multiQuery` with BM25 + ANN fused by reciprocal rank.
- **Results are always original Are.na blocks.** Nothing generated is presented as a result; the
  generated text is a retrieval signal that helps the real block surface.

## Known limits

- **Animated blocks need ffmpeg.** Without it, pass `--no-vision-video` and they fall back to a
  single frame — and any over 5 MB are skipped entirely, since Are.na publishes no smaller version.
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
| [docs/TODOS.md](docs/TODOS.md)                         | current backlog                                                   |
| [docs/CHANGELOG.md](docs/CHANGELOG.md)                 | user-visible changes                                              |
