# ADR 0014: The browser query surface is paged and filtered

- **Status:** Accepted
- **Date:** 2026-08-16

## Context

Every worker response carried the complete dataset: all import records, both review
queues, the entire reading model and every recommendation. The UI then rendered
every row of it. The audit measured the result at 1200 books — 19 274 DOM nodes, a
279 685 px document, and 5.7 s to add one more book, because every mutation
re-fetched and re-rendered everything (F-04). There was no pagination, no
virtualization, no search, no filter and no sort anywhere.

This is not a far-future concern. Two years of borrowing for two children is
plausibly 400–900 records, and the audit found the app already unusable at 250.

Increment 5 helped without meaning to: moving the assessment form off every shelf
card cut DOM nodes from 45 136 to 13 060 at 1000 books. That closed some of the gap
but not the shape of the problem, which is that per-interaction cost scaled with
library size.

## Decision

**Reads are separated from mutations and asked for by destination.** A mutation
returns a `Summary` of four counts — books, records, outstanding tasks, last backup
— which is constant size whatever the library holds. Each destination then asks for
what it renders: `listShelf`, `getActivity`, `getTasks`, `getRecommendations`,
`getImportHistory`, `getCover`. This is the breaking protocol change the audit
anticipated, and it is what stops opening Settings from costing a thousand shelf
rows.

`listShelf({query, sort, offset, limit})` returns a page plus a total. The shelf
renders only the rows near the viewport, in page-aligned blocks of 60, with two
rows of overscan. The grid is uniform — every cell a 2:3 cover with a fixed-height
caption — which is what allows windowing by arithmetic instead of measurement. That
uniformity was chosen in ADR 0013 for legibility and is now load-bearing twice.

**Search uses a normalised projection, not FTS5.** The spike the audit asked for
came back split: the `@sqlite.org/sqlite-wasm` build ships FTS5, but `node:sqlite`
does not — `CREATE VIRTUAL TABLE … USING fts5` fails with "no such module: fts5".
Both drivers run the same migration list, so an FTS5 virtual table would break the
local runtime and every unit test. Migration 9 therefore adds `work_search`, a
derived projection in the same spirit as `preference_summaries`, holding title and
author folded to a searchable form. At this product's scale a few thousand rows
scan far inside the 150 ms budget, so what FTS5 would have bought is recall rather
than speed — and normalising the text delivers that on its own: "gruffalo" finds
"The Gruffalo!", and "ecole" finds "L'École".

The search normalisation deliberately differs from `canonicalTitle`, which strips
leading articles. That is right for identity matching and wrong for search: someone
typing "the gru" expects "The Gruffalo".

`work_search` is maintained incrementally — only works with no row yet are indexed
— because it runs after every mutation, and the entire point of this change is that
per-mutation work stops scaling with the shelf.

**Screen-reader traversal is preserved explicitly.** A windowed grid tells
assistive technology "1 of 24" when the shelf holds a thousand books. Every tile
carries `aria-setsize` and `aria-posinset` with its true position. axe cannot catch
this — it has no way to know the list is windowed — so it is asserted directly,
the same lesson as the four accessibility defects axe missed in Increment 1.

## Consequences

DOM size and per-interaction cost stop tracking library size. The worker also stops
doing the resolution-and-attribution pass on every request: it now runs only for
operations that can introduce records, so rating a book or logging a reading no
longer pays for a full recompute and reading-model rebuild.

The cost is that the UI now has loading states it did not have, and destinations can
briefly disagree with each other — the shelf may show a count fetched a moment
before Tasks refreshed. A `revision` counter bumped on every mutation keeps them
converging, which is simple and adequate for a single-user local app, and would not
be adequate for concurrent writers.

Sorting by author uses the first edition's authors and sorts nulls last. That is a
simplification worth naming: a work with several editions may sort under an author
that is not the one displayed. It is invisible until the catalog path in Increment 9
starts producing multi-edition works.
