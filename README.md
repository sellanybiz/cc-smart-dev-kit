# cc-agentic

`cc` is a general Claude Code setup that anyone can install as a plugin: hooks, skills,
agents, and the `cc-agentic` command, which sets up and checks a machine. Nothing in it is
tied to one project. A project opts in, and sets its own details, in its own
`.claude/cc.json`.

This repo is also the plugin's marketplace (a list of plugins Claude Code can install
from), named `cc-agentic`.

## Install

You need macOS or Linux (for now: the launcher and `bin/` are POSIX `sh` scripts),
[Claude Code](https://code.claude.com), [Bun](https://bun.sh), and read access to this
repo with git (an SSH key, or a git credential helper when the repo is private).

1. Add the marketplace. `<owner>/cc-agentic` is where this repo lives: the `repository`
   field of `plugin/.claude-plugin/plugin.json`.

   ```sh
   claude plugin marketplace add <owner>/cc-agentic
   ```

2. Install the plugin for your user:

   ```sh
   claude plugin install cc@cc-agentic
   ```

3. Run the first setup. The `cc-agentic` command does not exist yet, so run it from the
   plugin folder. Put the installed version in place of `<version>` (the install prints
   it; `ls ~/.claude/plugins/cache/cc-agentic/cc/` shows it too):

   ```sh
   bun ~/.claude/plugins/cache/cc-agentic/cc/<version>/dist/cli.js setup
   ```

   Setup installs the launcher `~/.local/bin/cc-agentic` and turns on auto-update for
   the plugin. Add `--dry-run` to see the changes first; it writes nothing at all.

4. Restart Claude Code.

After that, use `cc-agentic setup` to set up again (for example after an update).

## Commands

| Command | What it does |
|---|---|
| `cc-agentic setup` | Installs the launcher and turns on plugin auto-update. `--dry-run` shows the changes and writes nothing at all. A settings key you set yourself (for example `autoUpdate: false`) stops setup before it writes anything. |
| `cc-agentic doctor` | Checks the install (the list is below). Prints ✓ or ✗ for each check, and exits with 1 when one fails. |
| `cc-agentic restore` | Removes what setup added (its settings keys, its block) and keeps everything else. The launcher goes back to how it was before setup first changed it, or is removed when setup created it. A second restore changes nothing. |
| `cc-agentic version` | Prints the version. |

`doctor` checks that:

- the plugin is installed;
- the installed version is not behind the marketplace's local copy. When it is, ✗ says
  "installed X, marketplace has Y. Run: claude plugin update cc@cc-agentic". When the
  local copy or its version cannot be read, it says "Run: claude plugin marketplace
  update cc-agentic";
- the launcher matches the script setup would write for the `bun` baked into it, and
  that `bun` is executable;
- git can read the marketplace (`git ls-remote`, which never asks for a password). It
  adds ssh `BatchMode` only when you have no ssh command of your own
  (`GIT_SSH_COMMAND`, `GIT_SSH` or `core.sshCommand`). It prints URLs without
  credentials;
- auto-update is on for the plugin;
- updates are not switched off. It fails when `DISABLE_AUTOUPDATER`, `DISABLE_UPDATES`
  or `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC` is set, in your environment or in the
  `env` of `settings.json`, without `FORCE_AUTOUPDATE_PLUGINS`. A value that is empty,
  `0`, `false`, `no` or `off` counts as not set;
- no other plugin named `cc` is enabled.

Setup only changes the keys it owns. Before each change it makes a backup in
`~/.claude/cc-agentic/backups/` (a private folder, one subfolder per file), never beside
the file. A backup is never executable.

The command follows `HOME` and `CLAUDE_CONFIG_DIR`. With `CLAUDE_CONFIG_DIR` set, its
state and backups live under that folder. The launcher `~/.local/bin/cc-agentic` is one
file for every config folder, so a `restore` under one config folder can remove a
launcher another one still uses. A launcher started without `CLAUDE_CONFIG_DIR` looks in
`~/.claude`.

## A project's `.claude/cc.json`

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
| `instructions` | Accepted now, used from Phase 5. |
| `autoMode` | Accepted now, used from Phase 6. |

`requires` is a version range (npm syntax). When the installed plugin is outside it, the
plugin says so and asks you to run `claude plugin update cc@cc-agentic`.

## Develop

See `.claude/CLAUDE.md`. In short: `bun install`, change `src/`, `bun run build`,
`bun run check`, and commit `plugin/dist` with the change.

## Docs

- [Design](docs/design.md): how the parts fit, and why.
- [Roadmap](docs/roadmap.md): the phases, done and ahead.
- [Claude Code contract](docs/claude-code-contract.md): the Claude Code behaviour the
  plugin relies on, and the version it was last proved on.
