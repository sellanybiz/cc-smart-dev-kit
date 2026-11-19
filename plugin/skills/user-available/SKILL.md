---
name: user-available
description: Use when the person is back and can answer. Turn off unavailable state, report work done and go through parked questions.
---

# The Person Is Back

**Project add-on:** `.claude/cc-smart-dev-kit/user-available.md` — read it first when it exists.
Where it differs, the add-on wins (`core.md`, top).

While the person was away, sessions parked what needed them (`/cc-smart-dev-kit:user-unavailable`).
Go through it now: short, in this order. Their time is the cost.

## 1. Switch back

1. `cc-smart-dev-kit user status --json` first: it holds `since`, which the next step clears.
2. `cc-smart-dev-kit user available`. `AskUserQuestion` works again; the list stays.

These two calls, and `user list`, raise Claude Code's own permission prompt in the default
mode, and the person answers it. If a call is denied anyway, the person types
`! cc-smart-dev-kit user available` in this session: the `!` runs it in their own shell.

## 2. What was done

- The commits and merges since `since`, in the project: `git log --since=<since> --oneline`, and
  `--merges` for the merges. Read the plan task tree, including closed tasks, for subagent
  reports, branches and worktrees.
- The `Summary:` decisions among this session's items (§ 3), first and in the sessions' own
  words. Show them as the report; they need no answer. Clear them once shown.

Say it in a few lines: what shipped, what failed, what waits.

## 3. The list

`cc-smart-dev-kit user list --json`: each item has `id`, `kind`, `text`, `command`, `cwd` (the
folder an action was parked in), `options`, `recommend` (counted from 1), `session`,
`at`, and `whose` with `waitsIn`. The text view of `user list` is for reading: it shows some
control characters as spaces (it says so), so a command is taken from the JSON, never copied
from the text.

**The list is the machine's; you go through this session's items only.** The person may bring
several sessions back at once, and each answers its own, so nothing is asked twice and no
session acts on another's work. `whose` says, for the session that runs the command:

- `this session`: this session parked it, or its session ended in this project. Go through
  these, below.
- `another session`: a running session owns it (`waitsIn`: its name and folder). Never ask
  about it, run it or clear it. One line per session: how many wait there, so the person
  answers them in that session.
- `no session`: its session ended, in another project. Name its folder in one line and ask once
  whether to go through those here; a yes makes them this session's.

This session's items, in three kinds, in this order:

1. **Decisions** (taken for the person): show what was chosen, why and how to undo it. Ask keep or
   undo, one question each, `keep` first, in `AskUserQuestion` calls of at most four. An undo is
   done as the decision's own words say, then the item is cleared.
2. **Questions:** one `AskUserQuestion` call (more than four: the next call), each item's `text`
   as the question and its `options` in order, **the recommended one first and marked**. The tool
   takes two to four options a question: with more, keep the recommended one and the likeliest,
   and say the rest in the question; with none or one, put it as the plain question it is. Act on
   each answer where it belongs (`/cc-smart-dev-kit:memory-routing`). A yes on a parked finding
   goes through the tasks rule: file it, then start the follow-up child or send to it
   (`/cc-smart-dev-kit:tasks` § 1).
3. **Actions:** show each with its `text`, its `cwd` and its exact `command`, and ask yes or no. A
   yes runs that command, as it is, in its `cwd` (a push or a delete in another folder is another
   action); it is that action's yes and no other's. Check first that it still makes sense (the
   branch moved, the pull request merged). A command whose `text` says it was cut, or that has no
   `command`, is not runnable as it stands: do it from its words, or ask.

## 4. Clear what was answered

`cc-smart-dev-kit user clear <n>…` for each item of this session's that was answered, undone, run
or declined. Never `--all`: other sessions' items are on the same list. An action that failed
stays on the list, with what went wrong said to the person.

Last, say what is left here, which sessions still hold items, and that sessions may ask as
usual again.
