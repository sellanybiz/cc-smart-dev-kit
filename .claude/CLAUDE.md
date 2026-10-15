# anymodel

This repo builds the **`anymodel` plugin** for Claude Code. It is also the plugin's own
**marketplace** (a list of plugins Claude Code can install from), named `anymodel`.
Its main job is letting a person use any model with Claude Code (the gateway). Anyone
can install it: the gateway, hooks, skills, agents, and the `anymodel` command, which sets
up and checks a machine.

Users install it like this:

```sh
claude plugin marketplace add <owner>/anymodel
claude plugin install anymodel@anymodel
anymodel setup
```

The plugin, the marketplace and the command are all `anymodel`: the plugin id is
`anymodel@anymodel`. Until version 0.2.0 they were `cc`, `cc-agentic` and
`cc@cc-agentic`; only `doctor`'s check for the old plugin still names them.

## Two different things: `.claude/` and `plugin/`

- **`.claude/`** (this file, its rules, skills and settings) is for working **on** this
  repo. It never reaches a user's machine.
- **`plugin/`** is what users get. Claude Code copies only this folder to each machine.
  Its own instructions, skills and agents arrive in Phase 5. They are written for **any**
  project, so they follow the plugin's rules (neutral, and they read a project's own
  additions), not the rules in this folder.

Do not mix them: a rule for working on this repo never goes into `plugin/`, and a skill
for users never goes into `.claude/`.

## The rule above all: neutral

The plugin works for anyone. No company, project, organization, person, machine or team
name goes anywhere in the repo. Every project detail comes from the project's own
`.claude/anymodel.json` and `.claude/` folder. The detail, and what `bun run check:neutral`
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
| `src/project/` | Finds the git project from a folder and reads its `.claude/anymodel.json`. |
| `src/setup/` | Safe changes to user files: managed keys and blocks, backups, atomic writes, the lock, the launcher, restore, marketplace access. |
| `src/cli/` | The `anymodel` commands: `setup`, `doctor`, `restore`, `version`. |
| `src/gateway/` | The optional AI gateway: the router, its config and slots, `gateway <command>`, its service and its doctor checks. |
| `src/jobs/` | The heavy-job queue: kinds, memory readings, the lease store, the queue, the launch, `job <command>`, the classifier. |
| `src/shell/` | The shell lexer: reads a Bash line as the commands it runs (quotes, here-docs, `bash -c`). |
| `src/testing/` | Test helpers: temp folders, a clean git environment, the guard that fails any test reaching the live router's port 20100. |
| `plugin/` | What users get: `dist/` (built, committed), `bin/`, `hooks/hooks.json`, `skills/`, the manifest. |
| `scripts/` | `build.ts` (the bundle step), `check-neutral.ts` (the neutrality check) and `check-version-bump.ts` (CI: a `plugin/` change raises the version). |
| `docs/` | How the plugin is designed, the phases ahead, and the Claude Code behaviour it relies on. |

Tests sit beside the code as `*.test.ts`.

## Checks

| Command | What it does |
|---|---|
| `bun run check` | Everything below except the validates, in CI's order. Run it before every commit. |
| `bun run typecheck` | `tsc --noEmit`. |
| `bun run lint` | Biome: lint and format check. `bun run format` fixes formatting. |
| `bun run check:neutral` | Fails when a file names the publisher. |
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
| `setup-and-managed-files.md` | `src/setup/`, `src/cli/` | How the command changes user files. |
| `gateway.md` | `src/gateway/`, `src/entries/router.ts`, the gateway skill and doc | Never change prompt text; the login reaches Anthropic only; the judge is opt-in; secrets; restarts. |
| `anymodel-json.md` | `src/project/` | The `.claude/anymodel.json` contract. |
| `testing.md` | `*.test.ts`, `src/testing/` | Temp folders only; every test can fail. |

## Skills

| Skill | When |
|---|---|
| `release` | Ship a new plugin version: version bump, build, checks, PR, update on one machine. |
| `claude-code-upgrade` | A new Claude Code version is out, or the weekly CI job opened an issue. |

## Docs

- `README.md` — for users: install, commands, `anymodel.json`.
- `docs/design.md` — how the parts fit, and why.
- `docs/roadmap.md` — the phases, done and ahead.
- `docs/claude-code-contract.md` — every Claude Code behaviour the plugin relies on, the
  version it was last proved on, and how.
- `docs/gateway.md` — the AI gateway: how it routes, what it changes and never changes,
  the service, and its limits.
- `docs/jobs.md` — the heavy-job queue: how a job waits and runs, the kinds, the config,
  the shared view, and its limits.

**Keep them true in the same change.** Change how a part works: update `docs/design.md`.
Change a command or an `anymodel.json` field: update `README.md`. Rely on a new Claude Code
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
