# cc-smart-dev-kit

This repo builds the **`cc-smart-dev-kit` plugin** for Claude Code. It is also the plugin's own
**marketplace** (a list of plugins Claude Code can install from), named `cc-smart-dev-kit`.
Its main job is letting a person use any model with Claude Code (the gateway). Anyone
can install it: the gateway, hooks, skills, agents, and the `cc-smart-dev-kit` command, which sets
up and checks a machine.

Users install it with the installer, fetched from `main` — `install.sh` (macOS, Linux, Git
Bash), `install.ps1` (native Windows) — which runs every step: the marketplaces, the plugin,
`migrate`, `setup`, `doctor` (`README.md` § Install):

```sh
gh api repos/<owner>/cc-smart-dev-kit/contents/install.sh -H "Accept: application/vnd.github.raw" | bash -s -- <owner>/cc-smart-dev-kit
```

The plugin, the marketplace and the command are all `cc-smart-dev-kit`, and the plugin id is
`cc-smart-dev-kit@cc-smart-dev-kit`; the older names a machine may still carry, and the
command that moves it: `.claude/rules/bundles-and-releases.md` § The names before this one.

## Two different things: `.claude/` and `plugin/`

- **`.claude/`** (this file, its rules, skills and settings) is for working **on** this
  repo. It never reaches a user's machine.
- **`plugin/`** is what users get. Claude Code copies only this folder to each machine.
  Its own instructions (`plugin/instructions/`), skills, agents and output style are
  written for **any** project, so they follow the plugin's rules (neutral, one home per
  rule, and they read a project's own additions), not the rules in this folder. How they
  fit: `docs/design/instructions.md` § Instructions, skills and agents.

Do not mix them: a rule for working on this repo never goes into `plugin/`, and a skill
for users never goes into `.claude/`.

## The rule above all: neutral

The plugin works for anyone. No company, project, organization, person, machine or team
name goes anywhere in the repo. Every project detail comes from the project's own
`.claude/cc-smart-dev-kit.json` and `.claude/` folder. The detail, and what `bun run check:neutral`
does and does not catch: `.claude/rules/neutrality.md`.

## Write plainly

Many readers use English as a second language. In code comments, docs, commit messages
and command output: short sentences, plain words, active voice. Explain a technical word
the first time you use it.

## Bun only

- `bun install`, `bun add <pkg>`, `bun run <script>`, `bunx <cmd>`. Never `npm` or `npx`.
- Runtime dependencies: `zod` and the official MCP SDK; ask before adding another.
  SDK versions, approval and bundle boundary: `.claude/rules/bundles-and-releases.md` § Dependencies.

## Layout

| Path | What it holds |
|---|---|
| `src/entries/*.ts` | One file per bundle. Each becomes `plugin/dist/<name>.js`. |
| `src/build-info/` | The version and the marketplace source, baked in from `plugin.json` at build time; the fixed names, without the version, in `names.ts` (the router bundle uses those). |
| `src/project/` | Finds the git project from a folder and reads its `.claude/cc-smart-dev-kit.json`; `init.ts` plans and writes the two files `project init` makes. |
| `src/workflow/` | The workflow: the settings it holds (`schema.ts`), the resolution order and the switches (`resolve.ts`), the one auto-merge decision (`auto-merge.ts`, whose refusal is the merge guard's reason), the writers (`write.ts`), the review record (`reviews.ts`), the alerts a hook reads (`alerts.ts`), and the command (`commands.ts`). |
| `src/setup/` | Safe changes to user files: managed keys, list entries and blocks, backups, atomic writes, the lock, the launcher, restore, marketplace access, the auto-mode block. |
| `src/cli/` | The CLI's own parts: the paths (`paths.ts`, from `cliPaths()`), the commands that live here — `setup`, `doctor` (its `--live` proof in `live-check.ts`; the current folder's project checks in `project-checks.ts`), `project init` (the two files a project opts in with, `project-init.ts`), `migrate`, `restore`, `update`, `statusline`, `subagent-statusline`, `usage` — and their helpers (`secret-line.ts`, `git-bash.ts`, `bun-check.ts`). |
| `src/machine/` | Machine setup: the companion plugins, claude-mem's settings, Warp, `Machine` (the system, faked in tests), the host's platform (`host.ts`), and opening a URL on the person's desktop (`open-url.ts`). |
| `src/gateway/` | The optional AI gateway: the router, its config and slots (the model slots, the judge test and its proof too), a model slot's fallback answer made safe for Claude (`fallback-answer.ts`), the limit state file, `gateway <command>`, its service (a socket unit and the router unit) and its doctor checks. |
| `src/omniroute/` | OmniRoute, the program the affordable slots answer from: which release a machine may install (`registry.ts`), where it is installed and its unit (`install.ts`), and the `omniroute` command (`commands.ts`). |
| `src/portal/` | The portal's server and its door (`guard.ts`), its health answer (`health.ts`), its life — the copy, the start, the restart, the stop (`lifecycle.ts`), the session-start part (`session-start.ts`) — the pages (`views.ts`, `assets.ts`), the actions that run the CLI's own code, and the `portal` command (`command.ts`; `.claude/rules/portal.md`). |
| `src/portal/api/` | The portal's JSON API (B6b): `routes.ts` (one read-only GET per answer, through the door), `types.ts` (the shapes), and `data.ts` / `work.ts` (the builders, from `page-data.ts`'s readers, never a second copy). |
| `src/portal/live/` | The portal's live stream (B6b): `hub.ts` (the SSE hub: capped, resumable by `Last-Event-ID`) and `sources.ts` (what it polls: the router's `recent`, the crew store, limits, guard asks, the job queue). |
| `src/update/` | The self-update: the SessionStart hook's part, the detached background check, `cc-smart-dev-kit update`'s steps, and their state files. |
| `src/browser/` | The browser: finding the person's Chrome and its `claude-code` profile, the token file, the Playwright MCP launcher (`browser mcp`, extension mode), `browser setup`/`token`/`check`, and `doctor`'s browser lines (`.claude/rules/browser.md`). |
| `src/mcp/` | The MCP servers `setup` registers at user scope: the registrations (`servers.ts`; the servers' names alone in `names.ts`, which the router bundle reads), Claude Code's own `claude mcp` commands around them (`register.ts`), the record of what it registered (`records.ts`), the Tavily key (`tavily.ts`), what `mcp status` reports (`status.ts`), `doctor`'s lines (`doctor.ts`), and what setup takes back of a server it retired — Serena's registration, context file and records (`retired.ts`). |
| `src/sessions/` | The `cc-smart-dev-kit sessions` command: reading Claude Code's saved sessions, and reopening the ones a restart or a closed window stopped. |
| `src/crew/` | The lead and its crew (`docs/design/crew.md` § Lead and the crew): the command and its arguments (`command.ts`, `args.ts`, `usage.ts`), the store (`store.ts`), the start with its brief, the caps and the queue (`start.ts`, `brief.ts`, `places.ts`), what a crew session says (`step.ts`, `report.ts`, `diff.ts`, `self-watch.ts`, `memory.ts`, `transcript.ts`, `telemetry.ts`), what the lead hears and answers (`watch.ts`, `answer.ts`), the board and the end of a crew session (`board.ts`, `end.ts`, `remove.ts`), and the view of Claude Code's own commands (`claude.ts`, `agents.ts`). |
| `src/issues/` | GitHub Issues, opt-in (D67, `docs/design/issues.md`): `issue file` and the hidden marker (`file.ts`, `marker.ts`, `screen.ts`), the fixed mark and the release list (`fixed.ts`, `pending.ts`: the queue and the pass budget), a phase from an issue and its hand-back (`pickup.ts`, `handback.ts`), the lead's look at new issues (`feed.ts`), `issue <command>` and `doctor`'s lines (`command.ts`, `doctor.ts`), and the fake GitHubs the tests use (`fake-github.ts`, `fake-feed.ts`). |
| `src/tasks/` | The kit's task system (D75, `docs/design/tasks.md`): `work/` the local store, `project/` the repo files, `context.ts` the resolver, `guard-view.ts` the guards' join, `words.ts` the shared tool names and steps, the MCP server and command. |
| `src/user-away/` | The `cc-smart-dev-kit user` command (`unavailable`, `available`, `status`, `park`, `list`, `clear`): whether the person can answer, and the list of what waits for them (`state.ts`); the user-away hook reads the same state. |
| `src/workflows/` | The test side of the workflow scripts in `plugin/workflows/`: the runner that executes a script with fakes for `agent`, `parallel` and the rest (`script-runner.ts`), and a test file for each script. The scripts themselves ship in `plugin/`. |
| `src/models/` | The launch policy's one home (`launch-policy.ts`): which model and effort a subagent or a crew session runs on, the crew kinds, `UI_POLICY` (D50), the premium tiers the agent guard judges. |
| `src/worktrees/` | The `cc-smart-dev-kit worktrees` command: the finished-worktree verdict (`verdict.ts`), the machine's facts (`machine-facts.ts`), the scan and removal (`scan.ts`), and the `.worktreeinclude` copy the crew launcher uses (`include.ts`). |
| `src/ports.ts` | The local ports cc-smart-dev-kit holds as locks, and why they stay below 32768. |
| `src/hooks/` | The hooks: the frame every one runs in (`run.ts`), the guards, the notes, the StopFailure usage-limit alert, the project's own copies (`ownHooks`, `settings-hooks.ts`), and the shape of a subagent's worktree (`subagent-worktree.ts`); `specs.ts` lists them all. Each hook's entry is in `src/entries/`. |
| `src/jobs/` | The heavy-job queue: kinds, memory readings, the lease store, the queue, the launch, `job <command>`, the classifier, and the queue as data (`status.ts`: one reader for `job status`, `/api/jobs` and the Machine page). |
| `src/shell/` | The shell text: the lexer that reads a Bash line as the commands it runs (quotes, here-docs, `bash -c`), and the PowerShell single-quoted literal. |
| `src/testing/` | Test helpers: temp folders, a clean git environment, a fake machine for setup, the guard that fails any test reaching the live router's port 20100. |
| `install.sh`, `install.ps1` | The one-command installers for macOS/Linux (and Git Bash) and native Windows; `scripts/install*` proves them (`.claude/rules/installer.md`). |
| `portal/` | The portal's Next.js app (D49): its own package and lockfile, the views, the routing shell, the one data client, and `scripts/csp-hashes.ts`. `bun run build:portal` turns it into `plugin/portal-ui/`, the export a machine gets. |
| `plugin/` | What users get: `dist/` (built, committed), `portal-ui/` (the portal's built export, committed; `scripts/portal-export.ts`), `bin/` (`cc-smart-dev-kit`, and `cc-smart-dev-kit-bun.sh`, which the hooks run through), `hooks/hooks.json`, `monitors/monitors.json`, `instructions/` (`setup` copies and imports them), `skills/`, `agents/`, `workflows/` (the runs a skill starts, loaded as `<plugin>:<meta.name>`), `output-styles/`, `settings.json` (the plugin's default settings: the agent panel's subagent status line), `bunfig.toml` (empty, and it stays empty), the manifest. |
| `scripts/` | `build.ts` (the bundle step), `portal-export.ts` (the portal's export: `build:portal` and its `--check`), `check-neutral.ts` (the neutrality check), `check-duplicates.ts` (one home per rule in `plugin/`), `check-core-lines.ts` (the general instructions' line budget), `check-version-bump.ts` (CI: a `plugin/` change raises the version) and `windows-hook-smoke.sh` (the Windows CI job's hook proof, `docs/windows-hooks.md`). |
| `docs/` | How the plugin is designed, the phases ahead, and the Claude Code behaviour it relies on. |

Tests sit beside the code as `*.test.ts`.

## Checks

| Command | What it does |
|---|---|
| `bun run check` | Everything below except the validates, in CI's order. Run it before every commit. |
| `bun run typecheck` | `tsc --noEmit`. |
| `bun run lint` | Biome: lint and format check. `bun run format` fixes formatting. |
| `bun run check:neutral` | Fails when a file names the publisher. |
| `bun run check:duplicates` | Fails when a sentence of 12+ words repeats across the plugin's instructions, skills, agents, output styles and workflow scripts. |
| `bun run check:docs` | Fails when a reference to a design page, a rule, or a section of the README names a heading that does not exist; when a design reference points at the index and no page holds that section; and when a `](#…)` link in a file names no heading in that file. Skips the plans, the research archives and the eval fixtures: those describe what was true then, or another project. |
| `bun run check:core-lines` | Fails when `plugin/instructions/core.md` passes 140 lines, and warns above 130: every session on every machine loads that file. |
| `bun test` | The tests, without `portal/` (`bunfig.toml` skips it). |
| `cd portal && bun run test` | The portal's own tests. Needs `portal/node_modules`; CI runs them in their own step, `bun run check` does not. |
| `bun run build` / `build:check` | Rebuild `plugin/dist`, or fail when it is stale. |
| `bun run build:portal` / `check:portal` | Rebuild the portal's export into `plugin/portal-ui`, or build and fail when it differs. Needs `portal/node_modules`; CI proves it, `bun run check` does not. |
| `claude plugin validate plugin --strict` | Checks the plugin manifest. |
| `claude plugin validate . --strict` | Checks the marketplace manifest. |

CI runs all of them on every pull request, with the tested Claude Code version. CI also
fails a pull request that changes anything under `plugin/` without raising `version` in
`plugin/.claude-plugin/plugin.json` (`.claude/rules/bundles-and-releases.md`).

## Rules

Each rule loads itself when you touch a file it covers.

| Rule | Loads on | About |
|---|---|---|
| `neutrality.md` | every turn | No names; where project details come from. |
| `bundles-and-releases.md` | `src/`, `scripts/`, `plugin/`, `package.json` | Committed bundles, what `plugin/` may hold, versions, the names before this one. |
| `dynamic.md` | `src/`, `scripts/`, `plugin/`, `docs/`, `README.md` | One source per value: names, paths, ports, versions, lists. |
| `hooks.md` | `src/hooks/`, the hook entries in `src/entries/`, `plugin/hooks/`, `plugin/bin/` | The hook contract: who wires it, the bun shim, the frame, quiet output, the one shell reader, timeouts, tests. |
| `hooks-guards.md` | the guards in `src/hooks/`, `specs.ts`, `run.ts`, their entries | What a guard answers: the crew refusals, the machine-wide and `alwaysOn` rules, `ownHooks`, fail closed, and the one fail-safe table. |
| `notify.md` | `src/hooks/notify*`, `stop-failure*`, `desktop-alert*`, `terminal*`, `alert-sound.ts`, `src/setup/user-notify-hook.ts` | The notifier: its two wirings, the desktop and terminal routes, `terminalSequence`, and the usage-limit hook. |
| `session-start.md` | `src/update/`, `src/portal/session-start.ts`, `lifecycle.ts`, the SessionStart hooks | What a session start may do, the background self-update, and the major-version hold. |
| `browser.md` | `src/browser/`, `src/hooks/playwright-output*`, `src/mcp/`, `src/testing/chrome-world.ts` | The browser: never stdout, the required token, Chrome's own profile, read-only Preferences, the costs upstream will not fix. |
| `setup-and-managed-files.md` | `src/setup/`, `src/cli/restore.ts`, `src/cli/paths.ts`, `src/workflow/write.ts` | How the command changes user files: the managed writers, never take what is not ours, the lock, `--dry-run` and `restore`. |
| `setup-commands.md` | `src/cli/setup*`, `src/cli/project-init*`, `src/machine/`, `src/mcp/` | What setup may run and when: every question first, services and restarts, root, trust rules, `Machine`. |
| `command-output.md` | `src/cli/`, `src/gateway/commands.ts`, `install.sh`, `install.ps1` | One way to print; every mark with words; a failed check carries its fix; `doctor`'s groups and exit codes. |
| `gateway.md` | `src/gateway/`, `src/entries/router.ts`, the gateway skill and doc | Never change prompt text; the login reaches Anthropic only; Claude judges first and only a tested worker target stands in; server tools go to Anthropic; every slot works the same way, each with its own fallback switch; secrets; restarts. |
| `portal.md` | `src/portal/`, `src/omniroute/`, `src/entries/portal.ts` | The portal's door; OmniRoute's three-day rule. |
| `cc-smart-dev-kit-json.md` | `src/project/`, `src/workflow/schema.ts`, `src/jobs/kinds.ts` | The `.claude/cc-smart-dev-kit.json` contract. |
| `installer.md` | `install.sh`, `install.ps1`, `scripts/install*` | The one-command installer: it ships on merge, its exit codes, its secret cleaners, the Windows smoke test. |
| `testing.md` | `*.test.ts`, `src/testing/` | Temp folders only; the time zone; every test can fail. |

## Skills

| Skill | When |
|---|---|
| `release` | Ship a new plugin version: version bump, build, checks, PR, update on one machine. |
| `claude-code-upgrade` | A new Claude Code version is out, or the weekly CI job opened an issue. |

## Docs

- `README.md` — for users: install, what it does, commands, `cc-smart-dev-kit.json`;
  release notes are in `CHANGELOG.md`.
- `CHANGELOG.md` — what each release changed, newest first.
- `docs/design.md` — the index to how the parts fit, and why; a page for each part under
  `docs/design/`.
- `docs/migrate.md` — moving a machine from the old `anymodel` names, and what a project
  still carries from them.
- `docs/roadmap.md` — the phases, done and ahead.
- `docs/design/tasks.md` — local work, project task files, guards and the move from older lists (D75).
- `.claude/plans/` and `.claude/research/` — the plan being built and the research behind it; each moves to its `archive/` folder when it is decided or done.
- `docs/claude-code-contract.md` — every Claude Code behaviour the plugin relies on, the
  version it was last proved on, and how.
- `docs/gateway.md` — the AI gateway: how it routes, what it changes and never changes,
  the service, and its limits.
- `docs/jobs.md` — the heavy-job queue: how a job waits and runs, the kinds, the config,
  the shared view, and its limits.
- `docs/windows-setup.md` — native Windows: the one path layout, the `.cmd` launcher, file
  modes vs the profile's ACL, Git Bash, and what still has to be tested on Windows; with its
  four companions: `docs/windows-hooks.md`, `docs/windows-notify.md`, `docs/windows-jobs.md`
  and `docs/windows-gateway.md`.

**Keep them true in the same change.** Change how a part works: update its page under
`docs/design/` (and its line in `docs/design.md`'s index if the part is new).
Change a command or a `cc-smart-dev-kit.json` field: update `README.md`. Rely on a new Claude Code
behaviour: add its row to `docs/claude-code-contract.md`. The tested Claude Code version
lives in one file, `.claude-code-version` at the repo root.

## Safety

- No secrets in this repo: no tokens, keys, passwords or private URLs. Name an
  environment variable; never write its value.
- Every change to a user's file goes through `src/setup/` (backup, atomic write, lock).
  Never write to a user's settings any other way.
- Tests never touch the real `~/.claude`, `~/.config` or `~/.local`.

## Shipping

Work on a branch, open a pull request into `main`, and let CI go green. The merge waits
for the owner's yes. A new plugin version follows the `release` skill.
