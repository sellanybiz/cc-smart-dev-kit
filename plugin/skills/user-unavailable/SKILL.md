---
name: user-unavailable
description: Use when the person is away or cannot answer. Park questions and actions needing their yes; continue unblocked work.
---

# While The Person Cannot Answer

**Project add-on:** `.claude/cc-smart-dev-kit/user-unavailable.md` — read it first when it exists.
Where it differs, the add-on wins (`core.md`, top).

The person is away: asleep, in a meeting, or on a phone. A question or a permission prompt now
stops the work for hours and nobody reads it. So you **park** what needs them on a list, and go
on. They answer the list when they are back, with `/cc-smart-dev-kit:user-available`.
`cc-smart-dev-kit user status` says whether this is on, and since when.

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
command that asks, so it would be denied and parked as an action. Tell the person once, in one
line, to allow `Bash(cc-smart-dev-kit user park:*)` if their sessions run in that mode.

## 1. The rule

- **Never stop to ask, and never end a turn waiting for the person** while other work is ready.
  `AskUserQuestion` and `ExitPlanMode` are denied by a hook while this is on.
- **Before you park, find what the item blocks.** Go on with everything it does not block: the
  next phase, the tests, the docs, the review.
- **When the only work left waits on a parked item,** the stretch is done. Write the summary (§ 4),
  say in one line what waits, and stop.

## 2. Park by kind

| What you meet | You | Park |
|---|---|---|
| A choice the plan settles with a recommended option, easy to undo (a name, an order, a wording, a refactor inside your files) | Take the recommended option. | A `decision`: what you chose, why, and how to undo it. |
| A choice that is the person's: architecture, scope, UX, a trade-off the plan names as theirs, money, security, a public name, anything hard to undo | Take neither option. | A `question`, with its options and the recommended one. |
| An action that needs the person's yes: a push, a merge into the default branch, a delete, a message to another session or a service, a gateway change, a release, anything a guard or Claude Code would ask about | Never try it, not in another form either. | An `action`, with its exact command. |

```sh
cc-smart-dev-kit user park --kind decision "Chose A over B because …. Undo: …"
cc-smart-dev-kit user park --kind question "Which …?" --option "A" --option "B" --recommend 1
cc-smart-dev-kit user park --kind action "Push the branch" --command "<the exact command>"
```

A finding outside the plan, found while away, is a parked `question` too: its options are the
ones the finding rule lists (`/cc-smart-dev-kit:tasks` § 1).

When unsure whether a choice is easy to undo, it is the person's: park a `question`.

## 3. The hooks hold the line

- A guard that would ask the person answers **deny** instead, and the hook parks the call as an
  `action` itself ("parked as #N"). Do not park it a second time, and never run it another way
  (another shell, a script, a wrapper, another tool): a deny is the person's line, not a bug.
- Claude Code's own permission prompt gets the same answer, where its hook is live. Where it is
  not, a prompt waits for nobody. So prefer tools that never prompt: reads and searches, and the
  edits and commands your permission mode allows without asking. Park the rest as an `action`.
- A project's own copy of a guard (`ownHooks`) answers in Claude Code directly, so only its
  resulting prompt is caught.

## 4. The summary

At the end of each stretch (a phase done, a wave merged, the work running out) park one
`decision` whose text starts `Summary:`. It says what is done, what is parked and why, what runs
on, and what the person should look at first. `/cc-smart-dev-kit:user-available` reads it first.

## 5. Keep independent phases moving

Use `/cc-smart-dev-kit:build` for subagent work. Resolve technical ambiguities in its task
ledger. Park only what needs the person's yes; keep unrelated phases and reviews running.

## Never

- Switch the state back yourself (`user available`) or take the person's prompt as their return:
  it may be one line from a phone. The person ends this, with `/cc-smart-dev-kit:user-available`.
- Take a choice that is hard to undo to keep going, or try an action in another form after a deny.
- Leave a parked item without its exact words: the person reads the list without your context.
