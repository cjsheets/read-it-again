# ADR 0002: Keep automatic KCLS access in the local runtime

- **Status:** Accepted pending a new endpoint probe
- **Date:** 2026-08-12

## Context

A live request to KCLS OpenSearch on 2026-08-12 returned no
`Access-Control-Allow-Origin` header. Browser JavaScript cannot read the response, and a
service worker cannot bypass CORS.

## Decision

Automatic KCLS search, MARC enrichment, and holdings retrieval run through the user-owned
local runtime. The browser-only build supports imported/cached catalog data and manual
resolution. The project will not add a hosted catalog proxy because doing so creates a live
service and a new data custodian.

## Consequences

The browser build is intentionally reduced-capability until KCLS exposes a verified
browser-readable endpoint. A native iOS container may later implement the catalog port with
native HTTP, which is not governed by browser CORS.
