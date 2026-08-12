# Project notes

## Re-entry

- **Phase:** 1 — Import inbox (complete 2026-08-12)
- **Last state:** The browser client validates Libby Timeline JSON, stores deduplicated raw
  snapshots and normalized observations transactionally in OPFS, reports structured schema
  errors without writes, and renders an unresolved import inbox plus audit history. Re-import
  adds an audit run but no duplicate observations.
- **Next action:** Begin Phase 2 with canonical title/author normalization fixtures and the
  resolution case/candidate/decision schema before implementing the KCLS adapter.
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

Phase 1 result: 8 unit/integration tests and 2 Chromium tests pass. The browser tests cover
valid import, idempotent re-import, structured invalid-file errors, no-write failure behavior,
and OPFS close/reopen persistence.
