# Browser test suite

Two kinds of test live here.

**Contract tests** describe behaviour the build has today. `storage-conformance`,
`libby-import`, and `pwa` are these. They are green and a failure is a regression.

**Safety-net tests** describe behaviour the audit says the product is supposed to
have and does not yet. Only `performance-budget` still holds these. They exist so
that the largest findings — F-01 (imported books never reach the shelf) and F-04
(the UI renders every row) — are executable statements rather than prose, and so
that the Increment 4 refactor of `main.tsx` has something to refactor against.

Seven of the original eight annotations are gone. Two remain, both in
`performance-budget.spec.ts`, and they are now annotated for a narrower reason
than F-04 as a whole: adding one book to a large shelf still costs a full
attribution recompute and reading-model rebuild, which is O(library). ADR 0014
bounded the read path; making the write path incremental is what would retire
them.

Everything else in F-04 is met and asserted: DOM nodes are bounded and identical
at 500 and 1000 books, a 1000-row import lands inside 10 seconds, and search
answers inside its budget.

Two traps this suite has already fallen into, worth knowing before adding to it.
A DOM-node count taken before the shelf page has loaded reports a spectacular
number for an empty grid — the budget test now waits for tiles and records how
many rendered. And a virtualized list cannot be checked for screen-reader
correctness by axe, which has no way to know the list is windowed, so
`aria-setsize`/`aria-posinset` are asserted directly in `shelf-scale.spec.ts`.

## Why `test.fail()` and not a red build

The audit asks for these findings to become "red builds." Taken literally that
means `pnpm check` fails on `main` for the several weeks it takes Increments 1–6
to land, which destroys the signal for every other change made in the meantime —
including the accessibility work in Increment 1 and the durability work in
Increment 3, both of which ship before the import loop is closed.

So each known-failing assertion carries `test.fail(true, '<finding> … <increment>')`
instead. This keeps the intent and drops the collateral damage:

- The expected behaviour is written down as a real, running assertion.
- The suite stays green, so CI still means something.
- When the fix lands, Playwright reports **"Expected to fail, but passed"** and the
  build goes red at exactly the moment it should — forcing the annotation to be
  removed and the test promoted to a contract test.

The failure mode to be aware of is that `test.fail()` accepts a failure for any
reason, including a crash. That is why each `test.fail()` journey test is paired
with a plain green test asserting the step before it — for example, _"a CSV import
ingests every row"_ passes today and guards _"a CSV import lands every row on the
bookshelf"_. If ingestion itself breaks, the green test goes red.

## Removing an annotation

When an increment lands:

1. Delete the `test.fail(...)` line.
2. Delete the `// F-nn · fixed by Increment n` comment above the test.
3. If the paired guard test is now redundant, leave it — it is cheap and it is the
   only thing distinguishing "works" from "fails differently".

## Budgets

`performance-budget.spec.ts` holds the audit's Tier 3 numbers. DOM node count and
document height are absolute ceilings at any library size; import time scales with
row count. Measurements are attached to the Playwright report as JSON on every run,
so the trend is visible even while the test is annotated as expected-to-fail.

Both scales run against the production preview server on port 4175, not the dev
server, because these are claims about the artifact that ships.
