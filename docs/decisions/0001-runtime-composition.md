# ADR 0001: Compose local and browser runtimes around one application core

- **Status:** Accepted
- **Date:** 2026-08-12

## Context

The project needs a full user-owned deployment and a client-only experience without making
the project custodian of credentials or family reading data.

## Decision

Use shared domain, application, schema, and repository contracts with two compositions:

- a local runtime using native SQLite and all permitted adapters;
- a browser runtime using SQLite-WASM/OPFS and file/manual adapters.

The UI depends on an application service boundary rather than directly on storage or source
adapters.

## Consequences

Repository conformance tests must run against both databases. Some capabilities can differ
by runtime, but their absence is represented explicitly rather than hidden behind a failing
runtime flag.
