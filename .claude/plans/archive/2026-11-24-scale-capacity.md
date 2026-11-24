# Scale and capacity: ask what a change costs at 10x and 100x

**Summary.** An outside audit found an app that would not reach its user target. The cause was
not slow code, but fixed global caps and sizes nobody priced: shared send slots, a small
connection pool read on every event, no lock timeout. No kit step asks what a change costs at
scale, and a guard learned in one feature never reaches its siblings. This plan adds both.

## Context

Approved together with `slop-guards` (`2026-11-24-slop-guards.md`, its § Plan 2 holds the
decision). It waits for that plan's merge: both edit `plugin/skills/plan-task/SKILL.md` and
`plugin/skills/review/references/axes.md`. Verified on `origin/main` (6.3.0):
`performance-budget` § Before the change asks about caching, indexes, N+1, re-renders, the main
thread, bundle weight, feedback and payload size, and nothing about capacity; `axes.md`
dimension 2 lists waterfalls, N+1, bundle weight, re-renders and caching; dimension 10 searches
only the plan's own files.

## Goal

A plan that adds shared capacity states its cost and the scale where it bites, a review can name
the scale defects, and a guard added in one feature is searched for in its siblings.

## Files to change

`plugin/skills/plan-task/SKILL.md`, `plugin/skills/review/references/axes.md`,
`plugin/skills/performance-budget/SKILL.md`, `plugin/skills/react-best-practices/SKILL.md`; plus
the release files (the project's `plans.mergeFiles`), done by the lead.

## Approach

One phase, `capacity` (`rules-maintainer`, `sonnet`, `high`):

- `plan-task` § 3: a plan that adds a queue, a cap, a per-event read, a notifying trigger, a row
  lock or an append-only table answers **Capacity**: cost per user and per event, and the scale
  where it bites. The second read checks it. The body stays at most 300 lines.
- `axes.md` dimension 2, the scale class: a global cap with no stated limit; interactive work in
  a bulk lane; no per-tenant fairness; a per-event fan-out of reads to every client; a lock held
  across a read; no lock timeout; an index on a column written on every event; a tenant-blind
  index on a multi-tenant table; a table that only grows. Dimensions 3 and 10: a change that adds
  a guard to a shared-looking pattern searches the sibling features; hits outside the plan go to
  the person (the core instructions' one-plan rule).
- `performance-budget`: a backend section — connection budget, queue caps, fan-out, herds after a
  restart, growth and retention, scale tests that seed many tenants rather than one big one — and
  a project capacity page kept current like any other doc.
- `react-best-practices`: checks a project can adopt — a virtualizer or an allow-list for long
  lists; render-count tests for high-frequency frames; a context never mixing fast-changing state
  with stable actions; the React Compiler lint setting that catches a set-state in an effect,
  its name and behaviour confirmed in the current docs first.

## Edge cases

- **Skill budgets:** plan-task at most 300 body lines; fold Capacity into an existing question if
  needed.
- **One home:** the scale list lives in `axes.md`; performance-budget and plan-task point at it.
- **Front-end projects:** the backend section and the Capacity answer apply only when the change
  adds one of the named things; a project with none skips them in one line.
- **Neutrality:** neutral examples only; no name or path from the audited project.

## What could break

Every review walks `axes.md`; every plan answers plan-task § 3. A long new list makes reviewers
walk axes that do not apply: the axes file already says to use only the entries a change touches.

## A simpler approach?

Only the axes list. Rejected: a review catches a cap after it is built; the Capacity answer in
the plan catches it before.

## Rollback

Revert the pull request; the release skill's rollback ships the previous version.

## How we prove it

- Per phase: `check:duplicates`, `check:docs`, `check:neutral`, lint; then the full
  `bun run check` and both validates once, in the main session.
- The plan's two `review-split` rounds (`risky: true`; instruction tracks: accuracy against the
  code, one home per rule, contradictions), and the final review only if round 2's fixes are big.
