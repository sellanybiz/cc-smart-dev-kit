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
  every project. It has the defer check, and stays silent in a project without
  `anymodel.json`.
- **The project** (`PROJECT_HOOKS`, `wiring: "project"`): the project wires
  `anymodel hook <name>` in its own `.claude/settings.json`, exactly as the README's
  § Worktrees shows (the lines come from `src/hooks/project-wiring.ts`; a test keeps the
  README the same). Today: the worktree engine (WorktreeCreate, WorktreeRemove,
  SubagentStop). No defer check: the wiring is the project's opt-in.

**Never wire WorktreeCreate, WorktreeRemove or SubagentStop in `hooks.json`.** A
WorktreeCreate hook replaces Claude Code's own creation in every project where it is wired,
for sessions and subagents, and one that prints no folder makes the creation fail (proved
live). So a plugin WorktreeCreate cannot step aside for a project that did not opt in, and a
hook-made worktree loses Claude Code's lock, its cleanup marker, `-w "#123"` and its Git LFS
handling. `entries.test.ts` fails on a worktree event in `hooks.json`.

## The plugin's hooks: exec form, through the bun shim

Every entry in `plugin/hooks/hooks.json` uses the exec form, never a shell string:

```json
{ "type": "command", "command": "${CLAUDE_PLUGIN_ROOT}/bin/anymodel-bun", "args": ["${CLAUDE_PLUGIN_ROOT}/dist/<name>.js"], "timeout": 10 }
```

- `bin/anymodel-bun` runs bun without needing it on PATH (Claude Code's hooks get the PATH
  it was started with): the bun `anymodel setup` baked into the launcher, then
  `$BUN_INSTALL/bin/bun`, `~/.bun/bin/bun`, then PATH; with none, one line on stderr and
  exit 1. Only shell built-ins. A plain `"command": "bun"` with no bun on PATH runs no
  hook at all, and the guards are gone (proved live).
- `<name>` is a bundle built from `src/entries/<name>.ts` (`bundles-and-releases.md`).
  The hook's logic lives in `src/hooks/`, where it can be tested; the entry is two lines:
  `runHookEntry(<its spec>)` from `src/hooks/run.ts`, with the spec from `specs.ts`.
- No shell string: no quoting bugs, the same on every system.
- A new plugin hook: its logic in `src/hooks/`, its spec in `specs.ts` (and in `HOOKS`), its
  entry, its `hooks.json` entry, and a row in `src/hooks/matrix.test.ts`. `entries.test.ts`
  fails when the four do not match.

## The project's hooks: `anymodel hook <name>`

- The command is a shell string with the launcher's full path:
  `"$HOME/.local/bin/anymodel" hook <name>`. The shell fills in `$HOME`, so it works
  whatever PATH Claude Code has; the launcher runs its baked bun. The bare name `anymodel`
  would need `~/.local/bin` on that PATH.
- `src/entries/cli.ts` runs the spec through `runHookEntry`, the same frame and the same
  answers as a plugin hook's entry.
- A new project hook: its logic in `src/hooks/`, its spec in `specs.ts` (and in
  `PROJECT_HOOKS`), its timeout in `project-wiring.ts`, the README block, and a row in
  `matrix.test.ts`.

## The frame: every hook runs through `run.ts`

`handleHook` runs each hook, of both kinds, in this order; never skip a step in a new hook.

1. **Read the input**; not JSON, another event, or a `cwd` outside git: nothing to do.
2. **The defer check** (below), for a plugin hook only.
3. **Read `anymodel.json`**; broken, too new, or without what the hook `needs`: fail
   closed (below).
4. **Run.**

The frame stays general: later hooks (notifications, the routing of heavy jobs) are new
specs in it, of either kind.

## Find the project from the input's `cwd`

The hook reads its input as JSON on stdin. **Use the input's `cwd`** (`locateCheckout()`,
then `loadProjectConfig()`, from `src/project/`). It follows the session into a worktree.

- Never `CLAUDE_PROJECT_DIR`: it stays at the folder the session started in.
- Never `process.cwd()`.
- Without a `.claude/anymodel.json`, every plugin hook stays silent. A project that never
  opted in must not notice the plugin.
- The engine makes a subagent's worktree in Claude Code's own shape:
  `<main checkout>/.claude/worktrees/agent-<hex>` on `worktree-agent-<hex>`, from the
  remote's default branch, or HEAD with `worktree.baseRef: "head"` or no remote;
  `.worktreeinclude` copied. SubagentStop finds it by that shape. A change to that shape
  needs the contract row proved again first.

## The defer check

When a project still wires its own hook for the same event, with a matcher that selects the
same tool (or source, or agent type), the plugin's hook **exits 0 and prints nothing**, so
the project's copy runs alone. Nothing runs twice (proved live, with a plugin WorktreeCreate
next to a project's: one worktree, the project's).

- It reads `.claude/settings.json` and `.claude/settings.local.json` of the input's checkout
  and of the main checkout.
- It needs only git and the settings files, so it runs before `anymodel.json` is read.
- It is coarse: any project hook on the same event and tool silences the plugin's, whatever
  it does. `anymodel doctor`, run in a project, lists each plugin hook silenced there and
  the project command that does it. Say so wherever else it matters.

The project removes its copy only once every machine has the plugin, and then raises
`requires` in its `anymodel.json` (`docs/design.md` § The safe switch). Every hook gets a
defer test (the matrix does it for all: a plugin hook goes silent, a project hook runs).

## Fail closed when `anymodel.json` cannot be used

When the project's `anymodel.json` needs a newer plugin (`AnymodelVersionError`), is
broken (`AnymodelConfigError`), or lacks what a hook `needs` (the engine needs `worktrees`),
the hook cannot do what the project asked for. It never goes on as if there were no file;
it fails closed in the way that suits its event, and the message (which names the update
command, the file and field, or the missing field) reaches someone:

| Kind | Fails closed by |
|---|---|
| A guard (PreToolUse) | **asking** the person before every call in its domain: every command that runs git, every edit in the repo, every message |
| WorktreeCreate | failing: exit 1, the message on stderr; no worktree of any shape |
| WorktreeRemove | keeping the worktree: exit 1, the message on stderr |
| SubagentStop | keeping the worktree (exit 0: a subagent must finish) |
| An informational hook | one line of context (`anymodel: <message>`); `after-merge` only after a merge, `session-name` only on stderr |

For a plugin hook the defer check still comes first: a project that wires its own copy keeps
it running.

## Quiet output

Claude Code reads a hook's stdout: WorktreeCreate's stdout is the folder path, a
PreToolUse decision is JSON, and SessionStart's text goes into the session's context.

- **stdout carries the contract's answer and nothing else.** No banners, no progress,
  no "ok". A setup command's output goes to stderr.
- Diagnostics go to stderr, one short line.
- A hook that has nothing to do prints nothing.
- `ANYMODEL_HOOK_LOG`, when set, gets one JSON line per run (`run.ts`: the hook, the event,
  the input's `cwd`, the exit code, stdout): what `doctor --live` reads. It never changes
  the answer.

## Timeouts

- Set `timeout` (seconds) on every hook in `hooks.json` and in the project's lines
  (`project-wiring.ts`). Do not rely on Claude Code's default.
- Every child process and network call inside a hook has its own timeout, shorter than
  the hook's (a `git fetch` 5 or 30 s, `gh` 10 s, the setup command 540 s of 600).
- PreToolUse runs before every matching tool call: keep it fast, with no network.
- A long job (installing packages in a new worktree) gets the long timeout; a guard
  gets a short one.

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
Those happen only in a manual `anymodel setup` run that shows the change first. A start
must stay quick: no fetch.

## Tests

Each hook is tested by running it with a JSON input (`runHook` in `src/testing/hooks.ts`,
the same frame the entry uses), in a temp git repo (`testing.md`): with and without
`anymodel.json`, in a worktree, with another hook wired for the same event (the defer
check), with `requires` not met, and with a broken `anymodel.json`. Assert stdout exactly.
Each plugin entry also runs once as a subprocess with stdin (`entries.test.ts`); each
project hook through `anymodel hook` (`src/cli/hook-commands.test.ts`), once through the
exact line a project wires. The shim has its own tests (`src/hooks/bun-shim.test.ts`).
