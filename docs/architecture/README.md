# Architecture

Read It Again uses a hexagonal core with runtime-specific compositions.

```text
web UI ── BookshelfService ── application ── domain
                                  │
                                  ├── repository ports ── SQLite adapters
                                  └── source ports ────── ingestion/catalog adapters
```

The user-owned local runtime can use all adapters. The client-only browser runtime uses
only file/manual ingestion and OPFS storage. Credentialed BiblioCommons acquisition is a
local-runtime dependency and must not appear in browser artifacts.

Native SQLite and SQLite-WASM/OPFS share migrations and observable repository semantics.
The credentialed adapter and its orchestration live in `adapter-bibliocommons` and
`application-local`; neither is reachable from the browser application's dependency graph.

## Import pipeline

```text
complete source snapshot
  → adapter validation
  → versioned normalization
  → transactional snapshot/run/record storage
  → unresolved import inbox
```

Validation precedes all writes. Identical snapshot content and identical source observations
are deduplicated independently, while successful zero-change imports remain visible in the
audit history.

## Resolution pipeline

```text
import record
  → resolution cache
  → ISBN catalog search
  → normalized title + author search
  → scored candidates (top score + runner-up margin)
  → automatic decision or human queue
  → edition → local work
```

Catalog traffic is local-runtime-only, sequential, backed off on retry, and cached in SQLite.
The browser can display populated candidates and always supports manual resolution, rejection,
and deferral without reaching KCLS directly.

## Physical-history and attribution pipeline

```text
isolated authenticated card context
  → walk all “Load next 50” pages
  → strict selector-contract validation
  → versioned physical source-key hash
  → snapshot/run/record storage
  → ordinary resolution pipeline
  → exclusive card owner at confidence 1.0
  → reader shelf
```

Login failure, session expiry, missing selectors, or stalled/incomplete pagination makes the
acquisition fail. No partial page is imported. Physical source identity is
`SHA-256(card, canonical title, canonical author, normalized call number, checkout date)`
under algorithm version `bibliocommons:v1`.

Attribution decisions are append-only. A later human correction supersedes the deterministic
decision without erasing it, and rerunning deterministic attribution never overwrites a
current correction.

## Enrichment and attribution triage

```text
resolved KCLS edition
  → cached MARC fetch
  → per-field facts with deterministic source precedence
  → checkout override
  → work override
  → exclusive-card owner
  → explainable evidence rules
  → assigned | excluded | review
```

MARC parsing extracts audience, juvenile headings, genre/form, contributors, pages, call
number, summary, and series. Attribution outcomes are versioned and may reference multiple
readers. Review cards present the actual evidence in plain language; corrections can target
one checkout or every checkout resolved to a work. Corrections and identity operations produce
rebuild markers, while source observations remain untouched.

## Reading model

```text
assigned checkout observations
  → configurable seven-day clustering
  → initial | 8–89-day near repeat | 90+-day strong repeat
  → reader/work preference summary

explicit household action
  → confirmed reading session with participants, duration, and context
```

Episodes and preference summaries are disposable projections rebuilt from immutable checkouts,
current attribution, and work assessments. Reading sessions and assessments are user-authored
base data. The UI labels all three separately and never treats a checkout as proof of reading.

## Recommendation snapshots

The application recommendation workflow extracts a recency-weighted profile from acquisition
episodes, assessments, MARC subjects/genres/series, contributors, creators, and read-aloud traits.
It asks the catalog adapter for KCLS candidates, filters and scores them deterministically, applies
format, duration, juvenile-audience, author, and subject constraints, and asks for holdings only
after ranking. Catalog calls remain sequential through the KCLS client.

The result is persisted rather than recomputed while rendering. Each discovery or read-again item
stores score components, plain-language evidence, its KCLS catalog key, and a holdings observation
whose cache expires after 24 hours. No optional enrichment provider or LLM participates in the
complete path. Browser code reads snapshots but does not perform live KCLS calls while the catalog
lacks CORS permission.

## Client-only PWA and archive transfer

The PWA composes the shared application and schema packages with SQLite-WASM/OPFS, Libby and CSV
file parsers, and manual entry. Its package graph excludes KCLS, BiblioCommons, and local
orchestration. A build-time scanner repeats that assertion against source manifests and emitted
assets, including hostnames and credential-related identifiers.

The service worker walks the built asset graph from `index.html` and precaches JavaScript workers,
SQLite WASM/proxy assets, CSS, the manifest, and icon. Browser acceptance testing loads the
production build, persists a manual book in OPFS, disables networking, reloads, and verifies the
shelf remains usable. Static-host headers provide cross-origin isolation for SQLite-WASM and a
same-origin-only CSP.

Archive transfer uses a versioned logical-row format inside authenticated AES-256-GCM encryption.
PBKDF2-SHA-256 derives the key from a never-persisted passphrase and random salt. Decryption and
shape/version checks precede a transactional replacement, so wrong keys and malformed archives
write nothing. Catalog and recommendation snapshots travel inside the same encrypted artifact.
