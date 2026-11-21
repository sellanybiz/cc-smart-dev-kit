# The hooks


The hooks live in `src/hooks/`. Every one of them is wired by the plugin:

- **The plugin's hooks** (`HOOKS`): each one a bundle (`src/entries/<name>.ts` →
  `plugin/dist/<name>.js`), wired in **shell form** in `plugin/hooks/hooks.json` (no `args`;
  the exec form it replaced cannot start on Windows — `.claude/rules/hooks.md`,
  `docs/windows-hooks.md`), so they run in every project. They run through
  `plugin/bin/cc-smart-dev-kit-bun.sh`, a small `sh` script that finds
  bun without PATH (Claude Code's hooks get the PATH it was started with, which may lack
  bun): the bun `cc-smart-dev-kit setup` baked into the launcher, then `$BUN_INSTALL/bin/bun`,
  `~/.bun/bin/bun`, and PATH. With none it answers by its `--missing=` mode: the one hook that
  stands in front of a tool call, `user-away`'s PreToolUse entry for the two question tools,
  passes `--missing=ask`, so it asks the person instead of letting the tool run (it fails
  closed, and asks too when its own bundle file is gone, and its `hooks.json` entry says
  `"onFailure": "block"`); every other hook, `job-route` included, passes `--missing=quiet`, one line on
  stderr and exit 0; the command `plugin/bin/cc-smart-dev-kit` passes `--missing=fail`, one
  line and exit 1. A bun older than the plugin needs counts as no bun.
  It starts bun with `--no-env-file` and the plugin's own empty config, like the launcher and
  `plugin/bin/cc-smart-dev-kit`: bun would otherwise add the working folder's `.env` files to
  the hook and run its `bunfig.toml`, and a hook must see the environment Claude Code gave
  it, never a project's — the same rule `job run` refuses a job without.
  The baked line is
  single-quoted the way `shellQuote` writes it (each `'` as `'\''`), and the shim undoes
  exactly that, so a bun under a folder like `/home/o'brien` is found.

The contract they follow: `.claude/rules/hooks.md`. The Claude Code behaviour they rely on,
each row proved: `claude-code-contract.md` § Hooks and § Worktrees.

### One frame for every hook

Every hook runs in the same frame (`src/hooks/run.ts`), in this order:

1. **Read the input.** Not JSON, another event, or a `cwd` outside git: nothing to do.
2. **The project's own copy.** When the project's `cc-smart-dev-kit.json`
   lists the hook in `ownHooks` (`["verify-gate"]`), the plugin's hook exits 0 and prints
   nothing, so the project's copy runs alone (§ The safe switch). Only that field is read
   (`ownHooksOf`), on its own, so it works even when the rest of the `cc-smart-dev-kit.json` is
   broken or needs a newer plugin. It is explicit on purpose: a project hook on the same
   event is not enough to silence a plugin hook, because it may be a logger, a different
   check, or a copy that does not cover the same commands — and a hook that went quiet for
   that would leave the person unguarded (owner). `cc-smart-dev-kit doctor`, run in a
   project, prints one `·` line per listed hook, and warns (`!`) when a listed hook has no
   project hook left to answer, or when a project hook runs next to a plugin hook the list
   does not name. A hook the project wires itself skips this step: that wiring is its
   opt-in. **Two hooks skip the step themselves:** `job-route` and `user-away` are `alwaysOn`
   (`HookSpec.alwaysOn`), so the frame never reads `ownHooks` for them — the first limits how much heavy work runs at once, and the switch of the second is the
   person's (§ The job route, § While the person is away). `ownHooks` does not accept `user-away`'s
   name; it still accepts `job-route`'s,
   because a project file written before 1.0.0 may carry it, and the name silences nothing
   (`UNSWITCHABLE_HOOK_NAMES`).
3. **Read `cc-smart-dev-kit.json`**, through the checked cache (§ The checked project file).
   When it is broken or needs a newer plugin, the hook
   **fails closed**, each in the way that suits its event: `user-away`'s question-tool entry asks
   the person, `job-route` leaves the line as written (with no project there is nothing to route
   for), an informational hook says one line. "Closed"
   never means silent: a person must hear why. A file that cannot be read at all (a folder, no
   permission) is a crash, not a config problem.
4. **Run.** An informational hook's error is one line on stderr and exit 0: its bug never
   stops work. A crash of `user-away`'s question-tool entry answers through its `onCrash`
   (`guardCrash` in `guard-crash.ts`): it asks about the call in its own domain, so a crash never lets
   a question tool through; a crash of `job-route` lets the line run as written.
5. **Record an ask.** An answer that asks the person is appended to `guard-asks.jsonl` in the
   state folder (`src/hooks/ask-log.ts`): the time, the hook, the session, the tool and a
   short reason, put through `maskedLine` so no secret reaches it. The file stays small by
   the rule of `update.log` (past `LOG_MAX_BYTES` the newer half is kept). A write that fails
   is one line on stderr and never changes the answer.

Each hook's answer when it fails (the same table is in `.claude/rules/hooks-guards.md` § Fail safe):

| Failure | `user-away`'s question-tool entry | `job-route` | Any other plugin hook |
|---|---|---|---|
| Its own code throws | `onCrash`: **ask** about the call (none outside its domain) | the line runs as written | one stderr line, exit 0 |
| The input is not JSON | **ask**, in general | nothing to route | one stderr line, exit 0 |
| `cc-smart-dev-kit.json` broken or too new | judges anyway (its own state file) | leaves the line as written | one line of context or stderr (`keep-going`, `builder-finish`, `agent-usage`, `fable-session`, `tier-view` and `task-start` judge anyway) |
| No bun, or one too old | the shim's `--missing=ask`: **ask** | `--missing=quiet`: stderr, exit 0 | `--missing=quiet`: stderr, exit 0 |
| The bundle file is gone | the shim **asks** | bun's error, exit 1 | bun's error, exit 1 |
| Cannot start, times out, fails (exit code other than 0 and 2) | `"onFailure": "block"`: the call is **blocked** | Claude Code goes on | Claude Code goes on |

The command `plugin/bin/cc-smart-dev-kit` runs through the same shim with `--missing=fail`: no
bun is one stderr line and exit 1, because a command must never report success when it did not run.

The frame is general on purpose: later hooks are new specs in it. **No hook turns an ask into a
parked action any more**: while the person is away, `user-away` refuses the two question tools
and leaves every permission dialog to Claude Code (§ While the person is away).

### What a hook bundle carries

Each hook is its own bundle (`plugin/dist/<name>.js`), and every run loads the whole file, so its
size is part of the cost of every session event. A spec lives in its own module,
`src/hooks/specs/<name>.ts`, and the entry imports only that one. `specs.ts` holds the lists
(`HOOKS`, `GUARD_BUNDLES`, `MACHINE_WIDE_HOOKS`) and re-exports every spec for the code and tests
that want them all; **an entry never imports it**, because it builds all the hooks at load.
`guardCrash` has its own module (`guard-crash.ts`), so `user-away`'s spec can use it without a
cycle through `specs.ts`.

Before the split each hook bundle was about 585 KB and a run took about 32 ms. After it each
bundle was 266 to 357 KB and a run took about 22 to 27 ms (median of 40 runs on a quiet machine,
against about 4 ms for an empty bun script). The checked project file (below) took the three
hooks that need no zod of their own down to 29 to 87 KB, and `job-route` down to 160 KB.
`entries.test.ts`
builds every bundle `hooks.json` runs (the hooks with a spec, and `update-check` and
`playwright-output`) into a temp folder and holds four proofs for them:

- **A size budget** for each bundle (the measured size plus about a tenth). It catches an entry
  that loads the whole list of hooks, which is about 585 KB. It can miss one extra spec: a small
  spec adds less than the tenth the budget allows.
- **An import walk** from each `src/entries/<name>.ts` (`Bun.Transpiler.scanImports`, following
  relative paths): the files it reaches under `src/hooks/specs` must be exactly its own
  `specs/<name>.ts`, and never `specs.ts`. It catches any extra spec, whatever its size. The two
  bundles without a spec must reach none.
- **The built file run as a subprocess**, with the two flags the shim gives a hook
  (`--no-env-file` and the plugin's own `bunfig.toml`, `runBundle` in `src/testing/hooks.ts`).
  A hook with a spec gets input that is not JSON: the run must exit as the hook says and its log
  line (`CC_SMART_DEV_KIT_HOOK_LOG`) must name the hook itself, so an entry that runs another
  hook's spec in place of its own, or a cycle that only shows in a built bundle, fails a test.
  `update-check` and `playwright-output` log no name (they never enter the frame), so each gets
  its own proof that the built file is wired: the session-start record it writes, and the
  screenshot path it rewrites.

- **A zod trap** for the hooks whose warm run loads no zod (below): the bundle runs under a
  preload that marks any evaluation of zod, cold and warm.

### The checked project file

Reading `cc-smart-dev-kit.json` used to cost most of a hook run: the parse needs zod and the
config schemas (about 235 KB of a bundle and about 17 ms of a run). The frame now reads the
file's bytes once and looks them up in a cache of checked answers
(`src/hooks/checked-config.ts`); the parser sits in a **sibling bundle**, `dist/config-check.js`
(`src/entries/config-check.ts`), that a hook loads only on a miss. The sibling is loaded the way
`cc-smart-dev-kit task mcp` loads `tasks-mcp.js`: a computed `import()` the bundler cannot inline.

- **The key** is sha256 over the parser's build fingerprint, the kind of file and the bytes.
  The fingerprint is a Bun macro (`src/build-info/parser-fingerprint.ts`) that hashes the source
  of every module the sibling reaches, with the plugin version and the installed zod version. It
  is not the version alone: a schema changed and rebuilt at the same version would serve an old
  success, and the hook would fail open. The frame and the sibling both bake it in, and the
  sibling returns its own with each answer, so a mixed install misses and says "reinstall the
  plugin". The router bundle never imports it.
- **The cache** is `<stateDir>/checked/<key>.json`, the folder `0700` and each entry `0600`,
  written through `atomicWrite`. Only a success is written; a broken file is checked again every
  run. At most 64 entries stay (the oldest by modified time go on the next miss), a temp file
  from a killed writer goes once it is a minute old, and a file over 256 KB is parsed every time.
  The cache holds only project files and the person's workflow file, which have no secret field;
  `gateway.json` is never cached.
- **The person's workflow file** goes through the same cache as a second kind (`workflow`, the
  sibling's `checkWorkflowText`), for `job-route`'s machine-wide default. A hook never fails on
  it: a missing, broken or unreadable file, a checker that fails, and one from another build all
  give `{}`, the answers of `personalWorkflowOrDefault`, and a broken file is never cached
  (`loadPersonalWorkflow`).
- **Failing closed keeps its meaning.** A config problem arrives as data and goes to the hook's
  `onConfigProblem`, with the same words as before. A sibling that cannot be loaded is the same
  problem with one fix: reinstall the plugin. A bug in the parser, and a project file that
  cannot be read at all (a folder, no permission), are thrown and stay crashes. A cache that
  cannot be read or written is a miss, and `cc-smart-dev-kit doctor` warns (`!`) when the
  `checked/` folder cannot be written, because every run then loads the sibling (about 20 to
  46 ms).
- **The hook log** (`CC_SMART_DEV_KIT_HOOK_LOG`) gains `config`: `none` (no file), `cached`,
  `checked` (the sibling parsed it) or `broken`.
- **One read per run.** `task-start` hands its frame's project to `taskContext`, and
  `worktree-leftovers` reads the main checkout's file (not the worktree's) through the same
  cache for `worktrees.rebuildable`. A module on a zod-free path imports `project/locate.ts` and
  `project/config-facts.ts`, never `project/resolve.ts`: those two hold no zod, and
  `resolve.ts` and `config.ts` re-export them, so their other importers did not change.

**Which hooks are zod-free.** Two kinds, both proved by `entries.test.ts` › "no zod on a warm run"
(each hook runs cold, the control, and warm, with its normal answer both times):

- **No zod module in the bundle.** `agent-usage`, `session-name`, `verify-gate` and `job-route`:
  272 KB to 36 KB, 266 KB to 30 KB, 283 KB to 87 KB and 355 KB to 160 KB. Their budgets are the
  measured size plus a tenth. `job-route` got there by cutting its own chain: `jobs/kind-defaults.ts`
  holds the default kinds and the readers that judge a run (`jobs/kinds.ts` keeps only the
  schemas), `workflow/merge.ts` holds the merge of the person's file and the project's, and the
  person's workflow file comes through the checked cache like the project's. `resolve.ts` and
  `kinds.ts` re-export what they gave up, so their other importers did not change.
- **Zod behind a dynamic import.** `after-merge` still holds zod in the bundle (a lazy
  `import()` is inlined by the bundler: 326 KB to 341 KB, so its budget is not lowered), but a run
  that saw no merge evaluates none: the workflow resolver and the clean's start load only in the
  branch that saw one. **Never put such an import in a module a bundle with the MCP SDK reaches**
  (`tasks-mcp.js`): the bundler then wraps zod in lazy initialisers, and the SDK's own top-level
  `zod` calls run before them (`TypeError: undefined is not a constructor (new ZodLazy)`; seen on
  `worktree-leftovers.ts`, which `worktrees/scan.ts` imports for `idleMinutesOrNull`).
  `src/entries/bundles-load.test.ts` starts every built bundle once and fails on it.

The other hooks skip the parse on a hit and still load zod through their own imports; each
chain below would have to go for one of them to join. Median of 40 runs on a machine at a load
of about 12 on 12 cores (an empty bun script took 4 ms), the two builds taking turns, so read
them as rough: `job-route` 38 ms to 21 ms, `after-merge` 32 ms to 23 ms. Earlier, at a load of
about 20, `session-name` and `verify-gate` went from about 50 to 60 ms to 17 to 31 ms. The chains
left, by what keeps zod in the bundle:

| Chain | Hooks |
|---|---|
| `workflow/resolve` (the personal file and `project/resolve`'s inline parser) | `fable-session`, `review-record`, `builder-finish` |
| `tasks/context` and `tasks/deploy/format` | `builder-finish`, `keep-going`, `task-start`, `user-away` |
| `hooks/session-facts` and the gateway readers | `fable-session`, `keep-going`, `subagent-background`, `tier-view` |
| `jobs/kinds` (the schemas) | `update-check` through `jobs/classify` |
| `user-away/state.ts`, `gateway/limit-state.ts` | `user-away`, `tier-view` |
| `worktrees/auto-state.ts` (the state files of the clean) | `worktree-leftovers` (through `takeToldLine`, `startAutoClean` and `readRepoRecord`), and `after-merge` behind its import |

`update-check` does not use the frame: its zod comes from `update/background`, which reaches
`jobs/classify`, and from `portal/session-start`, which reaches the gateway.

### Worktrees: Claude Code's own

Every project uses Claude Code's own worktrees (owner). A new task starts from
the main checkout with `claude -w <task-name>`, and Claude Code makes
`<repo>/.claude/worktrees/<task-name>` on the branch `worktree-<task-name>` (a `/` in the
name becomes `+`). It keeps its own lock on the worktree, its cleanup marker, the reset of a
reused clean worktree, `-w "#123"` and its Git LFS handling — none of which a hook could
rebuild. Entering an existing worktree is `claude -w <name>`, or `EnterWorktree` with its
`name` (which resumes it as it was left); `EnterWorktree` with a `path` only switches between
worktrees for a session already inside one, and fails from the main checkout. An unrelated
task from inside a worktree goes back to the main checkout first. A subagent with its own
worktree never calls either tool: Claude Code refuses both, and it uses `cd` to move inside
its own checkout.

- **The base comes from `origin`'s default branch** under `worktree.baseRef: "fresh"` (the
  default; it fetches that branch only when the repo was not fetched for 24 hours). A project
  whose base branch is another one sets `"worktree": {"baseRef": "head"}` in its committed
  `.claude/settings.json`: a worktree, and a subagent's worktree, start from the current
  branch. `project init` writes that line, and `doctor` warns with the line to add when a
  non-default base has no `baseRef: "head"`. `baseRef` takes `"fresh"` or `"head"`, never a
  branch name (`docs/claude-code-contract.md` § Worktrees).
- **`.worktreeinclude`** names the git-ignored files a worktree needs; Claude Code copies
  them in. There is no setup step: the session runs the project's install first.
- **`.claude/worktrees/` is git-ignored by the project**; `doctor` warns when it is not.
- **Cleanup:** Claude Code removes a clean worktree of an unnamed session on exit and asks
  first for a named one or one with work left; a subagent's worktree is removed when it made
  no changes. `cc-smart-dev-kit worktrees` finds the repo's
  finished ones, and `cc-smart-dev-kit sessions` lists a project's sessions in its nested
  worktrees (the project folder is the path with every `/` and `.` turned into `-`).

`project init` writes no worktree hook, and takes out what the retired engine left: its fields,
and its hook lines in both project settings files. `doctor` fails (`✗`) on either: the parse
line names a retired field, and one line per settings file names a leftover hook line, both
with `cc-smart-dev-kit project init` as the fix.

### Finished worktrees clean themselves (D48)

Worktrees pile up: one project had 73. Claude Code removes a subagent's worktree by itself
only when it holds no change at all, and `cc-smart-dev-kit worktrees --clean` removes only
what it can prove finished — but only when someone runs it. Since 1.0.0 that safe clean also
runs by itself (owner's decision D48, 2026-10-22).

- **One home for the clean.** `cleanFinished` (`src/worktrees/clean.ts`) removes what the scan
  judged finished, with its branch, forgets a worktree whose folder is gone, and reports what
  it removed and kept. `worktrees --clean` and the background clean both call it, so the two
  cannot judge differently. Nothing forces: the verdict (`verdict.ts`), the replay of a branch
  onto the base (`workOnRef`), and the fresh verdict `removeWorktree` takes right before it
  moves a folder decide, so a session, a program, a Docker container, uncommitted changes, a
  local file, a commit not on the base or a replay that cannot answer all keep the worktree.
  An uncommitted file whose exact bytes and mode the base's history holds at the same path, in a
  commit the worktree's HEAD does not have, and a deletion the base made too, are not changes
  that can be lost (`hasUnsavedChanges`, `src/hooks/unsaved-changes.ts`): an old builder that
  never committed in its own folder while its lead committed the same files leaves only those.
  A path with a filter driver or `ident` is hashed without them. `removeWorktree` takes that
  proof again on the moved folder (`savedFingerprint`), reads the folder once more after the
  history search (`folderFingerprint`: the status and each changed file's hash), and passes
  `--force` to `git worktree remove` only when both match, since `--force` turns git's own check
  off; a folder a removal moved aside counts its missing files
  as that removal's own (`ownDeletions`). The session-start note keeps its quick
  `git status` check, which counts any uncommitted file; it removes nothing, so being stricter
  there is safe.
- **A folder a removal moved aside** (`<path>-removing-<time>`) is finished
  (`src/worktrees/scan-parked.ts`, D62): while git lists it, it is an ordinary worktree that
  asks for neither the commits on the base nor the idle hour (its branch holds them;
  `WorktreeFacts.parked`) and the clean removes it; when git no longer lists it (the removal's
  `git worktree remove` failed after deleting its registration), `finishStrays` removes what
  is left only when nothing runs from it, it is no repository, it crosses no mount and no file
  in it is newer than the move its name records. The background clean and `worktrees --clean`
  both use it.
- **The background clean** (`src/worktrees/auto-clean.ts`, run by the bundle
  `src/entries/worktrees-clean.ts`) takes the machine-wide lock (`LOCK_PORTS.worktreesClean`)
  and does nothing when it is busy, re-reads `worktrees.autoClean`, fetches `origin/<base>`,
  scans, cleans, and records the result for the hooks in the state folder
  (`src/worktrees/auto-state.ts`: one `worktrees-auto-clean/<key>.json` per repo, one
  `<key>.told.json` for what a session start already showed, and one line per run in
  `worktrees-auto-clean.log`, kept small by the update log's rule). Its own errors are that
  log line too: the process never throws at a person.
- **When it runs.** `after-merge` starts it once per pull request merged into the base, and
  `worktree-leftovers` at an attended session start — at most once an hour per repo (decided
  in the hook for speed, and again under the lock, so sessions that start together clean
  once), never in `claude -p`. Both make ONE call (`startAutoClean`, `src/worktrees/auto-start.ts`):
  it starts the bundle detached (`startDetached`, as the self-update starts its check) with the
  main checkout, the trigger and the session's own folder, so the worktree that session works
  in stays even when Claude Code has not written its record yet. A hook never waits for it.
- **What the person is told.** The next attended session start of that repo shows one
  `systemMessage`, once: `cc-smart-dev-kit removed 2 finished worktrees: app-wt-a, app-wt-b
  (work on main)`, then marks it told (`markTold`, keyed on the removal's number, so a clean
  that finished in between is not marked). The leftovers note still names the worktrees the clean
  did not remove, with the reason — including the reason the last clean itself gave.
- **The off switch** is `worktrees.autoClean` (1.0.0, optional, on when left out): `false`
  starts neither, and the background clean says so in its log.
- **It backs off while git is writing in the repo** (WA1): a project may run its own
  after-merge step in the main checkout (a fetch, a fast-forward, an install) at the moment
  the clean runs git there. When git's own lock files are held (`index.lock`, `HEAD.lock`,
  `packed-refs.lock`, or a ref lock under `refs/`), the run skips this round with one line in
  its log and writes no hourly mark, so the next trigger runs; there is no sleep and no retry
  until success (`gitLockHeld`, `src/worktrees/auto-clean.ts`).

### The worktree engine (retired in 1.0.0)

The engine retired in 1.0.0 (D20; owner, 2026-10-21) and its code is gone: the fields it
read are refused, its three hook names print the fix and exit 1 (a non-blocking error: exit 2
would block every subagent's stop), and `project init` takes both out (§ Per-project opt-in).

What it was, and why it went: a WorktreeCreate hook **replaced** Claude Code's own creation,
for sessions and subagents, in every project where it was wired, and a hook that prints no
folder makes the creation fail (proved live). A hook-made worktree loses the lock Claude
Code puts on a worktree while a session uses it, the marker its periodic sweep looks for, the
reset of a reused clean worktree, `--worktree "#123"` (a pull request) and the neutralised
filter drivers (Git LFS). Claude Code makes the same worktree shape on its own, with all of
that, so the plugin ships no worktree hook at all.

### The plugin's hooks

| Hook | Event (matcher) | On when | What it does |
|---|---|---|---|
| `playwright-output` | PreToolUse (`mcp__playwright__.*`) | always (a `USER_HOOKS` bundle: it reads no cc-smart-dev-kit.json) | Rewrites a relative `filename` to an absolute path in the browser's output folder, with `updatedInput` and no permission decision; a relative name with a `..` segment is DENIED (the launcher's `--allow-unrestricted-file-access` means the server takes that path as it is). Answers only while the live `playwright` registration is the one setup recorded — a server of the person's own is left alone entirely. |
| `fable-session` | SessionStart, PostModelSwitch, Stop | **machine-wide** | One `systemMessage` to the person, once a session, when the session's own model is the **`fable` tier**; nothing to Claude, never an error and never a block — the line itself was seen live (2026-10-17), but not on `PostModelSwitch` or `Stop` yet. The model: at a start, the `model` the input names (no fallback); at a switch, `to_model` — the model the session moved TO; at a stop, the one that answered in the transcript, then `ANTHROPIC_MODEL` — the hook's own reading of the tier. Not `UserPromptSubmit`: it judged the PREVIOUS answer's model, so it missed the switch and warned after a switch back (the live bug of 2026-10-17). § The Fable-session note. |
| `tier-view` | SessionStart (every source), UserPromptSubmit | **machine-wide** | One note to Claude (`additionalContext`) of what each subagent tier (`haiku`, `sonnet`, `opus`, `fable`) runs now and the effort rule that follows, read through the session's own gateway view. While auto mode's safety checks fail for the session's scope, one more line says so, with what the person can do. Said at every start, and at a prompt only when it differs from the note said last in this session. § The tier note. |
| `job-route` | PreToolUse (Bash, PowerShell) | **machine-wide**, and `ownHooks` cannot switch it off | The heavy-job queue's door, and the kit's one guard. It never asks the person and judges nothing else: a launch, a push, a merge and a deploy are Claude's own to run. It reads each line in the dialect of the tool that runs it, so the PowerShell tool is judged the same. **The route** is the `switches.jobRoute` switch — the project's `jobs.route` over the person's machine-wide default, off until one says on — Bash lines only, and not outside git: a line whose every command is heavy, a `cd`, an assignment or glue (`GLUE_COMMANDS`, the readers of a pipe, the structure of a group), or one heavy command piped into read-only filters (`tail`, `grep`, `wc`, …; the filters stay outside the wrapper as written), is rewritten to `cc-smart-dev-kit job run --kind <kind> -- <command>` through `updatedInput` (proved live on 2.1.301); a line that mixes heavy work that takes a slot with a command that is not heavy or glue is **refused**, and the reason says to run the heavy command on its own line (`mixedLineDenial`; HK hunch 1). A light line (named files, print-only) stays raw too, and so does a watch run (`runWeight`). A call that set no `timeout` gets the Bash tool's longest. **A `git commit`, `git merge` or `git push` whose own hook is heavy** gets the kit's git-hooks folder as a prefix of three `GIT_CONFIG_*` assignments (`routeGitHooks`), never a wrapper (`docs/jobs.md` § Git hooks). With the route on, a heavy PowerShell line is refused with the Bash line to run instead, where the Bash tool can exist. § The job route. |
| `after-merge` | PostToolUse, PostToolUseFailure (Bash, PowerShell) | `worktrees` | After a pull-request merge (`gh pr merge`, `gh pr -R owner/repo merge 5`, a readable `gh api` merge path, a `gh` alias for one): the steps that clear the merged worktree (with `clearWorktreeAfterMerge` off or unreadable, that it looks finished and the person decides; a lead that still holds another open plan — a plan it leads or queued, read from the task store through `classifyLeadPlans` — gets one line instead, `Kept: plan <slug> is still open here.`, because it keeps the worktree on purpose; the store is read in the merge branch only, so a run that saw no merge loads none of it, and a store it cannot read leaves the clear note with one stderr line), and, when it went into `worktrees.base`, it starts the background clean of finished worktrees once (§ Finished worktrees clean themselves). It never tells the other sessions about the merge: that message is gone (the owner, 2026-11-11). A form that names no pull request gets no note. |
| `review-record` | SubagentStart, SubagentStop | `cc-smart-dev-kit.json` exists | When a review agent (`workflow.reviewAgents`) starts, notes the commit the working folder is on and its branch; when it stops, records that start commit on that branch — the record a session reads (`workflow show`, `review-done`) before it merges. Commits made during the review count as change after it. A stop records only for a run that was a review from start to end: the brief (the transcript's first user entry; for a workflow agent, read through the workflow harness's wrapper: the exact preamble, then the task with its two-space indent removed, only when every line carries it) and every prompt given after it each hold `Mode: review` alone on a line (trailing spaces and tabs allowed). Tool results and Claude Code's own skill-load and system-reminder entries (a reminder must end at its closing tag) are no prompt, and neither is the text of a skill the agent itself loaded (its `sourceToolUseID` names the agent's own earlier `Skill` call); any other later entry is — a resume, a message from the session that started the agent (a `user` entry, or a `queued_command` attachment with a `prompt` and an `origin`), a task notification, Stop hook feedback. One kind of notice is no prompt: the end of a task the agent **itself** started — a background command (the five tags alone, `Background command "…"` in the summary) or a Monitor (`Monitor "…" stream ended`, at most one event, Claude Code's PushNotification line) — when the origin is Claude Code's own (`task-notification`, producer `session-task`) and the notice's `<tool-use-id>` names a call the agent made earlier in its transcript (`isOwnTaskNotice`), so a reviewer that runs its tests in the background, or whose own Monitor's stream ended, still records (a Monitor that expired, failed or ended with no output stays a prompt). A transcript line that starts with NUL bytes is read without them. The whole transcript is read, up to 16 MB. A consult, a resumed consult, a review a Stop hook sent back, a review that compacted (the summary is a prompt), and a missing, unreadable or larger transcript record nothing. Nothing for an agent that stopped inside its own worktree. § The review record. |
| `subagent-background` | SubagentStop | `cc-smart-dev-kit.json` exists | A subagent that ends its turn with background work **it started** still running (a Bash command, or a subagent it launched) is blocked **once per task**, with one plain reason: wait for the work or stop it, then report. A re-woken agent (its task reported) starts a new stop with `stop_hook_active` false, so the hook also keeps a record per agent and task in the state folder (`subagent-background/blocked.json`, under the state lock, entries forgotten after a day): a task already blocked lets the next stop through with one stderr line saying the work still runs, and a new task is blocked once more; a record that cannot be kept lets the stop through. The input's `background_tasks` is the session's list, so the hook reads the agent's own transcript (`agent_transcript_path`) as JSONL, line by line, and keeps only an id named in a **tool result of the agent's own call** — a Bash background launch (`Command running in background with ID: …`) or an Agent launch (`agentId: …`) — never one in its brief or in a file it read; the ending agent's own entry is dropped (a background subagent appears in its own list). No `additionalContext`, never a second block (`stop_hook_active`), and nothing when the transcript cannot be read. § One frame for every hook. |
| `verify-gate` | Stop | `checks.fast` | One **block** when this session changed files after the last Bash or PowerShell call that ran the project's fast check, naming the command — once per change: the block's own feedback line in the transcript is the mark, so a change made after it earns the next reminder, and a check that fails never traps the turn. It reads the session's own transcript (JSONL) in order: an Edit, Write or NotebookEdit counts only for a file inside the session's current checkout, after resolving symlinks (new code files count too). Relative paths use the edit record's own `cwd`, not the Stop folder. Missing or unusable paths, and relative paths without a known edit folder, count as changes: only a known path can prove an exclusion. Markdown (`.md`, `.mdx`), the repo's `.claude/plans/`, and Claude Code's `plansDirectory` (default `<Claude config>/plans`, with user, project and project-local settings read in that order) do not count. An edit whose result was an error or a refusal changed nothing. A shell line that runs the check is the check (through the one shell reader, in that tool's dialect), and a subagent's own calls are in its own transcript. Silent on the stop its own block caused (`stop_hook_active`), on a turn that still waits on background work, with no `checks.fast`, and when the transcript cannot be read — a reminder never stops a person's work. |
| `builder-finish` | SubagentStop | **machine-wide** | A builder (an `agent_type` ending in `builder` or `rules-maintainer`, the two agents the build skill gives a phase) whose brief holds the line `Your task: #<n>` is blocked **once** while task #n still has open blocking steps, each named with the `task_done` call that closes or drops it. Silent for any other agent, without the line, and when the task or the task list is not there. § A builder's hand-back. |
| `keep-going` | Stop | **machine-wide**: it needs no cc-smart-dev-kit.json; `ownHooks` silences it | The main session's turn end is blocked **once per stalled state** when a phase of a plan this Claude process works on is `in_progress`, or the plan in flight has ready phases and none runs, no background work runs and the last answer has no `Waiting for:` line. The same reason already given, with no subagent started or resumed since, keeps it silent. The reason names the builder to resume with `SendMessage` (or the phase needing a fresh builder), every ready phase to start together, and how to close or record a blocker, and warns against moving a phase back to pending to end the turn. A lead whose plans run in Herdr children also gets the wait to name (`herdr wait`, `herdr plans --wait`) or the child to resume. An unreadable transcript keeps the decision; an unreadable task store blocks nothing. § The keep-going guard. |
| `agent-usage` | SubagentStop | **machine-wide** | One line per subagent in `<stateDir>/agent-usage.jsonl`: the time, the session, the agent's id and type, and per model the replies, the four token sums and an estimated USD cost — from the agent's own transcript, never a word of its content. A second stop of one agent supersedes its first line when read; the record is kept small like the ask log. One stderr line when the transcript cannot be read or the record cannot be written. § Each subagent's usage on record. |
| `worktree-leftovers` | SessionStart (startup, resume) | `worktrees` | Names at most eight finished worktrees and eight missing folders, keeping each total; `+N more: git worktree list --porcelain` lists the rest. Finished worktrees have every commit on `origin/<base>`, nothing uncommitted, no session in them, an idle hour, and no ignored file that cannot come back; locked ones are kept by `worktrees --clean`. The hook says once what the background clean removed, and starts that clean (at most once an hour per repo, never in `claude -p`). At an attended start it also adds up to three short lines about the main checkout — on another branch than `base`, behind `origin/<base>` as git already knows it, or in the middle of a merge, a rebase or a cherry-pick — read-only and with no fetch. With `worktrees.guardMainFolder` on, each such line names the command for the person to run in the main checkout, never a step for the session; a fast-forward is always `git merge --ff-only`. **With the setting on, a session that starts in the main checkout (not in a worktree) also gets one more line, the last of the main-checkout lines: it is in the main checkout, and its first change goes into a worktree** (`EnterWorktree`, or `claude -w <name>` from a terminal; `mainCheckoutNudge`). It is silent in `claude -p`, in a worktree and with the setting off, and makes no git call. It removes nothing itself (§ Finished worktrees clean themselves). |
| `session-name` | SessionStart (startup, resume, compact, clear), UserPromptSubmit | `sessionNames` | Tells the session to name itself after its task (`cc-smart-dev-kit session-name`) at start and once per context at an unnamed prompt. A `.reminded` mark beside the temp name files suppresses repeat prompts; every SessionStart resets it, including compact and clear. Then sets that as its title at the next prompt (`sessionTitle`); a name the person gives with `/rename` stays until the session names itself again. |
| `user-away` | PreToolUse (AskUserQuestion, ExitPlanMode), UserPromptSubmit, Stop | **machine-wide**, and `ownHooks` cannot switch it off; silent unless the person is marked unavailable | While the person cannot answer: refuses the two tools that ask them, with the step to take (the recommended option, recorded as a decision with `user park --kind decision`); one note per change at the prompt, and one **block** at the stop of a session that has not heard this away period. It parks nothing and never answers Claude Code's own permission dialog: that dialog is Claude Code's. § While the person is away. |
| `task-start` | SessionStart (every source) | **machine-wide** | One block of the project's open work tasks at a start, a resume, a clear and a compaction: at most eight lines, then `+n more`, with no descriptions; a task untouched for `tasks.staleDays` (default 30) is counted in one line instead; one line about the deploy tasks (open, unreadable, a repeated id or old files; `Deploy tasks open: …`); and one line to run setup while the task server is not registered. `tasks.md` § The hooks and pages that read it. |

Without `cc-smart-dev-kit.json` every one of them is silent — except the machine-wide
ones: `job-route` (§ The job route), `fable-session` (§ The Fable-session
note), `tier-view` (§ The tier note), `task-start`, `keep-going` (§ The keep-going stop),
`builder-finish` (§ A builder's hand-back), `user-away` (§ While the person is away),
`agent-usage` (§ Each subagent's usage on record), and `playwright-output`, which reads no
project file at all. So a project that never opted in sees only Claude Code's own worktrees
and the one limit a session may not get around. `job-route` is `alwaysOn`: `ownHooks` cannot
switch it off, because it limits what the session itself may launch. `user-away` is the second
`alwaysOn` hook, for another reason: the switch is the person's (§ While the person is away).
The former notification hooks are retired (§ The notifier), and so are six guard hooks, `user-away`'s blocking and `job-route`'s launch judge
(§ Retired in 6.0.0).

**`job-route` is the kit's only guard.** Every other hook here informs Claude, records, or stops
a turn that would end with work undone (`keep-going`, `verify-gate`, `builder-finish`,
`subagent-background`): none asks the person and none approves a permission dialog.

### Each subagent's usage on record

`agent-usage` (SubagentStop) is **machine-wide**: what a subagent's replies cost is the person's own spend, not a project's
policy. At every subagent's stop it reads the agent's own transcript
(`agent_transcript_path`) and appends one line to `<stateDir>/agent-usage.jsonl`
(`src/hooks/agent-usage.ts`). The line holds the time, the session, the agent's id and type,
and per model the replies, the four token sums (`input_tokens`, `output_tokens`,
`cache_read_input_tokens`, `cache_creation_input_tokens`) and an estimated USD cost from the
one price home (`src/gateway/prices.ts`, Claude's list price; a model with no row — an
affordable backend's — is recorded with its tokens and no price, and `unpriced` counts those
replies). **Never content**: a transcript's text, tool input and tool result are skipped. A
reply is counted once by `message.id`, though Claude Code writes one `assistant` line per
content block, each carrying the reply's whole usage. A second stop for one agent (a block
made it continue) appends a newer line with the whole transcript, and `readAgentUsage` keeps
the newest per session and agent, so a cost is never a sum of two halves. The record is kept
small like the ask log (`src/hooks/jsonl-log.ts`: `LOG_MAX_BYTES`, the newer half kept). An
unreadable transcript, and a record that cannot be written, are one stderr line and exit 0. A
project that runs its own copy lists the name in `ownHooks`. `cc-smart-dev-kit usage` shows
each session's agents by type and model, their tokens and their cost (`README.md` § The usage
limit), and `usage --json` is the same facts as one object a portal can read.

The **subagent status line** (MD-13) is the same fact on screen: `plugin/settings.json` sets
Claude Code's `subagentStatusLine` to `cc-smart-dev-kit subagent-statusline`
(`src/cli/subagent-statusline.ts`), and the agent panel's row body for each subagent becomes
`<label> · <slot> → <model> → <effort> · <context>`, the slot taken from the model's Claude
family with the router's own mapping (`familySlotFor`). While the gateway is on, the model
comes from the last whole 2xx answer in the router history for that session, profile and
agent id, including a backend or fallback. Before the first answer, or with missing, old
or locked history, it keeps Claude Code's resolved model. The task id equals the request's
`x-claude-code-agent-id` (proved offline on 2.1.322; the contract records the trace).
The context is the subagent's use,
`~45k/200k ctx (23%)`, from the task's `tokenCount` (the last request's input plus the output
so far: the current context, a little too high) and `contextWindowSize`; it is left out when
either is missing or the count is zero. On a narrow row the label shrinks first so the route and
the context stay whole, and when even those do not fit the context moves in front of the route.
It is a plugin setting, not a hook: Claude Code
runs the command on each refresh tick with `columns` and one entry per visible subagent on
stdin, and the command answers one `{"id","content"}` line per row (proved offline on
2.1.308, `docs/claude-code-contract.md`). The command names the launcher, never
`${CLAUDE_PLUGIN_ROOT}`: a plugin's settings file does not expand that variable (proved: the
literal string ran, exit 127), and the launcher is the one path an update cannot break.

### The keep-going stop

`keep-going` (Stop, `src/hooks/keep-going.ts`) keeps the main session from stalling in
subagent-driven work. The main session dispatches each phase's builder and hears it hand back.
A turn that ends while a phase is `in_progress`, with no builder running and no word on what it
waits for, leaves the plan stalled until the person notices. Subagents fire SubagentStop, not
Stop, so the hook is about the main session only.

It blocks the stop **once per stalled state** when all of these hold, cheapest first:

1. The stop is not the one its own block caused (`stop_hook_active` is not `true`).
2. No background work runs: `background_tasks` is absent or empty. A subagent or a background
   command wakes the session when it lands (`docs/claude-code-contract.md` § Hooks).
3. No line of the turn's last answer starts with `Waiting for:` (any case, after a Markdown
   mark such as `**`, `>`, `-`, a heading's `#` or a list number `1.`). The answer is the input's own `last_assistant_message`, else
   the transcript's last answer (`lastAssistantText`). With neither, the hook cannot tell, and
   lets the turn end.
4. Work of a plan this Claude process works on waits: a phase is `in_progress`, or the plan
   in flight has a phase that could start and none runs (see "Ready phases" below). The store
   is read first, and the caller is looked up only when a phase of the project is in progress
   or a plan in flight (`isInFlight`) has a phase that could start: off Linux that lists the
   running processes. A plan is the process's own when its plan task is (`ownsPlan` and
   `ownerOf`, `src/tasks/work/queries.ts`: made under its session id, claimed by its process,
   or made by its process; `openPhasesOf` is in `src/tasks/work/phases.ts`); a plan task in
   flight is claimed by its process. A phase in progress counts for it in a plan of its own, and
   also where it claims the phase or one of its steps (work it took in another session's plan);
   ready phases are only those of its own plans, so a step claimed in another session's plan
   never makes that plan's next phase this guard's to start. The claim is the Claude process
   from `callerOf` (`claimIsMine`: `claimHeldBy`, or a resumed claim): on Linux its pid and
   start time, so a `/clear` keeps the plan; off Linux, with no start time, the session id too,
   so a reused pid never inherits a dead process's plan. A claim its session left in a process
   that is gone (a reopened session, `resumedClaim`) counts too, until the next task call moves
   it. No write ever stamps another session's plan on a task. A parked plan (its plan task
   `pending`) is not in flight, so it never blocks.
5. This reason was not already given (`stopFeedbackGiven`, `src/hooks/transcript.ts`). Only
   after the store finds a phase in progress does it read the transcript's tail (`tailLines`,
   default `TRANSCRIPT_TAIL_BYTES`). The reason counts as given when a `user` entry of the
   session itself holds Stop feedback with the exact reason, as string content or text blocks
   (several hooks may share one entry), and the session started or resumed no subagent after it
   (`Agent`, `Task`, `Workflow`, `SendMessage`). So turns that answer the person without
   starting a subagent are not blocked again, while a new stall after a fix round gets one new
   reminder. Any such call resets it, a scout's or a message to another session too: that costs
   at most one extra reminder, never a loop. A sidechain entry, and an
   answer that only quotes the words, are no feedback. A different phase, next ready phase or
   builder changes the reason and earns a new block. A missing or unreadable transcript keeps
   the decision above. Feedback older than the tail is not seen.

**Known limits, all fail open.** Any `background_tasks` entry keeps it silent, a long-running
shell (a dev server, a watch) too: which entry is an agent is not proved yet. And after another
Stop hook's block (`verify-gate`), the turn's next stop has `stop_hook_active` set, so this
hook does not judge that stop.

The reason keeps the total and names at most eight phases in progress as `#n subject`,
with `+N more: task_list` for the rest. Recovery actions name only those eight; closing or
recording blockers still applies to every phase, including those not shown. It then
says to resume its recorded builder with `SendMessage`, naming the agent (or start a fresh
one), or to start a fresh builder when none is recorded; a blank agent counts as none. For several phases it pairs each agent with its phase and
names the phases that need fresh builders. Next come the ready phases (below), every one,
to start together now (dispatch their builders). Then it offers to close the phases with
`task_done`, or record the blocker with `task_note` and end the turn with a `Waiting for: <what>`
line. It ends: "Never move a phase back to pending only to end the turn."

**Ready phases.** A phase is ready when it is `pending`, no open task blocks it, and it holds at
least one task that is not dropped (the store refuses to start an empty one): `isStartable`
in `src/tasks/work/queries.ts`, the test the store's start and the close answer share
(`docs/design/tasks.md` § Freed work). The ready phases are those of a plan with a phase in
progress and those of the plan in flight (`inFlightPlanOf`, the helper the store judges by).
Every one is named, as `#n subject` and capped like the phases in progress. So after the last
running phase closes, ready phases no longer sit idle: with no phase in progress, the guard
still blocks once per stalled state, with a reason of its own: "N phases are ready to start,
and no subagent runs: #a x, #b y. Start them together now (dispatch one builder for each), or
record why they wait with `task_note` and end the turn with a `Waiting for: <what>` line. To
hold the plan longer, park it (`task_update` its plan task to `pending`)."
(one phase: "Phase #a x is ready to start, and no subagent runs. Start it now (dispatch its
builder), or record why it waits …"). The `Waiting for:` line, background work and the
once-per-state memory apply as for a phase in progress. No plan in flight, a parked plan, and
another session's plan block nothing.

**The lead's plans** (5.2.0, `leadPlansReason`). When the plan in flight gives no reason, a lead that
has handed plans to Herdr children gets one more, built from the store's classifier alone
(`classifyLeadPlans`, `docs/design/tasks.md` § Plans handed to children): no git, no gh, no hc. So a
lead's own plan comes first, then, in this order and in one paragraph so the stalled state is judged
once:

1. plans `with-child`: wait for them with `cc-smart-dev-kit herdr wait`, in the background;
2. plans `merging` (finished, their pull request not yet merged or closed, and what waits behind
   them): wait with `cc-smart-dev-kit herdr plans --wait`, in the background;
3. plans `child-gone`: resume each with `cc-smart-dev-kit herdr start --plan <slug>` (one command
   per plan, the first eight).

The paragraph ends with the usual way out: record what the lead waits on with `task_note` and end
the turn with a `Waiting for:` line. A lead with only `waiting`, `no-files` or `ready` plans gets no
reason. The caller is looked up only when some plan of the project is reserved; the quiet rules
above (the stop hook already active, background work, a `Waiting for:` line, the same reason
given) apply as they do for a phase. For a child that runs, the default process check reads no
session record. The status line row built from the same classifier is in `docs/design/tasks.md`
(the `Plans · …` row).

**Fail open everywhere else.** The task store is the person's own, so the hook needs no
cc-smart-dev-kit.json and runs in a project with none; a project that runs its own copy lists
`keep-going` in `ownHooks`. It is silent outside git, with no task store, with no caller (no
live session record and so no Claude process to hold a claim), and on any read of the task
store it cannot make; an unreadable transcript only keeps the decision (item 5).
A store it cannot read and a broken or too new project file are one stderr line; a crash is the
frame's one line.

### A builder's hand-back

`builder-finish` (SubagentStop, `src/hooks/builder-finish.ts`) keeps a builder from handing
back unfinished work. The build skill launches each builder with the exact line
`Your task: #<n>` in its brief, where #n is the phase's task in the kit's task list
(`docs/design/tasks.md`), and the builder keeps its steps as tasks under it. At the builder's
stop the hook:

1. judges only an `agent_type` that ends in `builder` or `rules-maintainer`
   (`cc-smart-dev-kit:builder`, `cc-smart-dev-kit:rules-maintainer`: `BUILDER_TYPE_ENDS`);
2. reads the brief: the first `user` entry of the agent's own transcript
   (`agent_transcript_path`), from the file's first 1 MiB — never a later line, so a task
   number the agent wrote or read later does not count;
3. takes the first line that is exactly `Your task: #<n>`;
4. reads task #n under the main checkout's project key, the key the task server uses for
   every worktree of the repository, so a builder in its own worktree
   (`.claude/worktrees/<name>`) finds the tasks its caller made;
5. lists the steps that hold the task's done (`holdingUnder`, the same set `task_done`
   refuses on): open blocking tasks at any depth under it, reached through blocking tasks
   only. A non-blocking step holds nothing.

With any step open it answers `decision: "block"` once. The reason keeps the total, names
at most eight steps, and adds `+N more: task_list` for the rest. Each shown step is
`#id subject` and says how to close it: finish it and close it with `task_done` (with
evidence), or drop it with `task_done` outcome `"dropped"` and a note saying why, then hand
back. There is no `additionalContext`. The stop that block caused carries
`stop_hook_active: true`, and the hook is silent there: a step that truly cannot close never
traps the agent, and the caller sees it open in the task list.

It fails open: another agent type, no transcript, no `Your task:` line, no task list yet, or a
task that is not there is silence; a task list that cannot be read is one stderr line. It is
**machine-wide**, like `keep-going`: it reads only the person's own task list, never a project
setting, so it judges the same with no `cc-smart-dev-kit.json` and with a broken or too new
one. Outside git it is silent. A project that runs its own copy lists the name in `ownHooks`
(2.0.0 and later).

It never answers what `subagent-background` answers: that hook blocks for background work the
agent left running, this one for open steps. Both judge the same first stop, and both may
block it. The next stop carries `stop_hook_active`, so both pass it: a step still open after
the agent dealt with its background work is not named a second time.

### While the person is away

`cc-smart-dev-kit user unavailable` marks the person as unable to answer — asleep, in a meeting,
on a phone; the owner's pair of words, 2026-10-25 — and `user available` ends it. A session that
stops to ask only stops: nobody reads the question for hours, and waiting leaves ready phases
unstarted. So while the person is away a session **decides**: it takes the recommended option,
records the choice as a decision, and goes on (`/cc-smart-dev-kit:user-unavailable`).
Nothing is parked to wait for an answer, and no hook parks anything for it. `/cc-smart-dev-kit:user-available`
shows the decisions when the person is back. Since 6.0.0 (the owner, 2026-11-21: "full auto")
the hook only refuses the two question tools and says that the person is away; it never
answers a permission dialog, and no guard's ask is turned into a parked action (§ Retired in
6.0.0).

**The state, one home** (`src/user-away/state.ts`). One file, `<stateDir>/user-away/state.json`
(the kit's state folder: the machine's `~/.claude/cc-smart-dev-kit/` unless Claude Code runs on
another `CLAUDE_CONFIG_DIR`, whose sessions then need their own `user unavailable`), mode 0600,
written whole through the kit's atomic write, under the folder's **own** lock (not setup's: a
hook that records must never wait for a setup run) so two sessions that record at once both keep
their item; a reader takes no lock. It holds `unavailable`, `since`, `until`, the `items`,
`nextId` (an id is never reused), `said` (the note each session heard at a prompt, or by
`user unavailable` itself) and `stopSaid` (the note it heard by the Stop block). `until` is a note
only: it shows in the notes and never switches back. An item is a `decision` (what was chosen,
why, how to undo it; its text starts `Decision:`), the session that recorded it, its folder and
the time. The kinds `question` and `action` stay in the store so a list written by 5.6.x can be
read: nothing writes them now. The same kind with the same words **in the same folder** records
once, so a retry from one session is one item. The list holds 500 items and `said` 100
sessions. **A file that cannot be read is an `AwayStateError`, never "available"**: a reader
that cannot tell must not guess in the loose direction. The command (`src/user-away/command.ts`)
is `unavailable [--until]`, `available`, `status`, `park`, `list` and `clear`; `available` keeps
the list.

**Whose an item is** (`src/user-away/whose.ts`, 1.11.1). The list is the machine's, but the
person brings each session back on its own, so `user list --json` gives each item `whose`,
judged for the session that runs it (`CLAUDE_CODE_SESSION_ID`), and
`/cc-smart-dev-kit:user-available` shows its own items only:

- `this session`: it recorded the item; or no running session owns it and it was recorded in
  this session's project (a session that ended, or this one before a `/clear`; the project is the
  work store's key, `folderProject`, read from the nearest folder that is still there).
- `another session`: a running session owns it (Claude Code's session records, `liveSessions`),
  and `waitsIn` names it and its folder. The skill names it in one line and never shows, runs or
  clears it.
- `no session`: no running session owns it, and it was recorded in another project. The skill
  asks once whether to take those here.

A fact it cannot read never makes an item this session's: session records it cannot read keep
another session's item there, and a project it cannot tell (git did not answer, or had no time
left) is another project. `user available` and the hook's "available again" note count the same
way. The person's own terminal has no session, so only the running owners and its folder's
project decide there.

**Three answers, one hook (`src/hooks/user-away.ts`).** Each is a deny or a note, never an allow.

- **PreToolUse on `AskUserQuestion` and `ExitPlanMode`:** refused, with the step to take: "the
  person is away: take the recommended option yourself, keep working, and record it with
  `cc-smart-dev-kit user park --kind decision` ('Decision: …')". A plan waiting for approval is
  the same wait as a question.
- **Claude Code's own permission dialog (`PermissionRequest`):** since 6.0.0 no kit hook is wired
  to it, so Claude Code shows its dialog. A hook never approves for the person, and it no longer
  denies and parks either. `docs/claude-code-contract.md` § Retired in 6.0.0 keeps the retired row. In Claude
  Code's default permission mode a session's own `user park` call is such a dialog, so the
  `user-unavailable` skill tells the person once to allow `Bash(cc-smart-dev-kit user park:*)`.
- **`UserPromptSubmit`, the note:** one short line to Claude — "the person is unavailable since
  …: follow `/cc-smart-dev-kit:user-unavailable`", with the expected return and how many items
  there are — **said once per change** (`since|until|count`, per session, in `said`), never at
  every prompt. **The person's own prompt does not switch the state back** (it may be one line
  from a phone): a bare prompt gets its own note, every time, that it is still on, and
  `/cc-smart-dev-kit:user-available` shows the decisions. An automated turn (`prompt-source.ts`:
  a monitor's line, another session's message) is never the person's. A session that heard
  "unavailable" is told once when the person is available again.
- **`Stop`, the note at turn end** (2.2.0): a session that works on its own gets no prompt from
  the person, so it never heard the switch and could end its turn on a question in prose that
  nobody reads. Its stop is **blocked once** (`decision: "block"`), with the same note and a
  line to decide, record and go on, or end the turn if nothing is left. **The decision reads
  nothing written during a Stop** (`awayStopBlock`, `src/hooks/user-away-stop.ts`, one home),
  because Claude Code runs an event's hooks in parallel. **Never on a stop a Stop hook
  continued** (`stop_hook_active`): a belt against a loop. Otherwise it blocks when all three
  hold: the state is unavailable; the session's `said` mark does not cover **this away period**
  (`since|until`; only the prompt note and `user unavailable` write `said`); and the
  transcript's tail holds no `user-away` Stop feedback for this period. The block's reason ends
  with the period's tag (`[away period <since>|<until>]`), Claude Code writes the reason as
  `Stop hook feedback:` after every Stop hook has answered, and `stopFeedbackIn`
  (`src/hooks/transcript.ts`, the reader `keep-going` uses, on one read of the tail) finds it at
  the later stops (`docs/claude-code-contract.md` § Hooks: both claims are owed a live proof). A
  count change alone is no block: a session's own record (the skill's `Summary:` at the end of a
  stretch) changes the count, and that turn must be able to end; the next prompt says it. **The
  Stop answer's own mark is `stopSaid`**, written during the Stop and never read by the
  decision: only the prompt note reads it, and only until `said` covers the period. A `stopSaid`
  that cannot be written keeps the block, with one stderr line; the next prompt then says the
  note once more. **Available: never a block.** No `session_id`, no transcript or one it cannot
  read: no block — it could not see its own earlier block, and a block it cannot see would come
  back at every stop. While the person is away and `said` does not cover the period, each stop
  reads the transcript's last 512 KB. `claude -p` is treated like any session. A subagent never
  hears it here (`SubagentStop` is not wired): it never asks the person.

  **The session that switches the state is told already.** `user unavailable` marks the session
  that runs it (`CLAUDE_CODE_SESSION_ID`, which Claude Code sets in a Bash call's environment,
  `docs/claude-code-contract.md` § Hooks) as told for the new period, through the same
  `sayOnce` and key (`saidKey`), so the session that followed the skill is not blocked at its
  own turn end. The person's own terminal has no session id and marks nothing. A subagent's
  Bash call carries its lead session's id (seen on 2.1.318), so no brief asks a subagent to run
  `user unavailable`.

**Machine-wide and `alwaysOn`.** The person is one for the whole machine, so the hook reads the
state file and never the project's: a broken or too new `cc-smart-dev-kit.json`, and a folder
outside git, are judged the same way. `ownHooks` cannot switch it off — the switch is the
person's, and a project must not turn it off for a session — so it is not in `PLUGIN_HOOK_NAMES`
and `.claude/cc-smart-dev-kit.json` needs no new field. On the other events (a prompt, a stop) a
crash says one line on stderr and the session goes on.

**A state it cannot read changes nothing.** The hook says one line on stderr and the answer is
what it would have been without this feature: the question goes to the person as it always did.

**What it cannot reach.** **An MCP server's elicitation dialog** is a dialog Claude Code owns:
it has its own `Elicitation` hook event, and `user-away` wires none, so such a dialog waits for
the person like any permission dialog. A session that started before the update carries an older
plugin version (with the old parking guards) until it restarts, and `user unavailable` still
succeeds for it. **It stops mistakes, not a session set on getting past it:** `user available`
is the person's command, run through `/cc-smart-dev-kit:user-available`, and a session that runs
it itself lifts the state. No hook can tell the two apart, so the skill says never.

### The Fable-session note

`fable-session` (SessionStart, PostModelSwitch, Stop) is machine-wide. It says
two lines, each once a session: the Fable line below, and the lead hint (further down). The
model the main session runs on is the person's choice, and Claude never cares — no
`additionalContext`, no error, no block. The person may not have meant the `fable` tier, though
(it spends the plan's limits faster than Opus), so they get one `systemMessage` — a line Claude
Code shows the person, never Claude — once in a session (`fable-session.ts`). **The line was
seen live on a real session (2026-10-17)** — through `UserPromptSubmit`, the event this hook has
since left — and that it shows on `PostModelSwitch` and `Stop` is still not proved
(`docs/claude-code-contract.md` has the rows and the owed run).

Which model, per event:
- a **start**: only the `model` the input names — no fallback there (the schema Claude Code
  2.1.300 carries has `source` and an optional `model`);
- a **switch** (`PostModelSwitch`): the alias the person picked (`requested_model`, when it is a
  family name: `opus`, `fable`), else `to_model` — "the resolved model id the session runs after
  the switch", from Claude Code's own input schema (2.1.302, read from the shipped binary). The
  alias names the tier asked for, so `/model opus` whose override is a Fable id stays `opus`. So
  the line appears AT the switch;
- a **finished answer** (`Stop`): the model that answered, from the transcript's last assistant
  message, then `ANTHROPIC_MODEL` (`sessionModelOf`, one home with the guard's fork rule). This
  is the catch-all for a Claude Code that fires no `PostModelSwitch`, and it cannot fire for a
  model the session has already left.

**`UserPromptSubmit` was the bug** (seen live): the model read there is the transcript's
last answer — the PREVIOUS turn's — so the hook ran one turn behind. It missed the switch to
Fable, and then warned while the person was back on Opus. Stop judges the answer that just
ended, and a switch back is a different answer.

The tier is read the guard's way too (`resolveSessionModel`, `ANTHROPIC_DEFAULT_FABLE_MODEL` and
the fable slot's chain while the gateway is on included), so there is no second list of what
counts as Fable, and a tier a backend answers warns the same, naming the model (`the
\`fable\` model, openai:gpt-5.5`). A start and a switch name the model Claude Code ASKS for, and it
is resolved as a launch's; a stop reads the id that ANSWERED, which is never routed again and
takes the tier the person mapped it behind (`opus` first when both name it). So Claude Fable put
first in the `opus` slot (or in `ANTHROPIC_DEFAULT_OPUS_MODEL`) is the `opus` tier, and its
session gets neither line: the person chose it (the owner, 2026-11-11). A switch to Fable
outright still gets the Fable line: it asks for Fable, and its judged mark is kept apart from the
mark of the same id read as an answer.

**The lead hint** (2.2.0, the owner, 2026-11-05). The kit recommends the lead on Claude Opus at
`high`; it never switches by itself, and it works fully on a backend lead. So the same hook says
one more line, once a session, when the session's own model is neither Claude Opus nor Claude
Fable mapped behind the `opus` tier (`leadVerdict`): another Claude family, a backend, the `opus` tier a backend answers (`the
\`opus\` model, omniroute:glm-x`), or a name no rule reads as a family. "This session runs on
<model>. The kit works best with the lead on Claude Opus at high effort. Switch with /model.",
with the switch that turns it off. When the `opus` tier itself is what a backend answers,
`/model` cannot help (picking Opus picks that backend again), so the fix it names is the
gateway's: put Claude Opus first in the `opus` slot (`/cc-smart-dev-kit:gateway`), or start the
session with `launch --no-gateway` (`leadHintMessage`). A Fable session gets the Fable line only. Each line has its
own mark (`.fable`, `.lead`), so a hint never hides a later Fable line, and the other way round.
`switches.leadHint` (the person's own `workflow.json`, on by default, `resolveLeadHint`, which
never throws: a broken file keeps it on) turns the hint off for a person who leads on a backend
on purpose; the Fable line has no switch. A start that names no `model` (after `/clear`, or a
recovery) says nothing, and the next stop's transcript model decides. Gateway off and the lead
on Claude Opus: nothing to say.

What it costs: once both lines are said, the hook stops at the two marks. Otherwise each model
is judged once a session: the judgment leaves a mark named after the model
(`<session id>.judged-<hash>`, `judgedMark`), and a later event for that model stops there,
before the gateway config, Claude Code's settings and the workflow file are read. **The limit:
Stop's input has no model field** (the Stop row of `docs/claude-code-contract.md`), so every stop still
reads the transcript's tail to learn the model; the judged mark saves the reads after it, not
that one. A model already judged is not judged again when a slot or the switch changes
mid-session: the hint is a once-a-session note, not a watch. A session nobody watches
(`claude -p`) is told nothing and keeps no mark. The marks are
`<TMPDIR>/cc-smart-dev-kit-session-names/<session id>.<kind>`, beside the session's own name
files (`namesDir`, one home), so the OS clears them; a line's mark is made with `wx`, so two runs
that race cannot both speak, and a mark that cannot be made means the line is not said at all —
never twice.

### The tier note

`tier-view` (SessionStart, UserPromptSubmit) tells **Claude** what each subagent tier runs now,
so it can name the model when it launches. Claude picks the tier and the effort by the job — how
hard it is, what a miss costs — never by the model behind a tier (2.2.0, the owner, 2026-11-05;
`/cc-smart-dev-kit:subagent-decision`). The guard still allows any level from `ALLOWED_EFFORTS`
on `haiku` and `sonnet` (no level is forced on a backend; a person who wants one pins it in the
router, D64); the instructions teach that `max` rarely pays. Before the note, a session read "the
gateway is on" and picked `max` for Claude Sonnet, which the guard allowed and the plan paid for.

- **What it says** (`tierNote`, `src/models/tier-view.ts`): a header, one line per tier the
  Agent tool's `model` names — `- sonnet → Claude Sonnet.`, or
  `- sonnet → omniroute:glm-x (a backend).` — and one closing line: choose the tier and effort by
  the job, and `opus` at `max` and any `fable` launch ask the person. The model is the guard's own
  reading (`resolveLaunchModel`: the person's `ANTHROPIC_DEFAULT_<FAMILY>_MODEL`, then the
  family's slot while it has a chain, its **first** target answering) through the session's own
  gateway view (`sessionGatewayOf`: the effective `ANTHROPIC_BASE_URL`, a profile's chains). The
  level that asks comes from the guard's constant (`OPUS_ASK_EFFORT`), never a second list. A Claude-first chain with a
  backend fallback is Claude, as the guard reads it. A name with no premium tier that a slot
  answers with a premium Claude model reads as that tier (`sonnet` → Claude Opus); a premium name
  keeps its own (`opus` → Claude Fable is the `opus` tier).
- **The gateway off** says the same lines, all Claude: a session without a gateway needs the
  note as much as one with.
- **A config that cannot be read** (`gateway.json` is there and unusable, while the session's
  address is a gateway's) is one plain line that the view is not known. An address with no
  `gateway.json` is another program's proxy, and reads as Claude, the guard's way.
- **When.** At every `SessionStart` — a start, a resume, a clear, a compaction each build Claude's
  context again, so its `hooks.json` entry has no matcher. At `UserPromptSubmit` only when the
  note differs from the one said last in this session (the owner may change a slot while sessions
  run; a line costs context in every session on the machine). The last note is the mark
  `<TMPDIR>/cc-smart-dev-kit-session-names/<session id>.tiers`; a prompt in a session whose start
  the hook never saw says it once, and a mark that cannot be kept makes a prompt silent rather
  than repeat itself. It was chosen over a `PreToolUse` hook: that answer comes after
  Claude chose its effort.
- **One more line while auto mode's safety checks fail** (the owner, 2026-10-27). When the router
  recorded that a check failed for want of capacity with nothing standing in (`checksDown`, for
  the session's own gateway scope, its profile's record only), the note adds one line under the
  tiers (`checksDownNote`, `src/gateway/checks-down.ts`, the one home of its words): the checks
  fail and why, the session cannot fix it, what the person can do, and to say it once, then stop
  and wait rather than retry. Claude Code's own deny tells the model to try again; this line is
  why it should not. It rides the same marks, so it appears when the checks start failing, and
  the tiers' note alone comes back when they recover. It reaches the model at the next prompt,
  never mid-turn.
- **Why a hook of its own.** `fable-session` speaks to the person and never to Claude, by its
  contract; `session-name` has another job.
- **Machine-wide**: no project file, a folder outside git and `claude -p`
  all get it. Never a question, never a block. Not covered: Claude Code's own overrides of the
  subagent model or effort (`CLAUDE_CODE_SUBAGENT_MODEL_FORCE`, `CLAUDE_CODE_EFFORT_LEVEL`); the
  note names those too.

### The notifier

Custom kit notifications are retired. The `notify` and `stop-failure` hooks, the
`hook notify` command, the alert worker and all custom desktop and terminal sends are gone.
The updater records its result without a notification. Claude Code and other plugins keep
their own notification behaviour.

Setup's retirement helper (`src/setup/user-notify-hook.ts`) removes only the exact recorded
`Notification` entry while it still matches the retired entry, and the exact recorded
`set -g allow-passthrough all` line through the managed writers. Edited or unowned entries
stay with a manual-cleanup message; unreadable records leave the affected file unchanged.
It installs no replacement hook, restores no old `dist/notify.js` command and changes no
running tmux server. `--dry-run` writes nothing.

`workflow.alerts.events` and `workflow.alerts.sound` are accepted on load and ignored,
preserved on unrelated writes, and no longer shown or writable settings. The status line
still reads `alerts.usagePercent` and shows usage, limits and reset information.

### The job route

`job-route` (PreToolUse on Bash and PowerShell) is the heavy-job queue's door and the kit's one
guard. It keeps its public name: `hooks.json`, project files and `ownHooks` values stay valid. It
is **machine-wide** and **`alwaysOn`** — the frame skips the `ownHooks` step and `ownHooks`
cannot switch it off. It does one job: it sends a heavy command through the machine's queue, or
refuses a heavy run mixed with other commands. **It never asks the person anything** (6.0.0 took
out its launch judge: a raw `claude --bg`, `claude -p` on `fable` or `opus` at `max`, `workflow
propose` and the Herdr rules no longer ask or refuse; `src/hooks/bash-judge.ts` and
`launch-judge.ts` are gone). Its `hooks.json` entry passes `--missing=quiet` and has no
`onFailure`: with no bun, or after a crash, the line runs as written. Outside git, and with a
broken or too new `cc-smart-dev-kit.json`, there is no project to route for, so it leaves the
line as written. A project file that still lists `"job-route"` keeps parsing
(`UNSWITCHABLE_HOOK_NAMES`), it silences nothing, and `doctor` prints one `·` line that it can go.

**Both shell tools.** Claude Code has a PowerShell tool beside Bash on native Windows, so the
hook is wired on both and reads each line in its tool's dialect (`dialectOfTool`): a heavy run a
session makes through the other shell tool is not missed. The route stays
**Bash only**: its rewritten line names the `sh` launcher and, for
anything but one plain command, `sh -c`, which the PowerShell tool cannot run — a wrong rewrite
is worse than none, so a PowerShell line is never rewritten. With the route on, a heavy
PowerShell line is refused instead, with the exact Bash line to run (only where the Bash tool
can exist: on Windows, where Git Bash is found), because left raw it would not wait for a slot;
a light or print-only line is left as it was written.

**The route** is the heavy-job queue's door, and an opt-in with two homes (the
`switches.jobRoute` switch): the project's `"jobs": { "route": true }` (or `false`) in its
`.claude/cc-smart-dev-kit.json`, and under it the person's machine-wide default,
`switches.jobRoute` in their own `workflow.json`. The project's value wins, field by field, as
every workflow setting does; with neither it is off. The hook reads the person's file through
the checked cache (`loadPersonalWorkflow`, `src/hooks/checked-config.ts`) and decides with
`jobRouteFrom` (`src/workflow/merge.ts`), the function `resolveJobRoute` and `workflow show` use
too, so they agree; it does so with or without a project file: this hook runs machine-wide. A
personal file it cannot read leaves the project's value and the default standing, so the hook
never fails on it. Outside git
there is no project, and a heavy command runs raw. With the route on, a command its kinds
classify as heavy is sent through the queue instead of running raw (`docs/jobs.md` § The
route). It answers with Claude Code's `updatedInput` — the same tool input,
its `command` replaced by `"$HOME/.local/bin/cc-smart-dev-kit" job run --kind <kind> --
<command>` — proved live on 2.1.301 (`claude-code-contract.md`). It gives no
`permissionDecision`: the rewrite replaces the input and the permission system still decides
about the new command, so a person's own rule for Bash keeps working. **A line is queued whole
only when every command in it is heavy, a `cd`, an assignment or glue, and one is heavy**
(`routableLine`, `classifyRoutableLine`). Glue is what nobody writes a permission rule against:
the commands of `GLUE_COMMANDS` under their argument rules, the readers of `READ_ONLY_FILTERS`
that read the pipe and name no file, and the structure of a `{ … }` or `( … )` group. One heavy
command piped into read-only filters is queued too (`READ_ONLY_FILTERS`): only the heavy step goes
into the wrapper, and the filters stay outside it as written, so the person's own rules still see
them; a `tee` to a file, a `sed -i` or a filter before the heavy step is no filter. The list and
every argument rule: `docs/jobs.md` § The route. Why: Claude Code matches a person's `Bash(…)`
rules against the command it is about to run and does not look inside `bash -c '…'`, so a
rewritten `tsc && rm -f x` would hide its `rm` from a `Bash(rm:*)` rule (proved on 2.1.308,
`claude-code-contract.md`).

`REWRITE_SUPPORTED` in the hook is the one switch, and with it false the same command line is
denied instead, never silently left raw. A command already inside `cc-smart-dev-kit job run` is
left alone. A name the project's `package.json` defines as a script is matched only by a
`script` kind, never by a tool of the same name: a `tsc` script that already wraps the job is
not wrapped again (`docs/jobs.md` § The classifier). It is the one guard that changes the call
rather than asking about it.

**A mixed line is refused** (`mixedLineDenial`, `mixedHeavyLine`). A Bash line that runs heavy work
that takes a slot beside a command that is neither heavy nor glue (`bun test; git status`) has no
safe form: queued, the other command would hide from the person's rules; raw, the heavy part
would not wait for a slot. So the hook denies the call, and the reason names the heavy run and the
other command and says to run the heavy command on its own line. The refusal is asked only when the
route gave no queue command, and before the git prefix, so a heavy run never sits raw beside a git
command. It is a deny whoever is away: the session reads the fix and retries, and nothing is
parked. A light run, a watch run, a line that queues itself, and a line whose other command sits in
a package script's body are no mix. A `<pm> run <script>` that is the line's own command, whose
body runs heavy work, is queued whole even when a command that is not heavy work comes first in
the body (`next typegen && tsc --noEmit`). A body that never ends, runs in the background or as
another user, calls itself or nests too deep still runs raw. A line the person mixed themselves
is refused, and since 6.1.0 so is `bun run check; git status` (a script of that kind beside
another command; `docs/jobs.md` § Scripts are read by their body).

Two more rules sit on the route. **A line is wrapped only when it is also heavy:**
`routableLine` says the line may be queued, and `runWeight` (the one judge, `src/jobs/classify.ts`)
says it is heavy, so a run on named files, a print-only run, a watch run and a line that queues
itself stay raw. **A call that set no `timeout`** gets the larger of `BASH_MAX_TIMEOUT_MS` and
`BASH_DEFAULT_TIMEOUT_MS` (a job may wait many minutes); one the call chose is kept, and a call
in the background gets none (`REWRITE_TIMEOUT_SUPPORTED`, proved on 2.1.326).

**The git prefix** (`routeGitHooks`) is the route's second answer, asked when the first has none
(a line with a git command is never also routable: git is no heavy kind): a `git commit`,
`git merge` or `git push` whose own hook is heavy (`hookDecision`) gets three `GIT_CONFIG_*`
assignments in front of the git word, a prefix and never a wrapper, so the person's `deny` and
`ask` rules still see the `git` line (proved on 2.1.326). Every condition, and each doubt that
leaves the line alone: `docs/jobs.md` § Git hooks. The folder and its script:
`docs/design/jobs.md`.

**Left in the project that had them** (project values or project tools, not general): a ban
on one package manager, the local database wipe guard, the heavy-job guard, a pull request
into a release branch, the main checkout following the base branch after each merge
(installs and migrations), the notes about one project's dev notes, migrations and env
files, and the claude-mem start-folder note. **Ported in Phase 4, with the MCP servers the
plugin registers:** the Serena root record (the
`serena-root` hook, retired with Serena in 0.6.0) and the Playwright output folder (the
`playwright-output` hook, above).
**Not ported:** the Windows helper that
removes a worktree after the session lets go of it — the plugin removes one when its session
asks (the WorktreeRemove hook) or by `cc-smart-dev-kit worktrees --clean`, and it moves the
folder before it deletes it, so a program still using it makes the removal fail and touch
nothing (`docs/windows-setup.md`). Custom notification behaviour is retired (§ The notifier).

Herdr commands are no longer judged by a hook (6.0.0): `cc-smart-dev-kit herdr` refuses what it
must in its own code (`--asked` for Fable, Opus at `max` and a non-free remote machine, the explicit model,
effort and mode), and no hook judges them. Turns starting with `<hc `
or the kit report tag are not the person's words (`prompt-source.ts`). A phase whose agent is
`herdr:<core>/<address>` gets a keep-going reminder to run `cc-smart-dev-kit herdr wait` in the
background or use `herdr send`, never `SendMessage`.

### `doctor --live`

`cc-smart-dev-kit doctor --live` (opt-in; it uses the person's login and costs a few cents) makes one
throwaway repo in a temp folder, without `cc-smart-dev-kit.json` (Claude Code's own worktrees,
what every project uses), and runs one `claude -p` session in it with
this plugin (`--plugin-dir`), only the EnterWorktree, ExitWorktree and Bash tools,
`--allowedTools` for exactly the calls it makes (never a mode that skips the permission
checks), and a three-step prompt: enter a worktree, `git status` there, leave with
"remove". Every hook run is logged (`CC_SMART_DEV_KIT_HOOK_LOG`, with each run's `cwd` and the spec's
`logFacts`), and it checks: the plugin's hooks fired (SessionStart,
`job-route`), `job-route` **read the command line** (its log names the programs it
parsed: a hook that fired is not a hook that answered), no WorktreeCreate hook ran, Claude
Code made its own worktree and the session worked in it, and ExitWorktree removed it. No
repo wires a worktree hook: the retired engine's is gone with the engine. When all pass it
records the Claude Code version in the state folder (`live-check.json`); plain `doctor` shows
that line, and says to run it again when the installed Claude Code is another version.

## The safe switch


A project may already have its own copy of a piece the plugin now ships (a note, a stop).
Moving it to the plugin must never run it twice or leave a gap:

The project names its own copies, and the plugin steps aside for exactly those:

1. **The project lists each plugin hook it still runs itself**: `ownHooks: ["verify-gate"]`
   in its `cc-smart-dev-kit.json`. The plugin's copy of that hook then stays silent there
   (§ The hooks › One frame for every hook). A plugin hook the list does not name still
   speaks, so a gap is never silent, and a project hook on the same event alone silences
   nothing.
2. Every machine gets the plugin, and `cc-smart-dev-kit doctor` is green on each.
3. **Then the project removes its copy**, one at a time, and takes that name out of
   `ownHooks`; with the list empty it raises `requires` in its `cc-smart-dev-kit.json`.
4. **A small fail-closed check in the project** covers a machine without the plugin: it
   stops risky work instead of going on unguarded.

Rollback is a new release with the old behaviour. A version number never goes down.

`cc-smart-dev-kit doctor` follows the switch at both ends: a name in `ownHooks` whose event has no
project hook left to answer is a warning (the project has no hook for it while it is listed), and
a project hook running next to a plugin hook that is not listed is a warning too (both may
answer the same command). The second warning leaves the machine-wide hooks out
(`MACHINE_WIDE_HOOKS` in `src/hooks/specs.ts`: the `USER_HOOKS` bundles and the plugin hooks
whose answer does not depend on the project's file): they answer about the machine, not the
project, so a project hook on their event is not a second copy of a plugin piece.

**A plugin hook the plugin retires** keeps its name in the schema as a retired name
(`RETIRED_HOOK_NAMES` in `src/project/config.ts`): a project file that still lists it
parses, and the name silences nothing, because no hook of that name runs.
Refusing it would fail the strict parse, and every hook would then fail closed.
`doctor` prints one `·` line that the name can go.

The retired worktree engine is not part of the switch: a project that still has its lines or
its fields fixes both with one run of `cc-smart-dev-kit project init` (README § Worktrees), in
one commit. `cc-smart-dev-kit doctor` names what is left.

## Retired in 6.0.0

The owner, 2026-11-21: "the only guard our kit will support will be the heavy-job guard.
Everything will run in full auto." These hooks are gone, with their bundles and tests. Each name
is in `RETIRED_HOOK_NAMES`, so an `ownHooks` that still lists one parses, silences nothing, and
`doctor` says it can go.

| Hook | What it did | Why it went |
|---|---|---|
| `git-guard` | Asked before a push, a force-push, a reset, a clean, a discarding checkout and the like | A question for the person on every such call |
| `merge-guard` | Asked before a merge, a pull request open, an issue write; judged `allowMerge`, CI, the review record | Same. `allowMerge`, CI and the review record are now the session's own instruction (`/cc-smart-dev-kit:commit`) |
| `deploy-guard` | Asked before a listed deploy command while a blocking deploy task was open | Same. `task release <env> --before` stays the session's own gate (`/cc-smart-dev-kit:tasks`) |
| `main-folder-guard` | Denied an edit or a write in the main checkout | The rule stays in `optin/worktrees.md`, as an instruction |
| `agent-guard` | Judged every Agent, Task and Workflow launch: model, effort, the Fable gate, the UI rule | The model rules are instructions (`core.md` § Subagents, `/cc-smart-dev-kit:subagent-decision`) |
| `session-escape-guard` | Denied or asked on a session reaching the kit's own settings, state, portal port or review record | Same |
| launch judge in `job-route` (`bash-judge.ts`, `launch-judge.ts`) | Asked or refused a raw `claude --bg`, a `claude -p` on `fable` or `opus` at `max`, `workflow propose` and the Herdr commands (raw `hc` writes, `--asked`, machine rules) | Same. `herdr` keeps its own refusals in the command; the rest is Claude's to run |

`user-away` no longer turns another hook's ask into a parked action, and no longer answers
Claude Code's own permission dialog (§ While the person is away). **The trade-off, written down at the owner's
ruling:** nothing now stops a mistaken `git reset --hard` in the main checkout, a force-push to `main`,
an unreviewed merge, a deploy, a write in the main folder, or a Fable or Opus-at-`max` launch.
Claude Code's own permission mode and the person's own `deny` rules are the stops left.
`job-route` stays: it queues heavy commands and refuses a heavy line mixed with other commands.
