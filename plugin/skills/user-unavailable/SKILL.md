---
name: user-unavailable
description: Use when the person is away or cannot answer. Take the recommended option, record a decision, keep going.
---

# While The Person Cannot Answer

**Project add-on:** `.claude/cc-smart-dev-kit/user-unavailable.md` — read it first when it exists.
Where it differs, the add-on wins (`core.md`, top).

The person is away: asleep, in a meeting, or on a phone. A question or a permission prompt now
stops the work for hours and nobody reads it. So you **decide**: take the recommended option,
record what you chose, and go on. They read the decisions when they are back, with
`/cc-smart-dev-kit:user-available`. `cc-smart-dev-kit user status` says whether this is on, and
since when.

**Once a hook note says the person is away, never run `user status`, `user list` or `user
available`.** The note holds the state and the count, and in the default permission mode the
prompt for those three goes to the person, who is not there: the session would wait for hours.
They are for the person's return (`/cc-smart-dev-kit:user-available`).

## 0. Switch it on, once

The hooks act only on the state, so the person's words are not enough. When the person invoked
this skill, or said they are going away, and `cc-smart-dev-kit user status` says they are still
available, run `cc-smart-dev-kit user unavailable [--until <time>]` first, with the time from
their words (`8h`, `07:30`; `--until` is a note, it never switches back). Already unavailable:
do not run it again, it would drop the time the person gave. A session that reads this skill
because a hook note told it only follows the rules below.

In Claude Code's default permission mode, a session's own `cc-smart-dev-kit user park` call is a
command that asks, and nobody is there to answer. Tell the person once, in one line, to allow
`Bash(cc-smart-dev-kit user park:*)` if their sessions run in that mode.

## 1. The rule

- **Never stop to ask, never park a question or an action, and never end a turn waiting for the
  person.** `AskUserQuestion` and `ExitPlanMode` are refused by a hook while this is on: the
  refusal is the cue to decide, not a block.
- **Take the recommended option** of every question you would have asked: the one the plan, the
  skills or the facts support. A finding outside the plan: the recommended option of the finding
  rule's list (`/cc-smart-dev-kit:tasks` § 1).
- **An action that needed their yes just runs** when the work calls for it and the instructions
  allow it (a push of your own branch, a merge as `allowMerge` says, a staging deploy a task owes).
  The steps that are the person's word every time (`/cc-smart-dev-kit:commit`: a deploy to
  production, a force-push, `reset --hard`, a direct push to the main branch) you do not run: take
  the safe option, and record that you did not.
- **Plan mode.** Never enter plan mode while away: it cannot be left without the person. A
  session already in it writes its plan file, records a `Decision:` (what it would build, why,
  and that it stopped there) and stops that work; it never keeps trying `ExitPlanMode`.
- **Claude Code's own permission prompt** is not a hook's to answer: it waits for nobody. Prefer
  tools that never prompt, and when a call is refused by the permission system, report it as a
  decision and work on with what is allowed; never run it another way.

## 2. Record each decision

```sh
cc-smart-dev-kit user park --kind decision "Decision: chose A over B because …. Undo: …"
```

The text starts `Decision:` and says what you chose, why, and how to undo it. Write it for a
reader without your context. Record every real choice (not a trivial one, like a variable name).

## 3. The end of a stretch

At the end of each stretch (a phase done, a wave merged, the work running out) record one more
decision whose text starts `Summary:` (not `Decision:`): what is done, what you chose, what runs on, and what the person
should look at first. `/cc-smart-dev-kit:user-available` shows it first.

## 4. Keep working

Use `/cc-smart-dev-kit:build` for subagent work. Resolve ambiguities in its task ledger and keep
unrelated phases and reviews running. When there is truly no work left that you may do, the
stretch is done: write § 3 and stop.

## Never

- Switch the state back yourself (`user available`) or take the person's prompt as their return:
  it may be one line from a phone. The person ends this, with `/cc-smart-dev-kit:user-available`.
- Park a question or an action, or wait for the person.
- Record a decision without its reason and its undo.
