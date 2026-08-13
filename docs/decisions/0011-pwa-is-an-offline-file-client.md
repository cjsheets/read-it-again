# ADR 0011: The PWA is an offline file client

- **Status:** Accepted
- **Date:** 2026-08-13

## Context

KCLS does not currently permit browser CORS, and authenticated BiblioCommons acquisition cannot
be safely shipped in a public static client. Browser OPFS data also disappears when a browser
profile is cleared, so a useful PWA needs explicit portable backup.

## Decision

The PWA accepts Libby JSON, generic CSV, and manual/ISBN entries and performs manual resolution,
ratings, shelf browsing, and cached recommendation display without a server. SQLite-WASM stores
the shared schema in OPFS. A service worker precaches the complete production asset graph so an
installed copy reloads without a network.

Logical database archives are encrypted before download with AES-256-GCM and a key derived from a
user passphrase using PBKDF2-SHA-256 with 250,000 iterations and a random salt. Neither passphrase
nor key is stored. Archive import authenticates and validates the entire payload before replacing
local rows in one transaction. The same archive transports catalog and recommendation caches from
a local runtime to the PWA.

The web package has no dependency on the KCLS or BiblioCommons adapters or local orchestration.
CI scans source dependencies and the emitted artifact for credentialed modules, catalog/patron
hostnames, storage-state hooks, and card configuration. The static artifact ships a same-origin
CSP and cross-origin-isolation header contract required by SQLite-WASM/OPFS.

## Consequences

The PWA cannot automatically search KCLS or acquire physical history. This is a visible capability
boundary, not a hidden failure or hosted proxy. It remains useful offline, and users can transfer
their complete bookshelf without exposing plaintext history in the archive file.
