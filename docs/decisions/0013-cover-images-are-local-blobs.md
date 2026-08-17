# ADR 0013: Cover images are local blobs, not remote URLs

- **Status:** Accepted
- **Date:** 2026-08-16

## Context

A bookshelf with no images is a spreadsheet. Books are recognised by their covers,
especially by the pre-reading three-year-old who is half the intended audience, and
visual recognition is the fastest scanning modality a person has. The audit measured
`document.querySelectorAll('img').length === 0` on a populated shelf and found no
cover column in any of seven migrations (F-02).

The obvious implementation is the wrong one. Storing a remote cover URL and letting
`<img>` fetch it means every render of the shelf tells whoever serves those URLs
which books this family owns, on every scroll, from the family's own IP. That is a
continuous leak of exactly the data ADR 0011 exists to keep on the device, and it
would happen silently because it looks like ordinary image loading.

Two existing constraints matter. `img-src 'self' data: blob:` and
`connect-src 'self'` mean the current CSP already forbids remote images. And
`Cross-Origin-Embedder-Policy: require-corp`, which SQLite-WASM requires, blocks
cross-origin resources a second time unless they carry `Cross-Origin-Resource-Policy`.

## Decision

Cover bytes live in this household's own database, in `cover_images` (migration 8),
and render through `URL.createObjectURL`. **The CSP does not change**, because
`img-src ... blob:` already permits exactly this. The visual transformation
therefore costs nothing in privacy posture, which is the point worth stating
loudest: the shelf gets faces without the app gaining the ability to phone home.

- One current cover per work. `source` records where the bytes came from
  (`user_photo`, `user_file`, `catalog`) so a better source can later replace a
  weaker one without guessing.
- Stored covers are capped at 400×600 and 60 KB, enforced in `saveCoverImage` and
  applied by downscaling before the write. A phone photo is several megabytes; the
  shelf never renders a cover larger than a few hundred pixels, and both the OPFS
  quota and the encrypted archive would notice the difference.
- Cover bytes are **not** part of the shelf payload. The shelf carries a
  `hasCover` flag and the bytes are fetched per work, because a thousand covers at
  the cap would be 60 MB through a single `postMessage`.
- A book with no stored cover gets a **generated** cover: the title in the serif
  face over one of eight muted hues chosen deterministically from the work id.
  Generated covers are drawn, never stored — they cost no OPFS and no archive
  bytes, and they are identical on every device because the input is the id. Every
  hue was measured against the cream text rather than eyeballed: the ratios are
  8.14:1 to 10.90:1, all clearing 4.5:1.
- The archive payload becomes `read-it-again-logical-v2`. JSON cannot hold raw
  bytes, so binary columns are wrapped as `{"$bytes": "<base64>"}`. v1 payloads
  contain no binary columns and are still accepted, so a household that backed up
  before covers existed can still restore.

If a catalog cover source is ever added (Increment 9, gated on the Open Library
CORS question), it fetches **once**, on an explicit per-request user action, and
stores the bytes. It never renders from a remote URL.

## Consequences

An all-manual shelf that has never touched a catalog looks intentional rather than
broken, which matters most for the two personas who will never connect a library
account. No cover source can leak the shelf by rendering it.

The costs are real and bounded. Archives grow by up to 60 KB per book that has a
stored cover, which is why the cap exists and why generated covers are not stored.
Per-work cover fetches mean one worker round trip per visible book with a stored
cover; that is acceptable while covers are user-set and rare, and it should be
folded into the paged query surface when Increment 6 virtualizes the grid.

Thumbhash blur-up placeholders, which the audit suggests, are deliberately not
built. They pay off when thumbnails arrive slowly over a network; these bytes come
from local OPFS, and the real fix for scroll behaviour is virtualization rather
than a placeholder. Adding a hash format now would be speculative and would have to
be versioned in the archive alongside the bytes.
