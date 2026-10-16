---
paths:
  - "src/hooks/**"
  - "src/entries/**"
  - "plugin/hooks/**"
  - "plugin/bin/**"
---

# Hooks: The Contract

A hook is a program Claude Code runs at a fixed moment (a session starts, a tool is
about to run, a worktree is made). This is the contract the hooks follow; how they fit
together is `docs/design.md` § The hooks. The Claude Code behaviour behind each point, and
the version it was proved on: `docs/claude-code-contract.md`.

## Two kinds: who wires it

Each spec in `src/hooks/specs.ts` says who wires it (`wiring`):

- **The plugin** (`HOOKS`, `wiring: "plugin"`): in `plugin/hooks/hooks.json`, so it runs in
  every project. It stays silent in a project without `cc-smart-dev-kit.json`, and in one whose
  `ownHooks` names it (§ The project's own copy).
- **The project** (`PROJECT_HOOKS`, `wiring: "project"`): the project wires
  `cc-smart-dev-kit hook <name>` in its own `.claude/settings.json`, exactly as the README's
  § Worktrees shows (the lines come from `src/hooks/project-wiring.ts`; a test keeps the
  README the same). Today: the worktree engine (WorktreeCreate, WorktreeRemove,
  SubagentStop). No `ownHooks` step: the wiring is the project's opt-in.

**Never wire WorktreeCreate, WorktreeRemove or SubagentStop in `hooks.json`.** A
WorktreeCreate hook replaces Claude Code's own creation in every project where it is wired,
for sessions and subagents, and one that prints no folder makes the creation fail (proved
live). So a plugin WorktreeCreate cannot step aside for a project that did not opt in, and a
hook-made worktree loses Claude Code's lock, its cleanup marker, `-w "#123"` and its Git LFS
handling. `entries.test.ts` fails on a worktree event in `hooks.json`.

## The plugin's hooks: exec form, through the bun shim

Every entry in `plugin/hooks/hooks.json` uses the exec form, never a shell string:

```json
{ "type": "command", "command": "${CLAUDE_PLUGIN_ROOT}/bin/cc-smart-dev-kit-bun", "args": ["${CLAUDE_PLUGIN_ROOT}/dist/<name>.js"], "timeout": 10 }
```

- **Never `"command": "bun"`.** Claude Code started from a desktop launcher or a service
  may have no bun on PATH, and then the hook never runs (seen live). `plugin/bin/cc-smart-dev-kit-bun`
  finds bun where the launcher does (the bun baked into `~/.local/bin/cc-smart-dev-kit`,
  `$BUN_INSTALL/bin/bun`, `~/.bun/bin/bun`, then PATH); it uses only shell built-ins, so it
  works with an empty PATH too. `src/hooks/bun-shim.test.ts` and `src/setup/bun-shim.test.ts`
  check the order and both modes.
- **The shim's first argument says what to do when no bun is found**, and is never passed
  to bun: `--missing=ask` prints one PreToolUse answer on stdout, asking the person, and
  exits 0; `--missing=quiet` writes one line on stderr and exits 0. A hook never stops a
  session either way.
- **A PreToolUse guard passes `--missing=ask`** — with no bun it asks instead of letting
  the tool run: a guard fails closed. **Every other hook passes `--missing=quiet`**, so a
  missing bun is one stderr line and the session goes on.
- `<name>` is a bundle built from `src/entries/<name>.ts` (`bundles-and-releases.md`).
  The hook's logic lives in `src/hooks/`, where it can be tested; the entry is two lines:
  `runHookEntry(<its spec>)` from `src/hooks/run.ts`, with the spec from `specs.ts`.
- No shell string: no quoting bugs, the same on every system.
- A new plugin hook: its logic in `src/hooks/`, its spec in `specs.ts` (and in `HOOKS`), its
  entry, its `hooks.json` entry, and a row in `src/hooks/matrix.test.ts`. `entries.test.ts`
  fails when the four do not match.

## The project's hooks: `cc-smart-dev-kit hook <name>`

- The command is a shell string with the launcher's full path:
  `"$HOME/.local/bin/cc-smart-dev-kit" hook <name>`. The shell fills in `$HOME`, so it works
  whatever PATH Claude Code has; the launcher runs its baked bun. The bare name `cc-smart-dev-kit`
  would need `~/.local/bin` on that PATH.
- `src/entries/cli.ts` runs the spec through `runHookEntry`, the same frame and the same
  answers as a plugin hook's entry.
- A new project hook: its logic in `src/hooks/`, its spec in `specs.ts` (and in
  `PROJECT_HOOKS`), its timeout in `project-wiring.ts`, the README block, and a row in
  `matrix.test.ts`.

## The frame: every hook runs through `run.ts`

`handleHook` runs each hook, of both kinds, in this order; never skip a step in a new hook.

1. **Read the input**; not JSON, another event, or a `cwd` outside git: nothing to do.
2. **`ownHooks`** (below), for a plugin hook only.
3. **Read `cc-smart-dev-kit.json`**; broken, too new, or without what the hook `needs`: fail
   closed (below).
4. **Run.**

The frame stays general: later hooks (notifications, the routing of heavy jobs) are new
specs in it, of either kind.

## Find the project from the input's `cwd`

The hook reads its input as JSON on stdin. **Use the input's `cwd`** (`locateCheckout()`,
then `loadProjectConfig()`, from `src/project/`). It follows the session into a worktree.

- Never `CLAUDE_PROJECT_DIR`: it stays at the folder the session started in.
- Never `process.cwd()`.
- Without a `.claude/cc-smart-dev-kit.json`, every plugin hook stays silent. A project that never
  opted in must not notice the plugin.
- The engine makes a subagent's worktree in Claude Code's own shape:
  `<main checkout>/.claude/worktrees/agent-<hex>` on `worktree-agent-<hex>`, from the
  remote's default branch, or HEAD with `worktree.baseRef: "head"` or no remote;
  `.worktreeinclude` copied. SubagentStop finds it by that shape. A change to that shape
  needs the contract row proved again first.
- A session's **new** branch is cut from `origin/<base>` right after
  `git fetch origin <base>`, so a repo with no `origin` cannot make one: WorktreeCreate
  fails closed and says the fetch failed. An existing branch is checked out all the same.

## A machine-wide hook

Some hooks answer about the machine, not a project: `agent-guard` (the model a launch runs
on) and `notify` (the alerts). `notify` is a `USER_HOOKS` bundle like `update-check`: it
never enters the frame, reads no `cc-smart-dev-kit.json`, and its opt-in is the machine. It alerts on
`Notification`, `Stop`, `PreToolUse` on `AskUserQuestion|ExitPlanMode`, and `StopFailure`
(`rate_limit` only where the `stop-failure` hook will not show its own alert —
`stopFailureWillAlert`: no desktop, no gateway set up, or a short rate limit), and clears its mark
on `PostToolUse`, `PostToolUseFailure` and `UserPromptSubmit`. The route is the desktop
(`notify-send`, `osascript`, with the freedesktop sound), or — with no desktop route here and
an SSH session (`SSH_CONNECTION`/`SSH_TTY`) — the terminal as OSC 777; inside Warp whose own
plugin is on it stays quiet but for the sound and a waiting question; with nowhere to show it,
nothing. The whole contract, the marks and the two settings: `docs/design.md` § The notifier.

**A hook's answer can carry `terminalSequence`** (Claude Code 2.1.141+): the OSC in that
output field is written to the session's terminal by Claude Code itself — the only route for
a hook with no controlling terminal — and Claude Code wraps it for tmux itself, so the field
carries the **bare** sequence and a wrapped one is rejected whole
(`docs/claude-code-contract.md`). An event whose output is not read (`StopFailure`) writes a
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

```json
{ "hookSpecificOutput": { "hookEventName": "PreToolUse", "permissionDecision": "allow", "updatedInput": { "command": "…" } } }
```

`updatedInput` (PreToolUse only, proved live on 2.1.301) replaces the tool's input for that
call: `job-route` uses it to send a heavy command through `cc-smart-dev-kit job run`. The rewritten
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
- Only `ownHooks` is read there (`ownHooksOf` in `src/project/resolve.ts`, on its own, like
  `requires`), so it works even when the rest of the file is broken or needs a newer plugin.
- The names are validated against the plugin's own (`PLUGIN_HOOK_NAMES` in
  `src/project/config.ts`; a test keeps them equal to `HOOKS`): a typo fails the strict parse.
- `cc-smart-dev-kit doctor`, run in a project, prints one `·` line per listed hook, **warns** (`!`)
  when a listed hook's event has no project hook left to answer, and warns when a project
  hook runs next to a plugin hook the list does not name (both may answer).

**The safe switch** (`docs/design.md` § The safe switch): the project lists its copies while
it still has them → removes them → empties the list → raises `requires`. Every hook gets an
`ownHooks` test (the matrix does it for all: a plugin hook listed there goes silent; one that
is not listed still speaks).

## Fail closed when `cc-smart-dev-kit.json` cannot be used

When the project's `cc-smart-dev-kit.json` needs a newer plugin (`CcSmartDevKitVersionError`), is
broken (`CcSmartDevKitConfigError`), or lacks what a hook `needs` (the engine needs `worktrees`),
the hook cannot do what the project asked for. It never goes on as if there were no file;
it fails closed in the way that suits its event, and the message (which names the update
command, the file and field, or the missing field) reaches someone:

| Kind | Fails closed by |
|---|---|
| A guard (PreToolUse) | **asking** the person before every call in its domain: every command that runs git, every edit in the repo, every message |
| WorktreeCreate | failing: exit 1, the message on stderr; no worktree of any shape |
| WorktreeRemove | keeping the worktree: exit 1, the message on stderr |
| SubagentStop | keeping the worktree (exit 0: a subagent must finish) |
| An informational hook | one line of context (`cc-smart-dev-kit: <message>`); `after-merge` only after a merge, `session-name` only on stderr |

For a plugin hook `ownHooks` still comes first: a project that lists its own copy there keeps
it running.

## Quiet output

Claude Code reads a hook's stdout: WorktreeCreate's stdout is the folder path, a
PreToolUse decision is JSON, and SessionStart's text goes into the session's context.

- **stdout carries the contract's answer and nothing else.** No banners, no progress,
  no "ok". A setup command's output goes to stderr.
- Diagnostics go to stderr, one short line.
- A hook that has nothing to do prints nothing.
- `CC_SMART_DEV_KIT_HOOK_LOG`, when set, gets one JSON line per run (`run.ts`: the hook, the event,
  the input's `cwd`, the exit code, stdout, and the spec's `logFacts`): what `doctor --live`
  reads. `logFacts` is for facts about what the hook's own parser read (the git guard logs
  the programs of the command line), so a live check proves a guard **answered**, not only
  that it ran. It never changes the answer, and never goes on stdout.

## Timeouts

- Set `timeout` (seconds) on every hook in `hooks.json` and in the project's lines
  (`project-wiring.ts`). Do not rely on Claude Code's default.
- Every child process and network call inside a hook has its own timeout, shorter than
  the hook's (a `git fetch` 5 or 30 s, `gh` 10 s, the setup command 540 s of 600,
  `git worktree add` 500 s, `git worktree remove` 50 s).
- PreToolUse runs before every matching tool call: keep it fast, with no network. Every git
  call in a guard takes `GUARD_GIT_TIMEOUT_MS` (5 s) or less, against the hook's own 10 s.
- A long job (installing packages in a new worktree) gets the long timeout; a guard
  gets a short one.
- A timeout that can leave something half done (a worktree) has to say how to finish by
  hand, in the message: the hook cannot tell how far it got.

## Fail safe

A bug in a hook must never stop a user's work.

- Catch every error, write one line to stderr, and exit 0. Only WorktreeCreate and
  WorktreeRemove exit 1 (`crashExitCode`): they cannot succeed without their folder.
- A guard decides with a PreToolUse answer (`ask` or `deny`), never exit code 2.
- A guard asks rather than denies when the person may mean it (a force-push); it denies
  only what is never right in that project (an edit in a guarded main checkout, a message
  to another project's session).
- Anything a guard cannot work out (a session record it cannot read, a branch it cannot
  name) lets the call through.

## Session start never changes anything that matters

A SessionStart hook adds context, or refreshes managed files through `src/setup/` under its
lock. It never restarts a service, never changes a permission, and never asks a question.
Those happen only in a manual `cc-smart-dev-kit setup` run that shows the change first. A start
must stay quick: no fetch.

The plugin's SessionStart hooks are the worktree-leftovers note, the session name, and the
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
  A marketplace that cannot be read is a failure only after 24 h in a row.
- **Only Claude Code's own commands install:** `claude plugin marketplace update`, then
  `claude plugin update … --scope user`. Never `-y` (a marketplace-declared command needs
  a person), never a restart of the router or a session. They and the detached process
  run in the home folder with `gitEnv` (`commandContext`), and their output reaches a
  record only through `redactUrlsIn`.

## Tests

Each hook is tested by running it with a JSON input (`runHook` in `src/testing/hooks.ts`,
the same frame the entry uses), in a temp git repo (`testing.md`): with and without
`cc-smart-dev-kit.json`, in a worktree, with `ownHooks` listing it and with a project hook on the
same event that is not listed, with `requires` not met, and with a broken `cc-smart-dev-kit.json`.
Assert stdout exactly. Each plugin entry also runs once as a subprocess with stdin
(`entries.test.ts`); each project hook through `cc-smart-dev-kit hook` (`src/cli/hook-commands.test.ts`),
once through the exact line a project wires. The shim has its own tests
(`src/hooks/bun-shim.test.ts`), and the create lock its own (`create-lock.test.ts`).
