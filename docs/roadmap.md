# Roadmap

Each phase ships as a plugin release (`release` skill in `.claude/skills/`). How the
parts fit: `design.md`.

| Phase | What it adds | Status |
|---|---|---|
| 1 | Foundation | Done |
| 2 | The AI gateway | Done |
| 3 | Hooks and `doctor --live` | Done (0.3.0) |
| 4 | Shared browser, Serena, MCP registration, session tools | Next |
| 5 | Instructions, skills, agents | Done (0.3.0) |
| 6 | Notifications, claude-mem settings, the auto-mode block | Done (0.3.0) |
| 7 | Opus and Fable slots, the usage-limit alert | Done (0.3.0) |
| 8 | Web search | Done (0.3.0) |
| 9 | The local portal | Done (0.3.0) |
| 10 | Rollout to machines | Planned |
| 12 | The heavy-job queue | Done (0.3.0) |

0.3.0 is also the release of the **name change**: the plugin, its marketplace, its
command, its folders and its slots were `anymodel` in 0.2.x, and are
`cc-smart-dev-kit` now. `cc-smart-dev-kit migrate` moves a machine that still has the
old names (`README.md` § Moving from anymodel).

## 1 — Foundation (done)

The repo, CI, the bundle step and its check, `claude plugin validate --strict`, the
neutrality check. The `cc-smart-dev-kit.json` contract and project resolution.
`cc-smart-dev-kit setup`, `doctor` and `restore`, managed keys and blocks with backups,
atomic writes and a lock, and the stable launcher.

## 2 — The AI gateway (done)

A local router in front of OmniRoute and Ollama Cloud (`gateway.md`). It gives more
affordable models to subagent slots, and an opt-in judge for auto mode's safety check.

- Slots `cc-smart-dev-kit-scout`, `cc-smart-dev-kit-worker`, `cc-smart-dev-kit-judge`
  (the judge off by default).
- A general `aliases` map in its config, so a machine's old slot names keep working while
  it moves to the new ones. The plugin ships none; `migrate` writes the ones a 0.2.x
  machine needs.
- `cc-smart-dev-kit gateway <serve|status|models|slot|setup|on|off>`. `gateway setup` runs
  the router from a copy in `~/.local/share/cc-smart-dev-kit/` as the systemd user unit
  `cc-smart-dev-kit-router`, and asks before a restart. `gateway on` / `off` use owned keys.
- `doctor` checks the gateway when it is set up.
- No prompt text is ever changed (`.claude/rules/gateway.md`).
- **Open, from the first live run:** running sessions seemed to pick up the new env keys
  without a restart (`claude-code-contract.md`, observed once). If that is confirmed,
  for a removed key too, restore can stop the router right after removing the keys, and
  its two stages become one.

## 3 — Hooks and `doctor --live` (done, 0.3.0)

- The worktree engine (create and remove), opt-in per project, with the defer check: from
  `cc-smart-dev-kit.json` when there is one, Claude Code's default when there is not.
- The guards (git, an edit in a guarded main checkout, a message to another project's
  session, the Agent model rules), session names, the note after a merge, the
  worktree-leftovers note, and the notifications (desktop, SSH as OSC 777, or Warp's own
  plugin).
- `cc-smart-dev-kit doctor --live`: a throwaway session in a temp repo that proves the hooks
  and the worktree contract on the installed Claude Code. It makes the live rows of
  `claude-code-contract.md` repeatable.
- The background self-update, and router restarts that refuse no request (the socket unit;
  a restart waits for the old router's drain).
- Heavy commands are routed into the job queue by a PreToolUse hook (`job-route`).

## 4 — Shared browser, Serena, MCP, session tools (next)

- The Playwright MCP server with one Chrome for every session.
- Serena.
- `setup` registers MCP servers at user scope, so tool names stay `mcp__<server>__*`.
- `cc-smart-dev-kit sessions` and `cc-smart-dev-kit worktrees`.

## 5 — Instructions, skills, agents (done, 0.3.0)

- Always-on instructions, imported from `~/.claude/CLAUDE.md` through a managed block.
- Opt-in instructions, per project (`cc-smart-dev-kit.json` `instructions`).
- General skills and agents, which read a project's own additions when they exist. The
  plugin ships 17 skills and 4 agents.

## 6 — Notifications, claude-mem settings, the auto-mode block (done, 0.3.0)

- Notification hooks (a finished turn, a question, a plan, a permission prompt, a stopped
  turn), with a sound and a mark per session.
- claude-mem settings: `setup` points it at the gateway's affordable model, with Claude
  Haiku as its quota fallback.
- The auto-mode block: `setup` copies each opted-in project's `autoMode` rules into
  the user's settings, after it shows them and asks.
- The Warp terminal and its plugin, opt-in (`setup --warp`).

## 7 — Opus and Fable slots (done, 0.3.0)

Slots keyed by the real model ids, so a Claude model at the plan's usage limit falls back
to a chosen target instead of stopping; the usage-limit alert; and the status line's
warning. The fallback's answers are made safe for Claude Code (`fallback-answer.ts`), and
a judge target is used only after it passed the judge test.

## 8 — Web search (done, 0.3.0)

`cc-smart-dev-kit search "<query>"` asks the local OmniRoute gateway for web results (Ollama's web search, included with the Ollama account: $0 per search, about 0.9 s, cached for 5 minutes). `--fetch <url>` needs a fetch provider's key inside OmniRoute. How it works and its limits: [search.md](search.md).

## 9 — The local portal (done, 0.3.0)

A local web page for the setup, on `127.0.0.1` only, and the OmniRoute updates it needed.
Only the person may reach it: a one-time link token exchanged for a session cookie, the
`Host` and `Origin` headers checked, a CSRF token on every change, the keys masked, and the
whole thing stopping after 30 minutes with no request. Every action runs the same function
the command line runs. `cc-smart-dev-kit portal` refuses inside a Claude Code session. The
design, screen by screen, and why: [design.md](design.md) § The portal. The OmniRoute side,
its three-day rule and the health check that puts a bad release back:
[design.md](design.md) § OmniRoute.

## 10 — Rollout

The release on every machine, `doctor` green on each.

## 12 — The heavy-job queue (done, 0.3.0)

`cc-smart-dev-kit job run` makes heavy jobs (a type check, a test run, a build) wait for
free memory instead of freezing the machine: each job reserves its gigabytes, waits its
turn in one machine-wide queue, and runs in its own cgroup inside
`cc-smart-dev-kit-heavy.slice`. How a job waits and runs, the kinds, the config and the
shared view: [jobs.md](jobs.md).

## After the rollout

Each adopting project removes its own old copies of the pieces the plugin now ships,
one piece at a time, as `design.md` § The safe switch describes.
