# ADR 0014: Page and filter browser reads

- **Status:** Accepted
- **Date:** 2026-08-16

## Context

The worker originally returned the entire database after every request, and the UI rendered every
row. At 1,200 books this produced 19,274 DOM nodes, a 279,685 px document, and a 5.7 second add.

## Decision

Mutations return a small `Summary`. Each destination requests only the data it uses:
`listShelf`, `getActivity`, `getTasks`, `getRecommendations`, `getImportHistory`, or
`getCover`.

`listShelf({ query, sort, offset, limit })` returns one page and a total. The shelf fetches
60-book blocks and renders only the rows near the viewport. Tiles include `aria-setsize` and
`aria-posinset` so assistive technology receives the real list position.

Search uses a normalized `work_search` projection instead of FTS5. SQLite-WASM includes FTS5, but
`node:sqlite` does not, and both runtimes share migrations. At this scale a normalized table scan
fits the latency budget. Search normalization keeps leading articles and folds punctuation and
diacritics.

The search projection is updated incrementally. Resolution and attribution work runs only after
operations that can introduce records.

## Consequences

DOM size no longer grows with the full shelf, and ordinary mutations do not return unrelated data.
Destinations may briefly show different revisions while their reads complete; a mutation revision
causes them to refresh.

The virtualized grid needs explicit loading states and accessibility tests. Sorting by author uses
the first edition's author and sorts missing authors last.
