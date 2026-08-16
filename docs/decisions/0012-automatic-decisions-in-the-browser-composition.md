# ADR 0012: Automatic resolution and attribution defaults in the browser composition

- **Status:** Accepted
- **Date:** 2026-08-16

## Context

ADR 0006 and ADR 0008 make resolution and attribution deliberately conservative: weak or
conflicting evidence becomes visible work rather than a false assignment. That is the right rule
for the local runtime, which has a KCLS catalog and MARC metadata to reason about.

The browser has neither. ADR 0002 records that KCLS does not return CORS headers, so the PWA's
catalog port returns zero candidates by construction. ADR 0011 makes the PWA an offline file
client. The conservative rules therefore run with no evidence at all, and always reach the same
two conclusions: no candidate, so the record cannot resolve; no evidence, so attribution needs a
human.

The audit measured the consequence. A 3-row CSV produced 3 records, 3 pending resolution cases,
and 0 books on the shelf; resolving all three moved them to attribution review and still produced
0 books. Two of the four documented input paths delivered no user-visible value at all, and at the
1200-book scale that is 2400 decisions. Manual entry worked only because the worker attributed it
directly. This was audit finding F-01, the highest-severity item in the report.

Making the domain rules less conservative would fix the browser and damage the local runtime,
where the evidence is real and the caution is earned.

## Decision

A composition may pass `CompositionDefaults` to the resolution and attribution application
functions. The local runtime passes none and is unchanged. The browser passes both:

- **`acceptSourceDetails`** — when a resolution case has no catalog candidate and the source
  record has a title, create the work from the record's own title and authors. Applied only to a
  case created in the same pass, so a case a person deferred stays deferred.
- **`assignSingleReader`** — when the domain rules did not reach `assigned` and the household has
  exactly one candidate reader, assign to that reader. Skipped when the assessment carries any
  catalog-derived signal (`call_number_audience`, `marc_audience`, `juvenile_heading`,
  `juvenile_genre`), so a considered "this is adult material" is never overridden by a default.
  The negative `digital_adult_prior` signal is a prior calibrated on household history the browser
  does not have, so it does not block the default.

These are defaults, not bypasses. The audit trail is unchanged in shape:

- Automatic resolutions are written by the same append-only path as human ones, with confidence
  `0.5` rather than `1`. That distinguishes them without a schema change.
- Automatic attributions are written as `method='evidence_rules'` with an explanation beginning
  "Attributed automatically…", and carry a `single_reader_default` evidence row.
- Both supersede rather than delete, so a later human choice appends a new current record that
  points at the automatic one it replaced.

The defaults must be threaded through every application function that recomputes attribution,
including `correctAttribution`. `recomputeAttributions` re-derives every record on each call, so a
correction made without them would silently revert every other book to review.

## Consequences

A CSV or Libby import lands on the shelf with zero decisions, which is what makes the product's
own front door work. A one-reader household never sees a review queue, because with one reader
the question has a single possible answer; the queue reappears when a second reader exists.

The cost is that a wrong attribution is now silent rather than asked about. Three things bound it:
the explanation says the decision was automatic and invites correction, the decision is reversible
by supersession, and the default never overrides catalog evidence. Increment 5's book detail view
is where that reversal becomes reachable for a book already on the shelf; until then the only
correction path is the review queue, which a single-reader household does not see.

If a household adds a second reader, previously automatic single-reader attributions stay as they
are until something triggers a recompute, at which point ambiguous records move to review. That is
the correct outcome but it is a visible change in behaviour, and it is worth surfacing in the UI
when reader management ships in Increment 7.
