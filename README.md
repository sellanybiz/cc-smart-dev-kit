# cc-agentic

`cc` is a general Claude Code setup that anyone can install as a plugin: hooks, skills,
agents, and the `cc-agentic` command, which sets up and checks a machine. Nothing in it is
tied to one project. A project opts in, and sets its own details, in its own
`.claude/cc.json`.

This repo is also the plugin's marketplace (a list of plugins Claude Code can install
from), named `cc-agentic`.

## Install

You need [Claude Code](https://code.claude.com), [Bun](https://bun.sh), and read access to
this repo with git (an SSH key, or a git credential helper when the repo is private).

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
   the plugin. Add `--dry-run` to see the changes first.

4. Restart Claude Code.

After that, use `cc-agentic setup` to set up again (for example after an update).

## Commands

| Command | What it does |
|---|---|
| `cc-agentic setup` | Installs the launcher and turns on plugin auto-update. `--dry-run` shows the changes and writes nothing. |
| `cc-agentic doctor` | Checks the install, including git access to the marketplace. Prints ✓ or ✗ for each check, and exits with 1 when one fails. |
| `cc-agentic restore` | Removes what setup added (its settings keys, its block, the launcher) and keeps everything else. A second restore changes nothing. |
| `cc-agentic version` | Prints the version. |

Setup keeps a backup beside each file it changes (`<file>.bak-cc-agentic-<time>`), and
only changes the keys it owns. A backup is never executable. The command follows `HOME`
and `CLAUDE_CONFIG_DIR`.

## A project's `.claude/cc.json`

```json
{
  "requires": ">=1.2",
  "worktrees": { "base": "main", "prefix": "app-wt-", "setup": ["bun", "install"] },
  "instructions": true,
  "autoMode": ["In my-app: never touch production."]
}
```

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
