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

## R4 — Open Library ISBN-to-title kill gate

### Corpus and method

- The repository contains no real ISBN corpus, and no household corpus was supplied at the
  checkpoint. With explicit approval, the fallback uses **100 unique ISBNs** deduplicated from eight
  seasonal Publishers Weekly **Children's Picture Books** bestseller lists spanning 2024–2025.
- This is an **optimistic upper bound**, not a representative household result. Current bestsellers
  are more likely to be catalogued than board books, hand-me-downs and older editions, so this
  overstates real-world coverage.
- Added `scripts/audit-openlibrary-isbn-coverage.mjs`; it is measurement tooling only and changes no
  product code. It extracts the displayed title and edition ISBN from the published lists, then
  queries the specified Open Library `api/books` endpoint.
- The legacy endpoint accepts multiple `bibkeys`, so the audit used 10 requests of at most 10 ISBNs
  rather than 100 separate requests. Results remain per ISBN, requests were spaced 1.1 seconds apart,
  and responses were not stubbed.
- “Recognizably correct” uses a recorded conservative rule: case/punctuation-insensitive equality,
  one normalized title containing the other, or at least 70% shared normalized title tokens. All
  three exceptions were inspected.

### Gate result

- Measured: **2026-08-18T14:09:41.151Z**.
- Open Library record hits: **98 / 100 (98%)**.
- Non-empty titles: **98 / 100 (98%)**.
- Non-empty author lists: **98 / 100 (98%)**.
- Recognizably correct titles: **97 / 100 (97%)**.
- Exceptions:
  - ISBN `9780593811252` returned the placeholder **Untitled RHBFYR 1252** instead of **Ms. Rachel
    and the Special Surprise**;
  - ISBN `9780593898642` (**100 First Words (Ms. Rachel)**) returned no record;
  - ISBN `9798217024902` (**Hide and Seek with Herbie (Ms. Rachel)**) returned no record.
- Gate threshold: **at least 70% usable titles**. Result: **PASS — proceed to R5**.

### Validation, regressions and blockers

- The corpus-only run produced exactly **100 / 100 unique ISBNs** before any Open Library request.
- Script formatting, syntax and ESLint checks pass.
- The literal `pnpm check` rerun passed formatting, ESLint, TypeScript and **86 / 86 unit tests**,
  then reported **102 / 115 browser tests passing**. Its four production performance checks and all
  87 pre-existing browser tests pass; exactly the 13 future R5–R7 contracts fail.
- Because the browser step stops the command, production build and `pnpm check:web-boundary` were
  rerun separately and pass. The boundary covers 29 source and 19 artifact files.
- No application source, client boundary, schema, dependency or built artifact changed in R4.
- The adoption suite remains **15 / 28 passing** by design: R4 is an evidence gate with no browser
  behavior or adoption test of its own. Therefore the instruction that every release must strictly
  increase adoption passes cannot apply literally to this required non-product checkpoint.
- The incremental `pnpm check` contradiction recorded under R1 therefore remains: future R5–R7
  contracts stay unskipped and red until implemented. No test was changed, skipped or excluded for
  this gate.
- This bestseller result does not resolve whether parents accept opt-in lookup, nor does it replace
  the 100-book, six-device barcode field test. Both remain human-only evidence.
- R5 has not been started. This is the required post-gate review pause.

## R5 — consented ISBN metadata proposals

### What changed

- Expanded the device-local Open Library permission to cover both book details and covers, using a
  new storage key so an earlier cover-only grant is not silently broadened.
- Added a worker metadata lookup that shares the cover queue's 3.1-second courtesy clock, durable
  HTTP cache and live network indicator. Hits, misses and temporary failures are cached.
- Lookup results are proposals with **Use these details** and **Edit them first**; no result writes a
  book until confirmed. Valid ISBNs can still be added offline without a title.
- Consolidated the production CSP exception in `_headers` and recorded the decision in ADR 0017.
- Corrected the real barcode fixture to ISBN `9780198513933`. Open Library identifies the former
  fixture (`9780306406157`) as an unrelated communications textbook.

### Acceptance result

- Adoption suite before: **15 / 28 passing**.
- Adoption suite after: **19 / 28 passing**. All four R5 contracts pass against production preview:
  permission off produces zero metadata requests, permission on yields a confirmable proposal,
  offline use retains the typed path, and an ISBN-only book remains identifiable.

### Validation and blockers

- Formatting, ESLint and TypeScript pass.
- The focused R1/R5 production-browser suite passes **8 / 8**, including a real Open Library request
  and real CSP enforcement. No network interception is used to prove permission or policy.
- The remaining nine adoption contracts belong to R6 and R7. The full final budget harness and
  literal green `pnpm check` remain pending until those releases land.
- Human-only evidence remains unchanged: the six-device barcode field test, moderated parent
  sessions, acceptance of opt-in lookup and real-device iOS Safari verification.

## R6 — camera to the front

### What changed

- Made **Scan a barcode** a normal action at the top of Add on camera-capable devices, removed the
  Settings experiment and clears its retired local preference on existing installs.
- Camera permission and the lazy decoder still begin only on the scan tap. Refused, absent and
  already-shelved outcomes keep their named typed fallback and duplicate-safe shelf path.
- A disclosure beside the scan action grants only the scanned ISBN's metadata request. It neither
  enables standing Open Library permission nor starts cover traffic; ADR 0017 records the scope.
- A successful scan produces the R5 confirmation card and offers **Scan another** after adding.

### Acceptance result

- Adoption suite before: **19 / 28 passing**.
- Adoption suite after: **23 / 28 passing**. A cold scan reaches a correctly titled book in three
  taps and zero keystrokes; camera refusal, camera absence and duplicate scans all pass.

### Validation and blockers

- Formatting, ESLint and TypeScript pass.
- The combined metadata, scanner and camera acceptance run passes **15 / 15** using the real EAN-13
  decoder. The production barcode payload budget also passes.
- The synthetic head-on video proves wiring and reachability, not field reliability. The 100-book,
  six-device test remains outstanding, as do moderated parent sessions and real-device iOS Safari.
- Five R7 adoption contracts and the final first-run budget harness remain.

## R7 — a shelf that grows with the household

### What changed

- Shelves with at most 11 books now devote the screen to covers plus one final **Add another book**
  tile. Search, sort, count and bulk-selection controls appear only from book 12 onward; bulk select
  lives under a small **More** overflow.
- The add confirmation now names an **Add another book** loop and returns focus to Title.
- Shelf columns use an approximately 112px minimum with an 8px gutter, fitting three covers at the
  375px mobile acceptance viewport while keeping virtual-grid arithmetic aligned with CSS.
- Activity is absent from navigation until at least one reading session exists.

### Acceptance result

- Adoption suite before: **23 / 28 passing**.
- Adoption suite after: **28 / 28 passing**. All five R7 contracts pass, and the complete adoption
  suite passes together against the production preview.

### Validation and blockers

- Formatting, ESLint and TypeScript pass.
- R7 focused tests pass **5 / 5**; the full adoption contract passes **28 / 28**.
- Earlier R2/R3 checks were aligned with the new intentional visibility rules: status clearing uses
  Settings rather than hidden Activity, and correction-search coverage builds a 12-book shelf.
- The final first-run performance/accessibility harness and full `pnpm check` are still pending.
- Human-only evidence remains the six-device barcode field test, moderated parent sessions, lookup
  acceptance and real-device iOS Safari.
