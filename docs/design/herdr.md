# Herdr session orchestration

The kit adds coordination to Herdr, not another session engine. Herdr owns terminals,
status, turns, panes and remote connections. The kit supplies checked starts, ownership,
briefs, waiting and the task link. A blocked child is the person's: they answer it in its
own pane, and the lead never relays it (4.10.1). The user workflow is
`plugin/skills/herdr/SKILL.md`; command help comes from `src/herdr/words.ts` (`HERDR_USAGE`).

## Parts

| File under `src/herdr/` | Job |
|---|---|
| `hc.ts` | The argv-only runner, tolerant JSON shapes, errors and minimum hc version. |
| `words.ts` | Shared verbs, flags, permission-mode order and parser for command and judge. |
| `labels.ts` | Label names, core/address identities, child names, report escaping and agent prefix. |
| `machines.ts` | The remote approval rules, validated reads and managed writes. |
| `identity.ts` | Live terminal and process-ancestry checks. |
| `brief.ts` | Private brief files and unique report files, and the plan and follow-up trailers a child gets. |
| `plans.ts` | The live side of plan hand-outs: the gates only git, gh and hc can answer, the start's reservation, and `herdr plans` (§ Handing out plans). |
| `command.ts` | All nine verbs, dialog parsing and the event-stream barrier. |
| `doctor.ts` | Optional hc discovery and conservative diagnostics. |

`src/entries/cli.ts` wires the command; `src/cli/help.ts` shares its grammar.
`src/hooks/bash-judge.ts` adds hook-input checks through `job-route`; its launch kind is in
`src/hooks/launch-judge.ts`. `prompt-source.ts` and `keep-going.ts` understand Herdr reports
and the `herdr:<core>/<address>` task-agent prefix. See `docs/design/hooks.md` § Herdr commands in the Bash judge.

## Identity and the two kinds

A linked lead must have `HC_TERMINAL_ID`. The command reads that terminal, requires it to
be live and local, and checks that its PID is an ancestor of this command's process.
An inherited or forged environment value alone is not identity. Core id plus terminal
address forms the lead id: two cores can have the same short terminal address.

| Label | Meaning |
|---|---|
| `kit.lead` | Linked child's current lead, `<core>/<address>`. |
| `kit.repo` | Repository root, or directory outside git. |
| `kit.task` | Optional same-project task reference. |
| `kit.plan` | A plan child's plan slug (`herdr start --plan`); a terminal that carries it never coordinates. |
| `kit.followup` | `1` for a lead's follow-up child (`herdr start --followup`, § Follow-up children). A terminal that carries it never coordinates: `start --plan`, `plans --reserve` and `adopt` refuse it, as they refuse a plan child. It also carries `kit.lead`, so `start --followup` is refused in it. |
| `kit.independent` | `1` for a session without a lead link. |
| `kit.started-by` | Independent session's initiating identity, when available. |

A **linked child** starts with `--outlive-parent`, reports to its lead and can be adopted
when that lead disappears. Ownership follows labels, not Herdr's immutable parent field.
An **independent session** uses `--no-parent`; no report instruction or ongoing monitoring
is promised. It can start outside Herdr if no terminal identity is supplied. The person
sees it as its own space in Herdr. Neither kind has a kit-imposed session-count cap.

Starts print the kind, address, name, worktree and live/blocked count. `list` shows owned
children; `list --all` includes other kit sessions and independent sessions. `stop` kills
and removes only an owned linked terminal, leaving its worktree. `adopt` takes only
same-repository, same-core linked children whose previous lead no longer runs a live Claude.
A live terminal with only a shell counts as gone; a blocked Claude still owns its children.
A foreground `claude` program also counts as live before its first status arrives.
Adopt lists each child's saved report files. It skips independent sessions. It also moves the
plans of a lead that ended (§ Handing out plans).
Identity belongs to the terminal: a new Claude in the old lead terminal receives reports
without adoption. Adopt changes kit labels, not hc's immutable parent, so the child can
remain under the old lead's tab in Herdr's panel.

## Starts, briefs and reports

A start requires explicit model, effort and mode. In git it runs Claude with `-w kit-<name>`;
the normal path is `<repo>/.claude/worktrees/kit-<name>` and branch `worktree-kit-<name>`.
Every child starts through the person's login/interactive shell so hooks and MCP tools
get that shell's PATH. An argv-only `sh -c` wrapper passes the program and its arguments as
positional parameters, never as script text. For sh, bash, zsh, dash and ksh it uses
`$SHELL -lic`; other or unset shells use `sh -lc`. Each level uses `exec`, so hc still sees
Claude's own foreground argv and exit.

Independent sessions, local or remote, add `--keep` plus fresh `herdr.space` and `herdr.tab`
labels. Their machine-local ids are `sp` and `tb` followed by 32 random hex digits. They show
as new spaces in Herdr, in their own machine's block. A linked child, local or remote, gets no
labels: hc records its lead as its parent, even across machines, so it nests under the lead in
the Agents panel and opens as a child pane. (4.3.1 gave remote linked children their own space;
the live run showed they nest without it, and the owner wants them under the lead.)
After a core crash, `--keep` leaves a shell in the pane; it does not restart Claude.

After launch, start polls `hc get` for a Claude status or terminal exit for up to 20 seconds.
A finite poll budget derived from that window and the interval also bounds a stationary clock.
A finished child prints its last non-empty screen lines, is removed from hc, and reports
whether its worktree folder exists. An hc finished/not-found result follows the same exit path;
an unreadable ended screen prints a note, and an already-removed terminal needs no cleanup.
Other hc errors still fail normally. Start exits 1 without a created line or task binding.
It does not inspect Claude's private trust settings: Claude's own launch error gives the fix.
A child with no status at the deadline prints its screen and an `hc attach` warning, then
continues successfully, including task binding. A slow first status is not a failed launch.

Terminal, branch or folder reuse is refused with a fresh-name suggestion. A project's own
WorktreeCreate hook can change that layout; the command's predicted path is not a live proof
of such a hook's result.

`--task` must name an existing open task in the same project and machine; independent
starts cannot use it. After launch the command records agent, branch and worktree through
the task API. A failed binding warns that the child did start; it is not a launch rollback.

Each child gets `<stateDir>/herdr/briefs/<core>-<name>/brief.md` (`cliPaths().stateDir`).
Its folder is 700 and files are 600, written atomically without the kit-wide lock.
Claude starts with `--add-dir <that folder>` so even a default-mode child can read its
brief without a permission prompt. Its first message points to the file inside a lead
report wrapper; remote starts use the remote absolute folder in both places. Linked briefs add a reporting command and forbid grandchildren
unless the brief allows them. A task brief adds `Your task: #n` and a Report-note instruction;
the child does not take, update or close the task.

`send` and `report` check the receiving terminal first: idle and working use the matching
`hc send --if`; done uses a plain send. Blocked, unknown or missing status is refused;
`--force` is never used. `send` wraps text in `<kit-report from="lead">`; reports escape
embedded hc/report tags and identify their source. These wrappers, and `<hc `, are excluded
from the person's turns by `prompt-source.ts`, after trimming leading whitespace.

A report is sent only to a live Claude Code lead on the same core. If that lead cannot
receive it, including a race to blocked status, a unique timestamp-and-UUID report file
is saved as `report-<UTC>-<uuid>.md` in that child’s brief folder for local children. Remote reports use the file fallback on
their own machine, in a folder keyed by their own core, not the lead core used by the brief.
Reports are child evidence, never the person's approval.

## Handing out plans

A lead with queued plans can give each ready plan to a linked child (5.2.0). The modes and what the
lead does in each are `plugin/skills/build/SKILL.md` § Lead + children and coordinator modes, chosen
by `plans.runMode` (`docs/design/workflow.md`). The store's part (file lists, the reservation, the
take) is `docs/design/tasks.md` § Plans handed to children.

**`start --plan <slug>`** takes the checks of any linked start, and more:

- It excludes `--task`, `--independent` and `--on` (one text, `PLAN_EXCLUSION`): a plan child is
  local and linked.
- It refuses when the caller's own terminal carries `kit.plan` or `kit.followup`: a plan child or
  a follow-up child never coordinates. `plans --reserve` and `adopt` refuse there too. The words:
  "A plan child never coordinates: it builds its own plan only, so it cannot <hand out plans |
  reserve plans | adopt another lead's plans>." and "A follow-up child never coordinates: it works
  its lead's findings only, so it cannot …", each with the fix "Report to your lead with
  cc-smart-dev-kit herdr report; the lead hands plans out." (`refusePlanChild`, `command.ts`).
- The slug resolves with the take path's resolver (`planByRef`), so `#n` works as well. The
  plan must be one this session laid and not started.
- It refuses when the default branch is only a guess (no `origin/HEAD`, no `worktrees.base`),
  with the fix `git remote set-head origin --auto`: the child resets onto that branch.
- The child's name is the slug. When `kit-<slug>` is not a valid child name, `--name` is the fix.

**The order** is: those refusals, then the name check (`kit-<slug>` must be a valid child name),
then the live gates (below) and each held plan's branch diff, then the reservation, and only then
the worktree and terminal collision checks, the brief, the launch and the binding. The diffs are
read first, outside any store write (`git diff --name-only --no-renames
origin/<default>...<branch>` lists both sides of a rename), so no git runs under the write lock.

**The reservation.** `reservePlan` takes the plan in one transaction. It refuses a plan with an
open blocker, no file list, an existing reservation or files that overlap a **held** plan, and any
held plan with no file list and no branch diff (the rule is in `docs/design/tasks.md`, under "Held"). A held
plan is any reserved plan until it is released, and any session's own plan in flight.
`plans.mergeFiles` never counts, and case folds when `core.ignorecase` is on. Both come from
`planFilesCheck`: the committed copy on `origin/<default>`, never the working copy. The reservation
records the lead (session and process), a holder kind (`child`, or `self` for the lead's own plan)
and a **hand-out id**, the key a child takes the plan with. A launch proved failed releases the
reservation. A child that started but cannot be read does not.

The binding writes `agent` (`herdr:<core>/<address>`) and the label `kit.plan=<slug>`; `worktree`
and `branch` go in once, on a first start.

**`plans --reserve <plan>`** is the lead's own hand-out, for lead + children mode. The plan
resolves with `planByRef`, then it runs the same live gates and held-plan diffs as `start --plan`
and `reservePlan` with holder `self`, with `ignore` and `caseFold` from `planFilesCheck`, read
before the write lock. It prints one line naming the plan and the next step: start its first phase
as usual. It refuses from a plan child or a follow-up child (the terminal carries `kit.plan` or `kit.followup`), when the default branch
is only a guess, and for a plan that is not pending (one already started: park it first, then reserve it), not the
caller's own or already reserved, each with its fix. It stands alone: `--wait`, `--json` and `--release` cannot join it. The Bash judge
stays silent, since it reserves the caller's own plan and frees nothing. A reserved plan stays held until
its pull request merges or closes (or the settle proof below holds; an unreserved plan's files are free once its task closes): the classifier reads it as `own`, then `merging` once it is closed, and a
`herdr plans` pass releases it like any other.

**The plan trailer** (`planTrailer` in `brief.ts`) replaces the task trailer:

1. Take the plan with `task_take`, `from` set to the hand-out id.
2. Fetch `origin/<default>` (once more on failure, then stop and report), `git reset --hard` onto
   it, and save `HEAD` as the plan's `base`. A resume skips all of this.
3. Run `/cc-smart-dev-kit:build` on this plan only; builder subagents are allowed, other
   sessions are not.
4. Push, pull request and merge follow `workflow show`; where they are off, ask the person in
   that terminal.
5. `herdr report` with the pull request link, what shipped and what failed. Then stop.

**Resume.** A plan whose child is gone comes back with `start --plan <slug>`. "Gone" needs two
proofs. The store's classifier reads `child-gone`: the child's process is gone and no running
session carries its id (`sessionEnded`), so a reopened child that has made no task call yet still
counts as alive. And hc shows its pane gone.

The new child starts in the **recorded** worktree (`claude -w <name>`). That worktree may be reused
once, and only when it sits under `<repo>/.claude/worktrees/`. The hand-out id is the same, the
brief skips the reset, and an `in_progress` plan is allowed on this path only. A hand-out its child
never took, with the pane gone, relaunches the same way; with no worktree recorded, `herdr plans`
releases it.

Two starts must not launch into one worktree. Before a resume or a relaunch launches, the start
claims the plan's `agent` with a `pending:<clock>` marker by compare-and-set (`swapPlanAgent`): a
write that succeeds only if the value is still the one just read, so the second of two starts is
refused. The marker reads as a live child for `HANDOUT_GRACE_MS` (120 s). A live terminal labelled
`kit.plan=<slug>` also stops a start.

**`herdr plans [--json] [--wait] [--timeout <seconds>]`** is the lead's view, with every gate the
status line and the Stop hook may not run. It starts from the store's classifier and adds git,
gh and hc: a blocker's pull request (one reader, `pullRequestState` in `src/worktrees/scan.ts`,
which counts a merge only at exactly this head, so a squash merge is safe), the branch diffs and
each pane. It prints a summary (`Plans: 2 with children · 1 built here · 1 child gone · 1 closing ·
1 waiting · 1 need you · 1 ready`), then one line per plan with its mark, its reason in words and
its fix. In the table, the first column is the `state` of that line in `--json`; the status line
has words of its own (`docs/design/tasks.md`).

| `--json` state | Meaning |
|---|---|
| `ready` | Every blocker is clear and the files overlap no held plan. |
| `waiting` | A blocker is open, or its pull request is open or not yet on the default branch. |
| `blocked` | A blocker cannot clear by itself: no branch recorded, no start commit to prove a merge from, an empty branch, a branch not in this repository, or a pull request closed unmerged; or a held plan has no file list and no branch diff, so no overlap can be ruled out. The line carries its fix. |
| `overlaps` | Files shared with a held plan; the line names both. |
| `no-files` | No file list yet (the line says "has no file list"; the status line says "needs files"): `task_update` with `files`. |
| `own` | Reserved for this session itself with `plans --reserve`: it builds the plan. |
| `with-child` | A child holds it. Drift shows here: its branch reached another held plan's files. |
| `child-gone` | The child's session ended: resume it. |
| `stale` | A hand-out no child took, its pane gone. |
| `merging` | Finished, files still held until its pull request settles. |
| `released` | This pass released a reservation. |

A blocker clears when its pull request merged; or, with no pull request or no answer from gh, when
its branch holds commits past its recorded `base` and is on `origin/<default>` (`onDefaultBranch`,
the one proof). A dropped blocker is clear, and so is a closed task or phase that is no plan.

The pass **settles** first, so later lines see the files free. A `merging` plan is released when
its pull request merged or closed, or when that proof holds with no pull request. A hand-out that
never started, with no pane and no labelled terminal, is released. A done plan never releases
itself, and a dropped plan always does. A plan whose pull request was merged by hand stays
`merging` until a pass runs. `plans --release <slug>` is the person's way out when nothing can
prove a closed plan merged: it refuses an open plan, and the Bash judge asks before it runs
(`docs/design/hooks.md` § Herdr commands in the Bash judge).

`--wait` returns at once when a plan is ready already or none can change by itself. Otherwise it
looks again every `PLAN_POLL_MS` (15 s) until a plan turns ready, a reservation is released or a
reserved plan's pull request merges, prints the change and exits. At the timeout
(`WAIT_TIMEOUT_MS`) it prints its own command to run again, as `wait` does. With no store, or no
plan led, it says so and exits 0.

**`adopt`** also moves the lead identity of every plan whose lead ended, by the same proof as
`child-gone`, whether or not the plan has a live child: its children's plans, the hand-outs no
child took, and a plan the old lead built itself. The holder kind and the hand-out id stay. A
plan whose maker is the dead lead moves its maker too, so it does not read as `child-gone`. The
new lead takes a plan the old lead built itself with `task_take` before its next phase. A lead
with no recorded process is never adopted: its death cannot be proved.

## Follow-up children

A follow-up is a finding outside the plan being built: the lead's own, or one in a builder's
`Report:`, a reviewer's "Outside this change" or a rules-maintainer's "Follow-ups for the caller".
Before 5.4.0 nothing worked on a filed issue. Now the lead acts at once, and a yes hands a finding
that is outside every plan to the lead's **follow-up child** (5.4.0): one linked session that
collects every such follow-up of this lead and repository into one pull request at a time. The
rule for the lead is `plugin/skills/tasks/SKILL.md` § 1; the command lines and the ship message
are `plugin/skills/herdr/SKILL.md` § Follow-up child. This section is what the command checks and
what the child is told.

**Who gets which finding.**

- **Inside a held plan** (the lead's own plan, or one handed to a plan child, live or gone): it is
  a task in that plan, and nobody is asked. With a live plan child the lead sends it the finding so
  it makes the task; otherwise the lead creates the task. The follow-up child never edits those
  files.
- **Inside a finished held plan** (its plan task closed, its pull request open): the store takes
  no task. The lead asks with two options: a late fix on that pull request (only when it is this
  session's) or filing it for after the merge, with a task note to send it to the follow-up child
  then.
- **Outside every plan:** the lead asks at once, one finding per question. The options: send it to
  the follow-up child, start one, or file only. A blocked follow-up child offers file only.
- **A child that finds one** lists it in `herdr report`; every linked child's brief says it never
  asks, files or starts: the lead decides when it reads the report.

**`start --followup [--issue <n>]…`** is the smaller sibling of `start --plan`. It takes the checks
of any linked start (model, effort and mode, names, brief, binding) and adds these. `--issue` may
repeat (repeats are dropped, the order kept), takes a positive whole number and needs `--followup`.
The refusals, in the command's words:

| Refused when | The command says (and the fix) |
|---|---|
| `--plan`, `--task`, `--independent` or `--on` is also given | "--followup cannot be combined with --plan, --task, --independent or --on." |
| `--issue` is used wrongly | "--issue belongs to --followup." or "Use an issue number such as 12." |
| Not in a git project, or no lead terminal | "A follow-up child needs a git project and the lead's own terminal." Fix: run it in the project's folder, or give `--cwd`, from the lead's terminal. |
| The caller's terminal carries `kit.lead` (any child) | "A child never starts a follow-up child: only a lead does." Fix: put the finding in `cc-smart-dev-kit herdr report`. |
| The default branch is only a guess | The text `start --plan` uses (`UNKNOWN_BASE`): "… so a child would reset to a guess." Fix: `git remote set-head origin --auto`, or set `worktrees.base`. |
| This lead already has a live follow-up child in this repository | "This lead already has a follow-up child for this repository: `<addr>`." The fix depends on its state (below). |
| A live follow-up child of a lead that has **ended** is here | "A follow-up child of a lead that has ended is still live in this repository: `<addr>`." Fix: take it over with `cc-smart-dev-kit herdr adopt`, then send the finding. |
| An ended follow-up child left unmerged commits | "A follow-up child in this repository ended (`<addr>`) and left commits on `<branch>` that are not on origin/`<base>`, with no merged pull request. Its worktree is `<path>`." Fix: push and merge that work, or remove the worktree and branch once checked (`cc-smart-dev-kit worktrees --clean`), then start again. |

The fix for the live-child refusal depends on the child's state:

- Idle, working or done: `herdr send <addr> "<finding>"`.
- Blocked, or no status yet: "It waits for the person in its pane: hc attach `<addr>`. Send the
  finding once it is free."
- Any other state (error): look at its pane.

A plan child and a follow-up child cannot hand out, reserve or adopt plans either:
`refusePlanChild` (shared with the plan child's refusals) says "A follow-up child never
coordinates: it works its lead's findings only, so it cannot hand out plans | reserve plans |
adopt another lead's plans." Fix: "Report to your lead with cc-smart-dev-kit herdr report; the
lead hands plans out."

The base is `baseBranch()` in `plans.ts`, so `worktrees.base` counts. The live-child gate is per
lead and repository: another repository gets its own child through `--cwd` there, and a second
start made right after the first meets the refusal. The ended-child gate is wider: it covers every
lead of this core in the repository.

The ended-child gate reads the branch the child's worktree has checked out (`worktree-<name>` when
the worktree is gone). It counts a branch as unmerged when its commit count past `origin/<base>`
is not 0 or cannot be read. A pull request state other than merged (open, closed, none or unknown)
does not clear it.

**The follow-up trailer** (`followupTrailer` in `brief.ts`, beside `planTrailer`) tells the child.
It never stops on its own: after each report it waits for the next message, and ends only on
`herdr stop`.

1. **Once, before the first finding:** fetch `origin/<base>` (one retry; a second failure is reported, and no finding is taken until step 1 has run).
   Reset onto it only when its **own** commit count is 0 and the tree is clean. The count is
   `git rev-list --count HEAD --not --exclude=<branch> --branches --exclude=origin/<branch>
   --remotes`: the commits on no other branch, local or remote. (`--exclude` applies only to the
   next `--branches` or `--remotes`, so both are written. A bare count past `origin/<base>` would
   treat the lead's plan branch as the child's work when `claude -w` cuts the worktree from it.)
   Otherwise it never resets: the worktree may hold work.
2. **Before each finding, its pull request's state:** `gh pr list --head <branch> --state all`.
   A failure is reported and the child waits: never read as "none". An empty list is none; with
   several, an OPEN one wins, else the newest by `createdAt`.
   - OPEN: add the commit to the branch; it joins that pull request at the next ship.
   - MERGED and `HEAD` equals the pull request's head commit: the branch is fully merged. It
     fetches and runs `git switch -c followup-<name>-<n> origin/<base>` (`<n>` the first number
     from 2 that `git branch --list` does not show). No reset. The switch carries uncommitted
     changes, or refuses: then it reports and waits.
   - MERGED and `HEAD` is past that commit: it makes the new branch the same way and
     cherry-picks the commits past the pull request's head onto it, so a squash merge loses
     nothing. A conflict is aborted (`git cherry-pick --abort`), the old branch restored, the new
     one deleted, and the conflict reported. The marks come at the ship (step 6), with each
     commit's id on the shipping branch, so a cherry-pick's new ids need no second mark.
   - MERGED and `HEAD` neither equal nor past it: report and wait.
   - CLOSED without a merge: never reset. It keeps its branch, and the next ship opens a new
     pull request from it. It says so in its report.
   - none: go on.
3. Never edit a file a held plan holds. The trailer lists each held plan's slug and files, a
   snapshot taken at the start (`heldPlans`, stored file lists only). The lead names the files of
   a plan held later in its `send` text. A finding in those files goes in the report.
4. A small fix: fix, check, review the diff. Work that needs a kit plan goes back to the lead in
   the report: the child never runs plan-task or build. Other bigger work: plan mode, approved by
   the person in the child's pane.
5. One commit per finding, with its issue in the subject as `(#n)` and no closing keyword, so the
   ship step reads the issue back from `git log`. Beyond a small fix (`/cc-smart-dev-kit:review`
   defines it) the child then starts one second opinion on that commit from
   `cc-smart-dev-kit:senior-engineer`, and the `cc-smart-dev-kit:edge-case-hunter` on a risky
   change as that skill says. The brief allows those agents and no other, because the general
   instructions require the second opinion and a linked child's brief otherwise forbids every
   agent. The review runs on the commit because the review record counts the commit the folder is
   on when the reviewer starts; the child commits nothing while it runs, and its confirmed fixes
   go in one more commit. **It never pushes before `ship`:** its commits stay in its worktree.
   (A push before the pull request opens costs no CI only where CI runs on pull requests and the
   default branch alone; the child cannot know the project's triggers, so it never counts on
   that.)
6. **Ship only when a message from the lead says `ship`.** Then: the project's full check; then,
   before the push, `issue mark-fixed --issue <n> --base <base> --branch <shipping branch> --tip
   <id>` for every commit of its own that is not yet on `origin/<base>` and whose subject names an issue, with
   `<id>` the commit's current id on the shipping branch (a cherry-pick or a new branch gives new
   ids, and `issue fixed` finds an issue by its marker commit). `<base>` is the branch the pull
   request targets, not the child's own branch: the comment would read "merged into" the wrong
   branch. The comment posts before the merge, because the `Fixes` lines need the mark first, so
   it says "merged" a little early. Skipped when issues are off. Marking at the ship, not after
   each commit, means a commit that never ships (an aborted cherry-pick, a finding dropped before
   the ship) never leaves a mark that names a branch which does not carry it. (A commit whose pull
   request was closed was marked at the ship that opened it; the mark stays, and becomes true when
   the branch ships again.) Then one push, then open the pull request or push to the open one, as
   `workflow show` says (where it is off, ask the person in this terminal). The body's `Fixes`
   lines come from `issue fixed --base origin/<base> --head <branch>`, never by hand. When it
   pushes to an open pull request, it replaces the body's `Fixes` lines with what that command
   prints now (`gh pr view <branch> --json body --jq .body`, then `gh pr edit <branch> --body-file -`; a failed read edits nothing), so an issue
   marked at this ship is closed by the merge. A `ship` mid-finding waits until that finding is done. A `ship` with
   nothing to ship is answered "nothing to ship" in the report.
7. `herdr report` after each finding and after each ship.

The trailer also carries the issue numbers given with `--issue`. The label is `kit.followup=1`;
`herdr list` shows "follow-up" in a column now headed "task, plan or follow-up". No issue number is
stored in a label, since it would go stale.

**One home for "never ask, file or start".** `writeBrief` adds it to the linked text every linked
child gets, after "Start no sessions or agents of your own unless this brief says so": "A finding
outside your work goes in your report: never ask the person, file an issue or start a session for
it." `planTrailer` and `followupTrailer` carry no copy of it.

**The ship point.** The lead sends `herdr send <terminal> "ship"` at the session's one ship point
(`docs/design/workflow.md` § Fewer pull requests): the end of the turn that finishes the person's
request, or when the person says to ship now. A blocked child cannot take it: the lead tells the
person where it waits (`hc attach`), saves a task note "send ship to `<terminal>`" and sends it
the next time the child is idle, working or done. A child in the error state: the lead tells the
person to look at its pane. While the person is away, the lead sends it and records a decision.

**Sending to it.** `herdr send` reaches the follow-up child in the states `SEND_STATES` lists
(idle, working, done), one constant read by `send`, `report` and the gate. A blocked child, or
one with no status yet, refuses `send`: it waits for the person in its pane, and the issue stays
filed. In the error state the lead neither sends nor starts. After a new start the lead waits for
the child's first status before the first send.

**`wait --all`** leaves follow-up children out of its barrier, since one never settles. With only
follow-up children live it prints "No live kit children to wait for (a follow-up child never
settles)." (no live child at all keeps "No live kit children."). `wait` without `--all`, `list`
and `stop` see it as any linked child.

**The judge** reuses the command's parser. A `herdr start` line with a parse error (a bad
`--issue`, a refused pair of flags) shows that error alone when `--model`, `--effort` and `--mode`
are all given. With one missing, the old "Pass both --model and --effort, plus --mode" line still
comes first.

**Limits.**

- The held-plan list in the trailer is a snapshot; the lead repeats a new one in a `send`.
- The orphan gate sees only terminals `hc` still lists. `herdr stop` kills and removes the
  terminal, so after a stop the gate cannot see that child's unshipped work: ship first. The
  worktree and branch stay, and `worktrees --clean` may hold an old branch whose commits were
  cherry-picked elsewhere.
- A corner with `baseRef: head`: when the lead's own HEAD is detached, its commits are on no
  branch, so the child's own-commit count includes them and the guard does not reset.
- The child follows its trailer in prose; nothing enforces the steps.
- A review covers only its own branch (`review-cover.ts`). After a cherry-pick onto a new branch,
  the moved commits' reviews do not cover the new head, so the lead sees no review of the new head at
  that pull request's merge, and says so in the pull request. Nothing is lost.
- A merged or closed pull request (by the person or `autoMerge`) is noticed only at the child's
  next finding.
- No `--issue` and no `Fixes` line when issues are refused (a public repository without
  `allowPublic`, no GitHub, issues off).
- The flow is **not yet proved live** (§ Live evidence and work still owed).

## Remote machines

`cliPaths().machinesFile` is `~/.config/cc-smart-dev-kit/machines.json`, independent of
`CLAUDE_CONFIG_DIR`. Its shape is `{ "version": 1, "machines": { "worker": { "allow": true } } }`.
Missing file means no approvals. `allow` means free remote starts, an unknown/unallowed name
asks, and `production` always asks even when `allow` is also true. `forget` removes the entry.
Machine-rule changes ask the person and use the managed atomic writer under the kit lock.
An unreadable or invalid file fails loudly; the judge asks rather than treating it as free.

Remote starts require `--cwd` on that machine. The command checks `claude --version` first,
then the remote kit's version, through the same login-shell wrapper as launch. Both programs
must be found by that user's login shell, and the kit must not be older than this command.
The parser takes the last semantic version in stdout, allowing shell rc files to print noise.
A missing program names the machine and gives its installation fix. Git, test, mkdir and
chmod stay plain argv calls. The command resolves git there and checks terminal/worktree/branch collisions.
It makes the remote brief directory private, sends the file on stdin through
`hc file write --on <machine> --json <path>`, requires an absolute returned path, and sets
mode 600 before launch. It does not use `hc put`, which would need a terminal already started.

The remote brief states where reports stay. Start and wait print the actual report folder
and the retrieval lines `hc exec --on <machine> find <folder> -type f` and
`hc file read --on <machine> <folder>/<child>/<file>`. The exec line is for the person's shell:
raw hc exec remains denied to Claude by the judge. A different remote config override does
not alter the absolute brief path already handed to the child; report retrieval with such
an override still needs live verification.

## A blocked child is the person's

The person answers a child's questions, permission prompts, plan approval and login in the
child's own pane. The lead takes no part: `wait` does not report a blocked child, the skill
tells the lead never to ask or answer for it, and the judge refuses raw input into a child's
dialog, so only the person answers. Until 4.10.0 the kit had a relay (`herdr answer`, with a
screen reader that matched the dialog and a judge question for every answer); the person
chose to answer in the pane instead, so 4.10.1 removed it, and its guards with it.
While away, the lead takes the recommended option and records a decision; a child waits in its
pane until the person comes back.

## Waiting without polling

`wait [--any | --all] [--timeout <seconds>] [--seen <addr>:<turn|?>:<state>,…]` follows
label-filtered hc events in a background Bash call. The initial and missed snapshots count
as status evidence. Settled states are error, done and terminal end (`end` in the cursor).
Blocked is not settled: the child waits for the person, and the wait goes on. An old cursor's
`blocked` entry (printed by 4.10.0) is accepted and ignored. A different state at the same turn is news; a backwards turn is stale and reported.
An unknown turn can be printed and carried as `?`. Addresses are percent-encoded.

Default/`--any` returns on news, retaining all news buffered in that chunk. `--all` is a
barrier over initial live children not already settled-and-reported; it waits for each to
give news or leave, or until timeout. An empty all-barrier says there is nothing to wait for;
any keeps listening for a new turn. With no live owned children either mode returns at once.
A follow-up child (`kit.followup`) is left out of the `--all` barrier: it never settles on its own (§ Follow-up children).
The default timeout is `WAIT_TIMEOUT_MS` in the command; timeout is not completion proof.

The final continuation keeps the supplied cursor entries for the addresses in the wait's
first snapshot, drops the rest, and then updates entries only from the news actually
printed, with the same mode and timeout. It never consumes an unreported later status read. Copy
that exact next command. A lost event stream is a failure with unknown child outcome,
not a successful completion. Remote news also prints the report retrieval hints.

## Judge and command boundaries

The command holds ownership, identity, names, task locality, remote version, brief privacy,
report safety and send guards. It requires `--asked` for Fable, Opus/max, and non-free remote
starts. The judge still asks for every such launch, even with that flag: the approved line
is the line that runs. It also asks for every machine-rule change, denies raw hc
writes and identity assignments, and caps mode from PreToolUse's `permission_mode`.

The mode cap, premium/remote approval prompts and machine-rule approval prompts live only
in the judge, as does the refusal of unattended starts (`claude -p`): nobody watches their
children or receives their reports. A script calling the command directly meets only the
command's identity, ownership, name, task-locality, version, privacy and send checks, its
explicit model/effort/mode requirements, its bypassPermissions ban and its `--asked` flag
requirements. The flag alone is not a recorded approval outside the judge. Raw remote hc
reads also meet the judge's machine rule: production and unknown machines ask; free ones
pass silently; unreadable rules ask. Likewise, a shell judge
cannot inspect arbitrary script bodies or identify commands assembled from unrelated string
fragments. These are policy checks, not a sandbox; keep that limit explicit.

## Edge cases

| Trigger | Result |
|---|---|
| Lead dies or becomes a shell | Child stays; new lead adopts it by labels and sees saved report paths. |
| Old lead is a blocked Claude | Adopt skips its children. |
| Claude restarts in the old terminal | It is still the lead by terminal identity. |
| Child exits during launch, including a trust error | Show screen and folder state, remove terminal, exit 1; no task binding. |
| First Claude status takes more than 20 seconds | Show screen, warn with attach command, exit 0 and bind the task. |
| Login shell is unset or not in the supported shell family | Use sh login fallback; user arguments stay positional. |
| Trust screen, booting child or unknown status | No text send; person uses the pane. |
| Child blocked on a question or permission | The person answers in its pane; `wait` keeps waiting. |
| Lead has become a shell or is blocked | Report falls back to a unique file. |
| Old terminal name still has worktree/branch | Refuse reuse rather than resume old work. A plan's own child is the one exception (§ Handing out plans). |
| A child finds a follow-up | It lists it in `herdr report`; a child cannot start `--followup` (`kit.lead`), so the lead decides. |
| A finding sits in a held plan's files | A task in that plan, no question; never for the follow-up child. A finished held plan: late fix on its pull request, or filed for after its merge. |
| The follow-up child's pull request merges | At its next finding it fetches and switches to a new branch from `origin/<base>` (a cherry-pick when it holds unmerged commits). No reset. The lead still sends to the same child. |
| The follow-up child's pull request is closed unmerged | It never resets: it keeps its branch and the next ship opens a new pull request from it. |
| A follow-up child ended with unmerged commits | The next `start --followup` is refused and names its worktree and branch, if `hc` still lists the terminal; after `herdr stop` it cannot be seen. |
| A follow-up child is live under a lead that ended | The start is refused; `herdr adopt` takes the child over. |
| `ship` arrives at a blocked child | The lead tells the person, notes "send ship to <terminal>" and sends it when the child is free. |
| Two plan hand-outs share a file | The second `start --plan` is refused by the reservation and names the plan in its way. |
| A plan child's pane closes | `child-gone`: `start --plan <slug>` resumes it in its recorded worktree. |
| A session from before 5.2.0 | It ignores reservations: its take and start do not check them and its drop does not release. Restart it before plans are handed out. |
| New hc fields | Tolerant schemas keep them; unknown dialog kinds stay pane-only. |
| Independent session blocks unseen | Its own Herdr space is visible and Herdr marks it as needing you (proved live, local and remote). |
| No hc installed | Doctor reports optional orchestration, not failure. |

Real doctor checks hc discovery/version, then says **core not checked**: hc does not document
a no-start status read. It does not enumerate children in that path. An injected runner
covers core-down warnings, skipped terminal reads and blocked independent counts in tests;
these are not claims that real doctor already performs those reads.

## Live evidence and work still owed

For 4.3.1, one live check is still owed in #273: adoption from a shell lead with saved
reports listed (the relay checks it also listed went with the relay in 4.10.1). The
release also owes the launch-failure, independent
space and attention, and remote-start checks after the start fixes. Unit fixtures copy
2.1.322 screens; they do not establish these live outcomes.

The initial spike observed a question status `answer: Proof: which letter? (A · B)` and
down/Enter selection; the later phase-B proof could not expose dialogs while user-away
hooks were active. Phase B did prove: a trust screen has null status; plain `hc run --bg`
omits `first_message`; `--no-parent` yields null parent; plain send to done starts a new
turn; `--if idle` against done fails with status_mismatch. Start therefore reads the screen
once when first-message evidence is absent. Fake-runner tests cover the command contracts,
not live UI behavior.

**Not yet proved live** (release proof task #273):

- Actual Bash permission kind/msg and labels; plain send at a blocked prompt types nothing.
- Whether Herdr marks a blocked linked child as needing the person (proved only for
  independent sessions). Since 4.10.1 that mark is the person's only signal: `wait` stays quiet.
- A real child's report to a live lead and a gone lead's report-file fallback.
- Remote version/git/collision checks, private brief transfer and launch on an allowed machine.
- Herdr's toast for an independent session's unseen question.
- Acceptance of the final-check-to-keys race, or upstream `keys --if-turn` support.
- With app and core closed, whether `hc server status --json` starts a core. Until it is
  shown never to start one, doctor keeps core not checked.
- The follow-up flow (5.4.0): the lead acts at once, the first yes files the issue and starts the child on `origin/<base>`, a second finding is sent to it, and at the ship point `ship` makes it open one pull request that carries both with `Fixes` lines from `issue fixed`; after a merge the same child switches to a new branch at the next finding. The orphan gate, the cherry-pick path and the closed-pull-request path have fake-runner tests only.

The done-child send result above is established; #273 still calls for its end-to-end
confirmation with the owner. The broader plan also owes integration checks for adoption
and cross-repository coordination. No closed-core or remote live claim follows from unit tests.

## Not in this plan

A Herdr mod panel, hc templates for kit roles, job-queue integration with `hc wait --output`,
and guarded arbitrary remote `hc exec` are deferred. The cross-repo message guard is retired:
messages to another repo’s session no longer ask for approval, following the owner’s decision.
