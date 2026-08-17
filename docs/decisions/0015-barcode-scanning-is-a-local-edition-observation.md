# ADR 0015: Treat a barcode scan as a local edition observation

- **Status:** Accepted
- **Date:** 2026-08-16

## Context

An ISBN barcode identifies an edition. The browser has no catalog, so a scan cannot supply a title,
author, or cover by itself.

Real-world reliability is still unknown. The planned field test covers 100 books on six devices
and has not been run.

## Decision

The scanner reads EAN-13 with the browser's `BarcodeDetector` when that API explicitly supports
the format. Otherwise it uses a self-hosted `zxing-wasm` decoder. The service worker precaches both
the decoder and its loader so scanning works offline.

A valid scan first checks all ISBN-10 and ISBN-13 variants in the local database. If the edition is
already present, the app opens that book. Otherwise it fills the ISBN field and asks the user for
the title before writing anything.

Manual ISBN entry uses the same check-digit validation and remains available on every scanning
screen.

Scanning is disabled by default and labeled as an experiment. Enabling it is a device-local
setting.

## Consequences

The scanner does not create placeholder titles or perform a catalog lookup. A duplicate can still
be created when an existing work has no ISBN to match.

The decoder adds about 476 KB gzipped to the precached application. Browser tests cover the real
decoder with a generated camera video and verify offline use, but they do not measure a worn
paperback in poor light.

Cover capture is not part of scanning. A cover can still be selected from the book detail view.
