# ADR 0013: Store cover images as local blobs

- **Status:** Accepted
- **Date:** 2026-08-16

## Context

The original shelf had no images. Rendering remote cover URLs would reveal the household's books
to the image host on every load and would conflict with the PWA's same-origin CSP and COEP headers.

## Decision

Migration 8 adds one current cover per work to `cover_images`. The UI reads the bytes separately
from the shelf page and renders them through `URL.createObjectURL`.

Stored covers are limited to 400×600 pixels and 60 KB. The browser downsizes selected files before
saving them. The database records whether a cover came from a photo, file, or catalog.

A work without stored bytes gets a generated cover based on its ID and title. Generated covers are
not saved.

Cover bytes are encoded as tagged base64 objects in `read-it-again-logical-v2` archives. Version 1
archives contain no binary columns and remain importable.

The browser queues cover lookup after add and resolution operations. ADR 0016 amends this: the
queue is not filled and no request is made until the household grants permission. ISBNs from CSV,
Libby, manual entry, barcode scans, and catalog decisions use the same work-level path. Requests to
Open Library are spaced by at least 3.1 seconds. Hits, misses, and temporary failures are stored so
opening the shelf does not repeat the request.

Remote URLs are never used as image sources.

## Consequences

Archives can grow by 60 KB per stored cover. Cover bytes are fetched from the worker per visible
work rather than included in every shelf page.

Lookup discloses one ISBN to Open Library when an uncovered work is first queued. A stored image or
cached miss prevents that disclosure from recurring on each render. ADR 0016 makes that disclosure
conditional on consent.

The app does not store thumbhash placeholders. Cover bytes already come from local storage, and
the virtualized grid limits the number requested at once.
