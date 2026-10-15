---
paths:
  - "src/hooks/**"
  - "src/entries/**"
  - "plugin/hooks/**"
---

# Hooks: The Contract

A hook is a program Claude Code runs at a fixed moment (a session starts, a tool is
about to run, a worktree is made). This is the contract the plugin's hooks follow; how
they fit together is `docs/design.md` § The hooks. The Claude Code behaviour behind each
point, and the version it was proved on: `docs/claude-code-contract.md`.

## Exec form, one bundle per hook

Every entry in `plugin/hooks/hooks.json` uses the exec form, never a shell string:

```json
{ "type": "command", "command": "bun", "args": ["${CLAUDE_PLUGIN_ROOT}/dist/<name>.js"], "timeout": 10 }
```

- `<name>` is a bundle built from `src/entries/<name>.ts` (`bundles-and-releases.md`).
  The hook's logic lives in `src/hooks/`, where it can be tested; the entry is two lines:
  `runHookEntry(<its spec>)` from `src/hooks/run.ts`, with the spec from `specs.ts`.
- No shell: no quoting bugs, no `sh` on the path, the same on every system.
- A new hook: its logic in `src/hooks/`, its spec in `specs.ts` (and in `HOOKS`), its entry,
  its `hooks.json` entry, and a row in `src/hooks/matrix.test.ts`. `entries.test.ts` fails
  when the four do not match.

## The frame: every hook runs through `run.ts`

`handleHook` runs each hook in this order; never skip a step in a new hook.

1. **Read the input**; not JSON, another event, or a `cwd` outside git: nothing to do.
2. **The defer check** (below).
3. **Read `anymodel.json`**; broken or too new: fail closed (below).
4. **Run.**

## Find the project from the input's `cwd`

The hook reads its input as JSON on stdin. **Use the input's `cwd`** (`locateCheckout()`,
then `loadProjectConfig()`, from `src/project/`). It follows the session into a worktree.

- Never `CLAUDE_PROJECT_DIR`: it stays at the folder the session started in.
- Never `process.cwd()`.
- Without a `.claude/anymodel.json`, the plugin does what Claude Code does by default, and
  its guards stay silent. A project that never opted in must not notice the plugin.
- **WorktreeCreate cannot step aside.** A hook that prints no folder makes the creation fail
  (proved live), so without `anymodel.json` (and for every subagent) the plugin makes
  Claude Code's own shape: `<main checkout>/.claude/worktrees/<name>` on `worktree-<name>`,
  `/` becoming `+`, from the remote's default branch, or HEAD with `worktree.baseRef: "head"`
  or no remote; `.worktreeinclude` copied. A change to that shape needs the contract row
  proved again first.

## The defer check

When a project still wires its own hook for the same event, with a matcher that selects the
same tool (or source, or agent type), the plugin's hook **exits 0 and prints nothing**, so
the project's copy runs alone. Nothing runs twice: a project WorktreeCreate next to the
plugin's gives one worktree, the project's (proved live).

- It reads `.claude/settings.json` and `.claude/settings.local.json` of the input's checkout
  and of the main checkout; for WorktreeCreate, WorktreeRemove and SubagentStop also the
  user's `settings.json` (`deferToUserSettings`).
- SubagentStop also defers to a project WorktreeCreate: the plugin cleans only the
  worktrees it made.
- It needs only git and the settings files, so it runs before `anymodel.json` is read.
- It is coarse: any project hook on the same event and tool silences the plugin's, whatever
  it does. Say so wherever it matters.

The project removes its copy only once every machine has the plugin, and then raises
`requires` in its `anymodel.json` (`docs/design.md` § The safe switch). Every hook gets a
defer test (the matrix does it for all).

## Fail closed when `anymodel.json` cannot be used

When the project's `anymodel.json` needs a newer plugin (`AnymodelVersionError`) or is
broken (`AnymodelConfigError`), the hook cannot know what the project asked for. It never
goes on as if there were no file; it fails closed in the way that suits its event, and the
message (which names the update command, or the file and field) reaches someone:

| Kind | Fails closed by |
|---|---|
| A guard (PreToolUse) | **asking** the person before every call in its domain: every command that runs git, every edit in the repo, every message |
| WorktreeCreate | failing: exit 1, the message on stderr |
| WorktreeRemove | keeping the worktree: exit 1, the message on stderr |
| SubagentStop | keeping the worktree (exit 0: a subagent must finish) |
| An informational hook | one line of context (`anymodel: <message>`); `after-merge` only after a merge, `session-name` only on stderr |

The defer check still comes first: a project that wires its own copy keeps it running.

## Quiet output

Claude Code reads a hook's stdout: WorktreeCreate's stdout is the folder path, a
PreToolUse decision is JSON, and SessionStart's text goes into the session's context.

- **stdout carries the contract's answer and nothing else.** No banners, no progress,
  no "ok". A setup command's output goes to stderr.
- Diagnostics go to stderr, one short line.
- A hook that has nothing to do prints nothing.
- `ANYMODEL_HOOK_LOG`, when set, gets one JSON line per run (`run.ts`): what
  `doctor --live` reads. It never changes the answer.

## Timeouts

- Set `timeout` (seconds) on every hook in `hooks.json`. Do not rely on Claude Code's
  default.
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
`anymodel.json`, in a worktree, with the project's own copy wired (the defer check),
with `requires` not met, and with a broken `anymodel.json`. Assert stdout exactly. Each
entry also runs once as a subprocess with stdin (`entries.test.ts`).
