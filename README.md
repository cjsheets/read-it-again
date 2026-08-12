# Read It Again

A local-first family bookshelf and read-aloud tracker. The project is in Phase 0: the
storage and architecture foundations are being proven before ingestion and product UI work.

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

## Architecture

See [docs/architecture/README.md](docs/architecture/README.md) and the decision records in
`docs/decisions/`.
