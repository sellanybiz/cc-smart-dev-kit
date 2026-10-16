# Roadmap

Each phase ships as a plugin release (`release` skill in `.claude/skills/`). How the
parts fit: `design.md`.

| Phase | What it adds | Status |
|---|---|---|
| 1 | Foundation | Done |
| 2 | The AI gateway | Done |
| 3 | Hooks and `doctor --live` | Done (0.3.0) |
| 4 | Shared browser, Serena, MCP registration, session tools | Done (0.3.0) |
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

## 0.4.0 — the workflow, and a project that sets itself up

Done in this release:

- **`cc-smart-dev-kit project init`** (`README.md` § `project init`): the two files a project
  opts in with, asked question by question with the defaults read from the repo (the base
  from `origin/HEAD`, the setup command from the lockfile, the protected branches from git
  and `gh`), a flag for every question, the diff shown before anything is written, a backup
  first, and a line saying to commit them. The worktree engine's three hook lines come from
  the one home that owns them (`src/hooks/project-wiring.ts`).
- **The workflow** (`design.md` § The workflow): what cc-smart-dev-kit may do by itself —
  commit, push, open a pull request, merge — held by the project's committed file over the
  person's own `~/.config/cc-smart-dev-kit/workflow.json` over the safe built-in defaults, each
  value with where it came from. Read and written by `cc-smart-dev-kit workflow`; the four
  `switches.*` are settings that already exist (the status line, `sessionNames`,
  `jobs.route`, the update hold), so there is one truth for each. `autoMergeAllowed` is the
  one decision that lets a merge happen without a person, and it refuses every base that is
  not a plain integration base.
- **A base branch per branch prefix** (`worktrees.bases`): a `hotfix/…` or `release/…`
  worktree starts from the base that prefix names, not from the integration base, so
  unreleased work never leaks into a released line; the after-merge note tells sessions on
  those branches not to merge the integration base in.
- **`worktrees.engine`** (`"plugin"` or `"own"`): a project that already runs its own
  worktree engine says so, and `doctor` expects no cc-smart-dev-kit hook lines there (a `·`
  line, never ✗), while warning about the double worktree when they are wired anyway.
- **The merge guard** (`design.md` § The workflow): the `merge-guard` hook asks the person
  before a `gh pr merge` its policy does not allow, and lets one through with no question only
  when `autoMerge` allows it, every required check is green, and the head commit's review is
  recorded. **The review record**: `cc-smart-dev-kit workflow review-done` writes it, and
  `workflow show` says whether the commit here has one.
- **The alert settings** (`alerts.events`, `alerts.sound`, `alerts.usagePercent`): the two
  alert hooks and the status line read them — which moments alert, a sound where the platform
  has one, and the plan share the status line warns from.
- **The skills follow the workflow**: the commit, pull-request, review and worktree skills,
  and the general instructions, read `cc-smart-dev-kit workflow show`, so one policy — not an
  older hard-coded default — says when a step goes by itself.

Coming in 0.4.0 from other builders: the **Settings page** and the **Project card** in the
portal (both call this release's functions), and the **auto-mode safety checks** that run at
the plan's usage.

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

## 4 — Shared browser, Serena, MCP, session tools (done, 0.3.0)

- The Playwright MCP server with one Chrome for every session (`design.md` § The shared
  browser): one profile in the data folder, a tab filter per session so each sees only its
  own windows, and `browser check` as the end-to-end proof on a throwaway profile. The
  filter's endpoint carries a private token (any other path refused, and the token reaches the
  MCP in its environment, never in `argv`), and the profile and output folders are owner-only.
- Serena, with the plugin's own context (project switching on, so a session can point it at
  its worktree) installed in the data folder.
- `setup` registers the general MCP servers at user scope, so tool names stay
  `mcp__<server>__*`, and `restore` removes exactly what it registered. Tavily's key comes
  from the environment or a 0600 file, is never printed, and never reaches a registration.
- `cc-smart-dev-kit sessions` and `cc-smart-dev-kit worktrees` (`README.md` § Sessions, §
  Worktrees): the sessions a restart or a closed window stopped, and the worktrees that are
  finished enough to remove.

The two project pieces that belonged to those servers came with them: the **Serena root
record** (`serena-root`, so the main-folder guard can place a Serena edit and refuses an
activation that names a project by name or a folder outside the repo) and the **Playwright
output hook** (`playwright-output`: a file the caller names goes into the shared browser's
output folder — proved live on the pinned `@playwright/mcp`, which resolves a caller-named
path against its own working folder).

**Left in the projects that had them** (project values, not general): the dev-server probe
(`isDevServerRunning`, which reads one project's `.dev-server.json` and ports) — the
plugin's rule is a program running from the worktree or working in it; and the Windows
shutdown log (`wevtutil qe System`), since the plugin is macOS and Linux for now.

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
