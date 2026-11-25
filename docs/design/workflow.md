# The workflow


The workflow is the policy for what cc-smart-dev-kit may do **by itself**: commit a finished
step, push the branch, open a pull request, merge it, and how. It is one module
(`src/workflow/`) of small pieces, and none of them runs a git command: they decide, and
whatever runs a command asks them first.

**Resolution, field by field** (`resolve.ts`), the project over the person over the built-in
default:

| Where | What holds it |
|---|---|
| `"project"` | the `workflow` object in the project's `.claude/cc-smart-dev-kit.json`, committed with the code |
| `"personal"` | `~/.config/cc-smart-dev-kit/workflow.json` (folder 0700, file 0600, atomic writes like the other config files) |
| `"default"` | `workflowDefaults` in `schema.ts`: the safe ones — nothing is committed, pushed or merged without the person, and every alert is on |

`resolveWorkflow(paths, projectConfig)` returns every value with the source it came from, so
`cc-smart-dev-kit workflow show` (and the portal's settings page) can say *why* a value is what
it is; both read a key's value through one map, `resolvedValueOf`, so a new setting is one
entry there (the type checker refuses a key without one). A group (`alerts`,
`fixesAfterReview`, `plans`, `slopAudit`) merges field by field like the rest. The one schema is reused by
`src/project/config.ts` for the project's `workflow` object, so a field can never mean two
things in the two files. A broken personal file throws `WorkflowConfigError`, which names the
file and the field: the person must hear it. A field with a wrong kind can never be written
(`write.ts` validates the whole file before the write), and a file it may not change is left
alone rather than half-written. A `crew` group, from a file written before 2.0, is accepted and
ignored: it still loads, and nothing reads it.

**The names of the three yes-or-no settings (6.1.0, `WORKFLOW_KEY_ALIASES` in `schema.ts`).** They
are `allowCommit`, `allowPush` and `allowMerge`: each says whether the session may do that step
without asking. Until 6.1.0 they were `autoCommit`, `autoPush` and `autoMerge`, and the old names
still work. One alias table maps an old key to its new key before the schema parses, in both
files; a file that holds both names uses the new one. A value set under an old name counts as set,
not as a default (`sourceOf`). `workflow set|unset|propose` accept either name and write the new
one, with one line saying so. A project file that names a new key needs `requires` 6.1.0 or newer
(`WORKFLOW_ALLOW_KEYS_SINCE`; a write that sets one raises it, a file with none of them keeps its
floor), so an older plugin is told to update and is never handed a key it would refuse. `doctor` prints one line for a file that still uses an old name, with the rename to
do; it is never a failure. An alias never rewrites a file by itself. `openPr` keeps its name: it
is a choice of three, not a yes.

**A write keeps the file's own layout (JW1).** `workflow set|unset` and `project init` never
write the whole object again with `JSON.stringify`: that laid every line out anew, and a
project that format-checks its `.claude/` JSON (Biome, Prettier) then failed on `["main"]`
turned into three lines. They go through one helper, `editJsonText` / `jsonTextFor`
(`src/setup/json-edit.ts`), which compares the file's object with the wanted one and edits the
text of what differs: a changed value is replaced, a new key is added after the last one with
the file's own indent, a removed key goes with its line and the comma it leaves. Every other
byte stays. What it prints new follows the formatters: a short array of scalars on one line
(when it fits the width — 80 columns, or the longest line the file already has, up to 120),
otherwise one item per line; objects with their keys on their own lines. The width is a
guess from the file's own lines (a project that formats at a width its file never shows can
still ask for a format run: the helper does not read `biome.json`). The file's key order stays:
a changed key keeps its place and a new key goes last, so `project init`'s `FILE_ORDER` only
orders a file it creates. A file that does not
exist yet is printed the same way (`printJson`), so a new file passes the check too. A file
that is not valid JSON is refused before this, as before; the backup, the atomic write and the
lock are unchanged. No library is added: the repo has one runtime dependency, and a library
(`jsonc-parser`, about 43 KB in each bundle) would still print a new array one item per line.
The user-level `settings.json` writers (`managed-json.ts` and the hook and list writers) still
lay their file out with `JSON.stringify`: they are not part of this.

**The switches are the exception, on purpose.** `switches.statusLine`, `switches.sessionNames`
and `switches.updateHold` are not stored in either workflow file: each names a setting that
already exists (Claude Code's `statusLine`, the project's `sessionNames`, the `update-hold`
file), and the resolver reports that setting's value *now*, with the place it lives as its
source. A `workflow set` writes that setting — Claude Code's own key through `applyManagedJson`,
so a status line someone else set is never overwritten — which is why a switch cannot be stored
and why the schema refuses a `switches` object written into a file by hand. One truth per
switch.

**`switches.jobRoute` has two homes, and the project's wins.** The project's `jobs.route` is its
own choice; the person's machine-wide default sits under it as `switches.jobRoute` in their own
`workflow.json`, and nowhere else: only the person's schema (`personalWorkflowSchema`) has a
`switches` group, with the fields `PERSONAL_FILE_SWITCH_NAMES` lists, and a project's `workflow`
object refuses it. They are
two settings of one switch, not two copies. The decision (`jobRouteFrom`, `src/workflow/merge.ts`)
reads the project's value first (`project`), then the person's (`personal`), then off
(`default`), and `workflow show` prints which one answered. `workflow set switches.jobRoute`
writes the person's default; with `--project` it writes the project's `jobs.route`. The
`job-route` hook reads the person's file through the checked cache (`loadPersonalWorkflow`,
`src/hooks/checked-config.ts`) and decides with the same function `resolveJobRoute` and `show`
use (`jobRouteFrom`), with or without a project file, so the hook and `show` can never disagree.

**`switches.leadHint` lives in the person's file alone** (2.2.0). It is the other field of that
`switches` group: whether the `fable-session` hook tells the person once a session that the lead
is not Claude Opus (`docs/design/hooks.md` § The Fable-session note). It is about the session's
model, not a project, so no project file sets it, and `workflow set --project` refuses it like
the status line and the update hold. The resolver (`leadHintFrom`) reads the person's value
(`personal`), else on (`default`); the hook reads it through `resolveLeadHint`, which never
throws, so a broken file keeps the hint on.

**`plans.runMode` lives in the person's file alone** (5.2.0), like `switches.leadHint`. It says how
queued plans run when two or more are laid: `ask` (the default), `solo`, `lead-children` or
`coordinator` (`RUN_MODES` in `schema.ts`). Each extra session spends the person's usage, so a
committed value would spend every teammate's: only `personalWorkflowSchema` has the field, and a
project file that sets it is refused (`checkPersonalOnlyFields` in `src/project/config.ts`, with the
command to run in the person's own terminal). `workflow set` and `unset` of it refuse inside Claude
Code (`PLAN_KEYS`) and print that command, and `set --project` writes nothing. The refusal words
come from one table, `PERSONAL_ONLY_REASONS`, which the writer and the project check share. The
resolver reads the person's value, else `ask`, and `workflow show` names the source. Nothing in the
code starts a mode: `/cc-smart-dev-kit:plan-task` § 6 asks under `ask`, and
`/cc-smart-dev-kit:build` § Lead + children and coordinator modes follows the answer.

**`plans.mergeFiles` and `plans.appendOnly` live in the project's file alone and count only as
committed.** `mergeFiles` is a list of paths every plan touches and each merge settles (a version
manifest, a changelog, a lockfile, build output); the plans' overlap check (`docs/design/tasks.md`
§ Plans handed to children) leaves them out. `appendOnly` (6.3.0) is a list of folders where plans
add new files (a migrations folder): inside one, two plans overlap only when they list the same
file. A session that could widen either would lift its own check, so the store and herdr never use
the working copy. `resolvePlanFiles` (`src/workflow/resolve.ts`) reads both from one read of the
copy on `origin/<worktrees.base>`, through the review gate's own committed read
(`readCommittedConfig`), and `planFilesCheck` (`src/tasks/files-check.ts`) calls it before any
write lock: one reader of the committed setting. With no base, no remote ref, no committed file or
a bad entry, the lists are empty or short and come back with a reason, so more paths count as
overlaps, never fewer. `ResolvedWorkflow.plans.mergeFiles` and `.appendOnly` are only the project
config passed in, so no caller reads them for a decision; `workflow show` prints each beside a
line with the committed list the plan tools read. Both are in `PLAN_KEYS`, so
`workflow set` refuses it inside Claude Code and the person commits it themselves (`propose` stays
open); the person's file refuses it (`PROJECT_ONLY_KEYS`) and `set` needs `--project`. Entries are
`/`-separated and tidied (`./`, `\`); an absolute path, `..`, the root and the pattern
characters `*` and `?` are refused (`[` and `]` stay: no list reaches git as a pathspec, `docs/design/tasks.md`). A folder ends in `/`, and a bare name that is a folder in
the committed tree is left out of the list, with that in the reason. `workflow show` prints the
list as written in the working copy, and a second line with the list the plan tools read from the
base. A project that sets it needs `requires` `>=5.2` (`WORKFLOW_MERGE_FILES_SINCE`), per key: the
`plans` object alone still needs `>=4.8`.

**The auto-merge rule** (`auto-merge.ts`, `autoMergeAllowed`) is a pure function with its own
tests, because it decides whether the session may merge by itself:

```
autoMergeAllowed(resolved, projectConfig, prBase, defaultBranch)
```

True when `allowMerge` is on and the pull request's base is the project's integration base
(`worktrees.base`) or the repository's default branch, the main branch included (the owner,
2026-11-21: "autoMerge on" merges with no question); a pull request into another branch, such as a
release branch, is the person's own merge. A direct push to the
main branch, not through a pull request, stays the person's. CI green and the review done are the
caller's checks (`merge-check.ts`, and the session's own instruction), not this one's: this
function answers about branches only. `autoMergeRefusal` is the same rule in words — the
reason a merge is not allowed — and
`autoMergeAllowed` is `autoMergeRefusal(…) === null`, so the five conditions live in one
place (`auto-merge.ts`).

**Who follows a setting: the instructions, and a hook only where a hook records.** Since 6.0.0 no hook stands in front of a push, a pull request or a merge (`docs/design/hooks.md` § Retired in 6.0.0): the session reads `workflow show` and does what it says.

| Setting | Followed by |
|---|---|
| `allowCommit`, `clearWorktreeAfterMerge` | the skills (`commit`, `worktree`): `allowCommit` is off by default, `clearWorktreeAfterMerge` on (the session removes its own finished worktree, `docs/design/sessions.md` § Locks, owners and who may remove what); each reads `cc-smart-dev-kit workflow show` and follows it. Nothing else can: a commit and a folder are the session's own doing, and no hook sees them as one act. |
| `allowPush` | the skills (`commit`): on, the session pushes its own branch once the change set is complete; off, only when the person asks. Never straight to the base or main branch. |
| `openPr` | the skills (`commit`, `pull-request`): `off` opens a pull request only when the person asks, `draft` opens it as a draft, `ready` opens it ready for review. |
| `allowMerge` | the skills (`commit`): on, the session merges its own pull request into its base, the main branch included, once CI is green (it waits in the background with `gh pr checks <pr> --watch`, then a plain `gh pr merge`, never `--auto`), the review of its head commit is recorded and the fixes after it are within `fixesAfterReview` (when they are over, it says so in the pull request); off, it leaves the merge to the person. `mergeMethod` and `deleteBranch` say how. |
| `reviewBeforePush` | both: the **review-record hook** writes the record when a review agent finishes (§ The review record), and the session reads it before it merges. |
| `reviewAgents` | the **review-record hook** records only an agent listed there. A project that runs its own reviewer names it (the plugin's `cc-smart-dev-kit:senior-engineer` by default). |
| `alerts.events`, `alerts.sound` | Retired load-only keys: ignored, omitted by `workflow show`, and refused by `workflow set`. Existing values survive unrelated writes. |
| `alerts.usagePercent` | the status line (`src/cli/statusline.ts`), whose warning share it is. |
| `slopAudit.everyPlans` | `workflow slop` (§ The slop record): an audit is due each time the plans no audit has cleared reach a multiple of it (5, 10, 15…), so a declined offer comes back that many plans later. A whole number from 0 (`NUMBER_RULES`, the rule the other counts share), default 5; `0` turns the count off, and a plan that left a finding still makes an audit due. The project's file wins over the person's. It is no limit on a session, so `set` and `unset` of it work inside Claude Code. |
| `plans.maxPhases` | the kit's task store (`docs/design/tasks.md`): the most phases one plan may hold, a whole number 1-50, default 10. Like every number setting it has one rule (`NUMBER_RULES` in `schema.ts`) that the file check and `workflow set` share, and a file that holds another value is refused with the field named. The project's file wins over the person's, and the cap is read from the checkout's working copy, not the committed file. The task tools hold a session to it, so `workflow set` and `unset` of it refuse inside Claude Code (`PLAN_KEYS` in `schema.ts`): only the person raises it, and the cap refusal says to ask them. `propose` stays open, since a person reviews its pull request. A project that sets it needs `requires` `>=4.8` (`WORKFLOW_PLANS_SINCE`). |
| `plans.runMode`, `plans.mergeFiles`, `plans.appendOnly` | the plan tools and herdr's plan hand-outs, and the skills that ask for the mode: see the two paragraphs above, and `docs/design/herdr.md` § Handing out plans. All three are in `PLAN_KEYS` and refuse `set`/`unset` inside Claude Code. |
| `fixesAfterReview.*` | `readCover` (`src/workflow/review-cover.ts`, § The review record): the limits a change after a review may reach and still be covered. Resolved, shown by `workflow show` with their source (and as one `in force` line), and written by `workflow set`; `merge-check.ts` judges with them. |

**The merge is the session's own step.** It merges its pull request itself, with `gh pr merge`,
only when **all** of these hold: `allowMerge` is on; the merge names **this project's own repository**; every required check
`gh pr checks --required` reports is green (a `skipping` check counts as passed, which is
GitHub's own rule for a merge); the pull request is **not stacked on another open one**
(the paragraph "A stacked pull request waits", below); and — with `reviewBeforePush` on — the head is covered by a
review (D17, § The review record). **The judgment is one home**, `src/workflow/merge-check.ts`:
`checkPullRequest` reads those facts and decides, `checkBranch` does the same for a local
branch against a base (the review gate only), and
`cc-smart-dev-kit workflow merge-check [<pr>… | <pr> --asked | --branch <b> --base <base>]` prints each verdict
(`allowed`, or the reason it is not; exit 0 when every one is allowed, 1 when any is not).
No hook runs it any more: it is a command the session runs, and the skill says to. The
`merge-guard` hook that called it before every `gh pr merge` is retired (§ Retired in 6.0.0 in
`docs/design/hooks.md`). Opening a pull request follows `openPr` the same way, as an
instruction.

**A stacked pull request waits (`stackedVerdict` in `merge-check.ts`).** Plan B's pull request
may be stacked on plan A's open one: B's branch started from A's, so B's commits include A's. B's
own review and checks pass, and merging B would put A's unreviewed or refused commits into the
base. The commit skill opens B against A's branch (`gh pr create --base <A's branch>`), so the
base rule refuses B until A merges; the stacked check holds whatever base B names.

**The rule, in the code's words:**

- **Each pull request's own commits.** For this pull request and every other open one, the check
  reads the commits its head has and its base lacks, once:
  `gh api 'repos/{owner}/{repo}/compare/<base>...<head>?per_page=100&page=<n>' --jq
  '.total_commits, .commits[].sha'` (`commitsOf`; [REST: Compare two
  commits](https://docs.github.com/en/rest/commits/commits#compare-two-commits) is "equivalent to
  running the git log BASE..HEAD command"). It pages until a page holds fewer than 100 commits,
  and then the count must equal `total_commits` (a total counted too low cannot stop it early).
  The docs
  limit an unpaged answer to 250 commits and a page to 100 (`per_page`'s maximum), so the check
  always pages.
- **Stacked:** this pull request's set and another open one's share a commit. Commits, not a
  merge base: after both branches merge a newer base (a criss-cross), the one merge base git
  names is the base's new commit, which hides the shared ones (GitHub does not document which of
  several it picks); a set cannot hide them.
- **Direction, from the open list** (`gh pr list --state open --json
  number,headRefOid,headRefName,baseRefName,isCrossRepository`). An open pull request whose base is
  this one's head branch is stacked on this one, so it never holds this one up (`stackedOnView`).
  That holds only when neither head is a fork's (`isCrossRepository`: a fork's head branch is
  not this repository's branch of that name), and only when the list has this pull request.
- **The refusals.** The upper one, opened against the lower branch, is refused by the base rule,
  with its own words. Two pull requests into the same base that share commits cannot say which
  is lower, so each is refused with `pull request #<n> shares commits with open pull request #<m>
  that <base> does not hold yet: merge the lower one first (open the upper one against the lower
  one's branch), then check again` (the lowest number when several; a shared commit found wins
  over a read that failed). When either of the two is a fork's (`isCrossRepository`), that
  advice cannot be followed (a base must be a branch of the base repository), so the words are
  `... that <base> does not hold yet, and one of them is from a fork, so neither can be opened
  against the other: merge the lower one by hand, then check again`.
- **Clear:** two open pull requests at the same head (one commit has one review and one set of
  checks), a pull request with no commits of its own, and commits its base already holds.

It runs after the base rule and before the required checks: a stack is refused whatever the
checks say, and `--asked` never sets it aside, because that sets aside the `allowMerge` switch
alone. **When in doubt it refuses**: a gh that fails, an answer that is not a total and commit ids
(gh prints the JSON body of an HTTP error on stdout; it is never read or shown, the reason says
"GitHub could not compare <base> and <head>"), an open entry of another shape, an open list that
fills its `--limit 500` (`OPEN_PULL_REQUESTS_LIMIT`; gh's default is 30), a pull request that holds
more than `STACK_COMMITS_LIMIT` (1000) commits its base lacks, a total that changes between pages,
and pages that end before the total all refuse, never read as "not stacked". A read the caller's
deadline cut short (the portal's page has one) is `late`, as every other read of the check is, not
a refusal. A branch name in the compare path is encoded (`encodeURIComponent`, so `release/1` is
`release%2F1`) and the `...` between the names stays.

**One read per run**: `newStackCache` is what the portal's project page (`readBranches`) and a
`merge-check` line of several pull requests pass on, so the open list is read once for all rows
and each pull request's commits once. Its keys carry the folder, repository, base and head they
answer for, so one cache can never mix two projects. Nothing is compared when no other pull
request is open, or when every other one is skipped.

**Its costs:**

- Two pull requests into one base that share an unmerged commit refuse each other until one
  merges, or the upper one is opened against the lower one's branch. That includes a lower one
  with the upper one opened against the default branch, and siblings cut from the same unmerged
  commit. It errs on the safe side.
- One open pull request whose commits cannot be read (a base branch deleted, no history in
  common with its base, which GitHub answers with a 404) refuses every other pull request of the
  repository with "cannot prove", naming it.
- A pull request with more than 1000 commits its base lacks is refused, never judged on part of
  them; each 100 commits cost one gh call per run.
- Commits are matched by id: a lower branch rewritten by a rebase has new ids, so the upper one
  no longer shares them, and an upper one opened against the default branch is freed while the
  lower one is open. A force-push needs the person's yes (the commit skill), but GitHub's "Update
  branch" with rebase rewrites the ids with no force-push: never use it on a lower pull request
  while an upper one is open. A patch compare (`git cherry` on `refs/pull/<n>/head`) would see
  through a rewrite; it costs a fetch per pull request and is not built.
- A refused pair with a fork in it cannot be fixed by opening one against the other's branch: the
  lower one is merged by hand.
- A lower pull request closed without merging is no longer open, so it is not read here: the
  commit skill rebuilds the upper one on a new branch (`plugin/skills/commit/SKILL.md`).

**`--asked`: the person's yes sets aside the `allowMerge` switch and nothing else.** A person may
say yes to a merge while `allowMerge` is off in the project (an away session is told to keep going
through "review, merge and go next"). Judged plainly, `merge-check` refuses at once with "allowMerge
is off" and has read nothing else, so it cannot show that the switch is the only thing left.
`merge-check <pr> --asked` runs every other test: `autoMergeRefusal` is split into `autoMergeOff`
(the switch) and `baseRefusal` (the base rules, one home in `src/workflow/auto-merge.ts`), and with
`asked` the check calls `baseRefusal` alone, then reads the required checks and the review under
D17 (`fixesAfterReview`) as always, and the stacked check above. Exit 0 only when all of those pass, and the verdict line says
the merge rests on the person's yes, not on `allowMerge`. With `allowMerge` on, `--asked` changes
nothing and claims no yes. It is for pull requests only: a local branch check has no `allowMerge`
test, so `--branch` with `--asked` is a usage error (exit 2), not a silent no-op. **It names one
merge**: `--asked` with more than one pull request (`merge-check 12 13 --asked`) is a usage error
(exit 2) too, so one yes never covers a number it did not name. The flag is the
session's own word that the person gave that yes; no code can prove it, so the skill says when it
may be used and that the person's words are quoted in the decision record (`commit` § merge rule,
`user-unavailable` § 4). The portal never passes it.

**The settings that cannot work together are named where they are shown** (D16): one pure
function, `workflowClashes` in `src/workflow/clashes.ts`, called by `workflow show`,
`workflow set` (after the write), `project init` (in its plan, before anything is written)
and the portal's Settings page (a `!` line under the row). The pairs: `openPr` on with
`allowPush` off (a session does not push, so the pull request waits for the person),
and `allowMerge` on with `openPr: draft` (a draft is never merged). A project with no
`worktrees.base` is no clash: it may merge into the default branch. Each line says the fix.

**The review gate is read as committed on the pull request's base**, never from a checkout's
working copy. Every value the judgment uses — `allowMerge`, `reviewBeforePush`,
`reviewAgents`, `fixesAfterReview.*` (the limits a fix after a review may reach and still count,
D17, § The review record — read and shown with the gate, and `merge-check.ts` judges with them),
`worktrees.base` and `worktrees.bases` — comes from the built-in default, the person's
`workflow.json`, and `.claude/cc-smart-dev-kit.json` as `git` holds it at `origin/<base>`
(`resolveGate` in `src/workflow/resolve.ts`, over `readCommittedConfig` in
`src/project/resolve.ts`: `rev-parse` and `cat-file`, no fetch). A session edits its own
worktree's file in a second; it cannot change what a branch it has not pushed to says, and a
push to the base is what the review stands in front of. Two reads, one function:
before any `gh` call, the base this checkout names (`worktrees.base`), so `allowMerge` off is still
reported without `gh`; then, once `gh pr view` names the pull request's base, that base's file,
which judges the merge (`autoMergeRefusal` gets its `worktrees`). No `origin/<base>` (a new
repository, a fork, a branch never fetched), no file there, or a file this plugin cannot use
(broken, or a `requires` it does not meet) is not allowed, naming which. Because nothing is fetched, a
policy change counts once it is committed, pushed and fetched. `cc-smart-dev-kit workflow
show` prints the gate's own lines (`gate allowMerge = …`) from the same read, so it never
disagrees with `merge-check`, even while the checkout's file says something else; `workflow
set|unset` of a gate key (`REVIEW_GATE_KEYS` in `schema.ts`) works inside Claude Code since
6.0.0, and the "allowMerge is off" answer says to commit the change to the base and push it.

**A project's policy changes through a pull request** (D57, `src/workflow/propose.ts`).
Because the gate is read from the base's committed file, a change that counts must be merged,
and the plugin never writes the project's main checkout. `cc-smart-dev-kit workflow propose
<setting> <value>` (and the portal's Workflow card, through the same command in a child):

1. finds the project (`--folder`, else the current folder) and its `worktrees.base`;
2. fetches `origin/<base>` and reads **the value the base commits** (`resolveWorkflow` over the
   file at `origin/<base>`, not this checkout's working copy: an uncommitted edit here is not a
   policy) — one the base already holds, or an `--unset` of one it does not set, ends with one
   line and no branch. It checks `gh` too (`ghLoginState`: installed, and `gh repo view` answers
   for this repository), so no branch is made for a pull request that could not open;
3. cuts a branch and a worktree from `origin/<base>` in Claude Code's own layout: the folder
   `.claude/worktrees/workflow-<setting>-<YYYYMMDD>` on the branch `worktree-<folder name>`,
   so the auto-clean removes it after the merge (the same day's second change takes `-2`); it
   refuses when the base's own commit has no project file — a change counts only once merged;
4. checks that the new worktree holds its **own** `.claude/cc-smart-dev-kit.json` before writing
   — the guard that keeps the writer's fallback (`loadProjectConfig` reads the main checkout's
   file when a worktree has none) from ever writing the person's checkout — then writes the one
   value with `writeProjectSetting`, the writer `set --project` uses, and refuses unless the
   worktree's own `git status` shows the change;
5. commits (the person's identity, `workflow: <setting> <from> → <to>`, where `from` is the
   project's own value or `(unset)`: the person's defaults are never published), pushes, and
   opens the pull request with `gh pr create` into the base, with a body saying it counts once
   merged. `--json` prints `{ url, branch, worktree, setting, from, to }`.

A setting the project's file cannot hold — the status-line and update-hold switches, which are
the person's, per machine — is refused before the fetch, with the command that does change it.

A step that fails after the branch exists takes the worktree, the branch, and the pushed
branch back, and the line says what is left if any of that fails. Two exceptions, both to
avoid destroying what may be another run's: a `gh pr create` that does not answer in time
leaves the pushed branch and the pull request it may have made, and a name another proposal
took between the check and the add is skipped for the next free one rather than reused. The
command pushes a branch and opens a pull request in a child no hook sees. Until 5.6.x the shell
judge asked the person first when `allowPush` was off or `openPr` short of `ready`; that judge is
gone (§ Retired in 6.0.0 in `docs/design/hooks.md`). Every key may be proposed, inside Claude Code
or outside it: the pull request's review is the gate.

## The review record

The record (`src/workflow/reviews.ts`) is what "the review is done" means to a hook.
One small JSON file per repository, `<stateDir>/reviews/<key>.json` (mode 0600, written
atomically, the newest 50 commits kept), where the key is a hash of the main checkout — the same
key the after-merge note makes, so every worktree of a repository shares one record. Each entry
is `sha → { at, by, branches? }`: when it was first recorded, every writer that recorded it (an
agent type, or `workflow review-done` for the person by hand), and the branches the reviewer was
on (since 1.0.0). An entry without `branches` — a 0.6.0 record, a review on a detached HEAD, one
written by hand — still reads and counts for its exact commit only. An entry an older plugin
wrote (`sha → time`) names no writer and counts for nothing: that commit has no review.

**A review counts for its branch and the fixes after it (D17).** A review of commit R covers a
later head H when R's record names H's branch and the change made since R, **the base's own
changes taken out**, stays within the limits the base commits (`workflow.fixesAfterReview`,
default 200 lines, 10 files, 20%): covered while its lines are at most `lines` or `percent`% of
the reviewed change's lines, whichever is more, **and** its files at most `files` or `percent`%
of the reviewed files, whichever is more. `0`/`0`/`0` means the exact reviewed commit only. A
review of H itself covers H on any branch, as before. The one home is
`src/workflow/review-cover.ts` (`readCover`, and the pure `coverRefusal`):

- `B = git merge-base H origin/<base>`, then `T = git merge-tree --write-tree B R` — the reviewed
  change replayed on the base H's branch is on. merge-tree writes the objects it makes, so it runs
  with a **temporary object folder** (`GIT_OBJECT_DIRECTORY`, the repository's own objects read
  through `GIT_ALTERNATE_OBJECT_DIRECTORIES`), removed after: nothing is written into the
  repository. A conflicted replay (exit 1) still prints a valid tree, with the conflict markers in
  its files, so a conflict resolved by hand counts as change.
- The change after the review is `git diff --numstat -z -M T H` (no textconv, no external diff);
  the reviewed size is the same count over `merge-base(R, origin/<base>)..R`. Lines are added plus
  deleted; files are paths.
- So the base merged into the branch, or a rebase that only moved it, counts for nothing; a fix
  commit, a rebase that edits, a hand-resolved conflict and a new file count. A revert of the
  reviewed change counts its whole size. A review on another branch never covers, so a stacked
  pull request is not covered by the review of the branch below it.
- A review whose change is already all in the base (`git diff --quiet B T`: its branch was
  squash-merged and the name used again) is no candidate. Of several candidates, the covered one
  with the smallest change is named; when none is covered, the reason is about the smallest.
- Files the base marks `linguist-generated` (`git check-attr --source=origin/<base>`: the base's
  attributes, so a pull request's own `.gitattributes` hides nothing; this repo marks
  `plugin/dist/**`) are listed, not counted. A binary file in the change is never covered.
- Anything it cannot read is "not covered", with the reason: the head or the reviewed commit not in
  this checkout ("fetch it"), no `origin/<base>`, the caller's time running out, or git older than
  2.40 (`check-attr --source` came in 2.40; `doctor` warns with one `!` line, and such a machine
  matches the exact head only). It never fetches.

The limits come from this repo's own fix rounds: 10% of the reviewed change is covered, 105% and
160% are not covered. A limit is a trade: up to 200 lines written after the review merge unread, which is the
point of not paying a second review for a small fix. **The merge judgment uses this rule**
(D17b): `checkPullRequest` in `src/workflow/merge-check.ts` reads the cover for the pull request's
head on its head branch, and refuses with the counts and the limit when the fixes are over it (the session then says so in the pull request); a
record of the exact head still covers at once, on any branch, with no git run.
`cc-smart-dev-kit workflow merge-check --branch <branch> --base <base>` prints the same verdict
for a local merge, and `workflow show` prints the limits in force on one `gate fixesAfterReview in force:` line.

**Every write holds the record's own lock** (`withLock` on the
`reviews/` folder, a 3 s wait): two reviewers that finish at once both land. It is not the
state folder's shared lock, whose 10 s wait is as long as the hook may run.

A stop records a review only for a run that was a review from start to end (`isReviewRun`).
The agent's brief — the first user entry of its transcript — holds the line `Mode: review`
(trailing spaces and tabs allowed), and so does every prompt it was given after the brief.
A workflow agent, such as a `review-split` track, gets its brief through Claude Code's workflow
harness, which writes the computed task after an exact preamble with two spaces before every
line (on 2.1.322 and 2.1.325 a relay of the user's request comes first, indented the same way,
and the computed task is the next entry). So the marker is never at column zero in the raw
entry. The reader (`harnessText` in `src/hooks/transcript.ts`) matches the preamble whole and
reads the brief as the computed task with the indent removed, with the relay in front of it
when there is one. It does this only when every line carries the indent: a line at column zero
makes the frame forged, and it reads as no brief. It never widens the marker line to allow
leading spaces, so an indented `Mode: review` in a later message still does not count. The
prompts after the brief are: a
resume, a message from the session that started it, a task notification, Stop hook feedback,
anything typed. Claude Code most often writes a message from the session that started the
agent, and a task notification, as an attachment alone (`type: "attachment"`,
`attachment.type: "queued_command"`, with a `prompt` and an `origin`), not as a user entry: an
attachment of that type, or any attachment with an `origin` or a string `prompt`, is a prompt
too. Tool results are no prompt, nor are the meta entries Claude Code writes itself for a skill
it loads or a system reminder: an allowlist of their text's start (`HARMLESS_META_PREFIXES` in
`src/hooks/transcript.ts`), where a reminder must also end at its closing tag. A built-in skill
the agent loads itself (`workflow-authoring`, say) starts with none of those words, so it is
proved by its owner instead: the entry is `isMeta`, has no `origin`, holds text only, and its
`sourceToolUseID` is the id of a `Skill` call the agent made earlier in the same transcript
(`isOwnSkillText`). Nor is the
notice that a task the agent itself started in the background has ended (`isOwnTaskNotice`):
a reviewer that runs its tests that way, or whose own Monitor's stream ended, gets one for
each, in either form, and it gives the agent no task. It counts only when all of these hold: Claude
Code's own origin is on the entry (`kind: "task-notification"` and `producer: "session-task"`);
the text is exactly the five tags of a command's end (`Background command "…"` in the summary),
or of a Monitor's end (`Monitor "…" stream ended`, at most one `<event>…</event>`, then Claude
Code's own PushNotification line); and the `<tool-use-id>` names a `Bash` call (a command) or a
`Monitor` or `Bash` call (a Monitor) that the agent itself made earlier in the same transcript,
which the reader notes as it reads forward. A child agent's completion (it carries a result),
any text around the tags, a notice for a call the transcript never made and a notice with
another origin or producer stay prompts. So do the other Monitor notices Claude Code writes —
a Monitor that expired (a `Monitor event` notice with no `<tool-use-id>`), a failed script, an
end with no output — because no real shape of them was proved harmless: a reviewer whose own
Monitor ends that way records nothing, the safe side. A transcript line may start with NUL bytes before its
JSON; the reader drops them from every line, and a line of NULs alone is skipped. Any other entry, an unknown
meta entry included, is a prompt. The reader (`runPrompts`) reads the whole
transcript forward, up to 16 MB, so a prompt far from both ends still counts. A consult, a
review agent resumed for a question, a review a Stop hook sent back to work, a review that
compacted (the summary counts as a prompt: a known limit, on the safe side), and a missing,
unreadable or larger transcript record nothing: the safe side, where the merge judgment finds no review.
A plan's second read records nothing by design: its brief carries `Mode: plan-review`, which the
whole-line match does not take, because a record of a plan read would name the lead's head
commit as reviewed code and cover later heads with it. And a review starts no agents: a child's
completion notice carries a result and is a prompt without the marker, so a review that
started one would record nothing (`plugin/agents/senior-engineer.md`).
The same module reads the brief alone, from the file's head, for the builder hand-back hook.

**Who writes it: the review agent's own start and end** (`src/hooks/review-record.ts`,
`SubagentStart` and `SubagentStop`). A record a session writes for itself is only the
session's word — any caller could name a commit nobody read — so the one writer is the hook
Claude Code tells when a subagent starts and is done. At the start, when the agent's
`agent_type` is one the workflow's `reviewAgents` lists, it notes the commit the input's `cwd`
is on and its branch (`git symbolic-ref --quiet --short HEAD`; none on a detached HEAD), keyed
by `agent_id` (`<key>.starts.json`; Claude Code's `agent-` prefix and the bare id are one agent;
the first start stays when a resumed agent starts again; a day-old start is dropped). At the end
it takes that start back and records **the start commit, on its branch** — never the commit the
folder is on at the stop: a fix committed while the reviewer read is a fix it never saw, and it
counts as change after the review like every later fix (D17, above). A stop with no start seen
records nothing (one stderr line says to run the review again). The names are compared by
`recordsReview` in `reviews.ts`, the one home of that question: a `plugin:name` exactly, a bare
name only for an agent with no plugin prefix — Claude Code reports a plugin agent as
`plugin:name` (code.claude.com/docs/en/hooks § SubagentStart), so another plugin's
`reviewer`, or a project agent of that name, never counts for `cc-smart-dev-kit:senior-engineer`. The list the hook reads is the checkout's own, but the record keeps the agent that wrote it,
and the merge judgment checks that agent against the list committed on the base (`hasReview`):
a list a session adds to in its own worktree records nothing it trusts. **SubagentStop,
not PostToolUse on the Agent tool**: on Claude Code 2.1.301 every Agent call runs in the
background — the tool call returns at launch, and the agent's end comes later — so a
PostToolUse hook would record the commit before the reviewer had read a line. A plugin
SubagentStop is allowed by `.claude/rules/hooks.md` because this hook touches no worktree;
its SubagentStart cannot block a launch and adds no context. A run whose `cwd` is inside a
subagent's own worktree records nothing: its branch is a fresh one from the base, never the
commit a reviewer read. Success prints nothing at all; a record that cannot be written is one
stderr line, exit 0. `cc-smart-dev-kit workflow review-done [--sha <commit>]` stays for the
person's own terminal and **refuses inside Claude Code** (`CLAUDECODE`): it resolves the
commit with `git rev-parse` and records it `by` the person, which the judgment trusts whatever
the list says; `cc-smart-dev-kit workflow show` prints whether the commit here has a record
the gate's own list trusts.

**What these checks are, and are not.** The review gate, the record and the `CLAUDECODE`
refusals stop mistakes — a session that switches a setting off in its own checkout, a stray
`review-done`, another plugin's agent that happens to be called `reviewer`. They are not a lock
against a process set on getting past them: anything that runs as the person can write the
person's own files (the record, `workflow.json`), drop `CLAUDECODE` (`env -u CLAUDECODE`), or
push to a branch the person may push to. What holds against that is the repository's own
branch protection and the person's own deny rules.

**The usage-warning setting** is read by the status line through `src/workflow/alerts.ts`.
`alertsAt(paths, checkout)` resolves `alerts.usagePercent` once per run: the project's over
the person's over the built-in default. An unreadable project or personal settings file
drops only that file, keeps every value it can read, and returns one line for stderr.
A folder outside a project (no checkout) is not a problem. Retired `alerts.events` and
`alerts.sound` values load but are discarded by the schema, not used by the status line.

**The status line reads one folder, and locates its checkout once.** `runStatusline` reads stdin
first. The session's folder is `cwd` in that JSON, else the process's own folder (run by hand in
a terminal). It locates that folder's checkout once (`locateCheckout`), then hands the answer to
`alertsAt` and takes the task rows' project key from it (`projectKeyOf`), so the warning share
and the task rows can never describe two different folders. A session in a worktree whose
project file sets `workflow.alerts` gets the worktree's value, even when Claude Code started
the command from the main checkout. A folder that cannot be read at all (gone, git too old, git
did not answer) leaves the person's own settings for the alerts and no task rows. The same lookup is one
`git rev-parse` in a main checkout, plus one `git worktree list` in a linked worktree; it used to
run twice. `subagent-statusline` reads no folder, no alerts and no tasks, so it has no lookup.

## The claims signal

`cc-smart-dev-kit workflow claims [--base <ref>] [--json]` (`src/workflow/claims.ts`, dispatched
from `commands.ts`) hands a reviewer the project's "one home" claims, and the lines a diff adds
that write a second home of what they name. It is a signal: it reads, prints and exits 0, whatever
it finds. A claim with no guard is a finding (`code-structure` § 11), and this is the cheap way to
see the claims and the second definitions that make them false.

- **Two or three git calls.** The claims are the tracked, non-binary lines that hold a phrase of
  `CLAIM_PHRASES` as whole words, in any case (`CLAIM_PHRASE`: "the one placeholder" is no claim).
  The diff is `git diff --unified=0 <base>...HEAD`. Both skip lockfiles, build output
  (`BUILD_OUTPUT_FOLDERS`: `dist/`, `node_modules/`), minified files, source maps, a changelog and
  the kit's own `.claude/plans/` and `.claude/research/`, which describe what was true then
  (`SKIPPED_PATHS`; the plan folder is named there, since `plansFolders` answers with real absolute
  paths a pathspec cannot take), and the files the project marks `linguist-generated`, the mark
  the review count reads too (`GENERATED_PATHS`, git's attribute pathspec). The diff also skips
  test files (`TEST_PATHS`): a test that defines a claimed name builds a fixture, not a second
  home. Only when the diff defines a claimed name does a third call run: one `git grep` at HEAD
  for those names as whole words. No git call is made per file, so the cost grows with the
  repository and the diff only.
- **Named symbols.** The backticked words of a claim line that read as identifiers (three characters
  or more, so a path or a dotted name is never one) are the names the claim gives to one home. A
  claim that names nothing is still listed: the reviewer reads it.
- **Hits.** An added line defines a claimed name when it matches a form of `DEFINITION_FORMS`
  (`function X`, `const|let|var X`, `class X`, `type X`, `interface X`, `def X`, `fn X`, `func X`,
  `X = (`) in a file other than the claim's own (`claimedDefinitions`). The forms name no language.
  A re-export (`export { X } from`) and a type-only import or re-export (`import type X`,
  `export { type X } from`) match none, since they define nothing. Nothing in a prose file
  (`.md`, `.txt` and the like) or on a comment line defines a name, and neither does a local
  binding: an indented `const`, `let` or `var` (`LOCAL_BINDING`) or a loop's own variable
  (`LOOP_HEAD`). Such a definition is a **hit** only when another file defines the same name at
  HEAD (`secondHomes`): a second home beside the old one, or one the diff writes in two files. An
  edit of the home's own line, a home moved to a new file and the first definition of a new home
  written with its claim are not. HEAD, not the base, is read because it holds both the homes the
  base had that still stand and every file the diff defines. A name that two files claim reports
  a claim in a file other than the hit's. One scan of each added line finds every name it
  defines, so the work does not grow with the number of claims.
- **Paths git quotes.** A diff header path with a double quote, a backslash or a control
  character comes C-quoted even with `core.quotePath=false`; it is read back, octal bytes as UTF-8.
- **The base.** `--base <ref>` as given (a ref that is no commit is one error line and exit 1).
  Without it, the merge base with `origin/<default branch>`: the project's `worktrees.base`, else the
  remote's default (`baseBranch` in `src/worktrees/command.ts`, the one lookup the worktree commands
  use). Where the default branch is unknown (no `worktrees.base`, no `origin/HEAD`), or origin has no
  such branch in this clone, the claims are still listed and one line says why no diff was read.
- **Output.** `Claims (N):` with `file:line — the phrase — names: a, b`, cut at the kit's usual cap
  (`cappedHookList`) with `+K more: <the --json command>`, then `Re-defined in this diff (M):` with
  `file:line defines X, which <claim file:line> calls its one home`, never cut: the reviewers read
  this output and are told not to run the command. `--json` prints
  `{ claims: [{ file, line, phrase, names }], hits: [{ file, line, name, claim: { file, line } }], diffWhy }`
  for a workflow script, and nothing else; `diffWhy` is why no diff was read, or null. The reason
  for an unknown default branch ends with `UNKNOWN_BASE.fix` (`src/herdr/plans.ts`), the fix the
  plan hand-out gives.

Exit codes: 0 for every answer, including no git and no diff; 2 for a wrong option; 1 for a base
that is no commit and for a `git grep` that fails, the claims one or the one at HEAD (not "no
match": git exits 1 for that, and it is an empty answer).

## The slop record

`cc-smart-dev-kit workflow slop record | status | audited` (`src/workflow/slop.ts`) is the running
count the lead keeps across plans, so a slop audit is offered on a rhythm and not only after a
review finds something (`build` § 6).

**The file.** One small JSON file per repository, `<stateDir>/slop/<key>.json` (mode 0600, written
atomically), with the same key as the review record (`repoKey`): every worktree of a repository
shares one count. It holds `{ auditedAt, unaudited, plans: [{ plan, at, bypassed, drifted, areas }] }`.
The known fields are typed strictly; a field a newer version adds is read past (`z.object`), so an
older session keeps the count. Every write holds the record's own lock (`underRecordLock`, shared
with the review record), so two leads that close plans at once both land; a busy lock fails with
the lock's own fix line. A file that is not a record is named, with "delete it to start the count
again": the count is all it holds, and a quiet reset would hide that it was lost. The newest 50
plans stay in `plans`; `unaudited` counts every plan no audit has cleared, past that cap, so the
cadence works for any `everyPlans`. A plan dropped by the cap is cleared only by an audit of
everything. The count is machine-local, like the review record: a team on several machines gets
an audit offer on each.

**record.** `slop record --plan <slug> --bypassed <n> --drifted <n>` takes the plan from the task
store (`planByRef`: the slug, `#n` or an id) and its **areas** from the plan's own file list
(`planFiles`), each path cut to its first two segments, so the lead passes no paths. A path every
plan touches (`plans.mergeFiles`, as the working copy resolves it) and build output
(`BUILD_OUTPUT_FOLDERS`) are no area: an audit there reads what no plan wrote by hand. A plan with
no file list has no areas and is still counted. A second record of the same plan replaces the first
and leaves `unaudited` as it was, so the lead may run it twice. Each count is a whole number up to
`SLOP_COUNT_MAX` (1000); a larger one is refused before anything is written. A plan that is not in
this project's store is refused with the fix (the slug `task_list` shows); a store that cannot be
read is the command's own error line (`readWorkStore`). It then prints the status.

**status.** `slop status [--json]` prints how many plans no audit has cleared yet, their totals and
the areas. An audit is **due** when either holds: that count reaches a multiple of
`slopAudit.everyPlans` (5, 10, 15… by default; `0` turns that off), so a declined offer comes back
`everyPlans` plans later instead of at every close; or the newest plan still in the record left a
bypassed home or a drifted copy (the trigger the lead had before the count, kept). The line says
which; when not due it names the next multiple. The lines say "not audited yet", never "since the
last audit", so after a partial audit `Last audit:` and the plans still counted do not contradict.
A plan that named no area gets a `No area:` line: only an audit with no `--area` clears it.
`--json`: `{ since, unaudited, plans, bypassed, drifted, areas, due, why }`.

**audited.** `slop audited [--area <path>]...` records an audit. With no area, every plan leaves
and `unaudited` is 0. With areas, each `--area` is a repository path as typed (`normalizeRepoPath`:
`./` dropped, never cut to two segments; the root, an absolute path or `..` is a usage error), and
a plan area equal to it or under it is cleared (`--area src` clears `src/cli`): a plan whose areas
are all cleared leaves the count, one with areas left stays with them, and a plan that named no
area stays until an audit of everything. It prints how many plans it cleared, and a `!` line with
the fix when an `--area` audit cleared none.

The lead runs the three (`build` § 6, `audit` § The slop preset); nothing runs an audit by itself, and
away from the person it records a decision and starts no paid audit run unasked.

## Fewer pull requests

The settings above decide what the kit may open and merge by itself. Since 5.4.0 the skills also
keep the number of pull requests, and of CI runs, small. The wording is in the `plan-task`,
`build`, `commit`, `review` and `pull-request` skills; this is why.

**Why.** CI runs on `pull_request` and on `push` to the default branch only
(`.github/workflows/ci.yml`, `windows.yml`; a newer push cancels the run before it). A push to a
branch with no pull request costs nothing here, but another project's triggers may differ. Each pull request costs one run for every push to it,
and one more run on the default branch when it merges. The waste came from three habits: a pull
request made only for bookkeeping (a plan's archive, a workflow file), one pull request per small
fix, and fix rounds pushed one at a time after the pull request opened.

**The rules.**

- **The plan archive rides in the plan's own pull request.** Before the plan's review, the plan file
  (and its research) moves to `archive/` in a commit on the plan branch. The review covers that
  commit, which a commit after the review would not in a `fixesAfterReview` setting of 0 lines, 0
  files and 0 percent. The pull request opens after the review and the full check. In that turn the
  plan task closes with its evidence, as it did before: a plan child stops before its merge. A
  reserved plan's files stay held until its pull request merges or closes; an unreserved plan's
  files are free once its task closes. A plan whose pull request is abandoned has its file moved
  back in the next one, and so does a plan the review leaves open.
- **Small fixes: one pull request per session, at one ship point.** The small fixes a session
  makes outside a plan collect on the session's own branch, and its follow-up child's work
  (`docs/design/herdr.md` § Follow-up children) ships with them. When that branch is a plan branch,
  or already carries a reviewed change set, the small fixes get a new branch from the default
  branch. The ship point is the end of the turn that finishes the person's request, or the moment
  the person says to ship now. One pull request opens there, and the lead sends the follow-up
  child `ship`. Until then the child commits each finding and never pushes.
- **After a pull request opens: batch, check, push once.** A push before the pull request opens
  costs no CI only where CI runs on pull requests and the default branch alone; read the
  project's triggers before you treat it as free. Once it is open, a round of fixes (review findings, a CI failure, a late fix
  from a follow-up) is collected, the full check runs locally, and one push follows. Never push
  one fix at a time, and never use CI to find what the local check finds.

**What stays as it was.** One pull request per plan, as before. A deploy run's small pull request
of task closes also stays: those closes must reach the base before the next deploy's
`task release` reads it (`docs/design/tasks.md` § The deploy run and the gates).

These are habits in skills, not a hook: nothing blocks a push or a pull request. A session that
ignores them still works, and only spends more CI.
