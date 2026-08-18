# Codex goal — new-user adoption remediation

Paste the block below after `/goal` in Codex. Or save it to `~/.codex/prompts/adoption.md` to invoke
it as `/adoption`, then run `/goal` referencing it.

Control it with `/goal` (check), `/goal pause`, `/goal resume`, `/goal clear`.

**Why it is shaped this way.** Codex goals need one objective and one verifiable stopping condition,
and they fail on loose lists of unrelated work. A thirteen-finding audit is exactly that shape — so
Phase 0 turns the findings into an executable acceptance suite _first_. After that, "the audit is
addressed" stops being an opinion and becomes `tests/browser/adoption/` passing. That is the whole
trick; don't remove it.

---

```
/goal Make Read It Again succeed for a parent who opens it for the first time at 8:45pm, holding a
phone in one hand and a picture book in the other, with no account and nothing synced. Keep working
across turns without stopping until every test in tests/browser/adoption/ passes and `pnpm check` is
green, or until a documented kill-gate or human-only blocker stops a specific item and you have
recorded it in docs/adoption-log.md.

CONTEXT
Read AGENTS.md first — it carries the fixed architecture boundaries, the validation commands, the
measured baseline, and the testing traps that already cost this project real bugs. Read
docs/decisions/0016-ask-before-fetching-cover-art.md before touching anything network-related. Obey
AGENTS.md throughout; it overrides anything convenient in this goal.

THE OBJECTIVE
An adoption audit measured the app and found the first-book path is fast (2.1s throttled, 3 taps) but
that only one of five add paths actually works. Thirteen findings follow. Your objective is not "do
thirteen tickets" — it is to make the acceptance suite in Phase 0 pass, in dependency order.

PHASE 0 — WRITE THE CONTRACT FIRST (do this before changing any product code)
Create tests/browser/adoption/ containing one failing (not skipped) test per acceptance criterion
below. Run them, confirm they fail for the right reason, and commit. This is the stopping condition;
everything after is making it green.

R1 — Unblock covers  [F-01]
  apps/web/index.html sets connect-src 'self'; apps/web/public/_headers sets
  connect-src 'self' https://covers.openlibrary.org. Policies intersect, so covers are blocked in
  production from both the main thread and the worker. Same root cause makes frame-ancestors a no-op
  and leaves the dev server unstyled.
  Fix: prefer deleting the <meta> CSP and letting _headers be the single source of truth. If it must
  stay, generate both from one shared definition so they cannot drift. Verify the deploy target
  actually applies _headers — a deleted meta tag plus an unapplied header file is worse than today.
  ACCEPT: a test that does NOT use page.route asserts a real request to the cover host is permitted by
  CSP; a test asserts meta and header policies do not disagree on connect-src; the dev server renders
  styled.

R2 — Plain language and reach  [F-06,07,08,09,11,12,13]  (UI only; no schema, no protocol, no deps)
  F-06 Add screen gives ~2/3 of itself to CSV and Libby import. Move both to Settings under "Bring in
       books from elsewhere"; leave Add as scan + type with one quiet pointer line. In the detail
       drawer, "Choose a cover" is the filled primary while "Log a reading" is outline secondary —
       swap the weights.
       ACCEPT: Add contains only ways to add one book; "Log a reading" is the drawer's only
       primary-weight control.
  F-07 "How this works" on the first-run screen routes to #settings top-of-page, landing on a
       passphrase field; the Privacy card is ~1,445px further down. Open the explanation in place.
       Reuse the existing Privacy copy verbatim — it is good; do not rewrite it.
       ACCEPT: activating it puts "Your library stays in this browser" in the viewport with no
       scrolling, and focus returns to the CTA on close.
  F-08 apps/web/src/components/shell.tsx renders one status line above every destination and never
       clears it, so "Book added." follows the user to Activity and Settings. Make it transient and
       local; keep a role="status" live region; clear on route change.
       ACCEPT: navigating away from an action clears its message; no destination shows a status line
       about a different destination.
  F-09 shelf.tsx branches on summary.bookCount === 0 and EMPTY_SUMMARY starts at zero, so a returning
       user sees "Your shelf is empty" for ~72ms before their books load. Worst possible sentence for
       a local-first app. Distinguish "not loaded" from "empty" — useWorkerData's undefined convention
       already does this elsewhere. Show a quiet skeleton.
       ACCEPT: a returning user with >=1 book never renders [data-testid="first-run"], asserted by
       animation-frame sampling, not a timed screenshot.
  F-11 At 320px everything respects the repo's own --tap:44px token except "How this works" (97x16)
       and the skip link (146x42). Give .link-button a min-height where it stands alone. Note axe does
       not check target size at AA, so this needs its own assertion.
       ACCEPT: every standalone interactive control on the first-book flow is >=44x44 at 320px.
  F-12 Rename, in rendered copy: "Import archive"->"Restore from a backup"; reader "Archive"->"Hide
       this reader"; "Archive passphrase"->"Backup password"; "Save assessment"->"Save"; "Ratings and
       read-aloud notes"->"How did it go?"; "Veto"->"Don't suggest this again"; "Child engagement /
       Grown-up enjoyment 0-3"->"Kid liked it / I liked it" showing the words already in
       RATING_MEANINGS (no, a little, a lot, loved it) which currently reach only screen readers;
       "Why this reader"->"Who's this for?" and hide it entirely with one reader; "Nothing needs you /
       Needs a decision"->"All tidy / A few to sort out"; Discover's "Deterministic suggestions...
       cached library observation"->"Ideas from what your family already reads. Availability was last
       checked {date}."; delete "Catalog record {key}"; "acquisition episodes derived from
       borrowing"->"Borrowed {n} times - which doesn't mean it was read"; "The local runtime does that
       work"->"A companion app on a computer does that".
       ACCEPT: no user-visible string contains archive (as a verb for readers), assessment,
       provenance, observation, deterministic, or catalog record — asserted by reading rendered text
       from every destination, not by grepping source.
  F-13 Tiles print the title on the generated cover and again in the caption. Suppress the caption
       title when the cover already carries it; keep the author line. Do this after R1.
       ACCEPT: no tile renders the same title string twice.

R3 — Recoverability  [F-05]
  The detail drawer has no way to edit a title, edit an author, or remove a book. A typo at 8:45pm is
  permanent. This is the only journey the audit marked fully blocked.
  Add "Edit details" and "Remove from shelf"; make removal undoable via the status region rather than
  a confirm dialog. AGENTS.md rule 5 applies: a user correction must stay auditable, so this is most
  likely a correction record, not a destructive UPDATE — read
  packages/storage-schema/src/migrations.ts and the existing correction patterns first. The generated
  cover hue derives from the work ID, so a title fix must not change a book's colour.
  Flags: schema change, worker-protocol change, and WRITE AN ADR covering how user edits relate to
  append-only history.
  ACCEPT: correcting a title updates shelf, search index and detail with no reload; the prior value
  stays inspectable; removal can be undone.

R4 — KILL GATE. Do this before R5 and do not skip it.
  Write a script (no product code) that queries
  https://openlibrary.org/api/books?bibkeys=ISBN:{isbn}&format=json&jscmd=data for ~100 real
  children's picture-book ISBNs. Report hit rate, how often a title returns, how often an author
  returns, and how often the title is recognisably correct.
  This repo has NO real ISBN corpus — editions has 16 rows and no ISBN column. ASK ME for a real list
  before running. If I do not supply one, you may use a published bestseller list, but you must label
  the result as overstating real-world coverage, because a shelf of bestsellers is not a shelf of
  board books.
  GATE: >=70% usable titles -> proceed to R5. <70% -> R5 is killed. Remove its tests from the suite,
  record the number and the decision in docs/adoption-log.md, skip to R7, and tell me the whole Now
  list has reordered: the camera becomes a nice-to-have and generated covers become permanent, which
  raises the priority of making them beautiful over making them real.

R5 — ISBN to title  [F-04, F-02]  — requires R4 passing its gate
  ADR 0016 closes by saying metadata lookup needs its own decision. This is that decision. The
  endpoint is verified: it returns title and authors with access-control-allow-origin: *, no account,
  no key. Same service, same consent question, same disclosure shape as the cover lookup ADR 0016
  already reasoned through.
  Extend the existing setCatalogCovers consent into one "Look things up on openlibrary.org" permission
  covering covers and titles. Reuse what apps/web/src/catalog-cover.ts already has: the 3.1s rate
  limiter, the durable queue, cached hit/miss/failure, and the live indicator naming the host with a
  Stop link. Present results as a CONFIRM CARD, never a silent write (AGENTS.md rule 6).
  F-02: apps/web/src/routes/add.tsx marks title `required`, so a scanned or pasted ISBN cannot become
  a book. Make title required only when no ISBN was supplied; offer "Add without a title" when lookup
  is off.
  Flags: worker-protocol change (lookupIsbnMetadata); CSP change (add openlibrary.org to connect-src,
  in the single place R1 established); ADR 0017 extending 0016 from cover bytes to bibliographic
  facts; no new dependencies.
  ACCEPT: consent off -> zero requests, asserted at the network layer not by stubbing; consent on ->
  confirm card, one-tap accept, editable reject; offline -> degrades to the typed path; a valid ISBN
  with an empty title puts an identifiable book on the shelf.

R6 — Camera to the front  [F-03]  — requires R5
  Scanning works (792ms decode, native fast path, self-hosted zxing-wasm fallback, precached offline)
  but is off by default under Settings > Experiments, 1,208px down, four taps from a cold open — and
  after a successful scan the title field is still empty, so scanning costs MORE than typing. R5 fixes
  the payoff; this fixes the discovery. Shipping this before R5 would point the app's most prominent
  new button at its worst path — do not do it.
  Promote the scan button to the top of Add for any device with a camera; retire the Experiments flag
  and its stored preference; request camera permission on the scan tap, never on app open. PRESERVE
  all three failure paths already written in apps/web/src/components/scan-dialog.tsx (refused
  permission vs absent camera vs already-on-shelf, each with the typed fallback named). Add "Scan
  another" so a stack of books doesn't restart the flow. Keep loading the decoder on the scan tap, not
  at startup — the code already does this; don't regress it. iOS Safari has no BarcodeDetector, so
  most iPhone users pay ~464KB gzip once; that is acceptable and precached.
  ACCEPT: from a cold open, scanning puts a correctly-titled book on the shelf in <=3 taps and 0
  keystrokes; all three failure paths keep the typed fallback reachable; the payload budget test still
  passes.

R7 — Browsing polish  [F-10 + next tier]
  F-10: with one book the shelf still renders search, sort, a "Select books" toggle and a count.
  Reveal search and sort above ~12 books; move Select into a long-press or overflow affordance; give
  the reclaimed space to an "Add another book" tile as the last grid cell.
  ACCEPT: at <=11 books the shelf shows covers and one add affordance and nothing else; at 12+ the
  controls appear without layout shift.
  Then: an add-another momentum loop after the first success (the engine is already 199ms/book); tile
  min-width 150->~116px on mobile for 3 columns instead of 2 (after R1, when real covers exist); hide
  Activity from the nav until a reading is logged, extending the rule already applied to Discover and
  Tasks.

ALSO LAND THE HARNESS
Make the audit's instrumentation a real test at tests/browser/first-run-budget.spec.ts asserting,
against the production preview at 375x812: cold open to empty state and to first book confirmed under
CPU throttle; taps and keystrokes on the typed path; focus staying in Title across five consecutive
adds; log-a-reading in 2 taps; no first-run screen for a returning user; >=44x44 targets at 320px; no
horizontal overflow at 320px. Compare against the AGENTS.md baseline table and fail on regression.

DO NOT CHANGE
- The fixed boundaries in AGENTS.md. No live KCLS calls from the browser; no credentialed
  BiblioCommons in the client bundle; the PWA stays fully usable offline with no account.
- The empty-state copy on the first-run screen, the ERROR_TITLES/ERROR_ACTIONS pairing, the
  generated-cover design, the network indicator, and the scan dialog's failure copy. These are the
  best-designed things in the app; the audit found them all correct.
- The distinction between checkout observations, acquisition episodes and reading sessions. Rename in
  the UI, never merge in the model.
- Any test, into a stub, to make it pass.

VALIDATE
After every release: `pnpm check` must be green, and tests/browser/adoption/ must have strictly more
passing tests than before. Re-run the first-run budget harness and diff against the AGENTS.md
baseline. Never mark a release done on a partial run.

CHECKPOINT
Append to docs/adoption-log.md after each release, and pause for my review after R1, after R4's gate
result, and after R5: what changed, which acceptance tests now pass, re-measured numbers vs baseline,
what regressed, what is blocked and precisely what a human must do to unblock it. One commit per
release, lowercase imperative message. Do not push.

STOP AND ASK, DO NOT GUESS
- Before R4, ask me for real ISBNs.
- If R4's gate fails, stop and report before touching R5.
- If a fix requires changing a fixed boundary or contradicting an ADR, stop and say so.
- These cannot be automated — report them as outstanding, never simulate them: the 100-book
  six-device barcode field test; moderated first-run sessions; whether parents would accept an opt-in
  network lookup at all; whether logging readings is the actual job or whether households only want a
  duplicate-purchase checker; iOS Safari verification.

Be candid in the log. If a fix made something else worse, say so. The audit itself made three
measurement errors and corrected them; do the same.
```
