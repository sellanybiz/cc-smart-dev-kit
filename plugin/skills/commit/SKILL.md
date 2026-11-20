---
name: commit
description: Use when asked to commit or after a finished phase. Stage and commit; follow workflow settings for push, pull request and merge. Nothing happens unasked when those settings are off.
---

# Commit, Push, Merge

**Project add-on:** `.claude/cc-smart-dev-kit/commit.md` — read it first when it exists. Where it
differs, the add-on wins (`core.md`, top). It names the project's base branch, protected
branches, message style and owner rules.

**The project's workflow is the switch** for the four things below. Read it once before the
first of them — `cc-smart-dev-kit workflow show` prints every value, with where it came from —
and follow it for the branch you are on. Nothing in it set: the safe default holds, and none
of the four happens until the person asks (or the add-on says otherwise).

| `workflow show` | What you do |
|---|---|
| `autoCommit = false` | Commit when the person asks. At the end of a finished phase, say in one line that it is ready, and carry on. |
| `autoCommit = true` | Commit each finished phase with no question. Never commit half-built work. |
| `autoPush = false` | Push when the person asks. |
| `autoPush = true` | Push your own branch once the change set is complete (a planned build pushes the plan branch after each merged phase: `/cc-smart-dev-kit:build` § 5). **Never straight to the base or main branch:** the git guard asks there, and work reaches them through a pull request. |
| `openPr = "off"` | Open a pull request only when the person asks. |
| `openPr = "draft"` | Open it as a draft; a person marks it ready. |
| `openPr = "ready"` | Open it ready for review. |
| `reviewBeforePush = true` | The required review has run before the first push, and is recorded (`/cc-smart-dev-kit:review` § Second opinion). |
| `mergeMethod` | `merge`, `squash` or `rebase`: how a merge is made. |
| `deleteBranch` | Whether the branch goes once its pull request merged. |

**A merge is the one step a hook guards.** With `autoMerge` off, or a pull request whose base
is not the project's integration base, or a check not green, or no recorded review of its head
commit, the merge guard asks the person before `gh pr merge` runs. Where `autoMerge` is on and
everything is in place, it lets the merge through with no question — and `mergeMethod` and
`deleteBranch` still say how. **Either way, never wait for a merge:** open the pull request and
move on; with the whole plan done, ask once, listing every open pull request with its checks
and the merge order.

- **Commit and push only your own branch**, never the base or main branch directly.
- **Builder commits:** a brief may allow commits on that builder's own isolated branch.
  Its caller reviews and merges them through `/cc-smart-dev-kit:build`. This does not allow
  a push, a pull request or a merge into a shared branch. In a planned build a phase branch
  stays local; the plan branch is pushed and has the one pull request (`/cc-smart-dev-kit:build` §§ 5 and 6).
- **Push and open the pull request** when the change set is complete and the second opinion
  has read it, or it is a small fix that skips it (§ Pushing says when). Not after each commit. In a planned build
  the plan branch is pushed after each merged phase, and the pull request waits for the
  plan's review (two rounds, and a final review when its fixes are big).
- **Always the person's word, every time:** anything into the main branch or production, a
  force-push or any rewrite of pushed history, `reset --hard`, `clean -f`, deleting or
  renaming a branch that is not merged, and shipping a Warning without its fix. The one
  exception: a builder's discards inside its own worktree, on a plain line (only `git`, a `cd`
  to one folder, and simple file programs), which the git guard lets through: a checkout or
  restore that drops changes, `switch -f`, `clean -f`, and `reset --hard`, which also drops
  the builder's own commits. A yes covers exactly what it names. If the person says wait, wait.

## Steps

1. Run in parallel: `git status`, `git log -5`, `git diff --staged --stat`. Read the full diff
   only if the review did not.
2. **In a builder:** skip review and commit only if the brief allows it, then report to your
   caller. **In the main session, the review ran?** If not (the person said "commit" cold, in a fresh session), run
   `/cc-smart-dev-kit:review` now. A Critical stops the commit. A Warning is fixed, or shipped only
   with the person's explicit yes. A small fix is exempt: say so in one line.
3. **The checks on what you changed ran?** `/cc-smart-dev-kit:verify-change` § 2. The full check
   (§ 4) runs once, not per commit. A commit hook that fails: fix the cause and commit again.
4. **Include deploy tasks.** Run `cc-smart-dev-kit task list --branch --base <base>` for
   the branch's real base: it groups the deploy task files this branch changes by environment.
   Commit those files with the change that needs them. Close deploy tasks completed by this
   change with `task_done` and evidence, in this same change. A deploy run commits its closes on
   its own deploy branch, whose small pull request carries them (`/cc-smart-dev-kit:tasks` § 5).
   The output fills the PR's Deploy tasks heading and, with the open issues, its Still owed
   heading (`/cc-smart-dev-kit:pull-request`).
   **Stage by path** — never `git add -A` while subagents still write. Read
   `git diff --staged --stat`; investigate any unexpected path before committing.
5. **The message:** follow the style in `git log` (for example conventional commits:
   `feat`, `fix`, `refactor`, `docs`, `test`, `chore`). A title under 70 characters; a body
   about **why**, not what. Write it with a heredoc, except in a session or agent isolated
   in a worktree: Claude Code refuses there any git line it cannot read as plain, so pass the
   message as repeated single-quoted `-m '…'` flags with no apostrophe in them
   (`cc-smart-dev-kit:builder`). End with
   the attribution lines the harness gives you in its git instructions — you write them;
   nothing adds them for you.
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

Push when the change set is complete and the second opinion has read it — as `autoPush` says,
or when the person asks. Run the push (its hooks may be slow) and any CI watch in the
background; write the pull request body while it runs (`/cc-smart-dev-kit:pull-request`). Open the
pull request only after the push succeeded, and as `openPr` says: a draft a person marks ready,
ready for review, or none at all. Then watch CI in the background. When the machine is too busy
for the push hook: `/cc-smart-dev-kit:verify-change` § 4 says when it may be skipped.

**Pushes cost CI, so time them.** This is the one home for the rule.

- **Before the pull request opens,** a push costs no CI only where CI runs on pull requests and
  the default branch alone: read the project's CI triggers before you treat it as free.
- **After it opens,** a push can start a CI run. Collect every fix of a round (review findings, a
  CI failure), run the full check locally (`/cc-smart-dev-kit:verify-change` § 4), then push once.
  Never push one fix at a time, and never use CI to find what the local check finds.
- **One ship point for the session.** Its small fixes outside a plan
  (`/cc-smart-dev-kit:review` defines them) and its follow-up child's work
  (`/cc-smart-dev-kit:herdr` § Follow-up child) ship together: at the end of the turn that
  finishes the person's request, or at once when the person says to ship now. The small fixes
  ride on the session's own branch; when that is a plan branch, or already carries a reviewed
  change set, they get a new branch from the default branch, in a worktree of its own
  (`/cc-smart-dev-kit:worktree`). One pull request opens there
  at the ship point. At that same moment the lead sends the follow-up child `ship`. Until then the
  child commits each finding and never pushes.
