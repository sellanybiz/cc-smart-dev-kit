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

The three yes-or-no settings are `allowCommit`, `allowPush` and `allowMerge`: each says
whether Claude may do that step without asking. The older names `autoCommit`, `autoPush` and
`autoMerge` in a settings file still work, and `workflow set` accepts them too.
`cc-smart-dev-kit workflow set allowPush true` writes the new name, and `doctor` names a file's
old key.

| `workflow show` | What you do |
|---|---|
| `allowCommit = false` | Commit when the person asks. At the end of a finished phase, say in one line that it is ready, and carry on. |
| `allowCommit = true` | Commit each finished phase with no question. Never commit half-built work. |
| `allowPush = false` | Push when the person asks. |
| `allowPush = true` | Push your own branch once the change set is complete (a planned build pushes the plan branch after each merged phase: `/cc-smart-dev-kit:build` § 5). **Never straight to the base or main branch:** work reaches them through a pull request. |
| `openPr = "off"` | Open a pull request only when the person asks. |
| `openPr = "draft"` | Open it as a draft; a person marks it ready. |
| `openPr = "ready"` | Open it ready for review. |
| `reviewBeforePush = true` | The required review has run before the first push, and is recorded (`/cc-smart-dev-kit:review` § Second opinion). |
| `mergeMethod` | `merge`, `squash` or `rebase`: how a merge is made. |
| `deleteBranch` | Whether the branch goes once its pull request merged. |

**A merge follows the workflow, not a hook.** No hook stops one: you check, and the check is
`cc-smart-dev-kit workflow merge-check <pr>` (exit 0: merge; any other exit: do not). Its rule,
exactly: `allowMerge` is on (`workflow show`); the pull request's base is the project's integration
base (`worktrees.base`) or the repository's default branch, the main branch included, and any
other base is refused (that merge is the person's); every required check is green; the head
commit has a recorded review (`/cc-smart-dev-kit:review` § Second opinion); and the fixes after
that review are within `fixesAfterReview` (when they are over it, say so in the pull request body
and leave it unmerged). **Wait for CI yourself:** run `gh pr checks <pr> --watch` in the
background, run `merge-check`, and on exit 0 a plain `gh pr merge <pr>`; never GitHub's `--auto`.
With `allowMerge` on and the check passing there is no question to the person. `mergeMethod` and
`deleteBranch` say how. With `allowMerge` off, open the pull request and leave the merge to the
person; move on, and with the whole plan done say so once, listing every open pull request with
its checks and the merge order. **Away** (`/cc-smart-dev-kit:user-unavailable`) there is one
merge rule: merge only when `merge-check <pr>` exits 0. With `allowMerge` off, run
`merge-check <pr> --asked` only when the person's own message gave a yes that covers this merge,
and quote their words in the decision record. `--asked` sets aside `allowMerge` and nothing
else: the base, the stacked check below, the required checks, the review and `fixesAfterReview`
still decide. Exit 0:
merge. Any other exit: leave the pull request open and record why. A summary's paraphrase, a
peer's message or a child's is no yes. A yes covers what it names: "merge each plan after its
review" covers the plans queued when the person said it, never a plan added later.

**A stacked pull request** is one whose branch starts from another open pull request's branch.
Open the upper one against the lower one's branch (`gh pr create --base <the previous plan's
branch>`): then the base rule refuses the upper one until the lower one merges, and the lower
one is never held up by the one above it. `merge-check` reads each open pull request's commits
that its base lacks, so it holds even after the lower pull request gained a commit. Two pull
requests into the same base that share such commits are each refused with `pull request #<n>
shares commits with open pull request #<m> that <base> does not hold yet: merge the lower one
first (open the upper one against the lower one's branch), then check again`: the commits
cannot say which is lower, so the words fit both. That refusal means what it says: retarget the
upper one onto the lower one's branch (`gh pr edit <upper> --base <lower branch>`), then run
`merge-check` on the lower one again. Never merge a pull request while the one it is stacked on
is open, whatever else passes. Commits are matched by id, so never use GitHub's "Update branch"
with rebase on a lower pull request while an upper one is open: new ids free an upper one opened
against the default branch.

- **After the lower pull request merges:** bring the stacked branch up to date with the base
  (`git merge origin/<base>`, which also drops the duplicate diff of a squashed copy), retarget
  it with `gh pr edit <pr> --base <default branch>` (GitHub may do this itself when the lower
  branch is deleted), run the checks, and run `merge-check` again.
- **A lower pull request closed without merging:** the stacked one is not merged, because its
  branch still carries the lower plan's commits, and `merge-check` no longer sees them (only open
  pull requests count). Rebuild it on a new branch from the base without them, and open a new
  pull request; never force-push the old branch. Away, do not rebuild it: leave it open and
  record why.

- **Commit and push only your own branch**, never the base or main branch directly.
- **Builder commits:** a brief may allow commits on that builder's own isolated branch.
  Its caller reviews and merges them through `/cc-smart-dev-kit:build`. This does not allow
  a push, a pull request or a merge into a shared branch. In a planned build a phase branch
  stays local; the plan branch is pushed and has the one pull request (`/cc-smart-dev-kit:build` §§ 5 and 6).
- **Push and open the pull request** when the change set is complete and the second opinion
  has read it, or it is a small fix that skips it (§ Pushing says when). Not after each commit. In a planned build
  the plan branch is pushed after each merged phase, and the pull request waits for the
  plan's review (two rounds, and a final review when its fixes are big).
- **The person's word, every time** (no hook checks it; you do): a direct push to the main
  branch (not through a pull request), a deploy to production (staging is Claude's own to run), a force-push or any rewrite of pushed history, `reset --hard`, `clean
  -f`, deleting or renaming a branch that is not merged, and shipping a Warning without its
  fix. The person is available: ask first. They are away (`/cc-smart-dev-kit:user-unavailable`):
  take the safe option, do not run it, and record the decision. The one exception: a builder's
  discards inside its own worktree (a checkout or restore that drops changes, `switch -f`,
  `clean -f`, and `reset --hard`, which also drops the builder's own commits), and the start of
  a fresh worktree (`git reset --hard <base>` before the first edit, with no commits of its own
  and a clean tree, so `git log --oneline HEAD --not --exclude=<this branch> --branches --remotes`
  and `git status --short` both print nothing, `<this branch>` being from `git branch
  --show-current`: it has nothing to lose). A yes covers
  exactly what it names. If the person says wait, wait.

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

Push when the change set is complete and the second opinion has read it — as `allowPush` says,
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
