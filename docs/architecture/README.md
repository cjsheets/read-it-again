# Architecture

Read It Again has one domain and application core with two runtime compositions.

```text
web UI ── worker protocol ── application ── domain
                               │
                               ├── repository ports ── SQLite adapters
                               └── source ports ────── file and catalog adapters
```

The local runtime can use every adapter. It stores data in native SQLite and can sign in to
BiblioCommons, query KCLS, read MARC records, and check holdings.

The browser runtime accepts files and manual input and stores its database in SQLite-WASM/OPFS.
It has no credential handling or live KCLS client. The dependency graph and the built assets are
both checked so local-only modules, patron hostnames, and credential settings do not enter the PWA.

Both runtimes use the same migrations and repository contract tests.

## Local workflow

`pnpm bookshelf` is the main entry point. Its JSON configuration names the reader, library card,
saved Playwright session, and database. `bookshelf sync` runs acquisition, resolution, enrichment,
reading-model rebuilds, and recommendation generation in one process.

The package-specific commands remain available for debugging individual stages.

## Import and resolution

```text
complete source snapshot
  → validate and normalize
  → store snapshot, run, and records in one transaction
  → consult the resolution cache
  → search by ISBN, then normalized title and author
  → accept a clear match or put it in review
  → attach the edition to a local work
```

Validation happens before the first write. Snapshot hashes and source keys handle duplicate
imports separately, so a successful import with no new rows is still recorded.

KCLS traffic is sequential, retried with backoff, and cached in SQLite. The browser can use catalog
data brought in through an archive, but it cannot make live KCLS requests.

## Physical cards and attribution

Each BiblioCommons card gets an isolated Playwright context. The importer opens every “Load next
50” page and refuses to save a partial result. A signed-out session, disabled borrowing history,
missing selector, or stalled page causes the import to fail.

Once a row resolves, attribution follows this order:

```text
checkout override
  → work override
  → exclusive card owner
  → metadata evidence
  → assigned, excluded, or review
```

Decisions are append-only. A correction supersedes the current decision without deleting the
source observation or the reasoning that produced the earlier result.

Metadata is also stored as individual facts with provenance. Human values outrank MARC, which
outranks the optional external metadata sources defined by the schema.

## Reading model

Checkout observations are clustered into acquisition episodes. Observations within seven days
merge; returns after 8–89 days count as weaker repeats, and returns after 90 days count as strong
recurrence.

These episodes are preference signals. They are not reading sessions. Reading sessions are entered
explicitly and may include participants, duration, context, and notes. Assessments store child
engagement, adult tolerance, request-by-name, veto, estimated duration, and read-aloud traits.

Episodes and preference summaries can be rebuilt after an attribution or identity change. Reading
sessions and assessments are base records and are not discarded during a rebuild.

## Recommendations

The local workflow starts catalog searches from favored series, creators, subjects, and genres. It
scores the returned books, applies audience, format, duration, author, and subject limits, then
checks holdings for the shortlist. Holdings are cached for 24 hours.

Each run is stored as a snapshot with score components, plain-language evidence, catalog identity,
and observed holdings. The UI renders the snapshot rather than recomputing it. No LLM is used.

## Browser storage and archives

The PWA service worker precaches the production asset graph, including the SQLite worker and the
self-hosted barcode decoder. Static hosting must apply the headers in
`apps/web/public/_headers`; SQLite-WASM requires cross-origin isolation.

The database lives in OPFS. Archives use a versioned logical-row format encrypted with AES-256-GCM.
PBKDF2-SHA-256 derives the key from a passphrase and random salt. The passphrase is never stored.
Import decrypts and validates the complete archive before replacing rows in one transaction.

Cover images are stored as bounded local blobs and included in the archive. If a book has an ISBN
and no cover, the browser may fetch one image from Open Library, store the bytes, and cache the
result. The remote URL is not used to render the shelf.
