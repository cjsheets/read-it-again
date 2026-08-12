# Read It Again

A local-first family bookshelf and read-aloud tracker. Phase 1 provides a private browser
import inbox for validated Libby Timeline JSON snapshots.

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

## Architecture

See [docs/architecture/README.md](docs/architecture/README.md) and the decision records in
`docs/decisions/`.
