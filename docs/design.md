# Design

How the `cc` plugin is built, and why. For the phases ahead see `roadmap.md`; for the
Claude Code behaviour it relies on see `claude-code-contract.md`.

## The three parts

| Part | What it is | How it reaches a machine |
|---|---|---|
| **The plugin** | Hooks, skills, agents and bundled scripts in `plugin/`. | `claude plugin install cc@cc-agentic`. Claude Code copies `plugin/` into a version folder and updates it. |
| **`cc-agentic setup`** | A command that does what a plugin cannot: changes to user files, MCP registration, long-running copies. | Run by hand, once after the install and again when a release asks for it. |
| **The launcher** | `~/.local/bin/cc-agentic`, a small `sh` script. | Written by `setup`. |

A plugin alone cannot change a user's `settings.json`, register an MCP server at user
scope, or keep a service running. A setup command alone has no versions and no update
channel. Together they get both. The cost is two places to look, so
`cc-agentic doctor` checks both.

### Why a stable launcher

Claude Code installs each version into its own folder,
`~/.claude/plugins/cache/cc-agentic/cc/<version>/`, and deletes an old folder 14 days
after an update. A terminal, a systemd unit or a cron job cannot point into a folder
whose name changes. The launcher reads Claude Code's `installed_plugins.json`, finds the
user-scope install of `cc@cc-agentic`, and runs that version's `dist/cli.js`. It stays
valid across updates.

`setup` writes into the launcher the absolute path of the `bun` that ran it. The
launcher tries that first, then `bun` on PATH, so it also works under systemd and cron.

Inside Claude Code's Bash tool, `plugin/bin/cc-agentic` is on PATH as well, and runs the
same CLI from its own version folder.

### Why long-running parts run from copies

Anything that keeps running (later: the AI gateway's router, the portal) runs from a
copy that `setup` puts in `~/.local/share/cc/`, never from the version folder. Claude
Code deletes that folder 14 days after an update, under a running process.

## How `setup` changes user files

`setup` owns **managed** parts of user files, and only those:

- in a JSON settings file, single keys (listed in its state, `owned.json`);
- in a Markdown file, one block between `<!-- cc-agentic:begin -->` and
  `<!-- cc-agentic:end -->`;
- whole files it creates itself (the launcher).

The guarantees:

- **A backup before each write**, beside the file: `<file>.bak-cc-agentic-<time>`.
- **Atomic writes:** a temp file, then a rename. A reader never sees half a file.
- **No lost edits:** just before the write, the file is compared with the text that was
  read. If someone wrote in between, the step starts again (up to 3 times).
- **A lock** against two runs at once. Its owner refreshes it every 30 seconds; it is
  stale when its owner is dead or it was not refreshed for 2 minutes.
- **Never someone else's key:** a key that exists with another value and is not owned
  is never overwritten; setup stops and says so.
- **`--dry-run`** shows every change and writes nothing.
- **`restore`** removes what cc-agentic added and keeps everything else: its own keys,
  its block, and its whole files (back to the oldest backup, or removed when setup
  created them). It backs up each file before it changes it. A second restore changes
  nothing.

Its state lives in `$CLAUDE_CONFIG_DIR/cc-agentic/` (by default `~/.claude/cc-agentic/`).

### Who changes what, and when

- **The SessionStart hook** (Phase 3 on) only refreshes managed files, under the lock.
- **A manual `cc-agentic setup` run** is the only thing that restarts a service or
  changes a permission, and it shows the change first.

So an automatic update can never restart something or widen a permission without the
user seeing it.

## Per-project opt-in: `.claude/cc.json`

The plugin is installed for the user, so it runs in every project. A project opts in,
and gives its own details, with `.claude/cc.json`:

```json
{
  "requires": ">=1.2",
  "worktrees": { "base": "main", "prefix": "app-wt-", "setup": ["bun", "install"] },
  "instructions": true,
  "autoMode": ["In my-app: never touch production."]
}
```

- A hook finds the project from its input's `cwd`, which follows the session into a
  worktree. A worktree's own `cc.json` wins; else the main checkout's is used.
- **`requires` is checked before the strict parse.** A project may use a field newer
  than a user's plugin; that user is told to update, not that the field is unknown.
- **Without `cc.json`, the plugin does Claude Code's default** and its guards stay
  silent. A project that never opted in does not notice the plugin.

### How a project adds its own part to a general skill

A general skill reads the project's own additions when they exist. For example,
`/cc:review` also follows the project's `.claude/cc/review.md`, and where they disagree,
the project's text wins. The plugin stays general; each project keeps its own rules in
its own repo.

## The safe switch

A project may already have its own copy of a piece the plugin now ships (a worktree
hook, a guard). Moving it to the plugin must never run it twice or leave a gap:

1. **A plugin release adds the piece, with a defer check.** The plugin's hook stays
   silent while the project still wires its own copy.
2. Every machine gets the plugin, and `cc-agentic doctor` is green on each.
3. **Then the project removes its copy** and raises `requires` in its `cc.json`.
4. **A small fail-closed check in the project** covers a machine without the plugin: it
   stops risky work instead of going on unguarded.

Rollback is a new release with the old behaviour. A version number never goes down.

## MCP servers at user scope

`setup` registers MCP servers (later: the shared browser, Serena) at user scope. The
plugin does not serve them. A server served from a plugin gets a new tool-name prefix,
which would break every permission rule, hook matcher and agent tool list that names
`mcp__<server>__*`. Registered by `setup`, the names stay as they are.

## Auto mode reads only user settings

Claude Code's auto mode reads its rules from the user's settings, not from a project's.
So `setup` copies each opted-in project's `autoMode` rules from its `cc.json` into a
managed block in the user's settings. The project owns the wording; the plugin only
copies it.

## Neutral by design

The plugin carries only general behaviour. Every project value — a branch, a folder
prefix, a command, a rule's wording — is a `cc.json` field or a file in the project's
own `.claude/`. The publisher appears only in the two manifests, and
`bun run check:neutral` keeps it out of every other file.

## Keeping up with Claude Code

The plugin relies on Claude Code behaviour that can change in any release.
`claude-code-contract.md` lists each behaviour, the version it was last proved on, and
how it is proved. CI tests one version, written in `.claude-code-version`. A weekly CI
job tests the newest Claude Code and opens an issue when it is newer or a check fails;
the `claude-code-upgrade` skill in `.claude/skills/` takes it from there.

## Alternatives we did not take

- **A folder linked into `~/.claude`:** no versions, no update channel, and a project
  cannot require a version. Rejected.
- **Each project carries its own copy:** every project drifts on its own, and a fix
  reaches only one of them. Rejected.
- **MCP servers served from the plugin:** it renames every tool (above). Rejected.
