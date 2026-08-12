# Project notes

## Re-entry

- **Phase:** 0 — Foundation and feasibility (complete 2026-08-12)
- **Last state:** The workspace, CI, ADRs, synthetic fixtures, portable migration, repository
  contract, native SQLite adapter, and SQLite-WASM/OPFS adapter are implemented. Native
  conformance and Chromium close/reopen persistence tests pass.
- **Next action:** Begin Phase 1 by defining the import inbox schema and Libby snapshot
  validation boundary before adding UI.
- **Source plan:** Obsidian `Efforts/Read It Again.md`
- **Important constraint:** KCLS OpenSearch did not return CORS permission headers on
  2026-08-12. Browser-only catalog access is not currently viable.

## Verification

- `pnpm format:check`
- `pnpm lint`
- `pnpm typecheck`
- `pnpm test:unit` — native SQLite contract and strict constraint tests
- `pnpm test:browser` — SQLite-WASM/OPFS migration, repository contract, and persistence
- `pnpm build`
