# ADR 0017: Ask before fetching book details

- **Status:** Accepted
- **Date:** 2026-08-18

## Context

ADR 0016 requires permission before sending shelf ISBNs to Open Library for cover art. Turning an
ISBN into a title and author has the same disclosure shape: `openlibrary.org` learns one edition a
household is considering or owns, and when it was requested. Unlike a cover, returned bibliographic
facts can also overwrite a parent's understanding of the physical book if treated as authoritative.

The R4 gate found recognizably correct titles for 97 of 100 current bestseller ISBNs. That clears the
70% product gate, but it is an optimistic corpus and does not make any individual result trustworthy.

## Decision

One device-local permission named **Look things up on openlibrary.org** covers both title/author
lookup and cover lookup. It is off by default. The worker begins every session with permission off
and refuses metadata and cover requests until the main thread explicitly grants it.

The permission uses a new storage key. A device that granted the narrower cover-only permission in
ADR 0016 must answer again; expanding an old grant silently would not be consent.

Metadata lookup is a user gesture. The result is shown as a proposal card with **Use these details**
and **Edit them first** actions. Lookup never writes a work, edition, or metadata fact by itself. A
parent’s confirmation uses the existing manual-add path, preserving ADR 0004’s distinction between
an ISBN observation and edition identity.

Title and author hits, misses, and temporary failures are stored in the existing encrypted-backup
HTTP cache. Metadata and cover requests share the same 3.1-second request clock and visible network
activity indicator. Withdrawing permission prevents new work and stops the cover queue. Requests use
no credentials and no referrer.

The CSP adds only `https://openlibrary.org` to `connect-src`; the existing
`https://covers.openlibrary.org` exception remains. No remote URL becomes an image source.

When permission is off or the network is unavailable, a valid ISBN can still be added with a local
display label containing that ISBN. Typed title entry remains the complete offline path.

## Consequences

Lookup improves the common current-edition path without making the app depend on it. Misses,
placeholder records, offline use, and refusal all retain a usable typed or ISBN-only path.

The permission is standing per device rather than repeated per request, for the reasons in ADR 0016.
Whether real parents accept this disclosure remains human-only evidence.

The R4 percentage must not be presented as household coverage. Bestsellers are better catalogued
than older and less common physical editions, and every returned result still requires confirmation.
