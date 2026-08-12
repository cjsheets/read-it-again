# ADR 0003: Keep source secrets outside the bookshelf database

- **Status:** Accepted
- **Date:** 2026-08-12

## Context

The Libby share URL is an unauthenticated bearer secret. BiblioCommons acquisition requires
a patron-authenticated session. Database exports and diagnostics must be safe to share.

## Decision

Libby uses snapshot-and-discard by default: fetch or upload JSON, persist the snapshot, and
do not retain the URL. Optional remembered secrets and BiblioCommons session material live
in an OS secret store and are referenced by opaque IDs outside exported data. Logs redact
secret-shaped values.

## Consequences

Refresh may require a quick user action. That cost is preferable to silently retaining a
six-year reading-history bearer token.
