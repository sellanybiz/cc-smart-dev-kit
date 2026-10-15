# Roadmap

Each phase ships as a plugin release (`release` skill in `.claude/skills/`). How the
parts fit: `design.md`.

| Phase | What it adds | Status |
|---|---|---|
| 1 | Foundation | Done |
| 2 | The AI gateway | Done |
| 3 | Hooks and `doctor --live` | Next |
| 4 | Shared browser, Serena, MCP registration, session tools | Planned |
| 5 | Instructions, skills, agents | Planned |
| 6 | Notifications, claude-mem settings, the auto-mode block | Planned |
| 7 | Opus and Fable slots, the usage-limit alert | Planned |
| 8 | Web search | Planned |
| 9 | The local portal | Planned |
| 10 | Rollout to machines | Planned |

## 1 — Foundation (done)

The repo, CI, the bundle step and its check, `claude plugin validate --strict`, the
neutrality check. The `anymodel.json` contract and project resolution. `anymodel setup`,
`doctor` and `restore`, managed keys and blocks with backups, atomic writes and a lock,
and the stable launcher.

## 2 — The AI gateway (done)

A local router in front of OmniRoute and Ollama Cloud (`gateway.md`). It gives cheaper
models to subagent slots, and an opt-in judge for auto mode's safety check.

- Slots `anymodel-scout`, `anymodel-worker`, `anymodel-judge` (the judge off by default).
- A general `aliases` map in its config, so a machine's old slot names keep working while
  it moves to the new ones. The plugin ships none.
- `anymodel gateway <serve|status|models|slot|setup|on|off>`. `gateway setup` runs the
  router from a copy in `~/.local/share/anymodel/` as the systemd user unit
  `anymodel-router`, and asks before a restart. `gateway on` / `off` use owned keys.
- `doctor` checks the gateway when it is set up.
- No prompt text is ever changed (`.claude/rules/gateway.md`).
- **Not done, moved on:** logging a safety-check request form the router does not know.
  The router knows the check only by its system prompt; telling a new *form* from a
  known one needs the real request shapes captured first. It goes with
  `doctor --live` (Phase 3).
- **0.2.1, follow-ups from the first live run:** a slot's `claude-…` target, and an
  alias to a `claude-…` model, get the fields they refuse in a form they accept
  (`requestForClaudeFallback`); every target's 4xx / 5xx reason on a model call is
  logged in the background, keys masked; `restore` no longer blocks while the router
  drains (`disable`, `stop --no-block`, then up to 15 s for the port to close, only for
  the unit's own router).
- **Open, from the same run:** running sessions seemed to pick up the new env keys
  without a restart (`claude-code-contract.md`, observed once). If that is confirmed,
  for a removed key too, restore can stop the router right after removing the keys, and
  its two stages become one.

## 3 — Hooks and `doctor --live`

- Worktree create and remove, with the defer check: from `anymodel.json` when there is one,
  Claude Code's default when there is not.
- Guards, and session names.
- `anymodel doctor --live`: a throwaway session in a temp repo that proves the hooks
  and the worktree contract on the installed Claude Code. It makes the live rows of
  `claude-code-contract.md` repeatable.
- The router logs a safety-check request form it does not know, loudly, instead of
  guessing (moved from Phase 2).

## 4 — Shared browser, Serena, MCP, session tools

- The Playwright MCP server with one Chrome for every session.
- Serena.
- `setup` registers MCP servers at user scope, so tool names stay `mcp__<server>__*`.
- `anymodel sessions` and `anymodel worktrees`.

## 5 — Instructions, skills, agents

- Always-on instructions, imported from `~/.claude/CLAUDE.md` through a managed block.
- Opt-in instructions, per project (`anymodel.json` `instructions`).
- General skills and agents, which read a project's own additions when they exist.

## 6 — Notifications, claude-mem settings, the auto-mode block

- Notification hooks.
- claude-mem settings.
- The auto-mode block: `setup` copies each opted-in project's `autoMode` rules into
  the user's settings.

## 7 — Opus and Fable slots

Slots keyed by the real model ids, a usage-limit alert, and a status-line warning.

## 8 — Web search

`anymodel search`.

## 9 — The local portal

A local web page for the setup. Only the user may reach it: it needs a token, it
checks for CSRF (a request a different website sends through the user's browser), and
it checks the `Host` and `Origin` headers of every request.

## 10 — Rollout

The release on every machine, `doctor` green on each.

## After the rollout

Each adopting project removes its own old copies of the pieces the plugin now ships,
one piece at a time, as `design.md` § The safe switch describes.
