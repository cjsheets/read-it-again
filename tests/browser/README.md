# Browser tests

These Playwright tests exercise the production PWA against SQLite-WASM/OPFS. They cover imports,
the shelf, tasks, multiple readers, reading sessions, encrypted archives, offline reloads,
accessibility, barcode scanning, and the source boundary.

The suite runs serially because several tests use the same local preview servers and because the
performance measurements are easier to compare without concurrent browser work.

## Performance checks

`performance-budget.spec.ts` imports 500 and 1,000 books and records:

- import time;
- time to add one more book;
- DOM node count;
- rendered tile count;
- document height per virtualized row; and
- search response time.

The measurements are attached to the Playwright report as JSON. The test waits for shelf tiles
before counting the DOM; otherwise an empty asynchronous page can look like an excellent result.

The original audit used an absolute 20,000 px document-height limit. That was useful when every
book rendered a full form, but it does not fit a virtualized cover grid whose scrollbar represents
the complete shelf. The current test limits height per grid row and keeps an absolute DOM-node
budget.

Windowing also needs a check that axe cannot provide. Each rendered tile is tested for the correct
`aria-setsize` and `aria-posinset`, so a screen reader gets its position in the full shelf rather
than only the visible window.

## Barcode fixture

Playwright starts Chromium with a generated Y4M video containing a valid EAN-13 barcode. This lets
the tests run the actual decoder instead of stubbing it. The video is generated before Chromium
starts and is not kept in the repository.

The payload test reads the production build and verifies that the decoder and loader remain under
the 1.5 MB gzipped budget.
