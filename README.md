# Read It Again

Read It Again is a family bookshelf and read-aloud tracker. It imports library history, keeps
track of who a book belongs to, records actual reading sessions, and builds a short list of books
to borrow next.

I built it for a household with children using King County Library System (KCLS), Libby, and
physical library cards. The browser app also works as a standalone bookshelf if you would rather
type books in or import a CSV.

Everything is stored locally. The browser app uses SQLite-WASM and OPFS; the command-line workflow
uses native SQLite. There is no hosted account or sync service.

## Running the browser app

You need Node.js 22 or newer and pnpm 11.

```sh
pnpm install
pnpm --filter @read-it-again/web dev
```

Open <http://localhost:4174>. Add a book manually, import a Libby timeline, or import a CSV with
common title, author, ISBN, date, and format columns.

The app supports multiple readers, reading sessions, ratings, local cover images, search, and
encrypted backup. Books with an ISBN may request a cover from Open Library once. The image bytes
are stored locally and later renders use the stored copy.

Barcode scanning is available under **Settings → Experiments**. It reads an ISBN and checks the
local shelf; it does not look up the title. The scanner is still opt-in because it has not been
tested on the planned set of 100 physical books and six devices.

## Importing a KCLS card

The local workflow imports a complete BiblioCommons “Recently Returned” history, resolves the
records against KCLS, adds MARC metadata, rebuilds the reading model, and generates recommendations.

Start with:

```sh
pnpm bookshelf setup
```

The setup command creates `data/bookshelf.json` and opens a browser for the KCLS login. The saved
browser session lives under the ignored `secrets/` directory.

A child's physical card may not have an online BiblioCommons profile yet. Use **Log In/Register**
in the KCLS catalog to link the existing card number and PIN; this does not issue a new card.

Borrowing History is a separate KCLS setting and is disabled by default. Read It Again will not
change it. A parent or guardian must decide whether to enable it under **My Settings → Account
Preferences → Borrowing History → Change**. The history begins with items returned after that
setting is enabled. Older physical checkouts cannot be recovered.

After setup, the normal command is:

```sh
pnpm bookshelf sync
```

Useful related commands:

```sh
pnpm bookshelf status
pnpm bookshelf login
pnpm bookshelf recommend
pnpm bookshelf backup
pnpm bookshelf help
```

Backups are compatible with the browser app. The passphrase is not stored and must be at least 12
characters. Backups default to the ignored `backups/` directory. For unattended backups,
`BOOKSHELF_BACKUP_PASSPHRASE` can be supplied through a secret manager.

## How the data is treated

A checkout is evidence that a book entered the household, not proof that anyone read it. Read It
Again keeps three separate records:

- source observations imported from a library or file;
- acquisition episodes inferred from nearby observations; and
- reading sessions entered by a person.

Attribution and catalog resolution decisions are append-only. Correcting a decision adds a new
one and leaves the earlier evidence available for inspection. Derived shelf and preference data
can then be rebuilt.

Recommendations are deterministic and limited to the KCLS catalog. They use known series,
creators, subjects, genres, ratings, recurrence, and read-aloud traits. Known favorites appear in
a separate “read it again” list. No LLM or optional recommendation service is involved.

## Current limits

- Live KCLS catalog access and BiblioCommons login work only in the local runtime. KCLS did not
  return browser CORS headers when last checked on August 12, 2026.
- The browser stores its database in OPFS. Clearing site data removes it. Export an encrypted
  backup and keep the passphrase somewhere else.
- Automatic cover lookup sends one ISBN to Open Library for a book that has no stored cover. Hits,
  misses, and temporary failures are cached; remote image URLs are never used for rendering.
- The physical-card workflow is specific to the current KCLS/BiblioCommons page structure. A real
  household run still requires a user-owned authenticated session.
- Barcode scanning works in automated Chromium tests, including offline use, but real-world scan
  reliability has not been measured yet.

## Development

Install Chromium once if Playwright does not already have it:

```sh
pnpm exec playwright install chromium
```

Run the full check with:

```sh
pnpm check
```

This runs formatting, ESLint, TypeScript, unit tests, browser tests, the production build, and the
browser-boundary check. The storage contract is exercised against both native SQLite and
SQLite-WASM/OPFS.

The main design notes are in [docs/architecture/README.md](docs/architecture/README.md). Individual
tradeoffs are recorded under [docs/decisions](docs/decisions).
