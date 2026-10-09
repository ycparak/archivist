# Remove Turbopuffer completely

Status: accepted by explicit maintainer request, 2026-10-09.

The browser search implementation is now the only backend. Normal dev/build commands load public static snapshots; no environment switch or legacy fallback remains. Removed the provider SDK, adapters, credential configuration and provider-only tests. Sync publishes immutable search releases; evaluation and calibration use the same checked public snapshot.

This supersedes the opt-in/rollback portions of ADR 0004. The known widget-grid relevance miss and physical mobile validation remain tracked, but the maintainer explicitly chose removal now. No remote namespace deletion or deployment was performed. Private channels remain excluded even if old allow-list settings exist.
