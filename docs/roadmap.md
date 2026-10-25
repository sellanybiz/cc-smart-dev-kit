# Roadmap

Each phase ships as a plugin release (`release` skill in `.claude/skills/`). How the
parts fit: `design.md`.

| Phase | What it adds | Status |
|---|---|---|
| 1 | Foundation | Done |
| 2 | The AI gateway | Done |
| 3 | Hooks and `doctor --live` | Done (0.3.0) |
| 4 | Shared browser, Serena, MCP registration, session tools | Done (0.3.0; the browser replaced in 0.4.0, Serena removed in 0.6.0) |
| 5 | Instructions, skills, agents | Done (0.3.0) |
| 6 | Notifications, claude-mem settings, the auto-mode block | Done (0.3.0) |
| 7 | Opus and Fable slots, the usage-limit alert | Done (0.3.0) |
| 8 | Web search | Done (0.3.0); the command was removed in 1.0.0 |
| 9 | The local portal | Done (0.3.0) |
| 10 | Rollout to machines | Planned |
| 12 | The heavy-job queue | Done (0.3.0) |

0.3.0 is also the release of the **name change**: the plugin, its marketplace, its
command, its folders and its slots were `anymodel` in 0.2.x, and are
`cc-smart-dev-kit` now. `cc-smart-dev-kit migrate` moves a machine that still has the
old names (`README.md` § Moving from anymodel).

## 1.0.1 — a crew session reaches its worktree

**A hotfix of 1.0.0**, from its first live use (H101). `crew start` read
`claude agents --json` once right after `claude --bg -w …` and judged the session's folder from
it; that read reports the launch folder until a `--bg -w` session has entered its worktree
(2.1.308, `docs/claude-code-contract.md`), so every crew session was failed and stopped within a
second of starting. The launcher now records the session's id and leaves it `starting`; the
crew session's own `SessionStart` hook checks its real `cwd` against its worktree, marks a
session anywhere else `failed` with the reason (the lead's watch stops it), and turns a
`starting` record `working` when it is where it belongs. No new field, command or switch: a
patch.

## 1.0.0 — safety, the crew, and native Windows

**Done in this release:**

- **The worktree engine is gone, and its fields are refused** (`worktrees.prefix`,
  `worktrees.setup`, `worktrees.engine`): a file that sets one does not load, the error names
  the field and the fix, `cc-smart-dev-kit project init` removes the fields and every engine
  hook line in one run, and `doctor` finds a leftover line by its command text (D20).
- **A major version waits for the person**, shipped first as 0.7.0 so every machine holds
  1.0.0 until its person runs `cc-smart-dev-kit update`; `update` and `setup` first list each
  repository that still carries a retired field or an engine line (D33, D38). Claude Code's
  own plugin auto-update is off for this marketplace: `setup` writes `autoUpdate: false`
  (D39).
- **The `search` command is gone** (D40): Claude Code's own WebSearch and WebFetch, or the
  Tavily MCP server, are what is left.
- **Anthropic's server tools go to Anthropic** (D41): a request that carries web search is sent
  to Anthropic as it came, whatever the slot, so a Sonnet or Haiku session's WebSearch runs a
  real search; at a Claude limit the answer is a short note naming Tavily.
- **An affordable model's thinking stays visible** (A1b): the router keeps it, marked as its
  own with the backend's signature inside, removes it only on a request to Claude (no
  "Invalid `signature`" 400), and gives a backend its own signature back.
- **The breaker** (D42): while every target of a slot is limited or down, the router holds the
  request (up to 240 s) and then answers a 429 Claude Code retries; a heartbeat-only target
  rests like any other failure; the status line and the StopFailure alert name it; a crew
  session waits out a limit, and its lead resumes it once the gateway answers again.
- **Claude judges first** (D44): auto mode's checks go to Claude first; while Claude is limited
  or down, the worker slot's tested targets judge in its place. WebSearch never falls back to
  them, and opus and fable keep no fallback.
- **Crew sessions** (D34, D35, D37, D45, D47): `cc-smart-dev-kit crew lead|start|watch|list|
  status|step|report|answer|tell|self-watch|stop|rm|resume|attach|kinds`. A small lead starts
  each phase as a background session in its own worktree, never waits, hears each change as one
  line, routes a question to the person only when it is the person's, merges the branch and
  ends the session. Off by default (`crew.enabled`). The `lead` and `crew` skills and
  `plugin/instructions/core.md` place each phase inline, in a subagent or in a crew session
  (W5).
- **Reviews count for their fix commits** (D17): a review covers its branch's head while the
  change since it stays within `fixesAfterReview` (200 lines, 10 files, or 20 % — whichever is
  more), the base's own changes and generated files not counted. `workflow merge-check` prints
  the same verdict without merging, and the merge guard answers `allow` for an exact merge that
  passes every rule (D31).
- **The agent guard judges what really runs** (G1, G2): the model and effort Claude Code
  really gives a launch after its own overrides, and every Workflow run — by inline script,
  path, name or plugin. `medium` is now an allowed subagent effort.
- **Less Opus** (D46, D50): Opus builds architecture and UI/UX work only, and the other kinds
  build on the worker slot; a review runs on Opus only for a risky change set; UI/UX design
  runs only on `opus` or `fable`, at `high` or above, and the agent guard and the crew launcher
  refuse it anywhere else.
- **The hook frame fails closed** (A4), with the `session-escape-guard` (a session never
  loosens its own limits), the shell judge in `job-route` (a raw `claude --bg` and `claude -p`
  judged, polling refused, a lead's long waits moved to the background), the git guard's
  refusal of a crew session's push (D24), and the message guard's crew tag (D47).
- **A subagent never hands back with its own background work running** (D53): a SubagentStop
  check blocks the stop once, with one plain reason.
- **Finished worktrees clean themselves** (D48): after a merge into the base, and at an
  attended session start at most once an hour, through the same safe clean as
  `worktrees --clean`; `worktrees.autoClean` turns it off. A squash or rebase merge counts as
  finished (A6).
- **`cc-smart-dev-kit report`** (R1): the flow report — agent launches and the parallel share,
  minutes blocked on prompts and which guard asked, waits on background work, compactions,
  auto-mode blocks, merges that asked; never message text.
- **Help from one table, with `--help` on every command** (B1), and one shell reader for every
  guard (A2).
- **claude-mem's two start blocks are off** (D23): `setup` writes both keys off and turns
  Claude Code's own task tools on; `restore` puts them back.
- **Claude Code's retry watchdog** (D42): `setup` offers it once (default no), and each crew
  session's own settings turn it on with no wait limit (CC1, BR3).
- **Native Windows** (WIN): every 1.0.0 part checked against native Windows, a Windows CI job,
  and `docs/windows-setup.md` with the checklist for a real PC and what is still owed.

## 0.7.0 — a major version waits for the person (D33)

The background update holds a new major version instead of installing it: it records why,
writes `update-major.json`, and each interactive session start shows one line until the
person runs `cc-smart-dev-kit update` (`docs/design/updates.md` § Updates). It ships on
its own, before 1.0.0, so that machines take the rule first and hold 1.0.0 (a version
before 0.7.0 installs any newer one by itself). Claude Code's own plugin auto-update for
this marketplace goes off with it (D39: `setup` writes `autoUpdate: false`, and the
background check turns an older setup's `true` off), because it knows nothing of the hold.

## 0.4.0 — the workflow, and a project that sets itself up

Done in this release:

- **`cc-smart-dev-kit project init`** (`README.md` § `project init`): the two files a project
  opts in with, asked question by question with the defaults read from the repo (the base
  from `origin/HEAD`, else the repo's only branch, else `main`, else `master`; the setup
  command from the lockfile; the protected branches from git and `gh`), a flag for every question, the diff shown before anything is written, a backup
  first, and a line saying to commit them. The worktree engine's three hook lines come from
  the one home that owned them (`src/hooks/project-wiring.ts`, deleted with the engine in 1.0.0).
- **The workflow** (`docs/design/workflow.md` § The workflow): what cc-smart-dev-kit may do by itself —
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
- **Native Windows** (`windows-setup.md` and the four other `windows-*.md` pages): every hook
  in **shell form** through `bin/cc-smart-dev-kit-bun.sh`, a `.cmd` launcher beside the `sh`
  one, the paths under `%USERPROFILE%`, the gateway as a per-user Scheduled Task, the job
  queue's own memory reading, `win:` leases and `taskkill` end, the desktop toast, and a
  Windows CI job that runs the hooks through Git Bash.
- **The parallel-work instructions** (`plugin/instructions/core.md`, the `plan-task` and
  `subagent-decision` skills): nothing waits for a merge, a release, a review or an answer it
  does not need; a plan lists its phases in waves, and two phases that might change one file
  are split instead of run in turn.
- **Auto mode's safety checks, counted** (`usage`): the router counts the checks by day, who
  answered each and the tokens their answers reported (`gateway.md` § The safety-check counts).
- **The merge guard** (`docs/design/workflow.md` § The workflow): the `merge-guard` hook asks the person
  before a `gh pr merge` its policy does not allow, and lets one through with no question only
  when `autoMerge` allows it, every required check is green, and the head commit's review is
  recorded. **The review record**: `cc-smart-dev-kit workflow review-done` writes it, and
  `workflow show` says whether the commit here has one.
- **The alert settings** (`alerts.events`, `alerts.sound`, `alerts.usagePercent`): the two
  alert hooks and the status line read them — which moments alert, a sound where the platform
  has one, and the plan share the status line warns from.
- **The Linux desktop extras of the alerts** (`docs/design/hooks.md` § The notifier): a click on an
  alert raises the session's terminal window, the alert leaves the screen for the
  notification centre after a minute, one alert per session is on screen, and XFCE's Do Not
  Disturb keeps an ordinary alert's sound off — each where its tool is installed (`gdbus`,
  `xdotool`, `xfconf-query`), in the detached worker, ported from the older notification
  script so a machine that moves to the plugin loses nothing.
- **The skills follow the workflow**: the commit, pull-request, review and worktree skills,
  and the general instructions, read `cc-smart-dev-kit workflow show`, so one policy — not an
  older hard-coded default — says when a step goes by itself.
- **The portal's Settings page and Project card**: the workflow settings with where each
  value comes from (yours, this project, default), and the project's two files planned and
  written from the form (`project init`'s own functions), never committed.
- **The browser drives your own Chrome** (`docs/design/browser.md` § The browser, `README.md` § The browser):
  the Playwright MCP server runs in extension mode, in a Chrome profile of its own named
  `claude-code`, with the Playwright extension's token required — `browser setup`, `browser token`
  and `browser check` are new, the plugin's own shared Chrome, its profile folder, the tab filter
  and the file-picker bundle are gone, and `doctor` and the portal's Machine page report the
  browser's own state. What 0.3.0 left — the profile folder `<dataDir>/playwright` and the Chrome
  it may still have running — is reported by `doctor` (with the command that deletes the folder,
  which is the person's own call, and the pid of that Chrome) and is never deleted or used.

## 0.6.0 — Serena is removed

The owner's decision (2026-10-19), from a measurement on one machine: one Serena MCP server
ran per Claude session, about 3.2 GB each in a large project's main folder (18 GB for 10
sessions, swap full); Serena was used in 12 of 158 sessions in 14 days, never in this repo,
its own tools (rename, safe delete, symbol edits) were never called, and `activate_project`
failed 18% of the time. Grep, Glob and Read do almost all code search; claude-mem's
`smart_search`, `smart_outline` and `smart_unfold` cover symbol finding and outlines. Claude
Code's own LSP plugin is not added in its place (one TypeScript server per session).

- **Gone:** the `serena` registration, its pin and its context (`plugin/serena/`), the
  `serena-root` hook, the Serena branch of the main-folder guard (Edit, Write and NotebookEdit
  are guarded exactly as before), and the `code-explorer` agent. The skills and the reviewer
  use Grep with a whole-word pattern, `Explore` for a wide sweep, and claude-mem's tools for a
  file's shape.
- **Setup cleans up after it** (`docs/design/mcp.md` § MCP servers at user scope): the `serena`
  registration setup made, through `claude mcp remove` — never one of the person's own — its
  context file and the `serena-root` records; `--dry-run` shows each, and `doctor` has one ✗
  line until setup has run.
- **`serena-root` in a project's `ownHooks`** is still accepted, silences nothing, and gets a
  `·` line in `doctor`.

The release that was planned as 0.6.0 (the one 0.5.5 brought D11 forward from) is 1.0.0 now
(0.7.0 is the hold above, so that machines hold it); the deprecated worktree engine (§ 0.5.2)
is not removed in this release.

## 0.5.5 — Opus runs without asking below `max` (D11)

The owner's decision D11, brought forward from 0.6.0 because a session nobody can be asked in
(a background session, `claude -p`) could not start its Opus builders at all:

- **An `opus` launch runs with no question at `high` or `xhigh`** — any agent, any purpose,
  review or not — and needs no `Opus reason:` line; **at `max` it asks the person**, and a
  `claude -p` session refuses that one, with a message saying to run it lower or interactively.
  Fable keeps its rules exactly (`docs/design/hooks.md` § The Agent guard).
- **The reason list, the review-agent list and `CC_SMART_DEV_KIT_AGENT_GUARD_REVIEW_AGENTS`
  are gone.** An `Opus reason:` line is optional: when a prompt has one, its first word only
  names the purpose in the record, which reads `opus:<effort>` (with the word after it when
  there is one, `opus:xhigh:security`; a fork is `opus:session-effort`).
- **Everything else is unchanged:** `model` and `effort` on every launch, `low` and `medium`
  refused, an affordable gateway slot at `max`, and Fable's reason line and asks.

## 0.5.2 — every project on Claude Code's own worktrees

The owner's decision (2026-10-18): the plugin's own worktree engine is retired in favour of
Claude Code's, which is what every project gets now.

- **Every project uses Claude Code's own worktrees**: `<repo>/.claude/worktrees/<name>` on
  `worktree-<name>`, a task started with `claude -w <task-name>`, and no WorktreeCreate or
  WorktreeRemove hook (`docs/design/hooks.md` § Worktrees: Claude Code's own).
- **`"worktree": {"baseRef": "head"}`** in a project's committed `.claude/settings.json` when
  its base branch is not the repo's default branch: a worktree, and a subagent's worktree, are
  cut from the current branch. `project init` writes the line; `baseRef` takes only `"fresh"`
  (the default) or `"head"`.
- **The engine is deprecated, not yet deleted**: `worktrees.engine`, `worktrees.prefix`
  (optional now) and `worktrees.setup` stay accepted, `cc-smart-dev-kit hook` still answers for a
  project that wired it, and `doctor` warns with the exact steps to move. **The engine's code
  and fields are removed in the next minor version.**
- **`doctor`** warns when `.claude/worktrees/` is not git-ignored, when a project still sets
  an engine field or wires its hooks, and when a non-default `worktrees.base` has no
  `baseRef: "head"` in the project's settings.
- **`cc-smart-dev-kit sessions`** finds a project's sessions in its nested worktrees too.

## 0.4.1 — the model rules of 2026-10-16

The owner's decisions, all about which model runs what, in one patch release:

- **Fable is not only an advisor** (`docs/design/hooks.md` § The Agent guard): `agent-guard` takes the new
  reason `unsatisfied` — a fresh attempt after the person did not like the main session's
  answer — and an agent that can change files (a builder, or a fork) runs on Fable with the one
  word `build`, which the person approves, so a session whose own model is the `fable` tier can
  fork. A review may run on Fable by the session's own judgment for a hard or high-stakes change.
- **A review at effort `max`** is an `ask` instead of a refusal — the deeper review is the
  person's call — and is recorded as `opus:review-max` for `cc-smart-dev-kit usage`. In
  `claude -p` it is still refused.
- **Tiers, not vendors**: `opus` and `fable` mean the tier whatever answers behind them, so an
  override that points one at a backend keeps the reason line, the ask and the review rules, is
  never affordable and never forced to `max`.
- **`fable-session`**, a new machine-wide hook (`docs/design/hooks.md` § The Fable-session note): one
  `systemMessage` to the person, once a session, when the session's own model is the `fable`
  tier — nothing to Claude, never an error. The model is read the guard's way. **Changed in
  0.4.3**: it ran at `UserPromptSubmit`, where the model read is the PREVIOUS answer's — so it
  missed the switch to Fable and warned after a switch back (live, 2026-10-17). It now runs at
  `SessionStart` (the `model` the start names), `PostModelSwitch` (`to_model`, from Claude
  Code's own input schema) and `Stop` (the answer that just finished, else `ANTHROPIC_MODEL`).
  That the line reaches the person on those events is owed a live run
  (`claude-code-contract.md` § Relied on, not proved yet).

The general instructions (`plugin/instructions/core.md`), the `subagent-decision` and `review`
skills and the two reference pages carry the same words; core.md stays at its 190 lines.

## 0.4.2 — one command installs the plugin

- `install.sh` and `install.ps1` (README § Install): the same steps, words and exit codes on
  macOS, Linux and native Windows; each step one line, skipped when done; asks before it
  installs or upgrades Bun; asks for the browser token, the gateway key and the Tavily key
  (each can be skipped, none is echoed); ends with `doctor` and what is left. Exit codes: 0
  done, 3 installed with items left, 1 a step failed, 2 refused.
- The move runs on every machine and `setup` follows it (`migrate` says "Nothing to move."
  where there is nothing). `setup --tavily-key-stdin` writes the key through the token's own
  atomic writer.

## 0.4.3 — the installer's first real run

- The marketplace is refreshed before any version is compared, then the installed CLI's own
  version is read (older: stop, with the two commands that fix it, exit 1).
- A backend key is tested before it is saved (`gateway check`, `--backend-key-stdin`,
  `--save-unchecked`); `gateway setup --omniroute-password[-stdin]` can make the router's key
  itself. The installer asks before it replaces an MCP server of the person's own
  (`mcp status --json`). A pasted secret no longer arrives broken (one home,
  `src/cli/secret-line.ts`, and both installers). Both of Chrome's files name the
  `claude-code` profile; `doctor` reads Chrome's own extension record.

## 0.5.0 — every gateway slot works the same way

- A slot is reached by the model's family; each slot has its own fallback switch; a slot with
  no chain is off; no hidden Claude step; the judge judges every check; `agent-guard` reads
  affordability from `gateway.json`; another model's thinking never goes back to Claude;
  claude-mem follows the scout slot only.
- The upgrade path takes out the 0.4.3 model keys, drops the hidden `claude-sonnet-5-5`,
  starts an old opus or fable chain with its fallback off, and ignores an untested judge.
  `worktrees --remove` no longer finds itself; `--admin` always asks.

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
- **Answered (2026-10-23, corrected 2026-10-25 on 2.1.310):** a changed env value reaches a
  running session within about a second; a removed key reaches it only when another settings
  file still sets the key, and otherwise the session keeps the URL it had
  (`claude-code-contract.md` § The gateway). So `restore`'s two stages stay: it can never stop
  the router right after removing the keys. A worktree's own copy of the personal file is read
  after the main root's, so `restore`, `gateway project default` and `status` name it (GF1).

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

- The Playwright MCP server with one Chrome for every session, as 0.3.0 shipped it: one profile
  in the plugin's data folder, a tab filter per session so each saw only its own windows, the
  filter's endpoint carrying a private token (any other path refused, the token in the MCP's
  environment, never in `argv`), owner-only profile and output folders, and `browser check` as
  the end-to-end proof on a throwaway profile. **0.4.0 replaced all of it** with the person's own
  Chrome through the Playwright extension (`docs/design/browser.md` § The browser): the plugin's own browser,
  the profile in the data folder, the tab filter and the picker bundle are gone, and the browser
  refuses to run without the extension's token.
- Serena, with the plugin's own context (project switching on, so a session can point it at
  its worktree) installed in the data folder. **Removed in 0.6.0**, with its root record
  below (§ 0.6.0).
- `setup` registers the general MCP servers at user scope, so tool names stay
  `mcp__<server>__*`, and `restore` removes exactly what it registered. Tavily's key comes
  from the environment or a 0600 file, is never printed, and never reaches a registration.
- `cc-smart-dev-kit sessions` and `cc-smart-dev-kit worktrees` (`README.md` § Sessions, §
  Worktrees): the sessions a restart or a closed window stopped, and the worktrees that are
  finished enough to remove.

The two project pieces that belonged to those servers came with them: the **Serena root
record** (`serena-root`, so the main-folder guard can place a Serena edit and refuses an
activation that names a project by name or a folder outside the repo) and the **Playwright
output hook** (`playwright-output`: a file the caller names goes into the browser's
output folder — proved live on the pinned `@playwright/mcp`, which resolves a caller-named
path against its own working folder).

**Left in the projects that had them** (project values, not general): the dev-server probe
(`isDevServerRunning`, which reads one project's `.dev-server.json` and ports) — the
plugin's rule is a program running from the worktree or working in it; and the Windows
shutdown log (`wevtutil qe System`) — on every platform the sign is the time one, several
sessions closed in the same moment before the machine started (`docs/windows-setup.md`).

## 5 — Instructions, skills, agents (done, 0.3.0)

- Always-on instructions, imported from `~/.claude/CLAUDE.md` through a managed block.
- Opt-in instructions, per project (`cc-smart-dev-kit.json` `instructions`).
- General skills and agents, which read a project's own additions when they exist. The
  plugin ships 17 skills and 3 agents (4 until 0.6.0: `code-explorer` went with Serena).

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
a judge target is used only after it passed the judge test. (0.5.0 changed how a slot is reached: by the model's family, not
by an exact id, and each slot has its own fallback switch.)

## 8 — Web search (done in 0.3.0, removed in 1.0.0)

The search command asked the local OmniRoute gateway for web results (Ollama's web search, included with the Ollama account: $0 per search, about 0.9 s, cached for 5 minutes), and `--fetch <url>` read one page's text through a fetch provider's key inside OmniRoute. The command was removed in 1.0.0; that section above says what to use instead.

## 9 — The local portal (done, 0.3.0)

A local web page for the setup, on `127.0.0.1` only, and the OmniRoute updates it needed.
Only the person may reach it: a one-time link token exchanged for a session cookie, the
`Host` and `Origin` headers checked, a CSRF token on every change, the keys masked, and the
whole thing stopping after 30 minutes with no request. Every action runs the same function
the command line runs. `cc-smart-dev-kit portal` refuses inside a Claude Code session. The
design, screen by screen, and why: [docs/design/portal.md](design/portal.md) § The portal. The OmniRoute side,
its three-day rule and the health check that puts a bad release back:
[docs/design/omniroute.md](design/omniroute.md) § OmniRoute.

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
one piece at a time, as `docs/design/hooks.md` § The safe switch describes.

## Open, not yet planned

- **`doctor`: a project hook that extends a kit hook.** Today `doctor`
  (`src/cli/project-checks.ts`) warns "both answer" whenever a project wires its own hook on
  the same event and matcher as a kit hook, and advises listing the hook in `ownHooks`. For a
  project hook that keeps rules only that project has, and whose old copy of the kit's part
  already goes quiet where the kit answers, that advice is wrong: it silences the kit's hook
  and wakes the project's old copy. A project should be able to mark such a hook as an
  extension, so `doctor` neither warns nor gives that advice.
- **A finished leftover worktree on Windows and macOS.** A folder git no longer lists counts as
  finished only on Linux: `mountPoints` answers "unknown" elsewhere, so the folder stays, logged,
  for a removal by hand. Reading mount points there is a design decision.
- **One quiet-facts helper for the crew tests.** Three copies give a test fixed machine facts
  today (`QUIET_MACHINE` in `src/crew/end.test.ts`, `quietFacts`, `quietScan`); one helper in
  `src/testing/`, and a default `scanFacts` in `crew-world.ts`'s `ctx`, would keep every crew
  test off the host's own facts.
- **The launch judge and a wait loop that matches itself.** It let through
  `until ! pgrep -f "bun run check"; do sleep 3; done`, whose `pgrep -f` pattern matches the
  loop's own command line, so it never ends.
- **The router's stream limits (SC1).** Nothing bounds the wait before a response's headers,
  keep-alive pings are never cut, and the 120 s allowed for Anthropic is not measured.
- **The merge guard's shell reader.** It does not test an endpoint or a method the shell fills
  in for a pull request, and it does not follow `cat <<EOF | sh` or `eval "$cmd"`.
- **GitHub Issues (1.4.0) limits.** `visibleText` leaves attribute values, link titles and alt
  text unmarked (a person sees them on hover); the feed judges a lead alive by its pid on this
  machine; the portal's settings writer has no protected-key check of its own (it relies on the
  portal's door); `issue file` needs `gh api user` to succeed (an App token may get 403); the
  `GH_COMMANDS` list must follow gh's own commands, or a crew session is denied a new one; the
  `## What <phase> left behind` heading is written in `src/crew/start.ts` and matched by a
  pattern of its own in `src/issues/phase-issues.ts`: two homes for one shape.
- **`resolveSwitch` and the base's name.** It takes the base branch's name from the working
  copy, as the merge guard does.
- **`claudeLimitHolds` (`src/crew/wait.ts`) compares exact Claude model ids.** Check whether a
  variant of one model's id should count as the same model.
- **A merge-guard test left its fake `gh` running.** In one full run on a loaded machine (load
  average about 30), "a gh call that hangs" (`src/hooks/merge-guard.test.ts`) passed but left its
  fake `gh` alive with its parent gone. The fake's `read x < /dev/zero` spins, so it ran 12
  minutes at 75% CPU until it was stopped by hand. It did not ignore SIGTERM, so no SIGTERM
  reached it: find why the call's time limit (`runGh`, `src/workflow/merge-check.ts`) did not
  stop it. A hook that exits while its `gh` still runs would leave the same orphan on a
  person's machine.
