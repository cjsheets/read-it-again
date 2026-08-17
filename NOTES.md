# Project notes

## Re-entry

- **Phase:** Audit remediation, Increment 5 — Covers and detail view (complete 2026-08-16)
- **Last state:** The production PWA is complete, and the local workflow now has a unified
  `pnpm bookshelf` CLI for setup/login, one-command sync, status, recommendation refresh, and
  encrypted PWA-compatible backup. Phase 3's personal live-card acceptance run remains pending a
  user-owned authenticated session. The UX audit's findings are now encoded as executable tests;
  see `tests/browser/README.md`. Finding IDs (F-01, F-04, …) refer to that audit, which is kept
  locally and is not tracked in this repository.
- **Next action:** Increment 6 — scale (N2/F-04): virtualization, search, and a paged query
  surface. This is the breaking protocol change of the project: whole-state responses give way to
  `listShelf({readerId, query, sort, group, cursor, limit})` plus a counts endpoint. Requires an
  ADR: _"The browser query surface is paged and filtered."_ Two cheap wins are already identified
  and waiting there: the worker calls `prepareResolutionQueue` in its tail after a branch has
  already recomputed, so a manual add does the O(n) work twice, and per-work cover fetches should
  fold into the paged query. Virtualization must set `aria-setsize`/`aria-posinset` or it breaks
  screen-reader traversal.
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

Increment 2 result: ships N1 and closes F-01, the audit's highest-severity finding. A 50-row CSV
and a Libby snapshot now land every book on the shelf with zero human decisions, and a one-reader
household never sees a review queue. Recorded in ADR 0012.

The mechanism is a `CompositionDefaults` object the browser passes and the local runtime does not.
The domain rules are unchanged: they are conservative because they have a catalog, and the browser
has none by construction (ADR 0002), so its assessments always found zero evidence and always
concluded "a human should decide". Two defaults fill that vacuum — accept the source record's own
title when no catalog candidate exists, and attribute to the household's only reader when the
rules could not choose. The single-reader default is skipped whenever a catalog-derived signal is
present, so a considered "this is adult material" is never overridden.

The defaults must be threaded through `correctAttribution` as well, not just the import path:
`recomputeAttributions` re-derives every record on every call, so correcting one book without them
would silently revert every other book to review. That is the subtle part of this change.

Audit trail is preserved. Automatic resolutions use the same append-only path with confidence 0.5
instead of 1, which distinguishes them without a schema change. Automatic attributions are
`method='evidence_rules'` with an explanation beginning "Attributed automatically…" and a
`single_reader_default` evidence row. A human correction supersedes rather than replaces, and a
unit test proves the superseded record is still on file with the correction pointing at it.

Closing the loop made the F-04 numbers worse, which is expected and correct — a thousand imported
books now render as shelf cards instead of stopping in a queue. At 1000 books, measured on this
machine: import 16.9 s -> 49.1 s, add-one-more 2.4 s -> 28.2 s, DOM nodes 16 144 -> 45 136,
document height 230 963 px -> 309 979 px. The cause is precise: `recomputeAttributions` scans every
record with a resolved case, which used to be roughly zero in the browser and is now all of them.
The worker compounds it by calling `prepareResolutionQueue` in its tail after a branch has already
recomputed and rebuilt, so a manual add does the O(n) work twice. Both are Increment 6's to fix
alongside the paged query surface; the redundant tail call is the cheap half.

Tests: 30 -> 32 browser (29 green, 2 F-04 annotations, 1 skipped) and 62 -> 66 unit. Eight existing
browser tests had encoded the broken behaviour by asserting books stop in a queue, and were
updated. One of them, a regression test for the attribution CHECK-constraint bug, tested a UI path
that no longer exists in a one-reader household; it was replaced by a test that no review queue
ever appears, with the constraint-level coverage moved to the application tests.

Increment 3 result: ships N8 and closes F-05. Browser storage is evictable, `navigator.storage.persist()`
was called nowhere in the source, and wiping OPFS returned the app to the first-run empty state with
no warning and no mention that a backup existed. ADR 0011 named the risk and the UI ignored it.

Three facts now exist, deliberately stored in three different places:

- Whether this browser granted persistent storage is device-local and queried live from the Storage
  API on every load, never cached, so it cannot go stale. `persist()` is requested once per device
  after the first successful add, because a real add is the user gesture a browser weighs most.
- Whether this device has ever held books is a localStorage marker. It cannot live in the database,
  since the entire point is to survive the database disappearing.
- `last_backup_at` belongs to the data rather than the device, so it lives in `app_metadata` and
  travels inside the encrypted archive. A restored device reports an accurate last backup because
  the value is written before the snapshot is taken.

Worth knowing: requesting persistence is not the same as getting it. A probe against a fresh
Chromium profile showed the request being made and denied — Chromium decides on site-engagement
heuristics, and installing the PWA is one of the stronger signals, which is a direct payoff from
Increment 1's install work. The app therefore states the real state rather than implying safety,
and the backup reminder is the mitigation that does not depend on a browser's goodwill.

Wipe detection has a known limit, recorded here so it is not rediscovered as a bug: clearing _all_
site data removes the localStorage marker too, so that case is indistinguishable from a first run
and correctly shows the first-run screen. What it does catch is the failure `persist()` exists to
prevent — the browser evicting origin storage on its own. A test proves a genuine first run, including
the service-worker shell being cached on a reload, is never misreported as a wipe.

The export path had a real defect this work surfaced: it discarded its own worker response, so a
backup registered in the database but the UI still read "Last backup: Never" until a reload.

Tests: 32 -> 37 browser and 66 unit. The archive round-trip now carries one extra row, which is
`last_backup_at` itself, and asserts it restores intact.

Increment 4 result: ships N5 and N9. `main.tsx` went from 1229 lines to 326, with the rest split
across a router, a shared state module, four components, and six destinations — about 1600 lines
total, so this is a redistribution rather than a rewrite. The single scrolling page whose sections
were pipeline stages is gone.

Routing is a 66-line hash router rather than a dependency, and the reasoning is recorded in
`router.ts` itself. Hash over the History API because this ships as static files with an offline
service worker: path routing would need either server rewrites, which the `_headers` deploy
contract does not describe, or a service-worker navigation fallback that has to stay correct for
every future route. A hash never leaves the document, cannot 404, and behaves identically offline.
No library because the requirement is five flat destinations with no params, no nesting, and no
data loading; revisit when nested parameterised routes arrive.

Concepts moved to where audit §6.3 puts them. The Import inbox is deleted outright. Backup and
restore, import history, and the privacy note are in Settings, where passphrase entry no longer
sits above the fold. Library facts are under Activity. Review work is one Tasks destination reached
from a badge, with actions renamed to outcomes: "Keep as typed", "Ask me later", "Remove". The
first-run screen leads with a single "Add your first book" button and states the privacy boundary
in one sentence, rather than opening with a Libby import panel and a box explaining what the app
cannot do.

F-20 is closed alongside: a `nav` landmark, a skip link, and an error boundary whose recovery copy
deliberately says the books are still saved and warns against clearing site data, because that is
the one instinct after a broken screen that would actually destroy the bookshelf.

Two deliberate deviations from the audit. The intermediate 72px icon rail at 960–1279px is not
built: it needs an icon set that does not exist yet, and text labels at 72px are illegible, so the
sidebar switches straight to a bottom tab bar below 960px. And `record-count` moved to Settings
where it belongs as an ingestion fact, so tests now assert the import status line or the shelf
itself, which is what a person would actually look at.

Tests: 37 -> 44 browser (43 green, 2 F-04 annotations, 1 skipped) and 66 unit. Every spec needed
updating because the IA moved, which is what Increment 0 existed to make safe. Seven new tests
cover the shell: destination reachability, deep links and reload, unknown-hash fallback, the nav
landmark and `aria-current`, the skip link, the tasks badge, and the error boundary.

Two layout defects were caught by looking at the result rather than by the assertions: a CSS
specificity bug where `.first-run > p` outranked `.first-run-privacy` and collapsed its spacing to
zero, and a bottom tab bar that handed Settings half its width because the destination list and
Settings both claimed `flex: 1`.

Increment 5 result: ships N3 and N6, closing F-02 and F-15. The shelf is a grid of covers rather
than a list of forms, and every book is one tap from a detail drawer. Recorded in ADR 0013.

Covers are bytes this household holds, never a remote URL. A URL would tell whoever serves it
which books this family owns, on every render, from the family's own IP — a continuous leak of
exactly what ADR 0011 exists to prevent, and one that would look like ordinary image loading.
Worth restating because it is the happy part: **the CSP did not change**. `img-src ... blob:`
already permitted blob rendering, so the shelf gained faces at zero cost to the privacy posture.

A book with no stored cover gets a generated one: the title in the serif face over one of eight
muted hues chosen deterministically from the work id. Generated covers are drawn, never stored, so
they cost nothing in OPFS or archive and are identical on every device. All eight hues were
measured against the cream text rather than eyeballed — 8.14:1 to 10.90:1, against a 4.5:1 bar.

The archive payload is now `read-it-again-logical-v2`. JSON cannot hold raw bytes, so binary
columns are wrapped as `{"$bytes": "<base64>"}`; a Uint8Array would otherwise stringify to
`{"0":137,"1":80,...}` and parse back as a plain object. v1 payloads contain no binary columns and
are still accepted, with a test that builds a real v1 envelope and restores it.

Moving the assessment form off every card and into the detail view — the audit's single biggest
visual-density note — turned out to be the largest performance win so far, without any
virtualization. At 1000 books: DOM nodes 45 136 -> 13 060, document height 309 979 px -> 51 276 px,
add-one-more 28.2 s -> 12.4 s. Still over the F-04 budgets of 2000 nodes and 20 000 px, and those
two tests stay annotated for Increment 6, but the gap is now a factor of six rather than twenty.

Deliberate deviations. Thumbhash blur-up placeholders are not built: they pay off when thumbnails
arrive slowly over a network, and these bytes come from local OPFS, so the real fix for scroll is
virtualization. Cover bytes are excluded from the shelf payload and fetched per work, because a
thousand covers at the 60 KB cap would be 60 MB through one postMessage.

Choosing a cover from a file is included so that cover storage is real and testable now rather
than speculative schema. On a phone `accept="image/*"` already offers the camera; the dedicated
capture flow is Increment 8. Images are downscaled to the ADR 0013 caps before storage, encoding
at descending JPEG quality until the result fits rather than guessing once, and refusing with a
message if even the lowest quality is too large.

Tests: 44 -> 52 browser (51 green, 2 F-04 annotations, 1 skipped) and 68 unit. Eight browser tests
needed updating because assessment and provenance moved into the drawer, and shelf tiles no longer
carry headings. A detail drawer is modal, so its scrim genuinely blocks navigation — the test
helper now closes it first, which is what a person has to do.
