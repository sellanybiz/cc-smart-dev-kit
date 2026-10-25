---
name: user-unavailable
description: Use when a hook note or `cc-smart-dev-kit user status` says the person cannot answer. Never stop to ask - park their questions and the actions that need their yes, and go on.
---

# While The Person Cannot Answer

**Project add-on:** `.claude/cc-smart-dev-kit/user-unavailable.md` — read it first when it exists.
Where it differs, the add-on wins (`core.md`, top).

The person is away: asleep, in a meeting, or on a phone. A question or a permission prompt now
stops the work for hours and nobody reads it. So you **park** what needs them on a list, and go
on. They answer the list when they are back, with `/cc-smart-dev-kit:user-available`.
`cc-smart-dev-kit user status` says whether this is on, and since when.

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
| A choice that is the person's: scope, a trade-off the plan names as theirs, money, security, a public name, anything hard to undo | Take neither option. | A `question`, with its options and the recommended one. |
| An action that needs the person's yes: a push, a merge into the default branch, a delete, a message to another session or a service, a gateway change, a release, anything a guard or Claude Code would ask about | Never try it, not in another form either. | An `action`, with its exact command. |

```sh
cc-smart-dev-kit user park --kind decision "Chose A over B because …. Undo: …"
cc-smart-dev-kit user park --kind question "Which …?" --option "A" --option "B" --recommend 1
cc-smart-dev-kit user park --kind action "Push the branch" --command "<the exact command>"
```

When unsure whether a choice is easy to undo, it is the person's: park a `question`.

## 3. The hooks hold the line

- A guard that would ask the person answers **deny** instead, and the hook parks the call as an
  `action` itself ("parked as #N"). Do not park it a second time, and never run it another way
  (another shell, a script, a wrapper, another tool): a deny is the person's line, not a bug.
- Claude Code's own permission prompt gets the same answer, where its hook is live. Where it is
  not, a prompt waits for nobody. So prefer tools that never prompt: reads, searches, and edits
  inside your own worktree. Park the rest as an `action`.
- A project's own copy of a guard (`ownHooks`) answers in Claude Code directly, so only its
  resulting prompt is caught.

## 4. The summary

At the end of each stretch (a phase done, a wave merged, the work running out) park one
`decision` whose text starts `Summary:`. It says what is done, what is parked and why, what runs
on, and what the person should look at first. `/cc-smart-dev-kit:user-available` reads it first.

## 5. A lead keeps its crew going

`/cc-smart-dev-kit:lead` applies in full; the person's absence changes only who gets the
questions.

- **Technical questions** of a crew session: answer them, as always (`lead` § 5).
- **A question that is the person's:** park it as a `question` with the crew session's options
  and its recommended one, then `cc-smart-dev-kit crew answer <name> "parked for the person as
  #N: go on with what it does not block"`. A crew session's own channel is not a message that needs
  the person's yes.
- **A permission prompt in a crew session** is denied and parked by the hook, with the crew
  session's name. Do not wait on it: start what is unblocked.
- **Start what is unblocked, and merge what passed its gate** into your own branch. A push, a pull
  request merge or a merge into the default branch is an `action`, parked with its command.

In a crew session itself nothing changes in how it asks: `crew report --question` goes to the
lead, and the lead parks what is the person's.

## Never

- Switch the state back yourself (`user available`) or take the person's prompt as their return:
  it may be one line from a phone. The person ends this, with `/cc-smart-dev-kit:user-available`.
- Take a choice that is hard to undo to keep going, or try an action in another form after a deny.
- Leave a parked item without its exact words: the person reads the list without your context.
