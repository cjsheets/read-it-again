# ADR 0012: Let the browser resolve source details and assign a single reader

- **Status:** Accepted
- **Date:** 2026-08-16

## Context

The shared resolution and attribution rules are conservative because the local runtime has KCLS
and MARC evidence. The browser has neither. Its catalog adapter returns no candidates, so CSV and
Libby imports used to stop in two review queues before a book reached the shelf.

Making the shared rules more permissive would also change the local workflow, where ambiguity is
real and review is useful.

## Decision

The application accepts optional `CompositionDefaults`. The local runtime passes none. The browser
passes two:

- `acceptSourceDetails` creates a work from the imported title and authors when a newly created
  resolution case has no catalog candidate.
- `assignSingleReader` assigns an otherwise unresolved record when the household has exactly one
  reader. It does not override catalog-derived audience evidence.

Both choices use the normal append-only decision paths. Automatic resolution records confidence
`0.5`. Automatic attribution records a `single_reader_default` evidence row. A later correction
supersedes either decision.

Every application path that recomputes attribution must receive the same defaults. Otherwise a
correction to one book could move unrelated books back into review.

## Consequences

CSV and Libby imports reach the shelf without requiring two decisions per row. Adding a second
reader disables the attribution default and may move ambiguous books to Tasks.

An automatic assignment can be wrong. The book detail view allows correction, and existing catalog
evidence still takes precedence over the browser default.
