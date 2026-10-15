# anymodel

`anymodel` lets a person use any model with Claude Code. It is a plugin anyone can
install: a local AI gateway, hooks, skills, agents, and the `anymodel` command, which sets
up and checks a machine. Nothing in it is tied to one project. A project opts in, and sets its own details, in its own
`.claude/anymodel.json`.

This repo is also the plugin's marketplace (a list of plugins Claude Code can install
from), named `anymodel`.

## Install

You need macOS or Linux (for now: the launcher and `bin/` are POSIX `sh` scripts),
[Claude Code](https://code.claude.com), [Bun](https://bun.sh), and read access to this
repo with git (an SSH key, or a git credential helper when the repo is private).

1. Add the marketplace. `<owner>/anymodel` is where this repo lives: the `repository`
   field of `plugin/.claude-plugin/plugin.json`.

   ```sh
   claude plugin marketplace add <owner>/anymodel
   ```

2. Install the plugin for your user:

   ```sh
   claude plugin install anymodel@anymodel
   ```

3. Run the first setup. The `anymodel` command does not exist yet, so run it from the
   plugin folder. Put the installed version in place of `<version>` (the install prints
   it; `ls ~/.claude/plugins/cache/anymodel/anymodel/` shows it too):

   ```sh
   bun ~/.claude/plugins/cache/anymodel/anymodel/<version>/dist/cli.js setup
   ```

   Setup installs the launcher `~/.local/bin/anymodel`, turns on auto-update for the
   plugin, and installs the plugin's general instructions for Claude (§ Instructions,
   skills and agents). Add `--dry-run` to see the changes first; it writes nothing at all.
   Add `--no-instructions` to leave the instructions out (setup remembers that choice).

4. Restart Claude Code.

After that, use `anymodel setup` to set up again (for example after an update).

## Commands

| Command | What it does |
|---|---|
| `anymodel setup [--dry-run] [--no-instructions \| --instructions]` | Installs the launcher, turns on plugin auto-update, and installs the instructions: a copy in `~/.claude/anymodel/instructions/`, imported by an anymodel block in `~/.claude/CLAUDE.md` (your own text there is kept). Each run refreshes the copy; run it after a plugin update. `--no-instructions` takes the block and the copy out and **keeps them out**: setup stores the choice (`~/.claude/anymodel/no-instructions`), so a later plain `anymodel setup` leaves them out too. `--instructions` clears that choice and installs them again. `restore` clears it as well. `--dry-run` shows the changes and writes nothing at all. A settings key you set yourself (for example `autoUpdate: false`) stops setup before it writes anything. |
| `anymodel doctor` | Checks the install, and the anymodel files the current project's `CLAUDE.md` imports (the list is below). Prints ✓ or ✗ for each check, and exits with 1 when one fails. |
| `anymodel restore [--yes] [--now]` | Removes what setup added (its settings keys, its block in `CLAUDE.md`, the instructions' copy, and a stored `--no-instructions` choice) and keeps everything else. The launcher goes back to how it was before setup first changed it, or is removed when setup created it. With the gateway installed and on, it runs in **two stages**, because running Claude sessions still send every request to the router: the first restore removes everything but the router (the gateway's env keys too) and says to restart every running session; the second disables and stops the router (it asks, because that cuts answers in flight; `--yes` skips the question), waits up to 15 s for its port to close (not for its answers in flight, which finish in the background; and not at all when the unit was not running or another program answers on the port: it says so), and removes its copy and unit. `--now` does both at once, after a warning that every running session fails until it restarts (asked, or `--yes`). It keeps `gateway.json`, which holds your key. A restore with nothing left changes nothing. |
| `anymodel gateway <command>` | The optional AI gateway (below). |
| `anymodel version` | Prints the version. |

`doctor` checks that:

- the plugin is installed;
- the installed version is not behind the marketplace's local copy. When it is, ✗ says
  "installed X, marketplace has Y. Run: claude plugin update anymodel@anymodel". When the
  local copy or its version cannot be read, it says "Run: claude plugin marketplace
  update anymodel";
- the launcher matches the script setup would write for the `bun` baked into it, and
  that `bun` is executable;
- the instructions: the copy in `~/.claude/anymodel/instructions/` is this plugin
  version's (its version stamp, and each file against the plugin's), and `~/.claude/CLAUDE.md`
  still holds the block that imports it. A ✗ says "Run: anymodel setup". After
  `--no-instructions`, a `·` line says they are left out, as information;
- the current project: when a `CLAUDE.md`, `.claude/CLAUDE.md` or `CLAUDE.local.md` in the
  current folder or a folder above it imports an anymodel file
  (`@~/.claude/anymodel/instructions/…`), that file exists. A missing one loads nothing and
  Claude Code says nothing about it, so doctor fails with "Run: anymodel setup" (or, after
  `--no-instructions`, a `·` line with `anymodel setup --instructions`). No import, no line;
- git can read the marketplace (`git ls-remote`, which never asks for a password). It
  adds ssh `BatchMode` only when you have no ssh command of your own
  (`GIT_SSH_COMMAND`, `GIT_SSH` or `core.sshCommand`). It prints URLs without
  credentials;
- auto-update is on for the plugin;
- updates are not switched off. It fails when `DISABLE_AUTOUPDATER`, `DISABLE_UPDATES`
  or `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC` is set, in your environment or in the
  `env` of `settings.json`, without `FORCE_AUTOUPDATE_PLUGINS`. A value that is empty,
  `0`, `false`, `no` or `off` counts as not set;
- no other plugin named `anymodel` is enabled, and the plugin's old id `cc@cc-agentic`
  (its name before version 0.2.0) is not enabled either: two copies of the same hooks
  would run. When the old setup ran on this machine (its folder `~/.claude/cc-agentic`
  is there), anything else it left fails too: the old plugin installed, its launcher
  `~/.local/bin/cc-agentic`, `extraKnownMarketplaces.cc-agentic`, or the `cc-agentic`
  marketplace. The ✗ gives the order: `cc-agentic restore` first (or, when the old
  launcher cannot run, the two things to remove by hand), then `claude plugin uninstall
  cc@cc-agentic`, then `claude plugin marketplace remove cc-agentic`;
- no gateway setup stopped half way: while one did, ✗ "a gateway setup did not finish;
  run: anymodel gateway setup";
- the gateway, when it is installed (the router copy or its unit is there): the router
  service is active, the router copy is this plugin version's, the router answers on its
  port, each backend answers; and, as information, each slot's first target. Without
  `gateway.json` (set up with `--no-backend-key`), a `·` line says every slot answers on
  Claude. When it was never set up, doctor says "gateway: not set up (optional)" as
  information (`·`), not as a failure; with only `gateway.json` left (restore keeps it),
  "gateway.json kept; the gateway is not installed".

Setup only changes the keys it owns. Before each change it makes a backup in
`~/.claude/anymodel/backups/` (a private folder, one subfolder per file), never beside
the file. A backup is never executable.

The command follows `HOME` and `CLAUDE_CONFIG_DIR`. With `CLAUDE_CONFIG_DIR` set, its
state and backups live under that folder. The launcher `~/.local/bin/anymodel` is one
file for every config folder, so a `restore` under one config folder can remove a
launcher another one still uses. A launcher started without `CLAUDE_CONFIG_DIR` looks in
`~/.claude`.

## The AI gateway (optional)

A local router, `anymodel-router`, lets Claude Code's `haiku` and `sonnet` subagents run on
cheaper models (for example through OmniRoute and Ollama Cloud), while Claude models stay
real Claude on your own login. No prompt text is ever changed. Linux only for now
(systemd user units). How it works: [docs/gateway.md](docs/gateway.md).

| Command | What it does |
|---|---|
| `anymodel gateway setup [--yes] [--backend-key-stdin <backend> \| --no-backend-key]` | Makes `~/.config/anymodel/gateway.json` (mode 600; the key on stdin, never argv), copies the router to `~/.local/share/anymodel/router.js`, writes the systemd user unit `anymodel-router`, starts it, and waits up to 5 s for it to answer. First of all it asks the router's port: when another program holds it (an older router, say), it stops and writes nothing. When the router runs and the copy or unit changed, it says a restart cuts the answers in flight and asks; `--yes` skips the question. A setup that stopped half way is finished by the next one. It never touches Claude Code's settings. |
| `anymodel gateway status` | Router health, each backend, the slots, and whether Claude Code points at the gateway. Keys are masked. |
| `anymodel gateway models` | Every model each backend offers, and the slots. |
| `anymodel gateway slot <scout\|worker\|judge> <target>[,<target>…]` | Sets a slot's targets, checked against the backend's model list. Live, no restart. `slot judge off` puts auto mode's safety check back on Claude. |
| `anymodel gateway on` | Points Claude Code at the router: sets its env keys in your `settings.json` as keys anymodel owns. A gateway key someone else set stops it; nothing is overwritten. Every running session switches on save. |
| `anymodel gateway off` | Removes exactly the keys `on` set. Restart the sessions afterwards. |
| `anymodel gateway serve` | Runs the router in the terminal. |

### First setup

1. Run OmniRoute on this machine at `http://127.0.0.1:20128`: setup writes that address
   for the `omniroute` backend. Give it a connection to a provider (Ollama Cloud, say),
   and make an API key in it for the router. OmniRoute somewhere else: after setup,
   change `backends.omniroute.baseUrl` in `~/.config/anymodel/gateway.json`.
2. Save that key in a file only you can read, and give it to setup **on stdin**. The
   first key is always the `omniroute` backend's: the default slots use it.

   ```sh
   anymodel gateway setup --backend-key-stdin omniroute < key-file
   ```

   Why a file: a key typed at the prompt shows on the screen, and setup reads to the end
   of the input, so typing it also needs Ctrl-D. A key as an argument would land in the
   shell history and the process list, so setup refuses one there. No key yet:
   `anymodel gateway setup --no-backend-key` (every slot answers on Claude).
3. `anymodel gateway status`, then `anymodel gateway on`.

The judge slot, which moves auto mode's safety check to a cheaper model, is **off by
default**. Turn it on only when you accept the trade-off: a cheaper judge can block good
work, and a weak one can let a risky command through. "Off by default" relies on the
router recognising the check by its prompt. If Claude Code rewords that prompt, the check
is routed by its model name until the router is updated (see
[docs/gateway.md](docs/gateway.md) § Known limits; [roadmap](docs/roadmap.md) Phase 3).

## Instructions, skills and agents

The plugin gives Claude general working instructions, skills and agents, written for any
project.

**The always-on instructions** (`plugin/instructions/core.md`): Claude works as the senior
engineer and team lead — it plans, splits the work into independent phases, starts them at
the same time as parallel subagents, checks each hand-back and gets one second-opinion review
per change set. Also: the role, delegation, each subagent's model and effort, review, the core
principles, how to end a turn, and keeping docs true. `anymodel setup` installs them for your
user, **on by default**:

- a copy goes to `~/.claude/anymodel/instructions/` (refreshed by every setup, so run setup
  after a plugin update);
- one block in `~/.claude/CLAUDE.md` imports it:

  ```markdown
  <!-- anymodel:begin -->
  <!-- Written by anymodel setup. `anymodel setup --no-instructions` takes it out. -->
  @~/.claude/anymodel/instructions/core.md
  <!-- anymodel:end -->
  ```

  Your own text in that file stays as it is. Do not edit inside the block: setup rewrites it.
- `anymodel setup --no-instructions` takes the block and the copy out, and keeps them out:
  a later plain `anymodel setup` leaves them out too. `anymodel setup --instructions` brings
  them back. `anymodel restore` takes them out with everything else and forgets the choice,
  so the next setup installs them again.
- Setup records which plugin version wrote the copy (`~/.claude/anymodel/instructions-version`).
  `doctor` says when the copy is behind the installed plugin.

The import reaches the main session and subagents that load `CLAUDE.md` (the built-in
`Explore` and `Plan` do not). With `CLAUDE_CONFIG_DIR` set, both live under that folder.

**Opt-in instructions, per project.** `plugin/instructions/optin/worktrees.md` is for a
project that runs one Claude session per git worktree, several at once. Setup copies it too,
but nothing imports it until a project does — add this line to the project's `CLAUDE.md`:

```markdown
@~/.claude/anymodel/instructions/optin/worktrees.md
```

Claude Code asks once before it loads an import from outside the project (its docs say so;
not yet proved here: `docs/claude-code-contract.md`). The file reads its
values (`base`, `prefix`, `setup`) from the project's `.claude/anymodel.json`, field
`worktrees`.

That committed import line points at **each person's own copy**. For a teammate without
anymodel, or one who ran `anymodel setup --no-instructions`, the file is not there, and the
import loads nothing — Claude Code gives no error. `anymodel doctor`, run in the project,
names such a missing import.

**16 skills** (`/anymodel:<name>`; each also loads on its own when its topic comes up):

| Skill | Use it for |
|---|---|
| `review` | Your own review before a commit, and the one second opinion per change set. |
| `plan-task` | Planning non-trivial work: research, questions, the plan file, phases and owners. |
| `commit` | When to commit, push, open the pull request and ask for the merge. |
| `pull-request` | What every pull request body carries. |
| `verify-change` | The cheap loop after edits; the checks the push will run; testing with the person. |
| `research-first` | Research before you build; reuse before you write your own. |
| `subagent-decision` | Which agent for which job, and how to brief it. |
| `impact-analysis` | Every consumer of a shared thing, before and after a change. |
| `extract-or-duplicate` | Extract now or wait; where a shared piece lives. |
| `self-evolve` | Turning a correction into a rule, skill, hook, doc or memory; size budgets. |
| `memory-routing` | Where a fact, a preference or a to-do belongs. |
| `explain` | Teaching code or an idea in plain words. |
| `performance-budget` | React and Next.js performance, with a deep playbook read on purpose. |
| `ui-verify` | A browser check of a UI change, and your design verdict. |
| `worktree` | The steps of one-worktree-per-session work (for projects that opt in). |
| `gateway` | The optional AI gateway. |

**4 agents** (`anymodel:<name>`; the caller passes the model and effort on each launch, so
none is pinned in their files). `reviewer` and `rules-maintainer` load the skill they work by
(`review`, `self-evolve`) at start, through their `skills:` field:

| Agent | Job | Needs |
|---|---|---|
| `reviewer` | The read-only second opinion on a change set. | — (uses Serena when it is there) |
| `rules-maintainer` | Edits to instruction files, with a duplicate and conflict check. | — |
| `code-explorer` | Symbol search: callers, references, definitions. | the **Serena** MCP server |
| `ui-verifier` | Drives the running app in a browser and measures. | the **Playwright** MCP server |

The MCP servers keep their usual tool names (`mcp__serena__*`, `mcp__playwright__*`) because
they are registered for your user, not served by the plugin.

**An output style**, `Structured replies` (answer first, short sections, tables). Optional:
pick it with `/output-style`. The plugin never switches it on.

### A project adds its own part

Every skill first reads the project's own add-on file when it exists:
`.claude/anymodel/<skill>.md` — for example `.claude/anymodel/review.md` or
`.claude/anymodel/ui-verify.md` (how to find this project's dev server). Where the project's
`CLAUDE.md`, its rules or an add-on file differ from the plugin's general text, the project's
text wins. So the plugin stays general, and each project keeps its own rules in its own repo.

## A project's `.claude/anymodel.json`

```json
{
  "requires": ">=0.1",
  "worktrees": { "base": "main", "prefix": "app-wt-", "setup": ["bun", "install"] },
  "instructions": true,
  "autoMode": ["In my-app: never touch production."]
}
```

| Field | Status |
|---|---|
| `requires` | Used now. |
| `worktrees` | Accepted now, used from Phase 3. |
| `instructions` | Accepted now. Today a project loads the opt-in instructions with its own import line (§ Instructions, skills and agents); the field does not load them yet. |
| `autoMode` | Accepted now, used from Phase 6. |

`requires` is a version range (npm syntax). When the installed plugin is outside it, the
plugin says so and asks you to run `claude plugin update anymodel@anymodel`.

## Develop

See `.claude/CLAUDE.md`. In short: `bun install`, change `src/`, `bun run build`,
`bun run check`, and commit `plugin/dist` with the change.

## Docs

- [Design](docs/design.md): how the parts fit, and why.
- [Roadmap](docs/roadmap.md): the phases, done and ahead.
- [Claude Code contract](docs/claude-code-contract.md): the Claude Code behaviour the
  plugin relies on, and the version it was last proved on.
