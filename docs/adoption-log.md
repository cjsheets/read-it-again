# Adoption log

This log is intentionally candid. A passing narrow check is not reported as a passing release, and
human-only evidence is not replaced with a synthetic proxy.

## R1 — unblock covers

### What changed

- Removed the HTML meta CSP. `apps/web/public/_headers` is now the only production policy
  definition.
- Made Vite production preview read and serve the headers from `_headers`, so browser tests exercise
  that exact policy. Development serves the same non-CSP security headers but omits CSP because
  Vite injects its stylesheet during development.
- Changed the web-boundary scanner to reject a reintroduced meta CSP while continuing to require the
  CSP and cross-origin-isolation headers in the built `_headers` artifact.
- Corrected two Phase 0 test assumptions found during implementation: an absent meta element must be
  read without an auto-waiting locator action, and the stylesheet's page background belongs to the
  root element rather than `body`.

### Acceptance result

- Adoption suite before: **0 / 28 passing**.
- Adoption suite after: **4 / 28 passing**. All four R1 checks pass:
  - production preview returns the CSP response header;
  - no meta/header `connect-src` disagreement exists;
  - an unmocked browser fetch from `covers.openlibrary.org` succeeds under the production CSP;
  - the development server renders with the application stylesheet.
- The remaining 24 failures are the unchanged R2, R3, R5, R6, and R7 contracts.

### Validation and measurements

- Formatting, ESLint, and TypeScript: pass.
- Unit tests: **83 / 83 pass**.
- Pre-existing browser tests: **87 / 87 pass**.
- Production build: pass.
- `pnpm check:web-boundary`: pass across 28 source and 19 artifact files.
- Existing production performance suite: **4 / 4 pass**.
  - 1,000-book import: **2,360 ms**; the AGENTS baseline is 3,306 ms at 1,200 books, so this is not a
    like-for-like improvement claim.
  - Add one book after that import: **215 ms**, close to the 199–201 ms repeated-add baseline.
  - 1,000-book search: **188 ms**, effectively unchanged from the 187 ms baseline.
  - DOM nodes: **833**, unchanged from baseline.
  - Barcode payload: **473,621 bytes gzip**, within the 1.5 MB budget.
- The requested `tests/browser/first-run-budget.spec.ts` has not been landed yet, so cold-open,
  first-book, tap/keystroke, and log-a-reading numbers were not re-measured in R1. Do not infer those
  numbers from the scale suite above.

### Regressions and blockers

- No regression was observed in the pre-existing automated suite.
- The literal `pnpm check` command is red at the browser-test step: Phase 0 required all future
  adoption tests to be unskipped and failing, while the release rule requires `pnpm check` to be
  green after each incremental release. Because `pnpm test:browser` discovers the adoption directory,
  those requirements cannot both hold before the final release. I did not hide, skip, annotate, or
  exclude the 24 future failures. Human decision needed: accept `pnpm check` as intentionally red until
  the adoption contract is complete, or explicitly choose a different incremental-check convention.
- No deployment platform or deployed URL is configured in the repository. The production preview
  proves that the exact `_headers` artifact is applied locally, but it cannot prove an unknown external
  host processes that file. Human action needed: provide the deployment target/URL or confirm that the
  chosen static host applies `_headers` before this CSP change is deployed.

### Human-only evidence still outstanding

- 100-book, six-device barcode field test.
- Moderated first-run sessions with real parents.
- Whether parents accept opt-in Open Library lookup.
- Whether reading logs are the household's job or only duplicate-purchase checking is.
- iOS Safari verification on a real device.

## R2 — plain language and reach

### What changed

- Add now contains only the single-book form and scanner entry point, with a quiet link to Settings.
  CSV and Libby imports moved to **Bring in books from elsewhere** in Settings.
- **Log a reading** is the detail drawer's filled primary action; choosing a cover is now outlined.
- **How this works** opens the existing privacy explanation in place and returns focus to its trigger
  when closed. The one mandated wording change from F-12 is shared by Settings and the dialog.
- Status messages remain in a `role="status"` live region, clear on route changes, and expire after
  six seconds. A message from one destination no longer follows the person into another.
- The first summary now has an explicit loaded state. The shelf renders a quiet skeleton until the
  worker answers, so a returning household never receives a false empty-shelf frame.
- The first-run explainer and skip link now meet the 44×44 px target size at 320 px.
- Replaced the specified model and workflow terms with parent-facing copy across Settings, readers,
  ratings, Tasks, Discover, Activity, shelf flags, and book detail. The rating scale now displays
  **no / a little / a lot / loved it**, and reader reasoning is absent when there is only one reader.
- Generated-cover tiles no longer repeat the title beneath art that already prints it. Stored-image
  covers retain their title caption, and every tile now has an explicit accessible **Open {title}**
  name.

### Acceptance result

- Adoption suite before: **4 / 28 passing**.
- Adoption suite after: **12 / 28 passing**.
- All eight R2 checks pass against production preview. The remaining 16 failures are the unchanged
  R3, R5, R6, and R7 contracts.

### Validation and measurements

- Formatting, ESLint, and TypeScript: pass.
- Unit tests: **83 / 83 pass**.
- Pre-existing browser tests: **87 / 87 pass**.
- Production build and `pnpm check:web-boundary`: pass.
- Existing production performance suite: **4 / 4 pass**.
  - 1,000-book import: **2,359 ms** (R1: 2,360 ms).
  - Add one book after that import: **229 ms** (R1: 215 ms; both below the 500 ms budget).
  - 1,000-book search: **189 ms** (R1: 188 ms; AGENTS baseline: 187 ms).
  - DOM nodes: **773** (R1 and AGENTS baseline: 833).
  - Barcode payload: **473,621 bytes gzip**, unchanged.
- The final first-run budget harness still has not landed, so cold-open, first-book, tap/keystroke,
  and log-a-reading timings remain unmeasured for this release.

### Regressions and blockers

- No behavioral regression appeared in the pre-existing automated suite.
- The production CSS artifact grew from 16.26 kB to 17.81 kB raw (3.98 kB to 4.25 kB gzip), and
  the main JavaScript artifact grew from 251.86 kB to 254.10 kB raw (77.47 kB to 78.03 kB gzip).
  This is the cost of the shared privacy dialog, loading skeleton, and new UI states; existing payload
  budgets still pass.
- `pnpm check` reaches the browser step and reports **99 / 115 passing**, then stops on the 16
  deliberately unimplemented future adoption tests. It therefore does not reach its build and
  boundary commands; those commands were run separately and passed. The incremental-check conflict
  recorded under R1 remains unresolved, and no tests were hidden or excluded.
- External deployment-header verification remains outstanding for the reason recorded under R1.

### Human-only evidence still outstanding

- 100-book, six-device barcode field test.
- Moderated first-run sessions with real parents.
- Whether parents accept opt-in Open Library lookup.
- Whether reading logs are the household's job or only duplicate-purchase checking is.
- iOS Safari verification on a real device.

## R3 — correctable and recoverable books

### What changed

- Added **Edit details** for title and author in the book drawer. Saving appends a complete display
  snapshot to `work_detail_edits`; it does not update the imported `works` or `editions` evidence.
- Shelf, detail and the normalized search projection adopt the latest correction without a reload.
  **Show edit history** keeps the original value and every later snapshot inspectable.
- Added **Remove from shelf** without a confirm dialog. Removal appends a `removed` event, closes the
  drawer and offers **Undo** in the existing live status region; Undo appends a `present` event.
- The work ID never changes, so generated-cover color, stored covers, readings, ratings and source
  history remain attached to the same book.
- Shelf queries, summary counts and per-reader counts now omit a work whose latest shelf event is
  `removed`. Removing the last book no longer points at Tasks unless a task actually exists.
- Encrypted backups round-trip both new append-only tables. ADR 0018 records the overlay and soft-
  removal decision; ADR 0017 remains reserved for R5's metadata lookup decision.
- Updated the shared SQLite conformance assertion from 11 to 12 migrations. The first literal
  `pnpm check` run caught that stale expectation; it was a real R3 miss, not classified as a future
  test.

### Acceptance result

- Adoption suite before: **12 / 28 passing**.
- Adoption suite after: **15 / 28 passing**. All three R3 checks pass:
  - a correction updates drawer, shelf and search with no reload;
  - the original value remains visible in edit history;
  - removal disappears immediately and Undo restores the same work.
- The remaining 13 failures are the unchanged R5, R6 and R7 contracts.

### Validation and measurements

- Formatting, ESLint and TypeScript: pass.
- Unit tests: **86 / 86 pass**, including source preservation, edit history, shelf-event history and
  encrypted-backup round trips.
- Pre-existing browser tests: **87 / 87 pass**. The SQLite-WASM/OPFS conformance test reports all 12
  migrations and persistent data.
- Production build and `pnpm check:web-boundary`: pass; the boundary scan covers 29 source and 19
  artifact files.
- Existing production performance suite: **4 / 4 pass**.
  - 1,000-book import: **2,366 ms** (R2: 2,359 ms).
  - Add one book after that import: **217 ms** (R2: 229 ms).
  - 1,000-book search: **189 ms** (R2 and AGENTS baseline: 189 ms and 187 ms respectively).
  - DOM nodes: **773** (R2: 773; AGENTS baseline: 833).
  - Barcode payload: **473,621 bytes gzip**, unchanged.
- The main CSS artifact grew from 17.81 kB to 17.98 kB raw and from 4.25 kB to 4.31 kB gzip. The
  main JavaScript artifact grew from 254.10 kB to 256.87 kB raw and from 78.03 kB to 78.59 kB gzip.
  This is the measured cost of edit/history/removal UI and protocol handling; existing budgets pass.
- The final first-run budget harness still has not landed, so cold-open, first-book, tap/keystroke
  and log-a-reading timings remain unmeasured for this release.

### Regressions and blockers

- No behavior or scale regression appeared in the pre-existing automated suite. The overlay join
  added 7 ms to this 1,000-row import sample and no measurable search change; these single-run
  differences are too small to claim as either a regression or improvement.
- The literal `pnpm check` command is red at the browser step with **102 / 115 passing** and therefore
  does not reach build or boundary checks. Exactly the 13 deliberately unimplemented R5–R7 adoption
  tests fail. Build and boundary were run separately and pass. The Phase 0/incremental-check
  contradiction recorded under R1 remains unresolved; no future test was hidden, skipped or
  excluded.
- External deployment-header verification remains outstanding for the reason recorded under R1.

### Human-only evidence still outstanding

- 100-book, six-device barcode field test.
- Moderated first-run sessions with real parents.
- Whether parents accept opt-in Open Library lookup.
- Whether reading logs are the household's job or only duplicate-purchase checking is.
- iOS Safari verification on a real device.
