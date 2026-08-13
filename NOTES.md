# Project notes

## Re-entry

- **Phase:** 4 — Enrichment and attribution triage (complete 2026-08-13)
- **Last state:** KCLS MARC enrichment, per-field provenance and precedence, tri-state
  multi-reader attribution, explainable evidence, checkout/work overrides, browser triage, and
  rebuild propagation are implemented. Phase 3's personal live-card acceptance run is still
  pending a user-owned authenticated session.
- **Next action:** Begin Phase 5 acquisition episodes and ratings after running the personal
  import/enrichment workflow and reviewing the resulting queues.
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

Phase 4 result: MARC fixtures cover audience, juvenile headings, genre/form, contributors,
pages, call number, summary, and series. Tests prove deterministic fact precedence, conservative
tri-state rules, multi-reader work overrides, checkout precedence, idempotent enrichment, and
immutable source observations.
