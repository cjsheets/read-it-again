# ADR 0018: Corrections overlay source book data

- **Status:** Accepted
- **Date:** 2026-08-18

## Context

A title or author can be wrong whether a parent typed it or it arrived in an import. Parents need to
fix what the shelf shows, search the corrected value immediately, and still be able to inspect what
was there before. The same recovery rule applies when a book is removed accidentally.

The existing `works` and `editions` rows are source and resolution evidence. Updating them in place
would make a correction look like the original observation and contradict ADRs 0004, 0005 and 0008.
Deleting a work would also cascade through reading sessions, assessments and attribution evidence.

## Decision

User-authored title and author changes are append-only rows in `work_detail_edits`. Each row stores a
complete display snapshot and a per-work revision. Shelf and search reads use the latest snapshot,
falling back to the original work and edition when no correction exists. The search projection is
replaced in the same transaction that appends the correction. Work and edition identifiers do not
change, so covers and all historical relationships remain attached to the same work.

The detail view exposes the original value and every correction in revision order. Encrypted
archives include these rows.

Removing a book appends `removed` to `work_shelf_events`; undo appends `present`. The latest event
controls whether shelf queries and the shelf count include the work. Neither action deletes the
work, its source records, or its reading history. Encrypted archives include this event stream too.

## Consequences

Corrections cost an additional overlay join on shelf reads and one search-projection write. This is
bounded by one latest row per visible work and preserves the paging boundary in ADR 0014.

“Remove from shelf” means hidden from the active bookshelf, not erased from the archive. A future
permanent-deletion feature would need a separate policy for all dependent evidence and is outside
this decision.

Revisions are allocated inside a transaction. The browser worker already serializes its messages,
while the transaction and unique `(work_id, revision)` constraint protect the repository invariant
for other runtimes.
