# The hooks


The hooks live in `src/hooks/`. Every one of them is wired by the plugin:

- **The plugin's hooks** (`HOOKS`): each one a bundle (`src/entries/<name>.ts` →
  `plugin/dist/<name>.js`), wired in **shell form** in `plugin/hooks/hooks.json` (no `args`;
  the exec form it replaced cannot start on Windows — `.claude/rules/hooks.md`,
  `docs/windows-hooks.md`), so they run in every project. They run through
  `plugin/bin/cc-smart-dev-kit-bun.sh`, a small `sh` script that finds
  bun without PATH (Claude Code's hooks get the PATH it was started with, which may lack
  bun): the bun `cc-smart-dev-kit setup` baked into the launcher, then `$BUN_INSTALL/bin/bun`,
  `~/.bun/bin/bun`, and PATH. With none it answers by its `--missing=` mode: a PreToolUse
  guard passes `--missing=ask`, so it asks the person instead of letting the tool run (a
  guard fails closed, and it asks too when its own bundle file is gone, and its `hooks.json`
  entry says `"onFailure": "block"`); every other hook passes `--missing=quiet`, one line on
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
   lists the hook in `ownHooks` (`["git-guard"]`), the plugin's hook exits 0 and prints
   nothing, so the project's copy runs alone (§ The safe switch). Only that field is read
   (`ownHooksOf`), on its own, so it works even when the rest of the `cc-smart-dev-kit.json` is
   broken or needs a newer plugin. It is explicit on purpose: a project hook on the same
   event is not enough to silence a plugin hook, because it may be a logger, a different
   check, or a copy that does not cover the same commands — and a guard that went quiet for
   that would leave the person unguarded (owner). `cc-smart-dev-kit doctor`, run in a
   project, prints one `·` line per listed hook, and warns (`!`) when a listed hook has no
   project hook left to answer, or when a project hook runs next to a plugin hook the list
   does not name. A hook the project wires itself skips this step: that wiring is its
   opt-in. **Three hooks skip the step themselves:** `session-escape-guard`, `job-route` and
   `user-away` are `alwaysOn` (`HookSpec.alwaysOn`), so the frame never reads `ownHooks` for
   them — the project's file is one of the things the first guards, the second limits what the
   session itself may launch, and the switch of the third is the person's (§ The session-escape
   guard, § The Bash judge and the job route, § While the person is away).
   `ownHooks` does not accept `session-escape-guard`'s or `user-away`'s name; it still accepts
   `job-route`'s,
   because a project file written before 1.0.0 may carry it, and the name silences nothing
   (`UNSWITCHABLE_HOOK_NAMES`).
3. **Read `cc-smart-dev-kit.json`.** When it is broken or needs a newer plugin, the hook
   **fails closed**, each in the way that suits its event: a guard asks the person (it cannot
   know whether the project turned it on), an informational hook says one line. "Closed"
   never means silent: a person must hear why.
4. **Run.** An informational hook's error is one line on stderr and exit 0: its bug never
   stops work. A **guard's** error answers through its `onCrash` (`guardCrash` in
   `specs.ts`): it asks about the call in its own domain, so a crash never lets a call
   through.
5. **While the person cannot answer** (`cc-smart-dev-kit user unavailable`), an answer that
   asks them becomes a deny (`askedWhileAway`, § While the person is away). It keeps the
   hook's own words, adds "parked as #N", and puts the call on the person's list as an
   `action` with its exact command. One step for every hook, so a new guard needs nothing
   here. It only ever makes an answer stricter: a deny, an allow and silence pass through
   unchanged, and a state it cannot read keeps the ask.
6. **Record an ask.** An answer that asks the person is appended to `guard-asks.jsonl` in the
   state folder (`src/hooks/ask-log.ts`): the time, the hook, the session, the tool and a
   short reason, put through `maskedLine` so no secret reaches it. The file stays small by
   the rule of `update.log` (past `LOG_MAX_BYTES` the newer half is kept). A write that fails
   is one line on stderr and never changes the answer. An ask that step 5 turned into a deny
   is no ask: it is on the person's list instead.

Each hook's answer when it fails (the same table is in `.claude/rules/hooks-guards.md` § Fail safe):

| Failure | A guard (git, merge, main-folder, job-route, agent, session-escape, user-away) | Any other plugin hook |
|---|---|---|
| Its own code throws | `onCrash`: **ask** about the call (none outside its domain; silent on PostToolUse) | one stderr line, exit 0 |
| The input is not JSON | **ask**, in general | one stderr line, exit 0 |
| `cc-smart-dev-kit.json` broken or too new | **ask** (`agent-guard`, `session-escape-guard`, `job-route`'s judge and `user-away` judge the call anyway) | one line of context or stderr (`keep-going`, `builder-finish`, `agent-usage`, `fable-session`, `tier-view` and `task-start` judge anyway) |
| No bun, or one too old | the shim's `--missing=ask`: **ask** | `--missing=quiet`: stderr, exit 0 |
| The bundle file is gone | the shim **asks** | bun's error, exit 1 |
| Cannot start, times out, fails (exit code other than 0 and 2) | `"onFailure": "block"`: the call is **blocked** | Claude Code goes on |

The command `plugin/bin/cc-smart-dev-kit` runs through the same shim with `--missing=fail`: no
bun is one stderr line and exit 1, because a command must never report success when it did not run.

The agent guard is also wired on **PostToolUse** for the same tools (`Agent|Task|Workflow`).
Claude Code fires it **at the launch**, with the tool response `status: "async_launched"`,
`agentId`, `resolvedModel` and `outputFile`; the order is PreToolUse, PostToolUse,
SubagentStart, SubagentStop. A launch the guard asked about, and the person allowed, is recorded
there with that `resolvedModel` rather than a rebuilt one (§ The Agent guard).

The frame is general on purpose: later hooks (notifications, the routing of heavy jobs)
are new specs in it.

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
| `git-guard` | PreToolUse (Bash, PowerShell) | `cc-smart-dev-kit.json` exists | Asks before **any** `git push` while `autoPush` is off (D15: the default, so a push leaves the machine), and asks for a force-push (git's abbreviations included: `--forc`), a push to a protected branch (`protectedBranches`, default `main`), `push --all`/`--mirror`, a branch deleted on the remote (`git push origin :x`, `-d`/`--delete`), `reset --hard`, `reset --merge` (it throws away staged changes and staged new files; `reset --keep` overwrites no working file (it refuses instead), so it asks nothing), `clean -f`, `worktree remove -f`, a checkout or restore that discards changes, `branch -D`, `stash clear` and an unnamed `stash drop`, and (with `worktrees`) a bare `git stash` / `stash pop`. `autoPush` is read as the merge guard reads its gate (`resolveGate`: the default, the person's `workflow.json`, the project's file committed on `origin/<base>`), so a session cannot switch it on in its own worktree; a policy it cannot read asks. One shell lexer (`src/shell/command.ts`) reads each command of a line; quoted text, here-docs and comments are data, and shell keywords, wrappers (`timeout 60 git push -f`, `env -i sudo -u me …`, `setsid`/`flock`/`script -c`/`busybox sh -c`, `xargs …`), the here-doc a shell reads as its script, and the text piped into one are read through. `git send-pack` and a `git -c alias.x=push x` on the line push too, and a program the line works out when it runs (`$(which git) push`, `$GIT push`) asks rather than pass unseen. Known limits: a git alias from the person's own config, `branch -f`, `checkout -B`, `switch -C`, `ssh`, a script file. It asks, never denies: the person may mean it. |
| `main-folder-guard` | PreToolUse (Edit, Write, NotebookEdit, Bash) | `worktrees.guardMainFolder` | Denies a change to a file in the main checkout itself, with the way into a worktree (`EnterWorktree`). **Bash too:** it reads the line with the shell reader (`src/shell/writes.ts`, the one write reader the session-escape guard shares) for what it writes — a redirection, `tee`, `sed -i`, `cp`, `mv`, `rm`, `touch`, `mkdir`, `ln`, and a git command that changes the work tree or its branch (`checkout`, `switch`, `reset`, `restore`, `stash`, `commit`, `merge`, `rebase`, `pull`, `cherry-pick`, `revert`, `apply`, `am`, `clean`; `git -C` and `--work-tree` followed) — in the folder each step runs in, after a `cd`. Read-only git, `git worktree add`, `/dev/null`, the temp folder and paths outside the repo pass; a word the shell fills in when the line runs lets the call through (a program built at run time that names a checkout-changing git word asks). **The plans folder passes**, so plan mode can write its plan: the session's own resolved `plansDirectory` (`src/hooks/plans-folders.ts`, which `verify-gate` reads too, the one home); nothing else under `.claude/` is exempt. A worktree inside the main checkout is no main-checkout path. (Until 0.6.0 it also placed Serena's edits, with the `serena-root` hook's record; both went with Serena.) |
| `playwright-output` | PreToolUse (`mcp__playwright__.*`) | always (a `USER_HOOKS` bundle: it reads no cc-smart-dev-kit.json) | Rewrites a relative `filename` to an absolute path in the browser's output folder, with `updatedInput` and no permission decision; a relative name with a `..` segment is DENIED (the launcher's `--allow-unrestricted-file-access` means the server takes that path as it is). Answers only while the live `playwright` registration is the one setup recorded — a server of the person's own is left alone entirely. |
| `merge-guard` | PreToolUse (Bash, PowerShell) | `cc-smart-dev-kit.json` exists | Asks the person before a command that merges a pull request, or opens or readies one (`openPr`, D16: `off` asks before any of them, `draft` lets a draft create through and asks for a ready one and for `gh pr ready`, `ready` asks for neither). Every merge of the line is judged (`gh pr merge`, `gh pr -R owner/repo merge 5`, an alias from `gh alias list`, `--auto` included), and the first the policy does not allow asks, naming that pull request: `autoMerge` on, the base is the integration base (`autoMergeAllowed`), the merge names THIS project's repository (its `origin`), every required check `gh pr checks --required` reports green, and (with `reviewBeforePush`) the head commit's review is recorded. `--admin` always asks. The forms it does not judge ask with the reason — a `gh api` merge, a GraphQL query it cannot read, a shell alias, an extension whose words name a merge — as does a step that moves the merge's folder, branch or repository (`cd`, `git switch`, `GH_REPO=…`, `env`), and a `gh` that is missing or does not answer. A `gh pr create` outside the base its head branch belongs to (`worktrees.base`, or `worktrees.bases` for that branch; with no `--base`, the repository's default branch) asks, naming both branches, and never denies (WA1). **A raw write to GitHub's issues is the person's yes too** (D67, `issue-writes.ts`): `gh issue create`, `edit`, `comment`, `close`, `reopen`, `delete` and every other `gh issue` subcommand that is not a read, `gh label create`, `edit`, `delete` and `clone`, a `gh api` POST, PATCH, PUT or DELETE to a repository's `issues` or `labels` endpoints, and any GraphQL mutation that is not a pull request one this guard judges, ask (the project's file must exist, like every project part); text the reader cannot read whole (an endpoint or query the shell fills in — a `$` expansion or a backtick outside single quotes; `--input`, `query=@file`) counts as a write, and `gh -X=POST` is `POST`; `gh issue list`/`view`/`status`, a GET and `--help` pass, and so does the kit's own `cc-smart-dev-kit issue file`, which is no `gh` command. The question names the kit's way. A pull request answer on the same line wins. A `gh` alias is read for what it expands to (a shell alias, or a list that cannot be read, counts as a write); a program worked out when the line runs whose words name an issue or a label is asked about. Read-only `gh`, 10 s a call of the hook's 30 s. § The workflow › The merge guard. |
| `agent-guard` | PreToolUse (Agent, Task, Workflow), and PostToolUse for the record | **machine-wide** | The model a launch really runs on, and the model rules: no readable `model`/`effort` in the call or agent definition → deny (the call's, else the agent definition's choice); `low` effort → deny on every model (`medium` for searches and reads, `high` for building and reviews, `xhigh` for the hardest judgment, `max` on `haiku` or `sonnet` when the task wants it, with no restriction, whatever model answers them (the owner, 2026-10-25 and 2026-10-26: no level is forced on an affordable backend; a person who wants a backend at one level pins it in the router, D64) — D13); the **`opus` tier** — whatever answers behind the name, Claude Fable included (a premium name keeps its own tier, the owner, 2026-11-11), and a name with no premium tier whose override or slot answers with a premium Claude model counts as that tier — is allowed at `medium`/`high`/`xhigh` for any agent and any purpose, and an **ask** at `max` (the owner's decision D11; in `claude -p` a deny); a launch that declares UI/UX work — `Opus reason: ui`, or `Fable reason: ui-design` — runs only on `opus` or `fable`, at `high` or above (`UI_POLICY`, D50), and is **denied** on Sonnet, Haiku or an affordable slot, or below `high`; the **`fable` tier** is a read-only agent with a `Fable reason:` word, and an agent that can change files (a fork included) only with `build`, as an **ask**. A fork is judged on the session's model, never on the `model` it names. A premium launch is recorded once it is known to run: an allowed one on PreToolUse, an asked one on PostToolUse. § The Agent guard. |
| `session-escape-guard` | PreToolUse (Bash, PowerShell, Edit, Write, NotebookEdit) | **machine-wide**, and `ownHooks` cannot switch it off | Denies `workflow review-done` and any kit command run with `CLAUDECODE` removed; asks before a command that reaches the portal's port, before an edit or write of the kit's own settings, state or installed plugin folder, and before a computed program whose line names the kit command. § The session-escape guard. |
| `fable-session` | SessionStart, PostModelSwitch, Stop | **machine-wide** | One `systemMessage` to the person, once a session, when the session's own model is the **`fable` tier**; nothing to Claude, never an error and never a block — the line itself was seen live (2026-10-17), but not on `PostModelSwitch` or `Stop` yet. The model: at a start, the `model` the input names (no fallback); at a switch, `to_model` — the model the session moved TO; at a stop, the one that answered in the transcript, then `ANTHROPIC_MODEL` — the guard's own reading of the tier. Not `UserPromptSubmit`: it judged the PREVIOUS answer's model, so it missed the switch and warned after a switch back (the live bug of 2026-10-17). § The Fable-session note. |
| `tier-view` | SessionStart (every source), UserPromptSubmit | **machine-wide** | One note to Claude (`additionalContext`) of what each subagent tier (`haiku`, `sonnet`, `opus`, `fable`) runs now and the effort rule that follows, read the Agent guard's way through the session's own gateway view. While auto mode's safety checks fail for the session's scope, one more line says so, with what the person can do. Said at every start, and at a prompt only when it differs from the note said last in this session. § The tier note. |
| `job-route` | PreToolUse (Bash, PowerShell) | **machine-wide**, and `ownHooks` cannot switch it off | The kit's one shell judge (`bash-judge.ts`), in two parts. Herdr rules refuse raw terminal writes and identity assignments, cap child permission modes, and ask for premium launches, non-free remote machines and machine-rule changes (§ Herdr commands in the Bash judge). **The judge** ignores the project's file and runs outside git: a raw `claude --bg` **asks** in an attended session (refused in `claude -p`), because such a session runs beside this one and reports to nobody; `claude -p` is judged by the launch policy every Agent launch meets (its `--model`/`--effort`: no model refuses, the `fable` tier asks, the `opus` tier at `max` asks; a `Fable reason:` line in its prompt counts); `workflow propose` **asks** while the gate has `autoPush` off or `openPr` short of `ready` (refused in `claude -p`), under every spelling the judge reads — the kit by name, by a path to the launcher, by its bundle behind `bun`, through a wrapper or a program that runs its arguments, a computed program or subcommand (read as the kit's when the line names it, `namesKit`), `env -u`, and with redirections dropped. It reads each line in the dialect of the tool that runs it, so the PowerShell tool is judged the same. **The route** is the `switches.jobRoute` switch — the project's `jobs.route` over the person's machine-wide default, off until one says on — Bash lines only, and not outside git: a line whose every command is heavy, a `cd` or an assignment, or one heavy command piped into read-only filters (`tail`, `grep`, `wc`, …; the filters stay outside the wrapper as written), is rewritten to `cc-smart-dev-kit job run --kind <kind> -- <command>` through `updatedInput` (proved live on 2.1.301); any other line runs raw, as the person's own rules see it (HK hunch 1). A light line (named files, print-only) stays raw too, and so does a watch run (`runWeight`). A call that set no `timeout` gets the Bash tool's longest. **A `git commit`, `git merge` or `git push` whose own hook is heavy** gets the kit's git-hooks folder as a prefix of three `GIT_CONFIG_*` assignments (`routeGitHooks`), never a wrapper (`docs/jobs.md` § Git hooks). With the route on, a heavy PowerShell line is refused with the Bash line to run instead, where the Bash tool can exist. § The Bash judge and the job route. |
| `after-merge` | PostToolUse, PostToolUseFailure (Bash, PowerShell) | `worktrees` | After a pull-request merge (`gh pr merge`, `gh pr -R owner/repo merge 5`, a readable `gh api` merge path, a `gh` alias for one): the steps that clear the merged worktree (with `clearWorktreeAfterMerge` off or unreadable, that it looks finished and the person decides), and, when it went into `worktrees.base`, it starts the background clean of finished worktrees once (§ Finished worktrees clean themselves). It never tells the other sessions about the merge: that message is gone (the owner, 2026-11-11). A form that names no pull request gets no note. |
| `review-record` | SubagentStart, SubagentStop | `cc-smart-dev-kit.json` exists | When a review agent (`workflow.reviewAgents`) starts, notes the commit the working folder is on and its branch; when it stops, records that start commit on that branch — the record the merge guard reads. Commits made during the review count as change after it. A stop records only for a run that was a review from start to end: the brief (the transcript's first user entry) and every prompt given after it each hold `Mode: review` alone on a line (trailing spaces and tabs allowed). Tool results and Claude Code's own skill-load and system-reminder entries (a reminder must end at its closing tag) are no prompt; any other later entry is — a resume, a message from the session that started the agent (a `user` entry, or a `queued_command` attachment with a `prompt` and an `origin`), a task notification, Stop hook feedback. The whole transcript is read, up to 16 MB. A consult, a resumed consult, a review a Stop hook sent back, a review that compacted (the summary is a prompt), and a missing, unreadable or larger transcript record nothing. Nothing for an agent that stopped inside its own worktree. § The review record. |
| `subagent-background` | SubagentStop | `cc-smart-dev-kit.json` exists | A subagent that ends its turn with background work **it started** still running (a Bash command, or a subagent it launched) is blocked **once**, with one plain reason: wait for the work or stop it, then report. The input's `background_tasks` is the session's list, so the hook reads the agent's own transcript (`agent_transcript_path`) as JSONL, line by line, and keeps only an id named in a **tool result of the agent's own call** — a Bash background launch (`Command running in background with ID: …`) or an Agent launch (`agentId: …`) — never one in its brief or in a file it read; the ending agent's own entry is dropped (a background subagent appears in its own list). No `additionalContext`, never a second block (`stop_hook_active`), and nothing when the transcript cannot be read. § One frame for every hook. |
| `verify-gate` | Stop | `checks.fast` | One **block** when this session changed files after the last Bash or PowerShell call that ran the project's fast check, naming the command — once per change: the block's own feedback line in the transcript is the mark, so a change made after it earns the next reminder, and a check that fails never traps the turn. It reads the session's own transcript (JSONL) in order: an Edit, Write or NotebookEdit counts only for a file inside the session's current checkout, after resolving symlinks (new code files count too). Relative paths use the edit record's own `cwd`, not the Stop folder. Missing or unusable paths, and relative paths without a known edit folder, count as changes: only a known path can prove an exclusion. Markdown (`.md`, `.mdx`), the repo's `.claude/plans/`, and Claude Code's `plansDirectory` (default `<Claude config>/plans`, with user, project and project-local settings read in that order) do not count. An edit whose result was an error or a refusal changed nothing. A shell line that runs the check is the check (through the one shell reader, in that tool's dialect), and a subagent's own calls are in its own transcript. Silent on the stop its own block caused (`stop_hook_active`), on a turn that still waits on background work, with no `checks.fast`, and when the transcript cannot be read — a reminder never stops a person's work. |
| `builder-finish` | SubagentStop | **machine-wide** | A builder (an `agent_type` ending in `builder` or `rules-maintainer`, the two agents the build skill gives a phase) whose brief holds the line `Your task: #<n>` is blocked **once** while task #n still has open blocking steps, each named with the `task_done` call that closes or drops it. Silent for any other agent, without the line, and when the task or the task list is not there. § A builder's hand-back. |
| `keep-going` | Stop | **machine-wide**: it needs no cc-smart-dev-kit.json; `ownHooks` silences it | The main session's turn end is blocked **once per stalled state** when a phase of a plan this Claude process works on is `in_progress`, or the plan in flight has ready phases and none runs, no background work runs and the last answer has no `Waiting for:` line. The same reason already given, with no subagent started or resumed since, keeps it silent. The reason names the builder to resume with `SendMessage` (or the phase needing a fresh builder), every ready phase to start together, and how to close or record a blocker, and warns against moving a phase back to pending to end the turn. An unreadable transcript keeps the decision; an unreadable task store blocks nothing. § The keep-going guard. |
| `agent-usage` | SubagentStop | **machine-wide** | One line per subagent in `<stateDir>/agent-usage.jsonl`: the time, the session, the agent's id and type, and per model the replies, the four token sums and an estimated USD cost — from the agent's own transcript, never a word of its content. A second stop of one agent supersedes its first line when read; the record is kept small like the ask log. One stderr line when the transcript cannot be read or the record cannot be written. § Each subagent's usage on record. |
| `worktree-leftovers` | SessionStart (startup, resume) | `worktrees` | Names at most eight finished worktrees and eight missing folders, keeping each total; `+N more: git worktree list --porcelain` lists the rest. Finished worktrees have every commit on `origin/<base>`, nothing uncommitted, no session in them, an idle hour, and no ignored file that cannot come back; locked ones are kept by `worktrees --clean`. The hook says once what the background clean removed, and starts that clean (at most once an hour per repo, never in `claude -p`). At an attended start it also adds up to three short lines about the main checkout — on another branch than `base`, behind `origin/<base>` as git already knows it, or in the middle of a merge, a rebase or a cherry-pick — read-only and with no fetch. With `worktrees.guardMainFolder` on, each such line names the command for the person to run in the main checkout, never a step for the session; a fast-forward is always `git merge --ff-only`. **With the guard on, a session that starts in the main checkout (not in a worktree) also gets one more line, the last of the main-checkout lines: it is in the main checkout, and its first change goes into a worktree** (`EnterWorktree`, or `claude -w <name>` from a terminal; `mainCheckoutNudge`). It is silent in `claude -p`, in a worktree and with the guard off, and makes no git call. It removes nothing itself (§ Finished worktrees clean themselves). |
| `session-name` | SessionStart (startup, resume, compact, clear), UserPromptSubmit | `sessionNames` | Tells the session to name itself after its task (`cc-smart-dev-kit session-name`) at start and once per context at an unnamed prompt. A `.reminded` mark beside the temp name files suppresses repeat prompts; every SessionStart resets it, including compact and clear. Then sets that as its title at the next prompt (`sessionTitle`); a name the person gives with `/rename` stays until the session names itself again. |
| `user-away` | PreToolUse (AskUserQuestion, ExitPlanMode), PermissionRequest, UserPromptSubmit, Stop | **machine-wide**, and `ownHooks` cannot switch it off; silent unless the person is marked unavailable | While the person cannot answer: denies the two tools that ask them, with the step that parks the question; denies Claude Code's own permission prompt and parks the call as an `action`; one note per change at the prompt, and one **block** at the stop of a session that has not heard this away period. The frame's step 5 turns every other hook's ask into a deny the same way (§ While the person is away). |
| `task-start` | SessionStart (every source) | **machine-wide** | One block of the project's open work tasks at a start, a resume, a clear and a compaction: at most eight lines, then `+n more`, with no descriptions; a task untouched for `tasks.staleDays` (default 30) is counted in one line instead; one line about the deploy tasks (open, unreadable, a repeated id or old files; `Deploy tasks open: …`); and one line to run setup while the task server is not registered. `tasks.md` § The hooks and pages that read it. |

Without `cc-smart-dev-kit.json` every one of them is silent — except the machine-wide
ones: `agent-guard` (§ The Agent guard), `job-route` (§ The Bash judge and the job route),
`session-escape-guard` (§ The session-escape guard), `fable-session` (§ The Fable-session
note), `tier-view` (§ The tier note), `task-start`, `keep-going` (§ The keep-going guard),
`builder-finish` (§ A builder's hand-back), `user-away` (§ While the person is away),
`agent-usage` (§ Each subagent's usage on record), and `playwright-output`, which reads no
project file at all. So a project that never opted in sees only Claude Code's own worktrees
and the limits a session may not get around. `job-route` and `session-escape-guard` are also
`alwaysOn`: `ownHooks` cannot switch them off, because they limit what the session itself may
do. `user-away` is the third `alwaysOn` hook, for another reason: the switch is the person's
(§ While the person is away). The former notification hooks are retired (§ The notifier).

### The Agent guard

`agent-guard` (PreToolUse on `Agent`, the older name `Task`, and `Workflow`) is **machine-wide**, like
`update-check`: it runs with or without `.claude/cc-smart-dev-kit.json`, and a broken or too new file
does not change its answer (the frame hands it the input and the environment instead, and its
`outsideGit` and `onConfigProblem` judge on). A project may still silence it through
`ownHooks`, which is read on its own: the list works even when the rest of the file is broken.
It is wired `--missing=ask`: a guard fails closed.

Why the owner asked for it (2026-10-16): an Agent call that names no model runs on the
session's model — on an Opus session, every plain `Explore` is an Opus spawn — an Opus or
Fable agent spends the person's own plan usage, and a subagent at `low` does work nobody chose
to cheapen. So the guard holds the effort rule first — `medium`, `high`, `xhigh` or `max` only,
`ALLOWED_EFFORTS` in the code, `low` refused on every model (D5, D13: `medium` for searches and
reads, `high` for building and reviews, `xhigh` for the hardest judgment, `max` on `haiku` or
`sonnet` when the task wants it, whatever model answers them; the `opus` tier asks at `max`).
**An affordable backend is held to no level** (the owner's decision, 2026-10-26): until then the
guard required `max` of a `haiku` or `sonnet` a backend answered, refused any other
`CLAUDE_CODE_EFFORT_LEVEL` there, and the tier note said "runs at max". Claude picks the effort
by the task on every tier, as it does for Claude `haiku` and `sonnet`; a person who wants a
backend at a fixed effort pins it in the router (D64, `gateway effort`), which overrides what
the request carries — so Claude needs to know nothing about backends and effort. Then the guard
reads the launch's
`model`, `effort`, `subagent_type` and prompt, and resolves the model the launch will really
run on:

1. a family name (`haiku|sonnet|opus|fable`) goes through Claude Code's own override, when
   the person set one (`ANTHROPIC_DEFAULT_<FAMILY>_MODEL`; all four exist on 2.1.301, Fable
   included; `gateway on` writes none since 0.5.0), then — with the gateway on for **this
   session** — the family's slot, the way the router
   picks it (`FAMILY_SLOTS`: haiku → scout, sonnet → worker, opus → opus, fable → fable): its
   chain's first target answers, read from `gateway.json` through the gateway's own
   `loadConfigFile`. A slot with no chain answers as Claude, and the Claude model answers. So `sonnet` is
   an affordable slot exactly when the session is on the gateway and the
   worker's chain starts with a `<backend>:<model>`. **The session's gateway is its own
   effective `ANTHROPIC_BASE_URL`, read from the hook's environment** (`sessionGatewayOf`;
   RF1-2): Claude Code hands a hook the value the session runs with — the project's personal
   file over its team file over the user file, a `--settings` file over all of them
   (`docs/claude-code-contract.md` § Hooks) — so `gateway project off`, a project turned on
   while the machine is off, and `launch --settings` are each judged as the session runs. No
   URL or Anthropic's own address is off; `…/p/<name>` reads that profile's chains
   (`profileView`), and a name the config lacks reads as plain Claude (`plainClaudeView`), as
   the router answers it;
2. a full Claude id goes through its family's slot the same way; a slot key or
   `<backend>:<model>` is resolved as itself (a slot's first target answers); **any other name** (`best`, `opusplan`,
   `default`, `inherit`, a name no rule knows) is resolved the strictest way — the rule for a
   Claude id with no family to read — because only what the guard can prove affordable is
   affordable;
3. a `fork` always inherits: its model is the session's own, read from the tail of the hook
   input's `transcript_path` (`lastClaudeModel`; a
   sidechain line is a subagent's, not the session's), else from `ANTHROPIC_MODEL`; an
   unknown one counts as Claude Opus.

**Before those steps, Claude Code's own overrides decide which name and which effort the launch
really gets** (`effectiveLaunch` in the launch policy; the order proved live on 2.1.306, and in
Claude Code's own docs and code):

| Override | What the launch runs on |
|---|---|
| `CLAUDE_CODE_SUBAGENT_MODEL_FORCE` on (`1`, `true`, `yes` or `on`, the values Claude Code reads as on) | `CLAUDE_CODE_SUBAGENT_MODEL`; unset or `inherit`: the session's own model (step 3's reading; unknown → the `opus` tier). The call's `model` does not count. |
| `CLAUDE_CODE_WORKFLOW_SUBAGENT_MODEL` (not empty, not `inherit`) | its model, for a Workflow `agent()` only; FORCE comes first; an Agent call is not touched |
| neither | the call's own `model`, else its agent definition's frontmatter model. A plain `CLAUDE_CODE_SUBAGENT_MODEL` is only a default after the definition; the guard still refuses an unseen definition or `inherit` without an explicit choice |
| `CLAUDE_CODE_EFFORT_LEVEL` (not empty) | that effort for every launch, whatever the call names |

The definition lookup (`src/models/agent-definition.ts`) matches frontmatter `name`, first in
this checkout's `.claude/agents`, then the user's agents, then a qualified plugin agent from
`installed_plugins.json`. A plugin manifest's `agents` paths replace its default scan. The
higher-priority definition wins as a whole: missing fields never come from a lower one. The
same lookup serves Agent and Workflow `agent()` calls. Effort comes from the call, else that
definition, with `CLAUDE_CODE_EFFORT_LEVEL` above both. Unknown SDK/`--agents` definitions
remain refused. Only fixed built-in model choices are supplied; inherited or conditional
built-ins still need a call choice. The senior engineer can change files, so its Fable launch
needs the `build` reason, not a read-only review reason.

The guard reads them from its own environment. **A settings file's `env` reaches a hook's
environment** (proved live on 2.1.306, for `--settings` and for a project's
`.claude/settings.json`), so that is all it reads — no settings file of its own. **Under FORCE
Claude Code takes `model` off the Agent tool, and under `CLAUDE_CODE_EFFORT_LEVEL` it takes
`effort` off** (proved live: the PreToolUse `tool_input` carries neither). So before 1.0.0
the guard refused every Agent launch there ("names no `model`"); now such a launch is judged on
what the variable sets. Every ask and refusal says which override applied ("This launch runs on
`haiku` because `CLAUDE_CODE_SUBAGENT_MODEL_FORCE` is set …"), and the record names the model
the launch really runs on. One refusal rests on the variable alone, and only the person can
change it, so the message says where it is set: a `CLAUDE_CODE_EFFORT_LEVEL` no subagent may run
at (`low`, or a level no rule knows). (Until 2026-10-26 a second held: anything but `max` while
an affordable slot answered. The owner dropped it.)
`auto` (`EFFORT_AUTO`: the model picks its own default) is the person's own choice, like a
fork's inherited effort: it is never refused for itself, and since no model's default is `max`,
the `opus` tier runs it with no question (recorded as `opus:auto`); Sonnet, Haiku and an
affordable slot run it, and the `fable` tier keeps its reason-line rules. Refusing it would lock
out every launch, the same way the missing `effort` once did. A fork keeps its rule: the session's model, and the effort it names,
else the session's own. Two readings are the stricter one on purpose: under FORCE alone the
built-in Explore agent runs on its own listed model (Opus where the session runs Fable), but a
person's own agent named `Explore` runs on the session's, and a hook cannot tell them apart, so
both read as the session's model. One case is not covered: Claude Code's code (2.1.306) still
reads `CLAUDE_CODE_WORKFLOW_SUBAGENT_MODEL` under FORCE when an admin's managed settings set it,
and the guard reads no managed settings, so it judges FORCE's model there.

A **Workflow** tool call is judged too: its `agent(...)` launches run inside the tool and pass
no hook of their own (proved live on 2.1.301 — a project hook with the matcher
`Agent|Task|Workflow` saw the `Workflow` call and nothing else), so the guard reads the
script's text: the `model`, `effort` and `agentType` of each call, and its prompt when that
is a fixed string literal (`readWorkflowScript` — a template that builds its text, `` `${…}` ``,
is not one, and neither is a literal an operator changes, `effort: "high" && "max"` or
`"a" + b`). An option counts only as a key of the call's own options object, quoted or not
— never the same words in the prompt or in a nested object (`schema: { effort: … }`). A
`model` held in a variable is refused rather than guessed, and a prompt built at run time is
refused for a Fable launch (its reason line cannot be read). Two things are refused for the
whole call (`workflowRefusal`), because no rule can hold for a launch the guard cannot follow:
`agent` or `workflow` mentioned without a direct call (`const run = agent; run(…)`,
`agent?.(…)`, either passed around), and a call whose options are built at run time (a
`...spread`, a computed `[…]` key, the same key twice). The strictest launch of the call
answers for the whole call. A launch with no readable `model` is judged, not refused, when
FORCE or `CLAUDE_CODE_WORKFLOW_SUBAGENT_MODEL` names the model it runs on.

**Which script a Workflow call runs** (G2; `judgeWorkflowCall`, the files in
`src/hooks/agent-guard-workflows.ts`). Proved live on 2.1.306, the call's PreToolUse input holds
one of four shapes — `{"script": …}` inline, `{"name":"probe"}` for a saved workflow,
`{"scriptPath":"<path>"}` for a path run, `{"name":"<plugin>:<meta.name>"}` for a plugin's —
and the guard finds the script the way Claude Code's own code (2.1.306) does:

| The call names | The script the guard reads |
|---|---|
| `script` | that text — it runs whatever else the call names |
| `scriptPath` | that file, relative to the input's `cwd`; one over 524288 bytes is refused, as Claude Code refuses it |
| a bare `name` | the `.js` file whose `meta.name` is that name — the file's own name plays no part — in `.claude/workflows/`, from the `cwd` up to the repo root (never the home folder itself), then in the user's `<config>/workflows/`; the nearest folder wins, the project's over the user's |
| `<plugin>:<name>` | the file whose `meta.name` is `<name>` in that plugin's `workflows/` folder, or in the paths its manifest's `workflows` lists instead; the plugin's folder is `CLAUDE_PLUGIN_ROOT` for this plugin, else its install in Claude Code's `installed_plugins.json` (a `project` or `local` install whose folder holds the `cwd`, the deepest first, before the `user` one) |

`meta` is read the way Claude Code reads it: `export const meta = { … }` as the first statement,
a pure literal (no variable, no `${…}`, no spread, no computed key, no method), with a non-empty
`name` and `description`; a file without one is no workflow. Each nested `workflow("<name>")`
or `workflow({ scriptPath: "…" })` in the script is found the same way and judged with it, one
level deep as Claude Code runs them; a nested workflow named at run time, or a nested script
that nests again, refuses the whole call. **Two files in one folder that claim one
`meta.name`** with different texts: Claude Code keeps the one its folder listing gives last,
an order the guard cannot know, so the guard treats the name as unreadable (two copies of one
text are one script). A run the guard cannot read — a built-in workflow (`deep-research`: its
script is inside Claude Code), a missing file, those two files, a `resumeFromRunId` (the run
goes on from a script the guard does not see), a call that names none of the three — **asks**,
naming why, and is **denied in `claude -p`**, where nobody can answer. Known limits: a script
that changes between the guard's read and the run is judged as it was read; an override that
does not parse (Claude Code then keeps the farther copy) is judged as written; and a launch in
a loop is one launch to the record.

The rules are in one table in `src/hooks/agent-guard.ts` (its header). The policy under them —
which model a launch really runs on (`resolveLaunchModel`), the effort levels
(`ALLOWED_EFFORTS`), the Fable reason words and the UI rule — is one pure module,
`src/models/launch-policy.ts`, which the guard imports and the tier note shares; the Bash
judge asks the guard's own `judgeLaunch`. The guard keeps the hook's own parts (reading a
Workflow script, the agent types, the record, the messages). The one list a person
may extend is an environment variable (`CC_SMART_DEV_KIT_AGENT_GUARD_READ_ONLY_AGENTS`, the
read-only agent types the Fable rule reads; a name there matches by the part after any
`plugin:`), and the answer is a PreToolUse `deny` (the rule, in
words, to Claude) or an `ask` (a Fable launch, and an `opus`-tier launch at effort `max`; the
person approves each one, and the opus-tier ask rests on the effort, not on a prompt).

**The `opus` tier** (the owner's decision D11, 2026-10-17) is judged by its effort alone: at
`high` or `xhigh` it runs with no question, for any agent type and any purpose — a review or a
build, with or without a reason line — and at `max` (`OPUS_ASK_EFFORT`) it asks the person,
naming the model and the effort. An `Opus reason: <word>` line is optional: when a prompt has
one, its first word goes into the record, and nothing else reads it. A fork names no effort —
it runs at the session's own, which the person chose — so an `opus`-tier fork is allowed; a
fork that names `max` itself is held to the same rule. **The free path is for a reading the
guard can prove is the Opus family**: the `opus` name, a Claude Opus id (a cloud provider's
`us.anthropic.claude-opus-…` too), the opus slot, or an id the person's own
`ANTHROPIC_DEFAULT_<FAMILY>_MODEL` names for it. A reading with no family — a name no rule
knows (`best`, `inherit`, an id the guard cannot read) — may stand for a higher tier, so it
asks at any effort, is refused in `claude -p`, and is recorded as `opus:unreadable`. (Before D11 the tier needed a review
agent type or a listed reason word, and refused every launch but a review at `high`; that
reason list, the review-agent list and its variable are gone.)

**UI/UX work** (the owner's decision D50, 2026-10-22) is the one case where a prompt line decides:
`Opus reason: ui` or `Fable reason: ui-design` declares it, and `UI_POLICY` in the same pure
module holds the rule — the tiers `opus` and `fable`, and the lowest effort `high` — one home, so
lifting the rule is one change when a cheap open-source model proves good at UI/UX. A declared
launch is denied on Sonnet, Haiku or an affordable slot, and below `high`, before any rule below
would allow it; the denial names the allowed models and efforts. The prompt is never sniffed for
keywords: a prompt that merely talks about a page or a layout is left alone, because a false
positive would block real work. Checking is not design: the `ui-verifier` may run on `sonnet`,
and the design verdict is made on `opus` or `fable` (`/cc-smart-dev-kit:ui-verify`).

An `ask` in a session nobody watches (`claude -p`, `CLAUDE_CODE_SESSION_ATTENDED=0`) is refused
just like a deny — Claude Code cannot ask anyone there (proved live on 2.1.301) — so the guard
answers that denial with a message that says why and the fix the session can take; an
Opus-family launch below `max` needs no answer, so it stays allowed there, one at `max` is told
to run at `medium`, `high` or `xhigh`, or in an interactive session, and one with no family is
told to name `opus`. Every premium launch is
recorded once it is known to run — an allowed one on PreToolUse, an asked one on PostToolUse
(`RAN_EVENT`: the call ran, so the person said yes; one they refuse is never recorded) — once
per `tool_use_id` and launch index (a Workflow's launches all share its one `tool_use_id`, so
each is its own line, under its index), in
`<stateDir>/agent-launches.jsonl`. Each line carries the `effort` it really ran at and the
reason `word` as their own fields, and keeps `reason`, why it ran as one string, for a reader
that knows only that — the `opus` tier as `opus:<effort>`, with the prompt's reason word after
it when there is one (`opus:xhigh`, `opus:max:security`; a fork `opus:session-effort`), and the
`fable` tier by its word (`fable:build` for a builder the person asked for). An older line with
only `reason` is taken apart once, when it is read (`reasonParts`). `cc-smart-dev-kit usage`
lists them (count, by effort, by word) — the transcripts say which model wrote a reply, never
why it was allowed. A Workflow call denied as a whole records none of its launches: nothing in
it ran; an `ask` names every launch of the script that asks, not only the first.

**Tiers, not vendors** (the owner). `LaunchModel.tier` is what the rules go by:
`opus` and `fable` mean the tier whatever answers behind them — a family name keeps its tier
through `ANTHROPIC_DEFAULT_<FAMILY>_MODEL` and through its family's slot, a Claude id has its
family's, and a name the guard cannot read is the `opus` tier, the strict reading. So an
override that points `opus` at a backend never becomes an affordable slot, and still asks at
`max`; the messages name both, `` `opus` (answered by
openai:gpt-5.5) ``.

**The agent definition.** The guard judges the call's model and effort, else the ones the
agent's definition names (`src/models/agent-definition.ts`). It reads a definition only when
the call names an agent and leaves `model` or `effort` to it; a fork, and a `claude -p` run
the Bash judge reads (`PRINT_RUN`), never read one, and a print run's denial says it has none.
The lookup reads the managed
agents folder first, then the project's folders from the input's real cwd (symlinks
resolved) up to the checkout root, closest first, then the user's agents. A cwd whose real
folder is outside the checkout scans the checkout root alone. A qualified plugin name skips
those scans. A plugin's `plugin:x` is the file `agents/x.md` at the top of that folder, or a
file the plugin's manifest lists; a file in a subfolder registers under another name. A
project-scope install of the plugin matches when the cwd as given, or its real folder, is
inside the install's project. A local definition needs a valid name and a string description. Each name is
read once per hook run, and only its frontmatter is read. Symlinked files and folders are
followed without loops, at most 8 folders deep and 2000 files and folders per lookup
(`AGENT_SCAN_MAX_DEPTH`, `AGENT_SCAN_MAX_ENTRIES`). Past a cap, a failed checkout lookup, or a
cwd that cannot be resolved, the whole definition is unknown: the launch needs its own
`model` and `effort`. The managed folder is `CliPaths.managedAgentsDir`, from the machine's
own platform: no variable moves it, since a project's settings `env` reaches a hook and must
not hide the managed definitions. A test names a temp folder there.

**A parser reads every script** (`src/hooks/workflow-script.ts`, with acorn, a JavaScript
parser; approved by the owner on 2026-11-05). It parses the script the way Claude Code runs it
(read from the 2.1.318 binary, not proved live; `docs/claude-code-contract.md`): the body of an
async function under `'use strict'`, in script mode, with top-level `await` and `return`; the
`export` of a first-statement `export const meta = { … }` is left out, since Claude Code reads
`meta` on its own (`metaExportAt`). From the syntax tree it finds every direct `agent(…)` and
`workflow(…)` call, what each call's options show, and every other use of either name: one
reader, so no two checks can disagree on what is code. A parser leaves nothing to guess: a `/`
is a division or a regular expression by the grammar, and a line comment ends at `\r`, U+2028
and U+2029 as well as `\n`. A hand-written lexer got each of these wrong once, and each could
hide a launch. A name that is not a use of the function is not one: a property (`x.agent`), an
object key (`{ agent: … }`), a class member, a label. A script that does not parse is refused
whole, naming the parser's message and line; so is the little a function body allows and a
script's top level does not (`new.target`). An HTML-like comment (`<!--`, or `-->` at a line's
start) is refused too: a script reads it as a comment and a module as code
(`a <!--b, agent(…)`), so the guard judges neither reading. **A route around the names is
refused too.** `agent`, `workflow`, `parallel` and `pipeline` are globals of the script's `vm`
context, so another name can reach them (`globalThis.agent`, `this.agent` at the top,
`const { agent: a } = globalThis`), and code built at run time can reach them with none
(`eval`, `Function`, a function's `.constructor`, `import()`). So each of `eval`, `Function`,
`arguments`, `globalThis`, `global`, `self`, a `this` outside a non-arrow function, `import(…)`
and a `constructor` member refuses the whole script, naming what and where; `self` and `global`
are refused even as a name the script declares itself (no scope is tracked). **A limit the
guard does not close:** a string key, literal or built at run time, still reaches the
`Function` constructor (`x[k]`, `Reflect.get(() => {}, "constructor")`,
`Object.getOwnPropertyDescriptor(Object.getPrototypeOf(f), "constructor").value`), and the
guard does not refuse it, since ordinary code is full of computed keys. What stops that code
from turning a string into a launch is Claude Code's own `codeGeneration: { strings: false }`
on the script's `vm` context, not the guard: proved on standalone Bun 1.4.4, read from the
2.1.318 binary, not proved inside Claude Code, and re-checked on every upgrade
(`docs/claude-code-contract.md`). The guard does not see every launch: it sees each direct
`agent(…)` call, and refuses the routes it knows. Every hook bundle carries the guard's code through the hook
table (`specs.ts`), so acorn is handed in by the agent guard's own entry
(`src/hooks/script-parser.ts`): it is in `agent-guard.js` alone, and a program that was never
handed the parser refuses every script.

In a Workflow script, a definition stands in only for options written as one plain object
literal of `key: value` pairs. Options that are not (a getter, a method, a shorthand key,
`__proto__`, a ternary, a second object) can set the model or the effort where the guard never
sees them. Such a launch is denied before any definition is read, unless Claude Code's own
overrides name both its model and its effort. A policy option that is present but not a string
literal is denied before the lookup too.

The Fable rules are the owner's of 2026-10-16, and each is the person's call:

- **A read-only agent** (`Plan`, `Explore`, `cc-smart-dev-kit:auditor`,
  `cc-smart-dev-kit:edge-case-hunter`, `cc-smart-dev-kit:researcher`; `READ_ONLY_AGENTS`,
  matched by the whole name as written, so another plugin's or a project's `researcher` is
  not one; a bare `Plan` or `Explore` counts only while Claude Code's built-in answers that
  name, since a managed, project or user file of that name overrides it) takes any word of
  `FABLE_REASONS` — `hard`, `rewrite`, `ui-design`, `architecture`, `review`, `plan`,
  `unsatisfied` — where `unsatisfied` is a fresh attempt after the person did not like the main
  session's answer (`subagent-decision` § Choosing Fable has the brief it gets) and `review` is
  a second opinion on a hard or high-stakes change the session may run on Fable by its own
  judgment (`review` § Second opinion has the conditions).
- **An agent that can change files** — any other type, a fork included — takes the one word
  `build`: the person asked for Fable to build it, and approves that launch. Every other word,
  and no line at all, is denied with the line it needs (`FABLE_BUILD_REASON`, which is not one
  of the read-only words). A fork of a session whose own model is the `fable` tier is judged the
  same way, so such a session can fork with `Fable reason: build - …` and is not refused
  outright.

### Each subagent's usage on record

`agent-usage` (SubagentStop) is **machine-wide**, like the Agent guard's launch record and for
the same reason: what a subagent's replies cost is the person's own spend, not a project's
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

### The keep-going guard

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

### The session-escape guard

`session-escape-guard` (PreToolUse on `Bash`, `PowerShell`, `Edit`, `Write` and `NotebookEdit`)
stops a session from loosening the limits the person set for it. `src/hooks/session-escape-guard.ts`
is the whole of it. It is **machine-wide** like `agent-guard` (it runs with or without
`.claude/cc-smart-dev-kit.json`, in a folder outside git, and when the file is broken or too new)
and **`alwaysOn`**: `ownHooks` cannot silence it and does not accept its name, because the
project's file is one of the things it guards — a session could otherwise list the guard there
first. It is wired `--missing=ask` with `"onFailure": "block"`, and a crash of its own asks about
the calls in its domain (§ One frame for every hook).

| The call | The answer | Why |
|---|---|---|
| A line that runs `cc-smart-dev-kit workflow review-done` | **deny** | A review is recorded by the review-record hook when a review agent returns. A session never records its own. |
| A line that runs a kit command (the launcher, or `bun …/dist/cli.js` / `portal.js`) with `CLAUDECODE` removed | **deny** | The kit's commands that change this machine's settings (the workflow gate, the portal, updates) refuse to run while Claude Code's `CLAUDECODE` is set — a courtesy a command can drop. This is the lock. |
| A line that reaches the portal's port (20150) on this machine | **ask** | The portal has no sign-in of its own (D9): its pages change the gateway, the judge, updates and the review gate. |
| An Edit, Write or NotebookEdit of a `.claude/cc-smart-dev-kit.json`, the kit's settings folder (`workflow.json`, `gateway.json`), its state folder (the review record, the ask log) or its installed plugin folder (`plugins/cache/<marketplace>/<plugin>`) | **ask** | They hold the limits the guards enforce: the project's gate and `ownHooks`, the person's own policy, the record of what was reviewed, and the guard bundles Claude Code runs. |

**How `CLAUDECODE` counts as removed.** The shell reader (`src/shell/command.ts`) gives each
command of the line, its wrappers (`setsid env …`, `flock <file> env …`, `script -c …`,
`busybox sh -c …`), and the lines it runs (`bash -c`, `eval`, a here-string,
`cc-smart-dev-kit job run --`, `ssh host '…'`). A wrapper is read as itself first and the kit's
`job run` inside it one level deeper; a wrapper that finds no command of its own (`sh
<launcher> job run -- …`, `su root <launcher> …`, `cmd` with no `/c`, `pwsh` with no
`-Command`, or a PowerShell `-c` that comes after the kit's `job run` and so belongs to it) is
read as the kit's job, in the wrapper's dialect. `cmd` is the exception: it runs what follows
its first `/c` or `/k` wherever that stands, so the words after it are read. It also reads the commands its **runners** run: `find`'s
`-exec`/`-execdir`/`-ok`/`-okdir` (every action, up to its `;` or a `+` right after `{}`; the
value of a test such as `-name` starts none), `watch`'s command (`-x` or through `sh -c`; `-d`
takes its value only attached), `su -c`/`--command`/`--session-command` (wherever the user
stands, also after `--`) and `parallel`'s command (after its options, an unknown option read
both ways; its `:::` arguments are added to the command, quoted, or put at its `{}`, and with no
command they are the commands), read in `nestedCommand` beside `bash -c` so every guard that
walks the nesting — the git guard, the merge guard, the issue-write reader, `job-route`, the
session-escape guard — sees the inner program (`xargs` is a wrapper). A `{}` as the program is
a computed one. The runners are `RUNNER_PROGRAM_NAMES`, and the merge reader's own table keys
on the same names (a test keeps the two equal). On one command: `CLAUDECODE=…` before it, `env -u
CLAUDECODE`, `env --unset`, `env -i` (and `env -`), `sudo`/`doas`/`su`/`runuser`/`ssh`/`systemd-run`
(a fresh environment). For the commands after it in the same line: `unset CLAUDECODE`, `export
CLAUDECODE=…`, `export -n`, `declare +x`, a step that is only `CLAUDECODE=`, and in PowerShell any
write to `$env:CLAUDECODE` (`Remove-Item Env:CLAUDECODE`, `SetEnvironmentVariable`; the whole
line counts, because PowerShell's lexer cuts at braces). A kit command is also found as an
argument of a runner (`find -exec`, `watch`, `parallel`), **and the words before the kit word
inside that runner's arguments count too** — `find … -exec env -u CLAUDECODE <kit> …`, `flock
<file> env -u CLAUDECODE <kit> …` — except after programs that only read their arguments (`ls`,
`grep`, `git`, `echo`…), so `env -u CLAUDECODE claude -p` and `env -u
CLAUDECODE bun test` — the usual way to start a nested session — are not touched. PowerShell's
`Start-Process` is read by its `-FilePath`/`-ArgumentList` (or the positional words), and
`-UseNewEnvironment` starts the command with a fresh environment, the same as `sudo`. Claude Code's
Bash tool keeps no `export` or `unset` from one call to the next (seen live 2026-10-22: an
`unset CLAUDECODE` in one call, `CLAUDECODE=1` again in the next), so a line is the unit. A
program the line works out when it runs (`$(which <kit>)`, `$KIT`) cannot be named: when the
line names the kit command, the guard **asks** instead of staying silent. **A path that only
passes through a folder of that name (`…/cc-smart-dev-kit/src/x.test.ts`) names no command**;
a launcher the line names by its path (`/…/bin/cc-smart-dev-kit`, `cc-smart-dev-kit.cmd`), an
assignment that binds it to a variable, a substitution that runs it, and a bundle among the
computed program's own words each still ask.

**How an edit is matched.** The path the call names is taken as written and as a real path (an
Edit follows a link, so `notes.txt` linking to `workflow.json` changes `workflow.json`);
either one that is a `.claude/cc-smart-dev-kit.json` (any folder: the main checkout, a worktree
inside `.claude/worktrees/`, a folder outside git), or inside the settings or state folder
(`cliPaths()`, so `CLAUDE_CONFIG_DIR` moves the state folder with it) or the installed plugin
folder, asks. **Each folder is compared as written and by its real path**, so a home folder whose
`~/.config` is a link cannot hide the file. Names compare without case.

**How a shell write is matched.** A Bash or PowerShell line that writes those same files asks,
with the Edit's reason: a redirect (`>`, `>>`, `>|`, `&>`; `2>&1` and `>&2` name no file; the
reader's `redirectionTargets` gives the targets), `tee` (and `Tee-Object`), `sed -i` / `perl -i`,
`cp` / `mv` / `install` / `ln` (`-t` and `--target-directory` included) and PowerShell's
`Copy-Item` / `Move-Item` (`-Destination`, or the last word), `dd of=`, `Set-Content`,
`Add-Content`, `Out-File` (`sc`, `ac`, `si`, `ni`, … — PowerShell takes any prefix of a
parameter name). Every target goes through the same `kitFileKind` as an Edit, as written (the
`~`, a relative path against the input's `cwd` and against each `cd` / `Set-Location` /
`Push-Location` the line ran before it) and as a real path, with each folder compared as written
and by its real path. **On Windows the Bash tool is Git Bash**, so a line may name a native file
in MSYS2's own form (`/c/Users/…` for `C:/Users/…`): the target is read as the drive it names
before the comparison (`shellTargetPath`, on Windows and for a Bash line only; PowerShell runs
natively), beside the Win32 forms Git Bash also accepts (`C:/…`, and a quoted `"C:\…"`, where
Bash keeps the backslashes). A write into the installed plugin folder asks too (never a deny: a
person may mean it before an update), and Claude Code's own `claude plugin …` commands are not
touched.
A target the line works out when it
runs (`> $FILE`, `$(mktemp)`, a glob) cannot be resolved: it asks only when the line also names
a protected file or folder by text (`cc-smart-dev-kit.json`, `.config/cc-smart-dev-kit`, the
state folder, the plugin cache folder), and passes otherwise. `cat`, `grep`, `sed` without `-i`,
`cp` *from* the file and a message that names it all pass.

**What it does not read.** The limit is the one the review gate has: it stops mistakes and the
easy shortcut, not a same-user process set on getting past it. A script file's content (`env -u
CLAUDECODE sh run.sh`), a program or port named at run time (`curl localhost:$PORT`), a portal
started with another `--port`, a hostname that resolves to this machine, and a file written by a
program the guard does not know (`python -c "open(…,'w')"`, `rsync`, `truncate`) are not read.
The portal check reads the text of the whole command, so a script in a here-doc that connects
counts — and so does a commit message that only mentions the address: one extra question, not a
miss.

### While the person is away

`cc-smart-dev-kit user unavailable` marks the person as unable to answer — asleep, in a meeting,
on a phone; the owner's pair of words, 2026-10-25 — and `user available` ends it. A session that
stops to ask, or waits on a permission prompt, only stops: nobody reads the question for hours,
and waiting leaves ready phases unstarted. So while the person is away the hooks
hold the line, and the sessions **park** what needs the person on a list instead
(`/cc-smart-dev-kit:user-unavailable`); `/cc-smart-dev-kit:user-available` goes through it when
they are back.

**The state, one home** (`src/user-away/state.ts`). One file, `<stateDir>/user-away/state.json`
(the kit's state folder: the machine's `~/.claude/cc-smart-dev-kit/` unless Claude Code runs on
another `CLAUDE_CONFIG_DIR`, whose sessions then need their own `user unavailable`), mode 0600,
written whole through the kit's atomic write, under the folder's **own** lock (not setup's: a
hook that parks must never wait for a setup run) so two sessions that park at once both keep
their item; a reader takes no lock. It holds `unavailable`, `since`, `until`, the `items`,
`nextId` (an id is never reused), `said` (the note each session heard at a prompt, or by
`user unavailable` itself) and `stopSaid` (the note it heard by the Stop block). `until` is a note
only: it shows in the notes and never switches back. An item has a kind — `question` (with its
options and the recommended one), `action` (with its exact command) or `decision` (what was
chosen, why, how to undo it) — the session that parked it, its folder and the time. The same
kind with the same command (or, with none, the same words) **in the same folder** parks once: a
retry from one session is one item, while the same `git push` from two worktrees is two actions
(a yes runs an action in its own `cwd` only). The session is not part of the key. The list
holds 500 items and `said` 100 sessions. **A file that cannot be read is an `AwayStateError`,
never "available"**: a reader that cannot tell must not guess in the loose direction. A parked
command is kept **exactly**, as the session's own transcript already holds it — masking would
break "a later yes can run it" — and one over 16,000 characters is cut, and the item says so.
Only a guard's own reason text goes through `maskedLine`. The command
(`src/user-away/command.ts`) is `unavailable [--until]`, `available`, `status`, `park`, `list`
and `clear`; `available` keeps the list.

**Whose an item is** (`src/user-away/whose.ts`, 1.11.1). The list is the machine's, but the
person brings each session back on its own, and two sessions that each went through every item
asked the person each other's questions. So `user list --json` gives each item `whose`, judged
for the session that runs it (`CLAUDE_CODE_SESSION_ID`), and `/cc-smart-dev-kit:user-available`
goes through its own items only:

- `this session`: it parked the item; or no running session owns it and it was parked in this
  session's project (a session that ended, or this one before a `/clear`; the project is the
  work store's key, `folderProject`, read from the nearest folder that is still there).
- `another session`: a running session owns it (Claude Code's session records, `liveSessions`),
  and `waitsIn` names it and its folder. The skill names it in one line and never asks about it,
  runs it or clears it.
- `no session`: no running session owns it, and it was parked in another project. The skill asks
  once whether to take those here.

A fact it cannot read never makes an item this session's: session records it cannot read keep
another session's item there, and a project it cannot tell (git did not answer, or had no time
left) is another project. `user available` and the hook's "available again" note count the same
way: how many items are this session's, and how many wait in which other session. The note's git
calls share the hook's budget (`SHORT_GUARD_BUDGET_MS`). The person's own terminal has no
session, so only the running owners and its folder's project decide there.

**Five answers, one hook (`src/hooks/user-away.ts`), never looser than before.** Each is a deny
where there was a question, or a note, never an allow.

- **PreToolUse on `AskUserQuestion` and `ExitPlanMode`:** denied, with the step that parks the
  question. Nothing is parked by the hook: the session parks it in its own words, or takes the
  choice and parks a `decision`. A plan waiting for approval is the same wait as a question.
- **`PermissionRequest`, Claude Code's own prompt** (a hook event of 2.1.310; its decision is
  `{"behavior":"deny","message":…}`, `docs/claude-code-contract.md` § Hooks): denied with the
  step, and the call parked as an `action` with its exact command. This is the answer for every
  prompt Claude Code raises itself. It should also catch the prompt that follows a project's own
  copy of a guard (`ownHooks`), which the frame never runs — **not proved**: the contract row
  proves Claude Code's own prompt on `claude -p`, nothing about an own copy. A call that is no
  shell command keeps its target and a short, masked piece of its other arguments in the item's
  words (`WebFetch <url> {"prompt":…}`, `Edit <file> {"old_string":…}`), so two prompts of one tool
  at different targets are two items, and a session denied the same call again is told the
  same number. A shell call is its `command`, kept whole. **One exception, so the person can
  come back:** a shell call that is nothing but the kit's own `user available`, `user status`
  (with or without `--json`) or `user list` (the same) gets silence (`isStateCommand`), and
  Claude Code's own prompt goes to the person, who is back and answers it. Without it the
  skill's own calls would be parked and denied in the default permission mode, and the one
  command that ends the state could never run. The line is read with the one shell reader and
  the one kit-command reader (`kitArguments` is not used for this: it leans toward yes for
  guards and would read `bash -c '…' cc-smart-dev-kit user available` as the kit's; here the
  program must be the kit's own command by name); a second command, a substitution, a
  redirection, a prefix, a computed program, another program or any other argument is parked as
  before, so nothing gets looser. **The trade-off:** the hook cannot tell the returning person's
  run from a session's own `user status` or `user list` while the person is away, so such a call
  waits for Claude Code's prompt; the `user-unavailable` skill tells a session not to run them
  (the hook's note carries the state and the count). When a session still cannot run it, the
  person types `! cc-smart-dev-kit user available` in the session
  (`/cc-smart-dev-kit:user-available` says so).
- **A kit guard that would ask** — the frame's step 5, for every hook, so a new guard needs
  nothing: the ask becomes a deny that keeps the guard's own words and adds "parked as #N", and
  the call is parked as an `action`. A deny, an allow and silence pass through unchanged. A park
  that fails (a full list, a lock held too long) still denies, and the deny says to park by hand:
  the person is away, so the call must not wait. **The park fits inside the hook's time:** it
  waits at most `PARK_WAIT_MS` (1 s) for the lock, half of `BUDGET_MARGIN_MS`, the time a guard
  keeps back for its answer. For a guard that runs on a budget (the merge guard 25 s of its 30 s,
  `job-route`'s `workflow propose` question and `after-merge`, `src/hooks/budget.ts`) the last
  child ends by 6 s of 10 s, or 23 s of 30 s, so the park ends well inside the hook's `timeout`.
  A guard with no budget (`git-guard`, `main-folder-guard`, and the frame's own
  project lookup, each with 5 s git calls) was never held to a shared deadline: the short wait
  does not fix that, it only stops the park from adding 5 s. The command `user park` still waits
  5 s (`AWAY_LOCK_WAIT_MS`). A hook the host kills answers nothing, and `onFailure: block` then
  blocks the call with no word to the session. `user-away`'s own crash-ask is not converted.
- **`UserPromptSubmit`, the note:** one short line to Claude — "the person is unavailable since
  …: follow `/cc-smart-dev-kit:user-unavailable`", with the expected return and how many items
  wait — **said once per change** (`since|until|count`, per session, in `said`), never at every
  prompt. **The person's own prompt does not switch the state back** (it may be one line from a
  phone): a bare prompt gets its own note, every time, that it is still on and how many items
  wait, and `/cc-smart-dev-kit:user-available` goes through them. An automated turn
  (`prompt-source.ts`: a monitor's line, another session's message) is never the person's. A
  session that heard "unavailable" is told once when the person is available again.
- **`Stop`, the note at turn end** (2.2.0): a session that works on its own gets no prompt from
  the person, so it never heard the switch and could end its turn on a question in prose that
  nobody reads. Its stop is **blocked once** (`decision: "block"`), with the same note and a
  line to park what needs the person (`user park`) and go on, or end the turn if nothing is
  left. **The decision reads nothing written during a Stop** (`awayStopBlock`,
  `src/hooks/user-away-stop.ts`, one home), because Claude Code runs an event's hooks in
  parallel. **Never on a stop a Stop hook continued**
  (`stop_hook_active`, an input field): a belt against a loop, so even if
  Claude Code stored the feedback in another shape, a session is blocked at most once per chain
  of continued stops, never up to Claude Code's cap of 9; the cost is that a stop another hook
  continued does not carry the note, and the next stop no hook continued does. Otherwise it
  blocks when all three hold: the state is unavailable; the session's `said` mark does not cover
  **this away period** (`since|until`; only the prompt note and `user unavailable` write `said`);
  and the transcript's tail holds no `user-away` Stop feedback for this period. The block's
  reason ends with the period's tag (`[away period <since>|<until>]`), Claude Code writes the
  reason as `Stop hook feedback:` after every Stop hook has answered, and `stopFeedbackIn`
  (`src/hooks/transcript.ts`, the reader `keep-going` uses, on one read of the tail) finds it at
  the later stops (`docs/claude-code-contract.md` § Hooks: both claims are owed a live proof). A
  count change alone is no block: a session's own park (the skill's `Summary:` at the end of a
  stretch) changes the count, and that turn must be able to end; the next prompt says it. **The
  Stop answer's own mark is `stopSaid`**, written during the Stop and never read by the
  decision: only the prompt note reads it, and only until `said` covers the period, so a prompt
  after the block does not say the first note again (and writes `said`, so later stops need no
  transcript read), while a count that changes and comes back later is said as any change. A
  `stopSaid` that cannot be written (rare: a lock wait past its limit) keeps the block, with one
  stderr line; the next prompt then says the note once more, and if the person is back before
  any prompt, "available again" is not said at it. `forgetSaid` covers both marks, so a session
  told only at its stop still hears "available again" at its next prompt. **Available: never a
  block.** No `session_id`, no transcript or one it cannot read: no block — it could not see its
  own earlier block, and a block it cannot see would come back at every stop. Costs: while the
  person is away and `said` does not cover the period, each stop reads the transcript's last
  512 KB; a session that no prompt reaches for longer than that tail after its block is blocked
  once more, as `keep-going` would be. `claude -p` is treated like any session, as `keep-going`
  and `verify-gate` are; it hears the note at its first prompt anyway. A subagent never hears it
  here (`SubagentStop` is not wired): it never asks the person.

  **The session that switches the state is told already.** `user unavailable` marks the session
  that runs it (`CLAUDE_CODE_SESSION_ID`, which Claude Code sets in a Bash call's environment,
  `docs/claude-code-contract.md` § Hooks) as told for the new period, through the same
  `sayOnce` and key (`saidKey`), so the session that followed the skill is not blocked at its
  own turn end. The person's own terminal has no session id and marks nothing. A mark that
  cannot be written is one warning line; that session is then blocked once, as any other. **A
  subagent's Bash call carries its lead session's id** (seen on 2.1.318), so a subagent that ran
  `user unavailable` would mark its lead as told; the skill is the lead's, and no brief asks a
  subagent to run it.

**Machine-wide and `alwaysOn`.** The person is one for the whole machine, so the hook reads the
state file and never the project's: a broken or too new `cc-smart-dev-kit.json`, and a folder
outside git, are judged the same way. `ownHooks` cannot switch it off — the switch is the
person's, and a project must not turn it off for a session — so it is not in `PLUGIN_HOOK_NAMES`
and `.claude/cc-smart-dev-kit.json` needs no new field. A crash asks about the two question
tools like any guard; on the other events (a prompt, a permission prompt, a stop) it says one
line on stderr and the session goes on.

**A state it cannot read changes nothing.** The hook says one line on stderr and the answer is
what it would have been without this feature: the question or the ask goes to the person as it
always did.

**What it cannot reach.** A project's own copy of a guard (`ownHooks`) answers in Claude Code
directly: only the prompt Claude Code then raises is caught, by the `PermissionRequest` answer.
**An MCP server's elicitation dialog** (a server asking the person for input mid-call) is
reached by neither event: Claude Code has its own `Elicitation` hook event for it, apart from
`PermissionRequest` (read from the 2.1.310 binary: "Fired when an MCP server requests user input.
Hooks can auto-respond (accept/decline) instead of showing the dialog" — read only, not proved
live), and `user-away` wires neither. While the person is away, such a dialog waits for them like
any other. **A call two guards judge differently** (one
denies, one asks — a `workflow review-done` `session-escape-guard` denies, with a force-push
`git-guard` asks about, in one line) is parked by the asking guard's own process, which cannot see the other's deny: the
list may hold a line a guard refuses. A yes to it runs the line again, through the same
hooks, so the deny holds and nothing gets through; the item shows the exact line.
The shim's `--missing=ask` (no bun at all) cannot read any state, so there the ask goes to the
person. A session that started before the update carries an older plugin version with none of this
(no step 5, no `PermissionRequest` entry), and `user unavailable` still succeeds for it: restart it.
In Claude Code's default permission mode a session's own `user park` call is a command that asks, so
it is denied and parked like any other; the person allows `Bash(cc-smart-dev-kit user park:*)`
once (the hook cannot allow it: it answers only with a deny). `PermissionRequest` is proved live on `claude -p` only — an interactive and a `--bg`
session are owed — and `AskUserQuestion` does not exist in `claude -p`, so its PreToolUse deny is
proved by the hook's tests alone. **It stops mistakes, not a session set on getting past it:**
`user available` is the person's command, run through `/cc-smart-dev-kit:user-available`, and
a session that runs it itself lifts the line. No hook can tell the two apart, so the skill says
never, the way the review gate does (§ The review record in `workflow.md`).

### The Fable-session note

`fable-session` (SessionStart, PostModelSwitch, Stop) is machine-wide like `agent-guard`. It says
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
  than repeat itself. It was chosen over the Agent guard's `PreToolUse`: that answer comes after
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
- **Machine-wide**, like `agent-guard`: no project file, a folder outside git and `claude -p`
  all get it. Never a question, never a block. Not covered: Claude Code's own overrides of the
  subagent model or effort (`CLAUDE_CODE_SUBAGENT_MODEL_FORCE`, `CLAUDE_CODE_EFFORT_LEVEL`); the
  guard still judges those and names them in its answer.

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

### The Bash judge and the job route

`job-route` (PreToolUse on Bash and PowerShell) is the kit's one shell judge, and it keeps its
public name: `hooks.json`, project files and `ownHooks` values stay valid. It is **machine-wide**
and **`alwaysOn`** — the frame skips the `ownHooks` step and `ownHooks` cannot switch it off — and
it runs outside git, and with a broken or too new `cc-smart-dev-kit.json`: a session must not be
able to switch off the limits on its own launches by editing a file it owns (the reason
`session-escape-guard` is always on too). A project file that still lists `"job-route"` keeps
parsing (`UNSWITCHABLE_HOOK_NAMES`), it silences nothing, and `doctor` prints one `·` line that
it can go. Two parts sit in it, and only one reads the project.

**Both shell tools.** Claude Code has a PowerShell tool beside Bash on native Windows, so the
judge is wired on both and reads each line in its tool's dialect (`dialectOfTool`): a limit a
session steps around by choosing the other shell tool is not a limit. The route stays
**Bash only**: its rewritten line names the `sh` launcher and, for
anything but one plain command, `sh -c`, which the PowerShell tool cannot run — a wrong rewrite
is worse than none, so a PowerShell line is never rewritten. With the route on, a heavy
PowerShell line is refused instead, with the exact Bash line to run (only where the Bash tool
can exist: on Windows, where Git Bash is found), because left raw it would not wait for a slot;
a light or print-only line is left as it was written.

**The judge** (`src/hooks/bash-judge.ts`, the rules; `job-route.ts`, the answer) reads the line
with the one shell reader. Alongside the Herdr rules below, it answers these launch and proposal cases:

- **a raw background session**, `claude --bg` / `--background`: an **ask** in an attended
  session, a **denial** in `claude -p` (nobody answers there). Such a session runs beside this
  one, nobody watches it, and it reports to nobody; the ask says to build the work with
  subagents instead, which report back to the session that started them.
- **a print run**, `claude -p` / `--print`: the launch policy every Agent launch meets
  (`judgeLaunch`, § The Agent guard) on its `--model` and `--effort`, after Claude Code's own
  overrides; the prompt is read for a `Fable reason:` line. No model or no effort is refused, the
  `fable` tier asks, the `opus` tier at `max` asks — and in an outer `claude -p`, every ask is a
  refusal. A `claude` subcommand (`claude agents`, `claude stop`, …) is not a launch and is left
  alone. The reader steps over the wrappers around a launch (`setsid claude --bg`, `flock <file>
  claude --bg`), and reads `npx` / `bunx` / `pnpm dlx` of `@anthropic-ai/claude-code` as `claude`.
  A program the line works out when it runs (`$(which claude) --bg`) is judged by the same
  words: `--bg` is a background launch, and `-p` counts as one only when a word names Claude
  Code (`cp -p` is no launch).
- **`workflow propose`** (RF1-4): **asks** the person first whenever the
  gate the git and merge guards read has `autoPush` off or `openPr` short of `ready`, because the
  command pushes a branch and opens a pull request ready for review in children those guards
  never see. The gate is read the way `push-policy.ts` reads it (`resolveGate`: the default, the
  person's own file, the project's file as committed on `origin/<worktrees.base>`, never a
  checkout's working copy), for the project the line proposes into: its `--folder`, resolved
  from the input's `cwd`, or that `cwd`. The question names the push, the pull request and each
  switch that says no, with its source. A gate that cannot be read (no `origin/<base>`, a broken
  file), a project it cannot name (a computed program, subcommand or `--folder`, or a `cd`
  before a folder that is not absolute) is a question with its reason, never silence. Where
  nobody answers (`claude -p`) the question is a denial, as for a raw `--bg`. The portal's
  Workflow card asks on its page and runs the CLI in a child no hook sees, so it is unchanged.
  **Its git calls share one budget** (`SHORT_GUARD_BUDGET_MS`, 8 s of `job-route`'s 10 s;
  `src/hooks/budget.ts`): finding the project takes up to two calls and reading the committed
  file three, each up to 5 s, so on a git that hangs they would add up past the hook, and a hook
  Claude Code kills answers nothing. Each call gets the smaller of its own limit and the time
  left, a call with none left is not made, and the question then says that git did not answer
  in time (`GIT_TIMED_OUT`, `src/project/resolve.ts`: a call that was stopped or never made is
  no answer about the repository, so it is never read as "not in git" or "the ref is not
  known"). Every proposal on a line draws on the same budget, and it counts from the hook's
  start (the frame's `nowMs`), so the frame's own project lookup, which runs first, is already
  spent from it.
  **How it finds the command.** It reads the kit's argv through one recogniser
  (`kitArguments`, `src/shell/kit-invocation.ts`), shared with `session-escape-guard` — a
  spelling that gets past one guard must not get past the other. It knows the kit by its name,
  by a path to the launcher, and by its bundle behind another program (`bun …/dist/cli.js
  workflow …`, `find . -exec cc-smart-dev-kit … \;`, `watch -n 5 cc-smart-dev-kit …`), never a
  program that only reads its arguments (a `git commit -m "…"` names nothing); redirections are
  dropped before anything is read, so `cc-smart-dev-kit 2>/dev/null workflow propose` is the
  command it really runs, and a redirect's target (`… > -h`) is not a flag. A subcommand the
  judge cannot read — a word the line works out when it runs (`workflow $SUB`), or none at all
  (`echo propose | xargs cc-smart-dev-kit workflow`) — may be `propose`, and is judged rather
  than let through; a computed program counts as the kit's only when the line names the kit
  (`namesKit`), unless its words say `workflow propose`. `workflow propose --help` passes: it
  prints the usage and proposes nothing.

**What the judge cannot read**, and so does not judge: a script file's own content
(`sh run.sh`), a command another program runs from a string of its own that the reader does not
open (`watch -n 5 'cc-smart-dev-kit workflow propose …'`, `ssh host '…'`, `su -c '…'`), and a
shell nested more than three deep (`bash -c "bash -c \"bash -c '…'\""` — the walk stops at
`MAX_NESTING`). A chain of `eval`s is read at any depth: each step's own arguments carry the
line. Every guard that reads a shell line shares these limits; the reader
(`src/shell/command.ts`, and `MAX_NESTING` in each guard's own walk) is where one is closed,
never a single guard.
A line the judge reads is judged in the dialect of the tool that runs it — the PowerShell tool
beside Bash on native Windows reads a launch and a `workflow propose` the same.

**The route** is the heavy-job queue's door, and an opt-in with two homes (the
`switches.jobRoute` switch): the project's `"jobs": { "route": true }` (or `false`) in its
`.claude/cc-smart-dev-kit.json`, and under it the person's machine-wide default,
`switches.jobRoute` in their own `workflow.json`. The project's value wins, field by field, as
every workflow setting does; with neither it is off. The hook asks the one resolver
(`resolveJobRoute`, `src/workflow/resolve.ts`), never a reader of its own, and it asks it with
or without a project file: this hook runs machine-wide. A personal file the resolver cannot read
leaves the project's value and the default standing, so the hook never fails on it. Outside git
there is no project, and a heavy command runs raw. With the route on, a command its kinds
classify as heavy is sent through the queue instead of running raw (`docs/jobs.md` § The
route). It answers with Claude Code's `updatedInput` — the same tool input,
its `command` replaced by `"$HOME/.local/bin/cc-smart-dev-kit" job run --kind <kind> --
<command>` — proved live on 2.1.301 (`claude-code-contract.md`). It gives no
`permissionDecision`: the rewrite replaces the input and the permission system still decides
about the new command, so a person's own rule for Bash keeps working. **Only a line whose every
command is heavy, a `cd` or an assignment is queued** (`classifyRoutableLine`), and so is one
heavy command piped into read-only filters (`READ_ONLY_FILTERS`, `routableLine`): only the heavy
step goes into the wrapper, and the filters stay outside it as written, so the person's own rules
still see them; a `tee` to a file, a `sed -i` or a filter before the heavy step is no filter.
Any other line runs raw. Why: Claude Code matches a person's `Bash(…)` rules against the command it is about
to run and does not look inside `bash -c '…'`, so a rewritten `tsc && rm -f x` would hide its
`rm` from a `Bash(rm:*)` rule (proved on 2.1.308, `claude-code-contract.md`).
`REWRITE_SUPPORTED` in the hook is the one switch, and with it false the same command line is
denied instead, never silently left raw. A command already inside `cc-smart-dev-kit job run` is
left alone. A name the project's `package.json` defines as a script is matched only by a
`script` kind, never by a tool of the same name: a `tsc` script that already wraps the job is
not wrapped again (`docs/jobs.md` § The classifier). It is the one guard that changes the call
rather than asking about it.

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
plugin registers:** the Serena root record (Serena's edits in the main-folder guard — the
`serena-root` hook, retired with Serena in 0.6.0) and the Playwright output folder (the
`playwright-output` hook, above).
**Not ported:** the Windows helper that
removes a worktree after the session lets go of it — the plugin removes one when its session
asks (the WorktreeRemove hook) or by `cc-smart-dev-kit worktrees --clean`, and it moves the
folder before it deletes it, so a program still using it makes the removal fail and touch
nothing (`docs/windows-setup.md`). Custom notification behaviour is retired (§ The notifier).

#### Herdr commands in the Bash judge

The judge adds Herdr rules; the Agent and `claude -p` rules above do not change. It reads
invocations through `invocationsOf`, including wrappers and nested shells, and never runs `hc`.
Raw `hc` writes and `herdr-app do` are refused with the guarded kit command to use instead.
Named reads (`ls`, `get`, `read`, `wait`, `templates`, `schema`, `machine ls`, `file read`,
`server status`, help, version and skill output) stay silent; leading global `--json` is accepted.
A global read flag must stand alone after those leading flags. Verb help must be exactly the
verb followed by `--help` or `-h`; a flag in a payload never grants silence. Kit Herdr verb help
follows the same exact two-word rule. `hc events` must run in the Bash tool's background mode;
otherwise use `herdr wait`.
A computed program asks when the line names `hc` or `herdr-app`. A computed kit program followed
by `herdr` and a known verb is judged as that command; a bare `herdr` still needs the kit named. This is not a sandbox: a program built entirely from unrelated fragments
(`$(printf %s h c)`) cannot be identified without executing the line and is not caught.

`cc-smart-dev-kit herdr start` must name its model, effort and mode. Its new launch kind reads
only these explicit fields, never an agent definition or a launch environment override.
Fable and Opus at `max` ask. The child's mode cannot exceed the hook input's `permission_mode`
(Manual arrives as `default`); a lead in `plan` must approve the plan first, and
`bypassPermissions` is always refused. A missing or unknown lead mode asks, for linked and
independent children alike. A remote machine asks unless its machine rule allows it;
production always asks. A machine-file read error asks too. The hook ignores `--asked`: the
command still requires it, but only the person approving the exact line in Claude Code records
approval. It never skips a hook question or a mode failure.

A child's questions are the person's, answered in its pane: there is no answer verb (the relay
went in 4.10.1), and raw `hc keys`, `send` and `attach` stay refused. Machine rule changes (`allow`,
`forget`, `production`) ask too; only a parsed machine-list command is silent, and malformed
machine commands ask. Assigning `HC_TERMINAL_ID` on a line that invokes Herdr or
`hc` is refused; Herdr supplies that identity. The shared frame turns asks into denied,
parked actions while the person is away. In an unattended `claude -p` session, an ask is a
denial because nobody answers. The judge catches common ways to set the identity variable;
with endless shell spellings, the command's live ancestry check is the guard.

Turns starting with `<hc ` or the kit report tag are not the person's words
(`prompt-source.ts`). A phase whose agent is `herdr:<core>/<address>` gets a keep-going
reminder to run `cc-smart-dev-kit herdr wait` in the background or use `herdr send`, never
`SendMessage`.

### `doctor --live`

`cc-smart-dev-kit doctor --live` (opt-in; it uses the person's login and costs a few cents) makes one
throwaway repo in a temp folder, without `cc-smart-dev-kit.json` (Claude Code's own worktrees,
what every project uses), and runs one `claude -p` session in it with
this plugin (`--plugin-dir`), only the EnterWorktree, ExitWorktree and Bash tools,
`--allowedTools` for exactly the calls it makes (never a mode that skips the permission
checks), and a three-step prompt: enter a worktree, `git status` there, leave with
"remove". Every hook run is logged (`CC_SMART_DEV_KIT_HOOK_LOG`, with each run's `cwd` and the spec's
`logFacts`), and it checks: the plugin's hooks fired (SessionStart,
the git guard), the git guard **read the command line** (its log names the programs it
parsed: a hook that fired is not a guard that answered), no WorktreeCreate hook ran, Claude
Code made its own worktree and the session worked in it, and ExitWorktree removed it. No
repo wires a worktree hook: the retired engine's is gone with the engine. When all pass it
records the Claude Code version in the state folder (`live-check.json`); plain `doctor` shows
that line, and says to run it again when the installed Claude Code is another version.

## The safe switch


A project may already have its own copy of a piece the plugin now ships (a guard, a note).
Moving it to the plugin must never run it twice or leave a gap:

The project names its own copies, and the plugin steps aside for exactly those:

1. **The project lists each plugin hook it still runs itself**: `ownHooks: ["git-guard"]`
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
project hook left to answer is a warning (the project is unguarded while it is listed), and
a project hook running next to a plugin hook that is not listed is a warning too (both may
answer the same command). The second warning leaves the machine-wide hooks out
(`MACHINE_WIDE_HOOKS` in `src/hooks/specs.ts`: the `USER_HOOKS` bundles and the plugin hooks
whose answer does not depend on the project's file): they answer about the machine, not the
project, so a project hook on their event is not a second copy of a plugin piece.

**A plugin hook the plugin retires** keeps its name in the schema as a retired name
(`RETIRED_HOOK_NAMES` in `src/project/config.ts`): a project file that still lists it
parses, and the name silences nothing, because no hook of that name runs.
Refusing it would fail the strict parse, and every guard would then ask about every call.
`doctor` prints one `·` line that the name can go.

The retired worktree engine is not part of the switch: a project that still has its lines or
its fields fixes both with one run of `cc-smart-dev-kit project init` (README § Worktrees), in
one commit. `cc-smart-dev-kit doctor` names what is left.
