# ADR 0006: Version and preserve resolution evidence and decisions

- **Status:** Accepted
- **Date:** 2026-08-12

## Context

Identifier-less physical rows and edition-level digital identifiers must converge on works.
A wrong merge destroys repeat-borrow evidence, so optimistic fuzzy matching is more harmful
than a small human queue.

## Decision

Resolution is layered: prior cache, exact ISBN search, title/author search, scored candidates,
then human review. Candidate score components and source snapshots are stored with an
algorithm version. Automatic acceptance requires a top score of at least 0.85 and a margin
of at least 0.15 over the runner-up. Exact ISBN agreement is decisive but still recorded.

Human accept, reject, defer, manual creation, and re-point actions create immutable decision
records. Later decisions supersede rather than delete earlier decisions. Work merge and split
operations are transactional and logged independently.

## Consequences

Threshold changes can be evaluated against golden reviewed cases. Repeated title shapes hit
the resolution cache rather than the catalog. Ambiguous candidates remain visible and cannot
fragment work-level recurrence until resolved.
