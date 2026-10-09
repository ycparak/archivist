# Free search migration investigation worksheet

Request: investigate replacing Turbopuffer with a free architecture. User clarified that semantic search must remain.

Reviewed: AGENTS, TODOs, architecture, agent loop/review, search repository/contracts/config/execute, sync output stage, evaluation fixture, package and Wrangler configuration, committed cache counts (no raw content exported). Checked current official MiniSearch, Cloudflare D1/Workers/Vectorize/Workers AI, SQLite FTS5, Pagefind and Transformers.js/model documentation. Context7 tools were unavailable; used primary web documentation instead.

Plan: compare architectures, verify free limits and behavior gaps, write a proposal with migration and benchmark gates. No implementation, live sync or deployment authorized by this investigation.

Result: [proposal](../../specs/free-search-migration.md) recommends browser MiniSearch and exact static-vector search with a thin Workers AI query embedding endpoint. Fully static client embeddings are the alternative if service quotas are unacceptable. Vectorize has topK and metadata-filter limitations that conflict with existing paging and filters.

Validation: documentation formatting and diff checks. Runtime validation is not applicable to this research-only change; no benchmark or quality parity claimed. No changelog entry because product behavior is unchanged. No sync run.

Review: independent Systems Architect found no substantive findings. Clarified endpoint model compatibility for retained releases and explicit rate-limit route integration. Remaining gates are semantic quality, mobile performance and acceptance of client-rendered query URLs/API changes.
