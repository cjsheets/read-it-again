# Sanitized source fixtures

These synthetic fixtures preserve the verified source shapes without containing family
history, credentials, bearer URLs, patron identifiers, or real checkout records.

- `libby/timeline.json` models borrowed ebook and audiobook entries, including a missing ISBN.
- `bibliocommons/recently-returned.html` models stable print-view selectors.
- `kcls/opensearch.xml` models a minimal Atom result with ISBN and bib ID.
- `kcls/marc.xml` models the MARC fields needed by later enrichment work.

When source schemas change, add a new fixture instead of silently editing away the old
contract. Fixtures must remain synthetic or deliberately redacted.
