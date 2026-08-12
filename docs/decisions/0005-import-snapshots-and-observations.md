# ADR 0005: Validate snapshots before storing immutable observations

- **Status:** Accepted
- **Date:** 2026-08-12

## Context

Source exports can be re-imported, malformed, truncated, or changed by their providers. The
local database must preserve provenance without duplicating checkout-shaped observations or
presenting a partial import as complete.

## Decision

Acquisition produces a complete text snapshot. An adapter validates and normalizes the
entire snapshot before storage begins. A SHA-256 digest deduplicates identical snapshots per
source account. A versioned natural source key deduplicates normalized observations. Every
successful attempt creates an import run, including attempts that add zero records.

Invalid snapshots produce structured errors and no database writes. Database writes for a
valid batch occur in one transaction. Raw snapshot and per-row payloads remain local for
audit and future re-parsing.

## Consequences

Re-import is safe and visible. Normalization changes can be introduced as new versions
without losing the original source. Failed database transactions leave no partial run or
record set.
