# Product requirements document — Archivist V1

## Summary

Archivist is a Spotlight-like search and gallery for a single person’s Are.na archive. It makes a visual archive discoverable without turning it into a social product, CMS, or generic RAG demo.

## Problem

Are.na archives grow into a rich but difficult-to-recall collection of images, links, text, PDFs, and video. Browsing channels works when the person remembers where something lives; it fails when they remember an idea, phrase, material, or atmosphere instead. Existing global search cannot represent the owner’s specific archive or its channels as a coherent collection.

## Audience

- Primary: the archive owner, returning to find visual references and prior research.
- Secondary: portfolio visitors exploring the owner’s public archive.

## V1 job to be done

When I have a visual reference or an idea in mind, help me find the original relevant Are.na block quickly, then let me inspect it in its channel context or open it on Are.na.

## Goals

1. Search a manually synced archive with lexical, semantic, filtered, and hybrid retrieval.
2. Present results as a responsive visual gallery that preserves original block identity and links.
3. Make the technical choices legible in the repository without making visitors read implementation documentation.
4. Keep the first usable version realistically buildable within about six hours.

## Non-goals

- Multi-user search, accounts, or OAuth for visitors.
- Live sync, webhooks, scheduled jobs, or editing Are.na content.
- OCR, linked-page crawling, PDF extraction, generated captions, auto-tagging, clustering, or result reranking with an LLM.
- Search over content that the maintainer has not intentionally synced.
- A chat/agent experience in V1.

## User stories

| Priority | Story                                                                                                                                                                                                                           | Acceptance signal                                                                                                           |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| P0       | As a visitor, I can browse recent archive blocks as a gallery.                                                                                                                                                                  | The home page has visual cards, an empty/loading state, and links to Are.na.                                                |
| P0       | As a visitor, I can search exact words and phrases.                                                                                                                                                                             | A lexical query returns matching original blocks.                                                                           |
| P0       | As a visitor, I can search by concept.                                                                                                                                                                                          | A semantic query returns relevant blocks whose available text differs from the wording.                                     |
| P0       | As a visitor, I can search with both signals.                                                                                                                                                                                   | Hybrid is the default and combines BM25 + ANN through Turbopuffer RRF.                                                      |
| P0       | As a visitor, I can narrow results by channel, block type, and connected date.                                                                                                                                                  | Filters affect every retrieval mode and are represented in the URL.                                                         |
| P0       | As a maintainer, I can manually sync every public channel my Are.na account owns with a read-only token, with no channel list to maintain, and opt channels out (ignore list) or private channels in (allow list) via env vars. | The command logs a compact summary, discovers owned channels automatically, and resumes safely after a rate-limit response. |
| P1       | As a visitor, I can open a result’s original Are.na block and see its source/channel metadata.                                                                                                                                  | Cards use canonical block links and never fabricate archive metadata.                                                       |

## Experience

The first viewport is the working surface: search input, compact mode selector, a channel/type filter affordance, and representative cards. The gallery feels like a research desk—dense imagery, restrained metadata, and no marketing hero. Keyboard focus begins in search; query and filters use URL search parameters so views are shareable.

Search has four explicit modes for demonstration and evaluation:

- **Hybrid** (default): BM25 + semantic ANN, fused in Turbopuffer with reciprocal-rank fusion.
- **Lexical:** BM25 over canonical `search_text`.
- **Semantic:** Turbopuffer native embedding query over the same field.
- **Browse:** newest matching blocks ordered by `connected_at`, with no query required.

## Content policy

The sync stores only metadata already present on the block/channel response: title, description, plain-text block content where supplied, source title/URL, block type, public image URL, and channel membership. It does not fetch linked URLs, download files, inspect image pixels, or manufacture descriptions. This is the best V1 trade-off: it proves hybrid search while avoiding a second ingestion product.

## Success metrics

- A maintainer can set credentials, name channels, run a sync, and search real blocks without modifying code.
- The four retrieval modes visibly return results and filters constrain them correctly.
- At least 10 hand-authored evaluation queries cover exact phrase, concept, channel, block-type, and no-result cases.
- A public visitor can reach a result’s Are.na origin in one click.

## V2: Ask my Are.na

V2 adds an **Agent mode** for research-shaped questions, not a replacement for search. A Mastra agent receives a question and can call one read-only `search_archive` tool backed by the same V1 retrieval module. It returns a concise synthesis with citations to original blocks and explicit uncertainty when evidence is insufficient. Start with one agent, one tool, no long-term memory, and a bounded maximum of three retrieval calls. Mastra’s workflow, tool boundary, streaming, tracing, and evaluation hooks then become visible portfolio value without introducing an unbounded multi-agent system.

## Open configuration decisions

- Choose a public application name and a stable URL before deployment.
- Choose an open-source license before the first public push; this workspace intentionally does not assume a legal license choice.
- Select the Turbopuffer region nearest the deployment/runtime; make it an environment setting, not a hard-coded product choice.
- ~~Choose explicitly which channel slugs are indexed.~~ Reversed: V1 auto-discovers and syncs every non-ignored, non-private channel the maintainer's own Are.na account owns (private channels are skipped by default; `ARENA_IGNORE_CHANNELS` opts channels out and `ARENA_ALLOW_PRIVATE_CHANNELS` opts private ones in). Chosen for maintainer convenience over the earlier reviewable-allowlist design; see the tradeoff note in [docs/architecture.md](./architecture.md#why-this-data-access-model).
