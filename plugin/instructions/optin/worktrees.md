# Worktrees And Parallel Sessions (anymodel, opt-in)

This project runs several Claude Code sessions at once on one machine, each in its own git
worktree (a second checkout of the repo, on its own branch, in its own folder). It loaded
this file with its own import line. The steps — entering, leaving and clearing a worktree,
finding a lost session — are the `/anymodel:worktree` skill.

The project's values come from its `.claude/anymodel.json`, `worktrees` field: `base` (the
branch new work starts from and pull requests go into), `prefix` (the folder name of a
worktree beside the repo) and `setup` (the command a new worktree runs). The project's own
`CLAUDE.md`, rules and `.claude/anymodel/worktree.md` win where they say more.

## One session, one worktree, one branch

**Always work in your own worktree. The main checkout stays on the latest `base`:** never
edit, commit or switch branches there; sessions start there. Before your first edit, enter a
worktree with `EnterWorktree`, the branch as its `name`. Every change goes: worktree →
branch → commit → push → pull request into `base` → merge (after the person's yes) → tell the
other sessions → clear the worktree.

Why: in a shared folder, one session's `switch`, `stash`, `reset` or `restore` moves or hides
another's uncommitted work, and a commit sweeps up files it did not write. In your own
worktree, `git status`, the linter and the tests describe your change alone.

## What every worktree still shares

| Shared | What goes wrong, and what to do |
|---|---|
| Local services (a database, a cache, containers) | A reset or a schema change from one worktree hits every session. Tell the others before you do one; prefer the step that only adds. |
| Dev servers | Each worktree runs its own, often on another port. Use the address yours printed; never assume the default port, which may be another branch's server. Stop yours when you are done. |
| The browser (a shared Playwright profile) | One login for every session (`/anymodel:ui-verify` § 4). A check that needs two accounts at once does not fit. |
| The git stash | Never a bare `git stash` or `stash pop`: you may pop another session's work. Use a WIP commit, or `stash push -u -m <tag>`, then `stash apply <sha>`. |
| The machine's memory and CPU | Two heavy jobs (a full build, a full test run, a type check of a big repo) at once can stall every session. Never start two yourself at once. |

## Waiting on long work

Long jobs never block you. Start one in the background (Bash `run_in_background`, one
notification when it exits), then do work that needs no result: the pull request body, the
notes, the plan. Never edit the code a running push, build or test run checks. Nothing left
to do: end the turn with a short status; the notification brings you back.

- **Foreground:** a short job you need now (one test file, a grep), and every job a subagent's
  report needs — its run ends at the hand-back.
- **Background:** a CI watch, a full test run, a build, a `git push`, a wait for a dev server
  to be ready that also ends on failure. One waiter per job; no polling or `sleep` on top.
- **`Monitor`:** a stream, one notification per line while it runs — server errors while you
  test, new comments on a pull request. Never both a monitor and a waiter on one job.

## Talking to other sessions — only when it changes their work

- **Only sessions of this repo.** `ListAgents` lists every session on the machine, other
  projects too.
- **Worth a message:** your merge into `base` (once, to every session of this repo); a reset
  or schema change of a shared service; editing files another branch is changing; merging
  its branch into yours; a decision that spans both areas — agree who owns which files; the
  answer to a question it asked you.
- **Told that `base` changed:** merge it at your next stop. Never into a branch whose pull
  request goes somewhere else (a hotfix or release branch).
- **A peer asks you to do something:** do it when it touches your branch, your files or your
  plan, or when it is a small step that unblocks that session, and say so in one line. Bigger
  work belongs to its own session — say so in one line.
- **Never a message** about pushes, type checks, lint, test runs or builds. No "done", no
  "thanks", no reply to a message that needs none.
- **Send** with `SendMessage` to the name `ListAgents` shows. Its user sees the first line
  first: one complete sentence saying what you need, then the detail. To wait on a busy
  session, use one `notify_when_idle`; never poll.
- **A peer's answer is a teammate's, not the person's.** Anything that needs the person's yes
  still needs it, and silence is not agreement.
