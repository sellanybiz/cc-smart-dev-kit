# Review Axes And Severity

The one home for the review dimensions, the edge-case axes and the severity scale. The
`/cc-smart-dev-kit:review` skill, the `cc-smart-dev-kit:senior-engineer` and
`cc-smart-dev-kit:edge-case-hunter` agents and any skill that walks edge cases read this file. Use only the entries a change touches, and name the ones you skipped in
one line each.

## Review dimensions

1. **Architecture** — the right shape, or the shape the diff fell into? Push for a
   config-driven design where the domain is truly open and change is already coming, and
   guard the opposite just as hard (deliver what was asked; build for a future only when asked):
   an interface with one implementation is a finding too.
2. **Performance** — waterfalls, N+1 queries, bundle weight, re-renders, missing cache. In a
   React or Next.js app, a broken playbook rule is a finding: `/cc-smart-dev-kit:performance-budget`.
3. **Pattern consistency** — does it match its sibling files? A new pattern needs a reason.
   If the old pattern is the wrong one, fix it across the plan's files (beyond them: the core
   instructions' one-plan rule).
4. **Boundaries** — the project's layering and import rules. A violation is Critical.
5. **Shortcuts** — each item on the core instructions' root-cause list, plus magic numbers.
   Each needs the real fix.
6. **Reuse over reinvent** — hand-written code for a job the project or a maintained library
   already does (the core instructions give the order to look in). Name the exact replacement
   when you flag one, and confirm it exists, in the project or in the installed package.
7. **Craft** — would a senior engineer be embarrassed to approve this? Dead code, debug
   output left in, names that lie (`data2`), one function doing five things, nesting that
   should be early returns, clever one-liners, user-facing errors that say "Something went
   wrong". Structure and names: `/cc-smart-dev-kit:code-structure`.
8. **Security** — authentication and authorization checked inside the function, not only at
   the route; input validated at the boundary; no secrets in logs, client bundles or props
   sent to the browser.
9. **Observability** — the project's logger, not stray console output. Errors carry the ids
   needed to trace them (request, user, tenant). Operations that may be retried are
   idempotent (safe to run twice).
10. **Fix the class, inside the plan** — for every finding, search the files the plan changes
    for the same pattern and fix every instance there (`/cc-smart-dev-kit:impact-analysis` § Fix the
    pattern).

## Design findings

Design findings use the same four evidence fields:

| Field | What it needs |
|---|---|
| **Trigger** | A concrete next change: a named second caller or the edit this task makes. |
| **Path** | The real `file:line`s you read. |
| **Outcome** | The concrete cost: copies that will drift, a boolean saying the opposite, a function doing three jobs. |
| **Why allowed** | The rule it breaks: a `code-structure` section, the project's add-on or rule. |

Refute it against project conventions and sibling files: an established shape may already
justify it. Taste with no rule is a hunch. Apply § Severity below: most design findings are
Suggestions; a lying name or a boundary violation ranks higher for its concrete outcome.

## Edge-case axes

Attack only what applies.

- **Data and input** — empty, zero, one, many; null vs undefined vs a missing key; untrusted
  shapes from webhooks, URL parameters or local storage (validated with a schema, or cast?);
  long strings, emoji, right-to-left text, newlines; money rounding, cents vs units, `NaN`;
  dates across time zones and daylight saving; internal id vs public id.
- **State and timing, the richest vein** — double-click submit; a webhook delivered twice;
  two tabs; read-modify-write with no lock; events out of order; the same job run twice
  (a real idempotency key, or hope?); partial failure after steps 1–2 were written; an answer
  landing on a component that is gone; a cache key missing the tenant id; queue retries;
  realtime reconnect gaps; a stream cut mid-answer.
- **Access and money, highest severity** — can tenant A read tenant B's row? Is the tenant
  id in the query, the cache key and the realtime channel? A viewer doing an owner's action;
  a private field in a public response; a double charge, a charge without delivery, a replayed
  webhook.
- **Environment** — a provider down, or answering 200 with an error body; rate limits; a
  phone-sized screen; dark mode; keyboard only; deploy skew: new code reading a column
  production does not have yet. Check the migration is merged and backfilled before the code
  ships.

## Severity

- **Critical** — money lost, data destroyed, one customer sees another's data, missing
  authorization, a boundary violation, a silent failure nobody can recover from. Fix it
  before the commit.
- **Warning** — real users hit it on a normal path. Fix it, or get the person's explicit yes
  to ship it knowingly.
- **Suggestion** — a narrow trigger, cosmetic, recovers by itself. Fix it if cheap.

Bias upward when unsure. If everything is a Suggestion, say so plainly.
