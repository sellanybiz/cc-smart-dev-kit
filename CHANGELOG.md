# Changelog

What each release changed, newest first. A release's **What to run** steps are the ones to do
in your own terminal after the update; the user guide is [README.md](README.md).

## 6.7.0

Fixes four problems that sessions in real projects reported, and lets plans that share files run
at the same time.

- **Plans that share files run together.** The plan-overlap check warns and never refuses: a
  start, a reservation, a change of a held plan's files and a `herdr` hand-out all go ahead.
  The answer gets one warning line naming the other plan and the shared paths, and both plans
  get the same text as an `Overlap:` note, once per pair and set of shared paths. The note
  points to the build skill's § 6: the plan that merges second brings its branch up to date with
  the merged base, resolves the conflicts and reruns the full check, and both pull requests name
  the overlap. `plans.mergeFiles`, `plans.appendOnly` and a proved stack still settle their
  paths. When the shared paths include files the base marks `linguist-generated`, the warning
  names them, and prints a ready `cc-smart-dev-kit workflow propose plans.mergeFiles '…'` line
  only when listing them would settle those files; for a folder both plans list, it says to narrow the
  folder entry or put the folder in `plans.mergeFiles`. There is no setting to bring the block
  back. `herdr plans` shows an overlapping plan as ready, and its `--json` has no
  `overlaps` state any more.
- **`workflow propose` works with project git hooks.** It makes its one commit with git
  plumbing from the base branch (no worktree, no checkout), signs it when `commit.gpgSign` is on,
  and pushes with `--no-verify` and a lease that only creates the branch. So a project hook that
  needs installed packages (a lefthook or husky pre-commit) no longer stops it. The pull request
  says the commit was made without the project's hooks. Its `--json` line has no `worktree` field.
  A project `reference-transaction` hook still runs on the fetch, the push and a take-back
  delete.
- **Task writes refuse up front when the project file cannot be used.** When `requires` asks
  for a newer kit, or the file is broken, every task write (create, update, done, note, take,
  delete, and `task import claude-mem`) refuses before anything changes, with the same message
  and its fix. Reads still answer and name the problem. `herdr plans`, `start --plan`, `start --task` and `adopt` check
  the same. Before, `task_create` of a plan could pass and the next `task_update` refuse,
  leaving half a plan.
- **The review record finds reviews run from a builder's worktree.** The hook skips only a
  reviewer standing in its own isolated worktree (the folder's id is the agent's own). A
  listed reviewer that records nothing writes why on one stderr line, which Claude Code keeps in
  its debug log only. `merge-check` also counts a review on a local branch whose tip holds the
  pull request's head, so a builder branch pushed under another name is covered; a
  squash-merged parent's review still is not. A covering review stands when a later candidate
  times out.
- **Security: generated marks come from the base only.** The review count and `workflow
  claims` leave out files marked `linguist-generated` only by the base commit's own
  `.gitattributes`. A mark in `.git/info/attributes`, in a `core.attributesFile` or in the
  system file no longer counts, so a local file cannot hide a big change from the review limit.
  What counts as binary comes from the base only too, so a local `* binary` cannot zero a big
  change's lines. `workflow claims` reads every file as text, so a local `binary` mark or an
  empty textconv cannot hide a claim either.

**What to run:** `cc-smart-dev-kit update`, then restart open Claude Code sessions: a session keeps
the task server it started with, which still refuses overlaps and has no write gate.

## 6.6.0

Closes the slop gaps a code-quality audit found still open after 6.5.2.

- **`cc-smart-dev-kit workflow claims`** lists the project's own "one home" claims (a comment or
  doc that says "the one place for X") and flags an added line in the diff that makes a second
  home for a symbol a claim names: a definition in a file while another file already defines
  it. An edit of the home itself, or the first definition of a new home, is no hit; nor are
  prose, comments, type-only imports and test files. The hits are never cut short. The lead
  runs it with the project's `Reuse signals` before each review round, and the reuse track
  treats a hit as a finding.
- **`cc-smart-dev-kit workflow slop`** keeps a running count, per repository on this machine, of
  the bypassed homes and drifted copies each plan's review confirmed (`record`), says when a slop
  audit is due (`status`), and clears what an audit covered (`audited`). An audit is due when a
  plan closes after the last audit and either the plans not yet audited reach a multiple of
  `slopAudit.everyPlans` (new workflow setting, default 5, `0` turns the cadence off) or that
  plan's review found one. `audited --area <path>` clears every recorded area at or under the
  path and says how many plans it cleared; with no `--area` it clears them all. The areas leave
  out merge files, build output, prose files, and the plan and research folders, and a clean plan
  that leaves no area is not counted. The build skill
  records each plan at its close and offers the audit on the areas the status lists.
- **The second similar copy is named, in the code.** Merely similar code still waits for a
  third copy before it is shared (an early helper grows a flag per caller), but its author now
  marks the second copy with a comment at its definition, `Similar to <path:symbol>; not shared
  yet: <why>`, and on its `Homes:` line. The marker travels with the repo, so a later plan finds
  it with `git grep`. Two markers naming the same copy, or a marker naming a copy that carries
  one itself, mean a third copy: a review finding, extract now. Reuse findings are titled
  "bypassed home: …" or "drifted copy: …", and those are the counts `slop record` takes.
- **Setting up the reuse guards.** A new code-structure reference (`references/guards.md`) shows
  how to set up the § 13 guards for the project's own stack, with baselines, CI and pre-push,
  including a front-door import rule generated from the feature folders. `doctor` and
  `project init` point a project with no `Reuse signals` at it. When the person declines the
  setup, a `## Reuse signals` heading saying `none: declined on <date>` goes into the review
  add-on, so neither the skills nor `doctor` ask again.
- **Fix: the default branch.** When `worktrees.base` is not set, the kit reads origin's default
  branch as a full ref, in one place for every reader (worktree cleanup, `herdr`, `workflow
  claims`, `project init`, `doctor`). Before, a local branch named `origin/<name>` made the
  short form read as `remotes/origin/<name>`, and a base that wrong went into commands and into
  the project file `project init` writes. An `origin/HEAD` left naming a branch origin no
  longer has (a renamed default after a prune) is now no base at all, as before.

## 6.5.2

- **The resume hint for a gone plan child is the whole command line, ready to fill in.** When
  a plan's Herdr child is gone, the keep-going note told the lead to run `herdr start --plan
  <slug>`, which the command refuses without `--model`, `--effort`, `--mode` and a brief. It now
  prints the whole line, the same one `herdr plans` prints (one home:
  `src/herdr/start-words.ts`), and the herdr and build skills name the same flags.
- **A plan's name in a printed command is one shell word.** The resume line and the
  `herdr plans --release`, `--reserve` and stacked-start hints quote a plan name the shell would
  split or misread (a space, a `#`).
- **The herdr mode list is called a list, not an order.** It ranked `dontAsk` above `auto`, but
  `dontAsk` denies what would prompt, so it is not broader. Nothing compares modes since 6.0.0;
  the list and the design page now say so.

## 6.5.1

- **A Herdr child starts in its lead's mode.** The herdr skill now tells a lead to pass its own
  permission mode to `herdr start`, so a lead in auto mode starts its children in auto mode.
  Before, its examples showed `--mode default`, so a child stopped for approvals its lead never
  needed. The skill still tells a lead never to pass a mode broader than its own, and to pass
  `default` when it cannot tell its own mode; no hook or command checks this since 6.0.0.

## 6.5.0

- **Plans price shared capacity.** A plan that adds shared capacity (a queue, a cap or pool, a
  per-event read, a notifying trigger, a lock or an append-only table) answers **Capacity** in
  plan-task § 3: what it costs per user and per event, and the scale where it bites. Review
  axis 2 holds that list once, and a plan with shared capacity and no Capacity answer is a
  finding there, so the plan's second read checks it.
- **Reviews name scale defects.** Review axis 2 gains the scale class: a cap or pool with no
  stated limit, interactive work in a bulk lane, no per-tenant fairness, a per-event fan-out of
  reads, a lock held across a read, no lock timeout, and a table that only grows. Two index
  defects join axis 2 for every change: an index on a column rewritten on every event that no
  frequent read needs, and a tenant-blind index on a multi-tenant table.
- **A guard learned in one feature reaches its siblings.** When a change adds a guard to a
  pattern its sibling features share, the review searches those siblings. A hit outside the plan
  goes where the tasks skill sends it (a held plan that owns the file, else you), never fixed in
  passing; the senior engineer reports every such hit.
- **performance-budget covers the backend.** A new section for a change that adds shared
  capacity: connection budget, queue caps, fan-out, herds after a restart, locks, growth and
  retention, scale tests with many small tenants, and a capacity page generated from the config
  that sets each limit where the project can. Its index rule now covers the columns a frequent
  read uses.
- **React checks a project can adopt.** react-best-practices lists a virtualizer or a row cap
  for long lists, render-count tests for frequent frames, split contexts for fast state and
  stable actions, and the `react-hooks/set-state-in-effect` lint. The compiler lint now sits in
  the `recommended` preset of `eslint-plugin-react-hooks` 7 or later (`configs.flat.recommended`
  in a flat config).

## 6.4.0

- **A builder proves its search for an existing home.** Code-structure § 3 searches three
  ways (the name and the words it shows, what it does, a distinctive body line), shared
  layers first. Every new export gets a `Homes:` line in the builder's report: what it
  searched, what it found, and why the new one is not a copy. The lead checks every line is
  there at hand-back. Outside a plan, the main session puts its own lines in the review's
  brief.
- **Reviews look for copies across the repo.** Searching for an existing home of what a change
  adds is now part of a review, not side work, and its read-only searches may pass the usual
  call limit. `review-split` takes three new optional arguments: `reuse: true` adds a `reuse`
  track that searches the repo for each new export, long literal, user-facing sentence and
  helper body, and spot-checks the `Homes:` lines; `signals` hands every track the project's
  own guard output; `homes` (with `reuse` only) carries Homes lines the plan's task notes do
  not hold. A plan's review rounds pass `reuse` and fresh `signals` for a code plan.
- **A sibling copy no longer refutes a duplicate.** Both refuter prompts, and the review axes,
  said that sibling files with the same shape refute a finding; for a copy, they are its
  evidence. Only a written project rule that allows the copy refutes it now. Other design
  findings are refuted by a written rule, a documented convention, or an established pattern
  their sibling files share. A drifted copy whose difference users can see ranks Warning.
- **Mechanical guards are the project's.** Code-structure § 13 names the guards that hold a
  "one home" rule (unused exports, a duplicate detector, a size ratchet, a front-door import
  lint), each a ratchet whose count may only go down. A project lists their commands under a
  `Reuse signals` heading in its review add-on (`.claude/cc-smart-dev-kit/review.md`); the lead
  runs them before each review round and hands the output to the reviewers, who never run
  them themselves.
- **Where shared code lives.** A new pure helper with no feature words in it (a page cut, a
  list or date formatter) goes to the shared layer the project names for its side on its
  first write. A merely similar composite of shared UI parts moves there when a third screen
  builds it. Folders are named for the concept they own, and test doubles live in the
  project's test-support home. § 11's slop list gains copies of a shared home, code only its
  tests call, a `v1` kept beside its `v2`, a "one home" claim with no guard, and one mode
  switched on in many places.
- **Plans name their homes.** plan-task's ninth question, **Homes**, lists the shared pieces a
  plan reuses, the homes it creates and the copies it deletes, checked against other open plans
  too. A new shared home is a contract. A phase that needs an export from a file outside the
  plan stops that step, and the lead asks you before the file joins the plan. The audit skill
  gains a slop preset: three one-class runs (duplication and bypassed homes, dead code and
  `v1` beside `v2`, oversized units), offered after a review finds a bypassed home.

## 6.3.0

- **No AI slop.** Code-structure § 11 names what makes code read as machine-written: comments
  that narrate, defensive code for what cannot happen, fallbacks that hide a bug, options and
  shims nobody asked for, dead code, debug output, churn, tests that prove nothing, placeholders
  and names that say nothing. A builder reads its whole diff against that list before it hands
  back, a review counts each item as a Craft finding, and one line in the core instructions
  points every session to it.
- **Planning for parallel work.** plan-task orders phases by what they really use from each
  other: a shared database, port or number sequence orders two phases only when both write the
  same state, and numbers can be reserved in the plan up front. A plan lists the exact files it
  writes, never folders it only reads, so fewer plans clash. When two or more ready plans share
  no file, the run-mode question recommends lead + children. A builder that a usage limit
  stopped is resumed with the others once the limit lifts, and that is not a fix round. In a
  worktree, the lead runs plain commands one at a time, as Claude Code's own check may refuse a
  compound line.
- **Four hooks no longer load the config checker on a normal run.** A hook now reads the
  project's `.claude/cc-smart-dev-kit.json` through a small cache of files it has already
  checked, kept in the kit's state folder. The checker, with its zod library, sits in its own
  bundle (`config-check.js`) and loads only when the file is new or changed. `agent-usage`,
  `session-name`, `verify-gate` and `job-route` hold no zod at all: their bundles went from
  266-355 KB to 30-160 KB. `after-merge` loads it only on a line that merges. A test fails any
  change that brings zod back into those hooks, and `doctor` warns when the cache folder cannot
  be written.
- **`merge-check` names the real reason when a pull request has no required checks, or no
  checks at all**, instead of saying it could not read them.
- **A test starts every built bundle once**, so a bundle that crashes as it loads cannot ship.
- **`after-merge` sees `GH_REPO` and `GH_HOST` in any case on a PowerShell line**, where
  variable names ignore case.
- **Plans block each other less.** A project can list folders in `plans.appendOnly` (set with
  `workflow set`, like `plans.mergeFiles`): inside them, two plans clash only when they list the
  same file, so two plans that each add a new migration can run at once. A plan can name the
  plan it is built on (`stacked_on`, or `--stacked-on` on the command line) and share that
  plan's files for as long as the parent holds them, until the parent's pull request merges.
  Only the lead of both plans can stack them, and the exemption counts only when git shows the
  stacked plan starts on its parent's work; anything git cannot prove keeps the two plans apart.
  `herdr start --plan` starts a stacked plan on its parent's branch by default.
  When a phase starts, a warning names the plan's files that the default branch changed after
  the brief was written. The task tools' own descriptions now state the rules the store
  enforces: the phase name, a phase without a parent, steps before a start, and the base.
- **herdr for a lead with several children.** `herdr start --base <ref>` starts a child from
  a branch you name, such as the plan branch, instead of the default branch. `--brief-file
  <path>` on `start` and `send` reads the brief from a file, so quotes and `$` never pass through
  a shell. Only one `herdr wait` runs per lead; a second one names the live one. When the wait
  times out, it lists each child as still working, blocked waiting for you, or gone, instead of
  calling every one blocked. `herdr list` has a new `base` column.
- **Builders lose nothing when a usage limit stops them.** After each step a builder commits
  and leaves a `Progress:` note, and the lead reads it when it resumes the builder. A builder
  never hands back while its own background job runs, and `subagent-background` blocks a stop
  once per background task, so the same final report no longer repeats. A hand-back carries
  the builder's own work only.
- **Heavy-command routing works in auto mode.** Auto mode's check on Anthropic's side gives no
  verdict for a call a hook changed, and it cancels every other call in the same response. In
  auto mode, `job-route` no longer rewrites a heavy command; it refuses it and names the exact
  `cc-smart-dev-kit job run` line to send, with the longest timeout. Other modes keep the rewrite.
- **The merge note knows a lead keeps its worktree.** After a merge, a session that still
  holds another open plan reads "Kept: plan <slug> is still open here." instead of being told
  to clear the worktree.
- **The portal shows the 7-day usage window** beside the 5-hour one, each with its percent, a
  bar and its reset time; a reset a day or more away reads in days and hours ("3 d 21 h"). One
  shared bar now draws every bar in the portal, with a track you can see in both themes, and
  the bars of a list line up whatever the width of their numbers.
- **A Settings row for the lead-model hint.** The switch rows are built from the switch list, so
  a new switch cannot be left off the page.
- **The mobile sidebar works under the portal's strict page policy.** It no longer breaks the
  policy when it opens, the page behind it does not scroll, one Escape closes it, focus goes
  back to the menu button without scrolling the page, and its targets are 44px. It closes on any link tap and when the
  window grows to desktop width. A guard test fails anything that would inject a style again,
  and `scripts/portal-preview.ts` serves the built portal under the real policy for checks.
- **Next.js 16.4.6 for the portal's build.** 16.4.2 had seven moderate advisories, so Next.js
  refused the first build of each session. The portal ships as static files, so none of them
  reached a machine.
- **The task store's repair applies the store's own rules.** It loads each project's tasks once
  and skips a hold the store would refuse, recording why. `doctor` names any task an older
  repair left blocked by a task above it, with the command that removes the block.
- **herdr and sessions find worktrees wherever a project's hook puts them.** They read git's own
  list, herdr binds only a worktree whose name matches its launch exactly and keeps its own
  launch record, and a resume of a worktree outside `.claude/worktrees` starts in its folder.
- **`verify-gate` on Windows compares folders on disk.** A path written with an 8.3 short name
  (`RUNNER~1`) was read as outside the checkout, so the reminder to run the fast check never
  came.
- **The shadcn guide names `npx shadcn@<pin>` for npm projects again.**

**What to run:** `cc-smart-dev-kit update`.

## 6.2.0

- **Each hook loads only itself.** Every hook bundle carried every other hook (583 KB each),
  because each one loaded the full hook list. Now each loads only its own: 266 to 357 KB, and a
  hook run takes about 22 ms instead of about 32 ms. A test builds every hook, runs it the way
  Claude Code does, checks that it names itself, and fails a bundle that grows past its budget.
  What is left is mostly the settings checker (zod), a follow-up of its own.
- **The status line reads your session's folder.** The usage alerts followed the folder the
  status line process started in, not the one the session works in. Both the alerts and the
  task rows now read the session's folder, and git runs half as often per update. A session in a
  worktree now shows that worktree's alert setting.
- **`task list --branch` sees what the release gates see.** It read your local `main`, which can
  be far behind, so it listed tasks as unmerged that were already on `origin/main`. A bare base
  name now reads `origin/<base>`; with no `origin` remote it reads the local branch and says so.
  A local base ahead of `origin/<base>` still reads origin's, as the gates do, and says so. A base
  origin does not have here reads the local branch and tells you to run `git fetch origin`. A
  commit id, a tag or `HEAD` is read as written, and a branch is read by its full name. A name
  that means more than one ref (a tag beside a branch, a stray local branch `origin/main` beside
  origin's) is refused with the refs named, as the gates do.
- **A task's history prints a claim as text.** A take-over wrote `[object Object]`; it now writes
  the session id, and older rows print the same way.
- **Finished worktrees stop staying for `next-env.d.ts`.** Next.js writes that file in every
  checkout; it now counts as rebuildable, so it no longer keeps a finished worktree.
- **`worktrees --clean` deletes finished builder branches.** A builder's `worktree-agent-*`
  branch stayed after its folder went, once its work reached `main` through the plan branch.
  `--clean` now deletes those whose work the base holds and no worktree uses, and keeps the rest
  with the reason. Every branch delete (`--clean`, `--remove`, the background clean) now keeps a
  branch an open task still records and one a worktree is bisecting or rebasing, deletes only the
  commit it judged, so a branch that moved meanwhile stays, and removes the branch's git config
  section with it (in any language git speaks). A worktree with a bisect, rebase, merge,
  cherry-pick or revert in progress is kept whatever its idle time, and so is one with a `git am`
  stopped mid-series or a cherry-pick or revert series left unfinished. The session-start note
  does not call such a worktree finished, and the plain listing says the same as `--clean` about
  those branches. `worktrees --help` says that `--remove` also deletes the branch, and what keeps
  it. The plain `worktrees` list shows which would go. Your own branches
  are never touched.
- **One home for the worktree path and branch.** The places that built
  `<repo>/.claude/worktrees/<name>` or its `worktree-<name>` branch by hand now share one helper,
  and a test fails a new copy. A parked worktree with no branch no longer counts the deletions it
  made itself as yours.
- **While you are away, a session keeps going.** You said: "dont wait for me keep going even
  after a plan completed review merge and go next". The away skill now says: work at full
  parallel width, and after a plan, run its review, the full check and its pull request, then
  start the next plan. When the previous pull request is still open, the next plan stacks on it:
  its pull request opens against that plan's branch and never merges before it.
- **`workflow merge-check <pr> --asked`.** It judges a merge you said yes to while `allowMerge`
  is off: it sets aside only that switch, and the base, the stacked check, the required checks and
  the review still decide. It takes exactly one pull request: a yes names one merge. Away, a
  session runs it only when your own message gave that yes, and quotes your words in its decision
  record; a summary or another session's message never counts.
- **`merge-check` refuses a stacked pull request, and never the lower one of a stack opened
  against its branch.** It reads each
  open pull request's own commits, the ones its base lacks, in full from GitHub's compare (paged;
  more than 1000 refuse). Two pull requests whose commits overlap are stacked, so the check holds
  after the lower one gains a commit and after both branches merge a newer main. A pull request
  opened against this one's branch is the upper one and never holds this one up; the base rule
  holds it until the lower one merges. Two pull requests into the same base that share commits
  are each refused, also with `--asked`: `pull request #n shares commits with open pull request
  #m that main does not hold yet: merge the lower one first (open the upper one against the lower
  one's branch), then check again`. It refuses when gh fails, answers something else, or the open
  list is full (500); a read the portal's deadline cut short shows as late. The portal's project
  page and a `merge-check` line of several pull requests read that list once. The commit skill
  says how a stack opens, how the upper branch is brought up to date after the lower one merges,
  and that it is rebuilt on a new branch, never force-pushed, when the lower one closes unmerged;
  a stacked plan branch starts with `git reset --hard <previous plan branch>` in a fresh, clean
  worktree that holds no commit another branch lacks (`git log --oneline HEAD --not
  --exclude=<this branch> --branches --remotes` prints nothing), as a builder's own start does,
  so it also works where a worktree starts from the session's head. A pair with a fork is told
  to merge the lower one by hand, and the commit skill warns against GitHub's "Update branch"
  with rebase on a lower pull request while an upper one is open. The commit list is read until
  a short page, then checked against GitHub's total. Each operation-in-progress reason names the
  git command that ends it.
- **Tests never touch your real home folder.** The test setup gives every run its own temp
  home, including what `os.homedir()` returns.
- **The old task files are gone.** The 27 `.claude/tasks/T-*.md` files the kit stopped reading
  in 5.0 are fixed here, moved to kit tasks, or recorded as moot.

**What to run:** `cc-smart-dev-kit update`.

## 6.1.1

- **The queue's pipe hint comes only when there is a pipe.** A waiting heavy job printed "A
  pipe (| tail) hides this job's exit status" even for `bun test 2>&1`, with no pipe. Now the
  hint comes only when the job's output goes into a pipe; on Windows it still always comes.
- **Builders write deletes Claude Code does not stop for.** Claude Code asks the person before
  `rm -rf $DIR/$name`, because an empty variable would widen the delete. The builder agent now
  writes `rm -rf "${DIR:?}/${name:?}"` or a literal path, so a running build no longer waits on
  that question.

**What to run:** `cc-smart-dev-kit update`.

## 6.1.0

- **The settings say what they do.** `autoCommit`, `autoPush` and `autoMerge` are now
  `allowCommit`, `allowPush` and `allowMerge`: each says whether Claude may do that step without
  asking you. You said: "auto merge and auto push was meaning Claude should not ask for a prompt
  ... rename it like allow merge allow push allow commit". The old names still work in your own
  file, in a project's file and in `workflow set`, `unset` and `propose`. When a file holds both,
  the new one wins. `cc-smart-dev-kit workflow set allowPush true` writes the new name, and
  `cc-smart-dev-kit doctor` names a file's old key (never as a failure). `project init --workflow
  autoCommit=true` takes an old name too, and writes the new one. A project file that sets
  a new name gets `requires` `>=6.1`, so an older plugin is told to update. `openPr` keeps its
  name: it is a choice of three, not a yes.
- **A phase closes only with its work in the plan branch.** `task_done` on a phase refuses when
  its recorded branch has no commit past its base, or is not in the plan branch. The build skill
  merges the commit the builder's report names, then checks it with `git merge-base
  --is-ancestor <commit> <plan branch>` before it closes the phase. A hand-back once merged the
  worktree's default branch while the builder had committed on another, and the phase closed with
  none of its work. The check needs the phase's `base` to be the commit the builder started from,
  and a branch merged by a squash is refused (its commits are not in the plan branch).
- **A package script that runs heavy work is queued whole.** `bun run tsc` with the body
  `SKIP_ENV_VALIDATION=1 next typegen && tsc --noEmit` skipped the job queue with no message,
  because a command that is not heavy work came first in the body. A `<pm> run <script>` that is the line's own
  command, and whose body runs heavy work, now waits for a slot. A script that calls itself or
  nests too deep, a body that never ends (a watch run, a runner), a body that runs in the
  background and a body that runs as another user still run raw. **New refusal:** a line such as
  `bun run check; git status`, where the script's body mixes heavy work with another command and
  you add one more command beside it, ran raw in 6.0.0 and is now refused as a mixed line; run
  the script on its own line. A line you mixed yourself (`bun run tsc && rm x`) is still refused.

**What to run:** `cc-smart-dev-kit update`, then restart open Claude Code sessions: a session
keeps the plugin it started with. Your files keep working; move a value with
`cc-smart-dev-kit workflow set allowPush true` when you like. A file that has the new names is
refused by a plugin older than 6.1.0, which is why a project file's `requires` rises with them;
your own `workflow.json` has no `requires`, so update every machine that shares it.

## 6.0.0

- **Full auto: the kit has one guard.** You said: "I am tired ... I have to wait all time in
  front of the Claude session. Please drop all the guards ... the only guard our kit will support
  will be the heavy-job guard. Everything will run in full auto." Six guard hooks are removed, with
  their bundles and tests: `git-guard` (pushes, force-pushes, resets, cleans, discards),
  `merge-guard` (merges, pull-request opens and readies, raw issue writes), `deploy-guard`,
  `main-folder-guard`, `agent-guard` (the model and effort rules, the Fable gate and the UI
  rule's deny) and `session-escape-guard`. `user-away` no longer turns another hook's question
  into a parked action, and no longer answers Claude Code's own permission dialog: a hook
  never approves for you. `acorn`, the JavaScript parser only `agent-guard` used, leaves the
  bundles.
- **`job-route` never asks.** Its launch judge is gone: a raw `claude --bg`, `claude -p` on
  `fable` or `opus` at `max`, `workflow propose` and the Herdr rules (raw `hc` writes, machine
  rules, the mode cap) no longer ask or refuse. The `herdr` command keeps its own refusals, such
  as `--asked` for Fable. `job-route`'s `hooks.json` entry is `--missing=quiet` with no
  `onFailure`: with no bun, the line runs as written.
- **What stays.** `job-route`, the heavy-job queue: heavy commands still wait for a slot, a
  heavy line mixed with other commands is still refused, and so is a heavy PowerShell line. Every hook that never asks you stays:
  session names, the task list at a start, the cost record, the update check, the tier note, the
  review record, the after-merge and leftovers notes, and the stops that keep work going
  (`keep-going`, `verify-gate`, `builder-finish`, `subagent-background`).
- **What Claude does instead.** The rules are instructions now. A merge follows `autoMerge`: Claude
  merges its own pull request into its base, the main branch included, once CI is green (it
  waits with `gh pr checks --watch` and never uses `--auto`), the review of its head
  commit is recorded and the fixes after the review are within `fixesAfterReview` (over them, it
  says so in the pull request); `workflow merge-check` prints that judgment and allows a merge into the integration base or
  `main`; `workflow set autoMerge` (and the other review-gate keys) now works inside a session. Claude runs the
  deploy gates (`task release <env> --before` and `--after`) itself. It asks you before a `fable`
  or `opus`-at-`max` launch when you are available, and uses `opus` at `xhigh` when you are
  away. Every planning agent (a plan's second read, the edge-case hunter on a plan, a `Plan`
  agent) runs on `opus` at `xhigh`, and on Fable only with your yes.
- **When you are away.** Claude takes the recommended option, records it with
  `cc-smart-dev-kit user park --kind decision` (the text starts `Decision:`), and keeps going; it never enters plan mode while you are away, and a
  deploy to production waits for you (staging may run).
  Nothing is parked to wait for an answer. When you are available, it asks its real questions
  as before. `/cc-smart-dev-kit:user-available` shows the decisions when you are back.
- **The trade-off, at your ruling.** With no guard, nothing now stops a mistaken
  `git reset --hard` in the main checkout, a force-push to `main`, an unreviewed merge, a deploy,
  a write in the main folder, or a Fable or Opus-at-`max` launch. Claude Code's own permission
  mode and your own `deny` rules are the stops left. A project's `ownHooks` that names a removed
  hook still parses and silences nothing; `doctor` says the name can go. A project's own asking
  hooks and `permissions.ask` lists are its own: remove them in that project.
- **A flaky test is fixed:** the nested job signal test no longer fails under load.
- **Fields that enforce nothing now.** `protectedBranches`, `worktrees.guardMainFolder` and
  `tasks.deployCommands` stay in the schema so older files load; no hook reads them.
- **A major version.** 6.0.0 removes features, so the background self-update holds it until you
  run `cc-smart-dev-kit update` yourself: nothing changes on a machine before that.
- **What to run:** `cc-smart-dev-kit update`, then restart open Claude Code sessions (a session
  keeps the old guards until it restarts).

## 5.6.1

- **A builder undoing its own edits no longer asks you.** The git guard asks before a command
  that throws away uncommitted changes (`git checkout -- <file>`, `git restore`, `reset --hard`,
  `clean -f`). It now stays silent when a subagent runs one on a plain line inside its own
  worktree, and only when it can prove that: the subagent's id, a real linked worktree with no
  link on its path, every folder the line can reach (`cd` and `git -C` included) a real folder
  inside it, and git's own answer that the folder belongs to it. A plain line holds only
  listed `git` commands with nothing in front of them and plain `cd`s to one folder: no other
  program at all, since an `rm`, `mv` or `cp` can rebuild the worktree after the guard checked
  it. So a builder puts a discard on a line of its own: `git checkout -- a; rm c` asks, while
  `rm c` alone never asks. The words of a plain line matter too: no `$` or backtick anywhere
  (an expansion such as `${CDPATH:=…}` can move a later `cd`), only everyday git subcommands
  (`git config` and `git worktree` ask), no word that names a `.git` path or holds a brace
  pair (`.gi{t,}` becomes `.git`), no redirection to a file (`2>&1` is fine), no pipe or
  background job, and no `cd` or `-C` after a git command that may write files.
  A hook's question cannot be remembered, so each builder discard used to interrupt you.
- **Everything else still asks:** any discard by the main session, in another agent's worktree
  or your own checkout, and any line that is not plain or may point git elsewhere: a `cd` or a
  `-C` that leaves the worktree or that the guard cannot follow (`..`, `~`, `$VAR`), an inner
  command (`bash -c "…"`, `eval`), a wrapper (`env -C`, `sudo`), any other program, a variable
  set on the line, `--work-tree`, `--git-dir`, and `GIT_DIR` and the other `GIT_*` variables
  that move git, in any case. A push, `branch -D`, the stash and `worktree remove -f` are judged
  in a builder's own worktree exactly as anywhere else.
- **PowerShell's `Start-Process` is read whole.** Its `-ArgumentList`, and its positional
  argument list, is one array however the commas are spaced (`'-c', 'x'`, `'-c' , 'x'`,
  `@('-c', 'x')`), and an `@( … )` array runs its commands. Before, only the word right after
  `-ArgumentList` was read, so `Start-Process pwsh -ArgumentList '-c', 'git reset --hard'`
  asked nothing in any session. Every guard that reads a shell line gains.
- **Bash 5.3's `${ cmd; }` is read as commands.** Bash 5.3 runs the commands inside
  `${ … }` (a space, tab, line break or `|` after `${`) in the current shell, bare and inside
  double quotes. The shell reader took it for a variable, so `echo ${ git reset --hard; }` and
  `echo "${ git push --force; }"` asked nothing, the main session included. Now every guard
  sees those commands, and a `cd` inside moves the commands after it. `${x}` and `${x:-y}` are
  still variables.
- **A git named at run time beside a dangerous word now asks, in any session.** Before,
  `$GIT reset --hard`, `$(echo git) reset --hard`, `git $(echo push) --force origin main`,
  `git push$X --force origin main` and `gi${T} reset --hard` asked nothing. A word now counts
  as worked out at run time when it holds a `$` or a backtick anywhere, not only at its start.
  A program worked out at run time asks when its words would make git ask, or when another of
  its words is worked out too beside a danger option (`$GIT $SUB --hard`). A git subcommand
  worked out at run time always asks. A git command the guard judges asks when one of its
  words is worked out at run time (`git reset $MODE`, `git checkout -$F main`), since the shell
  may fill in the dangerous option. So some ordinary lines now ask: `git push origin $BRANCH`,
  `git checkout $BRANCH`, `git branch $NAME`, `git stash push -m "$MSG"`, and `$DOTNET restore`
  (its `restore` may be git's). `$EDITOR file`, `$EDITOR $FILE`, `git commit -m "$MSG"`,
  `git add $FILE` and `git log $(cat range)` stay silent.
- **A plan may get one final review after round 2.** A plan's review is still two rounds. When
  round 2's fixes are bigger than the project's `fixesAfterReview` allowance, or touch a guard,
  security, money, permissions or data, one senior engineer on `opus` at `xhigh` reads only
  those fixes, with round 2's whole report. Its findings are fixed, and nothing reviews those
  fixes. Small, safe round 2 fixes get no final review. The pull request says which reviews
  ran (the build skill § 6).

**What to run:** restart open Claude Code sessions. A session that was open before the update
keeps the old guard.

## 5.6.0

- **Queued heavy jobs can no longer hang the machine (Linux).** Every queued job now runs in
  one systemd user slice, `cc_smart_dev_kit_jobs.slice`, with limits set before each launch:
  - **CPU:** at most 90% of the machine's CPUs by default, and the jobs yield to your apps
    when the CPU is busy (a CPU weight of 20 against your apps' 100). An idle machine still
    runs a job at full speed, up to the cap.
  - **Memory:** at most 90% of the machine's memory by default, with no swap. A job past the
    cap is stopped with exit code 137 and a line that says so.
  - **A watchdog:** systemd-oomd stops a job that stalls the machine on memory below the
    cap, and the job is marked as the first thing to stop if the machine runs out.
  - The caps hold for all heavy jobs together, also with `job set max` above 1.
- **Two new settings:** `cc-smart-dev-kit job set cpu <n>` and `job set memory <n>` (10 to
  100, default 90) write `cpuPercent` and `memoryPercent` into the jobs' settings file. A
  lower limit reaches the slice at the next launch.
- **`job status`, the portal's Machine page and `doctor` show the limits**, and say so when
  they cannot apply on this machine.
- **The job's command is never changed.** Each job's words reach it exactly as written,
  `$` included, on every systemd version.
- **Where the limits cannot apply, the job runs as before.** That means macOS, Windows, a
  container, a machine without a systemd user manager and cgroup v2, or a bad setting. On
  Linux, one line names the reason. A command not on the PATH runs plain, so it still exits
  127.
- Details, and the limits' own limits: [docs/jobs.md](docs/jobs.md) § CPU and memory limits.
- **A plan gets one strict review, in two rounds, not a review per phase.**
  - **The order:** round 1 → fixes → round 2 → fixes → the full check → the pull request.
  - **The workflow:** each round is the `review-split` workflow, and every agent in it is the senior engineer on `opus` at `xhigh`.
  - **The plan goes in:** every reviewer reads the plan, and a spec track checks each decision, edge case and step's done-check against the code.
  - **Round 2:** it gets round 1's report, and marks each finding fixed, not fixed or made worse.
  - **Two strict rules:** reviewers prove claims by running things where they can, and a track with no findings must say what it read and ran.
  - **At a phase's hand-back:** the lead checks the builder's report against its branch, with no reviewer.
  - **Fewer review runs:** this cuts the review runs per plan from one per phase plus re-reviews to two (`/cc-smart-dev-kit:build` § 6).
- **`review-split` takes `spec`** (the plan file) **and `prior`** (round 1's whole report). A call with neither still runs the same tracks and refuters, but every call now also gets the two strict rules (prove a claim by running it; a track with no findings says what it read and ran), and the report says when a track gave no evidence of coverage.
- **A review that ran its own background commands is recorded again.** A reviewer's notice that its own background `bun test` ended counted as a message without the review marker. So the merge guard saw no review: the final review of job limits was never recorded. The record now treats the reviewer's own notices as harmless:
  - **What counts:** a notice that its own background command ended, or that its own Monitor's stream ended. The notice must name a call the reviewer itself made earlier in the same transcript. A Monitor that expires, fails or ends with no output still counts as a message.
  - **Workflow reviews are recorded at all now.** Claude Code indents every line of a workflow agent's brief, so the record never found `Mode: review` at the start of a line, and no workflow review had ever been recorded. The record now reads the brief through that wrapper, in both forms Claude Code writes.
  - **A skill the reviewer loads itself** no longer counts as a message.
  - **What still counts as a message:** any other notice.
  - **NUL-padded lines:** a transcript line padded with NUL characters (seen in real transcripts) is read now, not counted as an empty message.
- **The review and audit workflows' agents can no longer write tasks.** They can't create, change or close tasks.
- **Each review round's tracks follow the plan's areas.** There is one track per area the plan changes, each with its own risks, plus one track across all layers and the spec track. Every reviewer checks outside facts in current docs (web search or Tavily) and cites the source.
- **Each round's report is kept.** It is saved on the plan task, and round 2 gets round 1's whole report. Its headline says when round 1 findings are still open.

**What to run:** nothing. Run `cc-smart-dev-kit doctor` to see the limits on this machine.

## 5.5.0

- **Heavy work in a mixed Bash line no longer runs past the queue.** With the job route on,
  a line that ran a heavy command beside anything else (`bun run check; echo "exit $?"`,
  `bun test; git status`, a `{ …; bun run check; … } > log` block) used to run raw and silent:
  no slot, no warning, and several at once could run a machine out of memory. Now:
  - **Harmless glue rides in the queued line.** A line whose other commands are only glue is
    queued whole. Glue is a `cd`, an assignment, `echo`, `printf`, `true`, `false`, `:`, `pwd`,
    `test`/`[`, `set` turning on only `-e`, `-u` or `pipefail` (or turning any option off),
    `exit`/`return` with a plain code, `export NAME=value`, a reader on a pipe (`tail`, `head`,
    `grep`, `wc` and the like, reading only the pipe), and a group's own redirections. Each has
    argument checks, so nothing can run code out of sight of your permission rules.
  - **Any other mix with heavy work is refused**, with the fix: run the heavy command on its own
    line. Queued whole, the other command would hide from your `Bash(...)` and `Read(...)` rules;
    run raw, the heavy part would skip the queue. The refusal also names the one-line way to
    keep an exit code: `{ cmd; echo "exit $?"; } 2>&1 | tail -20`.
  - **Not refused:** a light run (named files, print-only), a watch run, a line that queues
    itself, a package script whose own body mixes heavy work with other commands (it runs raw
    inside, as before), PowerShell, and lines outside git or with the route off.
- **Heavy work as another user runs raw.** `sudo bun test`, `doas …`, `su -c '…'` and `pkexec`
  were queued, so the rewritten line started with the queue's command and your `sudo` rules
  never saw it. Now such a line runs as written, without a slot.
- **The shell reader sees `>& file` as a write** (`echo x >& out.txt`). Every guard reads lines
  through it, and each is now as strict or stricter.
- **Claude's instructions teach the rule:** run a heavy command alone on its Bash line. The
  refusal names what may join it.

**What to run:** nothing. Projects with `jobs.route` on get the new behaviour with the update.

## 5.4.0

- **A finding outside the plan is acted on at once, and a child works on it.** When Claude meets a
  finding outside its plan (its own, or one in a builder's report or a review): inside a plan that
  is held, it becomes a task in that plan and nobody asks you (a finished held plan offers two
  options: a late fix on its pull request, or file it for after the merge). Outside every plan,
  Claude asks you right then. A yes files the issue and hands the finding to a **follow-up child**:
  one linked session for each lead and repository that collects all of its follow-ups into one pull
  request at a time. Before, a filed issue sat until you built it yourself.
- **`herdr start --followup [--issue <n>]…`** starts that child. `--issue` repeats and names the
  filed issues it fixes.
  - **It refuses** with `--plan`, `--task`, `--independent` or `--on`; inside any child (a child
    lists its findings in `herdr report` and never starts one); and when the default branch is only
    a guess.
  - **It refuses** while this lead's follow-up child for the repository lives. The error names it:
    use `herdr send`. A child of a lead that ended is taken over with `herdr adopt`.
  - **It refuses** when an ended child left commits that reached no merged pull request. The error
    names its worktree and branch.
  - **At its start,** the child resets onto the base once, only when it holds no commits of its own
    and the tree is clean.
  - **Before each finding,** it reads its pull request's state. A merged pull request means a new
    branch from the base, with unmerged commits moved onto it by a cherry-pick (a conflict is
    aborted and reported). A closed one is never reset.
  - **For each finding,** it never edits a file a held plan holds, makes one commit and reports.
    The commit names the issue as `(#n)`. Beyond a small fix it then gets one second opinion on
    that commit from `senior-engineer` (and the `edge-case-hunter` on a risky change); its brief
    allows no other agent, and work that needs a kit plan goes back to the lead. It never pushes
    before `ship`.
  - **At the ship point,** the lead sends `ship`. Only then does the child run the full check, mark
    each fixed issue (`issue mark-fixed`, with each commit's id on the shipping branch), push once,
    and open or update its pull request, taking the `Fixes` lines from `issue fixed` (on an open
    pull request it replaces them).
  - **It stops** only on `herdr stop`. The start's check for an ended child's unmerged work cannot
    see a child that Herdr no longer lists, so ship before you stop it.
  - **Elsewhere:** the label is `kit.followup`, and `herdr list` shows "follow-up" (the column is
    now "task, plan or follow-up"). `herdr wait --all` leaves it out, since it never settles. A
    linked child's brief gains one line: its own findings go in `herdr report`; it never asks,
    files or starts. A follow-up child never hands out, reserves or adopts plans. The Bash judge shows a
    start line's parse error alone when `--model`, `--effort` and `--mode` are all given. The
    held-plan list in the child's brief is a snapshot taken at the start, and this flow is not yet
    proved live.
- **Fewer pull requests and CI runs.** Before a pull request opens, a push costs no CI only where
  CI runs on pull requests and the default branch alone: read your CI triggers before you treat it
  as free. The skills now keep each plan's archive in the plan's own pull request (its commit comes
  before the final review, and the plan task closes in the turn the pull request opens), put
  the small fixes of one session on one branch with one pull request at one ship point (the end of
  the turn that finishes your request, or when you say ship now), and, once a pull request is open,
  collect a round of fixes, run the full check locally and push once. One pull request per plan, and
  a deploy run's small pull request of task closes, stay. These are instructions in the skills, not
  a hook.

**What to run:** `cc-smart-dev-kit update`, then start new sessions. Nothing per project.

## 5.3.0

- **A guard asks before a deploy that open tasks hold.** A new hook, `deploy-guard`, asks you
  (it never allows or denies) before Claude runs one of the commands a project lists in the new
  field `tasks.deployCommands`, while that environment has an open blocking problem in its deploy
  tasks: a blocking `before` task is open, a task file is broken or its id repeats, or prod's
  staging twin is open. The question names each problem. It reads the task files alone, with no
  git, and it is silent with no list. A command spelled another way is not seen, and an option's
  value counts, so list each spelling (`fly deploy --app web` is not `fly deploy --app=web`). It is
  a rail against a skipped step, not a lock. While you are away, the question becomes a
  denial and the call is parked on your list.
- **`task release <env> --check`.** It judges the task files alone, with the rules of `--before`
  that need no git, so a CI job can run it: exit 0 passes, 1 refuses, 2 is a usage error. It
  works in a detached or shallow checkout. The README's new section, Deploy tasks in CI, shows
  the GitHub Actions step that runs the kit's `plugin/dist/cli.js` at a pinned commit with Bun,
  and what the guard and the step do not see.
- **`project init` asks for the deploy commands.** It now asks 9 questions: the last asks, for
  each environment, a command that deploys to it, until you press Enter on an empty answer.
  `--deploy-command <env>=<command>` does the same without a terminal (`<env>=` clears the list).
  The managed block in your deploy skill gains one line about the guard, so `doctor` flags every
  existing block as out of date until `project init` runs. `doctor` also shows a `·` line when a
  project has a deploy skill but no `tasks.deployCommands`.
- A project that sets `tasks.deployCommands`, or lists `deploy-guard` in `ownHooks`, needs
  `requires: ">=5.3"`; `project init` writes it.

**What to run:**
1. `cc-smart-dev-kit update`, then start new sessions.
2. In each project that deploys: `cc-smart-dev-kit project init`. It asks for the deploy commands and
   refreshes the block in the deploy skill, which `doctor` flags until then. Commit the files.
   Teammates update together: an older kit's `project init` writes its own block text back.
3. For a project that deploys from CI: add the step from the README's Deploy tasks in CI before
   the deploy step.

## 5.2.0

- **Queued plans can run in parallel, in child sessions.** With two or more plans laid, the
  new personal setting `plans.runMode` says how they run:
  - `solo`: one session builds them one after another, as before;
  - `lead-children`: this session builds one plan and hands each other ready plan to a
    linked Herdr session;
  - `coordinator`: this session builds nothing and every ready plan goes to a child.

  With `ask`, the default, Claude asks once and states what each mode costs. Each child is a
  full session, so it spends more of your usage. Set it with
  `cc-smart-dev-kit workflow set plans.runMode <mode>`; it is yours alone, never the project's.
- **Two plans that share a file do not run at once** (on 5.2.0 sessions; an older session
  checks nothing).
  - Each plan keeps its file list in the task store (`task_update` with `files`, or
    `task add --plan ... --path`). A path is a file, or a folder ending in `/`. `*` and `?`
    are refused; `[` and `]` are plain characters, so `app/[id]/page.tsx` can be listed.
  - A plan is held while it is reserved or while any task in it runs. A reserved plan stays
    held until its pull request merges or closes; a plan nobody reserved stops being held once
    it is done or parked.
  - The store reserves a plan in one step before its child starts. It refuses a plan whose
    files overlap a held plan, and refuses while a held plan has neither a file list nor a
    branch diff (set its files, or finish, park or drop it).
  - Any start that puts a plan in flight is checked the same way, by any session: a phase or
    step start, a task created already running, a running task moved into the plan, a resume
    after a park, a reopen. So two solo sessions whose plans share a file are refused too,
    even with no child. A plan with no file list cannot start while a reserved plan is held.
  - Each refusal names the way out for each plan in the way: for a reserved plan, wait for its
    pull request; for a running one, wait until it is done or parked, or take, park or drop it
    if its session is gone.
  - A plan also waits until the pull request of every plan it is blocked by has merged.
  - Paths every plan touches and each merge settles (a version file, a changelog, build
    output) go in the project's `plans.mergeFiles`. The kit reads it only as committed on the
    base branch, and a project that sets it needs `"requires": ">=5.2"`.
- **New `herdr` commands for plans.**
  - `herdr start --plan <slug>` hands a plan to a child, which takes it, builds it with
    `/cc-smart-dev-kit:build`, opens its own pull request and reports. The same command
    resumes a child that is gone, in its own worktree.
  - `herdr plans` shows where each plan stands and frees a finished plan's files once its pull
    request merged or closed. `--wait` waits for the next change.
  - `herdr plans --reserve <slug>` reserves the lead's own plan in lead + children mode.
  - `herdr plans --release <slug>` frees a finished plan that nothing can prove merged. It is
    your call, so the Bash judge asks you first.
  - `herdr adopt` also moves a dead lead's plans to the new lead.
  - `--plan` refuses a project whose default branch is only a guess. The fix is
    `git remote set-head origin --auto`.
- **The status line and the Stop guard know the children.** A `Plans · …` row counts the plans
  with a child, a child gone, a pull request to merge, waiting, needing files, and ready.
  keep-going names the next step: wait for the children, wait for a merge, or resume a gone
  child.
- **The task store moves to schema 6:** a table of plan files and the reservation columns.
  An older kit still reads the store.

**What to run:** after the update, restart every Claude Code session that was open before it.
An older session does not know `files` and ignores reservations. A plan already running when
5.2.0 arrives has no file list, so hand-outs and `--reserve` are refused until you set its
files (`task_update` with `files`) or it is done or parked. Going back to an older kit:
first run `cc-smart-dev-kit workflow unset plans.runMode`, and unset `plans.mergeFiles` with
`--project` and commit that. An older kit refuses a workflow key it does not know.

## 5.1.0

- **The heavy-job queue sees more of the real heavy work.** `bun test` joins `vitest` and `jest`
  (and `bun test --coverage` is a coverage run). A run on named files skips the queue: `bun test`
  only for a path that starts with `./` or `/`, because Bun reads a bare word as a filter, and now
  `tsc --noEmit src/a.ts` too. `tsc -p`, `--build` and a run with no file still wait. Each tool
  has its own option table, so `-w` (watch for vitest, workers for jest) is read right.
  `playwright test` is a new `e2e` kind, and a watch run (`--watch`, `--ui`) is never queued.
  `cross-env` is read through. A line is called light only when every command in it is understood.
- **Package scripts are read by what they run.** `bun run typecheck` with the body `tsc --noEmit`
  is a type check, and `"$npm_execpath" test` is the runner's test. The `package.json` is the
  nearest one up to the repo root, `pre` and `post` scripts are read where the runner runs them,
  and each runner's `--` rule is the one it really has. A script that mixes a linter and `tsc` is
  not queued; a `{ "script": "check" }` kind queues it whole.
- **The route leaves light lines alone**, and a call with no timeout gets the Bash tool's longest.
  A waiting line says your place in line, and says to run a long wait in the background.
  `job status` lists the waiting jobs in the order the queue serves them.
- **Git hooks wait for a slot.** A `git commit`, `git merge` or `git push` whose own hook is heavy
  (husky, a plain `pre-commit` or `pre-push`) waits like any other heavy run. Setup writes a
  folder of hook scripts, `~/.local/share/cc-smart-dev-kit/git-hooks/`; when the route is on, the
  git line gets three `GIT_CONFIG_*` words in front of it, so your own `git` deny and ask rules
  still match. An allow rule does not match past them: with `Bash(git push *)` only in your
  allow list, a prefixed push asks you again. Your hook runs inside `job run --hook`. `--no-verify`, your own `core.hooksPath`
  and native Windows are left alone, and any doubt runs the hook as it is. New commands:
  `job hook <name>`, and `job run --hook` for the scripts. `doctor` has a git hooks line: a
  missing folder is a warning until `setup` runs, and a folder the kit did not make is a ✗ that says
  to move it away first.
- **`worktrees.guardMainFolder` covers Bash.** The guard also refuses a Bash command that writes a
  file in the main checkout or changes its branch (`echo x > a.txt`, `sed -i`, `git checkout`,
  `git commit`), and lets plan mode's plan file through. A session that starts in the main checkout
  is told to make its first change in a worktree. After you approve a plan there, the `plan-task`
  skill copies the plan file into the worktree.

**What to run:** `cc-smart-dev-kit setup`, to write the git hooks folder (a plugin update
rewrites it at the next session start once it exists). A project with its own `jobs.kinds` for
`bun test` or `tsc` can drop them.

## 5.0.0

A major version: `update` holds it until you run `cc-smart-dev-kit update` on each machine.

- **Project tasks become deploy tasks.** A task file in the repo is now only a step owed around
  a deploy, for **prod** or **staging**, each in its own folder (`.claude/tasks/prod/`,
  `.claude/tasks/staging/`). Each one says when it runs (`--deploy before|after`) and whether it
  holds the release (`--type blocking|non-blocking`). Ids are the creation time in UTC
  (`prod-20261117-144503`). A step owed on both environments is a linked pair (`--pair`): prod
  waits for its staging twin.
- **A deploy run with two checks.** Cut a deploy branch from the commit that ships, then
  `task release <env> --before`: it refuses while a blocking before-task is open, a staging twin
  is open (or names no task), you are on the base branch (or detached, or the ref's own branch),
  or the branch is not that commit. It warns, without refusing, when files outside the tasks
  folder have uncommitted changes. Close each task with evidence and commit the closes; deploy;
  `task release <env> --after` refuses while any task is open, the closes are not committed and
  pushed, or you are on the base branch (or detached, or the ref's own branch). Both checks also
  refuse an environment not in `tasks.envs`, a task file that does not read, and one id in two
  files. The branch's small pull request carries the closes to main, so nothing lingers. The `task` command writes and reads deploy tasks in the folder it runs in; the task
  tools use the session's checkout. `task list --branches` also shows closes made on a branch
  that is not merged yet.
- **Only you drop a blocking task.** Inside Claude Code, dropping, weakening (non-blocking, or
  before to after) or deleting an open blocking task is refused; you run the command in your own
  terminal. `task reopen` puts a task back after a rolled-back deploy.
- **Follow-ups are no longer tasks.** A bug or gap that belongs to the plan is the plan's own work.
  One outside it becomes a GitHub issue, filed by the main session; without GitHub, a line in the
  summary. The `follow-up` and `teammate` kinds, `when`, `weight`, `--for-everyone` and
  `task import notes` are gone.
- **GitHub issues are on by default.** The kit files issues, and marks them fixed
  (`issue mark-fixed`: a comment and a label), without an opt-in, in any repository on github.com
  that is not public (private or internal) whose project has a kit config, when `gh` is logged
  in. A public repository still needs `issues.allowPublic`. Where the kit cannot file, `doctor`
  shows an information line, not a failure.
- **A `tasks` skill.** `/cc-smart-dev-kit:tasks` is the one place that says which task to make
  and how to use it: work tasks, plans, deploy tasks and the deploy run. `memory-routing` points
  to it.
- **Your deploy skill gets the steps.** `project init` finds the project's deploy skill, asks,
  and adds a kit-managed "Deploy tasks" section to it (`--deploy-skill <path>` names one,
  `--no-deploy-block` removes it). With no deploy skill, it offers to create
  `.claude/skills/deploy/SKILL.md`, unless a `/deploy` command already exists. `restore` never
  changes these project files.
- **You see them.** Each session starts with a "Deploy tasks open: …" line when any are open.
  `doctor` names broken task files, old task files, fields no longer read and an out-of-date
  section, each with its fix. The portal's Tasks page shows prod and staging sections.
- **Old files are not read.** Task files from 4.x (`.claude/tasks/T-*.md`) are ignored; `doctor`
  counts them. `tasks.releaseBranch` and `tasks.legacyFolders` are accepted and ignored; the new
  field is `tasks.envs`. `project init` raises `requires` to `>=5.0`, so an older plugin says
  "update" instead of showing nothing.

**What to run:**
1. `cc-smart-dev-kit update`, then start new sessions.
2. In each project: `cc-smart-dev-kit project init`.
3. Delete the old task files in `.claude/tasks/` you no longer need (`doctor` lists them).
4. To keep issues off: `cc-smart-dev-kit workflow set issues.enabled false` for every project
   of yours, or with `--project` for one project (commit that file).

## 4.10.2

- **A reopened session keeps its plan on the status line.** `claude --resume` (or
  `cc-smart-dev-kit sessions --open`) gives a session a new process under the same session id.
  Task claims belong to a process, so the claims named a process that was gone, and the
  status line's Plan, Phases and Tasks rows vanished. Now a dead claim under the caller's own
  session id counts as the caller's, and the next task call moves it to the new process, with
  a history entry. Only a claim whose process is proved gone moves: a claim of another process
  that may still run is never taken, even under the same id.
- **A `/clear` keeps the work for a later resume.** A `/clear` keeps the process and gives the
  session a new id. The next task call moves the process's claims, and the open tasks it made,
  to the new id, in every project, so a resume under that id still finds them.
- **Another session's record can no longer blank your status line.** The task server read every
  running session's record and failed when any one could not be read. It now reads only its
  own process and that process's parents.
- **A read never fails because a claim could not be moved.** `list`, `get` and `search` still
  answer, with one line saying the claims were not moved and the next call retries. A write
  fails with that reason.

**What to run:** nothing. A session picks up the change at its next start.

## 4.10.1

- **A child session's questions are yours.** You answer a child's questions, permission
  prompts, plan approval and login in its own pane (its Herdr tab, or `hc attach <terminal>`).
  The lead no longer takes part: `herdr wait` does not wake it for a blocked child (it waits on
  until the child is done, fails or ends), and the `herdr` skill tells it never to ask you the
  child's question or answer for it. The `herdr answer` command, its dialog reader and its
  judge rules are removed. An old `wait --seen` cursor with a `blocked` entry still works.
- **A patch by the owner's decision.** Removing a command would make a major version, which
  waits for each machine's `update`. Only a lead ever ran `herdr answer`, always behind an ask,
  so nothing a person or project runs breaks, and the fix ships at once as a patch.

**What to run:** nothing. A running lead picks up the skill change at its next session.

## 4.10.0

- **shadcn/ui support.** Setup registers the official shadcn MCP server for your user, pinned
  (`shadcn` 4.23.0, through `bunx`), like the other servers. Claude can then search, view and
  add registry components in any project. A project's own `shadcn` server (what
  `shadcn mcp init` writes) wins, and `doctor` shows it as information while it connects. The
  server reads `components.json` from the folder the session started in; it does not follow a
  worktree.
- **`react-best-practices`, split out of `performance-budget`.** The React playbook and React
  Compiler move to the new skill, which also puts the design system first: the project's own
  parts, then shadcn/ui (its guide and the MCP server), then a maintained library, then your own
  code with a `Why custom:` line. It carries the lint rule that enforces this (Biome
  `noRestrictedElements`, or ESLint). `performance-budget` keeps the performance and UX budgets,
  for performance work only. Its project add-on still works: without
  `.claude/cc-smart-dev-kit/react-best-practices.md`, the new skill reads
  `.claude/cc-smart-dev-kit/performance-budget.md`, where your React Compiler opt-out lives.
- **Design system first, where Claude decides.** The builder looks in the project, then its design
  system, then a library, before it writes a component, and reports the standard parts it used.
  A phase brief names the standard components to use. Review axis 6 counts a raw control or a
  hand-made widget as a finding when the design system has one.
- **Seven skills only you start.** The official `shadcn` and `migrate-radix-to-base` skills and
  the five shadcncraft skills ship as their authors wrote them, with their licences, pinned and
  patched by `scripts/vendor-skills.ts`: the shadcn CLI in their text is pinned to the server's version, a
  licence key is never asked for in the chat, and the shadcn guide says the server is already
  registered. Claude never starts them and never sees their descriptions, so they cost no
  context. Some shadcncraft steps need a paid licence or a Figma MCP server.
- **`doctor` notes a shadcn project with no lint rule** against raw HTML controls, as information,
  and points to the recipe. It only reads.
- **A busy machine may skip the push hook, but only safely.** Under heavy load, Claude may push
  with `--no-verify` only when the full check already passed on that exact commit and CI runs
  the same checks, and the hook only runs checks (a Git LFS hook that uploads files is never
  skipped). It says so, then watches CI (`verify-change` § 4).
- **The context budget counts only what Claude sees.** A skill marked
  `disable-model-invocation` is left out of the check, because its description never reaches
  the model (proved live on Claude Code 2.1.325). The check measures a copy of the plugin
  without those skills, so the figure is exact; the always-on budget is 2,766 tokens.

**What to run:** `cc-smart-dev-kit setup` (it registers the shadcn MCP server), then
`cc-smart-dev-kit doctor`, then restart Claude Code so the new server and skills load.

## 4.9.0

- **Lay out all your plans up front; one runs at a time.** In 4.8.0 a session could queue
  plans but could lay phases in only one of them, so a later plan's phases waited in its plan
  file. Now every plan can hold its phases and tasks, briefs included, from the start. The
  ledger shows all of it, and nothing waits only in a file. A queued plan's task is `pending`.
- **One plan is in flight.** The store marks a plan's task `in_progress` when its first phase
  or task starts. Starting work in another plan is refused while one is in flight, and the
  refusal names that plan and the two ways forward: finish it or park it. A plan stays in
  flight until its `task_done`, so its final review and fix pass belong to it, and the next
  plan starts after it closes. Plans run in plan-number order unless you say otherwise.
- **Parking keeps the work.** To park a plan, set its plan task back to `pending` and add a
  note that starts `parked: <why>`, after its running work stops (the store refuses while any
  of it is in progress).
  Nothing is dropped: phases, steps and briefs stay as they were. Starting one of its phases
  resumes it. This replaces 4.8.0's way of parking by dropping every open step and phase.
- **`task_list` marks each plan** in flight, finishing, queued or parked, in plan-number
  order. A phase or a list that names no plan goes to the plan in flight first (the full order:
  `plan-task` § 6). An ask made during a build goes to the next queued plan: under its phase
  when one fits, else waiting under the plan.
- **The status line counts the plans that wait.** Its plan row reads
  `Plan · <title> · 2 queued, 1 parked` when your other open plans wait behind the one in flight.
- **`/clear` keeps your plans.** After a `/clear` the session gets a new id, but the same
  process still owns what it made, under any session id (the store now records the process
  that made each task: schema 5). So the one-plan rule still holds, and `task_list` keeps
  showing that earlier work, even before anything was started. This holds on Linux. Off Linux
  there is no process start time yet, so the maker rule falls back to the same session id, and
  a `/clear` there still loses the queue's ownership. Starting one task of another
  session's plan no longer makes the whole plan yours: a plan is yours by its plan task, in
  the default plan, in `task_list` and in the stop guard.
- **A small fix needs no plan.** A task you make with no plan and no parent stays loose, even
  while plans wait or one is in flight: it never joins a plan, and starting it never puts a plan
  in flight. The default plan is for laying a phase.
- **A plan parked under 4.8.0** (its phases were dropped) now reads `queued`, or `finishing`
  when one of its phases was done. To resume it, set its dropped phases and steps back to
  pending. A plan parked with a note and every phase closed
  reads `parked`, and resumes by starting its plan task.
- **Freed work is named.** Closing a task (`task_done`, or `task_update` to done or dropped)
  now ends its answer with the tasks and phases it unblocked, yours only: `· now ready: #12
  Phase x, #13 Phase y: start them together`. And the stop guard no longer goes quiet when
  the last running phase closes: while ready phases of your plan in flight wait and nothing runs,
  it keeps the turn going and names every one, so their builders start together. Moving a
  running task into another plan counts as a start there: refused while a plan is in flight,
  and it puts the destination plan in flight otherwise. A take now shows the maker moving in
  the task's history.
- **Claude is no longer told your plan's usage.** The hook line that said when a window passed
  50, 75 or 90 % is gone, and so is the skill section that told Claude to ration agents by it.
  The status line still shows the usage to you, and warns from `alerts.usagePercent`.

**What to run:** nothing.

## 4.8.0

- **A plan holds at most 10 phases, and each phase holds its real tasks.** Plans had grown to
  dozens of phases (one had 77), each a small step with two filler tasks, and each phase got
  its own review. Now a phase is one area of the code with its own files: one builder, one
  review, and its steps as tasks, usually 3 to 10. The old "30 to 90 minutes per phase" rule
  is gone. Bigger work becomes a sequence of plans.
- **The task store enforces the shape.** It refuses a new phase past the cap, with the way
  forward in the message. It refuses to start a phase that has no tasks. The cap is the new
  workflow setting `plans.maxPhases` (1 to 50, default 10): set it for one project with
  `cc-smart-dev-kit workflow set plans.maxPhases <n> --project`, or for yourself without
  `--project`. Only you raise it: `workflow set` and `unset` of it refuse inside Claude Code
  (`propose` stays open), so a session cannot lift its own limit. A plan already over the cap
  keeps running, but it gets no new phases, and `doctor` names it.
- **One active plan per session.** A session may queue more plans, but it builds one at a
  time. The store refuses phases in a second plan while the active plan has open phases. A
  call that names no plan now goes to the active plan, not to the newest one: before, a
  queued plan made during a build caught new work by mistake. While a plan is finishing (all its
  phases closed, one done, its task still open: the final review and fixes) it takes those calls
  too. To park a plan, drop its open steps and phases with the note `parked: <why>`; the plan
  stays open and the next plan may start. A dropped phase that comes back is checked like a new
  one: the active plan and the cap.
- **An ask made during a build waits as a task in the next plan.** `task_create` with `parent`
  set to a plan's `#n` makes a task directly under the plan. When that plan is designed, the
  task moves under its phase. The plan cannot close while one still waits.
- **One plan is one pull request.** Phase branches stay local and merge into the plan branch.
  The plan branch is pushed after each merged phase (when `autoPush` is on, or after one yes
  for the whole plan), and the one pull request opens after the final review.
- **Bigger phases never mean less work.** A phase's step closes `done` only with evidence
  (what was run or checked, and its result) and `dropped` only with a reason; the store
  refuses otherwise. The phase review answers every step with its own line (`done`, `missing`,
  `partial`, `dropped-ok`, `dropped-wrong`), and one missing step fails the phase. Phase
  reviews run at `high`, never lower. Merging phases carries every old brief and done-check
  over as tasks.
- **One naming shape** (plan-task § 4): a phase id names its area in one word (`auth`), a
  phase subject is `<Area>: <what it delivers>`, and a task subject is
  `<phase id>-<n>: <verb> <what> — <check>`.
- **Downgrade note:** an older version refuses a `.claude/cc-smart-dev-kit.json` that sets
  `workflow.plans`. Unset it before going back (`workflow set` already raises `requires` to
  `>=4.8`). The same goes for a `plans` value in your own `~/.config/cc-smart-dev-kit/workflow.json`:
  unset it there too (`cc-smart-dev-kit workflow unset plans.maxPhases`, in your own terminal).

**What to run:** nothing. A session running a plan with more than 10 phases should re-plan it:
finish the phases in progress, then re-plan the remaining work as next plans, each within the
cap (done phases count toward it).

## 4.7.0

- **Claude follows the React playbook for every change to a React or Next.js web app.** The
  playbook (Vercel's React Best Practices, plus the kit's section on Next.js 16 caching, React
  19 and React Compiler) was read only for slow pages and bundle audits. Now the
  `performance-budget` skill loads for any React or Next.js work. Claude reads the playbook's
  head once per session, then only the rules each change touches, each once, and a broken
  rule is a defect in its own code and in a review. Builder subagents load the skill too.
- **React Compiler is on in every React web app.** A new app turns it on in its first setup.
  When an existing app has it off, Claude says so and offers to turn it on as its own change:
  the compiler's lint rules first, then the official setup for the project's build tool (a
  large app rolls out in parts, as React's incremental adoption page shows), then the full
  tests, the build and a check of the main screens. A project can keep it off by writing its
  reason in `.claude/cc-smart-dev-kit/performance-budget.md`.

## 4.6.1

- **The status line shows the plan, its phases and the phase's tasks, each on its own row.**
  It used to show one `closed/total · title` row that counted only a plan's tasks. A lead that
  laid its phases without steps got `0/0`, even with phases done. Now the rows are
  `Plan · <title>`, `Phases 5/25 · <current phase>` and `Tasks 1/3` (with the current task's
  title when it is one). A plan with no phase shows `Tasks` for its own tasks.
- **`task_list` and the portal count a plan by its phases too**, or by its tasks when it has no
  phase. A phase still counts its own tasks, so nothing counts twice.

## 4.6.0

- **Claude now researches an app's stack and architecture before it picks one.** Asked to build
  a web app, a service or a new layer, Claude could pick its libraries from memory. The
  `research-first` skill has a new section, § Choosing a stack or an architecture. Claude
  reads what the project already fixes and lists the decisions the work makes. For each one it
  compares two or three current candidates on fit, maintenance, security, adoption, bundle
  cost, types, runtime fit, license and exit cost. It picks for the scale the project expects,
  keeps each library easy to replace, pins versions, and writes down why it chose.
- **A checklist of the decisions, from frontend to operations.** The skill's new
  `references/stack-decisions.md` covers server and client state, HTTP clients, forms, API
  style, auth, data stores, caching (Redis, Valkey), real-time (WebSockets, server-sent
  events), queues, load balancing and scaling, infrastructure as code, CI/CD, testing,
  observability and security. Every tool in it is an example, checked in November 2026. It
  opens with the traps that memory misses: license changes, retired projects, maintenance
  mode, a `latest` tag that is a release candidate, hijacked releases. Claude reads it only
  while choosing a stack, so other sessions pay nothing for it.
- The general instructions and `plan-task` point to the section. Two new eval cases check
  that a request to pick a new app's libraries, or to design a backend, opens the skill.

**What to run:** nothing.

## 4.5.2

- **A request for a Claude session now gets one, not subagents.** Asked to "run multiple Claude
  child sessions", a session started subagents (helpers inside itself) instead, because no
  trigger word sent it to the herdr skill. The skill now names separate Claude sessions, "child
  session" and "parallel sessions", and says never subagents. The general instructions say a
  "session" means the herdr skill, never a subagent. The example of naming an agent at launch
  moved from the general instructions into the subagent-decision skill, to stay within the
  always-loaded budget.

**What to run:** nothing.

## 4.5.1

- **Old builder folders whose work is already on the base now go.** A builder that never
  committed in its own folder, while its lead committed the same files on the plan branch, left
  a folder that `worktrees` kept forever as "uncommitted changes" — though the session said all
  its work was merged, and it was. An uncommitted file now counts as saved when its exact bytes
  and file mode are a version that same path had in a commit of `origin/<base>`'s history after
  the folder's own HEAD, and a deleted file when the base deleted it too. Anything that exists
  only in the folder still keeps it, and so does a file put back to an older version, a symlink,
  a submodule, a conflict or any git call that fails. A file with a filter driver or `ident` (a
  notebook output stripper, Git LFS) is compared as it is on disk. The removal proves it again
  right before it removes the folder, and only then forces git past its own refusal.
  `worktrees --clean` and the background clean use the rule; the session-start note keeps its
  quick check, so it may not name such a folder.

**What to run:** nothing. The next background clean, or `cc-smart-dev-kit worktrees --clean` in
the main checkout, removes the folders this frees.

## 4.5.0

- **Finished worktrees now go right after their merge.** Before, builder and session
  worktrees piled up for days, because several checks kept every one of them. Fixed:
  - **A `git gc` no longer makes every worktree look busy.** "Last used" is read from the
    newest entry inside git's HEAD log, not from the log file's time, which `git gc`
    rewrites.
  - **Builder locks are read.** Claude Code locks a subagent's worktree as `claude agent …`;
    the kit read only `claude session …` locks, so a builder's lock never counted as stale.
    A builder's lock is now stale only when its session has ended **and** Claude Code marked
    the builder finished.
  - **The lead removes its builder after the merge.** `worktrees --remove <builder>` proves
    the caller is the session that holds the builder's lock and that Claude Code marked the
    builder finished, then removes the folder. The build skill now does this after each
    phase's merge. `--clean` and the background clean never touch a live session's builders.
  - **A builder merged into its lead's plan branch can go** before that branch reaches the
    base. Its folder goes; its branch stays until the base holds it.
  - **A session clears its own worktree after its pull request merges.**
    `clearWorktreeAfterMerge` is now **on by default**. The after-merge note says: stop dev
    servers and Monitors, leave with ExitWorktree `keep`, then `worktrees --remove` in the
    background. The session's own MCP servers no longer hold the folder.
  - **`--remove` works from any checkout** of the repo, except on the folder you stand in.
    It waits up to ten minutes for another clean, then exits 1 (busy), never "nothing done".
  - **Big folders are no longer half deleted.** A removal may take up to ten minutes (it
    was cut at 15 seconds), and a half-deleted `*-removing-*` folder is finished in the
    same run.
  - **An untouched `.env.local` copy no longer keeps a worktree** when the main checkout's
    copy changed later.
  - **Every process is seen.** The program check listed only processes without a terminal,
    so a dev server started in a terminal could be missed. It now lists them all.

**What to run:** nothing. A project that wants the old after-merge behaviour sets
`"clearWorktreeAfterMerge": false` in its `cc-smart-dev-kit.json` `workflow` block (or with
`cc-smart-dev-kit workflow`). A tool's own cache folder that keeps worktrees goes in
`worktrees.rebuildable`.

## 4.4.1

One fix from the 4.3.2 live proofs.

- **Bash prompts without a border can be relayed.** Claude Code 2.1.322 also draws a Bash
  command box with no `│` border, for example a plain prompt that matched no permission rule
  ("This command requires approval"). 4.3.2 refused that layout and sent you to the pane. Now
  `herdr answer` accepts a box where every line has the border or none does; a mix refuses. The
  whole box must still equal the command.

**What to run:** nothing. Update the kit on your other machines to 4.4.1 too.
## 4.4.0

- **The `extract-or-duplicate` skill is now `code-structure`, and its old project add-on is
  no longer read.** A project's `.claude/cc-smart-dev-kit/extract-or-duplicate.md` is ignored
  from this version on; rename it (see **What to run**). There is no fallback and no `doctor`
  check for the old name.
- **One rule for clean, organized code.** "Simple" means clean and organized, never simplistic.
  The renamed skill is the one home for how code is shaped: split by responsibility, not by
  line count; when a helper, a service or a module earns its place; naming for functions,
  variables, types and booleans; one concept per file; and what counts as a cleanup versus a
  structural change that needs a yes. Every rule of the old skill is kept, except the line
  counts: about 100 lines per function and 500 per file are now a reason to look, never on
  their own a reason to split. The general instructions carry the principle in one line, at
  no extra size.
- **Builders load the rule at start.** The `builder` agent preloads `code-structure`, so the rule
  is in its context before the first edit (about 1.8k more tokens per builder launch).
- **Design findings meet the evidence bar.** The review axes now say how a structure or naming
  finding fills the four fields, and what refutes it (the project's convention, the sibling
  files). The split review and the audit workflows use the same rule.

**What to run:** the update arrives by itself; restart open sessions to use it. Then, in each
project that has the old add-on, copy `.claude/cc-smart-dev-kit/extract-or-duplicate.md` to
`code-structure.md` and keep the old file until every machine working in the project runs
4.4.0 (older versions read only the old name, 4.4.0 only the new one); then delete the old
file. In every project, change any `/cc-smart-dev-kit:extract-or-duplicate` mention in its
`CLAUDE.md`, rules or add-ons to `/cc-smart-dev-kit:code-structure`.

## 4.3.2

Two fixes from the 4.3.1 live proofs.

- **Bash prompts can be relayed.** Claude Code draws a Bash permission as a box of `│`
  lines between dashed rules. 4.3.1 looked for the command in the wrong place, so `herdr
  answer` refused every Bash prompt (it failed safe and sent you to the pane). It now requires
  the whole box to equal the command, never a part of it, the dialog's description or earlier
  text.
- **A linked child on another machine stays under its lead.** 4.3.1 opened it as its own space
  in the main window. Now only an independent session gets its own space, on any machine; a
  linked child, local or remote, nests under its lead in the Agents panel, as a local one does.

**What to run:** nothing. Update the kit on your other machines to 4.3.2 too.

## 4.3.1

Fixes from the first live run of Herdr session orchestration.

- **Sessions start with your own PATH.** Every child, local or on another machine, now starts
  through your login shell. Before, a child got the Herdr core's bare PATH: on another machine
  `claude` and the kit were not found, and locally other plugins' hooks could not find `node`.
- **Independent and remote sessions show in Herdr.** Each one gets its own space in Herdr's
  window, so you can see it and answer it. Before, they were invisible.
- **A child that dies at launch is reported.** `herdr start` waits until the child comes up.
  If it exits (for example, Claude Code has not trusted the folder yet), start shows the
  child's own error and fails, and the task stays unbound.
- **Long Bash prompts and single questions can be relayed.** `herdr answer` relays a Bash
  permission of any length Claude Code shows in full, and only when the command on screen
  matches it. A single question with "Type something" and "Chat about this" rows now relays;
  several questions and multi-select still go to the pane.
- **Your approval covers the whole prompt.** The judge quotes the full prompt in its
  question. It refuses a `herdr answer` with `$` expansions or command substitution in its
  words, one inside a loop or wrapper, and one sharing its line with other commands.
- **`adopt` works while the old terminal is still open.** A terminal with no Claude in it now
  counts as gone, the same rule `report` uses, and `adopt` lists reports saved while the lead
  was gone. Messages and reports are never typed into a plain shell.

**What to run:** nothing. On another machine, the kit and `claude` must be found by that
user's login shell; update the kit there to 4.3.1 too.

## 4.3.0

- **Messages to another repo's session no longer ask.** The `message-guard` hook is retired,
  as the owner decided: a SendMessage to a Claude session working in another repo goes
  without a question. The worktrees opt-in now says to check a session's folder first, and
  to message another repo's session only when the work spans both. A project whose
  `ownHooks` still names `message-guard` keeps parsing; doctor says the name can go.
- **`gateway setup` keeps Fable on the newest model.** It removed the kit's old Fable pin
  without writing the kit's model menu, so `/model` fell back to the Fable row Anthropic
  cached, which named an older Fable. It now retires the pin and refreshes the menu in one
  step, as `setup` does. A menu you set yourself stays yours.

**What to run:** if `/model`'s Fable row names an older Fable, or `doctor` says
`Gateway model menu: not set`, run `cc-smart-dev-kit gateway setup` (or `setup`) once.

## 4.2.0

- **Give work to another Herdr session.** `/cc-smart-dev-kit:herdr` starts a linked child
  that reports back, or an independent session for you to watch. The `herdr` command
  starts, lists, messages, waits for, adopts and stops linked children. Briefs stay in
  private per-child folders granted through `--add-dir`; an optional same-project task
  records the child's identity and worktree.
- **Relay a child's single-choice question.** The lead shows you the question, then asks
  permission to send your answer. The command checks the prompt, turn, options and cursor
  again before arrow-key selection. Plans, logins, text answers and remembered permissions
  stay in the child's pane. Child reports never count as your approval.
- **Launch checks cover model, mode and remote machines.** Fable, Opus at max effort,
  unknown remote machines and production machines always ask, even with `--asked`.
  Child modes cannot exceed the lead's mode through the Bash judge. Raw hc writes are
  refused. `herdr machines` manages `machines.json` for remote approval rules;
  production wins over an allow entry. Remote starts need their own working directory,
  and remote reports stay as files on that machine.
- **Wait for news without polling.** `herdr wait --all` is a real barrier. The command prints
  an exact continuation with a per-child turn/state cursor, not a machine-clock timestamp.
  Doctor checks hc's version but says core not checked until a no-start status read is
  proved live. The remaining live relay and remote proofs are listed in the design page.
- **Every shell guard sees commands after append assignments.** A `NAME+=value` prefix
  now counts as an assignment in the shared shell reader, so it no longer hides the command.
- **Cross-repo messages still ask.** `message-guard` still asks before a SendMessage to
  another repo; its planned retirement waits for approval.

**What to run:** start a new Claude session after updating so it loads the skill and hooks.
Herdr orchestration is optional; it needs hc 0.1.20 or newer on PATH
(the command’s `MIN_HC_VERSION`). Update the
remote kit before a remote start if it is older. No router change is needed.

## 4.1.0

- **The model menu follows Claude's newest models by itself.** While the gateway is on, the kit
  writes Claude Code's `/model` menu: one row per family (Opus, Sonnet, Haiku, Fable), each
  saying who answers it. A row whose slot passes straight to Claude reads "Claude's newest
  Opus"; a slot set to a backend reads "answered by gpt-6.1-sol (worker slot)". The kit never
  writes a model id: each family follows the newest model your Claude Code knows. Anthropic's
  stale extra rows (an old "Fable 5.1") are hidden while the gateway is on. A menu you set
  yourself stays yours. `gateway off` and `restore` remove the kit's menu, and `setup` or a slot change removes
  one left behind while the gateway is off.
  - `launch --profile <name>` carries that profile's rows, fixed for that session. `launch
    --no-gateway` carries plain-Claude rows only to replace the kit's menu; with no kit menu,
    Claude Code's own rows stay. Claude Code reads the menu only from your user settings, so a
    project's own gateway (`gateway project`) cannot have its own menu; the command says so.
  - `doctor` names the menu's rows, and says when your default model is fixed to one id
    (`"model": "claude-…"`), which keeps you off newer models.
- **The 4.0.0 Fable pin is gone.** 4.0.0 set `ANTHROPIC_DEFAULT_FABLE_MODEL` to one Fable id.
  `gateway setup`, `setup`, `gateway on`, `gateway off` and `restore` now remove it while it is
  still the kit's value; a value you set yourself stays.
- **The status line names who really answered.** While the gateway is on, the main status line
  shows `Sonnet 5.5 → gpt-6.1-sol` when another model answered your session's model, a
  fallback included. Each subagent's row in the agent panel shows `worker → <the model that
  answered> → effort`. Only whole answers count: the router's request history now marks an
  answer that broke mid-stream or was refused, and records which subagent sent each request.
- **Fix: a new task never joins a closed plan.** A task created without a plan used to join the
  session's latest plan even when that plan was done (a done plan then showed 17/18). New work
  now joins only an open plan; moving a task into a closed plan is refused.
- **Workflows started from the skill list get their arguments right.** Claude Code lists the
  kit's workflows as skills and shows only their description. Each description now names the
  arguments the workflow accepts and the skill that calls it, so a session no longer guesses a
  key the workflow refuses.
- **Instructions:** the edge-case hunter runs on `opus`; the `(Recommended)` option in every
  question is the strongest complete one, never a shortcut, and a workaround is labelled as one.

**What to run:** the update arrives by itself within the hour (or run `cc-smart-dev-kit update`).
Then run `cc-smart-dev-kit gateway setup`: the router changed, so it asks before it restarts the
router (a restart cuts answers in flight); it also removes the 4.0.0 Fable pin. Then run
`cc-smart-dev-kit setup`: it writes the menu. Then start a new Claude Code session and open `/model`.

## 4.0.0

- **Breaking: tasks have three layers, with no subtasks.** Work is Plan › Phase › Task, plus
  loose tasks with no plan. A task never holds a task. The task tools, the `task` command and
  the hooks no longer speak of subtasks.
  - The task store moves to schema v4 by itself, after it writes a backup next to the store.
    Each old subtask becomes a task under the same phase, or a loose task. Its notes, history
    and claim stay. When a subtask used to hold its parent, the move keeps that hold as an
    explicit "blocked by".
  - The move runs again whenever a new process opens the store for writing: a new session, a
    `task` command or the portal. So a task that an older 3.x session nests after the update is
    moved up then. Until that happens, 4.0 reads such a task without trouble.
- **Several plans per session, one at a time.** The task tools take `plan`, the plan's name
  (its slug), to pick which plan they act on. With several plans, `task_list` with
  `scope: "plan"` shows them all. The plan and build skills now run plans one after another,
  each with its own plan task. `task import claude-mem` turns an old list into one plan with
  one phase.
- **Take over another session's work.** Run `task take <plan-slug|#n>` or call `task_take` to
  move a plan, with its phases and tasks, or one task into this session. Use it after a crash
  or a hand-over. It moves everything or nothing. A claim whose process has ended moves at
  once. A claim that a running process still holds needs `--force`. The portal's task panel
  has the same move, as "Move to session…".
- **The portal's Tasks page is rebuilt.**
  - Each project shows Session › Plan › Phase › Task as a tree. Every level folds, and the
    browser remembers the folds. Done plans and phases start folded.
  - Plans and phases show their progress, counted over every task, old closed ones too.
  - A filter bar narrows the list by project, session, plan, status or words, and the address
    keeps the whole view.
  - The list shows 60 rows at a time and says how many are hidden.
  - A click opens a side panel with the task's description, notes and history.
- **The status line counts the plan's tasks.** The current task has its own row, written as
  `3/10 · <full title>`: the plan's closed and total tasks, phases left out, then the whole
  title. A task with no plan shows its title alone.
- **Fix: a plan limit from another login no longer sticks.** The status line hides a router
  limit record when this session's own usage window ends at a different time. That means
  another login, or a window that has moved on. A limit for this same login still shows. The
  router also ends a record of another model once a Claude answer's own headers show the
  window has room. A per-family limit (Opus, Sonnet) ends only by an answer from that family.
- **Plan files live in the project.** `setup` sets Claude Code's `plansDirectory` to
  `.claude/plans` in your user settings, so plan mode writes each plan into the project. A
  value you set yourself stays yours. Plans are committed with their branch, and `doctor`
  names the plan folder in use. `restore` removes the setting.
- **Claude Fable 5.2 through the gateway.** Behind a gateway, Claude Code maps `fable` to an
  older Fable. While the gateway is on, the kit now sets `ANTHROPIC_DEFAULT_FABLE_MODEL` to
  `claude-fable-5-2`, so `/model` lists Fable 5.2. `gateway off` removes the setting, and a
  value you set yourself stays yours. The router's prices know Fable 5.2. When a slot's chain
  names Fable 5.2, the router leaves out the sampling fields it refuses (`temperature` other
  than 1, `top_p`, `top_k`), as Anthropic's migration guide says.
- **The portal's switches say what they do.** The "opus and fable slots" switch is gone. Each
  slot keeps its own switch on the Slots page. The judge switch is now "Auto-mode judge". It
  sits below the gateway switch, and you cannot change it while the gateway is off.

**What to run:** this is a major version, so update to it on purpose with
`cc-smart-dev-kit update`, then restart Claude Code. The task store moves by itself the first
time it is opened, after a backup. Run `cc-smart-dev-kit setup` to write the plan folder
setting and, with the gateway on, the Fable setting. With the gateway, also run
`cc-smart-dev-kit gateway setup`: `update` never restarts the router, so the new router, and
the limit fix in it, runs only after this step. It asks before the restart; without a terminal
(a `!` command in Claude Code) add `--yes`. Start a new session to pick up the settings.

## 3.1.0

- **Merges are no longer announced to your other sessions.** After a merge into
  `worktrees.base`, the `after-merge` hook no longer gives Claude a message to send every other
  session in the repo, and the worktree instructions and skill no longer ask for one. The hook
  still gives the steps that clear the merged worktree, and still starts the background clean
  of finished worktrees once per merge.

## 3.0.1

- **Fix: Claude Fable behind the `opus` slot is the `opus` tier.** When the `opus` slot (or
  `ANTHROPIC_DEFAULT_OPUS_MODEL`) puts Claude Fable first, an `opus` launch keeps the `opus`
  tier's rules: it runs at `medium`, `high` or `xhigh` with no question and needs no
  `Fable reason:` line. A fork from such a session is the `opus` tier too, and the session gets
  no Fable line and no lead hint, because you chose that mapping. An id mapped behind both
  premium tiers counts as `opus`. A launch that names a Fable id outright, and a `/model` switch
  to Fable, are still Fable. The guard's messages and the tier note name Fable as the model that
  answers. A `sonnet` or `haiku` slot that answers on Claude Opus or Fable still counts as that
  premium tier, through a chain of overrides too.

## 3.0.0

- **Breaking: Warp support is removed.** Setup no longer accepts `--warp` or
  `--remove-warp`. Doctor, session reopening and the portal no longer integrate with Warp.
  Existing apps, saved tabs, package sources and unowned plugin registrations stay untouched.
- **All kit custom notifications are removed.** Desktop popups, sounds, terminal/SSH alerts,
  agent-view sends, usage-limit alerts and updater notifications no longer run. Claude Code's
  built-in notifications and other plugins are unchanged. The status line keeps its usage
  warning, model plan-limit messages and reset times.
- **Safe retirement on setup.** Only exact recorded kit notification hooks and tmux lines
  are removed. Edited, unowned or unreadable registrations are preserved for manual review.
  Retired `alerts.events` and `alerts.sound` values are accepted but ignored; unrelated
  settings writes preserve them. `alerts.usagePercent` remains the status-line threshold.
- **Breaking: Needs you is removed.** Its page, navigation, polling and API are gone.
  `/needs`, `/needs/` and `/api/needs` return not found, including with a stale copied export.
  Work, Flow, guard questions, gateway limits and Machine update controls remain.
- **Latest Herdr GUI offered during manual setup.** Setup uses the official GUI installer
  and its normal missing-core bootstrap, not the TUI. It shows the change before consent;
  noninteractive installation requires `--yes`. `--no-herdr` skips it for that run. Existing
  GUI installs stay untouched. Setup does not launch it or change preferences. Upstream owns
  its app, core and shortcuts; kit restore does not uninstall them.

**What to run:** explicitly update to this major version with `cc-smart-dev-kit update`,
then restart Claude Code. Run `cc-smart-dev-kit setup --dry-run` and inspect the proposed
retirement and Herdr installation. Run `cc-smart-dev-kit setup` to apply it, or add
`--no-herdr` to skip the GUI. Review any manual-cleanup guidance for edited old hooks or
independently installed Warp plugins; the kit never guesses their ownership.

## 2.2.0

- **Model and effort by judgment of the job.** For each agent it starts, the lead weighs three
  things: how hard the job is, what a miss costs, and whether this is the last check before it
  is too late. `/cc-smart-dev-kit:subagent-decision` holds the worked examples: a plan's second
  opinion or a risky change set gets the senior engineer on `opus` at `xhigh`, and `high` gives
  most of the gain elsewhere. The backend behind a slot never changes the choice. The tier note
  now names the model behind each tier, with no effort range per tier. The kit recommends the
  lead session on Claude Opus at `high`.
- **Fewer agents for small work.** A handful of tool calls stays with the lead; an agent is
  for work big enough to pay for its own context. Independent agents still start together.
- **`reviewer` is now `senior-engineer`** (a clean break: the old id no longer counts). It has
  every tool, gives the second opinion on a change set or a plan, and is the consult when a
  session is stuck. It researches outside the repo with sources, and reports its findings
  before any fix.
- **Two new agents.** `edge-case-hunter` lists every scenario that can break a plan or a
  change, with the test that catches it. `researcher`, the R&D expert, answers one research
  question from current primary sources, each claim cited and marked confirmed or not. The
  `research-sweep` workflow now runs on it.
- **A review is recorded only for a review.** The review record behind the merge guard counts
  a run only when its brief, and every prompt it was given after the brief, hold the line
  `Mode: review` alone. A consult, a plan's second read (`Mode: plan-review`), a redirected
  review or one that compacted records nothing, so the merge guard asks. A senior engineer in a
  review starts no agents of its own: their notices would void the record.
- **The agent guard reads an agent's own frontmatter.** A launch that names no `model` or
  `effort` takes them from the agent's definition, found in Claude Code's own order. A
  definition the guard cannot see is refused, as before. Workflow scripts are now read by a
  real JavaScript parser (`acorn`, the one new dependency, in the agent guard's bundle only),
  and a script whose agent launches it cannot judge is refused.
- **The kit tells you when the lead is not Claude Opus.** Once per model, a line to you (it
  costs Claude no tokens) says the kit works best with the lead on Claude Opus at `high`, and
  how to switch. A person who leads on another model on purpose turns it off with
  `cc-smart-dev-kit workflow set switches.leadHint false`.
- **Claude sees the plan usage left.** When the status line's 5-hour or 7-day window first
  passes 50, 75 or 90 %, Claude gets one line, and picks cheaper agents as usage runs low. It
  never skips a test or a review for it. Only on your plan's login.
- **Every running session hears when you go away.** `/cc-smart-dev-kit:user-unavailable` used
  to reach other sessions only when you next typed in them, so a session working on its own
  could stop with a question for you. Now each session is told once, at the end of its turn,
  and parks what needs you instead. The session you switched in is not told twice, and no
  "finished" alert fires for the turn end that the note holds back. "Available again" still
  reaches a session at your next message there.
- **Prompt-cache misses show.** The status line names the cause of a new prompt-cache miss
  for a minute, and `doctor --live` reports it.
- **The shipped workflows cost less and lose less.** Their `sonnet` agents run at `high`, not
  `max`. A finding nobody could prove or refute is listed under Hunches, never dropped. Review
  and audit tracks cannot edit files or start agents.
- **Less context and fewer extra turns.** Skill descriptions are shorter (the always-on text
  fell from about 3,515 to about 2,626 tokens), and `bun run check` and CI now hold that budget.
  The verify gate counts only code edits in the session's own checkout, the session-name
  reminder comes once per context, and long stop-hook lists stop at 8 items.
- **claude-mem 15.** Memory recall uses `search`, then `timeline`, then `get_observations`
  (`mem_search` was removed in 15.0.0). The kit now needs claude-mem 15.0.0 or newer, and
  `doctor` notes that claude-mem's My Work auto-refresh runs agents outside the kit's route.

**What to run:**

1. **Before the update** (or now, if it failed), if claude-mem is older than 15.0.0, update it:
   `claude plugin update claude-mem@thedotmack`. Claude Code will not install 2.2.0 beside an
   older claude-mem, and the 2.1 update does not name the fix. From 2.2.0 on, the update checks
   this first and names the command.
2. Run `cc-smart-dev-kit doctor` in each project you use. It names the project's instruction
   files (its `CLAUDE.md` files and `.claude/` Markdown) that still use the old
   `cc-smart-dev-kit:reviewer` id. Check your own Workflow scripts in `.claude/workflows/` by
   hand.
3. A project's `.claude/cc-smart-dev-kit.json` that lists `cc-smart-dev-kit:reviewer` in
   `workflow.reviewAgents`: replace it with `cc-smart-dev-kit:senior-engineer`. The merge guard
   judges a merge by the base branch's list, so merge that one change by hand, or run
   `cc-smart-dev-kit workflow review-done`.
4. Your own `workflow.json` that names the old id: run, in your own terminal,
   `cc-smart-dev-kit workflow set reviewAgents cc-smart-dev-kit:senior-engineer` (or
   `workflow unset reviewAgents` for the default).
5. A project's own add-ons, agents or skills that brief a review agent: use the new id, and put
   `Mode: review` alone on a line of the brief. A second read of a plan uses `Mode: plan-review`
   instead: a plan is not code, so it records no review.

## 2.1.1

- **A builder no longer stalls on Claude Code's worktree check.** A subagent isolated in a
  worktree may be refused a git line that Claude Code calls "too complex to verify that it
  stays inside the worktree". That is a format rule, not a permission denial, and no approval
  lifts it. The builder now splits such a line into plain git commands and goes on. The main
  session resumes a stopped builder with that ruling, instead of asking you to approve. The
  same check covers a session that entered a worktree, so the commit skill now writes the
  message there as single-quoted `-m` flags instead of a here-doc.
- **A builder acts on what its caller relays.** Your answer to a question the builder sent up,
  passed on by the main session, counts. The builder no longer asks for your own words in its
  transcript. A relayed yes still lifts no tool check: a call that was denied is tried again
  only when the permission itself changed.
- **The keep-going stop guard reminds once per stalled state.** It used to block every turn
  end while a phase stayed in progress with no subagent running, even turns that only
  answered your question. Now it blocks once for a given state, and once more only after new
  subagent work stalls again. Its message names the builder to resume with `SendMessage` (or
  a fresh one to start), and warns against moving a phase back to pending just to end the
  turn.

**What to run:** nothing. Update as usual.

## 2.1.0

- **Choose the machine's heavy-job limit.** `cc-smart-dev-kit job set max <n>` accepts 1–8;
  the default stays 1. Competing full suites can starve each other, time out, then pass alone.
  The new `heavy-jobs.json` file never revives legacy `jobs.json`'s `maxJobs`.
- **Safe live changes.** Acquisitions count live leases under the existing lock. Waiting jobs
  see the new limit, crashes free stale leases, and lowering it never kills running jobs.
  Setup's managed writer backs up the setting; `restore` takes it back.
- **One visible value.** `job status`, `/api/jobs`, the Machine page and `doctor` show the
  limit and its source. Doctor names an old `maxJobs` as an ignored leftover.

**What to run:** update, then use `cc-smart-dev-kit job set max 2` only if you want two full
heavy runs at once. No command is needed to keep the default of one.

## 2.0.0

Fast parallel work with subagents, in worktrees, with the kit's task system as the ledger. The
crew and all load and usage balancing are gone.

**Before you update:** finish your crew work. Merge the branches you want and stop the crew
sessions that still run. After the update there is no `crew` command left to manage them.
A project whose `requires` stops below 2.0 (`^1.4`, `>=1.4 <2`) refuses the new version until
you widen it (`>=1.4`); a `requires` that `project init` wrote (`>=1.x`) needs nothing.

**What to run** after the update:

1. `cc-smart-dev-kit update`. A major version never installs by itself: it waits for this step.
2. `cc-smart-dev-kit setup`. It writes Claude Code's subagent cap (10 at once) and refreshes the
   instructions.
3. Start Claude Code again. A running session keeps the old version until it restarts.

What changed:

- **Building is subagent-driven.** The new `build` skill replaces the `lead` and `crew` skills.
  The main session plans the phases, then starts one builder subagent per phase, all ready
  phases in one message. Phases whose files differ run in parallel, each in its own worktree. A
  fresh reviewer reads each phase, the same builder fixes what it finds, and one final review
  runs on Opus over the whole branch.
- **The task system is the ledger.** A work task can now hold the `agent`, `branch`,
  `worktree` and `base` of the work on it (`task_create`, `task_update`, and the CLI's
  `--agent`, `--branch`, `--worktree` and `--base`). `task_list` with `scope: "plan"` shows one
  line per phase with its agent, branch, state and steps done. The work store moves to schema 3
  by itself, and keeps every task.
- **Two new guards keep the work moving.** `keep-going` (Stop) blocks the main session once
  when it would end its turn while a phase of its plan is in progress, no subagent runs, and its
  last message has no `Waiting for:` line; it names the next ready phase. `builder-finish`
  (SubagentStop) blocks a builder once when it hands back while the task its brief names
  (`Your task: #<n>`) still has open blocking steps, each named with the call that closes it.
  Both are machine-wide: they read only your own task list.
- **Ten subagents at once, by default.** Setup writes Claude Code's own cap,
  `env.CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS = "10"`, as a key the kit owns. A value of your own
  stays yours. `cc-smart-dev-kit setup --max-subagents <n>` (1–100) changes the kit's, `doctor`
  shows it, and `restore` takes it back.
- **The heavy-job queue is one slot per machine.** One full heavy run at a time, oldest first;
  a run on named files skips the queue. The memory gates, CPU and I/O weights, systemd slices,
  OOM scores, fair share, light lane, the `install` kind, `jobs.json` and `job set` are gone.
- **The portal's Tasks page shows each phase's ledger:** its steps done of its blocking steps,
  then the agent, branch, worktree and base set on it. The Heavy jobs card shows the one slot.
  The crew pages are gone.
- **`cc-smart-dev-kit issue mark-fixed`** writes a fixed issue's comment and label after the main
  session merges the fix. The crew watch used to do this.
- **Removed:** crew sessions, leads, the `crew` command, the crew monitors, the `crew-role` and
  `lead-notes` hooks, the crew start queue, the load gate, the usage guard for crew starts, and
  the `workflow.crew.*` settings.
- **What still loads:** a project or workflow file that still has `crew` keys,
  `issues.watch` or `issues.watchMinutes` (the issue feed went with the crew), or old jobs size
  fields, loads as before, and those keys are ignored. `ownHooks` may still list `crew-role` or
  `lead-notes`: the file parses, and the names silence nothing. Old crew state on disk stays
  where it is, unread.

## 1.11.3

The lead's watch wakes the lead only for what needs it.

**What to run** after the update: nothing. A running watch ends by itself when the update lands;
start it again with the `Monitor` tool, as its last line says.

What changed:

- **Only a line that needs the lead wakes it.** Every watch line is a notification, and every
  notification is a turn of the lead's model. On a server with seven leads, two wakes in three
  carried nothing to act on. Now a report, an open question, a permission wait, a failure, a
  stop, a pause, a quiet crew session, a stuck phase, the person's words and a note from another
  session wake the lead, as before, and so does a stopped crew session you merged, whose `crew rm`
  is yours. The rest waits: a step, a start, a phase you merged or removed, an answered question,
  another lead's merge into the base, a session the watch ended as planned, a cleanup, a pass
  that failed and runs again. It comes as **one** line, `FYI, no action needed (<n>): …`, just
  before the next line that needs the lead, so both arrive as one notification. Another lead's
  merge into the base and the project tasks a merge brought come first in it, whole.
- **A file clash is said at your own `crew start` only.** The other lead's watch no longer says
  it: the merge settles a shared file, and that line named the other lead's own crew session, not
  the one it shares the files with.
- **A busy conversation archive says nothing.** Several leads' watches ran the same hourly sweep,
  and the one that found the archive locked told its lead `the conversation timeline could not
  run`. Another watch was running that sweep.

## 1.11.2

The lead's watch names what holds the queue, until the lead acts.

**What to run** after the update: nothing. A running watch ends by itself when the update lands;
start it again with the `Monitor` tool, as its last line says.

What changed:

- **One line per phase that holds the queue and will not move by itself**, with the exact step
  that moves it: `B6a holds 3 queued (…) — C my-app B6a x failed: read its report, then bring it
  back with cc-smart-dev-kit crew resume "…"`. It covers a phase whose newest crew session
  failed, was stopped, handed off with no next crew session, or was removed or discarded before
  its work was merged. One that failed before its session started gets `crew rm`, then a fresh
  `crew start` with its own waits: there is nothing to resume. After `crew.quietMinutes` it also
  covers a phase that is done and waits for your merge, and a phase nobody has started. A crew
  session whose resume already waits for room is left out: the watch brings it back by itself. Before, only a phase removed before its merge
  was named, once per queued crew session. A queue could sit behind failed, stopped and
  unmerged phases while only two crew sessions ran.
- **The line comes back while the phase stays stuck**: every three times `crew.quietMinutes`
  (an hour by default), and at once when what holds it changes. A lead that read it once and
  went on used to hear nothing more.

## 1.11.1

Each session goes through its own parked items.

**What to run** after the update: nothing. A session started before the update reads the old
skill until it restarts.

What changed:

- **`/cc-smart-dev-kit:user-available` asks about this session's items only.** The parked list is
  the machine's, and the skill used to go through all of it, so two sessions brought back at
  once asked the person each other's questions, in projects that were not their own. Now
  `user list --json` says whose each item is (`whose`), judged for the session that asks:
  `this session` (it parked it, it leads the crew session the item is for, or the session that
  parked it ended in this project), `another session` (a running session owns it, named in
  `waitsIn`), or `no session` (its session ended in another project). The skill goes through
  its own, names the sessions that hold the rest, asks once about items nobody owns any more,
  and never clears another session's item.
- **`user available` and the "available again" note count this session's items**, and name
  the sessions that hold the others. The text view of `user list` says who answers each item.

## 1.11.0

Three task layers, a type on each task, blocked-by, and a Tasks tab in the portal (D76).

**What to run** after the update: restart Claude Code, so each session's task server is the new
one. Nothing else: the task store takes its new column by itself on the first write, and a
session still on 1.10.x keeps reading and writing it. Until it restarts, such a session (and a
lead's watch started there) treats every task as blocking: its merge drops non-blocking work
too, and its crew gates wait for it. That is the 1.10.x rule, stricter, never looser.

What changed:

- **Three layers: phase › task › subtask.** A task's layer comes from where it sits: under a
  phase or at the top it is a task, under a task it is a subtask. Nothing goes under a subtask,
  and a task with subtasks cannot move under another task; each refusal says where the task
  fits instead. A store an older version nested deeper still reads.
- **Blocking or non-blocking.** `task_create` and `task_update` take `type`. A blocking task
  (the default, and every task from before) must be done or dropped before its parent is done.
  A non-blocking one holds nothing: the crew session's Stop and its done report, the lead's
  Stop and `task_done` wait only for blocking work. A crew merge leaves non-blocking work open,
  for whoever picks it up, and a session start lists it. A removal drops the crew session's own
  open work and hands the steps its lead laid out back to pending, for the next `crew start`.
- **Blocked by.** `blocked_by` on create, `blocked_by_add` and `blocked_by_remove` on update
  (they were `waits_for`): a task cannot start or be done while a task it is blocked by is
  open. A cycle is refused, and so is a task blocked by a task above it, or by a task that
  waits for one, which could never finish. `crew start --waits-for` fills the phase's
  blocked-by list, as before.
- **A lead lays out its phases ahead of its crew.** `task_create` with `phase` (and `plan`, the
  lead's own when left out) makes the phase under the plan task, once; `crew start` for that phase
  takes it over with the tasks the lead put under it, and the crew session's card lists them.
  They answer the lead's reminder, but never hold its Stop while the phase is open: they are the
  crew session's to work. A phase id `crew start` would refuse is refused here too.
- **The command:** `task add` takes `--type`, `--blocked-by`, `--phase` and `--plan`; the new
  `task set <ref>` changes a task's type, its blockers (`--block`, `--unblock`) or its parent
  (`--parent`, `--top`).
- **The lists say it:** `task_list`, `task_get` and the session-start block mark a
  non-blocking task and a blocked one (`[pending · non-blocking · blocked by #3]`); `task_get`
  names the layer and lists the blockers with their status; a task's history records a change
  of type.
- **The portal's Tasks tab** shows every project's work as phase › task › subtask, each with
  its layer, its type and what it is blocked by, beside the project task files.

## 1.10.1

Fixes for `task import claude-mem`, the lead's watch and `crew stop`.

**What to run** after the update:

- In each folder where you ran `cc-smart-dev-kit task import claude-mem` before (often your
  home folder): run it again, first with `--dry-run` to see what it drops, then without.
- Nothing for the watch: each lead's watch ends by itself once the new version is installed,
  and says to start it again; the watch you start has the fix.

What changed:

- **The lead's watch stops repeating a crew session that waits to come back.** A resume the
  launch gate held said its reason again whenever the text changed, and the text holds live
  numbers (the load, the seconds left), so each waiting crew session said a new line on every
  pass, and each line woke the lead. Now each kind of wait (the load, the memory, a cap) is
  said once while the wait lasts, even when it flips between two kinds, the spacing between
  launches is never said, and a wait is said again only after it ended (the session came back,
  or was stopped). The same holds for a paused session's `not resumed` line.
- **`crew stop` ends a resume that waits for room.** A `crew answer`, `crew note` or
  `crew resume` the launch gate held leaves the resume waiting, and the watch started it once
  the machine had room, even after the lead stopped that crew session. The stop now ends the
  wait, also when the watch was about to start it, and its line says so, a failed stop's too.
- **The import leaves claude-mem's own lists out.** claude-mem keeps its own data (focus
  areas, rules, owner goals, and a record of each subagent: the lists `my-focus`, `my-rules`,
  `owner-goals` and its month lists, and `agent-lifecycle`) in work state too. 1.10.0 took
  them in as open work, so a session started in that folder listed them as its tasks. The
  import now says it left them out, and a second run drops what an earlier import took from
  them, each with a note that says why. A list a session added to or changed stays open, and
  the run names the tasks to look at. The repair works without claude-mem installed.
- **The import reads claude-mem's lists as claude-mem does:** in its own order, with the
  project name in any case, and `completed` and `failed` closed too. A list is imported once,
  whatever the case of the project name; a long name is cut on whole characters, never through
  an emoji; and a claude-mem database with no work-state table counts as having no lists.
- **An imported task keeps claude-mem's dates.** An item claude-mem last touched long ago now
  counts as stale (`tasks.staleDays`), so a session start counts it instead of listing it.
  This holds for lists imported from 1.10.1 on: a list 1.10.0 imported keeps the import's
  date.
- A name longer than a task subject may be is cut, and kept whole in the description.
- `--dry-run` refuses what the real run refuses: it makes the writes and rolls them back.
- The import's list shows each item indented under its list again.

## 1.10.0

The kit's own task list (D75), and leads and crew sessions that keep going. Work had too many
homes: Claude Code's task tools (off on new models unless opted in, keyed by session id),
claude-mem's work state, and the notes folders a project kept by hand, which went stale.
Now one task list holds all of it, through one set of tools. And some models end a turn after
each step and only say what they will do next: a lead could sit idle for hours that way.

**What to run** after the update:

- `cc-smart-dev-kit setup`. It registers the task server, asks in your terminal before it
  allows the server's tools without a prompt, hides Claude Code's own task tools, and turns
  claude-mem's work state off (a `"true"` you set after that stays). `restore` undoes each.
- Restart Claude Code to load the new hooks and the server.
- Move your open claude-mem lists once: `cc-smart-dev-kit task import claude-mem --dry-run`,
  then the same without `--dry-run`.
- A project that uses the new `tasks` field in `.claude/cc-smart-dev-kit.json` raises its
  `requires` to `>=1.10.0` (`project init` does it).

What changed:

- **Two stores, one set of tools.** Work tasks (a session's steps, with subtasks and notes)
  live in a local SQLite database that every worktree of a project shares. Project tasks
  (what production, the database or a teammate still owes, and follow-ups) are Markdown files
  in the repository, in `.claude/tasks/`, so they ship with their branch and pass review. The
  task's kind picks the store.
- **An MCP server** with eight tools: `task_create`, `task_update`, `task_done`, `task_note`,
  `task_list`, `task_get`, `task_search`, `task_delete`. It loads with every session and every
  crew session, with no ToolSearch. A task belongs to the Claude process, so `/clear` and a
  background fork keep their tasks.
- **Every task keeps its history.** Each change is recorded with its time, the values before
  and after, and who made it: the session's name and id, its crew and process, or the kit's
  own reason (a merge, a removal, an import). `task_get` and `task show` print it as a
  timeline; `--history` adds every earlier description in full. A deleted task keeps its
  history and its number: `task show #n` still prints it, and no new task gets that number.
  A project task's history is its file's git log.
- **`cc-smart-dev-kit task`** runs the same operations from a terminal, plus `check` (stale,
  missed-release, broken and duplicate task files), `release` (what a release must do, by
  weight), `list --branch` and `--branches` (task files on a branch, for a pull request's
  notes), and `import notes` to move a project's old notes folders.
- **Crew sessions work through phase tasks.** `crew start` makes one per phase (queued ones
  too); a continuation keeps it and takes over its predecessor's subtasks; a merge closes it
  done and a removal drops it. A phase started again after a removal or a merge opens again,
  and the old crew session's closed subtasks stay as its record without counting for the new
  one. A crew session breaks its phase into subtasks before its first edit, cannot hand back
  done while one is open, and its board row shows `closed/total`.
- **Session start** lists the project's open work (eight lines at most; stale work is counted,
  not listed). The status line shows the task in hand and its progress.
- **The portal** has a read-only Tasks card on each project's page and a phase card on each
  crew page. Both update by themselves when a task changes.
- A lead's turn that ends while one of its own tasks is in progress, and with no line that
  starts with `Waiting for:`, is blocked once. The block names the task and says to go on with
  it. A turn that really waits ends on one line, for example `Waiting for: C1's hand-back`. A
  lead with no task in progress, or whose task list cannot be read, is never blocked.
- A crew session's turn that ends on a step while a subtask is still open is told to go on
  with it, not to hand back. With every subtask done, the block gives the report line.
- The lead skill says it plainly: never end a turn on a promise of the next step.
- For this one release the guards also read Claude Code's own task list, so a machine that
  updated before running setup is never stuck. Once setup has run, that list no longer counts:
  its tools are denied, so a task left open there could never be closed. Move anything still
  open on it to the kit's list (`task_create`).
- A Stop block and a refused done report name the exact call that closes the task (`task_done`
  with the task's number, or `cc-smart-dev-kit task done #12`), so any model can follow it.

## 1.9.0

Desktop and crew reliability: lazy browser startup, low-priority heavy jobs, and a lead that
can recover its crew after its session id changes.

**What to run** after the update:

- Restart Claude Code to load the new plugin. A lead moved to the background may receive a
  new session id: run `cc-smart-dev-kit crew lead --plan <plan>` there to recover its crew.
- A lead whose `crew watch` was already running starts it again once: a watch from before
  1.9.0 keeps its old code until it ends.
- Linux heavy jobs use idle CPU priority by default. `job set cpu-weight off` opts out; older
  systemd versions that refuse idle use weight 10 instead. No CPU quota is imposed.

What changed:

- Chrome starts on the first browser tool call, not when the MCP server connects. Token
  checks remain required, and `browser check` keeps its existing behaviour.
- `crew lead` adopts a same-plan lead only when its session is proved absent. Live competing
  leads are refused. Watches and prompt notes follow earlier session ids.
- Crew questions remain open independently, with numbers. Answer one with `crew answer
  <name> --question <n>`; long answers and notes accept `--file <path|->`. `crew note` reaches
  queued, running and stopped crew sessions. The portal displays every open question.
- `crew log <name>` shows branch commits and the diff stat. `crew list` hides removals older
  than six hours; `--removed` includes them, and JSON stays unfiltered.
- Lead guidance explains monitor expiry and re-arming, the first push before merge checks,
  and review of changes made after a review. Empty file globs produce a warning.
- An earlier copy of a crew session that Claude Code brings back after a restart now stands
  down. It changes nothing in the store, its own commands are refused, and the lead's watch
  stops it. Before, such a copy could fail the record of the copy that was really working.
- A bare `crew lead` takes the lead with this session's name first, then one in this folder.
  Only a lead that still has open crew counts, so an empty old lead never gives this session
  its plan. Matches that span more than one plan are refused, with the candidates listed. When
  a lead still counts as running, the refusal says why (its session record, agent view or its
  watch) and how to get past it.
- A running session whose start identity cannot be proved counts as running, never as gone.
  So the cleanups, `sessions` and `crew lead` keep working when a record has no `procStart`.
- The adoption summary is said once per adoption, not again at each re-armed watch. Crew
  sessions no longer get the lead's adoption hints. A crew report whose here-doc a guard
  refuses goes through a file instead (the crew skill says how).
- Idle CPU priority goes only on the kit's own slices, never on a parent such as `app.slice`.
  Where systemd refuses idle, weight 10 is used and said once per machine. `job status` says
  so, and a systemd upgrade tries idle again. A weight 1.8.1 put on a parent slice was a
  runtime setting: it goes at the next login.
- A running `crew watch` ends when a newer plugin version is installed, with the line that says
  to start it again. Before, a lead session that never restarted kept running the old watch code
  for days. A watch started before 1.9.0 has no such check: after this update, start each
  running lead's watch again once.
- A project can name its own rebuildable ignored paths: `worktrees.rebuildable` in
  `.claude/cc-smart-dev-kit.json` (needs `requires` 1.9.0). Crew removal, release and the
  worktree cleanups treat a match like `node_modules`, so a tool's cache folder no longer keeps
  a finished crew worktree forever. A pattern matches at any depth; one that names nothing
  (`*`, `**`, `.*`), uses `\` or starts with `./` is refused.

## 1.8.1

Fixes found while the 1.8.0 limits were put to work on a real machine.

**What to run** after the update:

- In each repository with crew sessions, look for a removed worktree's folder that came back:
  `ls .claude/worktrees/`, then, for a folder `git worktree list` does not show, check that it
  holds only `.claude/plans/<plan>/runs/*.json` (`find <folder> -type f`). If so, remove it. Until
  then, the run records of that plan keep being written there.

What changed:

- `crew rm` (and every other change to a crew record) no longer makes a removed worktree's folder
  again, and neither does `crew history --backfill`. A lead that kept its plan inside its own
  worktree lost that folder when the worktree went; the next change to one of its crew records
  wrote a first run record there, and the folder came back holding only
  `.claude/plans/<plan>/runs/`. Now no first run record is written once the plans folder that held
  the plan is gone.
- `crew rm --discard` works when the crew session's worktree folder was deleted by hand. Its
  branch is checked out again in a new worktree at the same path, then the usual preview, question
  and archive follow. Before, it refused with "discard has no saved archive", and plain `crew rm`
  refused the unmerged branch, so the record could not go. Claude Code's own lock on the gone
  worktree is released first; a lock you took refuses, and so does a branch checked out in another
  worktree. With neither a worktree nor a branch, the discard says to run plain `crew rm`. A
  preview without `--yes` says that the folder it made again stays.
- `doctor` no longer fails the instructions check when only the copy's version stamp is old and
  every file matches. The line passes and names the old stamp; the next session start or
  `cc-smart-dev-kit setup` brings it up to date (setup then says "Nothing to change", as before).
- The portal's Machine page names what each job holds: a heavy slot, a light slot or a name.
  It said "a slot" for a light run too. `/api/jobs` gives each job its `lane`, and
  `cc-smart-dev-kit job status` says "a heavy slot" where it said "a slot".
- The builder and rules-maintainer agents load the deferred task tools before they make a task
  list, and go on without one when the tools are not there.

## 1.8.0

Many crew sessions, installs and test runs could start at once and freeze the machine: after a
restart, resumes skipped the start gate, the load reading lagged behind a burst, and small test
runs and installs took no slot. Every launch now goes through one gate, a minute apart, and every
run takes a slot. The crew limits are now the machine's alone.

**What to run** after the update:

- In each lead session that is running, end its crew watch and start it again (the
  `cc-smart-dev-kit crew watch` command, with Claude Code's `Monitor` tool): a watch keeps the
  code it started with.
- `cc-smart-dev-kit doctor` in each project. When the project's `.claude/cc-smart-dev-kit.json`
  still sets a crew limit, doctor says which one: the value is ignored now. Set it for your
  machine instead, for example `cc-smart-dev-kit workflow set crew.max 12`, and take it out of
  the project file: `cc-smart-dev-kit workflow unset --project crew.max`.
- Only if a default below is wrong for your machine: `cc-smart-dev-kit workflow set
  crew.startGapSeconds <n>`, `cc-smart-dev-kit job set light-jobs <n>`, `cc-smart-dev-kit job set
  start-free-gb <n>`. Run these only once every open Claude Code session runs 1.8.0: restart the
  older ones first. A session on an older version refuses a `jobs.json` or `workflow.json` that
  holds a setting it does not know: its routed heavy commands fail, its kit commands stop with
  an error, and its hooks fall back to the project's values and the defaults.

What changed:

- **The crew limits are the machine's (D71).** `crew.max`, `maxOpus`, `perLead`, `perLeadOpus`,
  `memoryGb`, `loadPerCore`, `usagePercent` and the new `startGapSeconds` are read from your own
  `workflow.json` only. A project file that sets one still loads; the value is ignored, and
  `doctor` says so once, with the command that takes it out (`workflow unset --project`).
  `workflow set --project` and `workflow propose` refuse them, with the command to run instead.
- **Safer defaults.** `crew.max` 24 → 12, `crew.memoryGb` 2 → 6, `crew.loadPerCore` 3 → 1.5. A
  value you set yourself stays.
- **One gate for every launch, a minute apart (D72).** A start, a queued start, a hand-off's
  next crew session and every resume (`crew resume`, `crew resume --paused`, `crew answer` to a
  stopped session, the watch's paused recovery) ask the same gate under the same lock. A launch
  waits until the machine's last one is `crew.startGapSeconds` old (60 by default), across every
  repository, so the load reading catches up. A resume the gate refuses waits, and `crew resume`
  says why and exits 0; an answer to a stopped session is kept and delivered when it resumes.
  `crew model` replaces its own process and is not held. A launch that started nothing gives its
  time back.
- **A crew session closed in agent view frees its place (D73).** The lead's watch marks a running
  record whose session is missing from agent view in two passes a minute apart as `stopped`: the
  watch's own stop, so a merge after it clears it as the watch's own. A row that comes back
  restores it. An agent view it cannot read changes nothing.
- **Small runs take a slot of their own (D74).** An install (`bun install`, `npm ci`, `pnpm add`,
  a bare `yarn` and the like: the new `install` kind) and a test run on at most 10 named files
  take one of `lightJobs` light slots (2 by default) instead of running at once. Light and heavy
  runs never wait for each other. More than 10 files take a heavy slot, and so does a line that
  installs and then runs a heavy job (`bun install && bunx next build`). A light run gets the kill
  mark, never the heavy slice.
- **A job waits for free memory while another one runs (D74).** Below `startFreeGb` (4 by
  default) a new heavy or light run waits until the running job ends or memory frees up. With
  no job running it starts, so a small machine never waits for ever.
- `job status` and the portal's `/api/jobs` show the light slots and the free-memory rule. A job
  kind's new `light` field comes with 1.8.0: a project that sets it raises `requires` to `>=1.8`;
  so does a project that sets `crew.startGapSeconds`.

## 1.7.2

Finished crew sessions whose process had already stopped stayed in agent view for good. They
leave it now, and a crew session keeps the name its lead gave it.

**What to run** after the update:

- In each lead session that is running, end its crew watch and start it again (the
  `cc-smart-dev-kit crew watch` command, with Claude Code's `Monitor` tool): a watch keeps the
  code it started with. Its next passes release the finished crew sessions that stayed.
- `cc-smart-dev-kit sessions --finished --remove` releases, after one question, the finished
  crew sessions that no running watch looks after.

What changed:

- **A stopped crew session leaves agent view.** `claude stop` leaves a row `done` with no
  process. The watch read such a row as a running session, so it never released it, and
  Claude Code's own ctrl+x refused it because its worktree held commits on no remote. The watch
  now judges a row by its process, as a resume does, and releases it: the worktree goes, the
  branch stays, and the row goes.
- **A stop that did not hold is made again.** A session that still has a process a minute after
  the watch stopped it is stopped again, without a second line, so it can be released.
- **`sessions --finished` asks whether a watch really runs.** It lists a finished crew session
  when no live watch of its lead holds the lead's watch lease: a stopped or gone lead, or a live
  lead whose watch is not running. Before, a live lead with no watch kept its crew sessions in
  agent view, and a lead agent view no longer listed waited a full day. The heading now says
  "no watch releases".
- **A crew session should keep its name.** Its settings set `CLAUDE_CODE_DISABLE_TERMINAL_TITLE=1`,
  which Claude Code's docs say skips the title it writes for a session — the title that replaced
  some crew sessions' names in agent view. A live proof is still owed. Crew sessions started
  before this version keep their old settings when resumed.
- **A blocked crew session stopped from outside frees its place.** One stopped with `claude stop`
  or from agent view is recorded `stopped` at its idle stop, as before, with nothing left to stop.

## 1.7.1

Two kinds of finished crew session still stayed in agent view after 1.7.0. Both leave it now.

**What to run** after the update:

- In each lead session that is running, end its crew watch and start it again (the
  `cc-smart-dev-kit crew watch` command, with Claude Code's `Monitor` tool): a watch keeps the
  code it started with.
- `cc-smart-dev-kit sessions --finished --remove`. It releases the finished crew sessions of
  leads that are stopped, failed or gone, after one question.

What changed:

- **A merged crew session that waits leaves agent view too.** A merged crew session whose
  removal is held — one you stopped before its merge, left for your `crew rm`, or one kept until
  its chain's later parts merge — is released while it waits: its worktree and rows go, its
  record and branch stay, and the removal it waits for still deletes the branch. The watch does
  it; for a lead that runs no watch, `sessions --finished --remove` does.
- **A row left without its worktree goes.** A crew session whose worktree went before its
  `claude rm` is released while agent view still lists its row.
- **A stopped or failed lead's crew sessions are released at once.** Such a lead runs no watch,
  so `sessions --finished --remove` now releases its finished crew sessions without waiting; a
  lead agent view no longer lists still waits a full day. The heading says "whose lead is
  stopped or gone".
- **A release stops only a session that runs.** One that agent view shows with no process is not
  stopped again, and the release's line says only what it removed.

## 1.7.0

Finished crew sessions leave agent view at once, so a lead session is easy to find again. A
crew session's conversation now follows a timeline: 7 days in `/resume`, then the kit's
archive, deleted 30 days after the session ended. A hand-off's next crew session no longer waits
for the CPU load.

**What to run** after the update:

- In each lead session that is running, end its crew watch and start it again (the
  `cc-smart-dev-kit crew watch` command, with Claude Code's `Monitor` tool): a watch keeps the
  code it started with, and only the new one releases finished crew sessions.
- `cc-smart-dev-kit sessions --finished --remove`. It releases the finished crew sessions of
  leads that are gone (no watch of theirs runs any more), after one question, and runs the
  conversation timeline once.

What changed:

- **A finished crew session leaves agent view at once (D69).** Claude Code's `claude rm` keeps
  a background session's row while its worktree holds commits that are on no remote, and a crew
  session never pushes. So every finished crew session stayed in agent view until the lead
  merged its branch, and the rows piled up. Now the lead's watch *releases* a `done`, `handoff`,
  `failed` or `stopped` crew session as soon as agent view shows no process for it: the
  worktree goes and `claude rm` removes its rows, while **its branch, its record and its
  conversation stay**. The lead merges from the branch as before. `crew resume`, or an answer
  that resumes it, makes the worktree again first. Uncommitted work, or a local file git does not
  keep, holds the worktree and its row; the watch says so once, with the fix. A `blocked` crew
  session stays until its idle stop. Both Claude Code behaviours this rests on are proved live
  on 2.1.314 (`docs/claude-code-contract.md`).
- **The conversation timeline (D69).** A crew session's conversation stays in `/resume` for
  `crew.archiveDays` (7) after its session ended, then moves to the kit's gzipped archive; the
  archive is deleted `crew.deleteDays` (30) after the same end. Before, the conversation moved
  at the removal and the archive went 7 days later. A resume puts an archived conversation back
  first. The lead's watch runs the timeline at most once an hour, and `sessions --finished`
  lists the date each conversation moves and each archive goes.
- **New setting `workflow.crew.deleteDays`** (default 30, never below `crew.archiveDays`). A
  project that sets it needs `"requires": ">=1.7"`.
- **`crew.archiveDays` means something new.** Before, it was how long the archive kept a
  removed crew session's conversation; now it is how long the conversation stays in `/resume`.
  A file that set it above 30 keeps working: with no `deleteDays` beside it, `deleteDays` rises
  to the same number, so the conversation is still kept that long in all.
- **A release that `claude rm` could not finish is finished later.** The record says released
  once its worktree is gone, so a resume still works, and the watch runs `claude rm` again while
  agent view lists its row. A hand-off whose session its next crew session could not stop is
  stopped by the watch, then released. `crew rm --discard` of a released crew session makes its
  worktree again on the kept branch first, then discards as before.
- **A hand-off goes first (D70).** The next crew session of a hand-off takes the place the
  session that handed off left, so the CPU load no longer holds it, and it starts before any
  queued new phase. Memory, the session caps and the usage window still hold it. New phases
  still wait for the load.
- **Logs are safe to lose.** An ignored `logs/` folder and ignored `*.log` files no longer keep
  a finished worktree (and its agent-view row): they come back by themselves. A folder of
  ignored files is now judged file by file, so a log beside a file of yours still keeps it, and
  a folder named like a log file (`app.log/`) is read, never taken whole.

## 1.6.0

claude-mem's to-do list is back. Each session starts with claude-mem's work state again: its
to-do lists, with what is still open, kept across sessions in each project.

**What to run** after the update:

- `cc-smart-dev-kit setup`. It takes out the `"false"` that 1.0.0 to 1.5.0 wrote into
  `CLAUDE_MEM_WORK_STATE_ENABLED` in `~/.claude-mem/settings.json`, so claude-mem's own default
  (on) applies again. Until you run it, `doctor` shows a ✗ for that line.
- To keep work state off, set `CLAUDE_MEM_WORK_STATE_ENABLED` to `"false"` again in
  `~/.claude-mem/settings.json` after setup ran. Setup leaves a value you set alone.
- Start a new Claude Code session: claude-mem's work-state tools (`work_state_write`,
  `work_state_read`) come with a new session.

claude-mem's start blocks (D68, which replaces D23 for work state):

- **Work state is on again, and the memory-use block stays off.** D23 turned both blocks off:
  together they went over Claude Code's 10,000-character limit for a hook's output in about one
  start in six. The overflow came from the memory-use block alone. claude-mem caps its
  work-state block at 3,000 characters, and fits its memories into what is left of the 10,000.
  It keeps no such room for the 2,466-character memory-use block. Measured on one machine: 7,053
  characters with work state on.
- **Which to-do list.** A session uses claude-mem's work state. A lead and a crew session use
  Claude Code's own task list (`TaskCreate`), because the kit's hooks read it: the crew-role
  step and the lead's reminder now say so. Without claude-mem, every session uses Claude Code's
  list (the memory-routing skill).
- **Claude Code's task tools are on for every machine.** `setup` sets
  `env.CLAUDE_CODE_ENABLE_TODO_TOOLS` to `"1"` with or without claude-mem. Before, it did that
  only while work state was off. `doctor` checks it on every machine, in the plugin group.
- **Sessions save notes as they go again.** claude-mem's memory-use block, which stays off, also
  told a session to save its own notes. The kit's instructions now say it in one short rule:
  where claude-mem is installed, the main session saves a decision and why, a surprise, a dead
  end or a preference with `save_memory` when it happens, and a to-do with `work_state_write`
  (a lead uses `TaskCreate`). A subagent saves nothing. claude-mem itself is asked to count the
  memory-use block in its budget
  ([thedotmack/claude-mem#5180](https://github.com/thedotmack/claude-mem/issues/5180)), so the
  block can come back once a release does.

## 1.5.0

Faster work under Claude, native Windows fixed end to end, and crew sessions that keep their
monitors. A project that sets a job kind's `noSlotForFiles` asks for `>=1.5`.

**What to run** after the update:

- On a machine with the gateway: `cc-smart-dev-kit gateway setup`. The router changed (the
  message-thread fix and the judge's stand-in below); setup asks before it restarts the router.
- On native Windows: `cc-smart-dev-kit setup`, which rewrites the instructions' import line
  (below). Where `gateway setup` failed with "The task XML is malformed", run it again.
- If you turned the judge's stand-in off on 1.2.0 to 1.4.1, run
  `cc-smart-dev-kit gateway fallback judge off` again: off was the default then, so it was never
  saved, and 1.5.0 turns the stand-in on (below).
- Restart the Claude Code sessions that were running before the update, leads first: a session
  started before it keeps 1.4.1's hooks, and a lead's watch keeps 1.4.1's code. Such a session
  reads your `workflow.json` as broken once you set `switches.jobRoute` (below), and its watch
  does not see a crew session paused for the safety checks.

The heavy-job queue:

- **It counts jobs, not gigabytes.** Up to `maxJobs` heavy jobs run at once (default 3,
  machine-wide; `cc-smart-dev-kit job set max-jobs <n>`), and each one may use the whole
  machine: no per-kind size, no worker cap added to a test runner, normal CPU and disk priority
  (`job set cpu-weight`/`io-weight` make them give way). A kind's old size fields (`gb`,
  `filesGb`, `maxFiles`, `workers`) still parse and are ignored; `doctor` says they can go. On
  Linux the slice's memory ceiling stays, now keeping 8 GB free by default (it was 22).
- **The route has a personal switch.** `switches.jobRoute` in your own `workflow.json` turns the
  route on for every project; a project's `jobs.route` wins over it. `job status` and the
  portal's Machine page say whether the route is on and who set it.
- **A heavy command piped into a read-only filter is queued** (`tsc --noEmit 2>&1 | tail -20`):
  only the heavy step goes into `job run`, the filters stay outside it as written, so your own
  Bash rules still see them. A `tee` to a file, a `sed -i`, an option that writes a file or runs
  a program (`sort -o`, `rg --pre`) or a filter before the heavy step is not a filter. The shell
  reader every guard shares now keeps the `&` of `2>&1`, `>&2` and `&>` inside the redirection.
- **A heavy PowerShell line is refused while the route is on**, with the exact Bash line to run
  instead (it would not wait for a slot); only where the Bash tool can exist.
- **A test run on named files runs at once.** A kind with `noSlotForFiles` (the default
  `test:run` has it) takes no slot for a run whose operands are only existing files; a folder,
  a filter word, a coverage run or an option the kit does not know still waits. `skipWords` and
  `valuedFlags` are read again for it.

Checks and instructions:

- **Check what you changed; the full check runs once.** The instructions, the builder agent and
  the verify, lead and crew skills now say: run the type check, lint and tests on the changed
  files while you work, and the project's full check once — before a crew session hands back,
  and before the lead pushes.
- **No forced `max` effort on a backend.** A subagent or crew session on an affordable backend
  takes the effort its task needs, like any other; pin one with `gateway effort`.
- **The plugin's agents get every tool of the session**, MCP servers included (a reviewer can
  read a dev database), less a short deny list: the read-only agents cannot edit or ask you, the
  builders cannot ask you.
- **The agent panel's status line shows each subagent's context use** beside its model and
  effort.

The gateway:

- **A backend never gets a message-thread continue.** Claude Code may send only the new part of
  a conversation and point at the earlier one; a backend keeps no thread, so after a switch
  onto a gateway model it lost the conversation, the tools and the system prompt until the
  session restarted. The router now answers such a request with Claude Code's own
  `thread_unsupported_request`, and Claude Code resends the whole turn.
- **The judge's stand-in is on by default** (it was off since 1.2.0). Claude judges auto mode's
  safety checks first; while it is limited or down, a worker target that passed the judge test
  stands in. `gateway fallback judge off` turns it off. A judge chain of your own with two or
  more targets now also tries the next one by default.
- **When the safety checks fail and nothing stood in, the kit says so**: in the status line,
  `gateway status`, `doctor` and one line to the session, with the cause and the one command
  that fixes it. The session is told it cannot fix this itself: say it once and wait.

Crew sessions:

- **Every prompt the kit gives a crew session starts with `/cc-smart-dev-kit:crew`.** Claude
  Code starts a plugin's monitor only when its skill runs, once per process, and not on
  `--resume`, so a resumed session lost its monitor. The answer and tell commands print the
  `ToolSearch select:SendMessage` step first, because SendMessage is a deferred tool.
- **The lead's watch holds up**: it survives a busy store, one `--once` watch acts per lead (a
  lease), a backend's refusal no longer reads as `failed`, the last API error stays on the
  record, and a lead whose watch ended is told how to start it again (Claude Code's Monitor
  tool). Claude Code 2.1.310's changelog says monitors now run with telemetry off, so the kit's
  telemetry fallback is gone (not yet proved live).
- **A crew session pauses while auto mode's safety checks are down** instead of being blocked
  for a missing report, and the watch resumes it when they answer again.
- **Remote Control is off in a crew session** (`remoteControlAtStartup: false` in its settings).
- **The person's prompt is told apart better**: a resume after `crew model` or a corrected
  answer is the lead's, not yours; the verify gate no longer counts the lead's own monitor as
  background work.

Guards:

- **A message to a session of another repo asks you** (it was refused), naming that session's
  folder; a crew session's is refused with the step to its lead. The guard judges it even when
  the project's file needs a newer kit, instead of a blanket question.

Native Windows:

- **`gateway setup` registers the router's task again.** The task XML it wrote was refused
  ("unable to switch the encoding").
- **The instructions load.** The `@import` line setup writes into `CLAUDE.md` now uses `/`;
  with `\` Claude Code never read the file.
- **A lead finds its own session**, so `crew lead` and `crew start` work: the kit reads the
  session from Claude Code's environment first. Crew sessions and their monitors run on native
  Windows through Git Bash (proved live on 2.1.310). `crew rm --discard` is still refused there
  (the worktree's mount points cannot be read).

## 1.4.1

- **`gateway setup` no longer reads the old portal's `portal.json`.** Up to 1.0.1 the portal
  kept the opus and fable chains, the judge chain and their fallback switches in that file.
  1.1.0 moved them into `gateway.json`: `gateway setup` saved them in `kept` and took them out
  of `portal.json`, and it kept that read in six releases (1.1.0, 1.1.1, 1.1.2, 1.2.0, 1.3.0
  and 1.4.0). Setup now leaves the file as it is, byte for byte, and moves nothing from it.
  `cliPaths()` no longer has `portalStateFile`. A machine that updates from 1.0.x or older
  straight to 1.4.1 keeps those chains only in `portal.json`, which nothing reads now (`migrate`
  does not move it): set each chain again with `cc-smart-dev-kit gateway slot <slot> <target>[,…]`.
- **The tested Claude Code is now 2.1.310** (it was 2.1.308). CI's validates and the weekly job
  run their validates on that version, and the weekly job compares the newest release with it.
  The validates and `doctor --live` pass on 2.1.310, and the contract rows they prove show it.
  Not yet proved: 2.1.310 says plugin monitors now run with telemetry off too; the kit still
  assumes they do not (the lead's watch falls back to polling, so nothing breaks).

## 1.4.0

GitHub Issues, opt-in: the kit can file its follow-ups and findings as issues in your project's
own repository, instead of losing them as a line in a summary.

- **A new switch, `workflow.issues`, off by default.** `enabled` is the switch; `allowPublic` is
  the second yes a *public* repository needs; `foundLabel` (`kit:found`), `fixedLabel`
  (`fixed-unreleased`) and `readyLabel` (`kit:ready`) name the labels the kit uses. Like
  `autoPush`, it is read from your own file and from the project's file **as committed on the
  base**, never a working copy, and `workflow set`/`unset` of the two switches refuse inside
  Claude Code. A project file that sets it asks for `>=1.4`.
- **`cc-smart-dev-kit issue file`** files one finding (`--title`, `--body-file`, `--fingerprint`,
  `--label`) and prints one line: `filed #<n> <url>`, `updated #<n> <url>` or `refused: <why>`.
  The same fingerprint again updates the issue instead of opening a second: the key is hashed
  into a hidden comment at the end of the body, and the kit finds it by listing the issues that
  carry the found label once. It writes only to `origin`'s repository (on github.com), says
  `public` when it posts to a public one, and **refuses, with the line and column and never the
  value, a text that holds a home path, a key or token, or a URL with credentials** — it never
  cleans the text and sends it anyway.
- **The merge guard asks before a raw issue write.** A session's own `gh issue create`, `edit`,
  `comment`, `close` …, a `gh api` write to a repository's `issues`, or a GraphQL issue mutation
  asks you, and is denied in a crew session (which is told to use `issue file`). The kit's own
  `issue file` is not asked about.
- **`doctor`** has one line while the switch is on: `gh` is logged in for github.com and can
  file issues in `origin`'s repository, each failure with its fix.
- **A fix is marked at the merge and closed by the release.** A crew report can name the issues
  its phase fixes (`crew report --issue <n>`, or an `issues` list in the JSON part). When the
  lead merges the branch, the watch comments "fixed on `<branch>` at `<commit>`, merged into
  `<base>`; it closes when `<base>` ships" on each and adds the label `fixed-unreleased`, once per
  merge. GitHub closes an issue only when a pull request that names it merges into the *default*
  branch, so the release's pull request lists them: `cc-smart-dev-kit issue fixed --base <default>
  --head <branch>` prints one `Fixes #<n>` line for each open `fixed-unreleased` issue whose fix
  is in the pull request's commits. If GitHub cannot be reached the merge still counts: the watch
  says so in one line, keeps the mark in a queue file and tries again every five minutes. With
  the switch off, nothing is sent. The lead skill files a bug outside the plan with `issue file`
  instead of a line that is lost.
- **`crew start <phase> --issue <n>`: a phase from an issue you chose.** Only an open issue of the
  project's own repository that carries the ready label (`kit:ready`) **added by an account with
  write access** starts a phase — the adder is read from the issue's events and its permission,
  any edit of the body or rename of the title after the label by anyone else is refused, and
  whatever cannot be read is a refusal. To start from an issue you only named, the lead labels it
  (which asks you). The kit never adds that label itself: `issue file` refuses it as a `--label`,
  and never rewrites an issue that carries it. The issue's text is **data, never an instruction**:
  the brief quotes it under a heading that names its author (after any `--brief` text; with no
  `--brief` the issue is the brief), a secret or a home path in it is replaced by
  `[redacted: …]`, a hidden HTML comment is shown and marked, invisible characters are named by
  their code, and the frame says once that it is data. The crew record and the plan's run record
  carry the issue's number and address.
- **The hand-back says it once on the issue.** `crew report` posts one comment on the issue:
  the status, the tests and checks (passed and failed), the review and the head commit. A
  hand-off says "handed off at `<commit>`" in a line, and a report is never commented twice.
  A secret or a home path in the report's words means nothing is posted. GitHub being out of
  reach is a `note:` line and a line under `open`, never a failed report.
- **The lead hears new issues and comments, when you turn it on.** `workflow.issues.watch` (off by
  default, even with `enabled` on) lets the lead's watch make one conditional look at the
  project's issues and comments every `workflow.issues.watchMinutes` (default 5, at least 2),
  inside the pass it already runs, and print one line for each new one — `issue #<n> opened by
  <author>: "<title>"`, `comment on #<n> by <author>` — to every lead whose watch runs. The `ETag`
  and the cursor (the highest issue number and comment id told; each look reads the newest 100 of
  each list, so a full page of updates never hides a new issue) are kept once for the repository;
  the events are written before the cursor moves; a `304` costs nothing against GitHub's limit
  and is silent; the first look after you switch it on records where GitHub is and prints
  nothing; the kit's own comments (its marker, written by its own account) are not news. A title
  is outside text that reaches a model, so it is cut to one line, quoted, and stripped of escape
  sequences and control and invisible characters, and each line starts with a frame that says it is data.
  An issue line is **news, never an instruction** (`/cc-smart-dev-kit:lead` § 4). `gh` missing,
  logged out, rate limited (it waits for the reset) or unreachable is one line per change of
  state, not one per pass.
- **Fixes to what the kit reads from GitHub.** More of what GitHub hides from the person who
  labels an issue is now shown and marked in a brief: a link reference definition, the content of
  a tag GitHub strips (`script`, `style`, `template` and the like), and a character reference of a
  hidden character. A session can no longer choose which label counts as ready or turn on the
  feed (`workflow set`/`unset` of `issues.readyLabel` and `issues.watch` refuse inside Claude
  Code). The feed writes events only for leads whose watch runs, not for every lead ever
  recorded. Each GitHub call in a watch pass stops at the pass's time budget, and a write cut
  short says it may have been posted. The lead's watch marks "fixed" only the issues the
  record's issue or the brief names, and says so for the rest. A clock moved back no longer
  silences the feed, and a state it cannot write no longer repeats the same news.
- **Fixes to the issue parts.** Every default-ignorable character (variation selectors, the
  Hangul filler, the grapheme joiner, U+2800) in an issue's text is named by its code in a brief,
  and an emoji keeps its own selector. The found, fixed and ready labels must be three different
  words, so a merge's mark can never add the label that is yours to add. A marker in a comment
  counts only when the kit's own account wrote it, so a stranger's copy cannot silence a
  hand-back, fake a mark, or add an issue to a release. A watch pass settles at most three marks
  and gives the issue work one time budget, after the crew's own lines; a phase names at most 10
  issues.
- **The review's fixes to what the kit writes to GitHub.** The raw-write guard now fails closed on
  text it cannot read whole: a `gh api` write to an endpoint, or a GraphQL query, that the shell
  fills in (`$EP`, `$(…)`, a backtick — the shell reader says which words, outside single quotes,
  so GraphQL's own `$n` in `'query($n: Int!) { … }'` is a plain read), a request from `--input` or
  `query=@file`, and a `gh` alias that runs a shell command (looked up as typed, as gh does, in
  the merge reader too). `gh api -X=POST` is read as `POST`, as gh reads it. Any GraphQL mutation that is
  not a pull request one counts as a write, and so do `gh label create`, `edit`, `delete` and
  `clone` and a write to a repository's labels. A `gh` alias is read for what it expands to, and a
  crew session is denied a `gh` word it cannot read. The screen finds secret names with letters
  before them (`APIKEY=`, `PGPASSWORD=`), a home in its Git Bash and WSL spellings, and Tavily,
  Groq, Stripe restricted, Slack and Discord webhook keys. `issue file` refuses an account with read
  access only, edits only an issue the kit's own account wrote, and accepts an `origin` with user
  info (never printed). The docs now say exactly what the screen catches.
- Design: `docs/design/issues.md`.

**What to run for 1.4.0:** nothing for the update itself (`router.js` did not change, and the
session start refreshes the general instructions); restart your sessions so each carries the new
guard. To turn issues on for a project, in your own terminal (`issues.enabled`,
`issues.allowPublic`, `issues.watch` and `issues.readyLabel` refuse inside Claude Code): `gh auth
login` for github.com, then `cc-smart-dev-kit workflow set issues.enabled true --project` (and
`issues.allowPublic true` for a public repository, `issues.watch true` for the lead to hear new
issues), and commit the file to the base: the switches are read from the base as committed. The
file then needs `"requires": ">=1.4"`, which `workflow set` writes for you.

## 1.3.0

The lead and its crew, made dependable: a resume that keeps track of its session, a watch that
says each piece of news once, and a removed crew session's conversation kept out of your way.
Also new: a way to say you cannot answer (`user unavailable`), a router that ends a stream that
goes silent, a status line that always shows the context use and the effort, and a note that
tells every session which tier is Claude. Planned as 1.2.1; it adds commands, hooks and fields, so
it is a minor version.

- **The installer repairs a marketplace your settings lost.** When Claude Code's own list had a
  marketplace but your `settings.json` no longer declared it, the installer skipped the add and
  `setup` stopped with "does not list the cc-smart-dev-kit marketplace yet". Step 4 now counts this
  repository's marketplace as added only when both records hold it, runs the add again when only
  the list holds it (`re-declared in your settings: …`), and stops with the command when the
  settings still lack it. The two companion marketplaces stay judged by the list alone. `setup` run
  by hand says what is true and gives that one command, and no longer asks you to install a plugin
  that is installed.
- **A service on this machine no longer looks down behind a proxy.** With `HTTP_PROXY` set and no
  `NO_PROXY`, `doctor`, the portal's start and the OmniRoute checks asked a loopback address
  through the proxy, so a running portal or OmniRoute looked down. Every probe of a service on
  this machine now goes straight (one helper, `loopbackFetch`); a remote address (the npm
  registry) keeps your proxy.
- **The portal shows an unknown wait as unknown.** A paused crew session whose wait the watch
  could not name was shown as waiting for a Claude limit on no model; it now says it waits for an
  answer it could not name, with its slot.
- **`launch`'s notes are right in two more places.** A `model` key set to an empty text in a
  higher settings file blanks a lower file's slot name (Claude Code does that), so the lower
  file is no longer named; and `launch -- --model <id>` no longer names a file's `model`, which
  the argument overrides.
- **A crew session reads its lead's own team file.** The effort, the opus usage guard, the board's
  caps and a queued start now read the project's gateway at the lead's own folder, where the crew
  session's worktree is cut from, not at the main checkout: Claude Code reads the team file of
  the folder a session runs in. It changes the answer only for a lead in a linked worktree whose
  branch changed `.claude/settings.json`. A done report, an own review and the update hints say
  what is true: `--status done --file -` with its JSON part, an own review counted as a review,
  and `cc-smart-dev-kit setup` once for a machine set up before Claude became the default.
- **Setup turns Remote Control's auto-connect on.** `cc-smart-dev-kit setup` writes
  `remoteControlAtStartup: true` into `~/.claude/settings.json` only while the key is absent: a
  `true` or `false` you set stays, and `restore` removes the key only while it still holds the
  value setup wrote. A key you delete or change after setup wrote it is let go of once, and
  never written again (a record in the state folder, `remote-control-released`). It connects with
  a claude.ai login; `gateway on` still turns Remote Control off (`gateway off` brings it back).
- **A project file's `requires` is mended, and `doctor` says when it is too low.** 1.2.0 could
  leave a file that sets `workflow.crew.handoffTokens` under `requires: ">=1.0"`, so a teammate on
  1.1 had the whole file refused instead of hearing "update". `workflow set … --project` now
  raises a `requires` below what the file's fields need on any write (never lowers one; a file
  that said `>=0.1` becomes `>=0.5.2`) and the line it prints names the raise, and `doctor` warns
  about such a file and names the fix.
- **The portal's header no longer starts heavy children on every refresh.** The Needs and Work
  reads (`crew cleanup --json`, `claude agents --json --all`) are kept for 5 seconds and shared
  while one runs. A removal still reads fresh facts.
- **A crew resume keeps track of the session it brings back.** Claude Code starts every crew
  resume as a copy with a new id; the record used to keep the old one, so the watch called a
  working session `stopped` a few seconds later. The record now takes the new session in the
  same write that marks it `working`, and the line says it (`resumed … as session <new> (a copy
  of <old>)`). Two resumes of one record at once are refused instead of starting two copies; a
  resume that printed no session line keeps the record as it was and is never tried again by
  itself. The watch also survives a closed pipe and a busy store.
- **A resumed crew session leaves nothing behind when it is removed.** A resume is a copy with a
  new id, and `crew rm` used to remove and archive only the newest one, so every earlier copy
  stayed in `/resume` and in `claude agents --all`. The record now keeps every earlier session,
  and `crew rm`, the archive and `sessions --finished --remove` go through all of them. Also
  fixed: a model change that waited for a cap no longer resumes a session that reported `done`
  meanwhile; a second removal of one crew session refuses instead of rolling back the first one's
  discard; the watch no longer waits for a continuation that was removed, discarded or failed; a
  stop (the lead's `crew stop`, a `crew rm`, or the watch's idle stop) no longer writes `stopped`
  over a session that reported `done` or was answered meanwhile; and a stop the watch made for an
  idle blocked session no longer keeps the merged session from being removed.
- **A removed crew session's conversation moves to the crew archive.** `crew rm` (and the watch's
  removal after a merge) moves the conversation Claude Code keeps after `claude rm` to
  `<state>/crew-archive/`, so `/resume` no longer lists every crew session ever removed; it is
  deleted after `crew.archiveDays` (7 by default). Two archives at once, a moved project folder,
  a linked session folder and a project folder name over 200 characters are handled.
- **The lead hears each piece of news once.** "quiet" is said when a quiet stretch starts and once
  more when it grows long, not every minute; a clash between two leads' phases once for its life;
  "going again — the wait is answered" once when a needs-you wait ends; a merge note never names
  the lead that made it. A `--files` pattern that matches more than a quarter of the repository
  gets one warning.
- **A `done` report proves itself.** `crew report --status done` refuses a report with no test
  run, no checks or no review; a phase that ran its own review instead says so with `ownReview`
  and a reason. A report's summary and any field the kit does not know are kept, never dropped.
  A question a crew session asked again while the first had no answer closes the first, and an
  answer to it is refused with the newest question named.
- **`crew model <name> --model <model> --effort <effort>`** changes a crew session's model or
  effort, with the same checks as `crew start`. A running one is resumed with the new flags and
  told what changed; a stopped, paused or queued one takes the values for its next start. A move
  to the opus tier that a cap holds waits for the cap.
- **Crew names and continuations hold up after a clean-up.** A continuation keeps the commit it
  started from after `crew rm`; a name that removed records share means the live one; a
  continuation's number counts only the records that started.
- **`workflow set`, `workflow unset` and `project init` keep the file's own layout.** Only the
  value that changes is written: the other lines, the indent, a tab or CRLF file stay byte for
  byte, and a new array is printed the way Biome would.
- **The `requires` floor knows every field.** `project init` and `workflow set` raise a
  project's `requires`, so an older plugin says "update" instead of refusing the whole file (and
  failing every guard closed). They missed `crew.handoffTokens` (1.2.0), `crew.loadPerCore` and
  `crew.archiveDays` (1.3.0), and the `ownHooks` names that came after `ownHooks` itself
  (`tier-view` asks for `>=1.3`). A test now fails when a new field or hook name ships without
  its floor.
- **The split review ranks its findings before the budget.** Each finding is ranked by severity,
  so a busy track of small findings cannot take every refuter; a finding past the budget comes
  back as unchecked, never dropped. The review and audit runs refuse a malformed argument before
  any agent starts.
- **A research sweep.** `research-first` can start `research-sweep` for a question with several
  sources: one researcher per angle, then a refuter per claim that opens the source and quotes it.
- **Four tests that failed only on a busy machine** found their cause (a slow child, a held port,
  a git setup, a wall-clock bound) and pass under load.
- **The router ends a stream that goes silent.** Before, only a held stream's wait for its first
  event had a limit: a stalled stream (12 of 4,957 answers from one OmniRoute target in 3
  hours) held a session for 21 minutes; Claude Code ends no stalled stream itself. Any streaming
  answer that sends no byte (an event, a ping or a keep-alive comment) for
  `timeouts.streamIdleMs` (default 120 s), counted from its headers, is ended, Anthropic's too;
  Claude Code sends the request again at once (proved on 2.1.310). The log line names the
  target and the idle time; a backend's target rests like any failure, a Claude target rests
  nothing. `timeouts.firstByteMs` and `streamIdleMs` are capped at 2147483647 ms. `router.js`
  changes, so run `cc-smart-dev-kit gateway setup` on every machine that uses the gateway.
- **When you cannot answer: `cc-smart-dev-kit user unavailable [--until <time>]`.** While it is on,
  every session follows the `user-unavailable` skill: it never stops to ask, takes the reversible,
  recommended choice and parks it as a decision, and parks your questions and every action that
  needs a yes, with its exact command. The hooks hold the line: `AskUserQuestion` and
  `ExitPlanMode` are denied with the step that parks the question, Claude Code's own permission
  prompt is denied and parked, and every other hook's question becomes a deny that parks the call,
  never an allow. `user available` ends it; `/cc-smart-dev-kit:user-available` goes through the
  list (`user list`, `user status`, `user clear`). In Claude Code's default permission mode, allow
  `Bash(cc-smart-dev-kit user park:*)` once.
- **Every session knows which tier is Claude.** A note at each session start, and once when a
  slot changes mid-session, says what Haiku, Sonnet, Opus and Fable run for this session (the
  agent guard's reading, the session's own gateway) and the effort rule. The usage-limit alert
  judges the session's own chain: a limit that does not hold this session says so, gives no
  reset date and names the slot's first target.
- **The status line always shows the context use and the effort**: `ctx 312k · 78% of 400k`,
  measured against Claude Code's auto-compact window when you set one (`/autocompact`), else the
  model's window, then the effort (`· xhigh`), or a backend's pinned effort when one answers.
- **`crew answer` reaches a running crew session itself**, through the session's own monitor,
  even when it sits idle or blocked, and says `delivered`; when it cannot, it says `recorded, not
  delivered` with the one line to send by hand. Answering the same question again is a
  correction.
- **A plan keeps its briefs and a record of each crew run.** `<plans dir>/<plan stem>/briefs/`
  holds each phase's brief, and `crew start` takes it from there when `--brief` is left out. One
  record per crew run in `<plan folder>/runs/` (its sessions, model and effort, each step, the
  wall and working time) stays after `crew rm` and moves with the plan; `crew history` reads
  them, and `--backfill` writes them once for older runs.
- **A crew start waits while the machine is busy.** `crew.loadPerCore` (default 3): a start
  queues while the 1-minute load per core is past it. A crew session is told to install its
  worktree's own dependencies.
- **The effort pin on the Slots page.** The portal's Slots page shows each backend target's pin, or
  "follows Claude Code", and sets it: it asks first, runs `gateway effort`, and shows the test
  request and a backend's refusal in place.
- **Stopped crew work stays in sight, and unmerged work is never cleaned away.** A daily reminder
  names each stopped crew session whose work is not merged. `crew lead --end` records that a plan
  ended, and the board and the Work API mark a lead that is proved gone. A clean, by hand or in the
  background, removes a crew session's work only through `crew rm`, and only once it proves today
  that the work is merged into the project's base. A merge proved for an exact commit still holds
  after the lead's branch is rewritten or old objects are pruned; a crew commit made after it needs
  a new check. `crew rm --discard` archives the work before it removes it, once you confirm what it
  will discard; `crew list --discarded` prints how to get it back, and archives are pruned after 30
  days. The watch never discards. An older record whose history shows a merge counts as merged;
  with no history, the old rule holds. Finished background sessions that are not crew are removed
  once you confirm, and `--id` (repeatable) picks exact ones. On Linux, a stale Claude lock is
  cleared only when no process holds it and every usual check passes; a failed move puts the lock
  back. Supabase's `cli-latest` cache alone no longer keeps a worktree. The portal's API has the
  cleanup actions; its pages do not show them yet.
- **Finished crew work cleans itself up (D62).** A project with seven leads held 39 crew worktrees,
  13 working and the rest finished work nobody had removed (7 merged, 11 handed off, 6 stopped),
  plus 2 folders a removal left half done. The lead's watch now removes a merged crew session with
  `crew rm`'s own steps and says a refusal once; it waits until every later continuation's work is
  merged into the first record's base, and never removes a `stopped` one (that stays your call,
  though it is still marked merged, so a phase that waits for it starts). The merge is judged
  against the branch the session was cut from, not the lead's current one. The programs a finished
  session's own turn left running (its background `bun run check` and their `sh` and `bash`) are
  stopped, SIGTERM then SIGKILL, instead of refusing the removal; a dev server you started there
  still keeps it. Ownership requires a readable environment naming that crew session; an unreadable
  environment (including macOS) keeps the folder. Other blockers are judged before its programs are
  stopped. Older records rewritten to `stopped` need a manual `crew rm`; the watch does not guess
  whether their stop was intentional. A `…-removing-<time>` folder is finished by the next `crew
  rm`, `worktrees --clean` or watch pass: while git lists it, under the usual checks; when git no
  longer lists it (5 of the 8 found on one machine), only when nothing runs from it and no file in
  it is newer than the move its name records, and only on Linux, where the kit can read the mount
  points: on Windows and macOS that folder stays, the log says why, and you remove it by hand.
  `worktrees` names a crew worktree as one, with its
  lead and who removes it, and `--clean` leaves it alone instead of listing 30 of them "kept" and
  saying "Nothing finished to clear". A finished session's unanswered question is closed, so it
  leaves the Needs page.

**What to run for 1.3.0:** `cc-smart-dev-kit gateway setup` on every machine that uses the
gateway (`router.js` changed: the stalled stream); `cc-smart-dev-kit setup` once (Remote
Control's auto-connect); then restart your sessions, so each carries the new hooks. A project
that sets `crew.loadPerCore` or `crew.archiveDays`, or lists `tier-view` in `ownHooks`, needs
`"requires": ">=1.3"`; `workflow set` and `project init` write it for you.

## 1.2.0

Claude by default (every slot on Claude, every fallback off, the gateway off), the gateway per
project and per session, a project's workflow from the portal, claude-mem from the kit, and the
effort pin. It also carries everything 1.1.3 was to ship (below), which never went out on its own.
The rest of the planned crew clean-up (CL1, CL2) follows in 1.2.1.

- **Claude by default** (the owner's decision, D66). A new machine has every slot on Claude —
  scout, worker, opus, fable and the judge — every fallback off, the judge's too, and the gateway
  off. `gateway setup` asks only for OmniRoute's address and key, leaves every slot on Claude, and
  never turns the gateway on; the installer's gateway question and last line say the same.
  OmniRoute and the router are set up exactly as before. The kit suggests no model: a slot gets a
  chain with `gateway slot`, a fallback is turned on with `gateway fallback`. The judge is Claude
  alone until `gateway fallback judge on` lets the worker's tested targets stand in for it.
- **A machine set up before this moves once, at its next `cc-smart-dev-kit setup`** (the installer
  runs it). Every slot's chain, the machine's and each profile's, goes back to Claude (a machine
  chain waits in the config, and `gateway slot <slot> custom` brings it back), every fallback
  switch goes off, and the gateway turns off through the same code as `gateway off`. `gateway.json`
  is backed up first, setup prints one line per change (`worker: omniroute:x,omniroute:y →
  Claude`) and where the backup is, and `--dry-run` shows the lines and changes nothing. It runs
  once per machine: a marker in the kit's state folder says so, so a chain or a switch you set
  afterwards is never touched by a later setup. A session start or the background update never runs
  it, and a project's own `gateway project on` is left as it is. A running session on the router
  goes to Claude at once, and the gateway-off address (Anthropic's own, changed in place) reaches
  it within about a second. Run `cc-smart-dev-kit doctor` to see whether your `gateway.json` still
  waits for the move.
- **claude-mem goes back to Claude Haiku** on your own login with that move: the scout is on Claude
  again, so setup takes out the five provider keys it set for claude-mem. A route you chose with
  `claude-mem route` or in the portal stays. The note about a backend claude-mem still uses now
  names `claude-mem route claude`, and an address in a "left alone" note never shows credentials.
- **`gateway on` says Remote Control is off while the gateway is on.** Claude Code allows Remote
  Control only when its address is unset or `api.anthropic.com`; `gateway off` writes that
  address, so it comes back. The kit never writes `remoteControlAtStartup`.
- **`gateway status` calls a router that Claude Code does not use "off"**, and names `gateway on`
  in its words, with no next step: that is the default state now.

- **The portal's sidebar items have room between them.** A hovered item, the active item and the
  keyboard focus ring no longer run into the item next to them. In the folded sidebar, the last
  item of each group now takes the hover over its whole height.
- **The portal's project cards are quieter and truer.** A proposal from the Workflow card is
  refused when it names no project, instead of running in the portal's own folder. The Workflow
  and Gateway cards no longer read again at every crew event. An unset crew tag or opus count
  reads as `workflow show` words it. Two controls running one action no longer show each other's
  progress line, and the Gateway form keeps the state you applied until the page's new answer
  arrives.
- **The gateway per project.** `gateway project on|off|default [--team] [--profile <name>]` turns
  the gateway on or off for one project only. The kit writes it to that project's own settings, so
  every session there follows it: a personal file by default, or the team file with `--team`.
  `gateway project status` says what a project uses and which file says so, and `gateway projects`
  lists them all. A **profile** is a set of chains a project can use instead of the machine's
  (`gateway profile <name> slot …`; its switches are `gateway profile <name> fallback <slot>
  on|off` and `gateway profile <name> breaker <slot> on|off`). Projects you never set keep the
  machine's gateway. A profile needs this version's router: until `gateway setup` puts it in
  place, `--profile` (here and in `launch`) is refused and `doctor` fails a project whose address
  names one. When every target of a profile's slot is limited, the router's message and its
  reminder name the command that changes it (`gateway profile <name> slot <slot> <targets>`, and
  `gateway slot …` too when the profile uses the machine's chain), and the alert and the status
  line name the profile's command, not a hand edit of `gateway.json`. `gateway profile <name> slot
  judge off` says who judges there: Claude alone, or, once the judge's fallback is on (off by
  default), the profile's tested worker targets while Claude cannot.
  The profile commands also say the trade-off of a judge other than Claude, and `gateway profile
  <name> fallback judge on|off` says who judges instead of a "next target".
  A crew session in a profile project now waits on its profile's breaker, not the machine's, also
  after a failure the router did not explain.
  The status line shows a fallback or breaker only in a session on that chain: a profile's
  record no longer appears in every session on the machine, and a session off the gateway (an
  empty address too) shows none. `crew start` and the opus usage guard read a project's own
  gateway (its settings, and its profile's chains), not the user's file alone: a project turned on
  or off with `gateway project` now decides which effort a crew session gets and whether the usage
  guard holds. `crew start`, the Agent guard's queue check and `crew list` read it at the same
  folder, the repository's main checkout.
- **`cc-smart-dev-kit launch`** starts one Claude Code session with the gateway or without it
  (`--gateway`, `--no-gateway`, `--profile <name>`), whatever the machine or the project says,
  and changes nothing on disk. `--gateway` and `--profile` first ask the router's health page and
  stop with `gateway setup` as the fix when it does not answer (after a full `restore`, which
  keeps `gateway.json`, the config is there but the router is not), instead of starting a session
  whose every request fails. A signal sent to the `launch` command alone (`kill <pid>`) now reaches
  the session it runs, so it no longer leaves a session running behind a finished command. It
  also says, on stderr and still starting, what its settings file leaves in place: one line per
  login key or helper in your settings (the session bills through it, not through your plan's
  login), and in `--no-gateway` per retired model key that names a slot (Anthropic has no such
  model), each with its file and the fix; a model key is named only where its file decides it,
  and a file whose address alone is malformed is still read for its other keys. The router
  question goes straight to `127.0.0.1`, so a proxy in your environment no longer makes a running
  router look silent (`setup` and `doctor` ask it the same way). On Windows, where a Ctrl+C or a
  closed console already reaches the session, `launch` hands on no signal but waits for the
  session and returns its exit code; a kill there ends the command alone.
- **`gateway off` and `restore` switch running sessions at once.** They write Anthropic's own
  address in place of the gateway's, and a running session picks that up within about a second,
  so no session needs a restart. A second `restore` takes the key out. One exception: on a
  machine that still has 0.4.3's retired model keys (`ANTHROPIC_DEFAULT_HAIKU_MODEL`,
  `ANTHROPIC_DEFAULT_SONNET_MODEL` and their names), the first `restore` removes them, and a
  removal reaches a session only at its next start. Until you restart it, such a session sends a
  slot name to Anthropic and fails; `restore` says so when it removes them.
- **The gateway's project state follows what Claude Code really reads.** Claude Code also reads
  the folder a session starts in for its own `.claude/settings.local.json` (a subfolder, a
  worktree), after the project root's, so `gateway project status` and the login-key refusal now
  see it. A removed key no longer means "restart": a running session follows it to the next file
  that sets the key. `gateway project default`, `status`, `restore` and `doctor` name a worktree's
  copy of the personal file that still holds the router's address, and leave it alone.
- **`doctor` shows each project's gateway state and its source,** and warns about a project file
  that names a slot or a backend model as Claude Code's model. `restore` also covers the keys the
  kit wrote into project files. `gateway off` lists the projects still switched on.
- **The portal's Project page** has two new cards:
  - **Gateway** shows that project's state, where it comes from, and the switch;
  - **Workflow** shows each workflow setting, its value and source. A change you make there
    becomes a pull request into the project's base branch (`workflow propose`), and its link
    shows in place. A crew session cannot propose one, and any other Claude Code session that
    runs `workflow propose` asks you first while `autoPush` is off or `openPr` is short of
    `ready`: it pushes and opens a pull request where the git and merge guards cannot see.
- **The portal's OmniRoute update and rollback buttons work.** They ran the command in the portal's
  own process, whose environment holds `CLAUDECODE` when a session started it, so the command
  refused the person's own click as "inside a Claude Code session".
- **The portal never waits on a slow command.** Its doctor pass and its project reads run off the
  server's loop, one CLI child serves every action, and its state folder follows
  `CLAUDE_CONFIG_DIR`.
- **Two guard fixes:** a crew session's text that starts with `-` is passed safely, and the
  escape guard no longer flags a computed command because its path holds the kit's name.
- **The Agent guard judges your session's own gateway** — the address the session really runs
  with, so a project turned off or on, a profile and `launch` each count — never the machine's
  settings file alone.
- **The usage-limit and gateway-slot alerts say what happened and offer nothing.** The usage-limit
  alert names the limit that was hit and when it resets; the gateway-slot alert names the slot,
  since when it is limited, and why each target rests. Neither offers a model, a chain, a fallback
  switch or `gateway on`, and neither has a button, whatever the session runs on: the hook shows
  the plain notification itself and starts no background worker. Only when a stop should not have
  happened (the slot starts with a backend, or its fallback is on) does the usage-limit alert add
  that one fact and point at `gateway status`.
- **The Fable-session line names what answers this session.** In a session whose project is
  turned off, or that runs on a profile, it used the machine's settings; it now reads the
  session's own gateway, as the Agent guard does.
- **A test run, or another program's `workflow` word, is no longer taken for `workflow
  propose`.** A program a line works out when it runs (`$RUNNER … workflow`) was read as the
  kit's `workflow propose` whenever its last word was `workflow`, so a crew session was denied
  commands such as a test run of a `workflow` folder. The line now has to name the kit: by its
  name, a path to its launcher, or its bundle behind another program. The same holds when the
  word after `workflow` is also worked out at run time (`$RUNNER … workflow $ARG`); the words
  `workflow propose` are still refused on any line.
- **The escape guard still asks when the kit's bundle path is bound in a variable** and run by a
  computed program (`C=…/dist/cli.js; $(which bun) $C …`), though it no longer asks for a path
  that only passes through a folder named like the kit.
- **The `workflow propose` question answers in time.** It finds the project and reads its
  committed policy inside one budget of 8 of its hook's 10 seconds. On a git that hangs or is
  slow it asks and says that git did not answer in time, where the hook was cut off before.
- **A command run where git does not answer says what to do.** `project init`, `workflow`,
  `worktrees` and `crew` print one plain line, "git did not answer in time: run `git status` in
  this folder; …", where they printed the bare reason; `doctor` prints the same fix on its own
  line.
- **A session name that cannot be recorded no longer loses a message.** When the temp folder is
  not usable, the person's own prompt typed into a crew session (and the lead's line about it)
  and a lead's news about its crew sessions were lost with the name. They now go through, the
  hook says why on stderr, and the name is set on a later turn.

- **Pin a backend target's reasoning effort.** `gateway effort <slot> <target> <level>|off`
  tests the level before saving it. A pin wins over the effort Claude Code sends, even when
  thinking is off; `off` follows Claude Code again. Pins travel with saved chains, disappear
  when their target leaves, and show in `gateway status`, Slots data, the log and health's
  recent requests. Claude targets are never pinned. No router restart is needed.
- **With the breaker on, a backend's hiccup no longer ends a session on Claude's plan limit.**
  In a chain like `<backend> → claude-sonnet-…`, while Sonnet is at a plan limit the router
  already knows, one failed answer from the backend became Sonnet's limit, and Claude Code
  stopped for days. Now the router skips that Claude target while it rests, the last one too:
  the breaker holds the request and Claude Code retries. It asks Claude again every 10 minutes
  at most, so an early reset is still seen. With the breaker off, the backend's own answer goes
  back while Claude rests, and Claude's 429 when it is asked again. A chain that starts with
  Claude is unchanged.
- **`gateway slot <slot> claude` works on a machine with old slot names.** An alias that
  pointed at a slot (`migrate` writes them) made the move fail and write nothing, because a
  slot in Claude mode is not in `slots`. An alias to a slot now stays valid in both modes; a
  request under it while the slot is Claude gets the 400 that says what to do. Until
  `gateway setup` has replaced a 1.1.x router that still runs, the command refuses that move
  before it writes anything (the old router would refuse the file, keep its last config and
  ignore every later change), and names `gateway setup`; the router's health page now lists
  `claude-slot-aliases` so the command can tell. This is a change to `router.js`, which
  1.2.0's `gateway setup` installs anyway. If the router does not answer, the change is saved
  with a warning.

- **claude-mem's route, key and fallback are yours to change — from the portal or your own
  terminal.** On a machine whose claude-mem values were set by hand (outside the kit), every
  change was refused, because the kit never overwrites a value it did not write. The
  **take-over** records those values as cc-smart-dev-kit's own, after asking and naming them:
  nothing in claude-mem's settings file changes, each value stays exactly as it is until you pick
  another, and `restore` puts them back — a key's value is never written down, so `restore`
  leaves a taken-over key as you set it, and once the kit replaced it, keeps the kit's key only
  with the address it was written for (see the `restore` bullet below). On the Machine page's
  claude-mem card it is **Let the kit manage
  these**: the card names each value set by hand and marks the choices it refuses, and after the
  take-over the route, the key and the fallback change in place. From your terminal it is
  `cc-smart-dev-kit claude-mem take-over`. A new **`cc-smart-dev-kit claude-mem`** command makes
  the card's choices from your own terminal — `status`, `route`, `key` (on stdin, never an
  argument, never printed), `fallback` and `take-over` — through the same functions and the same
  checks, so the page and the command can never disagree about a machine. And a **backend
  fallback now works on every route**: claude-mem ignores a fallback whose provider is the
  route's own, so where the route is already a backend model the fallback goes through
  claude-mem's OpenRouter provider, pointed at the backend of the model you pick (the card lists
  backend models for the fallback on every route); an empty fallback provider is
  now shown as Claude with the model it really runs on.
- **`restore` words a taken-over value coming back as what it is.** When a value a take-over
  recorded goes back to what you had, the line says `put back <key> (yours again)` — it no longer
  says `set <key> to …`, and the file no longer stays on the list for the second `restore`. A
  value the file already holds is left alone: no backup, no write.
- **`restore` never leaves a claude-mem key next to an address it was not made for.** After a
  take-over, a route change to a gateway backend writes that backend's address and key. Before,
  `restore` put your own address back and left the backend's key beside it, so that key would go
  to your host. Now your own key comes back with your address, read from the kit's backup of your
  file; with no backup that holds it, the kit's key is removed and the line says so. A key you
  typed in the portal for another address goes the same way, and so does the kit's key beside an
  address you set back by hand; a key written for the address that stays is kept, as before. If
  putting a take-over back fails, `restore` leaves claude-mem's file alone, exits 1 and says to
  run it again, instead of half-restoring it.
- **`restore`'s first run tells the truth when it could not switch an address.** When no
  settings file has an address of the kit's to switch — you set, changed or removed it — the line
  says so, and names what to do before the second run (restart the sessions, and change any
  address of yours that still names the router), where it used to say the address was "yours"
  even for one that was not in the file at all.

- **A crew session hands off at 400k tokens or 70 % of its window, whichever comes first, and
  before Claude Code would auto-compact it.** The hand-off used to be a share of the model's
  full window only, so a 1M window handed off at 700k, and a person's auto-compact setting was
  never looked at. The new setting `crew.handoffTokens` (default `400000`) caps it: a 1M model
  hands off at 400k, a 200k model at 140k, and a model whose window the kit cannot know still
  hands off at the cap. Crew sessions start with `--autocompact auto`, which Claude Code reads as
  "skip the `autoCompactWindow` settings", so your own setting does not move a crew session's
  compaction; the variables `CLAUDE_CODE_AUTO_COMPACT_WINDOW` and `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE`
  still do, and the hand-off now stays 13 000 tokens below the point they set (the point is the
  window less 33 000). Your own `crew.handoffPercent` stays in force beside the cap (at 40 on a 1M window it is the same 400k).

### Also in 1.2.0: what 1.1.3 was to ship

**Every crew session keeps a to-do list, and a lead is reminded to keep one.** Measured before
this release: 17 of 24 live crew sessions used `TaskCreate`, and the rest skipped it, because
Claude Code leaves the task tools out until a session looks them up and the crew skill only
asked. The list is what a crew session resumes from after a compaction, and what you read when
you open it.

- **A crew session's first edit waits for its list.** Until the session's task folder holds one
  task, the `crew-role` hook refuses its `Edit`, `Write` and `NotebookEdit` with the step: look
  the task tools up, then one `TaskCreate` per part of the brief, each with its done-check. The
  role card names the same first step. Once a task exists the hook answers from its own cache
  and reads nothing more, so an edit costs one small file.
- **A `done` report waits for the list to be finished.** `crew report --status done` refuses
  while any task is still open, and names each one: finish it, or delete it and say why in the
  report. A `handoff`, `blocked` or `failed` report is never held, and a session with no list at
  all reports with one `note:` line saying nothing was checked.
- **A lead is reminded, never blocked.** While your session has no to-do list, each prompt
  carries one line: put the person's asks and your open work on it. It goes silent the moment a
  task exists.
- **The kit's builder and rules-maintainer agents get the task tools**, and one line each to
  keep a list for a multi-step brief. The read-only reviewer, auditor and ui-verifier stay as
  they are.
- **A lead sends the building to its crew.** The lead skill gains "Your crew builds": the code,
  the tests, research across many files and long debugging go to a crew session, and the lead
  keeps the plan, the briefs, the starts, the questions, the merges, the plan file and the
  person. The `lead-notes` hook adds the same rule in one line when a lead's context is built
  again — a start, a resume, a compaction — and never at a prompt or on an edit. Words
  only (D61): the lead's context is re-read on the premium model every turn, so every file it
  reads or writes costs on every later turn.
- **A lead never routes a phase around the crew queue.** The queue exists for the machine and for
  each lead's share of it, and a builder subagent runs outside every one of those counts — with
  none of a crew phase's worktree, review, report gate or to-do list. So in a session registered
  as a lead, the agent guard refuses a launch that can change files while a `crew start` from it
  would queue right now, and names the cap that holds and the `crew start` step. Read-only work
  is never held: the kit's own reviewer, auditor and ui-verifier, the built-in Explore, Plan and
  claude-code-guide, the kit's read-only Workflows, and statusline-setup (which edits only the
  status line setting) — a project's own read-only agent is exempt only when its
  `cc-smart-dev-kit.json` lists it. An ordinary session
  or a crew session is judged exactly as before.
- **A heavy job that waited says when it started and how it ended.** A job whose output went
  down a pipe (`bun run tsc --noEmit | tail -20`) reported the pipe's own status, so a session
  that queued one saw the waiting lines, then nothing: a passing type check prints nothing of
  its own, and a failed test run read as exit 0. A job that waited now says `Heavy job starts
  after 18 min: tsgo --noEmit (8 GB)` as it starts, and `Heavy job ended: tsgo --noEmit, exit 0
  after 3 min` when it ends — with the signal that stopped it, `(sent on by job run)` when
  `job run` sent that one on, and its leftover processes when they had to be stopped. The first
  waiting line carries one hint about the pipe, once per job. A job that never waited prints
  neither line: no noise on a free machine.

**Three more fixes, found by 1.1.2's own review.**

- **Two crew sessions can no longer take one name.** A long tag, plan and phase leave only
  17–19 characters of the slug, so two slugs of one phase that share a longer prefix made the
  **same** name on two different branches — and the name is how `crew answer`, `crew tell` and
  the message guard reach a session. `crew start` now refuses the second one and says to pick a
  shorter `--slug`.
- **A crew session renamed in 1.1.1 gets its name back.** 1.1.2 stopped new renames but nothing
  set the title back, so such a session kept a task name while its lead, `crew answer` and the
  message guard went on addressing it by its record's name. Its next turn puts the record's name
  back — on the lead's turns too, not only the person's.
- **A cap you change now reaches a running lead's watch.** `crew watch` read the workflow once
  and kept that value for its whole run: `crew.max 16` set while it ran never reached it, and a
  lead's watch went on starting queued phases up to the old 24 (seen live on 2026-10-23, with
  the machine five times overloaded). Each pass reads the workflow again, and a pass that cannot
  read it — a broken file, or crew sessions turned off — starts nothing and says so once.

**What to run:** nothing. The hooks come with the plugin update. A session that is already
running keeps the old hooks until Claude Code restarts it, so only the crew sessions and leads
started after the update are held to the list or reminded.

**The portal's usage and cost numbers now say the truth.** You reported that the portal does
not report usage and cost correctly. Every number was then measured against the router's
history database, its log and its state files on a live machine, and each finding was fixed at
its cause. Where a number cannot be given, the page now says so instead of showing a number
that is not one.

- **A request with no price is counted, never added as $0.** In one measured day 62 % of the
  rows — every affordable-backend request: 17,373 of them, with real tokens and no cost — were
  added as $0, so the Usage page's cost card, "Where the cost goes" and "Top sessions by cost",
  and the Overview's cost chart and its "$X in the last day" line, all read low and said
  nothing. A sum now says what it leaves out — "$12.40 + 1,234 requests with no price" — and a
  sum made only of unpriced requests reads "no price", never "$0", the words
  `cc-smart-dev-kit usage` already used. A chart whose rows exist but carry no price says that,
  never "nothing matches".
- **A backend's price list in OmniRoute's shape was read 1,000,000× too high.** OmniRoute's
  `/v1/models` gives `pricing` in **dollars per million tokens**, as numbers
  (`{"input":5,"cached":0.5,"output":25}` for a $5 / $25 model); the reader took those for
  per-token prices and multiplied by a million, and never read `cached`, the cache-read price.
  Both real shapes are now read, each in its own unit: OpenRouter's per-token `prompt`,
  `completion`, `input_cache_read` and `input_cache_write`, and OmniRoute's per-million
  `input`, `output`, `cached` and `cache_creation`. **A row already logged keeps the cost it
  was written with**, so an affordable-backend row written before this fix stays at the price
  that was wrong at the time — `cc-smart-dev-kit gateway history` shows those totals until the
  retention drops them (90 days by default).
- **Claude Sonnet 5.5's cache read was half its list price.** The table held $0.10 a million
  where Anthropic charges $0.20 — a tenth of its $2 input rate, as Sonnet 5's own row has. A
  test now holds every row's cache read to its family's published share (Opus 5.5's a
  twentieth, Fable 5.1's a fortieth, the rest a tenth). **A row already in the history keeps
  the estimate it was written with**; only new rows use the corrected price.
- **About a nine-hundredth of a translated stream's input tokens were recorded.** A backend
  that translates an OpenAI stream (OmniRoute) knows the prompt's usage only at the end: it
  sends zeros in `message_start` and the real counts in the last `message_delta`. The reader
  took input and cache from `message_start` alone, so 1,040 calls that had spent 242M input and
  235M cache-read tokens were logged as about 270K. Each usage field is now taken from the last
  event that reports it, and the two are never added together. Anthropic's own streams keep
  their counts, except where its `message_delta` carries the cumulative input count its docs
  describe. **A row already logged keeps the count it was written with.**
- **The Overview's "Requests a minute" could never pass 40.0**, because it was read off the
  router's capped list of the last 200 routed requests — 85 of them, in one measured hour,
  Claude Code's own health pings. It is now the history's **model** requests over the last five
  minutes, one query against the database. The router's own counter is still shown, labelled
  for what it holds, and the Health page's "N requests since start" gets the same label.
- **The Usage page left out auto mode's safety checks without saying so.** They are kept out of
  the history on purpose, so they were in none of its numbers and nothing said so. The page now
  says they are counted apart, and shows the file's own count for the local days the range
  covers — read through the reader `cc-smart-dev-kit usage` prints, so the two can never
  disagree.
- **Two smaller wrong claims.** The "Cache share" card said a cache read costs a tenth of a new
  token, which is wrong for Opus 5.5 (a twentieth) and Fable 5.1 (a fortieth), and it no longer
  names a number. And the Requests table ignored the range switch: it showed rows from outside
  the window the charts drew, and its rows are now bounded by the range, as the dev mock
  already was.

**What to run:** `cc-smart-dev-kit gateway setup`. The reader and the price table live in the
router bundle, so a machine updates the copy it runs; setup says what the restart costs and
asks first.

**What to run for 1.2.0:** `cc-smart-dev-kit gateway setup` once — the router changed (the effort pin, the token and price fixes, the fallback default) and setup asks before it restarts it. Then `cc-smart-dev-kit setup` once: it moves your slots, fallbacks and gateway switch back to Claude and off, with a backup (`--dry-run` first shows what it would do). Then restart your sessions, so each runs the new version.

## 1.1.2

- **A crew session's name says whose it is.** With several leads in one project, every crew
  session's name started with the same tag, so you could not tell which lead it belonged to. A
  crew session is now named `C <tag> <plan> <phase> <slug>` — for example `C my-app master-plan W1a
  launcher` — lined up with its lead, `LEAD <tag> <plan>`. Crew sessions started before keep
  their names.
- **Starting a crew session no longer looks like you typed to it.** `crew start` gives every crew
  session a first line (who it is, its lead, and its brief), and the kit read that line as your
  own words: your lead was told "the person wrote" for every crew session it started, the portal
  showed it, and the session was told your word wins over its brief. The launcher's own line is
  now recognised, so only words you type are reported.
- **A crew session keeps the name its lead gave it.** With `sessionNames` on, a crew session could
  rename itself after its task, and its lead, `crew answer` and the message guard, which find it
  by that name, lost it. A crew session is no longer asked to name itself, a name recorded for it
  is never set, and `cc-smart-dev-kit session-name` refuses inside one.
- **A subagent's report is not your words either.** When a crew session's own reviewer or
  builder hands back, that report arrives as a turn of its own, and it too was taken for something
  you typed. It is now recognised as the agent's.
- **`crew rm` finishes when the session is already gone.** A crew session whose Claude Code job
  was removed by hand could never leave the board: `crew rm` asked for `claude rm`, which answered
  that there is no such job. When agent view no longer lists the session, `crew rm` now says it was
  gone already and removes the record.

## 1.1.1

**A fix for every crew session, and Claude Code's retry watchdog on by default.**

- **A crew session loads the kit again.** 1.1.0 started each crew session lean, with your other
  plugins turned off for it, claude-mem among them. The kit lists claude-mem as a dependency,
  and Claude Code does not load a plugin whose dependency is off, so those crew sessions ran
  with no kit at all: no guard, no crew skill, no report check. A crew session now keeps on
  every plugin the kit, or a plugin `crew.keep` names, depends on.
- **The retry watchdog is on by default.** `setup` now turns on Claude Code's retry watchdog
  without asking: a session that meets a usage limit or an overloaded model waits and retries
  instead of failing. A limit that resets more than 24 hours away ends the wait, so a
  `claude -p` script never waits for days. A "no" you gave before, or a value you set
  yourself, is kept; `setup --no-retry-watchdog` turns it off.
- **The main checkout's notes respect a guarded main folder.** With
  `worktrees.guardMainFolder` on, the session-start lines about a main checkout that is on
  another branch, behind its base, or in the middle of a merge now ask the session to give you
  the command, instead of telling it to switch or merge there itself. The fast-forward is
  `git merge --ff-only`, so no merge commit lands in the main checkout. The "behind" count is
  now the base branch's own, and a merge in progress is named first.

**What to run:** `cc-smart-dev-kit setup` (it turns the watchdog on), then restart your Claude
Code sessions. Stop any crew session started by 1.1.0 and start it again: it ran without the kit.

## 1.1.0

**Most of this release is the portal and the crew.** The portal is now the page the kit runs
on: it starts with every Claude Code session and stays up, its pages draw real facts and
real actions, and each change is made in place, with a confirmation first. A lead's crew gained
its own caps, leaner starts, and a way for two leads to talk.

### The portal

- **It starts with Claude Code and stays up.** A new session starts it when it is not running,
  and a plugin update hands it to the new version at the next session start, never back to an
  older one. `cc-smart-dev-kit portal` opens it; `status` and `stop` are there too.
- **Its pages draw every fact the machine gives**: Overview, Needs you, Usage, Work (every
  lead and its crew, with Stop, Resume and Remove), a crew session's own page, Flow, Slots,
  Health, the guard log, Machine and Settings. Their facts come from read-only `/api/…`
  answers and one live stream, so a routed request, a crew step, a plan limit or a change in
  the heavy-job queue appears as it lands.
- **Every action runs the CLI's own command**, in a child process, so a long one never freezes
  a page. It asks first, names the exact change, and shows the command's own words — `✓` with
  what changed, or `✗ Not done:` with **Details** and **Try again**. The page is never
  reloaded to show it.
- **The crew and worktree actions refuse without a confirmation** (`crew.stop`, `crew.rm`,
  `worktrees.clean`), and a crew session's question is answered from the page **as the person**,
  through `crew answer --as-person`, which refuses a command a Claude session runs.
- **The Settings page writes one value at a time**, through the same functions `workflow set`
  uses, and says where each value comes from. The Project card previews `project init`'s own
  plan and writes the two files with the hash of what it showed.
- **Machine**: `doctor` with each failure's fix and **Run doctor**, the heavy-job queue, the
  updates and a held major version, the companion plugins, the MCP servers, the Browser card,
  OmniRoute, **the claude-mem card** (its route and model, its key, and its quota fallback,
  each with who set it), the project's auto-mode trust rules, Warp, and the worktrees.
- **The gateway's key from the portal**: the Machine page can paste the router's OmniRoute key
  into a masked field, or make one from your OmniRoute dashboard password. It is tested before
  it is saved; a refused key changes nothing and keeps the text you pasted.
- **There is no sign-in.** The page binds `127.0.0.1` and nothing else, refuses another
  website and DNS rebinding, and every change needs the CSRF token that came with the page.
  Any program or account on this machine can open it: that is the deliberate trade-off
  ([README](README.md#the-portal)).

### The crew

- **Caps per lead**: at most 4 crew sessions for one lead at once (`crew.perLead`), 2 of them
  on the opus tier (`crew.perLeadOpus`), under the machine's own ceiling (`crew.max`, 24; no
  opus ceiling unless you set `crew.maxOpus`). The caps are your settings, in
  `~/.config/cc-smart-dev-kit/workflow.json` or a project's file.
- **A new opus crew session waits past 85 % of the plan's 5-hour window**
  (`crew.usagePercent`), unless the gateway's opus slot has a fallback chain that answers past
  it. The window is the one Claude Code's status line last recorded, so the guard needs
  `cc-smart-dev-kit setup --statusline` (or the status line's own reading) to hold; with none
  stored, `crew start` and `crew list` say so once.
- **A crew session never asks you**: the git, merge, agent, job-route and session-escape
  guards' questions are denies that name the step, and a guard that cannot run (no bun, a
  missing bundle) denies too. A person's own session keeps every question.
- **A crew session starts lean**: the kit, the project's own instructions, Tavily, and the
  browser for a `ui` kind; every other plugin and MCP server is off for it. `crew.keep` keeps
  more.
- **A crew session resumes into its own worktree**, with its own settings and its lean flags,
  so it is still the same crew session and still lean. A session that is live is messaged,
  never copied.
- **The lead hears the person's own prompt** typed into a crew session, so it can read the
  next report against the brief.
- **Leads of one repository reach each other**: `crew lead tell` sends a contract note or a
  contract question, `crew start` warns when two leads' phases share files, and a merge into
  the base tells every other lead.
- **A lead names itself**: a session that ran `crew lead` takes its `LEAD <tag> <plan>` name at
  its next prompt. A name you give it later with `/rename` stays.
- **The self-watch gauge reads the right window per model**, from Claude Code's own status-line
  report, so a 1M-context model is not handed off at the 200k mark.

### Every session

- **The verification gate**: a project can set `checks.fast` (one command), and a session that
  changed files and never ran it gets one reminder when its turn ends — once per change, never
  a block that traps the turn, and never in a crew session, which has its own report gate.
- **`core.md` is 130 lines, down from 190**: the general instructions were trimmed with the
  owner's approval, and the two rules that were chosen back are one line each.
- **The browser after a restart**: a session the Claude daemon starts has no `DISPLAY`, so the
  Playwright MCP's own detached Chrome start died and its call failed at the 30-second
  deadline. The launcher now starts Chrome itself with the desktop's display, waits for
  Chrome's own lock, or ends at once with one plain line. `browser check` has a whole-run limit
  and never hangs.
- **The gateway's setup questions and its output** print through the one output module, so a
  pipe, a file and a terminal get the same words.

**What to run:** `cc-smart-dev-kit update`, then `cc-smart-dev-kit setup` (it refreshes the
instructions' copy, and the portal's export), then — on a machine with the gateway —
`cc-smart-dev-kit gateway setup` yourself, because the router changed in this release; it asks
before it restarts. Then restart every open Claude Code session: an update makes a new version
folder, and a running session keeps the old one.

## 1.0.1

A hotfix for **crew sessions**: `crew start` failed and stopped every crew session it started.
It read `claude agents --json` once, right after `claude --bg -w …`, and that read reports the
folder the session was launched in until the session has entered its worktree — so every new
crew session looked like it worked in the main checkout. `crew start` now records the session's
id and leaves it `starting`; the session's own start hook checks its real folder, and a session
in any other folder is marked failed and stopped.

**What to run:** `cc-smart-dev-kit update` — a patch version also installs by itself within the
hour. No `gateway setup`: the router did not change.

## 1.0.0

**1.0.0 is a major version, and the first one the hold covers.** It refuses three retired
fields in a project's `.claude/cc-smart-dev-kit.json` — `worktrees.prefix`, `worktrees.setup`
and `worktrees.engine` — and the worktree engine they configured is gone. A patch or a minor
version still installs by itself; this one waits until you run `cc-smart-dev-kit update`
([The background update](README.md#the-background-update)). Run these steps in your own terminal, in
this order:

1. **`cc-smart-dev-kit update`** — installs 1.0.0. It lists every repository your saved
   sessions worked in that still carries a retired field or an engine hook line, one `!` line
   each with its fix.
2. **`cc-smart-dev-kit setup`** — refreshes the instructions' copy for this version and turns
   claude-mem's two start blocks off ([claude-mem](README.md#claude-mem)).
3. **`cc-smart-dev-kit gateway setup`** — **run this one yourself**: a Claude Code session must
   never restart its own router. The router changed in this release (the breaker, Anthropic's
   server tools, the judge), so this puts the new copy in place. It asks before it restarts
   the router. A restart lets the answers in flight finish (up to 120 s; an answer still
   running then is cut, and Claude Code retries it), and new requests wait in the socket
   meanwhile.
4. **`cc-smart-dev-kit project init`** in each project — takes the retired fields and the
   engine hook lines out ([`project init`](README.md#project-init)); commit the two files it writes.
5. **`cc-smart-dev-kit doctor`** — every line ✓.

Then restart every open Claude Code session: an update makes a new version folder, and a
running session keeps the old one.

The changes, one line each:

- **Crew sessions** ([The workflow](README.md#the-workflow)): a small lead session starts background
  crew sessions for a plan's phases, each in its own worktree, never waits, and merges their
  branches. Off by default: turn it on with `cc-smart-dev-kit workflow set crew.enabled true`,
  or with [`crew.enabled`](README.md#the-workflow) in your own file or a project's.
- **Less Opus** ([Instructions, skills and agents](README.md#instructions-skills-and-agents)): Opus
  builds architecture and UI/UX work only, and the other kinds build on the worker slot; a
  review runs on Opus only for a risky change set. UI/UX design runs only on `opus` or
  `fable`, at `high` or above, and the agent guard refuses it anywhere else.
- **One updater** ([The background update](README.md#the-background-update)): `setup` writes
  `autoUpdate: false`, so Claude Code's own plugin update cannot install a major version past
  the hold.
- **`cc-smart-dev-kit search` is gone**: use Claude Code's own WebSearch and WebFetch, or
  the Tavily MCP server ([MCP servers](README.md#mcp-servers)).
- **Server tools go to Anthropic** ([The AI gateway](README.md#the-ai-gateway-optional)): a request that
  carries Anthropic's own web search tool goes to Anthropic as it came, whatever the slot, so
  the search really runs; at a Claude limit it gets a short note naming Tavily.
- **The breaker** ([The AI gateway](README.md#the-ai-gateway-optional)): when every target of a slot is
  limited or down, the router holds the request (up to 240 s) and then answers a 429 Claude
  Code retries; the status line and the alert name it.
- **The judge** ([First setup](README.md#first-setup)): Claude judges auto mode's checks first; while
  Claude is limited or down, the targets of your worker slot that passed the judge test judge
  in its place.
- **Finished worktrees clean themselves** ([Worktrees](README.md#worktrees)): after a merge into the
  base, and at an attended session start at most once an hour, the kit removes the ones the
  verdict proves finished; [`worktrees.autoClean`](README.md#a-projects-claudecc-smart-dev-kitjson)
  turns it off.
- **New guards** ([The hooks](README.md#the-hooks)): `session-escape-guard` stops a session loosening
  its own limits; the shell judge (`job-route`) judges a raw `claude --bg`, `claude -p` and a
  crew session's launches, and refuses polling; `workflow merge-check` prints the merge
  guard's verdict without merging.
- **A subagent never hands back with its own background work running**
  ([The hooks](README.md#the-hooks)): `subagent-background` blocks the stop once, with one plain reason
  (BG1).
- **Native Windows** ([Windows](README.md#windows), [docs/windows-setup.md](docs/windows-setup.md)): the
  installer, the launcher, the hooks, the gateway, the job queue and the crew work there; the
  doc holds the checklist for a real PC.
- **`medium` effort is allowed**; a review recorded before 1.0.0 no longer counts, because a
  record now names the agent that wrote it, and the merge guard asks until one does
  ([The workflow](README.md#the-workflow)).
- **claude-mem's two start blocks are off** ([claude-mem](README.md#claude-mem)): `setup` turns both
  off and turns Claude Code's own task tools on; set one back to `"true"` in
  `~/.claude-mem/settings.json` to turn it on.

## 0.7.0

**A major version now waits for your `cc-smart-dev-kit update`.** A patch or a minor version
still installs by itself, within the hour. A major version (the first number grows) does
not: each interactive session start shows one line until you run `cc-smart-dev-kit update`
([The background update](README.md#the-background-update)).

1.0.0 is such a version. It refuses the old worktree fields in a project's
`.claude/cc-smart-dev-kit.json`; its `cc-smart-dev-kit project init`, run in each project,
fixes them. Read the 1.0.0 notes above before you run `cc-smart-dev-kit update`.

**Claude Code's own plugin auto-update is now off for this marketplace.** It knows nothing of
the hold, so it would install a major version by itself. The kit's own background update is
the one updater now. `setup` writes `autoUpdate: false` (an explicit `false`: a removed key
leaves Claude Code's own record at `true`). On a machine that got 0.7.0 by itself, the next
background check turns an older setup's `true` to `false` (a `true` you set stays yours:
`doctor` says what to do).

**After this update, restart your running Claude sessions.** Until then, a session that
loaded 0.6.0 may run 0.6.0's hook again on a `/clear` or a compaction, and that older check
would install a newer major version by itself.

## 0.6.0: Serena is removed

The plugin no longer registers the Serena MCP server, and its `serena-root` hook and its
`code-explorer` agent are gone. One Serena server ran for each Claude session, at about 3 GB of
memory each in a large project; sessions seldom used it, and Grep, Glob and Read do most code
search. For a file's shape — its functions and exports — claude-mem's `smart_outline`,
`smart_search` and `smart_unfold` do the job (claude-mem is a [companion
plugin](README.md#companion-plugins) setup installs).

**After you update, run `cc-smart-dev-kit setup` once.** It takes back what an older setup made
for Serena, and nothing else:

- the `serena` MCP server, with Claude Code's own `claude mcp remove serena --scope user` —
  only while setup's record says setup registered it, and it still holds exactly what setup
  registered (or, after a pin update an older setup left half done, it still has setup's own
  shape: `uvx`, Serena's repository, and setup's own context file);
- Serena's context file, `~/.local/share/cc-smart-dev-kit/serena/contexts/worktree.yml`
  (a backup goes to the state folder first), and its folder once it is empty;
- the `serena-root` hook's records, `~/.claude/cc-smart-dev-kit/serena-root/`.

`--dry-run` shows each of these first. Until setup has run, `doctor` prints one ✗ line that
says so; after it, nothing.

**A Serena of your own stays.** A `serena` server that setup did not register (or one you
changed since) is never touched: `doctor` shows it as a `·` line. Its context file stays too,
while a registration still starts Serena with it. The main-folder guard no longer looks at
Serena's edit tools, so a Serena you keep can edit a guarded main checkout without a refusal.
To remove a Serena of your own by hand:
`claude mcp remove serena -s user`. A project's own `.serena/` folder (Serena's project
settings and memories) is the project's: delete it when nothing uses it any more.

A project whose `.claude/cc-smart-dev-kit.json` lists `serena-root` in `ownHooks` keeps working:
the name is still accepted, silences nothing, and `doctor` says it can go.

## 0.5.0

**After you update, run these in your own terminal, in this order:**

1. `cc-smart-dev-kit gateway setup` — updates the router copy on this machine (a plugin update
   alone never does: until this step the older router keeps answering). It also takes out the
   model keys 0.4.3 wrote (`ANTHROPIC_DEFAULT_HAIKU_MODEL` / `…_SONNET_MODEL`, only where
   cc-smart-dev-kit set them), and drops the hidden `claude-sonnet-5-5` from a scout or worker
   chain that is still 0.4.x's default. A slot is reached by the model's family now, so those
   keys are no longer needed.
2. **Restart every open Claude session right after.** A session that is still running may keep
   sending `haiku` / `sonnet` work by the slot's old name; when that slot has no chain, the
   router refuses it with a 400 that says what to do.
3. `cc-smart-dev-kit gateway on` — only if the gateway is not on yet.

Check your scout and worker chains (`cc-smart-dev-kit gateway status`): a Claude model answers
there only if you put it in the chain. Setup took out the `claude-sonnet-5-5` 0.4.x added at
the end of its default chains; a chain you changed is left as it is.

An opus or fable chain set before 0.5.0 starts with its fallback **off**: it moved on only at
the plan's usage limit, and "on" now moves on at any rate limit or server error. Turn it on
with `cc-smart-dev-kit gateway fallback <slot> on` when you want that. An opus or fable chain now
also takes every Opus or Fable id, not only the one 0.4.x keyed it by, and a `claude-…` first
target answers for all of them.

A judge set before 0.5.0 is ignored until it is tested and set again
(`cc-smart-dev-kit gateway slot judge <target>[,…]`), because the judge's job changed: it judged
only when Claude could not, and then judged every check in Claude's place. Now Claude
judges first again, and your worker slot's tested targets judge while Claude is limited or down.

The gateway:

- **Every slot works the same way** ([The AI gateway](README.md#the-ai-gateway-optional)). Opus and Fable
  take any chain, a backend first included (`gateway slot opus omniroute:<model>`), and the scout
  and the worker keep theirs. Every slot is **Claude or Custom**: a slot with no chain in use is
  Claude — that model is plain Claude, on your own login. `gateway slot <slot> claude` switches it
  to Claude and **saves its chain** (`kept` in the config, never used), `gateway slot <slot>
  custom` uses it again with its fallback switch, and `gateway slot <slot> clear` deletes it
  (`off` still means `claude`). A fresh setup writes no chain, so the plugin picks no model for
  you; and there is no hidden Claude step — a chain whose targets are used up returns its error.
  The old portal's saved chains move into `kept` on `gateway setup`.
- **Each slot has a fallback switch** ([The AI gateway](README.md#the-ai-gateway-optional)):
  `cc-smart-dev-kit gateway fallback <slot> on|off`. On: the next target answers when the one
  before it fails or rests. Off: only the first answers, and the rest stay saved. On by default
  for scout, worker and judge, off for opus and fable.
- **A request reaches its slot by the model's family**, so `gateway on` no longer pins `haiku`
  and `sonnet`. A newer version of a family (`claude-opus-6-0`) reaches its slot with no change.
- **Claude judges auto mode's checks first** ([First setup](README.md#first-setup)). While Claude is limited
  or down, the targets of your worker slot that passed the judge test (`gateway setup` and
  `gateway slot worker` run it) judge in its place; `gateway fallback judge off` keeps Claude
  alone. A judge chain you set wins, and may hold a `claude-…` target.
- **WebSearch goes to Anthropic** ([The AI gateway](README.md#the-ai-gateway-optional)): a request that
  carries Anthropic's web search tool is sent to Anthropic as it came, whatever the slot of the
  model. When Claude is at its limit or down, the search result is a short note from the router
  that points at the Tavily MCP server's search tool.
- **An affordable model's thinking stays visible** ([The AI gateway](README.md#the-ai-gateway-optional)): the
  router keeps it, marked as its own with the backend's signature inside. It removes it only on a
  request to Claude (no "Invalid `signature`" 400), and gives a backend its own signature back.
- **The usage-limit alert names no model of its own** ([The usage
  limit](README.md#the-usage-limit-the-alert-the-status-line-and-usage)): it offers your model first, then
  targets from your own chains, and its action also turns that slot's fallback on. It covers
  every family that has a slot.
- **`agent-guard` reads affordability from `gateway.json`** ([The hooks](README.md#the-hooks)): a `haiku`
  or `sonnet` launch is affordable while the gateway is on and that family's slot has a chain
  whose first target is a backend — no longer from the model keys 0.4.3 wrote.
- **claude-mem follows the scout slot only** ([claude-mem on the
  gateway](README.md#claude-mem-on-the-gateway)): setup points it at the scout chain's first target when
  that is a backend, writes no quota fallback model any more, and takes out the fixed Claude
  Haiku fallback 0.4.3 wrote there.

Worktrees:

- **`worktrees --remove <path>` no longer finds itself** ([Worktrees](README.md#worktrees)). The command's
  own line (`… worktrees --remove /path/wt`) and the shell that ran it name the folder being
  removed, so on Linux and macOS every removal answered "kept …: programs run from its files:
  bash, bun". Each process's parent is read now (`ps -ww -o pid=,ppid=,args=`, `ParentProcessId`
  on Windows), and the command's own process and those that started it are left out of the
  command-line match; a process whose working folder is inside the worktree still counts, so a
  session or a shell really sitting there keeps it.

The merge guard:

- **`--admin` always asks** ([The hooks](README.md#the-hooks)). The merge guard asks you about every
  `gh pr merge … --admin` (or `--admin=<anything>`), even when `autoMerge` would let the merge
  through: `--admin` merges past the repository's required reviews, required checks and merge
  queue. It asks, never refuses, so a release flow can still use it after your yes.
- **An exact allowed merge is `allow`** ([The hooks](README.md#the-hooks)). For `gh pr merge <n>` with
  flags gh has, when `autoMerge` is on, the checks are green and a review covers the head under
  `fixesAfterReview`, the guard answers `allow`: no question, and no auto-mode "Merge Without
  Review" block for that call. Every other merge form keeps the policy's silence, so auto mode's
  rule still applies to it, and a crew session never gets `allow`.

The installer:

- **The marketplace is added over HTTPS when SSH to GitHub is refused** ([Install](README.md#install)).
  Claude Code adds a marketplace over ssh by default, so a machine with no GitHub SSH key (or a
  port-22 block) failed with nothing added. The installer retries that one source once as
  `https://github.com/<owner>/cc-smart-dev-kit.git`, says so in one line, and goes on — the
  marketplace's name comes from the repository's own marketplace file, so it lands under the
  same name.
- **An account that cannot read the repository is named** ([Install](README.md#install)). With `gh`
  installed and logged in, the installer asks `gh repo view <owner>/cc-smart-dev-kit --json name`
  before it adds anything: the run stops (exit 1) with the account, the line to ask the
  repository's owner for read access, and the invitation page. `doctor`'s marketplace check
  names the same two causes with the same fix lines.

## 0.4.3

Every change here comes from the installer's FIRST real run, on 2026-10-17, and from what it
left behind on that machine.

- **The marketplace is refreshed before any version is compared** ([Install](README.md#install)). The
  live run had the marketplace added hours earlier at 0.4.1: the installer compared the
  installed 0.4.1 with that stale clone's 0.4.1, saw them equal, updated nothing — and then
  called an option the installed 0.4.1 CLI did not have, so the run died at the Tavily step.
  The installer now runs `claude plugin marketplace update` first (the same order
  `cc-smart-dev-kit update` uses), and then reads the installed CLI's own version: older than the
  release the installer ships with means it stops, with the two exact commands and exit 1,
  instead of calling an option that CLI may not have.
- **A backend key is tested before it is saved** ([The AI gateway](README.md#the-ai-gateway-optional)).
  A person pasted their Ollama Cloud key where the router's OmniRoute key was asked for; it was
  saved unchecked, OmniRoute answered 401 to every request after that, and every affordable
  subagent fell back to Claude until the key was read back out of OmniRoute's own database. Now
  `gateway setup --backend-key-stdin` makes one cheap authenticated request first
  (`GET /v1/models`): a 401 or 403 refuses the key, keeps the one in the file and exits 1, saying
  which key the backend wants. A backend that cannot be asked (unreachable, or a 5xx) saves
  nothing either — unless `--save-unchecked` says you know. And the file is backed up before a
  key that is really changing replaces one.
- **No key yet? setup can make one.** ([First setup](README.md#first-setup))
  `cc-smart-dev-kit gateway setup --omniroute-password` (or `--omniroute-password-stdin`) takes
  your OmniRoute **dashboard** password — asked with no echo, never stored — logs in to the local
  OmniRoute, makes the router's key named `cc-smart-dev-kit-router-<machine>`, tests it and saves
  it. No dashboard trip, no copy-paste.
- **The installer asks before it touches an MCP server of yours** ([MCP
  servers](README.md#mcp-servers)). A project's own script had registered `playwright`, `serena`,
  `sequential-thinking` and `tavily-websearch` at user scope first; setup left them alone (the
  rule) and printed one `!` line nobody saw, so the old browser kept starting and the plugin's
  own never took over. The installer now runs `cc-smart-dev-kit mcp status --json`, shows what
  runs instead, and asks per server: "Replace it with cc-smart-dev-kit's?" — a yes removes it and
  runs setup again (so the plugin registers its own **with its record**), a no lists it under
  "What is left" with the exact command. `doctor` gained a `!` line for the same case.
- **The gateway is asked about only when it is not working** ([First
  setup](README.md#first-setup)). A new read-only `cc-smart-dev-kit gateway check` answers one question
  with an exit code: 0 the key works, 1 no key yet and OmniRoute answers (setup can make one),
  3 it could not be judged, 4 the key in the file is one OmniRoute refuses. The installer asks
  for a key only on 1 and 4 — showing what runs instead and never a key — and asks again **once**
  after a refusal, keeping the old key.
- **A pasted secret no longer arrives broken.** Warp and other terminals wrap a paste in the
  bracketed-paste markers `ESC[200~` … `ESC[201~`, and a read that echoes nothing keeps every
  character: a token a person pasted was refused as "55 characters" and never saved. Every
  secret read now strips those markers and any other control character — in the plugin (one
  home: `src/cli/secret-line.ts`), and in both installers. The token step is also ONE question
  now (paste it, or Enter to skip): a paste can no longer land in a yes/no answer, and every
  path of `browser token` that saves nothing exits non-zero.
- **The `claude-code` profile is named in BOTH of Chrome's files**
  ([The browser](README.md#the-browser)). Chrome reads the display name from `Local State` and falls back
  to the profile's own `Preferences` (`profile.name`); only the first was written, and the person
  saw the profile unnamed. Both are written now, still only while Chrome is closed — while it
  runs, the page says "close Chrome, then run `cc-smart-dev-kit browser setup` again".
- **`doctor` no longer invents extensions.** It judged the profile by the folders on disk, and
  named Chrome's own `Temp` folder and Chrome Web Store Payments — neither of which a person can
  find in `chrome://extensions`. It reads Chrome's own record now: a folder with a manifest, and
  a location that is not a component or an install Chrome made for itself. A real extra
  extension is named by its manifest name (a `__MSG_…__` name resolved from its own locales).
- **Tavily is never asked for twice** ([MCP servers](README.md#mcp-servers)). The person had
  `TAVILY_API_KEY` in their environment and a project already running a Tavily MCP server; the
  installer asked anyway. It says one line instead — "Tavily: using TAVILY_API_KEY from your
  environment" — and asks only when neither the environment, the key file, nor your settings
  have one.
- **The Fable warning is at the switch, or right after Fable's first answer — never after a
  switch away** ([The hooks](README.md#the-hooks)). `fable-session` read the transcript's last answer at
  every prompt, which is the PREVIOUS turn's model: it missed the switch to Fable, and then
  warned while the person was back on Opus. It runs on `PostModelSwitch` (the model the session
  moved TO), on `Stop` (the answer that just finished) and on `SessionStart`, and no longer on
  `UserPromptSubmit`.
- **The portal's log is newest first** ([The portal](README.md#the-portal)): the Health page's Log and the
  Overview's "Latest warnings" both show the newest line at the top, with the times as they are.
- **`gateway setup --omniroute-password` works on a real terminal** ([First
  setup](README.md#first-setup)): the flag asks for the dashboard password with no echo, and the context it
  reads from never carried the reader — every run answered "this terminal cannot hide what you
  type", even on a terminal. It reads the line now, and a key it makes but does not save (a key
  the backend refuses, an unchecked save without `--save-unchecked`) is **deleted again** in
  OmniRoute, so the dashboard keeps no unused key; a delete that fails names the key and its id.
- **Nothing that names a server can print a key** ([MCP servers](README.md#mcp-servers)): a URL's query,
  fragment and userinfo are hidden, an argument after a key-like flag (`--api-key X`) and a
  `name=value` whose name looks like a key (`--token=X`) show `•••`, and the command is shown by
  its own name — in `mcp status`, its `--json`, the installer's question and `doctor`'s line.
- **A Tavily key that lives only in your `settings.json` is a key setup uses** ([MCP
  servers](README.md#mcp-servers)): Claude Code fills `Bearer ${TAVILY_API_KEY}` from the settings' `env`
  as well as from your environment, so setup now reads that copy too — it registers the server
  instead of saying there is no key, while the installer had already stopped asking for one.
- **`tavily-websearch` is offered for replacement like the other three** ([MCP
  servers](README.md#mcp-servers)): the check used to leave it out when the machine had no Tavily key, so
  a server a project's own script had registered under that name was never mentioned. And the
  installer asks again after the Tavily step, when the key has arrived.
- **`doctor` names a same-name server that wins over the plugin's**
  ([MCP servers](README.md#mcp-servers)): a copy at the local scope (`~/.claude.json`,
  `projects[<folder>].mcpServers`) or in a project's `.mcp.json` takes precedence over the
  user-scope one, so that copy is the one Claude Code starts.

## 0.4.2

- **One command installs the plugin** ([Install](README.md#install)): `install.sh` for macOS and
  Linux, `install.ps1` for native Windows, the same steps, the same words and the same exit
  codes. Each step prints one line and is skipped when it is already done, so a second run
  only fixes what is missing. It asks before it installs or upgrades Bun, asks for the
  browser's token, the gateway's key and the Tavily key (each skippable, never echoed, never
  printed), and ends with `doctor` and — when something is left — the list of what is left,
  each item with the exact line that finishes it. `--dry-run` prints the plan for this
  machine and changes nothing. A step that fails stops with the command that retries it;
  running the installer again goes on from there. It refuses inside a Claude Code session,
  and it never writes a secret file or passes a secret on a command line: each key reaches
  the plugin's own command on stdin. Exit codes: 0 done, 3 installed with items left, 1 a
  step failed, 2 refused.
- **The move runs on every machine, and `setup` always follows it** ([Moving from
  anymodel](README.md#moving-from-anymodel)): `migrate` decides by itself what to move and says
  "Nothing to move." on a machine without the old names, so the installer no longer guesses
  for it — and the old `anymodel` plugin, when it is still installed, is asked about
  afterwards. `setup` then installs the instructions and the launcher, which the move alone
  does not.
- **`cc-smart-dev-kit setup --tavily-key-stdin`** ([MCP servers](README.md#mcp-servers)): the Tavily
  key on stdin, never an argument. setup writes it to the key file it reads a key from
  (`~/.claude/cc-smart-dev-kit/tavily.key`, mode 600, through the same atomic writer as the
  browser's token) and then treats it as a key from that file, so a later setup keeps it.
- **Adding the new marketplace does not reuse the old one** ([Moving from
  anymodel](README.md#moving-from-anymodel)): proved live on a machine that still had the `anymodel`
  marketplace — adding this repo's source made a SECOND marketplace, named
  `cc-smart-dev-kit`. The installer and the move both rely on it, so "already added" is a
  marketplace's own name, never its source.

## 0.4.1

- **Fable may be a fresh attempt** ([Instructions, skills and agents](README.md#instructions-skills-and-agents)):
  when you are not satisfied with Claude's own answer — a UI/UX design, an engineering problem, a
  fix — the session may launch a read-only Fable advisor for a fresh attempt, with the reason
  `Fable reason: unsatisfied - <what you disliked>`. It proposes a design, a plan or a fix; you
  or a crew session build it, and you approve each launch.
- **Fable may build, and a session may run on Fable** ([The hooks](README.md#the-hooks), and the model
  table in [Instructions, skills and agents](README.md#instructions-skills-and-agents)): an agent that can
  change files — a builder, or a fork — runs on Fable with `Fable reason: build - <what you asked
  for>`, which you approve each time; anything else there keeps being refused. Nothing objects to
  a session whose own model is Fable: it is your choice. For a hard or high-stakes change —
  security, money, permissions, a big architecture change — the session may also run the
  second-opinion review on Fable by its own judgment, with the reason
  `Fable reason: review - <why>`, and the guard asks you.
- **A note when the session itself runs on Fable** ([The hooks](README.md#the-hooks)): the new
  `fable-session` hook shows you one line, once a session, when the session's own model is the
  `fable` tier — it uses your plan's limits faster than Opus, so switch with `/model` if you did
  not mean to. Nothing goes to Claude, it never blocks anything, and a `/model` switch to Fable
  is caught once Fable has answered, at the prompt after that. That the line reaches you at all
  is **not yet proved live** (see the owed check in
  [docs/claude-code-contract.md](docs/claude-code-contract.md) § Relied on, not proved yet).
- **A review at effort `max` asks instead of being refused** ([The hooks](README.md#the-hooks)):
  `agent-guard` now asks you to approve a review at `max` — reviews run at `xhigh` unless you asked
  for a deeper one — and records it, so `cc-smart-dev-kit usage` lists it. In `claude -p`, where
  nobody can answer, it is still refused.
- **`opus` and `fable` mean the tier, whatever model answers** ([The hooks](README.md#the-hooks)): an
  `ANTHROPIC_DEFAULT_OPUS_MODEL` / `…_FABLE_MODEL` override (or a model slot) that points one at
  another vendor's model keeps the tier's rules — the reason line, your approval, the review
  rules, and never a forced `max` — and the guard's question names both, like
  `` `opus` (answered by openai:gpt-5.5) ``.

## 0.4.0

- **`cc-smart-dev-kit project init`** sets a project up: its `.claude/cc-smart-dev-kit.json`
  and, unless the project runs an engine of its own, the worktree engine's three hook lines
  ([`project init`](README.md#project-init)).
- **The workflow, and `cc-smart-dev-kit workflow`**: what cc-smart-dev-kit may do by itself
  here — commit, push, open a pull request, merge. The project's committed file wins over
  your own defaults, and `show` prints each value with where it came from
  ([The workflow](README.md#the-workflow)).
- **A base per branch prefix** (`worktrees.bases`): a `hotfix/…` or `release/…` worktree
  starts from the base that prefix names, not from the integration base
  ([Worktrees](README.md#worktrees)).
- **`worktrees.engine: "own"`**: a project that runs its own worktree engine says so, and
  `doctor` expects no cc-smart-dev-kit hook lines there ([A project's
  `.claude/cc-smart-dev-kit.json`](README.md#a-projects-claudecc-smart-dev-kitjson)).
- **Windows**: native Windows, with Git Bash for the parts that are `sh` scripts — the
  hooks, setup, the launcher, the gateway as a Scheduled Task, the job queue, the toasts
  ([Windows](README.md#windows)).
- **`cc-smart-dev-kit usage`** also shows auto mode's safety checks, which the gateway's
  router counted, by day, with the tokens each answer reported
  ([The usage limit: the alert, the status line, and `usage`](README.md#the-usage-limit-the-alert-the-status-line-and-usage)).
- **The browser drives your own Chrome**, through the Playwright extension, in a profile of its
  own named `claude-code`: `cc-smart-dev-kit browser setup` makes it and prints the steps,
  `browser token` saves the token its status page shows — and `browser mcp` refuses to start
  without that token, so nothing ever waits for an approval click ([The
  browser](README.md#the-browser)). The plugin's own shared Chrome, its profile and the tab filter are
  gone; the profile folder 0.3.0 left stays on disk, `doctor` names it and the command that
  deletes it, and nothing here deletes it for you.
- **The instructions work in parallel**: the plugin's general instructions tell Claude to
  start every independent phase at once, and never to wait for a merge, a release, a review
  or an answer it does not need ([Instructions, skills and agents](README.md#instructions-skills-and-agents)).
- **The merge guard, and the review record** ([The workflow](README.md#the-workflow)): the `merge-guard`
  hook asks you before a `gh pr merge` your policy does not allow, and tells auto mode nothing
  for an exact `gh pr merge <n>` whose whole policy — `autoMerge`, the checks, a review covering
  the fixes after it — passed; `workflow show` says whether the commit here has a recorded
  review, and `workflow merge-check` prints the same verdict without merging.
- **The effort rule** ([The hooks](README.md#the-hooks)): `agent-guard` allows a subagent only at
  `high`, `xhigh` or `max` — `low`, `medium` or a level it does not know is refused, as
  before a launch with no model or no effort. An affordable slot still runs at `max`; a
  review runs at `xhigh`, unless you asked for a deeper one — `max` then asks you (0.4.1).
- **The alert settings** ([Notifications](README.md#notifications)): `alerts.events` says which moments
  alert, `alerts.sound` adds the platform's sound, and `alerts.usagePercent` is the plan share
  the status line warns from.
- **The Linux desktop extras of the alerts** ([Notifications](README.md#notifications)): a click
  raises the session's window, the alert moves to the notification centre after a minute, one
  alert per session is on screen, and XFCE's Do Not Disturb keeps an ordinary alert quiet —
  each only where its tool is installed.
- **The portal's Settings page, its Project card and its Browser card** ([The
  portal](README.md#the-portal)): the workflow settings with where each value comes from, the project's
  two files planned and written from the form, and the browser's state with the button that
  runs `browser setup`.
- **"Dynamic, not hard-coded"** ([Instructions, skills and agents](README.md#instructions-skills-and-agents)):
  the instructions tell Claude to read every value — a name, a path, a port, a URL, a version,
  a branch, a list — from the one place that owns it, never from a copy in the text.

**After you update, run `cc-smart-dev-kit gateway setup` on every machine with the gateway.**
The router changed in this release (it counts auto mode's safety checks, which `usage` reads),
and that command puts the new copy in place. It asks before it restarts the router, because a
restart cuts the answers in flight.

**The browser needs its two steps too** ([The browser](README.md#the-browser)): the `playwright` server
refuses to start until `cc-smart-dev-kit browser setup` has made the `claude-code` profile and
`cc-smart-dev-kit browser token` has saved the token from the extension's status page. A machine
that ran 0.3.0 also still has its old shared profile at
`~/.local/share/cc-smart-dev-kit/playwright`, and possibly the Chrome 0.3.0 started: nothing uses
either now, and `doctor` names both — where the folder is, the command that deletes it, and the
pid of that Chrome, whose debug port any program on your machine can drive. Neither is deleted
for you: the folder may hold sign-ins, so that call is yours.
