# Read It Again

A local-first family bookshelf and read-aloud tracker. Phase 2 adds explainable KCLS record
resolution, persistent caching, human decisions, and audited work/edition corrections to the
private Libby import inbox.

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

## Architecture

See [docs/architecture/README.md](docs/architecture/README.md) and the decision records in
`docs/decisions/`.
