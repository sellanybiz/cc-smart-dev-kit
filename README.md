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

   Setup installs the launcher `~/.local/bin/anymodel` and turns on auto-update for
   the plugin. Add `--dry-run` to see the changes first; it writes nothing at all.

4. Restart Claude Code.

After that, use `anymodel setup` to set up again (for example after an update).

## Commands

| Command | What it does |
|---|---|
| `anymodel setup` | Installs the launcher and turns on plugin auto-update. `--dry-run` shows the changes and writes nothing at all. A settings key you set yourself (for example `autoUpdate: false`) stops setup before it writes anything. |
| `anymodel doctor [--live]` | Checks the install, and the project of the folder you run it in (the list is below). Prints ✓ or ✗ for each check, and exits with 1 when one fails. `--live` also proves the hooks on the Claude Code installed here (below); it never runs without the flag. |
| `anymodel hook <worktree-create\|worktree-remove\|subagent-stop>` | The worktree engine, for a project that wires it in its own `.claude/settings.json` (§ Worktrees). It reads the hook's input on stdin and answers as Claude Code expects. With no name, it prints the lines to paste. |
| `anymodel session-name <session id> <name>` | Names a Claude session after its task. A session runs it itself when the project turns on `sessionNames` (below). |
| `anymodel restore [--yes] [--now]` | Removes what setup added (its settings keys, its block) and keeps everything else. The launcher goes back to how it was before setup first changed it, or is removed when setup created it. With the gateway installed and on, it runs in **two stages**, because running Claude sessions still send every request to the router: the first restore removes everything but the router (the gateway's env keys too) and says to restart every running session; the second disables and stops the router (it asks, because that cuts answers in flight; `--yes` skips the question), waits up to 15 s for its port to close (not for its answers in flight, which finish in the background; and not at all when the unit was not running or another program answers on the port: it says so), and removes its copy and unit. `--now` does both at once, after a warning that every running session fails until it restarts (asked, or `--yes`). It keeps `gateway.json`, which holds your key. A restore with nothing left changes nothing. |
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
  "gateway.json kept; the gateway is not installed";
- the project of the folder you run it in (nothing outside a git project; a `·` line
  when git is not on PATH):
  - with `worktrees` in its `anymodel.json`: that its `.claude/settings.json` (or
    `settings.local.json`) wires the three worktree hooks (§ Worktrees). ✗ names the
    missing ones and how to wire them;
  - ✗ when it wires them but has no `worktrees`: each worktree would fail;
  - ✗ for each other WorktreeCreate hook next to the engine's, in the project's settings
    or yours: Claude Code runs both and makes two worktrees;
  - as information (`·`), each plugin hook a project hook silences (§ The hooks): "the
    plugin's git-guard is off here for PreToolUse (Bash): `<the project's command>` runs
    on the same event";
- the last live check, as information (`·`), when `doctor --live` passed on this machine
  before: the Claude Code version it passed on, and "run it again" when the installed
  Claude Code is another version.

`doctor --live` makes two throwaway repos in a temp folder and runs one short `claude -p`
session in each, with this plugin, only the EnterWorktree, ExitWorktree and Bash tools,
permission for exactly the calls it makes (`--allowedTools`), and a three-step prompt:
enter a worktree, run `git status` there, leave with "remove". It uses your Claude login
and costs a few cents. In the repo without `anymodel.json` it checks that the plugin's
hooks fired (SessionStart, and the git guard before the Bash call), that no WorktreeCreate
hook ran and Claude Code made its own worktree, and that it removed it. In the repo that
turned the worktree engine on (`worktrees`, and the lines from § Worktrees, which run your
launcher), it checks that the engine's WorktreeCreate made the right folder and branch, the
session worked there, and its WorktreeRemove removed both. When everything passes it
records the Claude Code version in `~/.claude/anymodel/live-check.json`. The temp folder
is removed.

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

## The hooks

The plugin's hooks run in every project, and **a project without `.claude/anymodel.json`
does not notice them**: each one stays silent there. The plugin ships no worktree hook:
Claude Code makes its own worktrees, unless a project turns on the worktree engine
(§ Worktrees). Each hook runs through `bin/anymodel-bun`, which finds bun even when your
PATH has none: the bun `anymodel setup` saved in the launcher first, then
`$BUN_INSTALL/bin/bun`, `~/.bun/bin/bun`, and bun on PATH. With no bun at all, each hook
says so in one line.

| Hook | When | What it does |
|---|---|---|
| `git-guard` | before a Bash or PowerShell command | Asks you before a force-push, a push to a protected branch (`protectedBranches`), `push --all` / `--mirror`, `reset --hard`, `clean -f`, a checkout or restore that throws changes away, `branch -D`, and (with `worktrees`) a bare `git stash` or `stash pop`: every worktree shares one stash. Text in quotes, here-docs and comments is not a command. |
| `main-folder-guard` | before Edit, Write, NotebookEdit | With `worktrees.guardMainFolder`: refuses an edit of a file in the main checkout itself, and says how to get into a worktree. |
| `message-guard` | before SendMessage | Refuses a message to a session that works outside this repo (ListAgents lists every session on the machine). |
| `after-merge` | after `gh pr merge` | With `worktrees`: the steps to clear the worktree that was merged, and, for a merge into `worktrees.base`, the message to send the other sessions of the repo. |
| `worktree-leftovers` | a session starts | With `worktrees`: names the worktrees that are finished (every commit on `origin/<base>`, nothing uncommitted, no running session, idle for an hour) or whose folder is gone. It removes nothing. |
| `session-name` | a session starts; each prompt | With `sessionNames`: asks the session to name itself after its task, then sets that name at the next prompt. |

**A project that still wires its own hook for the same event and tool** (in
`.claude/settings.json` or `.claude/settings.local.json`) keeps it: the plugin's hook stays
silent, so nothing runs twice. Any project hook on that event and tool counts, whatever it
does; `anymodel doctor`, run in the project, lists each plugin hook that is silent there and
why. When the project's `anymodel.json` needs a newer plugin, or is broken, the hooks fail
closed: the guards ask before every call they cover, and the message names the update
command.

## Worktrees

A WorktreeCreate hook **replaces** Claude Code's own worktree creation, for sessions and
subagents, in every project where it is wired; a hook cannot step aside (proved live:
[docs/claude-code-contract.md](docs/claude-code-contract.md)). Claude Code's own creation
locks a worktree while a session uses it, marks it for its own cleanup, supports
`claude -w "#123"` (a pull request), and handles Git LFS; a hook does none of that. So the
plugin wires no worktree hook. **A project that wants anymodel's worktrees turns the engine
on itself**, in two steps:

1. Give its `.claude/anymodel.json` a `worktrees` field (§ A project's
   `.claude/anymodel.json`).
2. Paste these hooks into its `.claude/settings.json`, and commit it (merge them with any
   `hooks` it has). `anymodel hook` prints the same lines.

```json
{
  "hooks": {
    "WorktreeCreate": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "\"$HOME/.local/bin/anymodel\" hook worktree-create",
            "timeout": 600
          }
        ]
      }
    ],
    "WorktreeRemove": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "\"$HOME/.local/bin/anymodel\" hook worktree-remove",
            "timeout": 60
          }
        ]
      }
    ],
    "SubagentStop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "\"$HOME/.local/bin/anymodel\" hook subagent-stop",
            "timeout": 60
          }
        ]
      }
    ]
  }
}
```

Each line runs the launcher by its full path under `$HOME`, so it works for every
teammate who ran `anymodel setup`, whatever the PATH Claude Code was started with (an IDE
or a desktop launcher may leave out `~/.local/bin`); the launcher runs the bun setup saved
in it. A teammate who never ran setup gets a failed worktree, and Claude Code shows why
(`anymodel` not found, or the plugin not installed). Then, in that project:

| Hook | When | What it does |
|---|---|---|
| `worktree-create` | a worktree is made (`claude -w <name>`, EnterWorktree, a subagent) | A session's worktree: a folder beside the repo, `<prefix><name>` (a `/` becomes `-`), on the branch `<name>`, from the freshly fetched `origin/<base>` (or the existing branch), then your `setup` command inside. A worktree of that branch that exists is entered again, unless another running session works in it. A subagent's worktree: Claude Code's own shape, `.claude/worktrees/agent-<id>` on `worktree-agent-<id>`, from the remote's default branch (or `HEAD` with Claude Code's `worktree.baseRef: "head"`), with no setup. Both get the files `.worktreeinclude` names. |
| `worktree-remove` | Claude Code removes a worktree a hook made | Removes it only when nothing in it is uncommitted or untracked; then its branch, when every commit on it is also on another branch. Otherwise it keeps it and says why. Claude Code cannot check a worktree outside the repo, so `ExitWorktree` asks for `discard_changes: true` there; this hook still never discards work. |
| `subagent-stop` | a subagent ends | Removes its worktree and branch when it changed nothing (Claude Code keeps every worktree a hook made for a subagent). |

Wired without `worktrees` in `anymodel.json`, or with an `anymodel.json` that needs a newer
plugin or is broken, each of the three fails closed: no worktree is made or removed, and
the message says why. `anymodel doctor`, run in the project, checks the wiring.

**Moving from a project's own worktree hook:** replace its WorktreeCreate, WorktreeRemove
and SubagentStop lines with these, in one commit. Two WorktreeCreate hooks make two
worktrees for each request; `anymodel doctor` reports a second one.

## A project's `.claude/anymodel.json`

```json
{
  "requires": ">=0.1",
  "worktrees": {
    "base": "main",
    "prefix": "app-wt-",
    "setup": ["bun", "install"],
    "guardMainFolder": true
  },
  "protectedBranches": ["main"],
  "sessionNames": true,
  "instructions": true,
  "autoMode": ["In my-app: never touch production."]
}
```

| Field | What it does |
|---|---|
| `requires` | The plugin versions this project needs, as a version range (npm syntax). |
| `worktrees` | Turns on the hooks that work with worktrees (the after-merge and leftovers notes, the stash question), and is what the worktree engine needs once the project wires it (§ Worktrees). |
| `worktrees.base` | The branch a new worktree starts from (`origin/<base>`, fetched first). |
| `worktrees.prefix` | The folder-name prefix of a worktree beside the repo (no `/`). |
| `worktrees.setup` | A command run inside a new worktree, as a list of words (`["bun", "install"]`). Its output goes to the hook's log, not to Claude. When it fails, the worktree stays and the next request for it runs the setup again. |
| `worktrees.guardMainFolder` | `true`: refuse edits in the main checkout itself. Off when left out. |
| `protectedBranches` | The branches the git guard asks about before a push. Default `["main"]`. |
| `sessionNames` | `true`: each session names itself after its task. Off when left out. |
| `instructions` | Accepted now, used from Phase 5. |
| `autoMode` | Accepted now, used from Phase 6. |

`requires` is a version range (npm syntax). When the installed plugin is outside it, the
plugin says so and asks you to run `claude plugin update anymodel@anymodel`. A project that
uses a field raises its `requires` to the release that brought the field.

## Develop

See `.claude/CLAUDE.md`. In short: `bun install`, change `src/`, `bun run build`,
`bun run check`, and commit `plugin/dist` with the change.

## Docs

- [Design](docs/design.md): how the parts fit, and why.
- [Roadmap](docs/roadmap.md): the phases, done and ahead.
- [Claude Code contract](docs/claude-code-contract.md): the Claude Code behaviour the
  plugin relies on, and the version it was last proved on.
