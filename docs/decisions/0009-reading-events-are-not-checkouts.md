# ADR 0009: Separate checkout observations, acquisition episodes, and reading sessions

- **Status:** Accepted
- **Date:** 2026-08-13

## Context

Library history proves acquisition, not that a family read a book. At the same time, repeated
acquisition is valuable preference evidence and needs cross-card/source deduplication.

## Decision

Immutable checkout observations cluster into disposable acquisition episodes per work and
reader. The default merge window is seven days. Gaps of 8–89 days form reduced-weight near
repeats; gaps of 90 days or more form strong repeats. Thresholds live in household configuration
and projections are rebuilt after attribution or identity changes.

Confirmed reading sessions are explicit user records with participants, duration, context, and
optional notes. Work/reader assessments store two 0–3 controls—child engagement and adult
tolerance—plus request-by-name, veto, estimated duration, and read-aloud traits. These user
records are not deleted during projection rebuilds.

## Consequences

The recommendation layer gets recurrence and assessment signals without making false reading
claims. The UI can show imported observations, inferred acquisition episodes, and confirmed
sessions independently. Corrections are safe because all derived preference state is replaceable.
