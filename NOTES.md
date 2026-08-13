# Project notes

## Re-entry

- **Phase:** 3 — Physical history and deterministic attribution (implementation complete
  2026-08-12; personal live-card run pending)
- **Last state:** Strict saved-HTML parsing, selector-contract tests, isolated Playwright card
  sessions, exhaustive pagination, explicit acquisition failures, versioned physical source
  keys, exclusive child-card configuration, immutable attribution decisions, and reader-shelf
  queries are implemented. The local-only dependency boundary keeps credentialed acquisition
  out of the PWA. A fixture vertical slice reaches the child's shelf and reruns idempotently.
- **Next action:** Run the importer with the household's authenticated child-card storage state,
  review its resolution queue, and then begin Phase 4 attribution rules and triage.
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

Phase 3 result: strict BiblioCommons HTML parsing and the complete physical import → resolution
→ exclusive-card attribution → reader-shelf path are covered. Playwright tests prove isolated
card contexts, pagination to exhaustion, and login failure classification. A personal live-card
run is intentionally not performed without a user-owned authenticated session.
