# ADR 0010: Recommendations are catalog-constrained snapshots

- **Status:** Accepted
- **Date:** 2026-08-13

## Context

The household corpus is too small for collaborative filtering. KCLS catalog and holdings calls
are public but belong to a production library system, while optional third-party services and
LLMs would weaken privacy and offline usefulness.

## Decision

Generate candidates only from KCLS OpenSearch queries seeded by favored series, authors,
illustrators, subjects, and genres. Enrich the bounded candidate set with KCLS MARC, apply a
deterministic content score and explicit constraints, then fetch holdings sequentially only for
the shortlist. Cache holdings for 24 hours.

Persist every recommendation run as an immutable snapshot containing its constraints, score
components, human-readable evidence, catalog metadata, and observed holdings. Discovery excludes
known and vetoed works. Known favorites appear in a separate “read it again” list. Author and
subject caps prevent one familiar cluster from occupying the whole batch.

The local runtime performs live KCLS access because the catalog does not currently permit browser
CORS. The shared PWA UI may render cached or imported snapshots but does not bypass that boundary.

## Consequences

Every recommendation is explainable, points to a KCLS record, and carries a time-bounded holdings
observation. Turning off optional providers changes nothing because none are required. Discovery
will be strongest around known creators and series and weaker for uncataloged read-aloud traits.
