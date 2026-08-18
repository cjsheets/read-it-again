---
description: Work the new-user adoption audit — fix, investigate, and verify every finding in dependency order. Optional arg: status | R1..R7 | F-01..F-13 | investigate.
argument-hint: "[status | R1-R7 | F-01..F-13 | investigate]"
---

# Goal

A parent opens Read It Again for the first time at 8:45pm. Kid's in bed. They're holding a phone in
one hand and a picture book in the other. **Get that book onto a shelf, looking right, with no
account, nothing synced, and no typing they didn't have to do.**

An adoption audit measured the current state and produced thirteen findings. Your job is to work
them — fixing what can be fixed, investigating what must be investigated, and honestly refusing what
requires a human with physical books.

Argument: `$1`

- *(empty)* — determine the current state, then do the next incomplete release in order.
- `status` — report state only. Change nothing.
- `R1`…`R7` — do that release only.
- `F-01`…`F-13` — do that single finding only.
- `investigate` — run only the open-question probes (§ Investigations). Change no product code.

---

## Hard rules

These are not negotiable and override anything convenient.

1. **Never stub the network to make a test pass.** The audit's single worst finding existed because
   six cover tests used `page.route('https://covers.openlibrary.org/**')`, which resolves *before*
   CSP is applied. Green tests, dead feature. Any test asserting "we can reach host X" must exercise
   the real policy. Stubbing is fine for asserting *behaviour after a response*; it is never fine for
   asserting *that a request is permitted*.
2. **The PWA stays fully useful with no server and no library account.** Every change must leave the
   typed path working offline with zero network.
3. **Credentialed BiblioCommons acquisition never reaches the client bundle.** `pnpm check:web-boundary`
   enforces this. It must keep passing.
4. **The browser makes no live KCLS catalog calls.** ADR 0002. Do not re-litigate.
5. **Keep these concepts distinct internally:** checkout observations, inferred acquisition episodes,
   confirmed reading sessions. Renaming them in the UI is required (F-12); merging them in the model
   is forbidden.
6. **Imported and user-authored data stays auditable and portable.** A user correction is a new
   record, not an `UPDATE` that destroys evidence.
7. **Adding a book is not reading it. An ISBN does not identify an edition. Cover OCR is not
   authoritative metadata.** Any lookup result is a *proposal a human confirms*, never a silent write.
8. **Do not fake a human test.** Field tests on physical books and moderated parent sessions cannot be
   automated. Say so and stop; do not substitute a synthetic proxy and report it as evidence.
9. **Audit against the production build, not the dev server.** `vite preview` with real COOP/COEP
   headers. (The dev server currently renders unstyled — see F-01.)
10. **`pnpm check` passes before you call anything done.** Format, lint, typecheck, unit, browser,
    build, web-boundary.

---

## Working method

**Establish state from the code, not from a checklist.** Before doing anything, run the verification
suite and read the relevant source. A finding is done when its acceptance criterion has a passing
test — not when a file looks changed.

**One release per commit, smallest releasable increment.** Commit message style in this repo is
lowercase imperative, occasionally with a conventional prefix (`fix:`, `feat:`, `perf:`, `test:`).
Match it. Do not push unless asked.

**Every fix lands with the test that would have caught it.** The audit found real bugs that the
existing suite passed over. A fix without a regression test repeats that mistake.

**Re-measure after each release.** The audit's numbers are the baseline; keep them honest.

**When blocked, finish everything else first.** If one finding is genuinely stuck, complete every
other item in the release, then report precisely what is blocked and why. Do not stall the whole run
on one item.

---

## Baseline (measured 17 Aug 2026, production build, Chromium, 375×812)

Keep these numbers from regressing. Throttled = CDP `setCPUThrottlingRate: 4`, 9 Mbps / 70 ms.

| Measure | Value |
|---|---|
| Cold open → empty state (throttled) | 437 ms |
| Cold open → worker ready (throttled) | 1,743 ms |
| Cold open → first book confirmed (throttled) | 2,099 ms |
| Taps / keystrokes to first book | 3 / 12 |
| Five books in a row | 366, 199, 199, 200, 201 ms — focus stays on Title |
| Log a reading | 2 taps, 91 ms |
| 1,200 books | import 3,306 ms · search 187 ms · 833 DOM nodes · 60 tiles |
| Barcode decode | 792 ms |
| axe violations (5 screens, WCAG 2.1 AA) | 0 |
| Returning-user false empty-state flash | 72 ms (41→113 ms) |

---

## Releases, in dependency order

Do them in order. The gates are real: **R5 must not ship before R4, and R6 must not ship before R5.**
Promoting the camera while it still returns a bare ISBN points the app's most prominent button at its
worst path.

### R1 — Unblock covers  *(F-01)*

The app ships two Content Security Policies that disagree. `apps/web/index.html` sets
`connect-src 'self'`. `apps/web/public/_headers` sets `connect-src 'self' https://covers.openlibrary.org`.
Multiple policies are enforced independently, so the intersection is `'self'` and every cover fetch is
refused — in production, from both the main thread and the worker. Cover art, which Settings devotes
its longest paragraph to, cannot work.

`frame-ancestors` is also silently ignored in a `<meta>` CSP and logs an error on every load. And the
meta policy blocks Vite's injected styles, which is why the dev server renders completely unstyled.
One root cause, three symptoms.

- **Fix:** prefer deleting the `<meta>` CSP entirely and letting `_headers` be the single source of
  truth, since `frame-ancestors` only works as a header anyway. If the meta tag must stay (e.g. the
  deploy target can't be trusted to apply `_headers`), then the two policies must be generated from
  one shared definition so they cannot drift.
- **Verify:** confirm the deploy target actually applies `_headers`. A deleted meta tag plus an
  unapplied header file is strictly worse than today.
- **Accept when:** a test that does *not* use `page.route` asserts a real request to the cover host is
  permitted by CSP; and a test asserts the meta and header policies do not disagree on `connect-src`.
  Also confirm the dev server now renders styled.

### R2 — Plain language and reach  *(F-06, F-07, F-08, F-09, F-11, F-12, F-13)*

Pure UI. No schema, no protocol, no new dependencies. Can be one commit or several.

- **F-06 — inverted hierarchy, two places.** On Add (`apps/web/src/routes/add.tsx`), the CSV and Libby
  import cards occupy roughly two thirds of the screen; the premise is that most users never touch
  them. Move both to Settings under "Bring in books from elsewhere", leaving Add as scan + type, with
  one quiet line pointing to the import page. In the detail drawer
  (`apps/web/src/components/book-detail.tsx`), "Choose a cover" is the filled primary while "Log a
  reading" is an outline secondary — swap the weights.
  *Accept when:* the Add screen contains only ways to add one book, and "Log a reading" is the only
  primary-weight control in the drawer.
- **F-07 — privacy answer is 1,445 px from the question.** "How this works" on the first-run screen
  (`apps/web/src/routes/shelf.tsx`) routes to `#settings` top-of-page, landing the user on a
  passphrase field; the Privacy card is ~1.8 screens further down. Open the explanation in place — a
  drawer or disclosure on the first-run screen. The existing Privacy copy is excellent; reuse it
  verbatim, don't rewrite it.
  *Accept when:* activating it puts "Your library stays in this browser" in the viewport with no
  scrolling, and focus returns to the CTA on close.
- **F-08 — the global status line is stale and permanent.** `apps/web/src/components/shell.tsx` renders
  one status paragraph above every destination and never clears it on navigation, so "Book added."
  follows the user to Activity and Settings and "Imported 1200 new of 1200 rows." sits above the shelf
  indefinitely. It occupies the top line of every screen on a phone. Make it transient and local —
  announce results next to the control that caused them, keep a `role="status"` live region for screen
  readers, clear on route change.
  *Accept when:* navigating away from an action clears its message; no destination renders a status
  line about a different destination.
- **F-09 — a stocked shelf flashes "Your shelf is empty".** `apps/web/src/routes/shelf.tsx` branches on
  `summary.bookCount === 0`, and `EMPTY_SUMMARY` in `apps/web/src/app-state.ts` starts at zero, so the
  first-run screen renders before the worker answers. Measured 72 ms on a returning user with three
  books; it scales with device speed and shelf size. For a local-first app this is the most alarming
  sentence available. Distinguish "not loaded" from "genuinely empty" — `useWorkerData`'s `undefined`
  convention already does this elsewhere. Show a quiet skeleton instead.
  *Accept when:* a returning user with ≥1 book never renders `[data-testid="first-run"]`, asserted by
  animation-frame sampling rather than a timed screenshot.
- **F-11 — two sub-44 px targets.** At 320 px everything respects the repo's own `--tap: 44px` token
  except "How this works" (97×16) and the skip link (146×42). The first is the privacy affordance from
  F-07 — the smallest target on the screen is the one a nervous parent reaches for. Give
  `.link-button` (`apps/web/src/styles.css`) a `min-height: var(--tap)` and padding where it stands
  alone rather than inline in a sentence. Note axe will not catch this; it does not check target size
  at AA.
  *Accept when:* every standalone interactive control on the first-book flow measures ≥44×44 at 320 px,
  asserted in a test.
- **F-12 — implementation vocabulary on screen.** Apply the rename table below. Most of the app's copy
  is already well translated; these are what remain.
- **F-13 — duplicate title.** Tiles print the title on the generated cover and again in the caption.
  Suppress the caption title when the tile shows a generated cover that already carries it; keep the
  author line. Do this *after* R1, since real covers change the calculus.
  *Accept when:* no tile renders the same title string twice.

**Rename table** — say the right-hand column instead:

| Says | Where | Should say |
|---|---|---|
| Import archive | `routes/settings.tsx` | **Restore from a backup** |
| Archive *(reader button)* | `routes/settings.tsx` | **Hide this reader** |
| Archive passphrase | `routes/settings.tsx` | **Backup password** |
| Save assessment | `components/book-detail.tsx` | **Save** |
| Ratings and read-aloud notes | `components/book-detail.tsx` | **How did it go?** |
| Veto | `components/book-detail.tsx` | **Don't suggest this again** |
| Child engagement / Grown-up enjoyment 0–3 | `components/book-controls.tsx` | **Kid liked it / I liked it**, showing the words already in `RATING_MEANINGS` (*no, a little, a lot, loved it*) — they currently reach only screen readers |
| Why this reader | `components/book-detail.tsx` | **Who's this for?** — and hide the section entirely with one reader |
| Nothing needs you / Needs a decision | `routes/tasks.tsx` | **All tidy / A few to sort out** |
| Deterministic suggestions… cached library observation | `routes/discover.tsx` | **Ideas from what your family already reads. Availability was last checked {date}.** |
| Catalog record {key} | `routes/discover.tsx` | *delete* |
| acquisition episodes derived from borrowing | `components/book-detail.tsx` | **Borrowed {n} times — which doesn't mean it was read** |
| The local runtime does that work | `routes/settings.tsx` | **A companion app on a computer does that** |

*Accept when:* no user-visible string contains *archive* (as a verb for readers), *assessment*,
*provenance*, *observation*, *deterministic*, or *catalog record*. Assert this with a test that reads
rendered text from every destination, not by grepping source.

### R3 — Recoverability  *(F-05)*

The detail drawer offers ratings, traits, cover choice, reader reassignment — and **no way to edit a
title, edit an author, or remove a book.** A typo at 8:45pm is permanent. This is the only journey the
audit marked fully blocked. The append-only correction machinery exists for attribution and resolution
— the two things a browser-only household never sees — while the correction they will actually need is
absent.

- **Fix:** add "Edit details" (title, author) and "Remove from shelf" to the drawer. Removal reversible
  via undo in the status region, not a confirm dialog.
- **Constraint:** rule 6 applies. A user-authored correction must stay auditable, so this is most
  likely a correction record rather than a destructive `UPDATE`. Read
  `packages/storage-schema/src/migrations.ts` and the existing correction patterns before designing it.
- **Keep stable:** the generated cover hue is derived from the work ID (`components/cover.tsx`), so a
  title correction must not change a book's colour.
- **Flags:** schema change · worker-protocol change · **write an ADR** covering how user edits relate
  to append-only history.
- **Accept when:** correcting a title updates shelf, search index and detail with no reload; the prior
  value remains inspectable; removing a book can be undone.

### R4 — Prove the lookup is worth building  *(gate for R5)*

**This is a script, not a feature. It changes no product code.** It is also the cheapest, highest-value
thing in the whole plan — see § Investigations, probe 1. Do not skip it and do not proceed to R5 until
it has an answer.

### R5 — ISBN → title  *(F-04, F-02)* — **requires R4**

ADR 0016 closes: *"Metadata lookup is not covered by this ADR… adding that would send a different
question to a different endpoint and require its own decision."* That decision is now the difference
between a working camera and a decorative one.

The endpoint is verified: `https://openlibrary.org/api/books?bibkeys=ISBN:{isbn}&format=json&jscmd=data`
returns title and authors and sends `access-control-allow-origin: *`. No account, no key. Same service,
same consent question, same disclosure shape as the cover lookup ADR 0016 already reasoned through.

- **F-04 — the lookup.** Extend the existing `setCatalogCovers` consent into a single "Look things up
  on openlibrary.org" permission covering covers *and* titles. Reuse what is already built in
  `apps/web/src/catalog-cover.ts`: the 3.1 s rate limiter, the durable queue, the cached
  hit/miss/failure states, and the live network indicator that names the host with a Stop link.
  Present the result as a **confirm card**, never a silent write (rule 7).
- **F-02 — title no longer required.** `apps/web/src/routes/add.tsx` marks the title input `required`,
  so a scanned or pasted ISBN cannot become a book. Make title required only when no ISBN was
  supplied. With lookup on, an ISBN produces a title; with it off, offer "Add without a title" so the
  record lands and can be named later.
- **Flags:** worker-protocol change (`lookupIsbnMetadata`) · CSP change (add `openlibrary.org` to
  `connect-src` — in whatever single place R1 established) · **ADR 0017** extending 0016 from cover
  bytes to bibliographic facts · no new dependencies.
- **Accept when:** consent off → zero requests, asserted at the network layer rather than by stubbing;
  consent on → confirm card, one-tap accept, editable reject; offline → degrades to the typed path;
  submitting a valid ISBN with an empty title puts an identifiable book on the shelf.

### R6 — Camera to the front  *(F-03)* — **requires R5**

Scanning works — 792 ms to a valid EAN-13, correct Bookland handling, native-detector fast path with a
self-hosted zxing-wasm fallback, precached for offline. It is also off by default, buried under
Settings → Experiments 1,208 px down the page, four taps from a cold open. And after a successful scan
the title field is still empty, so the scan path costs *more* than typing.

R5 fixes the payoff. This release fixes the discovery.

- **Fix:** promote the scan button to the top of Add for any device with a camera; retire the
  Experiments flag and its stored preference. Request camera permission on the scan tap, never on app
  open.
- **Keep:** the three failure paths in `apps/web/src/components/scan-dialog.tsx` are already well
  written — distinct copy for refused permission vs. absent camera, an already-on-shelf branch, and
  "You can always type the ISBN in instead". Preserve all of them. Add "Scan another" so a stack of
  books doesn't restart the flow.
- **Note the iOS tax:** Safari has no BarcodeDetector, so most iPhone users download the ~464 KB gzip
  wasm decoder on first scan. It is precached and paid once. Keep loading it on the scan tap rather
  than at startup — the code already does this; don't regress it.
- **Flags:** new permission surface · removes a stored flag · no schema.
- **Accept when:** from a cold open, scanning puts a correctly-titled book on the shelf in ≤3 taps and
  0 keystrokes; all three failure paths keep the typed fallback reachable; the payload budget test
  still passes.

### R7 — Browsing polish  *(F-10 and the Next tier)*

- **F-10 — shelf chrome outweighs content at small counts.** With one book the shelf renders a search
  input, a sort `<select>`, a "Select books" toggle and a count. Reveal search and sort above ~12
  books; move "Select books" into a long-press or overflow affordance. Give the reclaimed space to an
  "Add another book" tile as the last cell of the grid.
  *Accept when:* at ≤11 books the shelf shows covers and one add affordance and nothing else; at 12+
  the controls appear without layout shift.
- **Add-another momentum loop.** After the first successful add, offer the next add prominently — the
  engine is already fast enough (199 ms per book).
- **Density.** Tile min-width 150 → ~116 px on mobile gives 3 columns instead of 2. Do this after R1,
  when real covers exist.
- **Hide Activity** from the nav until at least one reading is logged, extending the rule the app
  already applies to Discover and Tasks.

---

## Investigations

Run these with `/adoption investigate`. They change no product code.

**Probe 1 — does Open Library actually know children's picture books?** *(gates R5)*
Write a script that takes ~100 real children's-book ISBNs and queries
`https://openlibrary.org/api/books?bibkeys=ISBN:{isbn}&format=json&jscmd=data`. Report: hit rate,
how often a title comes back, how often an author comes back, and how often the title is
recognisably correct. **If coverage is thin, R5 collapses and the entire Now list reorders** — the
camera becomes a nice-to-have and generated covers become permanent, which raises the priority of
making them beautiful over making them real. Ask the user for a real ISBN list if you don't have one;
a synthetic list of bestsellers will overstate the hit rate, so say so if you use one.

**Probe 2 — CSP and header drift.** Assert the deployed policy matches the intended one. Fetch the
deploy target if it exists; otherwise serve `apps/web/dist` locally with `_headers` applied and probe
both hosts from the main thread *and* a worker. This is the regression test for R1's root cause.

**Probe 3 — cover coverage.** Once R1 and R5 land, count what fraction of ISBN-bearing books actually
have stored cover bytes. This is measurement metric #5 and the single best proxy for whether the whole
adoption thesis worked.

**Probe 4 — baseline drift.** Re-run the first-run budget harness (below) and diff against the
baseline table. Report regressions as findings.

---

## Land the measurement harness

The audit's instrumentation lived in a scratchpad. Make it a real test —
`tests/browser/first-run-budget.spec.ts` — so these numbers stay honest. It should assert, against the
production preview at 375×812:

- cold open → empty state, and → first book confirmed, under CPU throttle
- taps and keystrokes on the typed path
- focus stays in the Title field across five consecutive adds
- log-a-reading in 2 taps
- no `[data-testid="first-run"]` for a returning user with books (F-09), by frame sampling
- every standalone control ≥44×44 at 320 px (F-11)
- no horizontal overflow at 320 px

Useful details learned the hard way, so you don't repeat them:

- Each Playwright context is storage-isolated, so a **fresh context is a cold install**. Do not
  pre-navigate to wipe storage — it warms the HTTP cache and understates the cost.
- Do not try to clear OPFS from the page: the live SQLite worker holds a lock and `removeEntry` throws
  `NoModificationAllowedError`.
- `locator.isVisible()` does **not** auto-wait. Use `expect(...).toBeVisible()` or you will measure
  your own race and report it as a product bug.
- Timing from outside the browser measures tool latency, not the app. Instrument inside the page with
  `addInitScript` before app code runs.

---

## Cannot be automated — do not attempt

Report these as outstanding and stop. Substituting a synthetic proxy and reporting it as evidence
violates rule 8.

- **The 100-book, six-device field test.** Glare, curved spines, sticker-covered barcodes, board books,
  pre-ISBN books. `NOTES.md` already earmarks it. It is now the highest-value unrun test in the
  project, and it decides whether scanning ships or is killed (<60% one-tap success ⇒ kill).
- **Moderated first-run sessions.** Whether parents find the camera; where their thumb goes first.
- **Asking parents whether they'd accept a network lookup at all.** If the privacy promise is the main
  draw, most may refuse — which changes R5's value.
- **Whether logging readings is the actual job,** or whether households only want a duplicate-purchase
  checker. If the latter, a large part of the app is Hide-list material.
- **iOS Safari verification.** Every claim about it is inferred from MDN and caniuse, not a device.

---

## Report at the end

1. What you changed, by release, with the acceptance test that now covers it.
2. Re-measured numbers against the baseline table — call out regressions.
3. What you investigated and what the answer was, including answers that kill downstream work.
4. What is blocked, and precisely what a human must do to unblock it.
5. Any finding you deliberately did not do, and why.

Be candid. If a fix made something else worse, say so plainly. If the audit was wrong about something
— it made three measurement errors of its own — correct it and move on.
