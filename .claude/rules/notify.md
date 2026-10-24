---
paths:
  - "src/hooks/notify*"
  - "src/hooks/stop-failure*"
  - "src/hooks/desktop-alert*"
  - "src/hooks/alert-sound.ts"
  - "src/hooks/terminal*"
  - "src/hooks/background-session.ts"
  - "src/hooks/windows-toast*"
  - "src/hooks/attended.ts"
  - "src/setup/user-notify-hook.ts"
  - "src/workflow/alerts*"
  - "src/entries/notify.ts"
  - "src/entries/stop-failure.ts"
  - "docs/windows-notify.md"
---

# The Notifier, And The Alerts About The Machine

The notifier is the one hook that talks to the person rather than to Claude: a desktop
alert, a terminal sequence, or Warp's own format. It is machine-wide, and a project cannot
switch it off. The frame every other hook runs in: `hooks.md`. The guards' answers and the
fail-safe table: `hooks-guards.md`. The whole contract, the marks and the three settings:
`docs/design/hooks.md` § The notifier.

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
  what the hook does is in § The notifier, below.
- The worktree engine's names are retired: `cc-smart-dev-kit hook worktree-create` and the
  other two print the fix and exit 1 — never 2, which blocks a `SubagentStop` and would loop
  every subagent (`src/hooks/settings-hooks.ts`).

## The notifier: what alerts, and where

`notify` is a `USER_HOOKS` bundle like `update-check`: it never enters the frame, needs no
`cc-smart-dev-kit.json`, and its opt-in is the machine. (The one
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
a waiting question, a waiting agent and agent view's finished/failed alert; with nowhere to show it, nothing.

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

## A user-level hook

A hook about the person, not a project (the StopFailure usage-limit alert) reads no
`cc-smart-dev-kit.json`. Its opt-in is the gateway: it acts only when `gateway.json` exists, so a
person who never set the gateway up does not notice it. It replaces nothing a project
wires, so it has no `ownHooks` step. **The StopFailure alert says what happened and nothing
else** (owner, 2026-10-25): which limit was hit and when it resets. It has no button, runs no
command and starts no worker: it offers no model, no chain, no fallback switch and no `gateway
on`, whatever the session is on, and the hook shows the platform's plain notification itself
(`plainNotification`, started detached, `src/entries/stop-failure.ts`). Work that waits (the
notifier's own notification with buttons) runs in a detached worker started through the
launcher (`~/.local/bin/cc-smart-dev-kit alert-worker …`, started by `notify.ts` only), never
from the plugin's version folder, which an update may delete while it waits; the hook itself
exits at once. A `claude -p` run may exit before the hook finishes and cut it off (seen live,
2.1.300): keep the hook's own work short.
