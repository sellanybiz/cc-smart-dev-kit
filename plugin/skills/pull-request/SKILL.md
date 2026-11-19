---
name: pull-request
description: Use before gh pr create, merging or reviewing a pull request. Defines its body, including what changed and why, configuration, data changes, verification, follow-ups and work still owed.
---

# Pull Request Bodies

**Project add-on:** `.claude/cc-smart-dev-kit/pull-request.md` — read it first when it exists. Where
it differs, the add-on wins (`core.md`, top). A project with its own required headings or
release process names them there.

**Whether one is opened, and how, comes from the workflow.** `cc-smart-dev-kit workflow show`
prints `openPr`: `"off"` means open one only when the person asks, `"draft"` opens it as a
draft, `"ready"` opens it ready for review. The body below is the same in every case, and one
skill owns the rest of that policy (`/cc-smart-dev-kit:commit` § what happens by itself). That
includes the push rhythm: once the pull request is open, fixes are batched, checked locally and
pushed once (`/cc-smart-dev-kit:commit` § Pushing).

## Three readers

1. Whoever decides to **merge** it.
2. Whoever must **make it work** — a teammate pulling the branch.
3. **The release, days later** — the person (or the skill) who ships it and needs to know
   which setting production is missing, which follow-up is owed, which data change is not a
   no-op.

So the body is input for later work, not a courtesy. A summary of the diff is not enough.

## What every body carries, in this order

Leave a heading out only when its answer is "none" — and then write "none". A missing
heading reads as "not considered".

1. **What changes and why** — the behaviour, not the file list. Start with the effect a user
   sees. A fix says what the person was seeing.
2. **Configuration** — every environment variable or setting added, renamed or removed:
   what it is for, where to get its value, and whether the build or only the runtime needs
   it. **Names only, never values.**
3. **Deploy tasks** — one list for each environment (prod, staging) the branch task list below
   shows: the deploy tasks this branch adds, changes or closes, each with its ID, its step
   (before or after the deploy) and type, and what it asks; blocking ones first.
4. **Data changes** — each migration or data script, and what it does on a **populated**
   database, not only an empty one. Say "no-op in production" only when you checked.
5. **How it was verified** — the real commands and their results. **Say what was not
   verified** — no browser check, no production data, no load test — and the second
   opinion's result (or "small fix"). A planned build has one pull request for the whole
   plan and lists each phase's spec-and-quality verdicts, then the final whole-branch review.
   "Verified" with nothing behind it is worse than an honest gap.
6. **Still owed after the merge** — the open deploy tasks from that same task output, with their
   step and type, and the findings filed as issues that are still open, with their numbers. A
   pull request built on another open one says "stacked on #n — merge after it".

Run `cc-smart-dev-kit task list --branch --base <base>` against the pull request's real base
before filling both task headings. Do not infer "none" from a failed command; state the gap.
Task files travel with the change that needs them; closing and staging them is
`/cc-smart-dev-kit:commit` § Steps.

## The issues it closes — a pull request into the default branch

GitHub closes an issue only when a pull request that names it merges into the **default
branch**: a fix merged into a release branch closes nothing, and a `Fixes` line in a pull
request into any other branch is ignored. Unless `workflow.issues.enabled` is off (it is on by default), the main
session labelled each issue a merged phase fixed `fixed-unreleased` (`issue mark-fixed`,
`/cc-smart-dev-kit:build` § 5); the pull request that ships them lists them. Run

```
cc-smart-dev-kit issue fixed --base <default branch> --head <this branch>
```

and paste what it prints — one `Fixes #<n>` line for each open `fixed-unreleased` issue whose fix
is in the pull request's commits — after the last heading. Never build that list by hand. It
prints nothing when the switch is off or no issue is waiting; it exits 1 with a reason when
GitHub or a branch cannot be read, and then say so under "Still owed": an empty list from a failed
call looks complete. A pull request into any other branch has no `Fixes` line.

## Who made it — only when the project asks

A body names no Claude session and no account by default: on a public repository everyone
reads them. When the project's add-on asks for a footer, put it after the last heading — a
blank line, then a `---` line (a paragraph directly above `---` turns into a heading in
Markdown), then the lines the add-on names, from these:

```
---
Claude session name: <the session's name>
Claude session: <session id> — resume with `claude --resume <session id>`
Claude account: <the account email Claude Code gives you as the user's email>
```

Write "unknown" for any of these you do not know — never guess one. `claude --resume` works
only on the machine that ran the session. It is a footer, not a heading. The attribution
lines the harness gives you come last, footer or not.

## The test

> Could someone merge this, hit a missing setting, and fairly say "the pull request never
> told me"?

If yes, the body is incomplete. A teammate must be able to run the branch from the pull
request alone. An empty template is not a body: fill every heading before you ask for the
merge.

## Reading someone else's pull request

A body that says none of this is a gap, not a green light. Open the diff and work out what it
needs — the notes it adds, new environment reads, the migrations — and say so in your summary.
Never merge on the assumption that silence means nothing is owed.
