# Project notes

## Re-entry

- **Phase:** 2 — Record-resolution vertical slice (complete 2026-08-12)
- **Last state:** Canonical normalization, explainable candidate scoring, work/edition identity,
  immutable resolution decisions, persistent resolution and HTTP caches, and audited merge,
  split, and re-point operations are implemented. The local CLI imports Libby JSON and queries
  KCLS sequentially with delay/backoff; the browser renders a human resolution queue with
  accept, manual, reject, and defer actions. Live OpenSearch shape was verified against KCLS.
- **Next action:** Begin Phase 3 with the saved-HTML BiblioCommons parser and selector-contract
  fixtures before adding authenticated Playwright acquisition.
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

Phase 2 result: normalization and a first golden scoring case are locked in; exact ISBN
resolution, crowded-field quarantine, resolution-cache reuse, KCLS response caching/backoff,
human/manual decisions, and audited merge/split/re-point operations have deterministic tests.
A synthetic native vertical slice made three courteous live KCLS requests and left fictional
zero-hit titles pending. A real “Gruffalo” probe verified repeated Atom IDs and Dublin Core
identifier parsing.
