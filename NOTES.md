# Project notes

## Re-entry

- **Phase:** 5 — Reading model and ratings (complete 2026-08-13)
- **Last state:** Configurable acquisition-episode clustering, recurrence weighting, explicit
  reading sessions, fast work/reader assessments, read-aloud traits, preference rebuilding, and
  three-way UI separation are implemented. Phase 3's personal live-card acceptance run remains
  pending a user-owned authenticated session.
- **Next action:** Run the personal workflow and begin Phase 6 deterministic KCLS recommendations.
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

Phase 5 result: tests lock seven-day merging, 8–89-day reduced-weight near repeats, 90+-day
strong recurrence, configurable/idempotent rebuilding, confirmed session participants and
context, two-dial assessments, request-by-name, veto, duration, and all seven read-aloud traits.
Attribution correction tests prove episode and preference projections rebuild immediately.
