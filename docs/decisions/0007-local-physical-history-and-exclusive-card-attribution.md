# ADR 0007: Keep physical acquisition local and attribute exclusive cards deterministically

- **Status:** Accepted
- **Date:** 2026-08-12

## Context

BiblioCommons physical history requires an authenticated browser session and exposes no
stable row identifier. Its print view is paginated, and a partial scrape would silently lose
records near a short retention horizon. One KCLS card belongs exclusively to the child, which
is stronger attribution evidence than any content classifier.

## Decision

The BiblioCommons adapter and its orchestration belong to local-only packages that the hosted
browser application does not depend on. Each card uses an isolated Playwright browser
context. Acquisition walks “Load next 50” to exhaustion and rejects login pages, expired
sessions, missing selector-contract fields, and pagination that stops making progress.

The versioned physical source key hashes card ID, canonical title and author, normalized call
number, and checkout date. Successful rows enter the existing resolution pipeline. Once
resolved, rows from an exclusive card receive an attribution decision for its owner at
confidence 1.0. Human corrections append a superseding decision and prevent deterministic
reapplication from overwriting it.

## Consequences

Credentialed acquisition code cannot enter the PWA through the shared application package.
Repeated imports create audit runs but not duplicate observations, resolution cases, or shelf
entries. A valid authenticated storage-state file is still required for a real household run;
it is a bearer secret owned and protected by the local user.
