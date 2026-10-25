---
name: user-available
description: Use when the person is back and can answer again. Switches the unavailable state off, shows what was done while they were away, and goes through the parked list with them.
---

# The Person Is Back

**Project add-on:** `.claude/cc-smart-dev-kit/user-available.md` — read it first when it exists.
Where it differs, the add-on wins (`core.md`, top).

While the person was away, sessions parked what needed them (`/cc-smart-dev-kit:user-unavailable`).
Go through it now: short, in this order. Their time is the cost.

## 1. Switch back

1. `cc-smart-dev-kit user status --json` first: it holds `since`, which the next step clears.
2. `cc-smart-dev-kit user available`. `AskUserQuestion` works again; the list stays.

## 2. What was done

- The commits and merges since `since`, in the project: `git log --since=<since> --oneline`, and
  `--merges` for the merges. Also the other branches and worktrees a crew worked on.
- The crew runs: `cc-smart-dev-kit crew history` where the installed kit has it, else
  `cc-smart-dev-kit crew list`.
- The `Summary:` decisions of `cc-smart-dev-kit user list --json`, first and in the sessions' own
  words. Show them as the report; they need no answer. Clear them once shown.

Say it in a few lines: what shipped, what failed, what waits.

## 3. The list

`cc-smart-dev-kit user list --json`: each item has `id`, `kind`, `text`, `command`, `options`,
`recommend` (counted from 1), `session`, `crew` and `at`. Three kinds, in this order:

1. **Decisions** (taken for the person): show what was chosen, why and how to undo it. Ask keep or
   undo, one question each, `keep` first, in `AskUserQuestion` calls of at most four. An undo is
   done as the decision's own words say, then the item is cleared.
2. **Questions:** one `AskUserQuestion` call (more than four: the next call), each item's `text`
   as the question and its `options` in order, **the recommended one first and marked**. Act on
   each answer where it belongs (`/cc-smart-dev-kit:memory-routing`). A question a crew session
   asked (`crew` is set): `cc-smart-dev-kit crew answer <name> "<the answer>"`.
3. **Actions:** show each with its `text` and its exact `command`, and ask yes or no. A yes runs
   that command, as it is; it is that action's yes and no other's. Check first that it still makes
   sense (the branch moved, the pull request merged). A command whose `text` says it was cut, or
   that has no `command`, is not runnable as it stands: do it from its words, or ask.

## 4. Clear what was answered

`cc-smart-dev-kit user clear <n>…` for each item that was answered, undone, run or declined.
Never `--all` unless every item was dealt with. An action that failed stays on the list, with
what went wrong said to the person.

Last, say what is left, and that sessions may ask as usual again.
