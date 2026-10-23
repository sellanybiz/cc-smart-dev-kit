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
  line and exit 1.
  **In a crew session the `--missing=ask` answer is a deny** (`CC_SMART_DEV_KIT_CREW` set):
  nobody is at the machine to answer, so the session reads what it can do — end its turn and
  say so in its last message, and report while shell commands still run — instead of a
  question (§ The crew talks).
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
2. **A guard's crew part** (`HookSpec.crewLimits`), before `ownHooks` and before the file: what
   a crew session may never do — push, run a git command that destroys work without reading
   the step that replaces it, open or merge a pull request, launch an agent or run a command
   whose question nobody can answer, write into the kit's own files, or message a peer without
   the tag, or message its own lead (D24, D36, D47). It answers only in a crew session, so an
   ordinary session pays nothing, and it holds in a project that never opted in and in one
   whose `ownHooks` lists its own copy of the guard. The detectors are each guard's own, shared
   with its `run` (§ The crew talks). `job-route` and `session-escape-guard` are `alwaysOn`, so
   their crew answer lives in their own `run` and config answer instead — no crew part, and no
   call judged twice (§ The Bash judge and the job route, § The session-escape guard).
3. **The project's own copy.** When the project's `cc-smart-dev-kit.json`
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
   opt-in. **Two hooks skip the step themselves:** `session-escape-guard` and `job-route`
   are `alwaysOn` (`HookSpec.alwaysOn`), so the frame never reads `ownHooks` for them — the
   project's file is one of the things the first guards, and the second limits what the session
   itself may launch (§ The session-escape guard, § The Bash judge and the job route).
   `ownHooks` does not accept `session-escape-guard`'s name; it still accepts `job-route`'s,
   because a project file written before 1.0.0 may carry it, and the name silences nothing
   (`UNSWITCHABLE_HOOK_NAMES`).
4. **Read `cc-smart-dev-kit.json`.** When it is broken or needs a newer plugin, the hook
   **fails closed**, each in the way that suits its event: a guard asks the person (it cannot
   know whether the project turned it on), an informational hook says one line. "Closed"
   never means silent: a person must hear why.
5. **Run.** An informational hook's error is one line on stderr and exit 0: its bug never
   stops work. A **guard's** error answers through its `onCrash` (`guardCrash` in
   `specs.ts`): it asks about the call in its own domain, so a crash never lets a call
   through.
6. **Record an ask.** An answer that asks the person is appended to `guard-asks.jsonl` in the
   state folder (`src/hooks/ask-log.ts`): the time, the hook, the session, the tool and a
   short reason, put through `maskedLine` so no secret reaches it. The file stays small by
   the rule of `update.log` (past `LOG_MAX_BYTES` the newer half is kept). A write that fails
   is one line on stderr and never changes the answer.

Each hook's answer when it fails (the same table is in `.claude/rules/hooks-guards.md` § Fail safe):

| Failure | A guard (git, merge, main-folder, message, job-route, agent, session-escape, crew-role) | Any other plugin hook | `hook notify` |
|---|---|---|---|
| Its own code throws | `onCrash`: **ask** about the call (none outside its domain; silent on PostToolUse) | one stderr line, exit 0 | one stderr line, exit 0 |
| The input is not JSON | **ask**, in general | one stderr line, exit 0 | one stderr line, exit 0 |
| `cc-smart-dev-kit.json` broken or too new | **ask** (`agent-guard`, `session-escape-guard`, `crew-role` and `lead-notes` judge the call anyway); in a crew session: silence for `git-guard`/`merge-guard`, a deny for `agent-guard`/`job-route`/`session-escape-guard`, an ask still for `main-folder-guard`/`message-guard` | one line of context or stderr | not read |
| No bun, or one too old | the shim's `--missing=ask`: **ask**; in a crew session: a deny naming what the session can do | `--missing=quiet`: stderr, exit 0 | the launcher's line, exit 1 (Claude Code goes on) |
| The bundle file is gone | the shim **asks**; in a crew session: a deny naming what the session can do | bun's error, exit 1 | not applicable |
| Cannot start, times out, fails (exit code other than 0 and 2) | `"onFailure": "block"`: the call is **blocked** | Claude Code goes on | Claude Code goes on |

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
| `git-guard` | PreToolUse (Bash, PowerShell) | `cc-smart-dev-kit.json` exists (its crew part needs no file) | Asks before **any** `git push` while `autoPush` is off (D15: the default, so a push leaves the machine), and asks for a force-push (git's abbreviations included: `--forc`), a push to a protected branch (`protectedBranches`, default `main`), `push --all`/`--mirror`, a branch deleted on the remote (`git push origin :x`, `-d`/`--delete`), `reset --hard`, `reset --merge` (it throws away staged changes and staged new files; `reset --keep` overwrites no working file (it refuses instead), so it asks nothing), `clean -f`, `worktree remove -f`, a checkout or restore that discards changes, `branch -D`, `stash clear` and an unnamed `stash drop`, and (with `worktrees`) a bare `git stash` / `stash pop`. `autoPush` is read as the merge guard reads its gate (`resolveGate`: the default, the person's `workflow.json`, the project's file committed on `origin/<base>`), so a session cannot switch it off in its own worktree; a policy it cannot read asks. **A crew session never pushes and is never asked** (D24; a guard's own crash, or input it cannot read, still asks, as for any session): a push from one (`CC_SMART_DEV_KIT_CREW` set) is denied, whatever `autoPush` says — the session commits and the lead merges locally — and every ask above that would destroy work (`reset --hard`, `reset --merge`, `clean -f`, `worktree remove -f`, a discarding checkout, `branch -D`, `stash clear`, an unnamed `stash drop`; a bare `git stash` / `stash pop` too, since a crew session always works in a worktree, where the stash is shared) is a **deny that names the step** instead: commit the work in progress first, keep a copy of a file before a deliberate break and copy it back (`cp path path.bak` … `cp path.bak path`), the tagged stash form. Nobody is at the machine to answer a crew session's question, and a hook's ask cannot be silenced. That is the guard's **crew part** (`crewGitAnswer`), which the frame runs before `ownHooks` and the file, so it holds with no `cc-smart-dev-kit.json` and whatever `ownHooks` lists. One shell lexer (`src/shell/command.ts`) reads each command of a line; quoted text, here-docs and comments are data, and shell keywords, wrappers (`timeout 60 git push -f`, `env -i sudo -u me …`, `setsid`/`flock`/`script -c`/`busybox sh -c`, `xargs …`), the here-doc a shell reads as its script, and the text piped into one are read through. `git send-pack` and a `git -c alias.x=push x` on the line push too, and a program the line works out when it runs (`$(which git) push`, `$GIT push`) asks rather than pass unseen — and in a crew session the same words are denied, like any push. Known limits: a git alias from the person's own config, `branch -f`, `checkout -B`, `switch -C`, `ssh`, a script file. Apart from a crew session's refusals it asks, never denies: the person may mean it. |
| `main-folder-guard` | PreToolUse (Edit, Write, NotebookEdit) | `worktrees.guardMainFolder` | Denies an edit of a file in the main checkout itself, with the way into a worktree. (Until 0.6.0 it also placed Serena's edits, with the `serena-root` hook's record; both went with Serena.) |
| `playwright-output` | PreToolUse (`mcp__playwright__.*`) | always (a `USER_HOOKS` bundle: it reads no cc-smart-dev-kit.json) | Rewrites a relative `filename` to an absolute path in the browser's output folder, with `updatedInput` and no permission decision; a relative name with a `..` segment is DENIED (the launcher's `--allow-unrestricted-file-access` means the server takes that path as it is). Answers only while the live `playwright` registration is the one setup recorded — a server of the person's own is left alone entirely. |
| `merge-guard` | PreToolUse (Bash, PowerShell) | `cc-smart-dev-kit.json` exists (its crew part needs no file) | Asks the person before a command that merges a pull request, or opens or readies one (`openPr`, D16: `off` asks before any of them, `draft` lets a draft create through and asks for a ready one and for `gh pr ready`, `ready` asks for neither). Every merge of the line is judged (`gh pr merge`, `gh pr -R owner/repo merge 5`, an alias from `gh alias list`, `--auto` included), and the first the policy does not allow asks, naming that pull request: `autoMerge` on, the base is the integration base (`autoMergeAllowed`), the merge names THIS project's repository (its `origin`), every required check `gh pr checks --required` reports green, and (with `reviewBeforePush`) the head commit's review is recorded. The forms it does not judge ask with the reason — a `gh api` merge, a GraphQL query it cannot read, a shell alias, an extension whose words name a merge — as does a step that moves the merge's folder, branch or repository (`cd`, `git switch`, `GH_REPO=…`, `env`), and a `gh` that is missing or does not answer. **A crew session opens no pull request and merges none** (D24): `gh pr create` pushes the branch, so it is denied, and so is a program the line works out when it runs whose words name an opening or a merge (`$GH pr create`). **Every question above before a merge is one refusal** — the policy off, `--admin`, another repository, a check not green, no covering review, a policy or a form it cannot read, its own budget — because nobody is at the machine to answer and every one ends at the same step: it commits on its branch, and the lead merges locally (`CREW_MERGE_REFUSAL`). A merge the policy would allow is refused too, never `allow`. That is the guard's **crew part** (`crewPullRequestAnswer`), which the frame runs before `ownHooks` and the file, so it holds with no `cc-smart-dev-kit.json` and whatever `ownHooks` lists, and the fail-closed ask for a broken or too new file is silence for a crew session. A `gh pr create` outside the base its head branch belongs to (`worktrees.base`, or `worktrees.bases` for that branch; with no `--base`, the repository's default branch) asks, naming both branches, and never denies (WA1). Read-only `gh`, 10 s a call of the hook's 30 s. § The workflow › The merge guard. |
| `message-guard` | PreToolUse (SendMessage) | `cc-smart-dev-kit.json` exists (its crew part needs no file) | Denies a message to a session that works outside this repo (from Claude Code's session records), and a crew session's message to another crew session of this repo that does not carry the `crew tell` tag (§ The crew talks); a message to the session's own lead is denied with the `crew report` route. The crew rule is the guard's **crew part** (`crewMessageAnswer`), which the frame runs before `ownHooks` and the file, so it holds with no `cc-smart-dev-kit.json` and whatever `ownHooks` lists. |
| `agent-guard` | PreToolUse (Agent, Task, Workflow), and PostToolUse for the record | **machine-wide** | The model a launch really runs on, and the model rules: no `model`/no `effort` → deny; `low` effort → deny on every model (`medium` for searches and reads, `high` for building and reviews, `xhigh` for the hardest judgment, `max` only when the person asks — D13); an affordable slot needs `effort: "max"`; the **`opus` tier** — whatever answers behind the name, and a name whose override or slot answers with a stricter tier counts as that tier — is allowed at `medium`/`high`/`xhigh` for any agent and any purpose, and an **ask** at `max` (the owner's decision D11; in `claude -p` a deny); a launch that declares UI/UX work — `Opus reason: ui`, or `Fable reason: ui-design` — runs only on `opus` or `fable`, at `high` or above (`UI_POLICY`, D50), and is **denied** on Sonnet, Haiku or an affordable slot, or below `high`; the **`fable` tier** is a read-only agent with a `Fable reason:` word, and an agent that can change files (a fork included) only with `build`, as an **ask**. A fork is judged on the session's model, never on the `model` it names. A premium launch is recorded once it is known to run: an allowed one on PreToolUse, an asked one on PostToolUse. **A crew session is judged as a session nobody watches** (D36): every launch it would ask the person about — Fable, an Opus-family model it cannot read, Opus at `max`, an unreadable Workflow — is denied with the step that puts the question to its lead (`crew report --question`), in the guard's **crew part** (`crewAgentAnswer`), which judges without recording and runs before `ownHooks`. § The Agent guard. |
| `session-escape-guard` | PreToolUse (Bash, PowerShell, Edit, Write, NotebookEdit) | **machine-wide**, and `ownHooks` cannot switch it off | Denies `workflow review-done` and any kit command run with `CLAUDECODE` removed; asks before a command that reaches the portal's port, before an edit or write of the kit's own settings, state or installed plugin folder, and before a computed program whose line names the kit command. **A crew session is never asked**: each ask is a denial naming the step that reaches its lead — the kit's own limits are the person's, and the portal is no place for a crew session (`CREW_KIT_REFUSAL`, `CREW_PORTAL_REFUSAL`) — and the `alwaysOn` flag carries that answer into every path the guard answers through. § The session-escape guard. |
| `fable-session` | SessionStart, PostModelSwitch, Stop | **machine-wide** | One `systemMessage` to the person, once a session, when the session's own model is the **`fable` tier**; nothing to Claude, never an error and never a block — the line itself was seen live (2026-10-17), but not on `PostModelSwitch` or `Stop` yet. The model: at a start, the `model` the input names (no fallback); at a switch, `to_model` — the model the session moved TO; at a stop, the one that answered in the transcript, then `ANTHROPIC_MODEL` — the guard's own reading of the tier. Not `UserPromptSubmit`: it judged the PREVIOUS answer's model, so it missed the switch and warned after a switch back (the live bug of 2026-10-17). § The Fable-session note. |
| `job-route` | PreToolUse (Bash, PowerShell) | **machine-wide**, and `ownHooks` cannot switch it off | The kit's one shell judge (`bash-judge.ts`), in two parts. **The judge** ignores the project's file and runs outside git: a raw `claude --bg` **asks** in an attended session (refused in `claude -p`) showing the `crew start` line; `claude -p` is judged by the launch policy every Agent launch meets (its `--model`/`--effort`: no model refuses, the `fable` tier asks, the `opus` tier at `max` asks; a `Fable reason:` line in its prompt counts); a crew session's lead commands (`crew start`, `answer`, `stop`, `rm`, `resume`, `watch`, `lead`, `lead tell`) are denied; a polling loop over `crew list|status` or `claude agents --json` (a repeating `while`/`until`/`do` loop or a `watch`, or a `sleep`/`Start-Sleep` beside a read; a `for`/`foreach` over a fixed list is no poll) is denied. It reads each line in the dialect of the tool that runs it, so the PowerShell tool is judged the same. **The route** is the project's `jobs.route`, Bash only: a line whose every command is heavy, a `cd` or an assignment is rewritten to `cc-smart-dev-kit job run --kind <kind> -- <command>` through `updatedInput` (proved live on 2.1.301); any other line runs raw, as the person's own rules see it (HK hunch 1). **In a lead**, a CI watch, a routed heavy job and the full check get `run_in_background: true` (proved honoured on 2.1.308, and in L1a.1 on 2.1.306). **A crew session is never asked** (D36): a `claude -p` launch the launch policy would question is refused by the policy's unattended rule, and a heavy command whose routing cannot be read because the project's file is broken or too new is refused too — each with the step that puts the question to its lead. § The Bash judge and the job route. |
| `after-merge` | PostToolUse, PostToolUseFailure (Bash, PowerShell) | `worktrees` | After a pull-request merge (`gh pr merge`, `gh pr -R owner/repo merge 5`, a readable `gh api` merge path, a `gh` alias for one): the steps that clear the merged worktree, the message to send **the other leads of the repo and the person's own sessions — never a crew session** when it went into `worktrees.base`, one `merge` event per other lead so its watch says the line, and it starts the background clean of finished worktrees once (§ Finished worktrees clean themselves). The message says what to do after the merge: never commit unfinished work for it, run the project's install if a lock file changed, run the tests it touched. A form that names no pull request gets no note (§ The crew talks). |
| `review-record` | SubagentStart, SubagentStop | `cc-smart-dev-kit.json` exists | When a review agent (`workflow.reviewAgents`) starts, notes the commit the working folder is on and its branch; when it stops, records that start commit on that branch — the record the merge guard reads. Commits made during the review count as change after it. Nothing for an agent that stopped inside its own worktree. § The review record. |
| `subagent-background` | SubagentStop | `cc-smart-dev-kit.json` exists | A subagent that ends its turn with background work **it started** still running (a Bash command, or a subagent it launched) is blocked **once**, with one plain reason: wait for the work or stop it, then report. The input's `background_tasks` is the session's list, so the hook reads the agent's own transcript (`agent_transcript_path`) as JSONL, line by line, and keeps only an id named in a **tool result of the agent's own call** — a Bash background launch (`Command running in background with ID: …`) or an Agent launch (`agentId: …`) — never one in its brief or in a file it read; the ending agent's own entry is dropped (a background subagent appears in its own list). No `additionalContext`, never a second block (`stop_hook_active`), and nothing when the transcript cannot be read. § One frame for every hook. |
| `verify-gate` | Stop | `checks.fast` | One **block** when this session changed files after the last Bash or PowerShell call that ran the project's fast check, naming the command — once per change: the block's own feedback line in the transcript is the mark, so a change made after it earns the next reminder, and a check that fails never traps the turn. It reads the session's own transcript (JSONL) in order: an Edit, Write or NotebookEdit is a change (an edit whose result was an error or a refusal changed nothing), a shell line that runs the check is the check (through the one shell reader, in that tool's dialect), and a subagent's own calls are in its own transcript. Silent on the stop its own block caused (`stop_hook_active`), in a crew session (its report gate is `crew-role`), on a turn that still waits on background work, with no `checks.fast`, and when the transcript cannot be read — a reminder never stops a person's work. `notify` asks its decision (`verifyGateWouldBlock`), so the "finished" alert waits for the stop that really ends the turn. |
| `agent-usage` | SubagentStop | **machine-wide** | One line per subagent in `<stateDir>/agent-usage.jsonl`: the time, the session, the agent's id and type, and per model the replies, the four token sums and an estimated USD cost — from the agent's own transcript, never a word of its content. A second stop of one agent supersedes its first line when read; the record is kept small like the ask log. One stderr line when the transcript cannot be read or the record cannot be written. § Each subagent's usage on record. |
| `worktree-leftovers` | SessionStart (startup, resume) | `worktrees` | Names the finished worktrees (every commit on `origin/<base>`, nothing uncommitted, no session in it, idle an hour, no ignored file that cannot come back) and the ones whose folder is gone, says once what the background clean removed, and starts that clean (at most once an hour per repo, never in `claude -p`). At an attended start it also adds at most one short line about the main checkout — on another branch than `base`, behind `origin/<base>` as git already knows it, or in the middle of a merge, a rebase or a cherry-pick — read-only and with no fetch. With `worktrees.guardMainFolder` on, each such line names the command for the person to run in the main checkout, never a step for the session; a fast-forward is always `git merge --ff-only`. It removes nothing itself (§ Finished worktrees clean themselves). |
| `session-name` | SessionStart, UserPromptSubmit | `sessionNames` | Tells the session to name itself after its task (`cc-smart-dev-kit session-name`), then sets that as its title at the next prompt — unless the session is a recorded lead: its role name is `lead-notes'`, and one title has one owner (§ The lead and the launch › The lead's name). |
| `crew-role` | SessionStart (startup, resume, compact), UserPromptSubmit, PreToolUse (AskUserQuestion, ExitPlanMode), Stop, StopFailure | a crew session (`CC_SMART_DEV_KIT_CREW`) | **machine-wide**: the role card at a start, a resume or a compaction; **its own `cwd` checked against the record's worktree** — inside it a `starting` record is written `working`, outside it an open record is written `failed` with where it started, and its card says to stop (the lead's watch ends the session) — each write reads the state again under the store's lock (`updateCrewIfState`); the two tools that ask the person **denied** with the `crew report --question …` step (D36); the person's own prompt recorded as one `person` event with one line of context, and every other delivery recognised and recorded as nothing (D55); at a stop, the last line on the record and one block when the turn ended on a step with no report. No context from Stop. At a StopFailure on a model limit, the record is **paused** with what it waits for (D42, § Lead and the crew › Waiting out a limit). § Lead and the crew › The crew session's and the lead's hooks. |
| `lead-notes` | SessionStart, UserPromptSubmit | a registered lead (the input's `session_id`) | **machine-wide**: one line about what changed among the lead's crew sessions — a note another lead told it, a file clash, a merge into the base — since its last turn, from a per-lead cursor in the store, said once and never twice. At a prompt it also **names the session** `LEAD <tag> <plan>` (`sessionTitle` beside the line in one answer, no setting), never over a name the person gave and never twice (§ The lead and the launch › The lead's name). § Lead and the crew › The crew session's and the lead's hooks. |

Without `cc-smart-dev-kit.json` every one of them is silent — except the eight machine-wide
ones: `agent-guard` (§ The Agent guard), `job-route` (§ The Bash judge and the job route),
`session-escape-guard` (§ The session-escape guard),
`fable-session` (§ The Fable-session note), `crew-role` and `lead-notes` (§ Lead and the crew),
`agent-usage` (§ Each subagent's usage on record), and
`playwright-output`, which reads no project file at all — and the **crew part** of `git-guard`,
`merge-guard`, `agent-guard` and `message-guard`, which answers only in a crew session (D24,
D36, D47; § The crew talks), so a project that never opted in
sees only Claude Code's own worktrees and the limits a session may not get around. `job-route`
and `session-escape-guard` are also `alwaysOn`: `ownHooks` cannot switch them off, because they
limit what the session itself may do — their crew answer lives in their own `run` and config
answer (§ The Bash judge and the job route, § The session-escape guard). The machine-wide
`notify` hook needs no project file
and acts without one; the
`workflow.alerts` settings are the one thing it reads from a project that has them (§ The
notifier).

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
reads, `high` for building and reviews, `xhigh` for the hardest judgment, `max` only when the
person asks) — and then reads the launch's
`model`, `effort`, `subagent_type` and prompt, and resolves the model the launch will really
run on:

1. a family name (`haiku|sonnet|opus|fable`) goes through Claude Code's own override, when
   the person set one (`ANTHROPIC_DEFAULT_<FAMILY>_MODEL`; all four exist on 2.1.301, Fable
   included; `gateway on` writes none since 0.5.0), then — with the gateway on
   (`ANTHROPIC_BASE_URL` in Claude Code's settings) — the family's slot, the way the router
   picks it (`FAMILY_SLOTS`: haiku → scout, sonnet → worker, opus → opus, fable → fable): its
   chain's first target answers, read from `gateway.json` through the gateway's own
   `loadConfigFile`. A slot with no chain answers as Claude, and the Claude model answers. So `sonnet` is
   an affordable slot (effort `max`) exactly when the gateway is on and the worker's chain
   starts with a `<backend>:<model>`;
2. a full Claude id goes through its family's slot the same way; a slot key or
   `<backend>:<model>` is resolved as itself (a slot's first target answers); **any other name** (`best`, `opusplan`,
   `default`, `inherit`, a name no rule knows) is resolved the strictest way — the rule for a
   Claude id with no family to read — because only what the guard can prove affordable is
   affordable;
3. a `fork` always inherits: its model is the session's own, read from the tail of the hook
   input's `transcript_path` (`lastClaudeModel`, shared with the StopFailure alert; a
   sidechain line is a subagent's, not the session's), else from `ANTHROPIC_MODEL`; an
   unknown one counts as Claude Opus.

**Before those steps, Claude Code's own overrides decide which name and which effort the launch
really gets** (`effectiveLaunch` in the launch policy; the order proved live on 2.1.306, and in
Claude Code's own docs and code):

| Override | What the launch runs on |
|---|---|
| `CLAUDE_CODE_SUBAGENT_MODEL_FORCE` on (`1`, `true`, `yes` or `on`, the values Claude Code reads as on) | `CLAUDE_CODE_SUBAGENT_MODEL`; unset or `inherit`: the session's own model (step 3's reading; unknown → the `opus` tier). The call's `model` does not count. |
| `CLAUDE_CODE_WORKFLOW_SUBAGENT_MODEL` (not empty, not `inherit`) | its model, for a Workflow `agent()` only; FORCE comes first; an Agent call is not touched |
| neither | the call's own `model`. A plain `CLAUDE_CODE_SUBAGENT_MODEL` is only a default for a call that names none, after the agent's own definition, which no hook can read — so such a call is still refused for naming no model |
| `CLAUDE_CODE_EFFORT_LEVEL` (not empty) | that effort for every launch, whatever the call names |

The guard reads them from its own environment. **A settings file's `env` reaches a hook's
environment** (proved live on 2.1.306, for `--settings` and for a project's
`.claude/settings.json`), so that is all it reads — no settings file of its own. **Under FORCE
Claude Code takes `model` off the Agent tool, and under `CLAUDE_CODE_EFFORT_LEVEL` it takes
`effort` off** (proved live: the PreToolUse `tool_input` carries neither). So before 1.0.0
the guard refused every Agent launch there ("names no `model`"); now such a launch is judged on
what the variable sets. Every ask and refusal says which override applied ("This launch runs on
`haiku` because `CLAUDE_CODE_SUBAGENT_MODEL_FORCE` is set …"), and the record names the model
the launch really runs on. Two refusals rest on the variable alone, and only the person can
change it, so the message says where it is set: a `CLAUDE_CODE_EFFORT_LEVEL` no subagent may run
at (`low`, or a level no rule knows), and anything but `max` while an affordable slot answers.
`auto` (`EFFORT_AUTO`: the model picks its own default) is the person's own choice, like a
fork's inherited effort: it is never refused for itself, and since no model's default is `max`,
the `opus` tier runs it with no question (recorded as `opus:auto`); Sonnet and Haiku run it, the
`fable` tier keeps its reason-line rules, and only an affordable slot refuses it. Refusing it
would lock out every launch, the same way the missing `effort` once did. A fork keeps its rule: the session's model, and the effort it names,
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
(`ALLOWED_EFFORTS`), the Fable reason words and the crew kinds (§ Lead and the crew) — is one
pure module, `src/models/launch-policy.ts`, which the guard imports and the crew launcher and
the Bash judge share; the guard keeps the hook's own parts (reading a Workflow script, the agent
types, the record, the messages). The one list a person
may extend is an environment variable (`CC_SMART_DEV_KIT_AGENT_GUARD_READ_ONLY_AGENTS`, the
read-only agent types the Fable rule reads), and the answer is a PreToolUse `deny` (the rule, in
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
and the design verdict is made on `opus` or `fable` (`/cc-smart-dev-kit:ui-verify`). The same
rule reaches the crew kinds (§ The kinds): `ui` is `opus` at `high`, and the launcher refuses an
override that would put it elsewhere.

An `ask` in a session nobody
watches (`claude -p`, `CLAUDE_CODE_SESSION_ATTENDED=0`, or a crew session — a `--bg` session
its lead started) is refused just like a deny — Claude Code cannot ask anyone there (proved
live on 2.1.301) — so the guard answers that denial with a message that says why and the fix
the session can take; an Opus-family launch below `max` needs no answer, so it stays allowed
there, one at `max` is told to run at `medium`, `high` or `xhigh`, or in an interactive
session (a crew session: at that effort, and the step that reaches its lead), and one with no
family is told to name `opus`. A crew session's former questions are denied by the guard's
crew part (`crewAgentAnswer`) before `ownHooks`, so a project that runs its own Agent guard
still cannot leave one to nobody; the part answers only those questions, and the guard's other
denials stay the project's policy. Every premium launch is
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
override that points `opus` at a backend never becomes an affordable slot, is never forced to
`max`, and still asks at `max`; the messages name both, `` `opus` (answered by
openai:gpt-5.5) ``.

The Fable rules are the owner's of 2026-10-16, and each is the person's call:

- **A read-only agent** (Plan, Reviewer, Explore, auditor) takes any word of
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
`<label> · <slot> → <model> → <effort>`, the slot taken from the model's Claude family with
the router's own mapping (`familySlotFor`). It is a plugin setting, not a hook: Claude Code
runs the command on each refresh tick with `columns` and one entry per visible subagent on
stdin, and the command answers one `{"id","content"}` line per row (proved offline on
2.1.308, `docs/claude-code-contract.md`). The command names the launcher, never
`${CLAUDE_PLUGIN_ROOT}`: a plugin's settings file does not expand that variable (proved: the
literal string ran, exit 127), and the launcher is the one path an update cannot break.

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

**A crew session is never asked** (D36): each ask above is a denial that names the step — the
kit's own limits are the person's, and the portal is no place for a crew session — and the
question goes to its lead with `crew report --question` (`CREW_KIT_REFUSAL`,
`CREW_PORTAL_REFUSAL`). A computed kit command keeps its own fix, "write the command out in
full": a crew session spells its own `crew report` that way. The guard is `alwaysOn`, so the
crew flag reaches every path it answers through (`run`, `onConfigProblem`, `outsideGit`).

**How `CLAUDECODE` counts as removed.** The shell reader (`src/shell/command.ts`) gives each
command of the line, its wrappers (`setsid env …`, `flock <file> env …`, `script -c …`,
`busybox sh -c …`), and the lines it runs (`bash -c`, `eval`, a here-string,
`cc-smart-dev-kit job run --`, `ssh host '…'`). On one command: `CLAUDECODE=…` before it, `env -u
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
line names the kit command, the guard **asks** instead of staying silent.

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

### The Fable-session note

`fable-session` (SessionStart, PostModelSwitch, Stop) is machine-wide like `agent-guard`: the
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
- a **switch** (`PostModelSwitch`): `to_model` — "the resolved model id the session runs after
  the switch", from Claude Code's own input schema (2.1.302, read from the shipped binary). So
  the line appears AT the switch;
- a **finished answer** (`Stop`): the model that answered, from the transcript's last assistant
  message, then `ANTHROPIC_MODEL` (`sessionModelOf`, one home with the guard's fork rule). This
  is the catch-all for a Claude Code that fires no `PostModelSwitch`, and it cannot fire for a
  model the session has already left.

**`UserPromptSubmit` was the bug** (seen live): the model read there is the transcript's
last answer — the PREVIOUS turn's — so the hook ran one turn behind. It missed the switch to
Fable, and then warned while the person was back on Opus. Stop judges the answer that just
ended, and a switch back is a different answer.

The tier is read the guard's way too (`resolveLaunchModel`, `ANTHROPIC_DEFAULT_FABLE_MODEL` and
the fable slot's chain while the gateway is on included), so there is no second list of what
counts as Fable, and a tier a backend answers warns the same, naming the model (`the
\`fable\` model, openai:gpt-5.5`).

What it costs: a session that was told stops at the mark; a session on anything else pays one
`existsSync`, and — at a stop — the transcript's tail; the gateway config and Claude Code's
settings (is the gateway on?) are read only when the model text could be Fable at all
(`couldBeFable`). A session nobody
watches (`claude -p`) is told nothing and keeps no mark. The mark that keeps it to once a session
is `<TMPDIR>/cc-smart-dev-kit-session-names/<session id>.fable`, beside the session's own name
files (`namesDir`, one home), so the OS clears it; it is made with `wx`, so two runs that race
cannot both speak, and a mark that cannot be made means the line is not said at all — never
twice.

### The notifier

`notify` is a `USER_HOOKS` bundle: it never enters the frame, because it is about the machine
(`src/hooks/notify.ts`, its header is the full contract). Its own opt-in needs no
`cc-smart-dev-kit.json`; the one thing it reads from a project's file is the `workflow.alerts`
settings, when a project has them (§ The workflow › The alert settings).

**Which events, one alert each** (`plugin/hooks/hooks.json`): `Notification` (a session's own
"needs you" types, `worker_permission_prompt` included — `PLUGIN_NOTIFY_TYPES`; the idle
wait is left out — the `Stop` alert
already announced that turn); `Stop` (the turn's last answer as the body, from the
transcript's tail, 300 ms after the event because Claude Code writes it just then);
`PreToolUse` on `AskUserQuestion|ExitPlanMode` (Claude Code raises no Notification at the
moment Claude asks, so this covers it); `PostToolUse`, `PostToolUseFailure` on the same two
tools and `UserPromptSubmit` (that wait is over: the mark goes, nothing is shown); and
`StopFailure` (the turn died). A `rate_limit` stop belongs to the `stop-failure` hook only
where that hook will show its alert — a desktop to show it on, the gateway set up, and a
plan limit (`stopFailureWillAlert`) — so one stop never gives two alerts; where it has no
alert to give (no desktop, no gateway, a short rate limit, which is no plan limit), the
notifier announces the stopped turn on its own routes.

**Agent view and background sessions.** Claude Code raises `Notification` hooks in the
list's own process while `claude agents` is open: `agent_needs_input` while a session waits,
and `agent_completed` with "<label> finished" or "<label> failed". **That process runs only
the hooks in settings files, never a plugin's `hooks.json`** (proved live on 2.1.302,
`docs/claude-code-contract.md`), so `cc-smart-dev-kit setup` manages one user-level entry in
`~/.claude/settings.json` (`src/setup/user-notify-hook.ts`): matcher
`agent_needs_input|agent_completed`, the command
`"$HOME/.local/bin/cc-smart-dev-kit" hook notify`, timeout 10. It runs the same function the
bundle's entry runs (`src/hooks/notify-entry.ts`) through the launcher, so a plugin update
that deletes the old version folder cannot break it. The plugin's `hooks.json` leaves these
two types out (`NOTIFY_MATCHER`), so a normal session never runs the alert twice. The entry's
record is `owned-hooks.json`, never a `changed.json` kind: an older running cc-smart-dev-kit
(a portal copy, a session that has not restarted) refuses a changed.json kind it does not
know. An entry the person edited (another timeout, a redirection) is theirs — setup leaves
it, claims nothing and adds no second one, and `doctor` shows it as information, never a
failure. A hand-written entry setup replaced (it ran the plugin's own `dist/notify.js`, from a
version folder) does not come back on restore: the managed entry goes, and the file's backup
has the old one. A background update never runs setup, so when the entry is missing its
notification says `cc-smart-dev-kit setup` writes it (`NOTIFY_HOOK_SETUP_HINT`). The hook input is the
list's session and folder, so those alerts carry no session name (`titled(kind, null)`), and
the per-session question mark says nothing about them. `agent_needs_input` also comes from a
session's own process (a teammate's setup question, auto mode's classifier notice), and the
input carries no sign of which: both get the agent-view handling, so that one alert loses its
`· <session>` and its mark — a cost taken knowingly, since guessing from the message's words
would be wrong for one of them. On a Linux desktop the one-alert-per-session key adds the
session the message names (`agentViewKey`): one background session's alert never closes
another's. The list never writes a hook's `terminalSequence` out, so these types take the
devices first (`device-then-field`), and the field only when no device is found. A background session has
`CLAUDE_JOB_DIR` set (Claude Code's environment-variables page) and inherits the daemon's
`DISPLAY` and terminal variables, so an alert of its own would go to the wrong place: the
notifier and the usage-limit alert stay silent there, and agent view is the one place its
alerts come from while the list is open (`background-session.ts`). The owner accepted the
trade-off (2026-10-18): with no list open, a background session does not alert. The alert's
moment is its own field (`Alert.moment`), set with its words in `alertFor`: the
finished/failed split of `agent_completed` is what `alerts.events` filters on, like every
other moment.

**The waits that stay quiet**, all from the team's older notification script, which this
replaces: the permission prompt about six seconds after a question (the same wait — a mark
file per session, `/run/user/<uid>/cc-smart-dev-kit-notify-asked-<session>`, holds until anything
ends it, and only for ten minutes so a wait that ended unrecorded never hides a later alert);
a turn another session started (`startedByPeer`: `turnOrigin: "peer"` without a
`senderTaskId`, a human prompt into the turn or a helper agent's launch alerting as before);
the same error twice in a row (a per-session file remembers the last error, cleared by a turn
that ends well); a stop `verify-gate` will block (the turn goes on, so the finished alert
waits for the stop that ends it — a per-session file remembers the alert already shown for
the turn, cleared at the next prompt). One alert per
session per event, never two.

**The routes**, chosen per alert: **the desktop** — `notify-send` on Linux, and only with a
desktop (`DISPLAY` or `WAYLAND_DISPLAY`: a session over SSH with no desktop has no bus to
show anything on), `osascript` on
macOS, a PowerShell toast on Windows (`src/hooks/windows-toast.ts`, `docs/windows-notify.md`),
plus the freedesktop sound through `paplay`; **the SSH terminal** — with no desktop
route and `SSH_CONNECTION` or `SSH_TTY` set, the same title and body as OSC 777
(`ESC ] 777 ; notify ; <title> ; <body> BEL`), sanitised with `oneLine` (controls gone, one
line, capped) and sent through the hook's `terminalSequence` output field (Claude Code 2.1.141
and later writes it to the session's terminal itself, and wraps it for tmux — a wrapped
sequence in the field is rejected, so the field carries the bare one), or straight to
`/dev/tty` (wrapped for tmux by `tmuxPassthrough` when `TMUX` is set) for a Claude Code
without that field; **Warp at the far end** — `farEndIsWarp` sends that SSH alert in Warp's
own agent format instead: OSC 777 with `warp://cli-agent` and one JSON object (`v`, `agent`,
`event`, `session_id`, `cwd`, `project`, then `response` for a stop or `summary` for a wait;
`error_type` only when the input names a real StopFailure reason, because Warp shows it as a
prefix of the text). Warp shows its popup while the person is in front, and a desktop
notification with a sound while they are not, and it decides the sound itself: no extra BEL.
Proved live 2026-10-18 on a Windows PC reached over SSH from a pane without Warp's shell
integration; the plain OSC 777 gave a silent Windows notification there. The far end counts
as Warp when `isWarpTerminal` says so, when `LC_TERMINAL=WarpTerminal` arrives (the client's
`SetEnv`, through sshd's usual `AcceptEnv LANG LC_*`), or when the person set `sshWarp`; a
named terminal in `TERM_PROGRAM` (VS Code's `vscode`) says it is not Warp, while tmux's own
`tmux` says nothing about the far end. One function maps the event (`warpEventOf`): finished
→ `stop`, failed → `stop_failure`, and every wait and question — a permission prompt, a
crew session's prompt, agent view's `agent_needs_input`, a question — → `permission_request`.
`agent_needs_input` is never sent: Warp showed only a tab badge for it and no popup, while
`permission_request` showed the popup (proved live on Windows Warp, 2026-10-19);
**the session's own device** — for an event whose answer Claude Code does
not read at all (`StopFailure`), for agent view's own alerts (the list reads the field but
never writes it out: only a session's conversation view sets up that writer, 2.1.302, so the
list's own pty is the route there), and for a Claude Code too old for the field, where `/dev/tty`
is tried first and a hook on 2.1.301 has no controlling terminal at all (ENXIO): the pty
Claude Code is attached to, found from its pid (`CLAUDE_PID`, then the hook's parent:
`/proc/<pid>/fd/0`, then 1 and 2), written to only when this user owns it, and wrapped for
tmux like `/dev/tty` (proved live 2026-10-16: the alert arrived in the terminal beyond tmux,
exactly once; `src/hooks/terminal.ts`, `docs/claude-code-contract.md`); **nothing** — no desktop route, not over SSH, or **inside Warp** with
Warp's own plugin on (`TERM_PROGRAM=WarpTerminal`, or the `WARP_*` pair a background session
keeps), whose hooks already show a finished turn, a question, a permission prompt and an
error. In Warp ours plays only the sound, and shows a question (`elicitation_*`), a waiting
agent or agent view's finished/failed alert itself (Warp's plugin has no `agent_completed`):
those may sit in a tab the person is not looking at (owner). A
session that is none of those — no desktop, no SSH, no Warp — gets nothing, and that is not a
failure: an alert on every turn would be noise.

**The Linux desktop gives the alert more, where its tools are there**
(`src/hooks/desktop-alert.ts`): a click raises the session's terminal window, the alert
leaves the screen for the notification centre after a minute (`ALERT_SCREEN_MS`), only one
alert per session is on screen at a time, and XFCE's Do Not Disturb keeps an ordinary
alert's sound off (an urgent one sounds anyway, as XFCE shows those under Do Not Disturb
too). These are the desktop behaviours of the older notification script this replaces,
ported so a machine that moves to the plugin loses nothing.

Everything that waits runs in a detached worker — the `alert-worker` the usage-limit alert
already uses, through the launcher, never in the hook — and each extra runs only where its
tool is on PATH: `xdotool` to raise a window (the terminal's `WINDOWID`, or a VS Code or
Warp window found by its class and title); `gdbus`, the notification server itself, for the
notification's id — the minute and the one-per-session rule need it, and `notify-send`
never says which id it got — or a `notify-send` whose `--help` lists `--action` and
`--wait`, where the server has actions; `xfconf-query` for XFCE's Do Not Disturb setting.
Without them the hook keeps today's plain `notify-send`, and `doctor` names a missing tool
as information. One thing the older script did is **not** ported: picking the session's tab
inside XFCE Terminal (its accessibility service, AT-SPI, reached through Python bindings
this plugin does not carry) — the window is raised, and the tab stays where it is. macOS,
Windows and the SSH terminal are unchanged.

**The title** is `<kind> · <session>`: the session's newest `customTitle` from the
transcript's tail (`cleanSessionName`), else the folder of the hook's `cwd`; agent view's
alerts carry no session name, because their input is the list's. **The settings**
are `~/.claude/cc-smart-dev-kit/notify.json`: `desktopSound` (default on), `sshBell` (default off,
one BEL after an SSH alert) and `sshWarp` (default off: the fallback that says the far end of
an SSH session is Warp). The notifier starts detached, so a slow one never holds the
hook. `setup` does not touch anyone's own notification hooks: a person with those removes
them by hand when they switch to this one.

**tmux** (`src/setup/tmux.ts`): a sequence written inside a pane is parsed by tmux and
dropped, so it reaches the outer terminal only inside tmux's passthrough wrapper, and only
while `allow-passthrough` allows it. `cc-smart-dev-kit setup` adds one managed line (`set -g
allow-passthrough all`) to `~/.tmux.conf` when tmux is installed — `all`, so an alert from a
window the person is not looking at arrives too (owner) — prints `tmux set -g
allow-passthrough all` when a server is running (it never changes a running server itself),
and `restore` takes the line out through the same `file-line` record (`managed-line.ts`) that
keeps every line the person wrote. `doctor` reports, as information, a missing line and a
running server that does not pass alerts through.

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
session steps around by choosing the other shell tool is not a limit. The route and the lead's
background move stay **Bash only**: their rewritten line names the `sh` launcher and, for
anything but one plain command, `sh -c`, which the PowerShell tool cannot run — a wrong rewrite
is worse than none, so a PowerShell line is judged and otherwise left as it was written.

**The judge** (`src/hooks/bash-judge.ts`, the rules; `job-route.ts`, the answer) reads the line
with the one shell reader and answers four things:

- **a raw background session**, `claude --bg` / `--background`: an **ask** in an attended
  session, a **denial** in `claude -p` (nobody answers there) and in a crew session (a crew
  session never starts crew sessions). The ask shows the `crew start` line — that session is
  recorded in the store, gets its own worktree, a lead and a report (D25) — and the line for a
  session that leads nothing yet (`crew lead --plan`). The crew launcher picks the kind's
  model and effort; for another one the person starts the session themselves (the launcher
  refuses an override the Agent guard would ask about, W1a), so the judge never asks a second
  time about an override.
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
- **a crew session's lead commands** (`crew start`, `crew answer`, `crew stop`, `crew rm`,
  `crew resume`, `crew watch`, `crew lead`, `crew lead tell`): denied, in the launcher's own
  words (`CREW_NEVER_RUNS`, `src/crew/brief.ts`): the need goes to the lead with `crew report
  --question`. The hook's environment is the session's own, so a line that unsets the variable
  itself (`env -u CC_SMART_DEV_KIT_CREW …`) does not get past it.
- **polling**: a `crew list` / `crew status` read or a `claude agents --json` read that repeats
  over time — inside a `while` / `until` / `do` loop (bash, the condition included) or a
  PowerShell `while` / `do`, or a `watch` — or beside a `sleep` or `Start-Sleep`, is denied — a
  crew session's news arrives by itself, through the lead's watch and the monitors. A
  `for` / `foreach` over a fixed list with no wait is no poll (F2a-6), and neither is a read
  whose output a later loop walks (`claude agents --json | … | while read id; do …`). One read
  passes. `crew watch` is a lead's command, so a crew session is denied it (above), never
  read as a poll.

**The route** is the heavy-job queue's door, and the project's opt-in: with
`"jobs": { "route": true }` in its `.claude/cc-smart-dev-kit.json` (the `switches.jobRoute`
switch), a command its kinds classify as heavy is sent through the queue instead of running raw
(`docs/jobs.md` § The route). It answers with Claude Code's `updatedInput` — the same tool input,
its `command` replaced by `"$HOME/.local/bin/cc-smart-dev-kit" job run --kind <kind> --
<command>` — proved live on 2.1.301 (`claude-code-contract.md`). It gives no
`permissionDecision`: the rewrite replaces the input and the permission system still decides
about the new command, so a person's own rule for Bash keeps working. **Only a line whose every
command is heavy, a `cd` or an assignment is queued** (`classifyRoutableLine`); any other line
runs raw. Why: Claude Code matches a person's `Bash(…)` rules against the command it is about
to run and does not look inside `bash -c '…'`, so a rewritten `tsc && rm -f x` would hide its
`rm` from a `Bash(rm:*)` rule (proved on 2.1.308, `claude-code-contract.md`).
`REWRITE_SUPPORTED` in the hook is the one switch, and with it false the same command line is
denied instead, never silently left raw. A command already inside `cc-smart-dev-kit job run` is
left alone. A name the project's `package.json` defines as a script is matched only by a
`script` kind, never by a tool of the same name: a `tsc` script that already wraps the job is
not wrapped again (`docs/jobs.md` § The classifier). It is the one guard that changes the call
rather than asking about it.

**A lead never waits on what it started** (D22): in a session recorded as a lead (`crew lead`,
`readLead`), a CI watch (`gh pr checks --watch`, `gh run watch`), a queued job and the project's
full check (`bun run check`, `npm run check`, … — its package manager's `check` script) are
moved to the background with `run_in_background: true`, proved honoured on 2.1.308 (offline:
a fake Anthropic server, a throwaway `HOME`, the `job-route` bundle as the project's hook — the
tool result read `Command running in background with ID: …`; L1a.1 proved the same on 2.1.306).
A routed heavy job gets the queue
and the background in one rewrite. The whole line must be that thing (and `cd`s and
assignments), so a compound line is left as the model wrote it, and a call already asking for
the background keeps its own input.

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
nothing (`docs/windows-setup.md`);
and, from the older notification script, the tab pick inside XFCE Terminal (AT-SPI reached
through Python bindings, which this plugin does not carry — the window raise itself came
over, § The notifier). The alerts, the waits they skip, the titles, the sounds, the click
that raises the window, the minute on screen, the one-alert-per-session rule and the XFCE
Do-Not-Disturb check are the same as that script's — they are the `notify` hook's contract
(§ The notifier, `src/hooks/desktop-alert.ts`).

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
(`MACHINE_WIDE_HOOKS` in `src/hooks/specs.ts`: `stop-failure`, `update-check`, `notify` and
`agent-guard`): they answer about the machine, not the project, so a project hook on their
event is not a second copy of a plugin piece.

**A plugin hook the plugin retires** keeps its name in the schema as a retired name
(`RETIRED_HOOK_NAMES` in `src/project/config.ts`; today `serena-root`, 0.6.0): a project file
that still lists it parses, and the name silences nothing, because no hook of that name runs.
Refusing it would fail the strict parse, and every guard would then ask about every call.
`doctor` prints one `·` line that the name can go.

The retired worktree engine is not part of the switch: a project that still has its lines or
its fields fixes both with one run of `cc-smart-dev-kit project init` (README § Worktrees), in
one commit. `cc-smart-dev-kit doctor` names what is left.
