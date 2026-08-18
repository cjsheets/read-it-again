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
