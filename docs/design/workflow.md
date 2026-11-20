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
`fixesAfterReview`, `plans`) merges field by field like the rest. The one schema is reused by
`src/project/config.ts` for the project's `workflow` object, so a field can never mean two
things in the two files. A broken personal file throws `WorkflowConfigError`, which names the
file and the field: the person must hear it. A field with a wrong kind can never be written
(`write.ts` validates the whole file before the write), and a file it may not change is left
alone rather than half-written. A `crew` group, from a file written before 2.0, is accepted and
ignored: it still loads, and nothing reads it.

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
two settings of one switch, not two copies. The resolver (`jobRouteFrom`, `src/workflow/resolve.ts`)
reads the project's value first (`project`), then the person's (`personal`), then off
(`default`), and `workflow show` prints which one answered. `workflow set switches.jobRoute`
writes the person's default; with `--project` it writes the project's `jobs.route`. The
`job-route` hook reads it through the same function (`resolveJobRoute`), with or without a
project file, so the hook and `show` can never disagree.

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

**`plans.mergeFiles` lives in the project's file alone and counts only as committed.** It is a list
of paths every plan touches and each merge settles (a version manifest, a changelog, a lockfile,
build output); the plans' overlap check (`docs/design/tasks.md` § Plans handed to children) leaves
them out. A session that could widen it would lift its own check, so the store and herdr never use
the working copy. `resolveMergeFiles` (`src/workflow/resolve.ts`) reads the copy on
`origin/<worktrees.base>` through the review gate's own committed read (`readCommittedConfig`),
and `planFilesCheck` (`src/tasks/files-check.ts`) calls it before any write lock. With no base, no
remote ref, no committed file or a bad entry, the list is empty or short and comes back with a
reason, so more paths count as overlaps, never fewer. `ResolvedWorkflow.plans.mergeFiles` is only
the project config passed in, so no caller reads it for a decision. It is in `PLAN_KEYS`, so
`workflow set` refuses it inside Claude Code and the person commits it themselves (`propose` stays
open); the person's file refuses it (`PROJECT_ONLY_KEYS`) and `set` needs `--project`. Entries are
`/`-separated and tidied (`./`, `\`); an absolute path, `..`, the root and the pattern
characters `*` and `?` are refused (`[` and `]` stay: no list reaches git as a pathspec, `docs/design/tasks.md`). A folder ends in `/`, and a bare name that is a folder in
the committed tree is left out of the list, with that in the reason. `workflow show` prints the
list as written in the working copy, and a second line with the list the plan tools read from the
base. A project that sets it needs `requires` `>=5.2` (`WORKFLOW_MERGE_FILES_SINCE`), per key: the
`plans` object alone still needs `>=4.8`.

**The auto-merge rule** (`auto-merge.ts`, `autoMergeAllowed`) is a pure function with its own
tests, because it decides whether a command may run without a person:

```
autoMergeAllowed(resolved, projectConfig, prBase, defaultBranch)
```

True only when `autoMerge` is on **and** the project names an integration base
(`worktrees.base`) **and** the pull request's base is exactly that base **and** that base is
not the repository's default branch (a merge there is a release, never a hook's decision)
**and** it is not a target of `worktrees.bases` (then another family of branches feeds it,
so it is not a plain integration base). The integration base may itself be in
`protectedBranches`: it is the one branch this may write to, and the git guard still asks
about a push of it by hand. Every other protected branch is never a target, because the
pull request's base must be the integration base — so those keep asking the person, which is
the whole point of protecting them. CI green and the review done are the caller's checks
(the merge guard hook), not this one's: this function answers about branches only.
`autoMergeRefusal` is the same rule in words — the reason the merge guard asks — and
`autoMergeAllowed` is `autoMergeRefusal(…) === null`, so the five conditions live in one
place (`auto-merge.ts`).

**Who follows a setting: a hook where a hook can, the instructions where only the session can.**

| Setting | Followed by |
|---|---|
| `autoCommit`, `clearWorktreeAfterMerge` | the skills (`commit`, `worktree`): `autoCommit` is off by default, `clearWorktreeAfterMerge` on (the session removes its own finished worktree, `docs/design/sessions.md` § Locks, owners and who may remove what); each reads `cc-smart-dev-kit workflow show` and follows it. Nothing else can: a commit and a folder are the session's own doing, and no hook sees them as one act. |
| `autoPush` | the **git guard hook** (`src/hooks/git-guard.ts`), PreToolUse on Bash and PowerShell: while it is off (the default) the guard asks before every `git push` (D15), reading the value as committed on the base (`resolveGate`). |
| `openPr` | the **merge guard hook** (`src/hooks/merge-guard.ts`): `off` asks before `gh pr create` and `gh pr ready`, `draft` asks for a pull request that does not open as a draft and for every `gh pr ready`, `ready` asks for neither (D16); read as committed on the base. |
| `autoMerge` | the **merge guard hook** (`src/hooks/merge-guard.ts`), PreToolUse on Bash and PowerShell — the one step a hook can stand in front of. `mergeMethod` and `deleteBranch` stay instructions: they say how a merge the guard allowed is made. |
| `reviewBeforePush` | both: the **review-record hook** writes the record when a review agent finishes (§ The review record), and the merge guard reads it. |
| `reviewAgents` | both: the **review-record hook** records only an agent listed there, and the **merge guard** trusts a record only when the list committed on the pull request's base names the agent that wrote it. A project that runs its own reviewer names it (the plugin's `cc-smart-dev-kit:senior-engineer` by default). |
| `alerts.events`, `alerts.sound` | Retired load-only keys: ignored, omitted by `workflow show`, and refused by `workflow set`. Existing values survive unrelated writes. |
| `alerts.usagePercent` | the status line (`src/cli/statusline.ts`), whose warning share it is. |
| `plans.maxPhases` | the kit's task store (`docs/design/tasks.md`): the most phases one plan may hold, a whole number 1-50, default 10. Like every number setting it has one rule (`NUMBER_RULES` in `schema.ts`) that the file check and `workflow set` share, and a file that holds another value is refused with the field named. The project's file wins over the person's, and the cap is read from the checkout's working copy, not the committed file. The task tools hold a session to it, so `workflow set` and `unset` of it refuse inside Claude Code (`PLAN_KEYS` in `schema.ts`): only the person raises it, and the cap refusal says to ask them. `propose` stays open, since a person reviews its pull request. A project that sets it needs `requires` `>=4.8` (`WORKFLOW_PLANS_SINCE`). |
| `plans.runMode`, `plans.mergeFiles` | the plan tools and herdr's plan hand-outs, and the skills that ask for the mode: see the two paragraphs above, and `docs/design/herdr.md` § Handing out plans. Both are in `PLAN_KEYS` and refuse `set`/`unset` inside Claude Code. |
| `fixesAfterReview.*` | `readCover` (`src/workflow/review-cover.ts`, § The review record): the limits a change after a review may reach and still be covered. Resolved, shown by `workflow show` with their source (and as one `in force` line), and written by `workflow set`; the merge guard judges with them, through `merge-check.ts`. |

**The merge guard** asks the person before a merge its rules do not allow, and lets one through
with no question only when **all** of these hold: `autoMerge` is on (`autoMergeOff` is the first
check, before any `gh` call, so a machine without `gh` hears the real reason); `autoMergeAllowed`
says yes for the pull request's base; the merge names **this project's own repository**
(`--repo`/`-R` is compared, owner/name case-insensitively, against the `origin` remote read with
git — the policy is about the repository the work is in, so another one always asks); every
required check `gh pr checks --required --json name,bucket` reports is green (a `skipping` check
counts as passed, which is GitHub's own rule for a merge); and — with `reviewBeforePush` on —
the head from `gh pr view` is covered by a review (D17, § The review record).

**The judgment is one home**, `src/workflow/merge-check.ts`: `checkPullRequest` reads those
facts and decides, `checkBranch` does the same for a local branch against a base (the review gate
only: a local merge has no pull request's checks or `autoMerge`), and
`cc-smart-dev-kit workflow merge-check [<pr>… | --branch <b> --base <base>]` prints each verdict
(`allowed`, or the reason it asks; exit 0 when every one is allowed, 1 when any asks) — the
guard's own words, without making a merge. The hook keeps the rules about the command line: what
is a merge, `--admin`, and another repository; it reads `ownHooks` from the integration base
before any gh call, so a project that runs its own merge guard answers alone.

**D31: the exact merge is answered `allow`.** Auto mode's built-in "Merge Without Review" rule
blocks every merge no person approved; a hook's `allow` skips the classifier for that call
(proved live, L1a.5). So `merge-guard` answers `allow`, with a short reason, only when the WHOLE
line is exactly `gh pr merge <n>` with flags gh 2.102.0 has (`exactMergeOf` in `after-merge.ts`:
one reading, one command, no wrapper or assignment before gh, no pipe, no writing redirection, no
alias, a number rather than a branch or URL) and the whole policy above passed. Any other
passing form — `timeout 60 gh pr merge 7`, `gh pr merge 5 && gh pr merge 6`, an alias, an
unknown flag, an armed `--auto` merge (it lands later, so a commit pushed after the check would
merge unread) — stays silent, so auto mode's own rule still applies to it; an unknown
`gh pr merge` flag asks.

**It also governs opening a pull request** (D16, `openPr`): it reads `gh pr create`, `gh pr
new` and `gh pr ready` — a `-R`, a `gh alias`, a `gh api` POST to the repository's pulls
endpoint, the GraphQL `createPullRequest` and `markPullRequestReadyForReview` — and the
committed `openPr` decides: `off` asks before any of them, `draft` lets a create that opens
as a draft through (`--draft`, `-d`, `-fd`, `--draft=true`) and asks for one that opens
ready and for every `gh pr ready`, `ready` asks for neither. `gh pr ready --undo` opens
nothing. The value is read with `resolveGate` like the merge's, from the base this checkout
names (`worktrees.base`); a policy it cannot read asks.

**An opening outside the base its head branch belongs to asks** (WA1): `gh pr create`'s
`--base` (`-B`) is compared with the base `worktrees.base` or the `worktrees.bases` prefix
mapping gives that branch (`baseForBranch` in `src/project/config.ts`, the longest prefix),
and with no `--base` the pull request opens into the repository's default branch — read with
`gh repo view`, then git's `origin/HEAD` — so that asks too when it is not the base. The
question names both branches, and it never denies: the person may mean it. A `gh pr ready`
and a `gh api` opening, which names its base in its own fields, are not part of this check.

**The settings that cannot work together are named where they are shown** (D16): one pure
function, `workflowClashes` in `src/workflow/clashes.ts`, called by `workflow show`,
`workflow set` (after the write), `project init` (in its plan, before anything is written)
and the portal's Settings page (a `!` line under the row). The pairs: `openPr` on with
`autoPush` off (the pull request waits for a push a person must approve every time),
`autoMerge` on with no `worktrees.base` (there is no branch it may merge into by itself),
and `autoMerge` on with `openPr: draft` (a draft is never merged). Each line says the fix.

**The review gate is read as committed on the pull request's base**, never from a checkout's
working copy. Every value the guard judges with — `autoMerge`, `reviewBeforePush`,
`reviewAgents`, `fixesAfterReview.*` (the limits a fix after a review may reach and still count,
D17, § The review record — read and shown with the gate, and the guard judges with them through
`merge-check.ts`), `worktrees.base` and `worktrees.bases`, and whether the committed `ownHooks`
hands the merge to the project's own guard — comes from the built-in default, the person's
`workflow.json`, and `.claude/cc-smart-dev-kit.json` as `git` holds it at `origin/<base>`
(`resolveGate` in `src/workflow/resolve.ts`, over `readCommittedConfig` in
`src/project/resolve.ts`: `rev-parse` and `cat-file`, no fetch). A session edits its own
worktree's file in a second; it cannot change what a branch it has not pushed to says, and a
push to the base is what the guards and the review stand in front of. Two reads, one function:
before any `gh` call, the base this checkout names (`worktrees.base`), so `autoMerge` off still
asks without `gh`; then, once `gh pr view` names the pull request's base, that base's file,
which judges the merge (`autoMergeRefusal` gets its `worktrees`). No `origin/<base>` (a new
repository, a fork, a branch never fetched), no file there, or a file this plugin cannot use
(broken, or a `requires` it does not meet) asks, naming which. Because nothing is fetched, a
policy change counts once it is committed, pushed and fetched. `cc-smart-dev-kit workflow
show` prints the gate's own lines (`gate autoMerge = …`) from the same read, so it never
disagrees with the guard, even while the checkout's file says something else; `workflow
set|unset` of a gate key (`REVIEW_GATE_KEYS` in `schema.ts`) refuses inside Claude Code, and
the guard's "autoMerge is off" question says to commit the change to the base and push it.

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
command pushes a branch and opens a pull request in children no hook sees, so **the shell judge
asks the person first** (RF1-4, `src/hooks/bash-judge.ts`) whenever the gate the git and merge
guards read has `autoPush` off or `openPr` short of `ready`: the question names the push, the
pull request and the switch that says no; a gate or a project it cannot read is a question with
its reason; in `claude -p`, where nobody answers, it is a denial. Inside Claude Code a gate key
refuses, as `set` does; outside it — a terminal, the portal — every key is allowed: the pull
request's review is the gate.

**Every merge of the line is judged**, in the order it runs them: `gh pr merge 5 && gh pr merge
6` reads both, and the first the policy does not allow asks, naming that pull request
(`mergeCalls`, in `after-merge.ts` — the one reader of a merge command line, on the one lexer
every guard uses, `src/shell/command.ts`). The forms it reads: `gh pr [<its own flags>] merge …`
(`gh pr -R owner/repo merge 5`, `-R` before the subcommand), `--auto` (an armed merge lands once
the checks pass, with nobody watching) while `--disable-auto` is no merge, and a `gh <word>`
that is no gh command — an alias, looked up once in `gh alias list` (a local file read) and
judged like its expansion, with a shell alias (`!…`) asking. The forms it never judges ask with
the reason: a `gh api` merge (the pull-request merge endpoint in any method spelling, or a
GraphQL query naming `mergePullRequest`/`enablePullRequestAutoMerge` — or one it cannot read at
all), an extension whose words name a merge, and a command whose earlier steps change the folder,
the branch or the repository the merge acts on (`cd`/`pushd`/`git -C`, `git switch`/`checkout`,
a `GH_REPO=`/`GH_HOST=` assignment, an `env` prefix): the guard does not follow those, it asks. A
quote, a here-doc or a comment is not a command, and the wrappers the git guard reads work the
same way (`timeout 60 gh pr merge 5`, `setsid gh pr merge 5`). A program the line works out when
it runs (`$(which gh) pr merge 5`, `$GH pr merge 5`) cannot be named, so a line whose words name
a merge asks rather than pass unseen.

Everything it reads is read-only (`gh pr view`, `gh repo view`, `gh pr checks`, `gh alias
list`), each call takes 10 s and the hook has 30 s (`hooks.json`), and only a command that
really asks for a merge reaches them. **It fails closed**: a `gh` that is missing, fails, or
answers something the guard cannot read is a question, never silence. In a project with no
`cc-smart-dev-kit.json` it stays silent like every plugin hook: there is no policy to judge with,
and a project that never opted in must not notice the plugin. A project that keeps its own
merge guard silences this one with `ownHooks`, like the other guards; the guard also reads
`ownHooks` from the committed file of the base. (The frame's own `ownHooks` step still reads
the checkout's file, for every plugin hook alike: `src/hooks/run.ts`.)

## The review record

The record (`src/workflow/reviews.ts`) is what "the review is done" means to a hook.
One small JSON file per repository, `<stateDir>/reviews/<key>.json` (mode 0600, written
atomically, the newest 50 commits kept), where the key is a hash of the main checkout — the same
key the after-merge note makes, so every worktree of a repository shares one record. Each entry
is `sha → { at, by, branches? }`: when it was first recorded, every writer that recorded it (an
agent type, or `workflow review-done` for the person by hand), and the branches the reviewer was
on (since 1.0.0). An entry without `branches` — a 0.6.0 record, a review on a detached HEAD, one
written by hand — still reads and counts for its exact commit only. An entry an older plugin
wrote (`sha → time`) names no writer and counts for nothing: that commit asks once.

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
160% ask. A limit is a trade: up to 200 lines written after the review merge unread, which is the
point of not paying a second review for a small fix. **The merge guard judges with this rule**
(D17b): `checkPullRequest` in `src/workflow/merge-check.ts` reads the cover for the pull request's
head on its head branch, and asks with the counts and the limit when the fixes are over it; a
record of the exact head still covers at once, on any branch, with no git run.
`cc-smart-dev-kit workflow merge-check --branch <branch> --base <base>` prints the same verdict
for a local merge, and `workflow show` prints the limits in force on one `gate fixesAfterReview in force:` line.

**Every write holds the record's own lock** (`withLock` on the
`reviews/` folder, a 3 s wait): two reviewers that finish at once both land. It is not the
state folder's shared lock, whose 10 s wait is as long as the hook may run.

A stop records a review only for a run that was a review from start to end (`isReviewRun`).
The agent's brief — the first user entry of its transcript — holds the line `Mode: review`
(trailing spaces and tabs allowed), and so does every prompt it was given after the brief: a
resume, a message from the session that started it, a task notification, Stop hook feedback,
anything typed. Claude Code most often writes a message from the session that started the
agent, and a task notification, as an attachment alone (`type: "attachment"`,
`attachment.type: "queued_command"`, with a `prompt` and an `origin`), not as a user entry: an
attachment of that type, or any attachment with an `origin` or a string `prompt`, is a prompt
too. Tool results are no prompt, nor are the meta entries Claude Code writes itself for a skill
it loads or a system reminder: an allowlist of their text's start (`HARMLESS_META_PREFIXES` in
`src/hooks/transcript.ts`), where a reminder must also end at its closing tag. Any other entry,
an unknown meta entry included, is a prompt. The reader (`runPrompts`) reads the whole
transcript forward, up to 16 MB, so a prompt far from both ends still counts. A consult, a
review agent resumed for a question, a review a Stop hook sent back to work, a review that
compacted (the summary counts as a prompt: a known limit, on the safe side), and a missing,
unreadable or larger transcript record nothing: the safe side, where the merge guard asks.
A plan's second read records nothing by design: its brief carries `Mode: plan-review`, which the
whole-line match does not take, because a record of a plan read would name the lead's head
commit as reviewed code and cover later heads with it. And a review starts no agents: a child's
completion notice is a `queued_command` attachment, a prompt without the marker, so a review that
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
`reviewer`, or a project agent of that name, never counts for `cc-smart-dev-kit:senior-engineer`. The
Agent guard keeps no review list since D11: every `opus`-tier launch below `max` runs with no
question, a review or not.
The list the hook reads is the checkout's own, but the record keeps the agent that wrote it,
and the merge guard judges that agent against the list committed on the base (`hasReview`):
a list a session adds to in its own worktree records nothing the guard trusts. **SubagentStop,
not PostToolUse on the Agent tool**: on Claude Code 2.1.301 every Agent call runs in the
background — the tool call returns at launch, and the agent's end comes later — so a
PostToolUse hook would record the commit before the reviewer had read a line. A plugin
SubagentStop is allowed by `.claude/rules/hooks.md` because this hook touches no worktree;
its SubagentStart cannot block a launch and adds no context. A run whose `cwd` is inside a
subagent's own worktree records nothing: its branch is a fresh one from the base, never the
commit a reviewer read. Success prints nothing at all; a record that cannot be written is one
stderr line, exit 0. `cc-smart-dev-kit workflow review-done [--sha <commit>]` stays for the
person's own terminal and **refuses inside Claude Code** (`CLAUDECODE`): it resolves the
commit with `git rev-parse` and records it `by` the person, which the guard trusts whatever
the list says; `cc-smart-dev-kit workflow show` prints whether the commit here has a record
the gate's own list trusts.

**What these checks are, and are not.** The review gate, the record and the `CLAUDECODE`
refusals stop mistakes — a session that switches a setting off in its own checkout, a stray
`review-done`, another plugin's agent that happens to be called `reviewer`. They are not a lock
against a process set on getting past them: anything that runs as the person can write the
person's own files (the record, `workflow.json`), drop `CLAUDECODE` (`env -u CLAUDECODE`), or
push to a branch the person may push to. What holds against that is the repository's own
branch protection and the person's yes to a merge.

**The usage-warning setting** is read by the status line through `src/workflow/alerts.ts`.
`alertsAt(paths, cwd, env)` resolves `alerts.usagePercent` once per run: the project's over
the person's over the built-in default. An unreadable project or personal settings file
drops only that file, keeps every value it can read, and returns one line for stderr.
A folder outside a project, or no `cwd`, is not a problem. Retired `alerts.events` and
`alerts.sound` values load but are discarded by the schema, not used by the status line.

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
