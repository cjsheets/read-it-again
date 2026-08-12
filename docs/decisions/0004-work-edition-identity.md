# ADR 0004: Separate works, editions, observations, and resolution decisions

- **Status:** Accepted
- **Date:** 2026-08-12

## Context

Physical history has no stable identifier; Libby identifies editions; repeated borrowing
must accrue to a work. Resolution mistakes can fragment the strongest preference signal.

## Decision

Represent works as household-local preference identity, editions as manifestations, and
external identifiers as typed records. Preserve immutable source observations and
versioned resolution decisions. Human corrections supersede decisions rather than erasing
history. Acquisition episodes and preference data are recomputed from observations.

## Consequences

Merge, split, and re-point operations remain cheap and auditable. Fuzzy title similarity
alone is insufficient to merge editions into a work.
