---
name: commit
description: Stage, write the message and commit - and when to push, open the pull request and merge. By default you commit and push only when the person asks; a project's add-on can hand you its own branch's commits, pushes and pull request. A merge always waits for the person's yes. Use when the person says commit, and at the end of each finished, reviewed phase.
---

# Commit, Push, Merge

**Project add-on:** `.claude/cc-smart-dev-kit/commit.md` — read it first when it exists. Where it
differs, the add-on wins (`core.md`, top). It names the project's base branch, protected
branches, message style and owner rules.

## When to commit, push and merge

**By default, commit and push only when the person asks** — Claude Code's own default. At the
end of a finished, reviewed phase, say in one line that it is ready to commit, and carry on.

**A project can hand you more.** Its add-on, `.claude/cc-smart-dev-kit/commit.md`, turns it on with a
line such as: "Commit and push your own branch without asking, and open its pull request."
With that line, the commit, the push and the pull request below are your call, with no
question. Either way, a merge waits for the person.

- **Only on your own branch.** Never commit or push straight to the base branch or the main
  branch: every change reaches them through a pull request.
- **Commit** (when asked, or when the add-on allows it) each finished phase once its tests
  are green and your own review pass (`/cc-smart-dev-kit:review`) is done. Never commit half-built
  work.
- **Push and open the pull request** (the same condition) when the change set is complete
  and the second opinion has read it, or it is a small fix that skips it. Not after each
  commit.
- **Merge only after the person says yes** — and never wait for that: open the pull request
  and move on. When the whole plan is done, ask once, listing every open pull request with
  its checks and the merge order.
- **Always the person's word, every time:** anything into the main branch or production, a
  force-push or any rewrite of pushed history, `reset --hard`, `clean -f`, deleting or
  renaming a branch that is not merged, and shipping a Warning without its fix. A yes covers
  exactly what it names. If the person says wait, wait.

## Steps

1. Run in parallel: `git status`, `git log -5`, `git diff --staged --stat`. Read the full diff
   only if the review did not.
2. **The review ran?** If not (the person said "commit" cold, in a fresh session), run
   `/cc-smart-dev-kit:review` now. A Critical stops the commit. A Warning is fixed, or shipped only
   with the person's explicit yes. A small fix is exempt: say so in one line.
3. **The checks the push will run, already run?** `/cc-smart-dev-kit:verify-change` § 4. A commit
   hook that fails: fix the cause and commit again.
4. **Stage by path** — never `git add -A` while subagents still write. Then read
   `git diff --staged --stat`: an unexpected path is investigated before the commit, not
   explained after it.
5. **The message:** follow the style in `git log` (for example conventional commits:
   `feat`, `fix`, `refactor`, `docs`, `test`, `chore`). A title under 70 characters; a body
   about **why**, not what. Write it with a heredoc. End with the attribution lines the
   harness gives you in its git instructions — you write them; nothing adds them for you.
6. A plan covers this work? Add `Plan: <path>` at the end of the body. Never end a commit
   turn with an uncommitted edit to the plan file.
7. Report the commit's short hash and title in one line, and carry on with the plan.

## Change size

**One logical change per commit.** Past about 200 lines or five files, ask: must every piece
land together?

- **No** → split. Two unrelated things in one commit is the real problem, at 20 lines as
  often as at 500.
- **Yes** → keep one commit and say why in one line. A rename with its call sites, a new
  rule with its index entry, a migration with its generated types, a shared helper with the
  copies it replaces: these land together.
- **Each commit stands alone:** it builds, type-checks and lints clean. Never split into a
  commit that does not build. Refactor first, commit, then build the feature.

## Pushing

Push when the change set is complete and the second opinion has read it. Run the push (its
hooks may be slow) and any CI watch in the background; write the pull request body while it
runs (`/cc-smart-dev-kit:pull-request`). Open the pull request only after the push succeeded, then
watch CI in the background. A re-push after a hook, CI or review fix needs nothing more.
