---
name: user-available
description: Use when the person is back and can answer. Turn off unavailable state, report work done and show the decisions.
---

# The Person Is Back

**Project add-on:** `.claude/cc-smart-dev-kit/user-available.md` — read it first when it exists.
Where it differs, the add-on wins (`core.md`, top).

While the person was away, sessions took the recommended option and recorded each choice as a
decision (`/cc-smart-dev-kit:user-unavailable`). Nothing was parked to answer. Show it now:
short, in this order. Their time is the cost.

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

Say it in a few lines: what shipped, what failed, what waits.

## 3. The decisions

`cc-smart-dev-kit user list --json`: each item has `id`, `kind`, `text`, `session`, `at`, and
`whose` with `waitsIn`. The text view of `user list` is for reading; it shows some control
characters as spaces (it says so).

**The list is the machine's; you go through this session's items only.** The person may bring
several sessions back at once, and each shows its own. `whose` says, for the session that runs
the command:

- `this session`: this session recorded it, or its session ended in this project. Show these.
- `another session`: a running session owns it (`waitsIn`: its name and folder). Never show,
  run or clear it. One line per session: how many decisions are there.
- `no session`: its session ended, in another project. Name its folder in one line and ask once
  whether to show those here; a yes makes them this session's.

Show this session's decisions, the end-of-stretch `Summary:` ones first and the `Decision:` ones after, in the sessions' own words: what was
chosen, why, and how to undo it. They need no answer. When the person dislikes one, undo it as
its own words say. An old `question` or `action` item, parked before 6.0.0, is shown too: ask
a question with `AskUserQuestion` (the recommended option first); show an action's `text`, `cwd`
and exact `command` and run it only on a yes, as it is, in its `cwd`.

## 4. Clear what was shown

`cc-smart-dev-kit user clear <n>…` for each item of this session's that was shown, undone, run
or declined. Never `--all`: other sessions' items are on the same list.

Last, say what is left here, which sessions still hold items, and that sessions may ask as
usual again.
