# cc-smart-dev-kit

This repo builds the **`cc-smart-dev-kit` plugin** for Claude Code. It is also the plugin's own
**marketplace** (a list of plugins Claude Code can install from), named `cc-smart-dev-kit`.
Its main job is letting a person use any model with Claude Code (the gateway). Anyone
can install it: the gateway, hooks, skills, agents, and the `cc-smart-dev-kit` command, which sets
up and checks a machine.

Users install it like this:

```sh
claude plugin marketplace add <owner>/cc-smart-dev-kit
claude plugin install cc-smart-dev-kit@cc-smart-dev-kit
cc-smart-dev-kit setup
```

The plugin, the marketplace and the command are all `cc-smart-dev-kit`: the plugin id is
`cc-smart-dev-kit@cc-smart-dev-kit`. Until version 0.2.0 they were `cc`, `cc-agentic` and
`cc@cc-agentic`; `doctor`'s check for that old plugin still names them. A machine that ran
0.2.x still carries that version's names: `cc-smart-dev-kit migrate` moves it, and
`README.md` § Moving from anymodel is the page about it.

## Two different things: `.claude/` and `plugin/`

- **`.claude/`** (this file, its rules, skills and settings) is for working **on** this
  repo. It never reaches a user's machine.
- **`plugin/`** is what users get. Claude Code copies only this folder to each machine.
  Its own instructions (`plugin/instructions/`), skills, agents and output style are
  written for **any** project, so they follow the plugin's rules (neutral, one home per
  rule, and they read a project's own additions), not the rules in this folder. How they
  fit: `docs/design.md` § Instructions, skills and agents.

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
- One runtime dependency: `zod`. Ask the owner before you add another. Version ranges
  use `Bun.semver`, which is built in.

## Layout

| Path | What it holds |
|---|---|
| `src/entries/*.ts` | One file per bundle. Each becomes `plugin/dist/<name>.js`. |
| `src/build-info/` | The version and the marketplace source, baked in from `plugin.json` at build time; the fixed names, without the version, in `names.ts` (the router bundle uses those). |
| `src/project/` | Finds the git project from a folder and reads its `.claude/cc-smart-dev-kit.json`; `init.ts` plans and writes the two files `project init` makes. |
| `src/workflow/` | The workflow: the settings it holds (`schema.ts`), the resolution order and the switches (`resolve.ts`), the one auto-merge decision (`auto-merge.ts`), the writers (`write.ts`), and the command (`commands.ts`). |
| `src/setup/` | Safe changes to user files: managed keys, list entries and blocks, backups, atomic writes, the lock, the launcher, restore, marketplace access, the auto-mode block. |
| `src/cli/` | The `cc-smart-dev-kit` commands: `setup`, `doctor` (and `--live`; its checks of the current folder's project in `project-checks.ts`), `project init` (the two files a project opts in with, `project-init.ts`), `workflow`, `hook`, `browser`, `sessions`, `worktrees`, `restore`, `migrate` (a machine still on 0.2.x's names), `update`, `session-name`, `statusline`, `usage`, `version`. |
| `src/machine/` | Machine setup: the companion plugins, claude-mem's settings, Warp, and `Machine` (the system, faked in tests). |
| `src/gateway/` | The optional AI gateway: the router, its config and slots (the model slots, the judge test and its proof too), a model slot's fallback answer made safe for Claude (`fallback-answer.ts`), the limit state file, `gateway <command>`, its service (a socket unit and the router unit) and its doctor checks. |
| `src/update/` | The self-update: the SessionStart hook's part, the detached background check, `cc-smart-dev-kit update`'s steps, and their state files. |
| `src/search/` | The `cc-smart-dev-kit search` command: web search and one page's text through the gateway's OmniRoute backend. |
| `src/browser/` | The shared browser: one Chrome for the machine, the tab filter that keeps each session's windows its own, the Playwright MCP launcher (`browser mcp`), the file-picker init page, and `browser check` (`.claude/rules/browser.md`). |
| `src/mcp/` | The MCP servers `setup` registers at user scope: the registrations (`servers.ts`), Claude Code's own `claude mcp` commands around them (`register.ts`), the record of what it registered (`records.ts`), the Tavily key (`tavily.ts`), Serena's context (`serena-context.ts`), `doctor`'s lines (`doctor.ts`). |
| `src/sessions/` | The `cc-smart-dev-kit sessions` command: reading Claude Code's saved sessions, and reopening the ones a restart or a closed window stopped. |
| `src/worktrees/` | The `cc-smart-dev-kit worktrees` command: the finished-worktree verdict (`verdict.ts`), the machine's facts (`machine-facts.ts`), the scan and removal (`scan.ts`). |
| `src/ports.ts` | The local ports cc-smart-dev-kit holds as locks, and why they stay below 32768. |
| `src/hooks/` | The hooks: the frame every one runs in (`run.ts`), the guards, the notes, the StopFailure usage-limit alert, the project's own copies (`ownHooks`, `settings-hooks.ts`), and the worktree engine a project wires itself (`cc-smart-dev-kit hook <name>`; its lines in `project-wiring.ts`, its create lock in `create-lock.ts`); `specs.ts` lists them all, by who wires them. Each hook's entry is in `src/entries/`. |
| `src/jobs/` | The heavy-job queue: kinds, memory readings, the lease store, the queue, the launch, `job <command>`, the classifier. |
| `src/shell/` | The shell lexer: reads a Bash line as the commands it runs (quotes, here-docs, `bash -c`). |
| `src/testing/` | Test helpers: temp folders, a clean git environment, a fake machine for setup, the guard that fails any test reaching the live router's port 20100. |
| `plugin/` | What users get: `dist/` (built, committed), `bin/` (`cc-smart-dev-kit`, and `cc-smart-dev-kit-bun`, which the hooks run through), `hooks/hooks.json`, `instructions/` (`setup` copies and imports them), `skills/`, `agents/`, `output-styles/`, the manifest. |
| `scripts/` | `build.ts` (the bundle step), `check-neutral.ts` (the neutrality check), `check-duplicates.ts` (one home per rule in `plugin/`) and `check-version-bump.ts` (CI: a `plugin/` change raises the version). |
| `docs/` | How the plugin is designed, the phases ahead, and the Claude Code behaviour it relies on. |

Tests sit beside the code as `*.test.ts`.

## Checks

| Command | What it does |
|---|---|
| `bun run check` | Everything below except the validates, in CI's order. Run it before every commit. |
| `bun run typecheck` | `tsc --noEmit`. |
| `bun run lint` | Biome: lint and format check. `bun run format` fixes formatting. |
| `bun run check:neutral` | Fails when a file names the publisher. |
| `bun run check:duplicates` | Fails when a sentence of 12+ words repeats across the plugin's instructions, skills, agents and output styles. |
| `bun test` | The tests. |
| `bun run build` / `build:check` | Rebuild `plugin/dist`, or fail when it is stale. |
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
| `bundles-and-releases.md` | `src/`, `scripts/`, `plugin/`, `package.json` | Committed bundles, what `plugin/` may hold, versions. |
| `hooks.md` | `src/hooks/`, `src/entries/`, `plugin/hooks/` | The hook contract (Phase 3). |
| `browser.md` | `src/browser/`, the picker entry, `plugin/serena/` | The shared browser: never stdout, one profile, the filter's refusals, the picker bundle. |
| `setup-and-managed-files.md` | `src/setup/`, `src/cli/`, `src/machine/` | How the command changes user files and the system. |
| `gateway.md` | `src/gateway/`, `src/entries/router.ts`, the gateway skill and doc | Never change prompt text; the login reaches Anthropic only; the judge is a fallback only; model slots only at the usage limit; secrets; restarts. |
| `cc-smart-dev-kit-json.md` | `src/project/` | The `.claude/cc-smart-dev-kit.json` contract. |
| `testing.md` | `*.test.ts`, `src/testing/` | Temp folders only; every test can fail. |

## Skills

| Skill | When |
|---|---|
| `release` | Ship a new plugin version: version bump, build, checks, PR, update on one machine. |
| `claude-code-upgrade` | A new Claude Code version is out, or the weekly CI job opened an issue. |

## Docs

- `README.md` — for users: install, commands, `cc-smart-dev-kit.json`.
- `docs/design.md` — how the parts fit, and why.
- `docs/roadmap.md` — the phases, done and ahead.
- `docs/claude-code-contract.md` — every Claude Code behaviour the plugin relies on, the
  version it was last proved on, and how.
- `docs/gateway.md` — the AI gateway: how it routes, what it changes and never changes,
  the service, and its limits.
- `docs/search.md` — `cc-smart-dev-kit search`: how it works, what a search costs, and its limits.
- `docs/jobs.md` — the heavy-job queue: how a job waits and runs, the kinds, the config,
  the shared view, and its limits.

**Keep them true in the same change.** Change how a part works: update `docs/design.md`.
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
