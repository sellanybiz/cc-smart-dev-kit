---
paths:
  - "src/hooks/**"
  - "src/entries/**"
  - "plugin/hooks/**"
---

# Hooks: The Contract

A hook is a program Claude Code runs at a fixed moment (a session starts, a tool is
about to run, a worktree is made). The plugin's hooks arrive in Phase 3; this is the
contract they follow. The Claude Code behaviour behind each point, and the version it
was proved on: `docs/claude-code-contract.md`.

## Exec form, one bundle per hook

Every entry in `plugin/hooks/hooks.json` uses the exec form, never a shell string:

```json
{ "type": "command", "command": "${CLAUDE_PLUGIN_ROOT}/bin/anymodel-bun", "args": ["${CLAUDE_PLUGIN_ROOT}/dist/<name>.js"], "timeout": 10 }
```

- **Never `"command": "bun"`.** Claude Code started from a desktop launcher or a service
  may have no bun on PATH, and then the hook never runs (seen live). `plugin/bin/anymodel-bun`
  finds bun where the launcher does (the bun baked into `~/.local/bin/anymodel`,
  `$BUN_INSTALL/bin/bun`, `~/.bun/bin/bun`, then PATH), and exits 0 with one stderr line
  when there is none. `src/setup/bun-shim.test.ts` checks every hook uses it.
- `<name>` is a bundle built from `src/entries/<name>.ts` (`bundles-and-releases.md`).
  The hook's logic lives in `src/hooks/`, where it can be tested; the entry only reads
  stdin, calls it, and writes the result.
- No shell: no quoting bugs, no `sh` on the path, the same on every system.

## Find the project from the input's `cwd`

The hook reads its input as JSON on stdin. **Use the input's `cwd`** with
`resolveProject()` from `src/project/`. It follows the session into a worktree.

- Never `CLAUDE_PROJECT_DIR`: it stays at the folder the session started in.
- Never `process.cwd()`.
- Without a `.claude/anymodel.json`, the plugin does what Claude Code does by default, and its
  guards stay silent. A project that never opted in must not notice the plugin.
  For WorktreeCreate, the default is the one the Phase 0 spike reproduced: the folder
  `.claude/worktrees/<name>` on a new branch `worktree-<name>` from `HEAD`. Prove it again
  before you rely on it.

## The defer check

When a project still wires its own copy of a piece (its own hook for the same event in
the project's `.claude/settings.json`), the plugin's hook **exits 0 and prints nothing**.
Nothing runs twice. This matters most for WorktreeCreate: when a project's hook and the
plugin's both run, both make a worktree and Claude Code uses the project's.

The project removes its copy only once every machine has the plugin, and then raises
`requires` in its `anymodel.json` (`docs/design.md` § The safe switch). Every hook that
replaces something a project may already have gets a defer check, and a test for it.

## Quiet output

Claude Code reads a hook's stdout: WorktreeCreate's stdout is the folder path, a
PreToolUse decision is JSON, and SessionStart's text goes into the session's context.

- **stdout carries the contract's answer and nothing else.** No banners, no progress,
  no "ok".
- Diagnostics go to stderr, one short line.
- A hook that has nothing to do prints nothing.

## Timeouts

- Set `timeout` (seconds) on every hook in `hooks.json`. Do not rely on Claude Code's
  default.
- Every child process and network call inside a hook has its own timeout, shorter than
  the hook's.
- PreToolUse runs before every matching tool call: keep it fast, with no network.
- A long job (installing packages in a new worktree) gets the long timeout; a guard
  gets a short one.

## Fail safe

A bug in a hook must never stop a user's work.

- Catch every error, write one line to stderr, and exit 0.
- Exit code 2 (block) is only for a guard's deliberate decision, with the reason on
  stderr.
- An `AnymodelVersionError` (the project needs a newer plugin) is reported as its message,
  which names the update command. A broken `anymodel.json` is reported with its file and field.
- What a guard does when the project's `anymodel.json` is broken or needs a newer plugin is
  decided in Phase 3 and written here then.

## Session start checks for updates, nothing more

The one SessionStart hook on this branch starts the background self-update
(`src/update/`, the owner's decision of 2026-10-15). It writes no user file, never
restarts a service, never changes a permission, and never asks a question. Those happen
only in a manual run that shows the change first. (A hook that refreshes managed files
is not built; when it is, it goes through `src/setup/` under its lock, and this section
says so.)

The self-update hook (`src/entries/update-check.ts`) is machine-wide, not a project's
piece, so it has no `anymodel.json` and no defer check. Its rules:

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

Each hook is tested by running it with a JSON input on stdin, in a temp git repo
(`testing.md`): with and without `anymodel.json`, in a worktree, with the project's own copy
wired (the defer check), and with a broken `anymodel.json`. Assert stdout exactly.
