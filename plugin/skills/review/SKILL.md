---
name: review
description: Review a finished change in the main session - the axes this diff touches, each finding proved and fixed, then the senior engineer's second opinion. Approved plans use build. Trigger phrases - "ready to commit", "review this", "I'm done", "does this look right".
---

# Review — You Are The Reviewer

**Project add-on:** `.claude/cc-smart-dev-kit/review.md` — read it first when it exists. Where it
differs, the add-on wins (`core.md`, top).

You wrote this code. Now read it as if a stranger wrote it and you must approve it with your
name on it.

## When

A builder skips this skill: its caller owns both the review pass and reviewer dispatch.
Approved plans follow `/cc-smart-dev-kit:build`; the second-opinion section below covers
changes outside that loop.

- **Your own pass:** once per commit of finished work outside a plan, when your next action is
  the commit. A plan's phases get the build skill's quick check instead (§ 3). The test: "if this
  comes back clean, do I commit right now?" No: you are still building; come back later.
- **The second opinion outside a plan:** once per change set (§ Second opinion).
- **On request:** "review this".
- **A sweep of an area, not a diff:** `/cc-smart-dev-kit:audit` — one class of defect across
  code nobody is changing, with its own Workflow.

**The project's workflow says how strictly this holds.** `cc-smart-dev-kit workflow show` prints
`reviewBeforePush`, and with it on — the default — the second opinion is due before the first
push, and recorded (§ Second opinion). With it off, this skill is still worth running; a merge
still waits for the record of the pull request's head commit (`/cc-smart-dev-kit:commit`).

**A small fix** skips the second opinion: a typo, wording, a comment, docs only (not
instruction files: rules, skills, agents, settings, hooks), or a one-line fix inside a
pattern already in use. This is the one definition; other skills point here. Say the
exemption in one line. Small fixes outside a plan wait for the session's ship point
(`/cc-smart-dev-kit:commit` § Pushing).

## How

Read the real diff in full — `git diff` and `git diff --cached`, not a summary. Then walk
the review dimensions and the edge-case axes in `references/axes.md` (beside this file), but
only the entries this diff touches. Walking an axis that does not apply is theatre; name the
ones you skipped, one line each. The same file holds the severity scale.

The bug usually lives between what you changed and what you did not. For every exported
symbol you touched, find its callers (`Grep` for the name as a whole word, `\bname\b`) and
read them.

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

For design findings, use `references/axes.md` § Design findings.

## Second opinion

You cannot see your own blind spots. So after your own pass, for every change beyond a small
fix, start **one** `cc-smart-dev-kit:senior-engineer` agent. Its model and effort follow the
change set's risk — what a missed bug would cost:

| The change set | Model, effort |
|---|---|
| Small and low-risk: one layer, a pattern already in use, nothing risky at stake | `sonnet`, `medium` |
| Normal | `sonnet`, `high` |
| Risky: security, money, permissions, a schema, deploy plumbing, the router, a release | `opus`, `xhigh` |

Unsure between two rows, take the higher one. `fable` only when the person asks for it
(`core.md` § Subagents).

- **When:** once the non-plan change is complete, before its first push. A plan's review
  follows the build skill instead (§ 6: two `review-split` rounds, and a final senior engineer review when round 2's fixes are big).
- **One change set, one read:** phases built in parallel that ship together get one read,
  not one each. A phase stacked on another open pull request is its own change set: its own
  branch, its own read. Fixes to code the senior engineer already read are a re-push, not a
  new change set.
- **The brief:** the line `Mode: review` alone on its own line, then the diff (or how to get
  it: base and branch), what the change is meant to do, your own edge-case list, and the
  checkout's absolute path (in a worktree, the worktree's). Add the reuse evidence: run the
  commands under the `Reuse signals` heading of the project's review add-on once, with
  `cc-smart-dev-kit workflow claims --base <the review's base>`, and paste their output with your own `Homes:` lines for what the change adds (`/cc-smart-dev-kit:code-structure`
  § 3). With no such heading, say so in one line and go on (the same case as code-structure § 13). Ask for no fixes: the findings come
  back to you. Without that line the agent treats the brief as a consult, and nothing records
  the review.
- **A risky change set also gets the edge-case hunter.** In the same message as the senior
  engineer, start one `cc-smart-dev-kit:edge-case-hunter` on the same change (model and
  effort: `/cc-smart-dev-kit:subagent-decision`'s table). Its
  scenarios are not findings: once both agents are back, check each in the code, and for each
  real gap add a test and fix it inside the change set. It records no review.
- **Commit before you start it, and do not commit while it runs.** With `reviewBeforePush`
  on, the record of the review is written by the plugin's `review-record` hook: Claude Code
  tells it when a subagent finishes, and when that agent is one the workflow's `reviewAgents`
  lists (the plugin's `senior-engineer` by default) and its brief carried the `Mode: review`
  line, it records the commit the working folder is on at that moment. You read that
  record (`cc-smart-dev-kit workflow merge-check <pr>`, or `workflow show`'s `review-done`) for
  the pull request's head commit before you merge it yourself. So the senior engineer must read the commit the record will name: commit
  your own fixes first, and commit nothing until it has finished.
- **Not in your agent list** (the plugin is off, or the session started before it
  existed)? Use `general-purpose`, paste the senior engineer's instructions (the cc-smart-dev-kit
  plugin's `agents/senior-engineer.md`) into the brief, and say so.
- **Its findings:** apply the evidence bar to each in the code. Fix only the confirmed ones
  inside the change set; your own pass then checks the fixes. A confirmed "Outside this change"
  finding goes to the person at once (`/cc-smart-dev-kit:tasks` § 1). What it lists under "Not
  reached", read yourself, or write it down as not verified in the pull request.
- When it returns, run `git status --short` and revert anything it changed (it has edit tools,
  and so does a stand-in), and say so.
- **Never record it yourself.** `cc-smart-dev-kit workflow review-done` refuses inside Claude Code:
  a record a session writes is the session's own word, which is what the hook above exists to
  replace. The command is for the person's own terminal, to record one by hand.

### A big change set: split it instead

One senior engineer's focused pass cannot cover a diff that spans many layers — a whole
release's integration, a change across most of the tree. There the second opinion may be the
`review-split` Workflow: one read-only reviewer per track you name, a second reviewer to refute
every finding, and one ranked report back. It is the same second opinion, so never run it beside
the single senior engineer, and a small fix or an ordinary change set stays with the single
senior engineer, whose read is cheaper. A plan's two rounds and its final review are not this section's choice: the
build skill's § 6 sets their args. This section is where each arg is defined.

```
Workflow({ name: "cc-smart-dev-kit:review-split",
  args: { base: "main", head: "HEAD", folder: "<the checkout's path, a worktree only>",
          intent: "what this change does", tracks: ["state and timing", "access and money"],
          risky: true, budget: 5, spec: "<plan file>", prior: "<round 1 report>",
          reuse: true, homes: "<your Homes: lines>", signals: "<the Reuse signals and workflow claims output>" } })
```

- `args` is one object, as shown — never a string of JSON. The run refuses a string, an unknown
  key or a wrong type with one line that names the expected object, and starts no agent; it
  does not fall back to defaults for arguments it refuses.
- `base` and `head` name the change (`git merge-base <base branch> HEAD`, then the branch
  head), and `intent` says what it is meant to do — the reviewers hold no context of their own.
  `folder` is the checkout to read when it is not the session's own folder (a worktree); leave
  the key out otherwise.
- `budget` is how many findings the second reviewers refute, most severe first; the rest come
  back in an **Unchecked** section of the report. Read it: check those findings yourself, or run
  again with a larger budget. The agents of a run are the tracks (the spec track too) plus the
  budget; the example's two tracks, its spec and reuse tracks and its budget of 5 make nine. A plan's
  rounds take no extra run: the lead checks the Unchecked findings itself (build § 6).
- `tracks` are two to four review dimensions or edge-case axes from `references/axes.md` that
  this diff touches. A plan's tracks are chosen by area (build § 6). Never name a track `reuse`
  here: the `reuse` arg adds it.
- `spec` is a plan file's path: every track reads it, and one more track checks the plan's
  compliance. Leave the key out for a change with no plan.
- `reuse` adds one track, named `reuse`. It searches the repo for an existing home of each
  new export, long literal, user-facing sentence and helper body the diff adds, and spot-checks
  the author's `Homes:` lines. The method's one home is `/cc-smart-dev-kit:code-structure`
  § 3, and the script's prompt applies it. Pass it when the diff adds code, not only exports.
- `homes` is the author's `Homes:` lines (a string) for the `reuse` track; it needs `reuse: true`
  and is refused without it. Outside a plan, pass your own lines. With `spec` set, pass only the
  lead's own lines for its integration work: the track reads the phases' and fix tasks' `Report:`
  notes itself.
- `signals` is the `Reuse signals` output and the `cc-smart-dev-kit workflow claims` output (a
  string): every track gets it with its brief. Run `workflow claims --base <the call's `base`>` always; when the project lists no
  Reuse signals, say so in one line and pass the claims alone.
- `prior` is round 1's whole report, its Unchecked and Hunches included: it makes the run
  round 2. Leave the key out for a first run. The example shows every key; a real call sets
  `spec` and `prior` only for a plan, and `prior` only in round 2.
- `risky: true` only for a change set the core instructions' Review calls risky; the run holds
  their model rule for it, on every launch. The reviewers are the type the review-record hook
  knows, so the run records the review as the single senior engineer does: commit first, and
  commit nothing while it runs.
- Claude Code starts a Workflow only on the person's request, or from a skill that says to call
  one. A split you decided on yourself asks once first, naming the tracks and what the run
  spends — as the audit skill does for a sweep it starts.

## Then

Fix what you found and tell the person in plain words what you found — including "nothing
serious" when that is the truth.
