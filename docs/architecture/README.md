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

Phase 0 implements only enough schema and repository behavior to prove that native SQLite
and SQLite-WASM/OPFS can share migrations and observable repository semantics.
