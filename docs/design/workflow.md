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
tests, because it decides whether the session may merge by itself:

```
autoMergeAllowed(resolved, projectConfig, prBase, defaultBranch)
```

True when `autoMerge` is on; the pull request's base may be any branch, the main branch
included (the owner, 2026-11-21: "autoMerge on" merges with no question). A direct push to the
main branch, not through a pull request, stays the person's. CI green and the review done are the
caller's checks (`merge-check.ts`, and the session's own instruction), not this one's: this
function answers about branches only. `autoMergeRefusal` is the same rule in words — the
reason a merge is not allowed — and
`autoMergeAllowed` is `autoMergeRefusal(…) === null`, so the five conditions live in one
place (`auto-merge.ts`).

**Who follows a setting: the instructions, and a hook only where a hook records.** Since 5.7.0 no hook stands in front of a push, a pull request or a merge (`docs/design/hooks.md` § Retired in 5.7.0): the session reads `workflow show` and does what it says.

| Setting | Followed by |
|---|---|
| `autoCommit`, `clearWorktreeAfterMerge` | the skills (`commit`, `worktree`): `autoCommit` is off by default, `clearWorktreeAfterMerge` on (the session removes its own finished worktree, `docs/design/sessions.md` § Locks, owners and who may remove what); each reads `cc-smart-dev-kit workflow show` and follows it. Nothing else can: a commit and a folder are the session's own doing, and no hook sees them as one act. |
| `autoPush` | the skills (`commit`): on, the session pushes its own branch once the change set is complete; off, only when the person asks. Never straight to the base or main branch. |
| `openPr` | the skills (`commit`, `pull-request`): `off` opens a pull request only when the person asks, `draft` opens it as a draft, `ready` opens it ready for review. |
| `autoMerge` | the skills (`commit`): on, the session merges its own pull request into its base, the main branch included, once CI is green (it waits in the background with `gh pr checks <pr> --watch`, then a plain `gh pr merge`, never `--auto`), the review of its head commit is recorded and the fixes after it are within `fixesAfterReview` (when they are over, it says so in the pull request); off, it leaves the merge to the person. `mergeMethod` and `deleteBranch` say how. |
| `reviewBeforePush` | both: the **review-record hook** writes the record when a review agent finishes (§ The review record), and the session reads it before it merges. |
| `reviewAgents` | the **review-record hook** records only an agent listed there. A project that runs its own reviewer names it (the plugin's `cc-smart-dev-kit:senior-engineer` by default). |
| `alerts.events`, `alerts.sound` | Retired load-only keys: ignored, omitted by `workflow show`, and refused by `workflow set`. Existing values survive unrelated writes. |
| `alerts.usagePercent` | the status line (`src/cli/statusline.ts`), whose warning share it is. |
| `plans.maxPhases` | the kit's task store (`docs/design/tasks.md`): the most phases one plan may hold, a whole number 1-50, default 10. Like every number setting it has one rule (`NUMBER_RULES` in `schema.ts`) that the file check and `workflow set` share, and a file that holds another value is refused with the field named. The project's file wins over the person's, and the cap is read from the checkout's working copy, not the committed file. The task tools hold a session to it, so `workflow set` and `unset` of it refuse inside Claude Code (`PLAN_KEYS` in `schema.ts`): only the person raises it, and the cap refusal says to ask them. `propose` stays open, since a person reviews its pull request. A project that sets it needs `requires` `>=4.8` (`WORKFLOW_PLANS_SINCE`). |
| `plans.runMode`, `plans.mergeFiles` | the plan tools and herdr's plan hand-outs, and the skills that ask for the mode: see the two paragraphs above, and `docs/design/herdr.md` § Handing out plans. Both are in `PLAN_KEYS` and refuse `set`/`unset` inside Claude Code. |
| `fixesAfterReview.*` | `readCover` (`src/workflow/review-cover.ts`, § The review record): the limits a change after a review may reach and still be covered. Resolved, shown by `workflow show` with their source (and as one `in force` line), and written by `workflow set`; `merge-check.ts` judges with them. |

**The merge is the session's own step.** It merges its pull request itself, with `gh pr merge`,
only when **all** of these hold: `autoMerge` is on; the merge names **this project's own repository**; every required check
`gh pr checks --required` reports is green (a `skipping` check counts as passed, which is
GitHub's own rule for a merge); and — with `reviewBeforePush` on — the head is covered by a
review (D17, § The review record). **The judgment is one home**, `src/workflow/merge-check.ts`:
`checkPullRequest` reads those facts and decides, `checkBranch` does the same for a local
branch against a base (the review gate only), and
`cc-smart-dev-kit workflow merge-check [<pr>… | --branch <b> --base <base>]` prints each verdict
(`allowed`, or the reason it is not; exit 0 when every one is allowed, 1 when any is not).
No hook runs it any more: it is a command the session runs, and the skill says to. The
`merge-guard` hook that called it before every `gh pr merge` is retired (§ Retired in 5.7.0 in
`docs/design/hooks.md`). Opening a pull request follows `openPr` the same way, as an
instruction.

**The settings that cannot work together are named where they are shown** (D16): one pure
function, `workflowClashes` in `src/workflow/clashes.ts`, called by `workflow show`,
`workflow set` (after the write), `project init` (in its plan, before anything is written)
and the portal's Settings page (a `!` line under the row). The pairs: `openPr` on with
`autoPush` off (the pull request waits for a push a person must approve every time),
`autoMerge` on with no `worktrees.base` (there is no branch it may merge into by itself),
and `autoMerge` on with `openPr: draft` (a draft is never merged). Each line says the fix.

**The review gate is read as committed on the pull request's base**, never from a checkout's
working copy. Every value the judgment uses — `autoMerge`, `reviewBeforePush`,
`reviewAgents`, `fixesAfterReview.*` (the limits a fix after a review may reach and still count,
D17, § The review record — read and shown with the gate, and `merge-check.ts` judges with them),
`worktrees.base` and `worktrees.bases` — comes from the built-in default, the person's
`workflow.json`, and `.claude/cc-smart-dev-kit.json` as `git` holds it at `origin/<base>`
(`resolveGate` in `src/workflow/resolve.ts`, over `readCommittedConfig` in
`src/project/resolve.ts`: `rev-parse` and `cat-file`, no fetch). A session edits its own
worktree's file in a second; it cannot change what a branch it has not pushed to says, and a
push to the base is what the review stands in front of. Two reads, one function:
before any `gh` call, the base this checkout names (`worktrees.base`), so `autoMerge` off is still
reported without `gh`; then, once `gh pr view` names the pull request's base, that base's file,
which judges the merge (`autoMergeRefusal` gets its `worktrees`). No `origin/<base>` (a new
repository, a fork, a branch never fetched), no file there, or a file this plugin cannot use
(broken, or a `requires` it does not meet) is not allowed, naming which. Because nothing is fetched, a
policy change counts once it is committed, pushed and fetched. `cc-smart-dev-kit workflow
show` prints the gate's own lines (`gate autoMerge = …`) from the same read, so it never
disagrees with `merge-check`, even while the checkout's file says something else; `workflow
set|unset` of a gate key (`REVIEW_GATE_KEYS` in `schema.ts`) refuses inside Claude Code, and
the "autoMerge is off" answer says to commit the change to the base and push it.

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
asks the person first** (RF1-4, `src/hooks/bash-judge.ts`) whenever the workflow
gate has `autoPush` off or `openPr` short of `ready`: the question names the push, the
pull request and the switch that says no; a gate or a project it cannot read is a question with
its reason; in `claude -p`, where nobody answers, it is a denial. Inside Claude Code a gate key
refuses, as `set` does; outside it — a terminal, the portal — every key is allowed: the pull
request's review is the gate.

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
