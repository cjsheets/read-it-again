# ADR 0016: Ask before fetching cover art from a catalog

- **Status:** Accepted
- **Date:** 2026-08-17

## Context

ADR 0011 describes the PWA as an offline file client, and ADR 0002 records that library systems do
not permit browser access. Cover lookup is the first exception: `covers.openlibrary.org` serves
images by ISBN with no account and no credentials.

The exception is narrow but it is real. Each request tells that service one ISBN, which is one book
on this household's shelf, at the time it was added. Over a library that is a readable list of what
a family owns and roughly when they got it.

ADR 0013 introduced the lookup with rate limiting, local storage of the bytes, and cached misses.
It did not gate the lookup on permission. The worker enqueued every uncovered work during startup
and drained the queue, so a household that had never been asked disclosed its shelf on first run.
The Settings copy at the same time said the app could not query a catalog.

## Decision

Cover lookup is refused until the household allows it.

The worker holds the permission and it starts false in every session. Nothing is enqueued and no
request is made until the main thread sends `setCatalogCovers` with the stored answer. A message
that never arrives leaves the feature off, so a failure delivers privacy rather than requests.

The Settings control names `covers.openlibrary.org` directly, states that an ISBN identifies a book
on the shelf, and states what is not sent: no account, no name, no reading history. Granting
permission sweeps the existing shelf, not only books added afterwards.

Withdrawing permission stops the queue before its next request, including part-way through a shelf.
Covers already downloaded are kept, because they are local bytes and deleting them would discard
work without recovering any privacy.

While requests are in flight the app shows a persistent indicator naming the host, with a link to
the setting. It reflects live activity rather than the setting's value.

The CSP allows `connect-src https://covers.openlibrary.org` only. `img-src` is unchanged: bytes are
fetched, downsized, and stored locally, so no remote URL is ever an image source.

The permission is stored per device alongside the other view preferences and persists across
sessions.

## Consequences

Covers do not appear until someone opts in. A household that never opens Settings sees generated
covers, which ADR 0013 already treats as a complete result rather than a placeholder.

The audit asked for per-session consent. This grants it per device instead. Cover fetching is
background work spread over a shelf at one request per 3.1 seconds, and re-consenting on every
launch would train people to dismiss the prompt without reading it. The indicator and the immediate
off switch are what make a standing grant observable.

Permission lives on the device, not in the database, so it does not travel in a backup. Restoring a
shelf onto a new device does not carry an old decision to it.

Whether `covers.openlibrary.org` sends the CORS headers this requires is still unverified from a
real browser. The code assumes it does. If that assumption fails the feature is inert rather than
unsafe, and the decision recorded here still stands.

Metadata lookup is not covered by this ADR. Titles and authors are not fetched, and adding that
would send a different question to a different endpoint and require its own decision.
