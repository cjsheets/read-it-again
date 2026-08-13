# ADR 0008: Preserve metadata facts and recompute attribution by explicit precedence

- **Status:** Accepted
- **Date:** 2026-08-13

## Context

Shared cards and adult-heavy digital history need conservative attribution. Catalog providers
can disagree, and a correction must propagate without rewriting source observations or hiding
why the previous result existed.

## Decision

Enriched values are stored as individual facts with source, source reference, fetch time, and
deterministic precedence: human > MARC > Open Library > Google Books > Hardcover. Effective
metadata is a query over those facts; lower-priority provenance remains intact.

Attribution is tri-state: assigned, confidently excluded, or needs review. Every computed
result stores its algorithm version, score, plain-language explanation, and weighted evidence.
A result has zero or many readers. Recalculation appends a superseding result only when the
effective outcome changes.

Precedence is checkout override > work override > exclusive card > evidence rules > unresolved.
Overrides have explicit scope and may assign multiple readers. Corrections and identity changes
enqueue derived rebuild markers and application-level identity commands recompute attribution.

## Consequences

Weak or conflicting evidence becomes visible work instead of a false assignment. Work-scoped
corrections affect all resolved checkouts of that work, while checkout-scoped corrections win
for genuine exceptions. Immutable imports and prior decisions remain auditable.
