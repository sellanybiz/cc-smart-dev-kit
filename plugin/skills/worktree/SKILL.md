---
name: worktree
description: For projects that work one session per git worktree - starting a task in a worktree, switching or leaving one, clearing it after its merge or when left over, finding a lost session, picking up a merged hook change, or an edit that landed in the wrong folder.
---

# Worktrees — The Steps

**Project add-on:** `.claude/anymodel/worktree.md` — read it first when it exists (which text
wins: the core instructions). It names the project's own worktree commands and hooks.

The rule — one worktree per session, the main checkout stays on the base branch, what every
worktree still shares, when to message other sessions — is the opt-in instructions
(`optin/worktrees.md`), which the project imports. This skill is the how. The project's
values (`base`, `prefix`, `setup`) are in `.claude/anymodel.json`, field `worktrees`.

## Start a task

1. **Pick the branch:** an existing one, or a new one for this task.
2. **`EnterWorktree` with the branch as its `name`.** A WorktreeCreate hook decides where it
   lands: the project's own, or the anymodel plugin's, which follows `worktrees` in
   `.claude/anymodel.json`. With no hook, Claude Code makes one inside `.claude/worktrees/`.
3. **Bring it up to date.** A worktree that already held the branch comes back as it was
   left. So after every `EnterWorktree`: `git fetch origin <base>`, then
   `git rev-list --count HEAD..origin/<base>`, and merge `origin/<base>` when it is behind —
   never into a branch whose pull request goes somewhere else (a hotfix or release branch).
4. **Run the project's setup** (`worktrees.setup`, for example the package install) when the
   hook did not, and again after any pull that changes the lockfile — stale packages make
   the linter and the type check report errors that are not in the code.
5. **A language-server tool** (such as Serena) stays pointed at the folder the session
   started in. Point it at the worktree's **absolute path** right after `EnterWorktree`, and
   again after `/clear`, a fork or a resume. Only the main session does this; subagents use
   the session's server and never re-point it. Until it points at the worktree, use `Grep`
   and `Read`.
6. **A refusal that names a running session** means that session works in that worktree:
   ask it. Never force it, and never move or remove its folder to get in.

**Already in a worktree?** From inside one, `EnterWorktree` is a switch, which Claude Code
allows only to worktrees under `.claude/worktrees/`. So: `ExitWorktree` with `keep`, then
`EnterWorktree` with the branch as its `name`. Entering a folder outside `.claude/worktrees/`
by `path` makes the person approve a prompt every time; use the `path` form only for what the
name cannot reach (a branch name Claude Code refuses), and say so.

**A subagent with `isolation: "worktree"`** gets its own worktree, cut from your current
commit, usually with no packages installed: it can read and edit, but not run tests until it
runs the project's setup.

## Before you leave or remove a worktree

1. **Wait for every agent you launched from it** (`/anymodel:subagent-decision` § While agents
   run).
2. Stop your dev server and any `Monitor` working in it (`TaskStop`).
3. Point the language-server tool back at the main checkout's absolute path. On Windows, a
   folder a running process works in cannot be deleted.
4. Then `ExitWorktree`.

## Clear it after the merge

In the same turn as the merge, unless the person wants more work on that branch:

- **Finished** means: every commit is on `origin/<base>`, nothing is uncommitted, no local
  file that cannot be rebuilt, no running session, server or process uses it. Then remove it:
  `ExitWorktree` with `remove` (a worktree a WorktreeCreate hook made needs a WorktreeRemove
  hook for this), or `git worktree remove <path>` and `git branch -d <branch>` from the main
  checkout.
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
resumes in the current folder.

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
