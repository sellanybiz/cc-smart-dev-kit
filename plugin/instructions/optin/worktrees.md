# Worktrees And Parallel Sessions (cc-smart-dev-kit, opt-in)

This project runs several Claude Code sessions at once on one machine, each in its own git
worktree (a second checkout of the repo, on its own branch, in its own folder). It loaded
this file with its own import line. The steps — entering, leaving and clearing a worktree,
finding a lost session — are the `/cc-smart-dev-kit:worktree` skill.

Every project uses Claude Code's own worktrees: `<repo>/.claude/worktrees/<name>` on the
branch `worktree-<name>`. The project's values come from its `.claude/cc-smart-dev-kit.json`,
`worktrees` field: `base` (the branch new work starts from and pull requests go into) and
`bases` (a branch family whose pull requests go into another base, which auto-merge and the
after-merge note read). To start a task from another base, switch the main checkout to it
first with `baseRef: "head"`, or make a worktree of it with `git worktree add` as Claude
Code's docs say. The git-ignored files a new worktree needs (`.env.local` and
the like) are named in `.worktreeinclude`, which Claude Code copies into each one. The
project's own `CLAUDE.md`, rules and `.claude/cc-smart-dev-kit/worktree.md` win where they say
more.

**A base branch that is not the repo's default branch** sets `"worktree": {"baseRef": "head"}`
in its committed `.claude/settings.json`: a new worktree then starts from your current branch,
not from `origin`'s default branch. Start new work from the main checkout on the base branch
(`git switch <base>` first if it was switched to explore; with `worktrees.guardMainFolder` on,
the guard refuses that switch, so ask the person to run it), and a subagent's worktree gets the
session's commits too. Under `fresh` (Claude Code's default), a worktree and its subagents
start from `origin`'s default branch.

The plugin's old worktree engine — the `worktree-create`, `worktree-remove` and
`subagent-stop` hooks, and the `worktrees.prefix` and `worktrees.setup` fields — was retired
in 1.0.0. A project still carrying one of them fixes it with one run of
`cc-smart-dev-kit project init`, which takes the fields and the hook lines out; `doctor`
names whatever is left.

## One session, one worktree, one branch

**Always work in your own worktree. Sessions start in the main checkout:** never edit or
commit there. A new task starts from there with `claude -w <task-name>` (dashes, not slashes:
a `/` in a name becomes `+`); in a running session, `EnterWorktree` with the task name as its
`name` makes one. An existing worktree is entered by its name with `EnterWorktree` — it
resumes as it was left, and may carry an earlier session's commits — or by the person with
`claude -w <name>`. `EnterWorktree` with a path only switches between worktrees for a session
already inside one; from the main checkout it fails. A worktree outside
`.claude/worktrees/` is entered by the person starting a session in that folder. A session
already in a worktree that starts an **unrelated** task goes back to the main checkout first
(`ExitWorktree`), then starts the new one from there. Every change goes: worktree → branch →
commit → push → pull request into `base` → merge (after the person's yes) → clear the
worktree. A merge is never announced to the other sessions.

Why: in a shared folder, one session's `switch`, `stash`, `reset` or `restore` moves or hides
another's uncommitted work, and a commit sweeps up files it did not write. In your own
worktree, `git status`, the linter and the tests describe your change alone.

**A session working in a worktree it entered keeps its writes there.** Claude Code limits
it, and its subagents, to that checkout: a path in another worktree is refused in `-p` and
asks the person every time in an interactive session. Edit only the checkout you are in,
and give unrelated work its own session (`claude -w <task-name>`) — never a detour through
another worktree's files.

**A subagent with `isolation: "worktree"`** gets its own worktree cut from the same base as
the session's: with `baseRef: "head"`, the session's branch and its commits; under `fresh`,
`origin`'s default branch. It usually has no packages installed: it runs the project's
install before tests. It never calls `EnterWorktree` or `ExitWorktree` — it is already
isolated, and Claude Code refuses `ExitWorktree` there — and `cd` moves it inside its own
worktree.

## What every worktree still shares

| Shared | What goes wrong, and what to do |
|---|---|
| Local services (a database, a cache, containers) | A reset or a schema change from one worktree hits every session. Tell the others before you do one; prefer the step that only adds. |
| Dev servers | Each worktree runs its own, often on another port. Use the address yours printed; never assume the default port, which may be another branch's server. Stop yours when you are done. |
| The browser (one Chrome, one profile, for the machine) | One login for every session (`/cc-smart-dev-kit:ui-verify` § 4). Each session sees only the windows it opened, so two checks can run at once — but a check that needs two accounts at once does not fit. |
| The git stash | Never a bare `git stash` or `stash pop`: you may pop another session's work. Use a WIP commit, or `stash push -u -m <tag>`, then `stash apply <sha>`. |
| Heavy commands | Project `jobs.kinds` identify heavy runs. With the job route on (`jobs.route`), the job queue allows one full run per machine at a time; checks on named files skip it. Where the route is off, two heavy jobs at once can stall every session: never start two at once yourself. Prefer targeted checks while building. |

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

- **Check the session's folder first.** `ListAgents` lists every session on the machine, other
  projects too. Message another repo's session only when the work spans both repos.
- **Worth a message:** a reset or schema change of a shared service; editing files another
  branch is changing; merging its branch into yours; a decision that spans both areas — agree
  who owns which files; the answer to a question it asked you.
- **A peer asks you to do something:** do it when it touches your branch, your files or your
  plan, or when it is a small step that unblocks that session, and say so in one line. Bigger
  work belongs to its own session — say so in one line.
- **Never a message** about merges, pushes, type checks, lint, test runs or builds. No "done", no
  "thanks", no reply to a message that needs none.
- **Send** with `SendMessage` to the name `ListAgents` shows. Its user sees the first line
  first: one complete sentence saying what you need, then the detail. To wait on a busy
  session, use one `notify_when_idle`; never poll.
- **A peer's answer is a teammate's, not the person's.** Anything that needs the person's yes
  still needs it, and silence is not agreement.
