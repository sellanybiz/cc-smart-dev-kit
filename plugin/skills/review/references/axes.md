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
2. **Performance** — waterfalls, N+1 queries, bundle weight, re-renders, missing cache, an index
   on a column rewritten on every event that no frequent read needs, a tenant-blind index on a
   multi-tenant table. In a React or Next.js app, a broken playbook rule is a finding:
   `/cc-smart-dev-kit:react-best-practices`.
   **The scale class**, for a change that adds shared capacity (a queue, a cap or pool, a
   per-event read, a notifying trigger, a lock or an append-only table): a global cap or pool
   with no stated limit; interactive work in a bulk lane; no per-tenant fairness; a per-event
   fan-out of reads to every client; a lock held across a read; no lock timeout; a table that
   only grows. In a plan, shared capacity with no **Capacity** answer
   (`/cc-smart-dev-kit:plan-task` § 3) is a finding.
3. **Pattern consistency** — does it match its sibling files? A new pattern needs a reason.
   A sibling copy of a helper is not a pattern (§ Design findings).
   If the old pattern is the wrong one, fix it across the plan's files (beyond them: the core
   instructions' one-plan rule). A guard added to a pattern its siblings share: dimension 10.
4. **Boundaries** — the project's layering and import rules. A violation is Critical.
5. **Shortcuts** — each item on the core instructions' root-cause list, plus magic numbers.
   Each needs the real fix.
6. **Reuse over reinvent** — hand-written code for a job the project or a maintained library
   already does (the core instructions give the order to look in). Name the exact replacement
   when you flag one, and confirm it exists, in the project or in the installed package.
   In UI code, a raw control or hand-made widget where the design system has one is a
   finding: select, table, textarea, radio group, tabs, date input, avatar, menu, combobox,
   dialog. Name the design-system component that replaces it.
   For each new export, long literal, user-facing sentence and helper body the diff adds, search
   the repo for an existing home the three ways of `code-structure` § 3, shared layers first. A
   hit is a finding (import it, or move the helper to the shared layer both callers use). Read
   the brief's `Reuse signals` and the author's `Homes:` lines first when it has them. In a
   plan's round the `reuse` track of `review-split` runs this search; another track names a copy
   it meets but does not run the search. A docs or instruction plan has no reuse track; its
   one-home-per-rule track (`/cc-smart-dev-kit:build` § 6) covers copies.
   Three more rules:
   - A diff line that re-defines a symbol a claim names (`workflow claims` lists them in the
     brief's `Reuse signals`) is a finding: name the claim and the line.
   - Merely similar code carries a `Similar to <path:symbol>` comment at its definition
     (`code-structure` § 5). Search the code with `git grep "Similar to "`. A third copy is a
     finding, "third copy: extract now": a second marker naming the same copy, or a chain (a
     marker naming a copy that carries a marker itself). Markers already on the base are this
     change's finding only when the change adds a copy.
   - Title a finding where the code goes around an existing home "bypassed home: …", and one where
     two copies differ "drifted copy: …". The lead counts the confirmed findings with these two
     titles (`/cc-smart-dev-kit:build` § 6).
7. **Craft** — would a senior engineer be embarrassed to approve this? Names that lie, one
   function doing five things, nesting that should be early returns, clever one-liners,
   user-facing errors that say "Something went wrong". Structure and names:
   `/cc-smart-dev-kit:code-structure`. Every item on its § 11 list (no AI slop) is a finding:
   name the item and its `file:line`.
8. **Security** — authentication and authorization checked inside the function, not only at
   the route; input validated at the boundary; no secrets in logs, client bundles or props
   sent to the browser.
9. **Observability** — the project's logger, not stray console output. Errors carry the ids
   needed to trace them (request, user, tenant). Operations that may be retried are
   idempotent (safe to run twice).
10. **Fix the class, inside the plan** — for every finding, search the files the plan changes
    for the same pattern and fix every instance there (`/cc-smart-dev-kit:impact-analysis` § Fix the
    pattern). When the finding is a bypassed home, the fix also adds the guard that fails on the
    next bypass (a lint rule, a test or a script): inside the plan's files, or handed to the
    person when its file lies outside them. A change that adds a guard to a shared-looking
    pattern (a limit, a lock, a timeout, a scope filter) also searches the sibling features for
    that pattern; a hit outside the plan's files goes where `/cc-smart-dev-kit:tasks` § 1 sends a
    finding (a task in a held plan that owns the file, else the person; the core instructions'
    one-plan rule), never fixed in passing.

## Design findings

Design findings use the same four evidence fields:

| Field | What it needs |
|---|---|
| **Trigger** | A concrete next change: a named second caller or the edit this task makes. |
| **Path** | The real `file:line`s you read. |
| **Outcome** | The concrete cost: copies that will drift, a boolean saying the opposite, a function doing three jobs. |
| **Why allowed** | The rule it breaks: a `code-structure` section, the project's add-on or rule. |

Refute it against the project's written rules. A duplicate finding: a sibling copy is its
evidence, never its excuse; only a written project rule that allows the copy refutes it. Any
other design finding: a written project rule, a documented convention, or an established
pattern its sibling files share refutes it. Taste with none of these is a hunch.

Concrete triggers for a copy, each with its `file:line`s (the full list is `code-structure`
§ 11): another copy of a helper, with the drift between the copies shown; a composite that
several files build from the same shared parts; feature-local plumbing that the shared layer
already offers; a `v1` left beside its `v2` (`code-structure` § 11: dead when nothing calls it, a
half-finished move when callers remain); a function whose only caller is
a test; a third place that switches on the same mode; a "one home" claim in code with no guard.

Apply § Severity below: most design findings are Suggestions; a lying name or a boundary
violation ranks higher for its concrete outcome, and so does a drifted copy whose difference
users can see (different text, a different result), which is a Warning.

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
