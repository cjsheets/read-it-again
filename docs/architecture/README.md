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
