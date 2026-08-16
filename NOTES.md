# Project notes

## Re-entry

- **Phase:** Audit remediation, Increment 1 — Accessibility and copy (complete 2026-08-16)
- **Last state:** The production PWA is complete, and the local workflow now has a unified
  `pnpm bookshelf` CLI for setup/login, one-command sync, status, recommendation refresh, and
  encrypted PWA-compatible backup. Phase 3's personal live-card acceptance run remains pending a
  user-owned authenticated session. The UX audit's findings are now encoded as executable tests;
  see `tests/browser/README.md`. Finding IDs (F-01, F-04, …) refer to that audit, which is kept
  locally and is not tracked in this repository.
- **Next action:** Increment 2 — close the import loop (N1/F-01). Two annotated tests
  (`a CSV import lands every row on the bookshelf`, `a Libby snapshot lands every title`)
  turn green when it lands and will then report "Expected to fail, but passed" until their
  `test.fail()` annotations are removed. Increment 2 requires an ADR:
  _"Automatic resolution and attribution defaults in the browser composition."_
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

Phase 6 result: deterministic tests prove known/veto/juvenile/format/duration exclusions,
recency-weighted series/creator/subject/genre/trait scoring, author and subject batch caps,
separate discovery/read-again output, human-readable evidence, sequential top-set holdings, and
24-hour availability reuse. Live catalog generation remains local-runtime-only; optional services
and LLMs are absent from the complete path.

Phase 7 result: generic CSV and manual/ISBN workflows share the normalized provenance pipeline;
AES-256-GCM archives round-trip logical data and reject wrong passphrases without writes; the
production PWA registers a manifest/service worker and reloads offline with OPFS state intact.
CI scans source and emitted assets for forbidden local-only dependencies, patron/catalog hosts,
storage-state hooks, and card configuration, and validates CSP plus static isolation headers.

Post-Phase 7 accessibility result: the recurring local workflow is reduced from five internal
package commands to `pnpm bookshelf sync`. Interactive setup stores versioned non-secret config,
login saves its authenticated state only under the ignored `secrets/` directory, status exposes
freshness and review counts, and backup writes an encrypted archive compatible with the PWA.

Increment 0 result: the audit's largest findings are now executable. Eighteen Chromium tests:
nine contract tests that are green today, eight annotated safety-net tests carrying `test.fail()`
with the finding and the increment that closes it, and one skipped placeholder for the search
budget, which has nothing to measure until Increment 6 introduces a query surface. The suite asserts
that every input path reaches the bookshelf (F-01), holds the Tier 3 budgets at 500 and 1000 books
(F-04), and covers focus styles, trait-chip state, the 24x24 px target floor, and 320 px reflow
(F-07, F-08, F-09, F-10). axe-core runs on the first-run screen and on a populated shelf and is
green today, which is itself the finding: axe cannot detect missing focus styles, missing
`aria-pressed` on a toggle, or non-text contrast, so those four needed explicit assertions.

Measured on this machine at 1000 books: import 16.9 s (budget 10 s), add-one-more 2.4 s
(budget 500 ms), 16 144 DOM nodes (budget 2000), 230 963 px document (budget 20 000). The node
and pixel counts are hardware-independent, so the budget gate stays honest on any runner.
Every run attaches its measurements to the HTML report, which CI uploads as an artifact.

Two supporting changes: `pnpm typecheck` now also compiles `tests/tsconfig.json`, which nothing
was checking before, and the shelf section and its cards carry `data-testid` hooks so these
locators survive Increment 4's rewrite of `main.tsx`.

Increment 1 result: ships N7, N10, N11, N12 and X9. Thirty Chromium tests, twenty-nine green;
only the two F-01 journey tests and the two F-04 budget tests remain annotated. Four Increment 0
annotations were removed after the work made them pass.

- N7 (F-07/08/09/10/16): a global `:focus-visible` ring, plus `:focus-within` on the file-button
  labels whose real input is a hidden 1px box. 44px primary targets and a 24px floor. Trait chips
  expose `aria-pressed`; rating buttons carry names like "Child engagement: 3 of 3 - loved it".
  Component borders moved to #8a8072 (3.82:1) and #5f7d6d (4.45:1), both verified against the
  3:1 requirement rather than eyeballed. The floated-`legend` rating layout became a wrapping
  flex row under `role="group"`, which is what removed the 320px overflow; `.shelf-grid` also
  needed `minmax(min(300px, 100%), 1fr)` to stop forcing a 300px column into a 288px viewport.
- N10 (F-06): errors carry an operation discriminator, so a mistyped passphrase no longer reports
  that a Libby file is invalid. Six distinct headlines, five with a recovery action. Zod paths are
  translated: `0.title.text` is now "Entry 1: the title is missing or invalid."
- N11 (F-12): ratings start unset instead of defaulting to 2, and Save is disabled until something
  changes. The storage layer already persisted NULL, so only the UI and the worker protocol needed
  to admit the state.
- N12 (F-13): the reading model carries `sourceKind` per checkout and `sourceKinds` per shelf work.
  Only library kinds appear under "Checkout observations", acquisition episodes are shown only when
  a real checkout produced them, and each shelf card names its provenance.
- X9 (F-17): raster 192/512/maskable icons, an apple-touch-icon, screenshots for both form factors,
  a stable id, `display_override`, and one working "Add a book" shortcut. Assets are generated by
  `node scripts/generate-pwa-assets.mjs` from the SVG and the running app, so they can be
  regenerated rather than hand-maintained. "Scan a book" is deliberately absent until Increment 8.

Bug found while doing this, not in the audit: the PWA sent both `importRecordId` and `workId` on
every attribution correction, but `attribution_overrides` has a CHECK constraint permitting exactly
one target per scope. Every correction in Attribution review failed with SQLITE_CONSTRAINT_CHECK,
so no imported book could reach the shelf even with the two decisions F-01 describes - F-01 was
worse than measured. The old shared error headline hid it. The worker protocol is now split by
scope so the invalid shape cannot be constructed, and a regression test covers it.
