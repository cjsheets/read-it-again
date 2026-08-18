# AGENTS.md — Read It Again

Durable context for any coding agent working in this repo. Tool-agnostic: read this before changing
anything, regardless of which assistant you are.

## What this is

A local-first family bookshelf and read-aloud tracker. An offline PWA (SQLite-WASM + OPFS) with
manual and ISBN entry, Libby/CSV import, encrypted archive transfer, reader shelves, ratings, reading
sessions and deterministic recommendations — plus a separate local Node runtime for BiblioCommons/KCLS
sync and enrichment.

**The premise that decides most design questions:** most users will never connect a library account.
Library sync, Libby import, CSV import and encrypted archives are progressive enhancements for a
minority. "No library sync" is a first-class, fully supported mode, not a degraded one. If a change
makes the app's value depend on any of them, it is the wrong change.

## Fixed architecture boundaries

Work inside these. They are settled; do not re-litigate them.

1. The PWA stays fully useful with **no server and no library account**. Every change must leave the
   typed add path working offline with zero network.
2. Credentialed BiblioCommons acquisition **never reaches the client bundle**. `pnpm check:web-boundary`
   enforces this and must keep passing.
3. The browser makes **no live KCLS catalog calls**. ADR 0002 — KCLS returned no CORS headers when
   last checked (12 Aug 2026).
4. Checkout observations, inferred acquisition episodes, and confirmed reading sessions stay
   **distinct concepts internally**. Renaming them in the UI is encouraged; merging them in the model
   is forbidden.
5. Imported and user-authored data stays **auditable and portable**. A user correction is a new
   record, not an `UPDATE` that destroys evidence.
6. **Adding a book is not reading it. An ISBN does not identify an edition. Cover OCR is not
   authoritative metadata.** Any lookup result is a proposal a human confirms, never a silent write.

Design decisions live in `docs/decisions/`. Read the relevant ADR before changing behaviour it covers,
and write a new ADR rather than quietly contradicting an old one.

## Validation

```bash
pnpm check
```

Expands to format, ESLint, TypeScript, unit tests, browser tests, production build, and the
browser-boundary scan. It must pass before any work is called done.

Narrower loops:

```bash
pnpm test:unit
pnpm test:browser
pnpm check:web-boundary
```

Browser tests run against the **production preview**, not the dev server — these are claims about the
artifact that ships. Playwright's config starts the preview on port 4175 itself.

## Testing rules learned the hard way

**Never stub the network to prove a request is permitted.** Six cover tests used
`page.route('https://covers.openlibrary.org/**')`, which intercepts _before_ CSP is applied. They
passed green over a feature that could not run in production for months. Stubbing is fine for
asserting behaviour _after_ a response; it is never fine for asserting that a request is _allowed_.
Policy assertions must exercise the real policy.

**A fresh Playwright context is a cold install.** Each context has its own OPFS, cache storage,
localStorage and service-worker registry. Do not pre-navigate to "wipe" storage — that warms the HTTP
cache and understates first-run cost.

**Do not clear OPFS from the page.** The live SQLite worker holds a lock; `removeEntry` throws
`NoModificationAllowedError`.

**`locator.isVisible()` does not auto-wait.** Use `expect(...).toBeVisible()`. The naive form measures
your own race and reports it as a product bug.

**Timing from outside the browser measures tool latency, not the app.** Instrument inside the page
with `addInitScript` so the observer is installed before app code runs.

**A fix ships with the test that would have caught it.** The existing suite passed over real bugs; a
fix without a regression test repeats that.

## Measured baseline

Production build, Chromium, 375×812. Throttled = CDP `setCPUThrottlingRate: 4`, 9 Mbps / 70 ms.
Keep these from regressing.

| Measure                                      | Value                                             |
| -------------------------------------------- | ------------------------------------------------- |
| Cold open → empty state (throttled)          | 437 ms                                            |
| Cold open → worker ready (throttled)         | 1,743 ms                                          |
| Cold open → first book confirmed (throttled) | 2,099 ms                                          |
| Taps / keystrokes to first book              | 3 / 12                                            |
| Five books in a row                          | 366, 199, 199, 200, 201 ms — focus stays on Title |
| Log a reading                                | 2 taps, 91 ms                                     |
| 1,200 books                                  | import 3,306 ms · search 187 ms · 833 DOM nodes   |
| Barcode decode                               | 792 ms                                            |
| axe violations (5 screens, WCAG 2.1 AA)      | 0                                                 |
| Returning-user false empty-state flash       | 72 ms                                             |

## Known trap: two CSPs

`apps/web/index.html` carries a `<meta>` CSP and `apps/web/public/_headers` carries a header CSP.
Multiple policies are enforced **independently** — a request must satisfy all of them, so the
effective policy is their intersection. They currently disagree on `connect-src`, which blocks cover
art in production and also blocks Vite's injected styles (the dev server renders unstyled as a
result). Prefer one policy, delivered as a header.

## Conventions

- pnpm workspace, Node ≥ 22. `pnpm install` at the root.
- Commit messages: lowercase imperative, occasionally a conventional prefix (`fix:`, `feat:`, `perf:`,
  `test:`). Do not push unless asked.
- Copy is design material. Write from the user's side of the screen — a parent manages _books_ and
  _readers_, not _works_, _editions_, _provenance_, _resolution cases_ or _attribution triage_. The
  model may use those words; the UI may not.

## What cannot be automated

Do not substitute a synthetic proxy for these and report it as evidence. Say they are outstanding.

- The 100-book, six-device barcode field test (`NOTES.md`).
- Moderated first-run sessions with real parents.
- Whether parents would accept an opt-in network lookup at all.
- iOS Safari verification — every claim about it is inferred from MDN/caniuse, not a device.
