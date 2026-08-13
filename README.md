# Read It Again

A local-first family bookshelf and read-aloud tracker. Phase 3 adds strict BiblioCommons
physical-history ingestion, local-only browser acquisition, and deterministic attribution
from an exclusive child's library card.

## Prerequisites

- Node.js 22 or newer
- pnpm 11
- Chromium installed for Playwright (`pnpm exec playwright install chromium`)

## Development

```sh
pnpm install
pnpm check
```

`pnpm check` verifies formatting, linting, TypeScript, native SQLite conformance, and
browser SQLite-WASM/OPFS conformance.

Start the current browser client with:

```sh
pnpm --filter @read-it-again/web dev
```

The client stores snapshots and normalized inbox records in SQLite through browser OPFS.

## Local catalog resolution

Build the workspace, import a Libby snapshot into a native database, then resolve it against
the public KCLS catalog:

```sh
pnpm build
pnpm --filter @read-it-again/local-api import:libby -- timeline.json data/read-it-again.db
pnpm --filter @read-it-again/local-api resolve -- data/read-it-again.db
```

KCLS requests are sequential, delayed for courtesy, retried with exponential backoff, and
persistently cached. The resolver automatically accepts only clear matches; ambiguous or
missing results remain in the resolution queue.

## Local physical-history import

Create an authenticated Playwright storage-state file by signing into BiblioCommons in the
opened browser, then close that browser:

```sh
pnpm exec playwright codegen --save-storage=secrets/child-card.json \
  https://kcls.bibliocommons.com/v2/print/recentlyreturned
```

Keep that session file private and outside version control. Import the full “Recently
Returned” history and then resolve it:

```sh
pnpm --filter @read-it-again/local-api import:bibliocommons -- \
  secrets/child-card.json data/read-it-again.db
pnpm --filter @read-it-again/local-api resolve -- data/read-it-again.db
pnpm --filter @read-it-again/local-api enrich -- data/read-it-again.db
pnpm --filter @read-it-again/local-api shelf -- data/read-it-again.db reader-child
```

The importer creates a separate browser context per configured card, walks “Load next 50”
until it disappears, and fails instead of saving partial data when authentication,
pagination, or selector validation fails. `CHILD_PERSON_NAME`, `CHILD_CARD_ID`, and the
other `CHILD_*` environment variables customize the default exclusive-card identity.

Enrichment fetches MARC once per resolved KCLS edition and recomputes attribution using
explicit, explainable evidence. Ambiguous results appear in the browser attribution review;
decisions may apply to one checkout or every checkout of a work.

## Reading model

Attributed checkouts are clustered into rebuildable acquisition episodes: observations within
seven days merge, 8–89-day returns are reduced-weight near repeats, and 90+ days are strong
recurrence. These are preference signals, not claims that a reading occurred.

The family bookshelf separately supports explicit reading sessions and quick assessments:
child engagement, adult tolerance, request-by-name, veto, estimated duration, and read-aloud
traits. A checkout observation, an acquisition episode, and a confirmed session are displayed
as three distinct concepts.

## Architecture

See [docs/architecture/README.md](docs/architecture/README.md) and the decision records in
`docs/decisions/`.
