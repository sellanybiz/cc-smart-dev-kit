---
name: worktree
description: For projects that work one session per git worktree - starting a task in a worktree, switching or leaving one, clearing it after its merge or when left over, finding a lost session, picking up a merged hook change, or an edit that landed in the wrong folder.
---

# Worktrees — The Steps

**Project add-on:** `.claude/cc-smart-dev-kit/worktree.md` — read it first when it exists. Where it
differs, the add-on wins (`core.md`, top). It names the project's own worktree commands and
hooks.

The rule — one worktree per session, the main checkout is where sessions start, what every
worktree still shares, when to message other sessions — is the opt-in instructions
(`optin/worktrees.md`), which the project imports. This skill is the how. The project's
values (`base`, `bases`) are in `.claude/cc-smart-dev-kit.json`, field `worktrees`.

**Another worktree's file is not yours to edit.** Once this session is in a worktree it
entered (`claude -w`, `EnterWorktree`), Claude Code limits it, and the agents it starts, to
that checkout: work there, and for a separate one launch a builder with
`isolation: "worktree"` (`/cc-smart-dev-kit:subagent-decision` § How to brief). **A subagent
never calls `EnterWorktree` or `ExitWorktree`:** with `isolation: "worktree"` it is already
isolated (Claude Code refuses `ExitWorktree` there), and it uses `cd` inside its own worktree.

## Start a task

1. **In a running session, `EnterWorktree` with the task name as its `name` creates the
   worktree**; an existing one is entered by its name, and resumes as it was left — it may
   carry an earlier session's commits. `claude -w <task-name>` is how a person starts a fresh
   session in one, and `claude -w <name>` opens an existing one. Use dashes: a `/` in a name
   becomes `+` in the folder and the branch. Claude Code makes
   `<repo>/.claude/worktrees/<task-name>` on the branch `worktree-<task-name>`, cut from the
   current branch when the project's settings say `"worktree": {"baseRef": "head"}`, else from
   `origin`'s default branch.
   **Already in a worktree and starting an unrelated task?** `ExitWorktree` first, then start
   the new one from the main checkout.
2. **`EnterWorktree` with `path` only switches between worktrees, for a session already
   inside one.** From the main checkout it fails: the session's working directory must already
   be inside a worktree of this repo. Only that form makes the person approve a prompt; the
   name needs none. **A worktree outside `.claude/worktrees/`:** the person starts a session
   in that folder.
3. **Bring it up to date.** A worktree that already held the branch comes back as it was
   left. So after entering it: `git fetch origin <base>`, then
   `git rev-list --count HEAD..origin/<base>`, and merge `origin/<base>` when it is behind —
   never into a branch whose pull request goes somewhere else (a hotfix or release branch).
4. **Run the project's install first** (for example `bun install`), and again after any pull
   that changes the lockfile. Claude Code has no setup step, so a new worktree has no
   packages, and stale packages make the linter and the type check report errors that are not
   in the code. The git-ignored files `.worktreeinclude` names are already copied in.
5. **Search the worktree, not the main checkout.** `Grep`, `Glob` and `Read` search the
   path you give them: give the worktree's absolute path. A code-index server of the
   project's own that started in the main checkout keeps answering for that folder.
6. **A refusal that names a running session** means that session works in that worktree:
   ask it. Never force it, and never move or remove its folder to get in.

## Before you leave or remove a worktree

1. **Wait for every agent you launched from it** (`/cc-smart-dev-kit:subagent-decision` § While agents
   run).
2. Stop your dev server and any `Monitor` working in it (`TaskStop`). On Windows, a folder a
   running process works in cannot be deleted.
3. Then `ExitWorktree` (a subagent does not: it is already isolated).

## Clear it after the merge

Builder worktrees belong to the build skill's local integration loop. Once their commits
are preserved on the plan branch and no process uses them, remove those clean checkouts
and merged branches. The workflow below covers the main session's worktree after its PR.


**The workflow says who clears it.** `cc-smart-dev-kit workflow show` prints
`clearWorktreeAfterMerge`: with it on, clear the worktree in the same turn as the merge, unless
the person wants more work on that branch. Left off — the default — say in one line that the
worktree looks finished, give these steps, and let the person decide.

- **Finished** means: every commit is on `origin/<base>`, nothing is uncommitted, no local
  file that cannot be rebuilt, no running session, server or process uses it. Then leave:
  Claude Code removes a clean worktree of an unnamed session on exit, and asks first for a
  named one or one with work left.
  `ExitWorktree` with `remove` does it now, from inside; from the main checkout,
  `git worktree remove <path>` and `git branch -d <branch>`. A subagent's worktree is
  removed when it made no changes. `cc-smart-dev-kit worktrees` lists the repo's finished
  ones and `--clean` removes them.
- **Not finished:** stop and ask. A worktree with uncommitted work, local files or commits
  that are not merged is someone's work.

Then tell the other sessions about the merge into `base` — once, after your last merge of the
turn: `ListAgents`, then one `SendMessage` to each session of this repo (not your own, not a
subagent, not another project). The message says what to do: merge `origin/<base>` at the
next stop, and anything that needs a person (new migrations, new settings).

## Finding a session again

A session's history follows its folder: while it works in a worktree, Claude Code lists it
under that folder. From the main checkout, `/resume` can widen its list to every worktree;
`claude --resume <session-id>` works from any folder. A session whose worktree was removed
resumes in the current folder. `cc-smart-dev-kit sessions` lists this project's sessions in
its worktrees too, and brings back the ones a restart or a closed window stopped.

## After a merged change to hooks or settings

Hook scripts run from the folder the session **started** in, and are read again on every
run: once that folder has the change, the session runs the new scripts. Which hooks run is
read at session start, so a changed settings file may need a restart of the sessions that
need it (exit, then `claude --resume`). A plugin's hook change needs `/reload-plugins`.

## A message that waits for approval

When only one of two sessions skips permission prompts, a message to the other waits for its
person to approve it, and may be dropped if nobody answers. Silence is not agreement.

## An edit landed in the wrong folder

1. `git diff HEAD -- <file>` there: every hunk must be yours. Mixed with someone else's?
   Leave it and ask.
2. Save it as a patch, `git apply` it in your worktree, and commit there.
3. `git restore --worktree -- <file>` in the other folder, for that file only, and tell that
   session.
