# ADR 0015: Barcode scanning is a local edition observation, behind an opt-in flag

- **Status:** Accepted
- **Date:** 2026-08-16

## Context

Adding a book by typing it in is the journey every household uses, and it is four
fields per book. A parent unpacking a library bag or cataloguing a shelf does that
twenty times in a sitting. The audit (§8) asked what the camera could remove from
that, and separated the answers carefully: reading an ISBN off a barcode is
ordinary engineering, and recognising a cover by sight is not something to attempt
in a browser.

Two constraints shape everything below.

The first is that the browser has no catalog. ADR 0002 established that library
and catalog APIs do not permit browser access, and the app's CSP is
`connect-src 'self'`. So a scan can produce an ISBN and nothing else — no title,
no author, no cover. The barcode is an _edition_ identifier, and ADR 0004 already
separates editions from the works they are printings of.

The second is that the audit gates the feature on a field trial it specifies
precisely: 100 books across six devices (§8.5), measuring hit rate in real
lighting on real jackets. That trial has not been run, and cannot be run from
here. Everything known about decode reliability at this point is theory.

## Decision

**The decoder is self-hosted, and its loader is precached along with it.**
`zxing-wasm` defaults to fetching its binary from jsDelivr. That is blocked
outright by `connect-src 'self'`, and even if it were permitted it would fail on
the trip to the library, which is exactly where scanning is worth having.
`prepareZXingModule({ overrides: { locateFile } })` points it at a Vite-emitted
same-origin asset instead.

Precaching it turned out to need a service-worker fix rather than just a URL. The
crawler that walks the bundle matched only absolute `/assets/…` references, and a
dynamically imported chunk is named relatively — so the 1 MB wasm was precached
and its 36 kB loader was silently left behind, which fails offline in the least
obvious way possible. The crawler now resolves relative specifiers against the
file they were found in. It still refuses bare strings like `zxing_reader.wasm`,
which appear inside emscripten glue as arguments to a path resolver rather than as
fetchable URLs; precaching fails the install on a miss, so a looser pattern would
take the whole service worker down.

Measured cost: 1 093 289 bytes of wasm and a 36 kB loader, 476 kB gzipped
together, against the audit's tier-3 budget of 1.5 MB gzipped. A test asserts it
against the real build output rather than trusting this paragraph.

**`BarcodeDetector` is a fast path, never a requirement.** It is used only when
`getSupportedFormats()` actually names `ean_13`. It is absent on iOS Safari,
Firefox and the audited desktop Chromium, and a detector that exists but cannot
read book barcodes is worse than no detector, because it would silently never
match.

**A scan resolves against the local database and writes nothing on its own.** The
ISBN is looked up across all three routes one can arrive by — carried on an
imported row, attached to an edition by a resolution, or recorded directly against
a work — and in both its ten- and thirteen-digit spellings, since a barcode always
reads as thirteen while an imported CSV may hold ten. A hit says _you already have
this_ and points at the book. A miss fills in the ISBN field and hands the person
back the title, which the app has no way to know.

That is a deliberate departure from the audit's v0 sketch, which described
creating a book with an empty title. `works.canonical_title` has a
`CHECK (length(trim(title)) > 0)` constraint, and inventing a placeholder to get
around it would put a book named "Unknown" on the shelf and call it data. Asking
for the one field only a human has is both honest and one tap.

**It ships opt-in, named as an experiment.** The field trial that would justify
enabling it by default has not happened. Turning it on by default means every
household meets a camera permission prompt in a reading tracker on the strength of
an untested guess about hit rates; opting in costs one checkbox. The setting is
device-local, like the reader filter, and the copy says plainly what it does and
does not do before anyone turns it on.

**Manual ISBN entry is validated and stays first-class.** The check digit is
arithmetic — no network, no catalog — so a mistyped digit is caught as it is
typed. Every scanning surface names typing as the alternative, including both
camera-failure messages, because that is the path that works on every device.

## Consequences

Scanning a second printing of a book already on the shelf finds the existing work
rather than creating a duplicate, provided the earlier record carried an ISBN.
Where it did not — which is most Libby rows — the scan is a miss and produces a
new book. That is the correct outcome for what is known, and ADR 0012's
reversibility covers merging them later.

The decoder is precached for every household, including those who never enable
scanning. 476 kB gzipped against an app that already ships a 396 kB SQLite build
was judged the better trade against the alternative, which is a feature that fails
in a library basement.

Decode reliability remains unmeasured on real books. The browser tests decode a
generated barcode through Chromium's fake camera, which proves the decoder is
wired up and reachable offline; it says nothing about a creased paperback in a dim
hallway. The audit's §8.5 trial is still the thing that would answer that, and
shipping this behind a flag is what makes running it possible.

Cover capture during a scan is not built. The existing cover flow (ADR 0013)
already accepts an image from the book's detail view, so the gap is one extra tap
rather than a missing capability.

No catalog lookup happens here, and none is implied. Whether an opt-in network
lookup should exist at all is a separate decision, with its own privacy question,
and it is not made by this ADR.
