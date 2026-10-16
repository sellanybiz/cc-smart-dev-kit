---
name: review
description: Review your own finished change before you commit it, then get one second opinion per change set. Walks the review dimensions and the edge-case axes that apply to this diff, proves each finding, and fixes it. Trigger phrases - "ready to commit", "review this", "audit this", "I'm done", "does this look right".
---

# Review — You Are The Reviewer

**Project add-on:** `.claude/cc-smart-dev-kit/review.md` — read it first when it exists. Where it
differs, the add-on wins (`core.md`, top).

You wrote this code. Now read it as if a stranger wrote it and you must approve it with your
name on it.

## When

- **Your own pass:** once per commit of finished work — each phase of a plan, or the whole
  change when there are no phases — when your next action is the commit. The test: "if this
  comes back clean, do I commit right now?" No: you are still building; come back later.
- **The second opinion:** once per change set (§ Second opinion).
- **On request:** "review this", "audit that feature".

**The project's workflow says how strictly this holds.** `cc-smart-dev-kit workflow show` prints
`reviewBeforePush`, and with it on — the default — the second opinion is due before the first
push, and recorded (§ Second opinion). With it off, this skill is still worth running, and the
merge guard asks the person about a merge whose head commit has no record.

**A small fix** skips the second opinion: a typo, wording, a comment, docs only (not
instruction files: rules, skills, agents, settings, hooks), or a one-line fix inside a
pattern already in use. This is the one definition; other skills point here. Say the
exemption in one line.

## How

Read the real diff in full — `git diff` and `git diff --cached`, not a summary. Then work
through the two lists below, but **only the entries this diff touches.** Walking an axis that
does not apply is theatre; name the ones you skipped, one line each.

The bug usually lives between what you changed and what you did not. For every exported
symbol you touched, find its callers (a language-server tool such as Serena where the
project has one, else `Grep`) and read them.

## Review dimensions

1. **Architecture** — the right shape, or the shape the diff fell into? Push for a
   config-driven design where the domain is truly open and change is already coming, and
   guard the opposite just as hard (the core instructions' "best by default"): an interface
   with one implementation is a finding too.
2. **Performance** — waterfalls, N+1 queries, bundle weight, re-renders, missing cache. Deep
   detail: `/cc-smart-dev-kit:performance-budget`.
3. **Pattern consistency** — does it match its sibling files? A new pattern needs a reason.
   If the old pattern is the wrong one, fix it across the plan's files (beyond them: the core
   instructions' one-plan rule).
4. **Boundaries** — the project's layering and import rules. A violation is Critical.
5. **Shortcuts** — each item on the core instructions' root-cause list, plus magic numbers.
   Each needs the real fix.
6. **Reuse over reinvent** — hand-written code for a job the project or a maintained library
   already does (the core instructions give the order to look in). Name the exact replacement
   when you flag one, and confirm it exists — in the project or in the installed package.
7. **Craft** — would a senior engineer be embarrassed to approve this? Dead code, debug
   output left in, names that lie (`data2`), one function doing five things, nesting that
   should be early returns, clever one-liners, user-facing errors that say "Something went
   wrong".
8. **Security** — authentication and authorization checked inside the function, not only at
   the route; input validated at the boundary; no secrets in logs, client bundles or props
   sent to the browser.
9. **Observability** — the project's logger, not stray console output. Errors carry the ids
   needed to trace them (request, user, tenant). Operations that may be retried are
   idempotent (safe to run twice).
10. **Fix the class, inside the plan** — for every finding, search the files the plan changes
    for the same pattern and fix every instance there (`/cc-smart-dev-kit:impact-analysis` § Fix the
    pattern).

## Edge-case axes

The one home for this list; other skills point here. Attack only what applies.

- **Data and input** — empty, zero, one, many; null vs undefined vs a missing key; untrusted
  shapes from webhooks, URL parameters or local storage (validated with a schema, or cast?);
  long strings, emoji, right-to-left text, newlines; money rounding, cents vs units, `NaN`;
  dates across time zones and daylight saving; internal id vs public id.
- **State and timing — the richest vein** — double-click submit; a webhook delivered twice;
  two tabs; read-modify-write with no lock; events out of order; the same job run twice
  (a real idempotency key, or hope?); partial failure after steps 1–2 were written; an answer
  landing on a component that is gone; a cache key missing the tenant id; queue retries;
  realtime reconnect gaps; a stream cut mid-answer.
- **Access and money — highest severity** — can tenant A read tenant B's row? Is the tenant
  id in the query, the cache key and the realtime channel? A viewer doing an owner's action;
  a private field in a public response; a double charge, a charge without delivery, a replayed
  webhook.
- **Environment** — a provider down, or answering 200 with an error body; rate limits; a
  phone-sized screen; dark mode; keyboard only; **deploy skew** — new code reading a column
  production does not have yet. Check the migration is merged and backfilled before the code
  ships.

## The evidence bar

A finding counts only when you can fill all four:

| Field | What it needs |
|---|---|
| **Trigger** | The concrete input, click order or state. Not "bad input". |
| **Path** | The real code path, `file.ts:44` → `other.ts:120`. You read it. |
| **Outcome** | What goes wrong in real terms — charged twice, a page goes blank. Not "may cause issues". |
| **Why allowed** | The missing guard. |

Cannot fill all four? It is a hunch: say so separately, or drop it. **Refute before you
report:** look for the guard that already stops it (a validator upstream, a database
constraint, a type that makes it impossible). Never invent a line number.

## Severity

- **Critical** — money lost, data destroyed, one customer sees another's data, missing
  authorization, a boundary violation, a silent failure nobody can recover from. Stop: fix it
  before the commit.
- **Warning** — real users hit it on a normal path. Fix it, or get the person's explicit yes
  to ship it knowingly.
- **Suggestion** — a narrow trigger, cosmetic, recovers by itself. Fix it if cheap.

Bias upward when unsure. If everything is a Suggestion, say so plainly.

## Second opinion

You cannot see your own blind spots. So after your own pass, for every change beyond a small
fix, start **one** `cc-smart-dev-kit:reviewer` agent (model and effort: the core instructions).

- **When** (the rule is in the core instructions § Review): phases built in parallel that
  ship together get one read, not one each. A phase built on another open pull request is a
  new change set: its own branch, its own read. Fixes to code the agent already read are a
  re-push, not a new change set.
- **The brief:** the diff (or how to get it: base and branch), what the change is meant to
  do, your own edge-case list, and whether the session pointed a language-server tool at this
  checkout.
- **Not in your agent list** (the plugin is off, or the session started before it
  existed)? Use `general-purpose`, paste the reviewer agent's instructions (the cc-smart-dev-kit
  plugin's `agents/reviewer.md`) into the brief, and say so.
- **Its findings:** apply the evidence bar to each in the code. Fix only the confirmed ones
  inside the change set; your own pass then checks the fixes. What it lists under "Not
  reached", read yourself, or write it down as not verified in the pull request.
- When it returns, run `git status --short` and revert anything it changed (a stand-in can
  edit), and say so.
- **Record it, once the fixes are committed:** `cc-smart-dev-kit workflow review-done` (a commit
  with `--sha <commit>`). It writes the head commit into the repository's review record, and
  the merge guard reads that record — for the pull request's head commit — before a merge it
  would make with no person watching. Commit the review's fixes first: a record of an older
  commit does not cover the newer one.

## Then

Fix what you found and tell the person in plain words what you found — including "nothing
serious" when that is the truth.
