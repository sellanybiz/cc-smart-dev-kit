---
name: audit
description: Use when asked to sweep an area for a class of defect rather than review a diff - "audit the hooks", "find every place where a request is retried", "sweep the codebase for X". Scopes the tracks, starts the audit-run Workflow, then proves every finding in the code and names what it did not cover.
---

# Audit — An Area, Not A Diff

**Project add-on:** `.claude/cc-smart-dev-kit/audit.md` — read it first when it exists. Where it
differs, the add-on wins (`core.md`, top).

A diff is the review skill's job. An audit sweeps code nobody is changing just now: one class of
defect across an area, proved finding by finding. One Workflow runs it
(`cc-smart-dev-kit:audit-run`): a read-only auditor per track, a second auditor to refute every
finding, and one writer for the report.

## When it fits

- "Audit the hooks", "find every place where a request is retried", "is our error handling
  safe", "sweep for X".
- Not for a diff or a finished change (`/cc-smart-dev-kit:review`), and not for a question one
  read answers.
- Audit the branch you are on and name it in the report. Never audit code another session is
  changing right now.

## 1. Scope it, or the run is noise

Four answers, before anything starts:

1. **Target** — the folders or subsystem, named exactly. "The codebase" is not a target.
2. **Question** — one class of defect in one line: "missing authorization checks", "a retry that
   can double-charge", "an unbounded query". One class per run.
3. **Tracks** — how the run splits the question, one auditor each. Take the review skill's
   edge-case axes that apply (`references/axes.md` in the review skill; load
   `/cc-smart-dev-kit:review` if you have not read them), and name two to four. More tracks is a
   second run.
4. **Budget** — the findings verified, and so the Opus agents the run starts. Twelve unless the
   person says otherwise.

Read the project's rules and docs for the area first: they are the spec the auditors judge by, and
a question they already answer needs no audit.

## 2. Ask when the run is yours, not theirs

The person's own "audit X" is the yes. A sweep you decided on — from a plan, a hunch, a review's
"outside this change" line — is not: ask once with `AskUserQuestion`, naming the target, the
question, the tracks and the budget, with the recommended option first. Say what it spends: a run
of this size starts several Opus agents.

## 3. Start the run

Call `Workflow` with the plugin's own script:

```
Workflow({
  name: "cc-smart-dev-kit:audit-run",
  args: {
    target: "src/api (the routes and their access checks)",
    question: "a branch or condition the access check lets through",
    tracks: ["data and input", "state and timing", "access and money"],
    budget: 12,
    findingsPath: ".claude/audits/2026-10-22-access.md",
  },
})
```

- `args` is one object, as shown — never a string of JSON. A string, an unknown key or a wrong
  type stops the run at once with a line that names the expected object.
- `budget` is how many findings the second auditors verify, most severe first; the rest are
  listed in the report under **Unchecked findings**, not verified. Say so in your answer, and
  check them or run again with a larger budget.
- `findingsPath` is where the writer puts the report. Use the project's own convention when its
  add-on names one; else `.claude/audits/<YYYY-MM-DD>-<slug>.md`. Never a file a plan or a doc
  already owns. This file is the audit's deliverable — the one artifact the run exists to make —
  not a home for a long reply.
- The run goes in the background and returns one report when it ends. Do not poll it:
  `/workflows` shows its progress, and its end brings you back.
- If the plugin's workflow is missing or `Workflow` refuses it, say so and stop. Never write an
  inline workflow to take its place.

## 4. Check the report before you pass it on

The verifier inside the run is a second auditor, not you. Read every confirmed finding at its
`file:line` and apply the evidence bar (the core instructions, § Review): the trigger, the path,
the outcome and the missing guard. A design finding meets it as the review axes say
(`../review/references/axes.md` § Design findings). A finding that does not hold is dropped in
one line, with why.
The hunches stay hunches: never promote one, and never fix one silently.

## 5. Then

- **Report** the counts by severity, the file's path, and the coverage line: what was not audited
  is part of the answer.
- **Fix now?** Ask. Small independent fixes go to a `cc-smart-dev-kit:builder` agent each, with
  the core instructions' model table; one agent per group of files that do not overlap. A fix
  that changes a design goes to `/cc-smart-dev-kit:plan-task` as a plan, not to a builder.
- Never start editing on the audit's own authority, and never use an audit as a release check: a
  release check is the review and the checks, not a sweep.
