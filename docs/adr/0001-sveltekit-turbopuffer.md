# ADR 0001: SvelteKit and Turbopuffer native hybrid retrieval

**Status:** Accepted

## Context

Archivist needs a compact public gallery with server-side credentials, a manually operated ingestion path, and a portfolio-quality hybrid search story. The implementation must be small enough to complete in one short build session.

## Decision

Use SvelteKit with TypeScript and the Cloudflare Workers adapter. Use Turbopuffer’s official TypeScript SDK, native embeddings, BM25, filters, and `multiQuery` reciprocal-rank fusion. Use one canonical `search_text` field instead of a separate embedding vendor, a client-side vector index, or a second search service.

## Consequences

- The public app and typed server code live in one repository.
- V1 has one search datastore and one provider credential surface.
- Native embeddings make semantic retrieval easy to demonstrate, but schema/model changes require a versioned namespace migration.
- Mastra remains a V2 dependency so V1 does not become an agent project before it becomes a reliable search product.
