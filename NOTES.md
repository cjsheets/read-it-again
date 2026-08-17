# Project notes

This file is the short handoff for returning to the project. The detailed design choices live in
`docs/decisions/`; the tests are the current behavior contract.

## Current state

The browser PWA and the local KCLS workflow are both working.

The PWA supports manual entry, Libby and CSV import, multiple readers, attribution correction,
reading sessions, ratings, search, local cover images, encrypted archives, and an offline
application shell. Barcode scanning is available as an opt-in experiment.

The local workflow uses `pnpm bookshelf` for setup, login, status, sync, recommendation refresh,
and encrypted PWA-compatible backup. A personal BiblioCommons acceptance run is still waiting on a
user-owned authenticated session.

Automatic cover lookup is now wired to Open Library for books with an ISBN. The browser stores the
returned bytes and caches hits, misses, and failures. This work is currently uncommitted along with
its migration and tests.

The UX audit is not tracked in this repository. References such as F-04, N7, or X1 in older commit
history refer to that local report.

KCLS OpenSearch did not return CORS permission headers on August 12, 2026. Live catalog work
therefore remains in the local runtime.

## Verification

Use the full check before committing:

```sh
pnpm check
```

That expands to formatting, ESLint, TypeScript, unit tests, browser tests, a production build, and
the browser-boundary scan.

The browser performance suite runs against the production preview on port 4175. Its measurements
are attached to the Playwright report. The barcode tests use a generated camera video, and the
payload test reads the built decoder files.

## Implementation history

The project was built in seven functional phases:

1. Import snapshots transactionally into a schema shared by native SQLite and SQLite-WASM.
2. Resolve ISBNs and title/author candidates while preserving every decision.
3. Acquire complete BiblioCommons physical history from isolated authenticated card sessions.
4. Store MARC facts with provenance and apply conservative reader attribution.
5. Separate checkout observations, acquisition episodes, reading sessions, and assessments.
6. Generate deterministic KCLS recommendations with cached holdings.
7. Ship the file/manual browser composition as an installable offline PWA with encrypted transfer.

The later UX work made the following changes:

- Imported books now reach the shelf automatically in a one-reader browser household. The browser
  accepts source details and assigns the only reader; the local runtime keeps its conservative
  catalog rules.
- Storage durability is visible. Persistent-storage state is queried from the browser,
  `last_backup_at` travels with the archive, and localStorage records that a device previously
  held books.
- The single pipeline-shaped page became separate Shelf, Add, Activity, Discover, Tasks, and
  Settings destinations using a small hash router.
- Shelf cards became a virtualized cover grid with a book detail drawer. Cover files are downsized
  before storage, and generated covers fill the gaps without using archive space.
- Worker reads became paged and destination-specific. Search uses a normalized table rather than
  FTS5 because `node:sqlite` does not include the extension.
- Reader management exposes the multi-reader schema. Readers are archived instead of deleted, and
  a book shared by several readers appears once with multiple reader labels.
- Reading sessions can be corrected after the quick-log action. Bulk filing is available both on
  the shelf and in Tasks.
- Barcode scanning uses native EAN-13 support when available and falls back to a precached
  `zxing-wasm` decoder.

## Things worth remembering

- Clearing all site data also clears the localStorage wipe marker. That case is indistinguishable
  from a first run. The marker catches browser eviction where localStorage survives but OPFS does
  not.
- `navigator.storage.persist()` is only a request. Chromium may deny it based on site-engagement
  rules, so encrypted backups remain the actual recovery path.
- Hash routing avoids static-host rewrites and behaves the same way offline. Reconsider it only if
  the app gains nested parameterized routes.
- Search normalization intentionally differs from title identity normalization. It keeps leading
  articles, so “the gru” finds “The Gruffalo,” and folds diacritics for searches such as “ecole.”
- The virtual grid keeps the full scroll extent. DOM count, not total document height, is the main
  render-cost limit.
- Adding a second reader can move automatically filed books into Tasks because the app no longer
  has a single obvious owner. The bulk action is the intended recovery path.
- A generated barcode in Chromium proves the scanner is wired correctly. It does not replace the
  planned test on 100 books across six real devices.
- Cover images are local after the first fetch, but automatic lookup still reveals one ISBN to
  Open Library. Keep that disclosure explicit in user-facing privacy documentation.

## Open work

- Run the authenticated physical-card workflow with a real household session.
- Run the barcode field test and decide whether scanning should remain experimental.
- Decide whether automatic Open Library cover lookup should remain implicit or become an explicit
  opt-in. The code currently runs it automatically.
- Regenerate and review install screenshots when the shelf or first-run layout changes.
- Recheck the KCLS CORS boundary before designing any browser catalog feature.

The external source plan is in Obsidian at `Efforts/Read It Again.md`.
