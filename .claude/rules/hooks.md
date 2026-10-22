---
paths:
  - "src/hooks/**"
  - "src/entries/after-merge.ts"
  - "src/entries/agent-guard.ts"
  - "src/entries/fable-session.ts"
  - "src/entries/git-guard.ts"
  - "src/entries/job-route.ts"
  - "src/entries/main-folder-guard.ts"
  - "src/entries/merge-guard.ts"
  - "src/entries/message-guard.ts"
  - "src/entries/notify.ts"
  - "src/entries/playwright-output.ts"
  - "src/entries/review-record.ts"
  - "src/entries/session-escape-guard.ts"
  - "src/entries/session-name.ts"
  - "src/entries/stop-failure.ts"
  - "src/entries/subagent-background.ts"
  - "src/entries/update-check.ts"
  - "src/entries/worktree-leftovers.ts"
  - "plugin/hooks/**"
  - "plugin/bin/**"
---

# Hooks: The Contract

A hook is a program Claude Code runs at a fixed moment (a session starts, a tool is
about to run, a worktree is made). This is the contract the hooks follow; how they fit
together is `docs/design.md` § The hooks. The Claude Code behaviour behind each point, and
the version it was proved on: `docs/claude-code-contract.md`. The `paths:` list names the
hook entries only: `cli.ts`, `router.ts` and `portal.ts` are other bundles.

## Who wires it

Every spec in `src/hooks/specs.ts` is a **plugin** hook (`HOOKS`): in
`plugin/hooks/hooks.json`, so it runs in every project. It stays silent in a project without
`cc-smart-dev-kit.json`, and in one whose `ownHooks` names it (§ The project's own copy).

**Every project uses Claude Code's own worktrees** (`<repo>/.claude/worktrees/<name>` on
`worktree-<name>`), and they need no hook. The plugin's old worktree engine is retired
(1.0.0): its three hook names only print the fix, and `project init` takes their lines out.

**Never wire WorktreeCreate or WorktreeRemove in `hooks.json`.** A WorktreeCreate hook
replaces Claude Code's own creation in every project where it is wired, for sessions and
subagents, and one that prints no folder makes the creation fail (proved live). So a plugin
WorktreeCreate cannot step aside for a project that did not opt in, and a hook-made worktree
loses Claude Code's lock, its cleanup marker, `-w "#123"` and its Git LFS handling.

**A plugin SubagentStop hook that touches no worktree is fine.** Three are wired, all on the
subagent's stop alone: `review-record` (which also runs on SubagentStart to note the commit
and branch a review agent starts on, and records the review of that start commit, on that
branch, at the stop — commits made while it read count as change after the review,
`src/workflow/review-cover.ts`), `subagent-background` (one block when a subagent ends its
turn with background work it started still running, `src/hooks/subagent-background.ts`) and
`agent-usage` (each subagent's cost on record, `src/hooks/agent-usage.ts`: **machine-wide**,
the person's spend, so it records with no `cc-smart-dev-kit.json` and outside git). The two
project-scoped ones can be silent for a project that never opted in, none removes anything,
and no two answer the same thing: `review-record` writes the review,
`subagent-background` may continue the agent, and `agent-usage` only appends a line.
`entries.test.ts` fails when `hooks.json` wires
WorktreeCreate, WorktreeRemove, or a SubagentStart or SubagentStop entry outside the exact
list it names (`review-record` on SubagentStart; `review-record`, `subagent-background` and
`agent-usage` on SubagentStop), so a new entry is checked before it is wired. The review gate `review-record`
feeds stops mistakes, not a same-user process set on getting past it
(`docs/design.md` § The review record).

## The plugin's hooks: shell form, through the bun shim

Every entry in `plugin/hooks/hooks.json` uses the shell form, never the exec form:

```json
{ "type": "command", "command": "\"${CLAUDE_PLUGIN_ROOT}/bin/cc-smart-dev-kit-bun.sh\" --missing=ask \"${CLAUDE_PLUGIN_ROOT}/dist/<name>.js\"", "timeout": 10 }
```

- **Why not exec form:** on Windows exec form needs a `command` that is a real executable,
  and a shell script is not one — such a hook never starts there, and a guard that cannot
  start lets the call through. In shell form Claude Code gives the string to a shell: `sh -c`
  on macOS and Linux, Git Bash on Windows, where a first token ending in `.sh` is run as
  `bash <command>`, so the shim needs no execute bit. `docs/windows-hooks.md`, and
  `docs/claude-code-contract.md` § Windows for what that rests on and what is still owed a
  real Windows run.
- **The quotes are load-bearing:** in shell form Claude Code exports `${CLAUDE_PLUGIN_ROOT}`
  rather than substituting it, so the shell expands it — only the quotes keep a plugin folder
  with a space in it one word.
- **Never `"command": "bun"`.** Claude Code started from a desktop launcher or a service
  may have no bun on PATH, and then the hook never runs (seen live). `plugin/bin/cc-smart-dev-kit-bun.sh`
  finds bun where the launcher does (the bun baked into `~/.local/bin/cc-smart-dev-kit`,
  `$BUN_INSTALL/bin/bun`, `~/.bun/bin/bun`, then PATH — each also as `bun.exe`, which is
  what Windows has); it uses only shell built-ins, so it works with an empty PATH too.
  **It starts bun with `--no-env-file` and a `--config=` flag
  pointing at the plugin's own empty `bunfig.toml`** (`plugin/bunfig.toml`), like the launcher and
  `bin/cc-smart-dev-kit`: bun would otherwise add the working folder's `.env` files to the
  hook and run its `bunfig.toml`, and a hook must see the environment Claude Code gave it.
  `src/hooks/bun-shim.test.ts` and `src/setup/bun-shim.test.ts`
  check the order, both names, both flags and both modes. **A Bun older than `MIN_BUN` fails closed
  here**, the same way as a missing one, with its own message: an older Bun drops
  `--no-env-file` without a word, so the hook would run on guarantees the plugin does not
  have. The shim asks `bun --version` only when the bun is not the one setup baked into the
  launcher — that one setup already proved, so an ordinary hook pays nothing for the check.
  On Windows the same checks read the `bun.exe` it found, through the same MSYS path rules.
- **The shim's first argument says what to do when no bun is found**, and is never passed
  to bun: `--missing=ask` prints one PreToolUse answer on stdout, asking the person, and
  exits 0; `--missing=quiet` writes one line on stderr and exits 0; `--missing=fail` writes
  one line on stderr and **exits 1**, for the command (`plugin/bin/cc-smart-dev-kit`), which must
  never report success when it did not run. A hook never stops a session on its own.
- **A guard also asks when its bundle file is gone** (`--missing=ask` checks the file): Claude
  Code deletes an old plugin version folder some time after an update, and bun told to run a
  file that is not there only prints its error and exits 1, which Claude Code reads as a failure
  that goes on. Every guard's `hooks.json` entry also says **`"onFailure": "block"`**, the
  second belt for a hook that cannot start at all (the shim is gone too).
- **A PreToolUse guard passes `--missing=ask`** — with no bun it asks instead of letting
  the tool run: a guard fails closed. **Every other hook passes `--missing=quiet`**, so a
  missing bun is one stderr line and the session goes on.
- `<name>` is a bundle built from `src/entries/<name>.ts` (`bundles-and-releases.md`).
  The hook's logic lives in `src/hooks/`, where it can be tested; the entry is two lines:
  `runHookEntry(<its spec>)` from `src/hooks/run.ts`, with the spec from `specs.ts`.
- The command string is fixed: the quoted shim, the mode, the quoted bundle, nothing else.
  `entries.test.ts` asserts the whole string, so a stray quote or a bare path fails a test
  rather than a person's session.
- A new plugin hook: its logic in `src/hooks/`, its spec in `specs.ts` (and in `HOOKS`), its
  entry, its `hooks.json` entry, and a row in `src/hooks/matrix.test.ts`. `entries.test.ts`
  fails when the four do not match.

## The user's hook: `cc-smart-dev-kit hook notify`

- The command is a shell string with the launcher's full path:
  `"$HOME/.local/bin/cc-smart-dev-kit" hook notify`. The shell fills in `$HOME`, so it works
  whatever PATH Claude Code has; the launcher runs its baked bun. The bare name `cc-smart-dev-kit`
  would need `~/.local/bin` on that PATH.
- **The same line works on Windows**, where the shell is Git Bash: no `args`, so Claude Code
  passes the string to a shell; Git Bash sets `$HOME`; and it runs the extensionless
  `#!/bin/sh` launcher on the strength of its `#!` first two characters, since Windows has no
  execute bit (`docs/windows-hooks.md`). The Windows CI job runs this exact line
  (`scripts/windows-hook-smoke.sh`).
- `setup` writes the line into the person's own settings (`src/setup/user-notify-hook.ts`);
  what the hook does is in § The notifier.
- The worktree engine's names are retired: `cc-smart-dev-kit hook worktree-create` and the
  other two print the fix and exit 1 — never 2, which blocks a `SubagentStop` and would loop
  every subagent (`src/hooks/settings-hooks.ts`).

## The frame: every hook runs through `run.ts`

`handleHook` runs each hook in this order; never skip a step in a new hook.

1. **Read the input**; not JSON, another event, or a `cwd` outside git: nothing to do.
2. **A guard's crew part** (`HookSpec.crewLimits`), before `ownHooks` and before the file (§ A
   crew session's own limits).
3. **`ownHooks`** (below).
4. **Read `cc-smart-dev-kit.json`**; broken or too new: fail closed (below).
5. **Run.** A guard's crash answers through `onCrash` (§ Fail safe).
6. **Record an ask**: an answer that asks the person is appended to `guard-asks.jsonl`.

The frame stays general: later hooks (notifications, the routing of heavy jobs) are new
specs in it.

## A crew session's own limits

D24 and D47 give a crew session three refusals that **no project can switch off**: it never
pushes, it opens no pull request, and its message to another crew session carries the
`crew tell` tag (and its message to its own lead goes through `crew report`). They are the
**crew part** of the three guards that own their detectors — `crewPushAnswer`
(`git-guard.ts`), `crewPrAnswer` (`merge-guard.ts`), `crewMessageAnswer`
(`message-guard.ts`) — and the frame runs each before `ownHooks` and before
`cc-smart-dev-kit.json` is read. So the refusal holds in a project that never opted in, in
one whose file is broken or too new, and in one whose `ownHooks` lists its own copy of the
guard. Without `CC_SMART_DEV_KIT_CREW` the part is silent: an ordinary session pays nothing,
and the guard's other answers are exactly as they were.

This is the same reason `alwaysOn` exists for `job-route` and `session-escape-guard`: a
limit on what the session itself may do cannot live behind a switch the session can reach.
The difference is that these three guards keep a project part the project may still replace;
only the crew part is fixed. The detectors are shared with each guard's own `run` (one
function, never a copy), so a spelling that gets past one gets past both.

## Find the project from the input's `cwd`

The hook reads its input as JSON on stdin. **Use the input's `cwd`** (`locateCheckout()`,
then `loadProjectConfig()`, from `src/project/`). It follows the session into a worktree.

- Never `CLAUDE_PROJECT_DIR`: it stays at the folder the session started in.
- Never `process.cwd()`.
- Without a `.claude/cc-smart-dev-kit.json`, every plugin hook stays silent. A project that never
  opted in must not notice the plugin.

## A machine-wide hook

Some hooks answer about the machine, not a project: `agent-guard` (the model a launch runs
on), `job-route` (the shell judge, on Bash and PowerShell: a raw `--bg` launch, a `-p` run's
model and effort, a crew session's `crew start`, a polling loop), `fable-session` (the model the
session itself runs on),
`crew-role` (a crew session's own card, ask and report), `lead-notes` (a lead's missed crew
news) and `notify` (the alerts).
`playwright-output` is machine-wide too — it puts a file the
CALLER names into the browser's own output folder (only while the live `playwright`
registration is the one setup recorded; a server of the person's own is left alone entirely),
and the browser is the machine's —
and, like `notify` and `update-check`, it is a `USER_HOOKS` bundle: no frame, no
`cc-smart-dev-kit.json`, no `ownHooks`. `notify` is a `USER_HOOKS` bundle like `update-check`: it
never enters the frame, needs no `cc-smart-dev-kit.json`, and its opt-in is the machine. (The one
thing it reads from a project that has one is its `workflow.alerts` settings — which moments
alert, and whether a sound goes with them — through `src/workflow/alerts.ts`.) It alerts on
`Notification` (the types a session's own process raises: `PLUGIN_NOTIFY_TYPES`), `Stop`,
`PreToolUse` on `AskUserQuestion|ExitPlanMode`, and `StopFailure`
(`rate_limit` only where the `stop-failure` hook will not show its own alert —
`stopFailureWillAlert`: no desktop, no gateway set up, or a short rate limit), and clears its mark
on `PostToolUse`, `PostToolUseFailure` and `UserPromptSubmit`. A background session
(`CLAUDE_JOB_DIR`, `src/hooks/background-session.ts`) shows no alert of its own — it inherits
the daemon's display and terminal variables, and agent view alerts for it while the list is
open — and the usage-limit alert stays silent there too. The route is the desktop
(`notify-send` — on a Linux desktop with the right tools the detached `alert-worker` in its
place, which waits for a click and raises the session's window, `src/hooks/desktop-alert.ts`
— `osascript`, with the freedesktop sound), or — with no desktop route here and
an SSH session (`SSH_CONNECTION`/`SSH_TTY`) — the terminal as OSC 777, or in Warp's own agent
format when the far end is Warp (`farEndIsWarp`: Warp's own variables, else `LC_TERMINAL=WarpTerminal`,
else the `sshWarp` setting); inside Warp whose own plugin is on it stays quiet but for the sound,
a waiting question, a waiting agent and agent view's finished/failed alert; with nowhere to show it, nothing. The whole contract, the marks and the
three settings: `docs/design.md` § The notifier.

**The notifier has a second wiring, in the person's user settings.** Agent view
(`claude agents`, the list of sessions) raises `Notification` with `agent_needs_input` and
`agent_completed` in its own process, and runs **only the hooks in settings files, never a
plugin's `hooks.json`** (proved live on 2.1.302; `docs/claude-code-contract.md`). So `setup`
manages one entry under `hooks.Notification` in `~/.claude/settings.json`
(`src/setup/user-notify-hook.ts`): matcher `AGENT_VIEW_MATCHER`, the command
`"$HOME/.local/bin/cc-smart-dev-kit" hook notify`, timeout 10. It runs the same function the
bundle's entry runs (`src/hooks/notify-entry.ts`), through the launcher, so an update that
deletes the old version folder cannot break it. `plugin/hooks/hooks.json` therefore matches
only `NOTIFY_MATCHER` (a session's own types): with both wirings the alert would run twice
there. The code accepts both lists (`NOTIFY_TYPES`, one home in `src/hooks/notify-types.ts`);
`setup` writes the entry through the managed-hook path (`src/setup/managed-hook.ts`: backup,
atomic write, `owned-hooks.json`, `restore` removes it) and replaces a hand-written entry
that runs the plugin's own `dist/notify.js` rather than adding a second. `doctor` checks the
entry. On Windows the same line holds in Git Bash (`docs/windows-hooks.md`).

**A hook's answer can carry `terminalSequence`** (Claude Code 2.1.141+): the OSC in that
output field is written to the session's terminal by Claude Code itself — the only route for
a hook with no controlling terminal — and Claude Code wraps it for tmux itself, so the field
carries the **bare** sequence and a wrapped one is rejected whole
(`docs/claude-code-contract.md`). An event whose output is not read (`StopFailure`), and agent
view's own alerts (the list, `claude agents`, reads the field but never writes it out), write a
terminal device instead: `/dev/tty` first, wrapped for tmux there (`forTty`), and, where the
hook has no controlling terminal at all (2.1.301: ENXIO), the session's own device — the pty
Claude Code is attached to, found from its pid (`src/hooks/terminal.ts`) — never both.

`agent-guard` is a plugin hook (`HOOKS`) that is machine-wide all the same: it runs with or
without `cc-smart-dev-kit.json`, a broken or too new file does not change its answer, and a folder
that is not in git is judged the same way. The frame hands such a hook the input and the
environment (`HookEnvContext`) where its checkout or config step does not apply, and the
spec's `onConfigProblem` and `outsideGit` judge on. It is still in `PLUGIN_HOOK_NAMES`, so
a project that runs its own Agent guard silences it through `ownHooks`, which is read on its
own, before the file.

`session-escape-guard` is machine-wide in the same way, and **`alwaysOn`** (`HookSpec.alwaysOn`):
the frame skips its `ownHooks` step and `PLUGIN_HOOK_NAMES` leaves its name out, because the
project's file is one of the things it guards (a session could list the guard there first).
**`job-route` is `alwaysOn` too**, for the same reason one step out: it limits what the session
itself may launch and run, and a session could otherwise switch the judge off by listing it in
the project's file. A guard whose answer limits what the session itself may do is `alwaysOn`;
any other machine-wide guard may be silenced by a project that runs its own copy. A name a
project file may already list for an `alwaysOn` hook that used to be switchable
(`UNSWITCHABLE_HOOK_NAMES`, today `job-route`) still parses, it silences nothing, and `doctor`
says it can go. `matrix.test.ts` checks both halves.

```json
{ "hookSpecificOutput": { "hookEventName": "PreToolUse", "permissionDecision": "allow", "updatedInput": { "command": "…" } } }
```

`updatedInput` (PreToolUse only, proved live on 2.1.301) replaces the tool's input for that
call: `job-route` uses it to send a heavy command through `cc-smart-dev-kit job run`, and — in a
lead — to add `run_in_background: true` to a CI watch, a queued job or the full check (proved
honoured on 2.1.308, and in L1a.1 on 2.1.306). The rewritten
command runs in the Bash tool's own shell, so it keeps the folder that shell is in (proved
live: after a `cd`, the rewritten command ran in the new folder, not in the hook's `cwd`).

## A user-level hook

A hook about the person, not a project (the StopFailure usage-limit alert) reads no
`cc-smart-dev-kit.json`. Its opt-in is the gateway: it acts only when `gateway.json` exists, so a
person who never set the gateway up does not notice it. It replaces nothing a project
wires, so it has no `ownHooks` step. Work that waits (a notification with buttons) runs in a
detached worker started through the launcher (`~/.local/bin/cc-smart-dev-kit alert-worker …`),
never from the plugin's version folder, which an update may delete while it waits; the
hook itself exits at once. A `claude -p` run may exit before the hook finishes and cut
it off (seen live, 2.1.300): keep the hook's own work short.

## The project's own copy: `ownHooks`

A project may still have its own copy of a piece the plugin now ships (a guard, a note).
Where both exist, **the project says which plugin hooks to keep quiet**: `ownHooks` in its
`.claude/cc-smart-dev-kit.json` lists them by name (`["git-guard"]`), and exactly those plugin hooks
**exit 0 and print nothing**, so the project's copy runs alone.

- It is explicit on purpose. A project hook on the same event is *not* enough to silence a
  plugin hook: it may be a logger, a different check, or a copy that does not cover the same
  commands — and a guard that goes quiet for something that does not replace it leaves the
  person unguarded.
- **A listed name silences a guard's project part only.** A crew session's three refusals —
  its push, its pull request, its peer message without the tag — are the guard's crew part,
  which the frame has already run before this step (§ A crew session's own limits): no
  `ownHooks` list, and no missing file, can switch them off.
- Only `ownHooks` is read there (`ownHooksOf` in `src/project/resolve.ts`, on its own, like
  `requires`), so it works even when the rest of the file is broken or needs a newer plugin.
- The names are validated against the plugin's own (`PLUGIN_HOOK_NAMES` in
  `src/project/config.ts`; a test keeps them equal to `HOOKS`): a typo fails the strict parse.
- **A retired plugin hook keeps its name** (`RETIRED_HOOK_NAMES` in the same file; today
  `serena-root`, 0.6.0): a project file that lists it still parses, the name silences
  nothing, and `doctor` prints one `·` line that it can go. **A hook a project can no longer
  switch off keeps its name the same way** (`UNSWITCHABLE_HOOK_NAMES`; today `job-route`, which
  became `alwaysOn` in 1.0.0): the file still parses, the name silences nothing, and `doctor`
  says it can go. Dropping a name from the schema
  would fail the strict parse, and every guard would then ask on every call. A hook you
  retire, or make `alwaysOn`, goes there.
- `cc-smart-dev-kit doctor`, run in a project, prints one `·` line per listed hook, **warns** (`!`)
  when a listed hook's event has no project hook left to answer, and warns when a project
  hook runs next to a plugin hook the list does not name (both may answer).

**The safe switch** (`docs/design.md` § The safe switch): the project lists its copies while
it still has them → removes them → empties the list → raises `requires`. Every hook gets an
`ownHooks` test (the matrix does it for all: a plugin hook listed there goes silent; one that
is not listed still speaks).

## Fail closed when `cc-smart-dev-kit.json` cannot be used

When the project's `cc-smart-dev-kit.json` needs a newer plugin (`CcSmartDevKitVersionError`) or
is broken (`CcSmartDevKitConfigError`), the hook cannot do what the project asked for. It
never goes on as if there were no file; it fails closed in the way that suits its event, and
the message (which names the update command, the file and field) reaches someone:

| Kind | Fails closed by |
|---|---|
| A guard (PreToolUse) | **asking** the person before every call in its domain: every command that runs git, every edit in the repo, every message |
| An informational hook | one line of context (`cc-smart-dev-kit: <message>`); `after-merge` only after a merge, `session-name` only on stderr |

For a plugin hook's project part `ownHooks` still comes first: a project that lists its own
copy there keeps it running. A guard's crew part has already run before both (§ A crew
session's own limits), so a broken or too new file never lets a crew session push, open a
pull request or send an untagged peer message.

## Quiet output

Claude Code reads a hook's stdout: a PreToolUse decision is JSON, and SessionStart's text
goes into the session's context.

- **stdout carries the contract's answer and nothing else.** No banners, no progress,
  no "ok". A setup command's output goes to stderr.
- Diagnostics go to stderr, one short line.
- A hook that has nothing to do prints nothing.
- `CC_SMART_DEV_KIT_HOOK_LOG`, when set, gets one JSON line per run (`run.ts`: the hook, the event,
  the input's `cwd`, the exit code, stdout, and the spec's `logFacts`): what `doctor --live`
  reads. `logFacts` is for facts about what the hook's own parser read (the git guard logs
  the programs of the command line), so a live check proves a guard **answered**, not only
  that it ran. It never changes the answer, and never goes on stdout.

## Reading a shell line: one reader

Every hook that asks what a Bash or PowerShell line runs reads it with `src/shell/command.ts`
(the git guard, the merge reader in `after-merge.ts`, job-route, the classifier). Never write a
second lexer or a split on `;` beside it: a guard and the queue must see the same commands.

- **The dialect comes from the input's `tool_name`** (`dialectOfTool`): Bash and PowerShell
  quote differently (`"C:\repo\"` ends at its last quote only in PowerShell). Not told the
  tool, a guard reads both (`readingsOf`); PowerShell runs nothing of a line with a bare `<`,
  so a bash here-doc read that way adds no question.
- **A guard reads every way a line may run**: both dialects when unknown, joined at a
  trailing escape and not, and blind when a quote never closes. A check for something
  that RAN (the after-merge note) reads the open quote as text.
- **The reader steps over every wrapper it knows** (`isWrapper`: `env`, `sudo`, `timeout`,
  `setsid`, `flock`, `script -c`, `busybox`, …) and reads the command inside, and a program
  named at run time (`$GIT`, `$(which git)`) comes back `computed`. **A guard whose domain
  words are in a computed command asks** rather than stay silent; in a crew session, whose
  words name a push or a pull request opening or merge, it denies instead (D24). A new
  wrapper or spelling
  goes in this one reader, never in a guard.
- **A new spelling that gets past a guard is fixed in the reader**, with a test named after
  the finding, never with a special case in one guard.
- A 64 KB line stays well inside the guard's time (`git-guard.test.ts`): no step may cost
  more than linear time, and git is asked once a folder per run.

## Timeouts

- Set `timeout` (seconds) on every hook in `hooks.json`. Do not rely on Claude Code's default.
- Every child process and network call inside a hook has its own timeout, shorter than
  the hook's (a `git fetch` 5 or 30 s, `gh` 10 s).
- PreToolUse runs before every matching tool call: keep it fast. No network, except where
  the guard's question *is* about the network — the merge guard's read-only `gh` calls (10 s
  each, and only for a command that really asks for a merge). **The merge guard also gives
  itself one deadline** (`GUARD_BUDGET_MS`, 25 s of its 30 s): each call gets the smaller of
  its own limit and the time left, and when too little is left for the next call the guard
  asks instead of overrunning — a PreToolUse hook Claude Code has to kill blocks nothing, so
  an overrun would be fail-open. Every git call in a guard takes `GUARD_GIT_TIMEOUT_MS` (5 s)
  or less, against the hook's own 10 s. The merge guard's review check adds a few git calls
  (`merge-tree`, `diff --numstat`, `check-attr`, `rev-parse` in `review-cover.ts`), each with
  the same limit and from the same budget: when the measurement does not fit, the guard asks
  with that reason instead of overrunning. **`after-merge` shares one budget the same way**
  (`src/hooks/budget.ts`, 25 s of its 30 s), so its children (the alias list, the worktree
  list, `gh pr view`, the origin) cannot add up past the hook; a note that would not fit is
  skipped whole. A hook that starts a child with the time left gives it no call at zero or
  less (`Bun.spawnSync` reads a timeout of 0 as no limit at all).
- A guard gets a short timeout; a hook that waits gets a long one.

## Fail safe

A bug in an informational hook must never stop a user's work. A bug in a **guard** must never
let a call through. Each hook's answer to its own failure, in one table (the same in
`docs/design.md` § One frame for every hook):

| Failure | A guard: `git-guard`, `merge-guard`, `main-folder-guard`, `message-guard`, `job-route`, `agent-guard`, `session-escape-guard`, `crew-role` | Any other plugin hook | `cc-smart-dev-kit hook notify` |
|---|---|---|---|
| Its own code throws | `onCrash`: **ask** about the call in the guard's domain (a call outside it: silent; on PostToolUse: silent, one stderr line) | one stderr line, exit 0 | one stderr line, exit 0 |
| The input is not JSON | **ask**, in general | one stderr line, exit 0 | one stderr line, exit 0 |
| `cc-smart-dev-kit.json` broken or too new | `onConfigProblem`: **ask** (`agent-guard`, `session-escape-guard`, `crew-role` and `lead-notes` judge the call anyway) | one line of context, or on stderr | not read |
| No bun, or one older than `MIN_BUN` | the shim's `--missing=ask`: **ask** | the shim's `--missing=quiet`: one stderr line, exit 0 | the launcher's line on stderr, exit 1 (Claude Code reads exit 1 as a failure that goes on) |
| The bundle file is gone (an update removed the version folder) | the shim **asks** | bun's own error, exit 1 | not applicable: the launcher runs the installed version |
| The hook cannot start, times out, or fails (an exit code other than 0 and 2) | `"onFailure": "block"` in `hooks.json`: Claude Code **blocks** the call | Claude Code goes on | Claude Code goes on |

**The portal's start part is inside the `update-check` hook, and its failures never reach that
hook's answer.** A port held by another program, a bundle that is missing, a server that does
not answer: each is one line in `<stateDir>/portal.log` by the detached starter, and the hook
still exits 0 with nothing on stdout. The next session start tries again, and `doctor`'s
portal line says what is wrong (`src/portal/lifecycle.ts`).

`"onFailure": "block"` sits on a guard's **PreToolUse** entry and on nothing else: Claude Code
ignores it on `Stop` and `SubagentStop` (and two other events), and on PostToolUse the call
already ran (`docs/claude-code-contract.md` § Hooks). `plugin/bin/cc-smart-dev-kit`, the command, runs
through the same shim with `--missing=fail`: no bun is one line on stderr and **exit 1**, because
a command must never report success when it did not run.

- A guard's `onCrash` is `guardCrash(what, inDomain)` in `specs.ts`; `entries.test.ts` runs every
  guard on an input that is not JSON and expects an ask, so a guard without one fails a test.
  An `onCrash` that throws is one stderr line, exit 0: never worse than the line.
- No informational plugin hook exits 1 (`crashExitCode`): a bug never stops a person's work.
- **`subagent-background` never blocks on a failure.** A broken input, a broken or too new
  `cc-smart-dev-kit.json`, and a transcript it cannot read are no block (one stderr line where
  the frame says one, exit 0): it can only block when it has read the agent's own transcript
  (JSONL, line by line) and found that agent's background task in a **tool result of its own
  Bash or Agent call** (`Command running in background with ID: <id>`, `agentId: <id>`) — never
  an id in its brief or in a file it read, so a subagent can always finish and a parent's task
  is never mistaken for its own.
- **`agent-usage` only appends its record.** An unreadable transcript, and a record that
  cannot be written, are one stderr line and exit 0; it never blocks and never prints on
  stdout, so a bug in it never stops a subagent (`src/hooks/agent-usage.ts`).
- **Every ask is recorded.** The frame appends one JSON line to `guard-asks.jsonl` in the state
  folder (`src/hooks/ask-log.ts`: the time, the hook, the session, the tool, a short reason put
  through `maskedLine`), kept small by the same rule as `update.log`. A write that fails is one
  stderr line and never changes the answer.
- A guard decides with a PreToolUse answer (`ask` or `deny`), never exit code 2.
- **Only the merge guard answers `allow`, and only for D31's exact form:** a command line that
  is nothing but `gh pr merge <n>` with flags gh 2.102.0 has, when the whole policy passed
  (`autoMerge` on, the base plain, the checks green, a review covering the fixes after it). An
  `allow` skips auto mode's own "Merge Without Review" rule for that call (proved live, L1a.5),
  so the guard's checks are what protect it; every other passing form — a wrapper, a second
  command, an alias, an unknown flag, an armed `--auto` merge — stays silent (so auto mode
  still applies), an unknown `gh pr merge` flag asks, and a crew session never gets it.
  The judgment itself is `src/workflow/merge-check.ts`, shared with `workflow merge-check`.
- A guard asks rather than denies when the person may mean it (a force-push); it denies
  only what is never right in that project (an edit in a guarded main checkout, a message
  to another project's session, a crew session's push, pull request or raw message to its
  lead — D24, D47: the lead merges locally and hears its crew through `crew report`).
  The crew refusals are the guard's crew part: they hold with no file and whatever
  `ownHooks` says (§ A crew session's own limits).
- **A hook's `ask` cannot be silenced by the person.** Claude Code asks on every matching
  call: "Yes, don't ask again" leaves no rule a PreToolUse hook's answer respects (proved
  live 2026-10-19, on the main-folder guard's Serena branch, retired in 0.6.0). So a guard
  asks only where the person's judgment is the point. When the fix is mechanical and Claude
  can do it itself, the guard denies and says the step, and the person is not interrupted on
  every call.
- Anything a guard cannot work out (a session record it cannot read, a branch it cannot
  name) lets the call through.
- **A hook may start a background program, and never run it.** D48: `after-merge` (a pull
  request merged into the base) and `worktree-leftovers` (an attended session start, at most
  once an hour per repo) make one call, `startAutoClean` (`src/worktrees/auto-start.ts`), which
  starts `src/entries/worktrees-clean.ts` detached and returns. The hook waits for nothing,
  judges nothing and removes nothing; the clean takes the machine-wide lock, and **its errors
  go to its own log** (`<stateDir>/worktrees-auto-clean.log`), never to the hook's answer. A
  hook test hands in a recorder (`recordingStarter`, `src/testing/hooks.ts`), so no process
  runs there. `worktrees.autoClean: false` starts neither.

## Session start never changes anything that matters

A SessionStart hook adds context, or refreshes managed files through `src/setup/` under its
lock. It never restarts a service, never changes a permission, and never asks a question.
Those happen only in a manual `cc-smart-dev-kit setup` run that shows the change first. A start
must stay quick: no fetch.

**The one exception is the portal (D10, the owner's):** the SessionStart part starts the
portal when it does not answer, and restarts it onto a newer version when an older one does
(`src/portal/session-start.ts`). It is not a service that changes sessions: it is a page on
this machine, it starts nothing when another program holds its port, it never asks, and it
never waits — the hook starts a detached starter and returns (`src/portal/lifecycle.ts`). It
never runs in `claude -p`, never on a `clear` or a `compact`, and its lines go to
`<stateDir>/portal.log`, never to the session.

The plugin's SessionStart hooks are the worktree-leftovers note, the session name, the Fable-session note
(`fable-session`, machine-wide), the crew session's role card (`crew-role`, machine-wide), the
lead's notes (`lead-notes`, machine-wide), the portal's start (D10) and the
background self-update (`src/update/`, the owner's decision of 2026-10-15). `update-check`
also brings the managed instructions copy up to this version when it is behind
(`refreshInstructionsAtSessionStart`): the copy only, under the state lock, never the
`CLAUDE.md` block, never a question, one stderr line on failure.

The self-update hook (`src/entries/update-check.ts`) is machine-wide, not a project's
piece, so it has no `cc-smart-dev-kit.json` and no `ownHooks` step. Its rules:

- **Return at once.** No network and no lock in the hook: it starts the check in a
  detached process (`detached: true`, stdio all `"ignore"`, so no pipe keeps Claude Code
  waiting) and returns. The test with a slow fake `claude` fails when it waits.
- **At most one check an hour**, decided again under the update lock in the background,
  so sessions that start together check once. Nothing while `update-hold` exists.
- **Claude Code's switches for updates win.** `DISABLE_AUTOUPDATER`, `DISABLE_UPDATES`
  or `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC` set (environment or the settings' `env`)
  without `FORCE_AUTOUPDATE_PLUGINS`: the hook only records "skipped: <name> is set",
  and the background check asks again under its lock. One list: `src/update/opt-out.ts`.
- **Silent on success.** It prints only one `systemMessage`, once, after a failed
  background update, and only to an attended session (`CLAUDE_CODE_SESSION_ATTENDED` is
  `0` for `claude -p`, whose hook input looks the same; `docs/claude-code-contract.md`).
  A marketplace that cannot be read is a failure only after 24 h in a row. The one other
  line: while a major version is held (D33, `src/update/major.ts`), one line at each session
  start (the input's `source` is `startup` or `resume`), never on a `clear` or a `compact`.
- **A major version is never installed in the background** (D33): the check holds it in
  `update-major.json` until the person's `cc-smart-dev-kit update`. An installed version
  that cannot be read (no `version` in `installed_plugins.json`, or not a version) is no
  major step: the check installs the newer one, as before the rule (`src/update/major.ts`).
- **Claude Code's own plugin auto-update stays off** (D39): it knows nothing of the hold.
  Each check first turns setup's own leftover `autoUpdate: true` to `false`
  (`turnOffLeftoverAutoUpdate`, `src/setup/auto-update.ts`): through `applyManagedJson`,
  under the state lock with no wait, and only while the key still holds setup's `true`. A
  value the person set, a busy lock or a broken settings file goes to `update.log` only;
  the check goes on.
- **Only Claude Code's own commands install:** `claude plugin marketplace update`, then
  `claude plugin update … --scope user`. Never `-y` (a marketplace-declared command needs
  a person), never a restart of the router or a session. They and the detached process
  run in the home folder with `gitEnv` (`commandContext`), and their output reaches a
  record only through `redactUrlsIn`.
- **The same entry starts the portal (D10).** `startPortalAtSessionStart` resolves the
  *installed* version's `dist/portal.js` (never this hook's own folder: an old session's hook
  after an update must not start an older portal), starts it detached with `--ensure`, and
  returns at once — nothing on stdout, nothing waited for. It does nothing in `claude -p`, on
  a `clear` or a `compact`, or when the install has no portal bundle (`doctor` says so). A
  failure is the starter's own line in `<stateDir>/portal.log`; the hook never fails on it.

## Tests

Each hook is tested by running it with a JSON input (`runHook` in `src/testing/hooks.ts`,
the same frame the entry uses), in a temp git repo (`testing.md`): with and without
`cc-smart-dev-kit.json`, in a worktree, with `ownHooks` listing it and with a project hook on the
same event that is not listed, with `requires` not met, and with a broken `cc-smart-dev-kit.json`.
Assert stdout exactly. Each plugin entry also runs once as a subprocess with stdin
(`entries.test.ts`); the user's notify hook through `cc-smart-dev-kit hook`
(`src/cli/hook-commands.test.ts`), once through the exact line setup writes. The shim has its
own tests (`src/hooks/bun-shim.test.ts`).
