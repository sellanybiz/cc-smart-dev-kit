# cc-smart-dev-kit

`cc-smart-dev-kit` lets a person use any model with Claude Code. It is a plugin anyone can
install: a local AI gateway, hooks, skills, agents, and the `cc-smart-dev-kit` command, which sets
up and checks a machine. Nothing in it is tied to one project. A project opts in, and sets its own details, in its own
`.claude/cc-smart-dev-kit.json`.

This repo is also the plugin's marketplace (a list of plugins Claude Code can install
from), named `cc-smart-dev-kit`.

## Install

You need macOS, Linux or Windows (native Windows; the parts that are `sh` scripts run
through Git Bash there — [Windows](#windows)),
[Claude Code](https://code.claude.com), [Bun](https://bun.sh) 1.4.3 or later (an older
Bun would send a backend's key through a proxy and would ignore the flags that keep a
project's `.env` files and `bunfig.toml` out of the plugin; `bun --version` shows yours),
and read access to this repo with git (an SSH key, or a git credential helper when the repo
is private). On an older Bun only `doctor`, `restore`, `version` and `--help` run, and the
hooks do not run at all: the hook shim stops before starting one.

1. Add the marketplace. `<owner>/cc-smart-dev-kit` is where this repo lives: the `repository`
   field of `plugin/.claude-plugin/plugin.json`. Add the marketplaces of the two
   companion plugins too (see [Companion plugins](#companion-plugins)):

   ```sh
   claude plugin marketplace add <owner>/cc-smart-dev-kit
   claude plugin marketplace add thedotmack/claude-mem
   claude plugin marketplace add anthropics/claude-plugins-official
   ```

2. Install the plugin for your user. Claude Code installs the companions with it:

   ```sh
   claude plugin install cc-smart-dev-kit@cc-smart-dev-kit
   ```

   Skipped the two companion marketplaces? The install still succeeds, with a warning
   that cc-smart-dev-kit will not load without them. The setup in step 3 adds them, and that
   installs the companions.

3. Run the first setup. The `cc-smart-dev-kit` command does not exist yet, so run it from the
   plugin folder. Put the installed version in place of `<version>`: the install prints no
   version, so read it with `ls ~/.claude/plugins/cache/cc-smart-dev-kit/cc-smart-dev-kit/`:

   ```sh
   plugin="$HOME/.claude/plugins/cache/cc-smart-dev-kit/cc-smart-dev-kit/<version>"
   bun --no-env-file --config="$plugin/bunfig.toml" "$plugin/dist/cli.js" setup
   ```

   Both flags matter: Bun adds the `.env` files of the folder you run the command from and
   reads its `bunfig.toml`, so without them a project's `.env.local` (its `TAVILY_API_KEY`,
   say) or a project's `preload` would reach setup. The launcher,
   `plugin/bin/cc-smart-dev-kit` and the hooks' bun shim all pass both for the same reason.
   The bundle path is the installed version's own folder (`…/<version>/dist/cli.js`) and the
   empty config sits beside it (`…/<version>/bunfig.toml`), so a later version ships its own.

   Setup installs the launcher `~/.local/bin/cc-smart-dev-kit`, turns on auto-update for the
   plugin, registers the MCP servers for your user ([MCP servers](#mcp-servers)), installs
   the plugin's general instructions for Claude (§ Instructions, skills
   and agents), adds any companion marketplace that is missing, and prints the [browser](#the-browser)'s
   own steps while they are still open (the browser needs the Playwright extension in a Chrome
   profile of its own, and its token — `browser setup` does the machine's half of that). Add
   `--dry-run` to see the changes first; it writes and runs nothing at all. Add
   `--no-instructions` to leave the instructions out (setup remembers that choice).

4. Restart Claude Code. Finish the browser's steps if setup printed them
   ([The browser](#the-browser)); without the token, the browser tools do not work.

After that, use `cc-smart-dev-kit setup` to set up again (for example after an update).

## What's new in 0.4.0

- **`cc-smart-dev-kit project init`** sets a project up: its `.claude/cc-smart-dev-kit.json`
  and, unless the project runs an engine of its own, the worktree engine's three hook lines
  ([`project init`](#project-init)).
- **The workflow, and `cc-smart-dev-kit workflow`**: what cc-smart-dev-kit may do by itself
  here — commit, push, open a pull request, merge. The project's committed file wins over
  your own defaults, and `show` prints each value with where it came from
  ([The workflow](#the-workflow)).
- **A base per branch prefix** (`worktrees.bases`): a `hotfix/…` or `release/…` worktree
  starts from the base that prefix names, not from the integration base
  ([Worktrees](#worktrees)).
- **`worktrees.engine: "own"`**: a project that runs its own worktree engine says so, and
  `doctor` expects no cc-smart-dev-kit hook lines there ([A project's
  `.claude/cc-smart-dev-kit.json`](#a-projects-claudecc-smart-dev-kitjson)).
- **Windows**: native Windows, with Git Bash for the parts that are `sh` scripts — the
  hooks, setup, the launcher, the gateway as a Scheduled Task, the job queue, the toasts
  ([Windows](#windows)).
- **`cc-smart-dev-kit usage`** also shows auto mode's safety checks, which the gateway's
  router counted, by day, with the tokens each answer reported
  ([The usage limit: the alert, the status line, and `usage`](#the-usage-limit-the-alert-the-status-line-and-usage)).
- **The browser drives your own Chrome**, through the Playwright extension, in a profile of its
  own named `claude-code`: `cc-smart-dev-kit browser setup` makes it and prints the steps,
  `browser token` saves the token its status page shows — and `browser mcp` refuses to start
  without that token, so nothing ever waits for an approval click ([The
  browser](#the-browser)). The plugin's own shared Chrome, its profile and the tab filter are
  gone;
- **The instructions work in parallel**: the plugin's general instructions tell Claude to
  start every independent phase at once, and never to wait for a merge, a release, a review
  or an answer it does not need ([Instructions, skills and agents](#instructions-skills-and-agents)).

**After you update, run `cc-smart-dev-kit gateway setup` on every machine with the gateway.**
The router changed in this release (it counts auto mode's safety checks, which `usage` reads),
and that command puts the new copy in place. It asks before it restarts the router, because a
restart cuts the answers in flight.

## Windows

The plugin runs on **native Windows** (not WSL). What it does there, and where Windows
differs:

| Part | On Windows |
|---|---|
| The `sh` parts | Need **Git Bash** (Git for Windows): Claude Code runs a shell-form hook and the Bash tool through it, and the plugin's own hooks are `sh` scripts. `doctor` finds it, or says `✗ Git Bash was not found`. |
| The launcher | `~/.local/bin/cc-smart-dev-kit` for Git Bash, and `cc-smart-dev-kit.cmd` beside it for `cmd` and PowerShell. `setup` writes both. |
| Every path | The same layout as Linux and macOS, under `%USERPROFILE%` (`%USERPROFILE%\.claude`, `…\.local\share\cc-smart-dev-kit`, `…\.config\cc-smart-dev-kit`). |
| The gateway | A per-user **Scheduled Task** instead of the systemd units. A restart refuses requests for a moment (Claude Code retries them), and a stop cuts the answers in flight. |
| The heavy-job queue | Runs each job as a plain child, with no memory ceiling, and reads the free memory Windows reports. |
| Notifications | A desktop toast through PowerShell (Windows plays the toast's own sound); the terminal route is Claude Code's own. |
| `sessions --open` | Warp tabs where Warp is there, else a Windows Terminal window each. |

Five pages say how, and what still has to be tested there:

- [docs/windows-setup.md](docs/windows-setup.md): the folders, the `.cmd` launcher, file modes
  vs the profile's ACL, Git Bash, and the owed checks: the `.cmd` from `cmd` and PowerShell,
  Git Bash end to end, Chrome, worktrees, `sessions --open`, file modes, paths and Ctrl+C.
- [docs/windows-hooks.md](docs/windows-hooks.md): the hooks' shell form, the `.sh` first token,
  and the owed run: a guard blocking in a real session with bun absent, and Git Bash missing on
  purpose.
- [docs/windows-notify.md](docs/windows-notify.md): the toast, the sound Windows plays with
  it and the self-update trampoline, and the owed run: a toast from a hook, the reminder
  toast, and `powershell` on a hook's PATH.
- [docs/windows-jobs.md](docs/windows-jobs.md): the memory reading, the `win:` leases and the
  `taskkill` end, and the owed run: two sessions on one queue, `job status`, a killed holder,
  Ctrl+C and a worker left behind.
- [docs/windows-gateway.md](docs/windows-gateway.md): the Scheduled Task, what Windows loses
  (no socket activation, no journal), and the owed run: `gateway setup` without elevation, the
  task's states in `doctor`, a restart, and `restore`.

## Commands

| Command | What it does |
|---|---|
| `cc-smart-dev-kit setup` | Installs the launcher, turns on plugin auto-update, and installs the [instructions](#instructions-skills-and-agents): a copy in `~/.claude/cc-smart-dev-kit/instructions/`, imported by a cc-smart-dev-kit block in `~/.claude/CLAUDE.md` (your own text there is kept); each run refreshes the copy, so run it after a plugin update. Adds a missing [companion](#companion-plugins) marketplace (or plugin). Adds the [tmux line](#notifications) to `~/.tmux.conf` when tmux is installed (kept next to your own lines, removed again by `restore`), and prints the command that applies it to a running tmux server. Points [claude-mem at the gateway's affordable model](#claude-mem-on-the-gateway) when both are set up. Copies the project's [auto-mode entries](#the-auto-mode-block) into your settings, after it shows them and asks. It never touches [Warp](#warp) or its plugin without `--warp`. Every question comes before anything runs or is written. `--dry-run` shows the changes, and writes, runs and checks nothing at all (it reaches no network). A settings key you set yourself (for example `autoUpdate: false`, also after setup had set it) stops setup before it writes or runs anything. Without `claude` on your PATH, setup skips only the `claude plugin …` steps, names them, does the rest, and exits with 1. Run in a terminal with no status line set, setup also offers [cc-smart-dev-kit's status line](#the-usage-limit-the-alert-the-status-line-and-usage) (once: it remembers a "no"). |
| `cc-smart-dev-kit setup --no-instructions` | Takes the instructions' block and copy out and **keeps them out**: setup stores the choice (`~/.claude/cc-smart-dev-kit/no-instructions`), so a later plain `cc-smart-dev-kit setup` leaves them out too. `--instructions` clears that choice and installs them again. `restore` clears it as well. |
| `cc-smart-dev-kit setup --yes` | On a terminal: the same, and writes the auto-mode entries without asking (they are still shown). With no terminal, they are left out, also with `--yes`. |
| `cc-smart-dev-kit setup --project <dir>` | Reads the auto-mode entries from the project in `<dir>`, not from the folder you are in. |
| `cc-smart-dev-kit setup --warp` | Also installs the Warp terminal, then its Claude plugin. The commands are shown first and asked; `sudo` asks for your password. |
| `cc-smart-dev-kit setup --remove-warp` | Removes the Warp terminal, its package source and key, your Warp shortcuts and its Claude plugin. Shown and asked first. |
| `cc-smart-dev-kit setup --statusline` | Also sets Claude Code's status line to `cc-smart-dev-kit statusline`, as a key cc-smart-dev-kit owns, without asking (also after an earlier "no"). It never replaces a status line you set: one you set yourself, also after setup had set it, stops setup before it writes anything, and `restore` leaves it. |
| `cc-smart-dev-kit statusline` | The status line itself: plan usage, a warning from 85 %, and any gateway fallback in use. Reads the JSON Claude Code passes on stdin. |
| `cc-smart-dev-kit usage [--hours <n>] [--project <folder or name>]` | Which models answered on this machine, per session, from Claude Code's transcripts: the main session's replies by model, and apart, its subagents (how each was launched, the model of each reply, the share on Opus). Default: the last 6 hours. It also shows auto mode's safety checks, which the gateway's router counted, by day, with the tokens each answer reported (below). Read only; no message text. |
| `cc-smart-dev-kit doctor [--live]` | Checks the install, the cc-smart-dev-kit files the current project's `CLAUDE.md` imports, and the project of the folder you run it in (the list is below). Prints ✓ or ✗ for each check, `·` for information and `!` for a warning (neither is a failure), and exits with 1 when a check fails. `--live` also proves the hooks and the worktree engine on the Claude Code installed here (below); it never runs without the flag. |
| `cc-smart-dev-kit hook <worktree-create\|worktree-remove\|subagent-stop>` | The worktree engine, for a project that wires it in its own `.claude/settings.json` (§ Worktrees). It reads the hook's input on stdin and answers as Claude Code expects. With no name, it prints the lines to paste. |
| `cc-smart-dev-kit project init [--dry-run] [--yes] [flags]` | Sets a project up ([`project init`](#project-init)): it writes the project's `.claude/cc-smart-dev-kit.json` (the worktrees, the protected branches, the guards, and optionally the [workflow](#the-workflow) policy) and, unless the project runs an engine of its own, the worktree engine's three lines in `.claude/settings.json`. It asks first, showing each default, which comes from the repo (the base from `origin/HEAD`, the setup command from the lockfile, the protected branches from git and, when `gh` is installed and answers, GitHub); every question has a flag, so a run with no terminal writes nothing unless `--yes` is given. It never commits. `cc-smart-dev-kit project init --help` lists the flags. |
| `cc-smart-dev-kit workflow [show] \| set <setting> <value> [--project] \| unset <setting> [--project] \| review-done [--sha <commit>]` | What cc-smart-dev-kit may do by itself here — commit, push, open a pull request, merge — and the switches that map onto settings which already exist ([The workflow](#the-workflow)). `show` (the default) prints each value and where it came from: the project's file, your own defaults, or the built-in default, and whether the commit here has a recorded review. `set` and `unset` write one value; `--project` writes the project's committed file. `review-done` records that a commit had its one premium review. |
| `cc-smart-dev-kit session-name <session id> <name>` | Names a Claude session after its task. A session runs it itself when the project turns on `sessionNames` (below). |
| `cc-smart-dev-kit restore [--yes] [--now]` | Removes what setup added (its settings keys, the auto-mode entries it copied, claude-mem's keys, its block in `CLAUDE.md`, the instructions' copy, the [tmux line](#notifications) it added, and a stored `--no-instructions` choice) and keeps everything else. A key setup set and you changed since is yours: it stays. The plugins and marketplaces setup added stay installed: remove them with `claude plugin uninstall` and `claude plugin marketplace remove`. The launcher goes back to how it was before setup first changed it, or is removed when setup created it. With the gateway installed and on, it runs in **two stages**, because running Claude sessions still send every request to the router: the first restore removes everything but the router (the gateway's env keys too, and the launcher when setup created it — so `cc-smart-dev-kit` may be off your PATH then, and the line it prints is the `bun --no-env-file --config=… …/dist/cli.js restore` form of [Install](#install) step 3, with the bun running the restore, its own absolute path, and your installed version) and says to restart every running session; the second disables and stops the router and its socket (it asks, because that cuts answers in flight; `--yes` skips the question), waits up to 15 s for its port to close (not for its answers in flight, which finish in the background; and not at all when the unit was not running or another program answers on the port: it says so), and removes its copy, its units and its limit state (`~/.local/state/cc-smart-dev-kit/gateway-state.json`). `--now` does both at once, after a warning that every running session fails until it restarts (asked, or `--yes`). It keeps `gateway.json`, which holds your key. Some of cc-smart-dev-kit's own state stays too, and restore never removes the state folder `~/.claude/cc-smart-dev-kit/` itself, or a folder outside it. Still there afterwards: the backups a later restore or a hand-undo reads, the records (now empty), the running sessions' and the background update's bookkeeping, and the live-check record. The heavy-job queue's folder `~/.local/share/cc-smart-dev-kit/jobs/` stays as it is, with its `leases/` and `tickets/` folders (empty once no job runs). A restore with nothing left changes nothing. |
| `cc-smart-dev-kit update [--check \| --hold \| --resume]` | Installs a newer cc-smart-dev-kit now, showing each step: `claude plugin marketplace update cc-smart-dev-kit`, then `claude plugin update cc-smart-dev-kit@cc-smart-dev-kit --scope user` when there is a newer version. `--check` only says whether a newer version exists (it reads the remote's version without changing anything). `--hold` stops the background update on this machine; `--resume` starts it again. Both answer at once (no lock); while a check runs, they say "A check is running now; it finishes." Nothing restarts: restart Claude sessions to load the new version. |
| `cc-smart-dev-kit gateway <command>` | The optional AI gateway (below). |
| `cc-smart-dev-kit browser mcp` | Starts the Playwright MCP server on **your own Google Chrome**, through the Playwright extension, in the profile `claude-code` ([The browser](#the-browser)). `setup` registers it as the `playwright` MCP server; you do not run it by hand. **It refuses to start without the token**: without one the extension would ask you to approve every connection. |
| `cc-smart-dev-kit browser setup [--dry-run]` | Finds Chrome, opens the Playwright extension's Web Store page in the `claude-code` profile (Chrome makes that profile on that launch, if it is not there yet), pre-registers the extension for your user on macOS and Windows, and prints the steps that are left for you. It never installs or removes an extension, and never deletes a profile. `--dry-run` prints the same lines and runs and writes nothing. |
| `cc-smart-dev-kit browser token [--clear]` | Saves the token the extension's status page shows — paste the whole line (its Copy button copies `PLAYWRIGHT_MCP_EXTENSION_TOKEN=…`), and it is not echoed while you type. It is written to `~/.config/cc-smart-dev-kit/playwright-extension.token`, mode 600, and is never printed again. `--clear` removes it. |
| `cc-smart-dev-kit browser check` | Proves the browser end to end on your own Chrome: a real connection with **no approval page**, a `file://` page (which needs "Allow access to file URLs"), screenshots (one the server names, one a caller names), an upload, a download, and `browser_close`. Exit 0 when every check passed. It opens that Chrome window once, and the tabs of its connection stay behind. |
| `cc-smart-dev-kit sessions [--open] [--dry-run]` | This project's Claude Code sessions of the last two days, by name and worktree, with the command that resumes each ([Sessions](#sessions)). With Warp installed it also saves a Warp tab for each. `--open` reopens every session that was open when the machine went down or its window closed (Warp tabs, or a terminal window each: XFCE Terminal on Linux, Windows Terminal on Windows); `--dry-run` says what it would open and opens nothing. |
| `cc-smart-dev-kit worktrees [--clean] [--remove <path>] [--no-fetch]` | Every worktree of this repo: who works in it, and which are finished ([Worktrees](#worktrees)). `--clean` removes the finished ones with their branches; `--remove <path>` removes one now, for the session that has just finished in it, so without the one-hour wait; `--no-fetch` judges against `origin/<base>` as it is. `--clean` and `--remove` run in the main checkout only, one at a time. |
| `cc-smart-dev-kit omniroute <status\|update\|rollback>` | The OmniRoute behind the gateway's affordable slots (below): what is installed, the newest npm release at least three days old, the user unit that runs it, and the backend that talks to it. `update` installs the newest such release, restarts its unit, checks the model path, and puts the old version back when the new one does not answer. `rollback` installs the version the last update replaced. `update` and `rollback` refuse to run inside a Claude Code session, and are never in the background. |
| `cc-smart-dev-kit portal [--port <port>] [--no-open]` | The local portal (below): a page on this machine to see and change the gateway's settings, the updates, the heavy-job queue, the companions and the OmniRoute. It binds `127.0.0.1` only, prints a link with a one-time token, and stops after 30 minutes with no request. It refuses to run inside a Claude Code session: the portal is for you, not for Claude. |
| `cc-smart-dev-kit search "<query>" [--max <n>] [--json]`<br>`cc-smart-dev-kit search --fetch <url> [--json]` | Searches the web through the gateway's OmniRoute backend (Ollama's web search among its providers), or reads one page's text with `--fetch`. Prints each result's title, its URL and a short snippet. `--max` asks for 1 to 50 results. The query, or the URL, goes to that search or fetch provider on the internet; `--fetch` refuses a local or private address. Needs the gateway set up (below). |
| `cc-smart-dev-kit job <command>` | The machine-wide queue for heavy jobs (below). |
| `cc-smart-dev-kit migrate [--dry-run] [--yes]` | Moves a machine that still has the plugin's old `anymodel` names ([Moving from anymodel](#moving-from-anymodel)). It reads and checks everything, asks every question, and writes nothing before they are answered: a "no" leaves the machine as it was. Then it prints its steps and walks them; a step that fails keeps what the steps before it did, and the next run goes on from there. `--dry-run` prints that plan and writes, runs and stops nothing. `--yes` answers the router question without asking; the old plugin is uninstalled only after a yes on a terminal, and only when it is still installed. Refuses to run inside a Claude Code session: it replaces the router that session's own model traffic goes through. On a 0.2.x machine the command does not exist yet: run the plugin's `dist/cli.js` with bun (the section above has the line). |
| `cc-smart-dev-kit version` | Prints the version. |

### The background update

Claude Code's own plugin auto-update can fail to run (anthropics/claude-code#61854), so
cc-smart-dev-kit updates itself. When a Claude session starts, its hook checks, **at most once an
hour**, in the background, and never makes the session wait or prints anything:

1. It compares the marketplace's remote head (`git ls-remote`, with no password prompt
   in a terminal: `GIT_TERMINAL_PROMPT=0` and ssh `BatchMode`; a git credential helper
   that opens a window of its own may still show it) with Claude Code's local copy, and
   the installed version with the copy's.
2. When either is behind, it runs the same two commands as `cc-smart-dev-kit update`, in your
   home folder and without git variables like `GIT_DIR` that a session may carry, logs
   each step to `~/.claude/cc-smart-dev-kit/update.log`, and shows one desktop notification when
   a new version was installed (`notify-send` on Linux, `osascript` on macOS, a PowerShell
   toast on Windows): "cc-smart-dev-kit
   X installed; restart Claude sessions to load it". When the new version's router
   differs from the one running, the notification adds the `cc-smart-dev-kit gateway setup` hint.

It never restarts the router, a service or a session. A new router still needs
`cc-smart-dev-kit gateway setup`, which asks first. When a background update fails, the next
interactive session start says so once (a `claude -p` run does not count). A marketplace
that cannot be read counts as a failure only after 24 hours in a row (a laptop offline
for a day is not a failure); Claude Code refreshing the same marketplace at that moment
is "skipped", and the next check tries again. The trade-off, accepted on purpose: a bad
release reaches every machine within the hour. `cc-smart-dev-kit update --hold` keeps one
machine where it is.

It honours Claude Code's own switches for updates: while `DISABLE_AUTOUPDATER`,
`DISABLE_UPDATES` or `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC` is set (in the
environment or the `env` of `settings.json`) and `FORCE_AUTOUPDATE_PLUGINS` is not, it
checks nothing and only records "skipped: <name> is set".

The hook runs bun through `plugin/bin/cc-smart-dev-kit-bun.sh`, which finds bun where the launcher
does (the bun `cc-smart-dev-kit setup` baked in, `$BUN_INSTALL/bin`, `~/.bun/bin`, then PATH), so
it works when Claude Code was started with a PATH that has no bun. It starts bun with
`--no-env-file` and the plugin's own empty config, so a hook sees the environment Claude Code
gave it and never the working folder's `.env` files or its `bunfig.toml`. A Bun older than
1.4.3 cannot start a hook at all: the shim stops first, and a guard asks instead (see
[Install](#install)).

`doctor` checks that:

- the Bun running it is 1.4.3 or later. On an older one it skips the gateway checks:
  they send the backend key;
- the plugin is installed;
- the installed version is not behind the marketplace's local copy. When it is, ✗ says
  "installed X, marketplace has Y. Run: claude plugin update cc-smart-dev-kit@cc-smart-dev-kit". When the
  local copy or its version cannot be read, it says "Run: claude plugin marketplace
  update cc-smart-dev-kit";
- the launcher matches the script setup would write for the `bun` baked into it, and
  that `bun` is executable;
- on Windows, the second launcher and Git Bash: `~/.local/bin/cc-smart-dev-kit.cmd` is there,
  is this version's and runs (through `cmd.exe`), Git Bash is found (the `✗` says to install
  Git for Windows or to set `CLAUDE_CODE_GIT_BASH_PATH`; a `!` for a variable Claude Code
  ignores), and `tmux: not on Windows` is a `·` line (§ Windows);
- the instructions: the copy in `~/.claude/cc-smart-dev-kit/instructions/` is this plugin
  version's (its version stamp, and each file against the plugin's), and `~/.claude/CLAUDE.md`
  still holds the block that imports it. A ✗ says "Run: cc-smart-dev-kit setup". After
  `--no-instructions`, a `·` line says they are left out, as information;
- the current project: when a `CLAUDE.md`, `.claude/CLAUDE.md` or `CLAUDE.local.md` in the
  current folder or a folder above it imports a cc-smart-dev-kit file
  (`@~/.claude/cc-smart-dev-kit/instructions/…`), that file exists. A missing one loads nothing and
  Claude Code says nothing about it, so doctor fails with "Run: cc-smart-dev-kit setup" (or, after
  `--no-instructions`, a `·` line with `cc-smart-dev-kit setup --instructions`). No import, no line;
- git can read the marketplace (`git ls-remote`, with no password prompt in a terminal:
  `GIT_TERMINAL_PROMPT=0`; a git credential helper with a window of its own may still
  show one). It adds ssh `BatchMode` only when you have no ssh command of your own
  (`GIT_SSH_COMMAND`, `GIT_SSH` or `core.sshCommand`). It prints URLs without
  credentials;
- auto-update is on for the plugin;
- the background update: the last check and its result (a failed check is a ✗ that
  names the log; a check still to come, a skipped one and a marketplace unreadable for
  less than 24 hours are information), whether it is on hold, and, as information,
  running Claude sessions that loaded an older version than the one installed now;
- updates are not switched off. It fails when `DISABLE_AUTOUPDATER`, `DISABLE_UPDATES`
  or `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC` is set, in your environment or in the
  `env` of `settings.json`, without `FORCE_AUTOUPDATE_PLUGINS`, and says the background
  update skips them too. A value that is empty, `0`, `false`, `no` or `off` counts as not
  set;
- each companion plugin (`claude-mem@thedotmack`, `frontend-design@claude-plugins-official`)
  is installed and on, and inside the version range this plugin's manifest pins for it.
  Only claude-mem has a range. cc-smart-dev-kit does not load without them. ✗ says what to
  run: `cc-smart-dev-kit setup` (its marketplace or the plugin is missing), `claude plugin
  enable <id>` (you turned it off), or `claude plugin update <id>` (too old). A recorded
  version that is a commit id, not a version number, is a ✗ for a pinned companion alone,
  and only because it cannot be checked against its range; frontend-design, unpinned,
  shows ✓ with a commit id;
- claude-mem is 13.35.0 or newer. Older is a warning (`!`), not a failure: before
  13.35.0, a fresh install's vector search may not start (pydantic 2.14 broke
  chroma-mcp; 13.35.0 pins pydantic below it);
- Warp: the app and its version, and its Claude plugin. Not installed, or installed
  without its plugin (or with it turned off), is information (`·`): Warp is optional.
  ✗ only for the plugin without the app;
- the browser: Google Chrome is installed, the `claude-code` Chrome profile is there, the
  Playwright extension is installed in it and it is the ONLY extension there (a second one
  breaks a browser session: microsoft/playwright#43230, open — a `!` line names it), the profile
  lets the extension open `file://` pages, and the extension's token is saved. A ✗ names the
  command or the click that fixes it; without the token nothing runs at all
  ([The browser](#the-browser)). Whether the `playwright` server is registered and starts is the
  MCP servers' own line, just below;
- the MCP servers setup registers (the `playwright` browser, `serena`,
  `sequential-thinking`, `tavily-websearch`): each is registered at user scope and starts
  (`claude mcp get`, which starts it once). ✗ when one is missing ("Run: cc-smart-dev-kit setup")
  or when another copy of it wins — a project's `.mcp.json`, or the local scope — naming
  what to remove. Without a Tavily key its server is skipped, as a `·` line that names the
  key file: a person who never wanted web search loses nothing. A key is never printed;
- OmniRoute, when it is installed here: a `·` line when a newer release has been out for
  three days (with `cc-smart-dev-kit omniroute update`), and nothing when it is the newest or
  the registry cannot be read. Never a failure (§ OmniRoute updates);
- tmux, when it is on your PATH: whether `~/.tmux.conf` has the line that lets an alert out
  of a pane (§ Notifications), and, inside a tmux session, whether the running server passes
  alerts through. Both are information (`·`) with the fix (`cc-smart-dev-kit setup`, or
  `tmux set -g allow-passthrough all`): tmux is optional. When neither is wrong — the line
  is in the file, and you are outside tmux, or inside one whose passthrough is `all` —
  doctor prints no tmux line at all;
- the Linux desktop extras of the alerts (§ Notifications), when a desktop is there: a `·`
  line for each tool that is missing — `gdbus` for the minute on screen and one alert per
  session, `xdotool` for the raise on a click, `xfconf-query` for XFCE's Do Not Disturb —
  never a failure, and nothing when they are all installed;
- no other plugin named `cc-smart-dev-kit` is enabled, and the plugin's old id `cc@cc-agentic`
  (its name before version 0.2.0) is not enabled either: two copies of the same hooks
  would run. When the old setup ran on this machine (its folder `~/.claude/cc-agentic`
  is there), anything else it left fails too: the old plugin installed, its launcher
  `~/.local/bin/cc-agentic`, `extraKnownMarketplaces.cc-agentic`, or the `cc-agentic`
  marketplace. The ✗ gives the order: `cc-agentic restore` first (or, when the old
  launcher cannot run, the two things to remove by hand), then `claude plugin uninstall
  cc@cc-agentic`, then `claude plugin marketplace remove cc-agentic`;
- no gateway setup stopped half way: while one did, ✗ "a gateway setup did not finish;
  run: cc-smart-dev-kit gateway setup";
- the gateway, when it is installed (the router copy, or one of its units — on Windows, its
  Scheduled Task — is there): the
  router service is active, the router copy is this plugin version's, the socket unit
  `cc-smart-dev-kit-router.socket` is there, listens on the config's port and is active (a
  router set up by an older version has none: ✗ "Run: cc-smart-dev-kit gateway setup"), the
  router answers on its port (when it does not, the ✗ says which of two cases it is: the
  socket is open but no router answers, so every request waits; or the router failed to
  start again and again, so systemd closed the socket and every request is refused; both
  name `journalctl --user -u cc-smart-dev-kit-router -n 30`), each backend answers, every judge
  target passed the judge test; and, as
  information, each slot's first target. Without
  `gateway.json` (set up with `--no-backend-key`), a `·` line says every slot answers on
  Claude. When it was never set up, doctor says "gateway: not set up (optional)" as
  information (`·`), not as a failure; with only `gateway.json` left (restore keeps it),
  "gateway.json kept; the gateway is not installed";
- the project of the folder you run it in (nothing outside a git project; a `·` line
  when git is not on PATH):
  - with `worktrees` in its `cc-smart-dev-kit.json`: that its `.claude/settings.json` (or
    `settings.local.json`) wires the three worktree hooks (§ Worktrees). ✗ names the
    missing ones and how to wire them;
  - ✗ when it wires them but has no `worktrees`: each worktree would fail;
  - ✗ for each other WorktreeCreate hook next to the engine's, in the project's settings
    or yours: Claude Code runs both and makes two worktrees;
  - as information (`·`), each plugin hook the project's `ownHooks` turns off here;
  - `!` warnings (never a failure) for an `ownHooks` entry with no project hook left to
    answer, and for a project hook that runs next to a plugin hook `ownHooks` does not
    name: both would answer (§ The hooks);
  - `!` warnings for the plugin's old `anymodel` names a project still carries from 0.2.x
    (`.claude/anymodel.json`, a `.claude/anymodel/` folder, a settings hook that calls
    `~/.local/bin/anymodel`): each names the new file, folder or command (§ Projects that
    used the old name);
- the last live check, as information (`·`), when `doctor --live` passed on this machine
  before: the Claude Code version it passed on, and "run it again" when the installed
  Claude Code is another version.

`doctor --live` makes two throwaway repos in a temp folder and runs one short `claude -p`
session in each, with **the plugin being checked** (`--plugin-dir`; the engine's lines in
the temp repo run that same plugin folder, never the installed launcher), only the
EnterWorktree, ExitWorktree and Bash tools, permission for exactly the calls it makes
(`--allowedTools`), and a three-step prompt: enter a worktree, run `git status` there,
leave with "remove". It uses your Claude login and costs a few cents. In the repo without
`cc-smart-dev-kit.json` it checks that the plugin's hooks fired (SessionStart, and the git guard
before the Bash call), that the git guard read the command line (the hook log names the
programs it parsed: `git`), that no WorktreeCreate hook ran and Claude Code made its own
worktree, and that it removed it. In the repo that turned the worktree engine on
(`worktrees`, and the lines from § Worktrees), it checks that the engine's WorktreeCreate
made the right folder and branch, the session worked there, and its WorktreeRemove removed
both. When everything passes it records the Claude Code version in
`~/.claude/cc-smart-dev-kit/live-check.json`. The temp folder is removed.

Setup only changes the keys it owns. Before each change it makes a backup in
`~/.claude/cc-smart-dev-kit/backups/` (a private folder, one subfolder per file), never beside
the file. A backup is never executable.

The command follows `HOME` and `CLAUDE_CONFIG_DIR`. With `CLAUDE_CONFIG_DIR` set, its
state and backups live under that folder. The launcher `~/.local/bin/cc-smart-dev-kit` is one
file for every config folder, so a `restore` under one config folder can remove a
launcher another one still uses. A launcher started without `CLAUDE_CONFIG_DIR` looks in
`~/.claude`.

## Moving from anymodel

Until 0.3.0 the plugin, its marketplace, its command and its slots were named
`anymodel` (the plugin id was `anymodel@anymodel`). A machine that ran 0.2.x still has
that version's names: its folders (`~/.config/anymodel`, `~/.claude/anymodel`,
`~/.local/share/anymodel`, `~/.local/state/anymodel`), its launcher
(`~/.local/bin/anymodel`), its router units (`anymodel-router`), the slots in
`gateway.json`, and the old names in `settings.json` and `~/.claude/CLAUDE.md`.

Install this version first, and **name the marketplace in the install line**. While the old
`anymodel` marketplace is added, a bare `claude plugin install cc-smart-dev-kit` installs
the copy that comes from `anymodel` (`cc-smart-dev-kit@anymodel`), and removing that
marketplace later takes its copy with it: `cc-smart-dev-kit@cc-smart-dev-kit` is the one to
install.

The `cc-smart-dev-kit` command does not exist on your machine yet — the old launcher
`~/.local/bin/anymodel` is the only one there — so run `migrate` from the plugin folder,
exactly as step 3 of [Install](#install) runs `setup`. Put the installed version in place of
`<version>`: the install prints no version, so read it with
`ls ~/.claude/plugins/cache/cc-smart-dev-kit/cc-smart-dev-kit/`:

```sh
plugin="$HOME/.claude/plugins/cache/cc-smart-dev-kit/cc-smart-dev-kit/<version>"
claude plugin marketplace add <owner>/cc-smart-dev-kit
claude plugin install cc-smart-dev-kit@cc-smart-dev-kit
bun --no-env-file --config="$plugin/bunfig.toml" "$plugin/dist/cli.js" migrate
```

Add the marketplace by its **new** name, as the first line does. The old source is already
added, and Claude Code reuses a marketplace already added from that source rather than making
a second one (its own documentation; the move has not been proved live on a 0.2.x machine, so
treat it as likely, not certain).

The new plugin shows `✘ failed to load` too, until its two companions' marketplaces are
added: `claude plugin marketplace add thedotmack/claude-mem` and
`claude plugin marketplace add anthropics/claude-plugins-official`. The install says so
("will not load without them"), and the `cc-smart-dev-kit setup` at the end of the move adds
both and installs the companions.

Until the move, `claude plugin list` shows the old plugin as broken:

```
❯ anymodel@anymodel
  Status: ✘ failed to load
  Error: Plugin anymodel not found in marketplace anymodel
```

That is expected once 0.3.0 is on `main` **and the old marketplace's catalog has been
refreshed**. The refreshed catalog declares `cc-smart-dev-kit`, so the old plugin's entry has
nothing left to load; a refresh never renames the marketplace itself. Two ways it happens:
`claude plugin marketplace update anymodel`, or an update the session runs by itself (the
auto-update was not seen live from a 0.2.x clone, only a clone already on the new catalog).
Until then, the old clone still lists `anymodel` and its plugin stays ✔ enabled. Either way
it is only that entry: the router keeps running from its own copy
(`~/.local/share/anymodel/router.js`), so model traffic is unaffected until `migrate`
replaces it, and `migrate`'s last step removes the old plugin.

After that one run the launcher `~/.local/bin/cc-smart-dev-kit` is in place, and every
later command uses it (`cc-smart-dev-kit migrate` for a run that has to be repeated).

Run it in your own terminal: it refuses inside a Claude Code session (it replaces the
router that session's own model traffic goes through), and it says to restart your
sessions afterwards.

`migrate` moves every folder, rewrites the state folder's records and backups (so
`restore` still undoes what the old setup added), gives the settings keys the old setup
owned this version's value (the slots' names, and the words of their descriptions),
rewrites the instructions block in `~/.claude/CLAUDE.md` to the new markers and import
path and refreshes the copy (0.2.x shipped no instructions, so a 0.2.x machine has no
block: there the move installs none), renames the gateway config's slots — and adds an
`alias` for each old slot name, so Claude sessions that are still running keep working
until they restart; an alias of a project's own that pointed at an old slot is pointed at
the renamed one — replaces the `anymodel-router` units with this version's, and then
tells you to uninstall the old plugin (it does it after a yes on a terminal, and only
when it is still installed). Each changed file gets a backup first, and every step is
printed.

**Then run `cc-smart-dev-kit setup`.** One `migrate` run does not install the
instructions: it only rewrites the block a machine already has. A 0.2.x machine has none,
so it ends the move without them, and without the copy `setup` would have made. `setup`
installs both, and refreshes the launcher and the companions with them. `migrate` says
this in its closing lines when it applies to your machine.

The order matters, and it is fixed: it reads and checks everything (the plugin install,
the folders, the gateway config through its schema, the settings, the records), then
**asks every question**, and writes nothing before they are answered — so a "no" to the
router question, or a run with no terminal to ask on and no `--yes`, leaves the machine
exactly as it was. It then prints the steps it will do and walks them in order: the
folders, the state folder's records and backups, the gateway config, the limit state, the
settings, the instructions, the launcher, the router, the old plugin. A step that fails
says which one, keeps everything the steps before it did, and the next run goes on from
there — each step is safe to repeat, and each finished step is recorded in
`~/.claude/cc-smart-dev-kit/migrate-progress.json` while the move is unfinished.
`--dry-run` prints that same plan, the same changes, and the question it would ask, and
writes, runs and stops nothing. A second run after a finished one says "Nothing to move.".

Two things it refuses, on purpose:

- **It does not run inside a Claude Code session.** Run it in a terminal, then restart
  your sessions.
- **It stops before writing anything when a target folder is already there** — say, a
  `~/.config/cc-smart-dev-kit` you already made. Move or remove one of them by hand, then
  run it again; it never merges two folders by itself. The one exception is its own state
  folder `~/.claude/cc-smart-dev-kit` when it holds nothing but what a Claude session's
  start wrote there (its `sessions/` record, an update check, the update log): the move
  goes into it. Anything else in it, and it says which folder holds what, and stops.

Before it moves anything it also warns you about Claude sessions that started with the old
plugin and are still running (their `sessions/` records, in the old state folder, name
them): close them first, and start them again here — until then one of them may write the
old folders again.

The old plugin goes **last**, after `migrate` (`claude plugin uninstall
anymodel@anymodel`, `claude plugin marketplace remove anymodel`): two copies of the same
hooks would otherwise run, and removing a marketplace also deletes its plugins' saved data.
That is why the order is add the new marketplace, install the new plugin, then `migrate`:
`migrate`'s last step already uninstalls the old plugin when you say yes on a terminal, and
the two `claude plugin` commands above are for a "no" (or no terminal). One more thing: a
judge target's test proof does not carry
over (the proof's own text changed with the name), so a fallback judge needs its test
again: `cc-smart-dev-kit gateway slot judge <targets>`. Without it the judge is simply
not used, and `doctor` says so. `migrate` prints that line when the old config had a
tested judge.

## Projects that used the old name

`migrate` moves your **machine's** own files. A project keeps what 0.2.x wrote in its own
`.claude/` folder, so run `cc-smart-dev-kit doctor` inside the project: it warns about each
one, with the name it becomes.

- **`.claude/anymodel.json`** — the old name of `.claude/cc-smart-dev-kit.json`, the file the
  plugin reads now. Rename it (merge the two when both are there): with only the old file, the
  project looks like one that never opted in, and every plugin hook stays silent in it.
- **`.claude/anymodel/`** — the old name of `.claude/cc-smart-dev-kit/`, where a skill reads the
  project's own add-ons (`review.md`, `plan-task.md`, …). Rename the folder.
- **A hook in `.claude/settings.json`** that still calls `"$HOME/.local/bin/anymodel" hook
  <name>` — that launcher went with 0.2.x. Change it to
  `"$HOME/.local/bin/cc-smart-dev-kit" hook <name>` (the lines are in § Worktrees, and
  `cc-smart-dev-kit hook` prints them).

## The AI gateway (optional)

A local router, `cc-smart-dev-kit-router`, lets Claude Code's `haiku` and `sonnet` subagents run on
more affordable models (for example through OmniRoute and Ollama Cloud), while Claude models stay
real Claude on your own login. No prompt text is ever changed. The service that keeps the
router running is a systemd user unit on Linux and a per-user Scheduled Task on Windows
(see [Windows](#windows)); macOS has neither, and `gateway setup` refuses there.
How it works: [docs/gateway.md](docs/gateway.md).

| Command | What it does |
|---|---|
| `cc-smart-dev-kit gateway setup [--yes] [--backend-key-stdin <backend> \| --no-backend-key]` | Makes `~/.config/cc-smart-dev-kit/gateway.json` (mode 600; the key on stdin, never argv), copies the router to `~/.local/share/cc-smart-dev-kit/router.js`, writes the systemd user units `cc-smart-dev-kit-router.socket` (it holds the port) and `cc-smart-dev-kit-router.service`, starts them, and waits up to 5 s for the router to answer. First of all it asks the router's port: when another program holds it (an older router, say), it stops and writes nothing. When the router runs and the copy or a unit changed, it says what the restart does and asks; `--yes` skips the question. A restart lets the answers in flight finish (up to 120 s; an answer still running then is cut, and Claude Code retries it), and new requests wait in the socket meanwhile, so none of them fails. A connection that sends nothing is closed half a second after the restart starts, so it cannot hold the restart. The exceptions are the restarts that must open the socket again (the first setup that moves a router from an older version to its socket, a socket that was stopped, a changed socket unit or port): until the old router has finished its answers, new requests fail, and setup's warning names which case it is. When the socket cannot open at all, setup says so and starts the router without it (the router binds the port itself). A router that fails to start 5 times within 60 s is given up: systemd then closes its socket too, so requests are refused at once instead of waiting; `doctor` names it, and `gateway setup` starts both again. A setup that stopped half way is finished by the next one. It never touches Claude Code's settings. |
| `cc-smart-dev-kit gateway status` | Router health, each backend, the slots, and whether Claude Code points at the gateway. Keys are masked. |
| `cc-smart-dev-kit gateway models` | Every model each backend offers, and the slots. |
| `cc-smart-dev-kit gateway slot <scout\|worker> <target>[,<target>…]` | Sets a slot's targets, checked against the backend's model list. Live, no restart. |
| `cc-smart-dev-kit gateway slot opus claude-opus-5-5,<target>[,…]` | A fallback for Opus (and `slot fable claude-fable-5-1,…` for Fable): Opus still goes to Anthropic unchanged, and only when Anthropic answers with your plan's usage limit does the next target answer, until Opus answers again. Never on a short rate limit or a server error. `slot opus off` turns it off. |
| `cc-smart-dev-kit gateway slot judge <target>[,<target>…]` | A fallback judge for auto mode's safety check, used **only when Claude cannot answer it** (the plan's usage limit, or no valid Claude login). Each target must first block a test check (a force push to `main`), or it is not set. `slot judge off` turns it off. |
| `cc-smart-dev-kit gateway on` | Points Claude Code at the router: sets its env keys in your `settings.json` as keys cc-smart-dev-kit owns. A gateway key someone else set stops it; nothing is overwritten. Every running session switches on save. |
| `cc-smart-dev-kit gateway off` | Removes exactly the keys `on` set. Restart the sessions afterwards. |
| `cc-smart-dev-kit gateway serve` | Runs the router in the terminal. |

### First setup

1. Run OmniRoute on this machine at `http://127.0.0.1:20128`: setup writes that address
   for the `omniroute` backend. Give it a connection to a provider (Ollama Cloud, say),
   and make an API key in it for the router. OmniRoute somewhere else: after setup,
   change `backends.omniroute.baseUrl` in `~/.config/cc-smart-dev-kit/gateway.json`.
2. Save that key in a file only you can read, and give it to setup **on stdin**. The
   first key is always the `omniroute` backend's: the default slots use it.

   ```sh
   cc-smart-dev-kit gateway setup --backend-key-stdin omniroute < key-file
   ```

   Why a file: a key typed at the prompt shows on the screen, and setup reads to the end
   of the input, so typing it also needs Ctrl-D. A key as an argument would land in the
   shell history and the process list, so setup refuses one there. No key yet:
   `cc-smart-dev-kit gateway setup --no-backend-key` (every slot answers on Claude).
3. `cc-smart-dev-kit gateway status`, then `cc-smart-dev-kit gateway on`.

Auto mode's safety check is judged by Claude whenever Claude can answer it. The judge
slot is **off by default**, and even when it is set it is only a fallback: it answers a
check only when Claude cannot (your plan's usage limit, or no valid Claude login). With no
judge set, Claude Code then asks you. A more affordable judge can block good work, and a weak one
can let a risky command through, so `slot judge` first tests each target on one obvious
case and refuses a target that lets it run. "Claude first" relies on the router
recognising the check by its prompt. If Claude Code rewords that prompt, the check is
routed by its model name until the router is updated (see
[docs/gateway.md](docs/gateway.md) § Known limits; [roadmap](docs/roadmap.md) Phase 3).

### Web search

`cc-smart-dev-kit search "bun runtime latest version"` searches the web through the same
OmniRoute backend, with the same key: it prints each result's title, its URL and a short
snippet, and the whole output is cut to about 2500 characters (`--json` prints the whole
answer). `--fetch <url>` reads one page's text instead. It needs the gateway set up — its
own error says so when it is not — and `--fetch` needs a web-fetch provider key inside
OmniRoute. With the default setup a search is free: Ollama's web search costs $0.00, and
OmniRoute caches a query for five minutes. Your OmniRoute key goes only to OmniRoute, but
the query (or the URL) goes on to the search or fetch provider on the internet, so never
put a key, a private host name or private data in it. The details, the measured numbers
and the limits: [docs/search.md](docs/search.md).

### OmniRoute updates

The affordable slots answer through OmniRoute, a program a person installs themselves (a
global Bun or npm install) and runs as a user service. cc-smart-dev-kit keeps it on a
version that has had a few days to prove itself:

```sh
cc-smart-dev-kit omniroute status     # what is installed, and what is newer
cc-smart-dev-kit omniroute update     # install the newest safe release, restart, check
cc-smart-dev-kit omniroute rollback   # put back what the last update replaced
```

- **Three days.** `status` and `update` read the npm registry
  (`https://registry.npmjs.org/omniroute`) and take the newest plain `x.y.z` release
  published at least three days ago. A canary, a version published this morning, a version
  the registry has no time for, and a version npm marks deprecated, are never installed. A
  release that reaches a machine the hour it is published reaches it before anyone else has
  run it — and OmniRoute is the model path of every affordable slot here
  ([docs/design.md](docs/design.md) § OmniRoute).
- **`--to <version>` follows the same rule.** It installs one release instead of the newest,
  and only when it is a plain `x.y.z` the registry lists and that is at least three days old.
  A version published this morning, a canary tag, a `https://…` tarball and a `github:…` spec
  are all refused in words, and nothing is installed: `bun add --global omniroute@<spec>`
  would otherwise take whatever npm resolved the spec to. The portal never passes `--to` at
  all — its card offers the newest release alone.
- **Nothing about one machine is written into the plugin.** The user unit that runs it is
  found by looking for the one whose `ExecStart` runs it, and the install is found from that
  command line (walking up to the package's own manifest); with no unit, the global install
  folders of Bun and npm and the `omniroute` on PATH are looked in. The backend that talks to
  it is the one named `omniroute` in `gateway.json`, else one on this machine whose port the
  unit names. `status` says which it found.
- **The update restarts it.** The confirmation says what that costs: while the unit comes
  back, the gateway's slots fall to their next target, and the last target of both shipped
  slots is Claude — so work goes on, on your own Claude login, and not on an affordable model.
- **A version that does not answer is put back**, and the failure is said: after the restart
  the check waits up to a minute — with a growing pause between tries — for `/v1/models` to
  answer at all, because `systemctl --user restart` returns before OmniRoute listens and a
  good release must not be rolled back for being slow. Then it reads `/v1/models` with the
  backend's key (a 401 there is named as the key, not the version) and sends one tiny chat to
  the first affordable target of the scout slot. The prompt is a fixed word of the plugin's
  own; nothing from a conversation, this machine or you is sent. When the check fails, the old
  version is installed again, restarted, and waited for the same way, then the reason is
  printed.
- **`rollback`** installs the version the last update replaced, recorded in
  `~/.claude/cc-smart-dev-kit/omniroute.json` before the install. It keeps that record, so a
  second rollback is a no-op rather than a bounce.
- **Never in the background, and never inside a Claude Code session.** It restarts a service
  that answers real requests, so a person runs it, watches it and reads what failed; and a
  session must not move its own model path mid-turn. `update` and `rollback` hold the same
  lock the rest of the kit uses, around the record, the install, the restart and the health
  check: a second run waits for the first, and says who holds it when the wait runs out.
- **A folder this user cannot write is refused before anything runs.** A global install under
  a root-owned prefix (`npm i -g` as root, a package in `/usr/lib/node_modules`) would fail
  with a permission error halfway through, and the put-back would "fail" the same way though
  nothing had changed. The command to copy is printed instead; `sudo` is never run.
- **`doctor`** shows one `·` line when a newer release has been out for three days. Never a
  failure: when to update is your choice.

### The usage limit: the alert, the status line, and `usage`
- **The alert.** When a turn stops at your plan's usage limit, the plugin's StopFailure
  hook shows a desktop notification about your session's model (only once the gateway is
  set up). On Linux it offers "Use <target> until it resets", which runs the `slot opus`
  command above (the model, then Sonnet when only the Opus window ran out, then the worker
  slot's affordable targets), and "Wait"; after "Use", send a message in Claude Code to go on.
  On macOS and Windows it names the command (a Windows toast has no action button).
  It needs a desktop to show the alert on: where there is none
  (an SSH session, a headless machine) or the gateway was never set up, the `notify` hook
  announces the stopped turn instead. A short rate limit is not the plan's limit: Claude Code
  retries it, and the `notify` hook announces the turn only if it dies then.
- **The status line.** `cc-smart-dev-kit setup --statusline` sets Claude Code's status line to
  `cc-smart-dev-kit statusline`. It shows your 5-hour and 7-day plan usage, warns from 85 %, and
  shows any fallback in use.
- **`cc-smart-dev-kit usage`** reads Claude Code's own transcripts and shows, per session, the
  main session's replies by model and, apart, its subagents: how each was launched, which
  model wrote each reply, and the share on Opus. It also lists the Opus and Fable launches
  the `agent-guard` hook allowed, with the reason each one gave (review, or its
  `Opus reason:` / `Fable reason:` word) — an Opus or Fable agent spends your own plan usage.
- **Auto mode's safety checks**, in the same report when the gateway is set up. In auto mode
  Claude Code sends one extra request for every shell command or network action it judges
  ([The auto-mode block](#the-auto-mode-block)). Those requests are not a session's replies —
  they are Claude Code's own, so the transcripts this command reads do not show them. The
  router counts them — how many went through each day, how many Anthropic answered and how
  many the judge, and the input, output and cache tokens each answer reported — and keeps
  the newest 30 days in
  `~/.local/state/cc-smart-dev-kit/safety-checks.json`. `cc-smart-dev-kit usage` shows today
  and the seven days before it, one line a day. The counting never changes an answer: the
  bytes reach Claude Code exactly as they came, and they are read after the client has them.
  **What this cannot tell you:** whether those tokens count against a **Pro, Max or Team**
  plan's limit. Anthropic's docs say they count on **Enterprise and API** accounts; for the
  others it is not confirmed, so the report says so under the numbers. Treat them as what was
  spent, not as what will be billed. With no gateway set up there is no router to count, and
  the report says "none".
  **After updating to this version, run `cc-smart-dev-kit gateway setup` on each machine**: the
  router gained this counting, and the copy a machine runs is replaced by that command (it
  asks before it restarts the router, which cuts the answers in flight).

## The portal

`cc-smart-dev-kit portal` starts a small web page on this machine: the same facts as the
commands above, and the same actions, with a form instead of a command line.

```
$ cc-smart-dev-kit portal
cc-smart-dev-kit portal 0.3.0 — for you, not for Claude.
Running from ~/.local/share/cc-smart-dev-kit/portal.js.

  http://127.0.0.1:20150/?t=…

It binds 127.0.0.1:20150 only, and stops after 30 minutes with no request.
Stop it now with Ctrl+C here.
```

Your default browser opens that link — unless Chrome's `claude-code` profile is on this
machine, the one Claude drives: then nothing is opened for you, and the line under the link
says where to open it instead (below). `--port <n>` changes the port (0 takes a free one);
`--no-open` only prints it.

**It refuses to run inside a Claude Code session** (`CLAUDECODE`): "the portal is for you,
not for Claude". The portal changes this machine's model path and the safety judge, and a
session must never do that for itself. Run it in your own terminal — and open the link in a
browser window that is not Chrome's `claude-code` profile, the one Claude drives: it would put
the portal's session cookie inside that profile, where Claude could reach the page's buttons.
(When that profile is on this machine, `portal` opens no browser by itself for exactly that
reason: it prints the link and says where to open it. Without that profile it opens your
default browser, as always.)

Six screens, each following the design the owner approved (2026-10-16):

| Screen | What it shows |
|---|---|
| **Overview** | The plan limits the router saw and the slots answering from a fallback; every slot's chain; the three switches (the gateway, your own judge, the opus and fable fallback); the latest warnings. |
| **Slots** | A chain per slot, built from the backends' live model lists. **Test each target** — one tiny chat to each affordable model, and the force-push test for a judge — then **Save**, after a confirmation that every running Claude session uses it from its next request. Save is held off for the **judge** slot until every backend target has blocked the force-push test; the command line's own rule, said in the judge note. |
| **Health** | The router's counters, each backend and whether it answers, the targets resting, and its journal. Looks again every five seconds (Pause stops that, and a hidden tab is not reloaded at all); a look of its own does not count as activity, so an open Health tab cannot hold the portal up. |
| **Machine** | Updates (installed, newest, last check, on hold, check now, install), the heavy-job queue, the companion plugins, the OmniRoute card, the **Browser card** (the browser's own `doctor` lines, the five steps as one numbered list — each step's sentence, then the address or command it needs in a box of its own with a Copy button — a button that runs `browser setup`, which opens the extension's page in your `claude-code` profile and names that profile in Chrome's own settings file while Chrome is closed, and a masked field that saves the token: the stored value is never on the page), `doctor` (run again, without the browser's lines, which are on that card), the project's auto-mode rules, the **Project card** (below), and the **Warp card**, which shows the install and remove commands to copy. |
| **Settings** | Every workflow setting, one row each: what Claude does after a finished step (auto commit, auto push, the pull request, the auto-merge rule, the merge method, the branch and the worktree), the alerts (which events, the sound, the usage-limit percentage), and the switches (the status line, the session names, the heavy-job queue, the update hold). Each row says where its value comes from — `yours`, `this project` or `default` — and a row the project sets is read-only here, with a link to the Project card. |
| **How this page stays private** | The security design in plain words, linked from the footer. |

**The Settings page writes one value at a time**, through the same functions the command
line's `workflow set` uses, so the page and `cc-smart-dev-kit workflow show` can never
disagree about this machine: your own choices go to
`~/.config/cc-smart-dev-kit/workflow.json`, and the two switches the project owns
(`switches.sessionNames`, `switches.jobRoute`) are written into the project's committed
`.claude/cc-smart-dev-kit.json` after a confirmation that says so. A row the project sets is
read-only here — the project's choice wins — and says where to change it. A value outside a
row's own set (a merge method that is not `merge`, `squash` or `rebase`; a percentage that is
not 1–100) is refused in words, and nothing is written.

**The Project card** is about the repo the portal was started in. Nothing set up yet: the
line and **Set up this project**, which opens the form — the base branch, the worktree folder
prefix, the setup command, the branches that start from another base, the protected branches,
the three guards and the worktree engine. Its first values are what
`cc-smart-dev-kit project init` would offer for this repo (its default branch — the remote's
`origin/HEAD`, else the repo's only branch, else `main`, else `master`, else the branch you
are on — its lockfile's command, the branches GitHub protects), never a value this page made
up. The preview is that command's own plan, made on the server and sent to the page: a box
asks again once the typing pauses (300 ms, and at once when an edit is finished), so the boxes
follow the words, and the browser never builds the file. Each answer carries the hash of the
two files it was planned from, and **Write the files** sends it back: a project file someone
changed in between makes the write refuse ("preview again") rather than quietly write their
change away. The write itself goes through the same `applyProjectInit` (a backup, then an
atomic write), asks first, and **never commits**: commit them with the project.

**Without a gateway config** (never set up, or one that cannot be read): Overview, Slots and
Health show "The gateway is not set up", with the command that sets it up and a button to
Machine. **Machine, Settings, the Project card and the privacy page still work**, because
none of them needs the gateway: the updates, the heavy-job queue, the companions, `doctor`,
the workflow settings and the Warp card are all real there — `doctor` matters most on a
machine that has no gateway, and its gateway line is information (`·`), never a failure.
What does need the config says so in a short line instead of showing a made-up value: the
header pill reads "Gateway not set up", the OmniRoute card's Backend line says "the gateway
is not set up", a last card on Machine names the setup command, and the privacy page says
that no router answers here rather than naming a port. A config that is there but broken is
named as such, with its own error.

**Everything it does is real**, and every action runs the same function the command line
runs — the same checks, the same lock, the same words (`docs/design.md` § The portal). What
needs `sudo` is not run: the Machine page's Warp card shows `cc-smart-dev-kit setup --warp`
and `--remove-warp` as commands to copy, and never runs them.
Writing the auto-mode trust rules needs an explicit confirmation on the page, which stands in
for the terminal question the command line asks.

**How it stays private.** It binds `127.0.0.1` and nothing else; the `Host` header must be
exactly `127.0.0.1:<port>` or `localhost:<port>` (that is where a DNS-rebinding page stops);
a foreign `Origin` is refused; the one-time token in the link is exchanged on the first load
for an `HttpOnly`, `SameSite=Strict` session cookie whose name carries the portal's own port
(`ccsdk_portal_<port>` — a cookie has no port, and a browser sends every `127.0.0.1` cookie to
every port on it, so two portals on two ports hold their own sessions), and the URL is cleaned;
a change (a POST) must carry an `Origin` of ours **and** the CSRF token that came with the
page. A GET that is the person's own but holds no session (a link already used, a cookie from
a portal that stopped) gets the page that says so, in 403, and it holds no fact about the
machine; a `Host` or `Origin` that is not ours stays the one word, "Forbidden". A strict
`Content-Security-Policy` allows no inline script and nothing from the internet — no web
font, no CDN. A backend key never reaches the page: it shows as `••••a1b2`, its last four
characters and nothing else (`maskKey`). And the portal
stops itself after 30 minutes with no request, so a page left open on an unlocked screen does
not stay a way in.

It runs from a copy in `~/.local/share/cc-smart-dev-kit/portal.js`, never from the plugin's
version folder: Claude Code deletes an old version folder some time after an update, even
under a running process. The copy is a managed file, so `cc-smart-dev-kit restore` removes it.
Because the copy sits outside the plugin, the parent tells it where the plugin is
(`--plugin-dir`), and every file it needs — the router bundle a restart installs, the
instructions, `hooks/hooks.json` — is resolved from the version Claude Code records as
installed **at the moment it is needed**; a folder a later update deleted is named in words
instead of failing, and a version folder that vanished during a long run is not used again.

## Instructions, skills and agents

The plugin gives Claude general working instructions, skills and agents, written for any
project.

**The always-on instructions** (`plugin/instructions/core.md`): Claude works as the senior
engineer and team lead — it plans, splits the work into independent phases, starts them at
the same time as parallel subagents, checks each hand-back and gets one second-opinion review
per change set. Also: the role, delegation, each subagent's model and effort, review, the core
principles, how to end a turn, and keeping docs true. `cc-smart-dev-kit setup` installs them for your
user, **on by default**:

- a copy goes to `~/.claude/cc-smart-dev-kit/instructions/` (refreshed by every setup, and by the
  first session start after a plugin update);
- one block in `~/.claude/CLAUDE.md` imports it:

  ```markdown
  <!-- cc-smart-dev-kit:begin -->
  <!-- Written by cc-smart-dev-kit setup. `cc-smart-dev-kit setup --no-instructions` takes it out. -->
  @~/.claude/cc-smart-dev-kit/instructions/core.md
  <!-- cc-smart-dev-kit:end -->
  ```

  Your own text in that file stays as it is. Do not edit inside the block: setup rewrites it.
- `cc-smart-dev-kit setup --no-instructions` takes the block and the copy out, and keeps them out:
  a later plain `cc-smart-dev-kit setup` leaves them out too. `cc-smart-dev-kit setup --instructions` brings
  them back. `cc-smart-dev-kit restore` takes them out with everything else and forgets the choice,
  so the next setup installs them again.
- Setup records which plugin version wrote the copy (`~/.claude/cc-smart-dev-kit/instructions-version`).
  `doctor` says when the copy is behind the installed plugin.

The import reaches the main session and subagents that load `CLAUDE.md` (the built-in
`Explore` and `Plan` do not). With `CLAUDE_CONFIG_DIR` set, both live under that folder.

**Opt-in instructions, per project.** `plugin/instructions/optin/worktrees.md` is for a
project that runs one Claude session per git worktree, several at once. Setup copies it too,
but nothing imports it until a project does — add this line to the project's `CLAUDE.md`:

```markdown
@~/.claude/cc-smart-dev-kit/instructions/optin/worktrees.md
```

Claude Code asks once before it loads an import from outside the project (its docs say so;
not yet proved here: `docs/claude-code-contract.md`). The file reads its
values (`base`, `prefix`, `setup`) from the project's `.claude/cc-smart-dev-kit.json`, field
`worktrees`.

That committed import line points at **each person's own copy**. For a teammate without
cc-smart-dev-kit, or one who ran `cc-smart-dev-kit setup --no-instructions`, the file is not there, and the
import loads nothing — Claude Code gives no error. `cc-smart-dev-kit doctor`, run in the project,
names such a missing import.

**17 skills** (`/cc-smart-dev-kit:<name>`; each also loads on its own when its topic comes up):

| Skill | Use it for |
|---|---|
| `review` | Your own review before a commit, and the one second opinion per change set. |
| `plan-task` | Planning non-trivial work: research, questions, the plan file, phases and owners. |
| `commit` | When to commit, push, open the pull request and ask for the merge. |
| `pull-request` | What every pull request body carries. |
| `verify-change` | The affordable loop after edits; the checks the push will run; testing with the person. |
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
| `search` | Quick web lookups and one page's text through the gateway (`cc-smart-dev-kit search`). |

**4 agents** (`cc-smart-dev-kit:<name>`; the caller passes the model and effort on each launch, so
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
`.claude/cc-smart-dev-kit/<skill>.md` — for example `.claude/cc-smart-dev-kit/review.md` or
`.claude/cc-smart-dev-kit/ui-verify.md` (how to find this project's dev server). Where the project's
`CLAUDE.md`, its rules or an add-on file differ from the plugin's general text, the project's
text wins. So the plugin stays general, and each project keeps its own rules in its own repo.

## Companion plugins

cc-smart-dev-kit depends on two other plugins (its `dependencies` in `plugin.json`), and Claude
Code installs and turns them on with it:

| Plugin | Marketplace (`claude plugin marketplace add …`) | Version |
|---|---|---|
| `claude-mem@thedotmack` (memory across sessions) | `thedotmack/claude-mem` | 13.29.0 or newer |
| `frontend-design@claude-plugins-official` | `anthropics/claude-plugins-official` | any |

- **Claude Code installs a dependency only from a marketplace you added.** Without it,
  `claude plugin install cc-smart-dev-kit@cc-smart-dev-kit` succeeds with a warning, and cc-smart-dev-kit does not
  load. `cc-smart-dev-kit setup` adds each missing marketplace, and that installs the companion.
- **A companion you have already stays as it is.** A claude-mem in the range is not
  updated or reinstalled. One older than 13.29.0 stops the install: run
  `claude plugin update claude-mem@thedotmack` first.
- **You turned one off?** Setup leaves it off and says how to turn it on; cc-smart-dev-kit does
  not load while it is off.
- `restore` does not uninstall them.

## claude-mem on the gateway

claude-mem writes a summary of every session, by default with Claude Haiku on your own
Claude login. When the [gateway](#the-ai-gateway-optional) is set up and claude-mem is
installed (13.29.0 or newer), `setup` points claude-mem at the gateway's affordable model
instead, with Claude Haiku as claude-mem's quota fallback: while the affordable model is in a
quota or rate-limit cooldown, claude-mem sends its work to Claude, and hands it back
once the affordable model answers again. It is not a fallback for a backend that is down or
refuses its key. It sets seven keys in `~/.claude-mem/settings.json`
(`$CLAUDE_MEM_DATA_DIR/settings.json` when you set that variable):

- `CLAUDE_MEM_PROVIDER`: `openai-compatible`, with `…_PRESET` `custom`;
- `CLAUDE_MEM_OPENAI_COMPAT_BASE_URL`, `…_MODEL` and `…_API_KEY`: the first affordable target
  of the gateway's scout slot (else its worker slot), its backend's address plus `/v1`,
  and that backend's key from `gateway.json`;
- `CLAUDE_MEM_QUOTA_FALLBACK_PROVIDER` `claude` and `…_MODEL` `claude-haiku-4-5-20251001`.

The rules:

- **Your choice stands.** claude-mem writes its own defaults into the file on its first
  run; setup changes a key only while it holds that default (`""`, or `claude` for the
  two providers), or the value setup wrote there itself. One key set to anything else
  (also a key setup set and you changed since), or a key pool of your own in
  `CLAUDE_MEM_OPENAI_COMPAT_API_KEYS`, and setup changes none of them and says so.
- **Checked first, the way claude-mem calls it.** Before it writes, setup sends the
  backend one chat request (`POST <base URL>/chat/completions` with the model and the key,
  `max_tokens: 1`), and writes only when it answers. A 401 or 403 is a refused key; a 404
  means no OpenAI chat endpoint there (or, with `model_not_found`, no such model).
  `--dry-run` sends nothing: it says which backend a real run would check.
- **The key is never printed**: the output shows its last four characters at most. A
  write that sets it leaves the file at mode 600.
- **An old nested file** (only `env` at the top, with claude-mem's keys in it) is left
  alone: claude-mem rewrites it flat when it next starts. Start a session, then run setup
  again.
- **The gateway has no affordable model any more** (removed, or its slots are Claude only)
  while claude-mem still holds setup's keys: setup says so, and how to fix it (run setup
  again once there is one, or `restore`).
- `restore` removes the keys that still hold what setup wrote, so claude-mem goes back
  to its own defaults; a key you changed since stays.

## Warp

The [Warp](https://www.warp.dev) terminal is optional. Plain `setup` never installs the
app or its Claude plugin (`warp@claude-code-warp`, from the marketplace
`warpdotdev/claude-code-warp`); only `--warp` does. When the app is there without the
plugin, `doctor` says so and names `cc-smart-dev-kit setup --warp`.

`cc-smart-dev-kit setup --warp` installs Warp through your system's own package manager, from
Warp's signed source:

| System | What runs |
|---|---|
| Debian, Ubuntu (x86_64, arm64) | Warp's key (downloaded over HTTPS, checked, turned into apt's form by `gpg --dearmor`) into `/etc/apt/trusted.gpg.d/warpdotdev.gpg`, the source file `/etc/apt/sources.list.d/warpdotdev.sources` (the same file, text and Signed-By that Warp's own package writes, with `Architectures:` for this machine's architecture; kept when a Warp source is there already), `apt-get update`, `apt-get install -y warp-terminal`, all with `sudo` |
| Fedora, RHEL (x86_64, aarch64) | `rpm --import` of Warp's key from the checked copy (never straight from the URL), `/etc/yum.repos.d/warpdotdev.repo` (kept when there), `dnf install -y warp-terminal`, all with `sudo` |
| macOS | `brew install --cask warp` |
| anything else | a message with the download link, [warp.dev/download](https://www.warp.dev/download) |

- **Warp's key is pinned.** It is downloaded over HTTPS only (every redirect too), and
  must hold exactly one key, with the fingerprint cc-smart-dev-kit knows
  (`0913165C78D5B7A41B42AC657FF7AB39D60F803F`). Anything else stops the Warp part with a
  message that the key changed, before any command runs.
- **The exact commands are shown first, then asked**, together with any other question,
  before anything runs. With no terminal, or a "no", the Warp commands and Warp's plugin
  are left out; the rest of setup is still done, and setup exits with 1. `--yes` does
  not skip this question.
- **`sudo` asks for your password on your terminal.** cc-smart-dev-kit never sees, stores or
  pipes it, and never runs a downloaded script.
- **A command fails half way:** setup lists the commands that ran before it, and says
  that `cc-smart-dev-kit setup --remove-warp` undoes them.
- Then it adds Warp's Claude plugin.

`cc-smart-dev-kit setup --remove-warp` removes the app (`apt-get purge`, `dnf remove`, or
`brew uninstall --cask`), Warp's package source and key files, your own Warp shortcuts
(`~/Desktop/dev.warp.Warp.desktop`, `~/.local/share/applications/dev.warp.Warp.desktop`;
each backed up first), and Warp's Claude plugin, with its marketplace when no other plugin
of it is installed. On Fedora it removes from rpm only the key whose id is Warp's pinned
key. Warp's own settings folders stay.

## The auto-mode block

Claude Code's [auto mode](https://code.claude.com/docs/en/auto-mode-config) reads its
trust rules (`autoMode.environment`) only from your user settings, never from a project's
`.claude/settings.json`. So a project that wants auto mode to know its rules lists them
in its `cc-smart-dev-kit.json` (`autoMode`), and `cc-smart-dev-kit setup`, run in that project (or with
`--project <dir>`), copies them into `autoMode.environment` in your `settings.json`:

- **Shown, then asked on a terminal**, because these are trust rules: a person at a
  terminal always decides. `--yes` skips only the question. With no terminal they are
  left out, also with `--yes`, and setup says so — a `--dry-run` without a terminal
  prints the same note, beside the entries it shows.
- **In a worktree**, the question names the file the rules come from: the worktree's own
  `cc-smart-dev-kit.json`, or else the main checkout's. When the worktree's own file says
  something else than the main checkout's, the question says so.
- **A project setup cannot read** (an invalid `cc-smart-dev-kit.json`, one that needs a newer
  cc-smart-dev-kit, git older than 2.31, or a worktree whose main checkout is gone) leaves only
  the auto-mode entries out, with a `!` line that says why; the rest of setup is done.
  Outside git, setup needs no git at all.
- **Only its own entries.** setup adds each entry at the end of the list and owns it;
  it never changes or removes an entry it did not add. When there is no list yet, it
  starts the list with `"$defaults"`, so Claude Code's built-in entries stay in force.
- **The project changes its rules:** the next setup in that project shows the change
  (`+` and `-` lines) and makes exactly that change. Each project's entries are its own.
- `restore` takes out every entry setup added. `"$defaults"` goes too, unless you have
  added entries of your own since.

## Heavy jobs: one queue for the machine

When many Claude sessions and agents run on one machine, type checks, typed lints, test
runs and builds start together and the machine runs out of memory. `cc-smart-dev-kit job run`
reserves the memory a job needs, waits while it is not free (oldest first, saying who
holds it), runs the job, and gives the memory back however the job ends. How it works,
the kinds, the config and the limits: [docs/jobs.md](docs/jobs.md).

| Command | What it does |
|---|---|
| `cc-smart-dev-kit job run [--kind <kind>] [--gb <n>] [--exclusive <name>] -- <command…>` | Waits until this machine (and any shared folder) has the memory, then runs the command. Its stdin, stdout, stderr and exit code pass through; SIGINT, SIGTERM and SIGHUP are sent on to the whole job. `--exclusive <name>`: at most one job with that name at a time, in order (with a kind, or alone). |
| `cc-smart-dev-kit job status` | The memory, the budget, and who holds or waits, here and on each shared folder. |
| `cc-smart-dev-kit job kinds` | The kinds (`tsc`, `lint:typed`, `test:run`, `test:coverage`, `build`, `image:build`, and the project's own) and what each reserves. |

The state is per user, in `~/.local/share/cc-smart-dev-kit/jobs/`. A machine sets its limits,
and optional shared folders for containers or users on one host, in
`~/.config/cc-smart-dev-kit/jobs.json`.
## The hooks

The plugin's hooks run in every project. Most stay silent in a **project without
`.claude/cc-smart-dev-kit.json`**; the three that are about your machine, not a project —
`agent-guard`, `notify` and `playwright-output` — run there too (§ Notifications below). The plugin ships no worktree hook:
Claude Code makes its own worktrees, unless a project turns on the worktree engine
(§ Worktrees). Each hook runs through `bin/cc-smart-dev-kit-bun.sh`, which finds bun even when your
PATH has none: the bun `cc-smart-dev-kit setup` saved in the launcher first, then
`$BUN_INSTALL/bin/bun`, `~/.bun/bin/bun`, and bun on PATH. It starts bun with
`--no-env-file` and the plugin's own empty `bunfig.toml`, so a hook never reads the working
folder's `.env` files or its `bunfig.toml` (a project's `preload`). With no bun at all, or one
older than 1.4.3, a PreToolUse guard asks you before every call it covers (`--missing=ask`: a
guard fails closed), and every other hook writes one line on stderr and the session goes on
(`--missing=quiet`).

| Hook | When | What it does |
|---|---|---|
| `git-guard` | before a Bash or PowerShell command | Asks you before a force-push, a push to a protected branch (`protectedBranches`), `push --all` / `--mirror`, a branch deleted on the remote (`git push origin :x`, `--delete`), `reset --hard`, `clean -f`, `worktree remove -f`, a checkout or restore that throws changes away, `branch -D`, `stash clear` and an unnamed `stash drop` (they throw work away), and (with `worktrees`) a bare `git stash` or `stash pop`: every worktree shares one stash. Text in quotes, here-docs and comments is not a command; a shell keyword, a wrapper (`timeout 60 git push -f`, `sudo -u me …`), a here-doc fed to `sh`, and the text piped into `sh` are read through. Git's own abbreviations count (`--forc` is `--force`). Not read: a git alias (`-c alias.x=…`, or one of your own), `branch -f`, `checkout -B`, `switch -C`, `ssh`, a script file, and a branch it cannot name. |
| `main-folder-guard` | before Edit, Write, NotebookEdit, and Serena's edit tools | With `worktrees.guardMainFolder`: refuses an edit of a file in the main checkout itself, and says how to get into a worktree. A Serena edit is placed by the folder Serena has active, which `serena-root` records for the session; a folder it cannot work out, it asks about rather than letting the edit through. |
| `serena-root` | `mcp__serena__activate_project` (before and after the call), and a session start | Records which folder Serena edits for this session (`worktrees.guardMainFolder`), so the guard above can place a Serena edit: from the moment an activation is allowed the record says "unknown" until Serena's own answer names the folder, so the guard asks rather than trusting a folder Serena may not be on. It refuses an activation that names a project by name, or a folder outside this repo and its worktrees. At a session start it forgets the record (`startup`) or distrusts it (`resume`, `clear`, `fork`). |
| `playwright-output` | before every `mcp__playwright__*` call | Puts a screenshot or snapshot the caller names by a relative `filename` into the browser's output folder instead of the folder the session runs in (`@playwright/mcp` resolves a caller-named file against the process's own folder). |
| `merge-guard` | before a Bash or PowerShell command | Asks you before a command that merges a pull request (`gh pr merge`, `--auto` included — an armed merge lands once the checks pass, with nobody watching). It reads three facts, read-only: the pull request (`gh pr view`), the repository's default branch (`gh repo view`), and its required checks (`gh pr checks --required`; a skipped one counts as passing, GitHub's own rule). It lets the merge through with no question only when `autoMerge` is on, the pull request's base is the project's integration base, every required check passed, and — with `reviewBeforePush` on — the head commit has a recorded review ([The workflow](#the-workflow)). Every other case asks you, with the reason it asks; so does a `gh` that is missing, fails, or answers something it cannot read. In a project without `.claude/cc-smart-dev-kit.json` it stays silent, like every project hook. |
| `message-guard` | before SendMessage | Refuses a message to a session that works outside this repo (ListAgents lists every session on the machine). |
| `agent-guard` | before an Agent launch | **Machine-wide** (it runs with or without `.claude/cc-smart-dev-kit.json`): it resolves the model the launch really runs on and holds the model rules. A launch with no `model` or no `effort` is refused (it would inherit the session's, which nobody chose); `effort` `low` or `medium` is refused on every model, a Claude model and an affordable slot alike (a subagent runs at `high`, `xhigh` or `max` only); an affordable gateway slot needs `effort: "max"`, and only a slot key or a `<backend>:<model>` target counts as affordable — a name no rule knows (`best`, `opusplan`, `default`, …) is judged like Opus; Claude Opus is allowed for a review agent, and any other Opus launch needs an `Opus reason: <word>` line and asks you to approve it (in `claude -p`, with nobody to answer, it is refused; a review is not); Claude Fable only for a read-only agent with a `Fable reason: <word> - <why>` line, and Claude Code then asks you to approve each one. A fork runs on the session's model and needs no `model`; an unknown session model counts as Opus. A **Workflow** call is judged the same way, from the `agent(...)` options in its script — a launch whose `model` is built at run time is refused, never guessed, and a script that hands `agent` around (`const run = agent; run(…)`, `agent?.(…)`) or builds a call's options at run time (a `...spread`, a computed key) is refused whole — because (proved live) a workflow's agents run inside the tool and pass no hook of their own. Every Opus or Fable launch is recorded, and `cc-smart-dev-kit usage` lists them with why. |
| `job-route` | before a Bash command | With `"jobs": { "route": true }`: a heavy command (the project's own [kinds](docs/jobs.md#kinds)) is sent through the machine's queue — rewritten to `cc-smart-dev-kit job run --kind <kind> -- <command>`, byte for byte the same command. A command already inside `cc-smart-dev-kit job run` is left as it is. |
| `after-merge` | after `gh pr merge` | With `worktrees`: the steps to clear the worktree that was merged, and, for a merge into `worktrees.base`, the message to send the other sessions of the repo. |
| `worktree-leftovers` | a session starts | With `worktrees`: names the worktrees that are finished (every commit on `origin/<base>`, nothing uncommitted, no running session, idle for an hour) or whose folder is gone. It removes nothing. |
| `session-name` | a session starts; each prompt | With `sessionNames`: asks the session to name itself after its task, then sets that name at the next prompt. |

**A project that still has its own copy of a hook says so**: `ownHooks` in its
`.claude/cc-smart-dev-kit.json` lists the plugin hooks that copy replaces (`["git-guard"]`), and
exactly those plugin hooks stay silent there, so nothing runs twice. `agent-guard` is
machine-wide — it runs without cc-smart-dev-kit.json too — but it is in that list like the others,
so a project with its own Agent guard silences it the same way. Only that list counts:
a project hook on the same event that is not listed silences nothing, because it may be a
logger or a different check, and a guard that goes quiet for it would leave you unguarded.
`cc-smart-dev-kit doctor`, run in the project, prints one `·` line per listed hook, and warns (`!`)
about a listed hook with no project hook left to answer, and about a project hook running
next to a plugin hook the list does not name. When the project's `cc-smart-dev-kit.json` needs a
newer plugin, or is broken, the hooks fail closed: the guards ask before every call they
cover, and the message names the update command — and a hook listed in `ownHooks` stays
silent all the same.

### Notifications

Three more hooks are about your machine, not a project, so they run in every folder and no
`.claude/cc-smart-dev-kit.json` is needed for them to act: `notify` (the alerts below),
`stop-failure` (the usage-limit alert) and `update-check` (the background self-update, which
also brings the managed instructions copy up to a new plugin version at the first session
start). The first two do read a project's `workflow.alerts` settings when there is one
([The workflow](#the-workflow)): which moments alert, and whether a sound goes with them. A
settings file that cannot be read changes nothing — the alerts go on as always, with one line
on stderr saying why.

`notify` alerts you when Claude needs you, and when a turn ends or dies. One event, one
alert:

| When | The alert |
|---|---|
| a permission prompt, an MCP prompt, a background agent or worker waiting | `Claude needs you · <session>` |
| a question (`AskUserQuestion`) or a plan for your OK (`ExitPlanMode`) | `Claude asks you · <session>`, with the question |
| the turn ended | `Claude finished · <session>`, with the turn's last answer |
| the turn died on an error | `Claude stopped · <session>`, with the error |

`<session>` is the session's `/rename` name when it has one, else its folder. Questions need
a hook of their own: Claude Code raises no notification at the moment Claude asks. A few
waits stay quiet on purpose: the idle wait (the "finished" alert already announced that
turn), the permission prompt that follows a question about six seconds later (the same wait),
a "finished" alert for a turn another session started (a merge broadcast wakes every session
of a repo), the same error twice in a row (until a turn ends well), and a stop at the plan's
usage limit **where the `stop-failure` hook shows that alert itself** (a desktop, and the
gateway set up — never two alerts for one stop). Where that hook has no alert to show (no
desktop, no gateway), the stopped turn is this hook's alert like any other.

**A desktop** shows the alert through `notify-send` on Linux (it needs a desktop:
`DISPLAY` or `WAYLAND_DISPLAY`) or `osascript` on macOS, and plays the freedesktop sound
when `paplay` is installed. **An SSH session** with no desktop to show it on gets the same
alert in the terminal you are looking at, as an OSC 777 notification — no `notify-send`
needed on a server: Claude Code writes the sequence for the hook (2.1.141 or later, wrapped
for tmux itself), and for an event whose answer Claude Code does not read (the usage-limit
alert) the hook writes it to the terminal device Claude Code's own session is attached to.
**Inside Warp** Warp's own
Claude Code plugin shows a finished turn, a question, a permission prompt and an error
itself, so ours stays quiet and plays only the sound — except a question or a waiting agent,
which may sit in a tab you are not looking at: those stay ours. With no desktop, no SSH and
no Warp there is nowhere to show it, and nothing happens — not a failure.

**A Linux desktop gives the alert three more things, each where its tool is installed**
(`cc-smart-dev-kit doctor` names a missing one, as information, and without them the alert still
shows exactly as before):

| What | Needs | Without it |
|---|---|---|
| a click on the alert raises the session's terminal window (the terminal's own window id, or a VS Code or Warp window found by its name) | `xdotool`, and a notification that reports a click: `gdbus`, or a `notify-send` whose `--help` lists `--action` and `--wait` | the alert shows, and a click only closes it |
| the alert leaves the screen for the notification centre after a minute, and only one alert per session is on screen | `gdbus` (glib's `libglib2.0-bin`) | the alert stays until it is clicked or dismissed |
| an ordinary alert's sound stays off while XFCE's Do Not Disturb is on (an urgent one sounds anyway) | `xfconf-query` | the sound plays while Do Not Disturb is on |

The wait for a click runs in a small background process, never in Claude Code's way. The
window raise needs the installed launcher (`cc-smart-dev-kit setup`), and the alert is shown by
the notification server itself (`gdbus`) or `notify-send`; under Do Not Disturb the desktop
keeps an ordinary alert off the screen but in the centre, so it is never lost. One older
behaviour does not come over: picking the session's **tab** inside XFCE Terminal (that needs
the desktop's accessibility service, which this plugin does not carry) — the window comes to
the front, and the tab stays where it is.

One settings file, `~/.claude/cc-smart-dev-kit/notify.json` (both keys optional):

```json
{ "desktopSound": true, "sshBell": false }
```

`desktopSound` (default `true`) plays the freedesktop sound with a desktop notification.
`sshBell` (default `false`) sends a terminal bell after an SSH alert, for a terminal that
ignores the notification.

**tmux swallows a sequence written inside a pane**, so an alert from a session in a tmux
window reaches your terminal only through tmux's passthrough. `cc-smart-dev-kit setup` adds one line
to `~/.tmux.conf` when tmux is installed:

```
set -g allow-passthrough all
```

`all`, not `on`, so an alert from a window you are not looking at arrives too. A tmux server
that is already running keeps its own value: setup prints `tmux set -g allow-passthrough all`
to apply it now (a restart works too) and never changes the running server itself.
`cc-smart-dev-kit restore` takes the line out, and `doctor` says when it is missing or when the
running server does not pass alerts through. Without it, an alert still arrives in a
terminal that is not tmux, and a session in tmux gets none.

## The browser

Claude Code's browser tools (`mcp__playwright__*`) drive **your own Google Chrome**, through the
**Playwright extension**, in ONE profile of its own named **`claude-code`**. You watch the work in
that window, and you can take the page over.

Why your Chrome and not a browser of its own: you see what Claude does, you can sign in once in
that profile, and there is no second browser of ours to keep alive. The costs, both upstream and
neither planned to change:

- **Every connection brings the `claude-code` window to the front and switches its active tab**
  (microsoft/playwright#42343, closed as not planned). Nothing here can stop that.
- **The `claude-code` profile must hold the Playwright extension and nothing else.** A second
  extension that injects a frame into pages breaks the session (microsoft/playwright#43230, open).
  `doctor` names any other extension in that profile; `browser setup` says the same.
- **There is no headless mode.** A machine with no desktop cannot use the browser at all.

**The token is required, and there is no approval mode.** The extension normally asks you, in a
page, to approve every connection. The plugin never runs that way: `browser mcp` refuses to start
until the token is saved, and says which command adds it. The token is what the extension's status
page shows; it is generated inside the extension, stored in the profile's own extension storage, and
nothing outside Chrome can read it — that is why you copy it once, by hand:

1. `cc-smart-dev-kit browser setup` — it finds Chrome, makes the `claude-code` profile, opens the
   Playwright extension's page in it, and prints the steps.
2. In that window: **Add to Chrome**, then **Add extension**. That profile only.
3. Open `chrome://extensions/?id=mmlmfjhmonkocbjadbfplnigmagldckm` in that window (paste it: Chrome
   does not open `chrome://` addresses from a command line) and switch on **Allow access to file
   URLs** — without it the extension cannot open a local file.
4. Pin the extension, click its icon, and press **Copy** next to `PLAYWRIGHT_MCP_EXTENSION_TOKEN=…`
   — the button copies the whole line.
5. `cc-smart-dev-kit browser token` — paste it (it is not echoed), or use the portal's Browser card
   (`cc-smart-dev-kit portal`, § The portal). Then start a new Claude session.

`cc-smart-dev-kit setup` prints the same state and the same steps, and never reports the browser
ready while the token is missing; it is read-only there, so the one command that opens the window
is `browser setup`.

Where the token lives, and where it does not: `~/.config/cc-smart-dev-kit/playwright-extension.token`,
mode 600, readable by you alone; the launcher puts it in the Playwright MCP child's **environment**,
never in a command line (`argv` is world-readable in `/proc`) and never in `~/.claude.json`. No
command, page or log ever prints its value: the portal's Browser card shows a masked field and says
"a token is set".

A token that no longer matches the extension — you pressed "Generate new token", or reinstalled the
extension — does **not** fall back to the approval page: the extension answers the connect page with
*Invalid token provided.*, and the session's browser call then fails after the MCP's own 30-second
deadline with a message naming the profile and the variable. Copy the token again and run
`cc-smart-dev-kit browser token`.

- **Each session gets its own tab group** in that profile (`Playwright · claude-code`, then `(2)`,
  `(3)` … since Playwright v1.63), and sees only the tabs in it. A tab you drag out of the group is
  no longer Claude's.
- **Everything the browser saves** (screenshots, page snapshots, console and network logs,
  downloads) goes to `~/.local/share/cc-smart-dev-kit/playwright-output/`, kept under 200 MB by the
  MCP itself and readable by you alone. A file a session NAMES (`filename: "home-dark.png"`) too:
  the MCP resolves that against the folder it runs in — the project's own folder — so the
  `playwright-output` hook rewrites a relative name into that output folder first, and refuses a
  relative name with a `..` in it. A path a session gives in full is left as it is. The hook acts
  only while the live `playwright` server is the one setup registered.
- **`browser check`** proves all of it on your real Chrome: a connection with no approval page, a
  `file://` page, a screenshot the server names and one a caller names, an upload through the MCP's
  file-upload tool, a download, and `browser_close`. Run it when the browser misbehaves.
- **Nothing here is a second browser.** The plugin starts no Chrome of its own, keeps no profile of
  its own and never deletes one. The single thing it may write inside Chrome's own folder is the
  profile's **display name** in `Local State`, and only while no Chrome is running on that user data
  folder (`restore` puts that one name back; every other byte of that file is left as it is).
- **`cc-smart-dev-kit restore`** removes the token file and the pre-registration it added on macOS
  and Windows, and **never touches the `claude-code` profile or the extension** — those are your
  browser's data. It prints a line saying so.
- **The tool names stay `mcp__playwright__*`**: the server is registered for your user, not
  served from the plugin (a plugin-served server would rename every tool).

### Still owed: the live checks

Everything below needs a real Chrome with the real extension, so it is run by hand, on each
platform, and none of it has been run yet. The pinned `@playwright/mcp` is 0.0.83 and the Web
Store extension is 0.4.0 at the time of writing.

1. **Linux, end to end**: `browser setup`, the Web Store install in the `claude-code` profile,
   the token, then `browser check` — and it must pass with **no approval page** (that is the
   whole point of the token). Then two Claude sessions at once: each gets its own tab group
   (`Playwright · claude-code`, `(2)`), neither sees the other's tabs, and Chrome comes to the
   front when each connects. After a session lets go, its tab group stays behind.
2. **A wrong token**: generate a new token in the extension, keep the old one in the file, and
   run a browser call. Expected, from the source: the connect page shows *Invalid token
   provided.*, no approval page appears, and the call fails after about 30 s with the MCP's own
   message. Nothing should retry or open a second page.
3. **The token off disk**: whether the plugin could read `auth-token` out of the profile's
   `Local Storage/leveldb/` for a signed-in profile, and whether that survives a Chrome restart.
   If it does not, pasting stays the only way (which is what the guide says today). This is
   Playwright's own advice too: its tests read the token off the status page.
4. **Profile creation and naming**: `--profile-directory=claude-code --new-window <url>` making
   the profile folder while Chrome is ALREADY running on another profile; whether the window
   really opens in that profile; and the display name — the `Local State` write (Chrome closed)
   against Chrome's own **Customize profile** rename. Also whether Chrome opens a `chrome://`
   address given on a command line (the guide tells you to paste it, which works either way).
5. **The profile page, from a command line, per platform**: the exact `--profile-directory` and
   `--new-window` behaviour on macOS (a Chrome already running) and on Windows (Git Bash,
   PowerShell and `cmd` quoting of the guide's commands).
6. **`--output-dir` in extension mode is unproved**: `browser check` covers a screenshot the
   server names and one a caller names, an upload (`browser_file_upload`, with no picker bundle
   of ours any more) and a download — read the folder it reports each time.
7. **macOS**: the whole path, plus the per-user External Extensions JSON (`~/Library/Application
   Support/Google/Chrome/External Extensions/<id>.json`) and whether macOS 27 still honours it,
   and the Space switch side of the focus steal.
8. **Windows**: `%LOCALAPPDATA%\Google\Chrome\User Data\claude-code`, the HKCU
   `Software\Google\Chrome\Extensions\<id>` key and the Enable confirmation, and the
   `lockfile` question ("is Chrome running") — the same owed item as `docs/windows-setup.md` § 4.
9. **Chrome version drift**: the pin (0.0.83) against a NEWER Web Store extension than 0.4.0, and
   what `doctor` reads as its version then (`<profile>/Extensions/<id>/<version>/`).
10. **Edge** (`--browser=msedge`) if it is ever supported: Playwright maps a user data dir for it,
    but the plugin's own discovery and guide say Google Chrome only, and Brave/Chromium have no
    channel mapping at all.
11. **`doctor` must not open a page.** Its MCP check runs `claude mcp get playwright`, which starts
    the launcher once. With the token saved, the MCP must answer `initialize` and its tool list
    WITHOUT connecting to Chrome (the connect page is opened on the first browser call) — watch
    that no window comes to the front and no `connect.html` tab appears. Without a token the
    launcher exits before starting anything, which is why the check reports a failure then.

## MCP servers

`cc-smart-dev-kit setup` registers the general MCP servers at **user scope** with Claude Code's own
`claude mcp add-json --scope user`. A server served from a plugin gets a new tool-name prefix,
which would break every permission rule, hook matcher and agent tool list that names
`mcp__<server>__*`; a server from a project file or the "local" scope is stopped by Claude
Code as soon as the session's folder changes, and a session that works in a worktree moves
folders. Registered for the user, the names stay and the servers stay.

| Server | What it is |
|---|---|
| `playwright` | The browser ([The browser](#the-browser)): the launcher, `browser mcp`, on your own Chrome through the Playwright extension. |
| `serena` | [Serena](https://github.com/oraios/serena) code intelligence, at a pinned commit, started with the plugin's own context (installed as `~/.local/share/cc-smart-dev-kit/serena/contexts/worktree.yml`): Serena's `claude-code` context with project switching on, so `activate_project` is listed and a session can point Serena at its worktree. |
| `sequential-thinking` | `@modelcontextprotocol/server-sequential-thinking`, at a pinned version, through `bunx`. |
| `tavily-websearch` | [Tavily](https://tavily.com)'s remote web-search server (`https://mcp.tavily.com/mcp/`). Its key is **never** written into a registration or printed: the header carries `Bearer ${TAVILY_API_KEY}`, which Claude Code fills in from its own environment at connect time. |

- **The Tavily key**, in order: `TAVILY_API_KEY` in your environment (nothing for setup to
  do), else the key file `~/.claude/cc-smart-dev-kit/tavily.key` — **mode 600**, which setup
  copies into the `env` of your `settings.json` as a secret key cc-smart-dev-kit owns (masked in
  output, kept as a hash in `owned.json`, and the settings file left at mode 600). Without a
  key the server is skipped, and setup says so. A key file others can read, or an empty one,
  is refused with the command that fixes it — never with the key in it. When the key moves to
  your environment (or goes away), the copy setup wrote is removed with it, and a Tavily server
  setup had registered is taken back — never a stale registration left behind.
- Versions are **pinned** (`src/mcp/versions.ts`): a server started as `@latest` asks the
  registry on every session start and installs whatever was published a minute ago, and
  re-resolving a dependency tree makes the start slow enough to fail inside Claude Code's
  start limit. Moving a pin: change it here, run `cc-smart-dev-kit setup` again, restart Claude
  Code, and check `cc-smart-dev-kit doctor`.
- **A server of your own is never taken over.** One registered under one of these names that
  cc-smart-dev-kit did not write is left alone, with a note saying how to hand it back
  (`claude mcp remove <name> --scope user`, then setup). One setup wrote and you re-pointed
  since is yours too, and `restore` leaves it.
- **`restore` takes exactly those back**: each server that still holds what setup registered
  is removed (`claude mcp remove <name> --scope user`), the record goes
  (`~/.claude/cc-smart-dev-kit/mcp-servers.json`), and so do Serena's context file and the
  Tavily `env` key. A server you re-pointed — or removed yourself — stays, and setup says so
  with the exact command that adds it back (a server you removed is never registered again).
- `doctor` checks each one: registered at user scope, and it starts (`claude mcp get`, which
  starts it once). A server registered somewhere else — a project's `.mcp.json`, or the local
  scope — is a ✗ naming what wins over yours. No Tavily key is a `·` line, never a failure.
- **A project's own servers are the project's.** The plugin never knows them: they belong in
  that project's own configuration, where the project can keep them true.

## Sessions

A power cut or a closed terminal window loses the tabs and the running programs, never the
sessions: Claude Code writes every session to disk as it goes
(`~/.claude/projects/<folder>/<session id>.jsonl`), and `claude --resume <id>` brings one back
with its history. `cc-smart-dev-kit sessions` lists this project's sessions of the last two
days by name and worktree, with the command that resumes each, and saves one Warp tab per
session (Warp's "+" menu → `Claude · <name>`).

`cc-smart-dev-kit sessions --open` brings back the sessions that were **open when the machine
last went down, or when their window closed**, and that nobody has resumed since:

- a **power cut or a crash** kills a session: its file never gets Claude Code's end marker
  (`cost-state`). Such a session, last written shortly before the machine started, is
  reopened.
- a **clean shutdown** closes a session the same way `/exit` does, so the marker alone cannot
  tell. The time can: several sessions that closed in the same moment before the machine
  started were closed by the shutdown. One session alone looks exactly like `/exit`, and is
  left alone.
- a **closed window** closes its sessions the same way; there the sign is several sessions
  that closed together since the machine started.

On Linux without Warp, `--open` opens each session in an XFCE Terminal window of its own
(through `systemd-run --user` where there is one, so the window takes the desktop session's
environment and opens over SSH too). On Windows it opens a **Windows Terminal** window each
(`wt.exe`) where Warp is not there. A session already running is never opened again
(`~/.claude/sessions/<pid>.json` is how that is known), and one `--open` has just opened is
left alone for the next few minutes too (a marker in `~/.claude/cc-smart-dev-kit/` — a resumed
session takes a moment to write to its file, and a quick second run must not open a second
copy of it). With neither terminal it prints the resume command for each. `--dry-run` says
what it would open and opens nothing.

## Worktrees

A WorktreeCreate hook **replaces** Claude Code's own worktree creation, for sessions and
subagents, in every project where it is wired; a hook cannot step aside (proved live:
[docs/claude-code-contract.md](docs/claude-code-contract.md)). Claude Code's own creation
locks a worktree while a session uses it, marks it for its own cleanup, supports
`claude -w "#123"` (a pull request), and handles Git LFS; a hook does none of that. So the
plugin wires no worktree hook. **A project that wants cc-smart-dev-kit's worktrees turns the engine
on itself**, in two steps:

1. Give its `.claude/cc-smart-dev-kit.json` a `worktrees` field (§ A project's
   `.claude/cc-smart-dev-kit.json`).
2. Paste these hooks into its `.claude/settings.json`, and commit it (merge them with any
   `hooks` it has). `cc-smart-dev-kit hook` prints the same lines.

```json
{
  "hooks": {
    "WorktreeCreate": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "\"$HOME/.local/bin/cc-smart-dev-kit\" hook worktree-create",
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
            "command": "\"$HOME/.local/bin/cc-smart-dev-kit\" hook worktree-remove",
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
            "command": "\"$HOME/.local/bin/cc-smart-dev-kit\" hook subagent-stop",
            "timeout": 60
          }
        ]
      }
    ]
  }
}
```

Each line runs the launcher by its full path under `$HOME`, so it works for every
teammate who ran `cc-smart-dev-kit setup`, whatever the PATH Claude Code was started with (an IDE
or a desktop launcher may leave out `~/.local/bin`); the launcher runs the bun setup saved
in it. A teammate who never ran setup gets a failed worktree, and Claude Code shows why
(`cc-smart-dev-kit` not found, or the plugin not installed). Then, in that project:

| Hook | When | What it does |
|---|---|---|
| `worktree-create` | a worktree is made (`claude -w <name>`, EnterWorktree, a subagent) | A session's worktree: a folder beside the repo, `<prefix><name>` (a `/` becomes `-`), on the branch `<name>`, from the freshly fetched `origin/<base>` (or the existing branch), then your `setup` command inside. A worktree of that branch that exists is entered again, unless another running session works in it. One creation of a branch runs at a time (a lock in the repo's git folder): a second session asking for the same branch mid-create is refused with one clear line, and a lock whose process is gone is taken over. **A new branch needs `origin`**: the fetch is what makes it start from the latest base, so a repo with no remote refuses and says so (an existing branch is checked out all the same). A subagent's worktree: Claude Code's own shape, `.claude/worktrees/agent-<id>` on `worktree-agent-<id>`, from the remote's default branch (or `HEAD` with Claude Code's `worktree.baseRef: "head"`), with no setup. Both get the files `.worktreeinclude` names. |
| `worktree-remove` | Claude Code removes a worktree a hook made | Removes it only when nothing in it is uncommitted or untracked **and it holds no ignored file git does not keep** (an edited `.env.local`, a notes file, a key): those cannot come back, so the worktree is kept and the files are named. `node_modules`, build output, caches, and a `.worktreeinclude` copy nobody changed (the main checkout still has it, byte for byte) do not block. Then its branch, when every commit on it is also on another branch. Otherwise it keeps it and says why. Claude Code cannot check a worktree outside the repo, so `ExitWorktree` asks for `discard_changes: true` there; this hook still never discards work. |
| `subagent-stop` | a subagent ends | Removes its worktree and branch when it changed nothing (Claude Code keeps every worktree a hook made for a subagent). |

Wired without `worktrees` in `cc-smart-dev-kit.json`, or with a `cc-smart-dev-kit.json` that needs a newer
plugin or is broken, each of the three fails closed: no worktree is made or removed, and
the message says why. `cc-smart-dev-kit doctor`, run in the project, checks the wiring.

**A branch that belongs to another line of work starts from another base.** `worktrees.bases`
maps a branch-name prefix to the base a new worktree for such a branch starts from:
`{"hotfix/": "main", "release/": "main"}` makes every `release/…` branch start from the
freshly fetched `origin/main`, while a `fix/…` branch keeps starting from `worktrees.base`
(the integration base). The longest prefix that matches wins. So a released line of work
never inherits unreleased work from the integration base. The after-merge note names those
prefixes too: a session on such a branch is told **not** to merge the integration base in,
because that would ship unreleased work.

**A project that already runs its own worktree engine** sets `worktrees.engine` to `"own"`.
It then wires no `cc-smart-dev-kit hook` lines at all, and `cc-smart-dev-kit doctor` expects none
(one `·` line) instead of reporting ✗; it warns (`!`) when the plugin's engine hooks are
wired anyway next to another WorktreeCreate hook, because two hooks make two worktrees for
each request. Use it when the project has an engine of its own (its own script, or another
plugin) that makes its worktrees: cc-smart-dev-kit's after-merge and leftovers notes, the
`worktrees` command and the stash question all keep working, because they read
`worktrees.base` and never make a worktree.

**Moving from a project's own worktree hook:** replace its WorktreeCreate, WorktreeRemove
and SubagentStop lines with these, in one commit. Two WorktreeCreate hooks make two
worktrees for each request; `cc-smart-dev-kit doctor` reports a second one.

**A long job has a long timeout, and says what to do when it runs out:** `git worktree add`
gets 500 s, the `setup` inside 540 s (the hook's own timeout is 600 s), and
`git worktree remove` 50 s (that hook's is 60 s). On a timeout the message names the folder
and how to finish by hand (`git worktree remove --force <folder>`, after checking that it
holds nothing you need).

### Clearing the finished ones: `cc-smart-dev-kit worktrees`

`cc-smart-dev-kit worktrees` lists every worktree of the repo after fetching
`origin/<base>`, with what is left on each and which are finished. A worktree is **finished**
when removing it can lose nothing and disturb no one:

- no running Claude session works in it (`~/.claude/sessions/<pid>.json`);
- no program runs from inside it, and none works in it — a dev server started there is one;
- no Docker container, running or stopped, mounts files from inside it;
- every commit on it is on `origin/<base>`;
- git has not touched it for an hour (a worktree made a minute ago is not finished: its
  session has not moved into it yet);
- nothing in it is changed or untracked, and it holds no ignored file that cannot come back
  (an edited `.env.local`, a notes file, a key). Dependency folders, build output, caches and
  a file the main checkout still holds byte for byte do not block.

`--clean` removes the finished ones, with their branches (a branch goes only when every one
of its commits is on the base). `--remove <path>` removes one now — for a session that has
just finished in it, so without the one-hour wait. Both run in the main checkout only (a
session working in a worktree leaves it first) and one at a time; a second run says so and
does nothing. A worktree whose folder is gone is named, and `git worktree prune` forgets it.

**A worktree on a removable disk (a USB drive, a network share): lock it** —
`git worktree lock <folder>`. A LOCKED worktree is never taken, so a folder that is simply
not connected costs nothing. An UNLOCKED one whose folder is missing reads as gone, and
`--clean` prunes it (`git worktree prune` forgets it for good: when the disk comes back, git
sees an ordinary folder) and deletes its branch when the base holds every commit on it. Its
`forgot …` line says to lock it next time.

The base branch comes from the project's `cc-smart-dev-kit.json` `worktrees.base`; without that
file (or without the field) the remote's default branch (`origin/HEAD`), else `main`, with
one line saying which was used.

A session's own worktree is normally cleared by the session: the after-merge note after a
merge, and the SessionStart note when finished worktrees are left behind, both point at
`cc-smart-dev-kit worktrees --clean`.

## `project init`

`cc-smart-dev-kit project init` writes the two files a project opts in with, so nobody has to
copy them from this page:

- `.claude/cc-smart-dev-kit.json` — the project's settings (below);
- `.claude/settings.json` — the worktree engine's three hook lines (§ Worktrees), merged
  with whatever that file already wires. A project that runs an engine of its own
  (`"worktrees.engine": "own"`) gets none added, and the cc-smart-dev-kit lines an earlier
  run left there are **taken back out**: with both wired, two engines answer each worktree
  request (`doctor` flags exactly that).

It asks first and shows every default, which it reads from the repo: the base branch from
`origin/HEAD` — else the repo's only branch when it has one (a repo whose only branch is `dev`
works from `dev`, never from a `main` it does not have), else `main`, else `master`, else the
branch HEAD is on — the setup command from the lockfile
(`bun install`, `npm ci`, `pnpm install`, `yarn`), the worktree folder prefix from the
repo's name, the bases offered for `hotfix/` and `release/` from the default branch, and the
protected branches from the default branch and the base plus, when `gh` is installed and
answers, the branches GitHub protects (a read-only `gh api`; anything missing is skipped
quietly). Then it prints the file it will write with the changes line by line, the lines it
adds to (or takes out of) `.claude/settings.json`, and writes both — a backup first, in
`~/.claude/cc-smart-dev-kit/backups/`. **Nothing is committed:** commit the two files with the
project.

Every question has a flag, so it also runs without a terminal:

```sh
cc-smart-dev-kit project init --base dev --prefix my-app-wt- --setup "bun install" \
  --bases "hotfix/=main,release/=main" --protected "main,dev" \
  --guard-main-folder --session-names --engine plugin --workflow "openPr=draft"
```

`cc-smart-dev-kit project init --help` lists them all. With no terminal it writes nothing unless
`--yes` is given: it prints the plan and the line to run instead. `--dry-run` prints the plan
and writes nothing at all. Run it again on a project that has a file: it shows the diff and
asks, and `--yes` keeps every field the flags do not set. A `requires` the file already has
is never lowered (a project needing a newer plugin keeps its range); an older one is raised
to the plugin that wrote the file.

## The workflow

The workflow is what cc-smart-dev-kit may do **by itself** after a step is finished — commit
it, push the branch, open a pull request, merge it — and how. Two files hold the policy, and
the project's wins field by field:

1. **the project's** `workflow` object in `.claude/cc-smart-dev-kit.json`, committed with the
   code, so a team shares one policy;
2. **yours** in `~/.config/cc-smart-dev-kit/workflow.json` (mode 0600), this machine's defaults;
3. **the built-in default** under both — the safe one: nothing is committed, pushed or
   merged without you, and every alert is on.

`cc-smart-dev-kit workflow show` prints every value and where it came from:

```
your own defaults: ~/.config/cc-smart-dev-kit/workflow.json; a project's .claude/cc-smart-dev-kit.json wins field by field
autoCommit = false (default)
openPr = draft (project)
alerts.events = needs-you, question, finished, failed (default)
alerts.usagePercent = 85 (default)
switches.sessionNames = true (project)
```

| Setting | Default | What it means |
|---|---|---|
| `autoCommit` | `false` | Commit each finished, reviewed step without asking. |
| `autoPush` | `false` | Push the session's own branch. Never a protected branch: the git guard still asks there. |
| `openPr` | `"off"` | Open a pull request for the branch: `"off"`, `"draft"` or `"ready"`. |
| `autoMerge` | `false` | Merge into the project's integration base, after CI is green and the review is done. |
| `mergeMethod` | `"merge"` | `"merge"`, `"squash"` or `"rebase"`. |
| `deleteBranch` | `false` | Delete the branch after its merge. |
| `reviewBeforePush` | `true` | Run the review before a push. |
| `clearWorktreeAfterMerge` | `false` | Clear the worktree once its pull request merged. |
| `alerts.events` | all four | Which moments alert: `needs-you`, `question`, `finished`, `failed`. |
| `alerts.sound` | `false` | A sound with the alert. |
| `alerts.usagePercent` | `85` | The plan usage, in percent, a warning starts at (1–100). |

**Auto-merge is the strictest one.** Even with `autoMerge` on, cc-smart-dev-kit merges by
itself only when the pull request's base **is** the project's integration base
(`worktrees.base`), and that base is a plain one:

- never when it is the repository's default branch (`main`): merging there is a release,
  and that is your decision;
- never when it is a target of `worktrees.bases` (a `release/` family feeding it): then it
  is not a plain integration base;
- the integration base may itself be listed in `protectedBranches` — it is the one branch
  this may write to, and the git guard still asks about a push of it by hand. Every other
  protected branch is never a target here: the pull request's base must be the integration
  base, so those keep asking you.

`autoMerge` says only that a merge **may** happen by itself once the branches are right. That
CI is green and the review is done is the caller's check (the merge guard hook), and
`mergeMethod` and `deleteBranch` say how the merge is made, not that it skips a question.

**Two things follow a setting: a hook, or the instructions.**

| Setting | What follows it |
|---|---|
| `autoCommit`, `autoPush`, `openPr`, `clearWorktreeAfterMerge` | the instructions: the commit and worktree skills read `cc-smart-dev-kit workflow show` and follow it. |
| `autoMerge` (with `mergeMethod`, `deleteBranch`) | the **merge guard hook**, which asks you before a `gh pr merge` its rules do not allow (§ The hooks). |
| `reviewBeforePush` | both: the review skill records the review (§ below), and the merge guard asks about a merge whose head commit has no record. |
| `alerts.events`, `alerts.sound` | the two alert hooks, `notify` and `stop-failure` (§ Notifications). |
| `alerts.usagePercent` | the status line: from that share of a plan window it warns. |

**The review record.** `cc-smart-dev-kit workflow review-done [--sha <commit>]` records that the
change set up to a commit (default `HEAD`) had its one premium review and its fixes. It is one
small JSON file per repository under `~/.claude/cc-smart-dev-kit/reviews/` (mode 0600), and
`cc-smart-dev-kit workflow show` prints whether the commit here has a record. With
`reviewBeforePush` on, the merge guard reads that record for the pull request's head commit: no
record, and the merge asks you.

**The alert settings**, read by `notify`, `stop-failure` and the status line:

| Setting | What it does |
|---|---|
| `alerts.events` | Which moments alert: `needs-you` (a permission prompt, an MCP prompt, a background agent waiting), `question` (a question, or a plan for your OK), `finished` (a turn ended), `failed` (a turn died). A moment left out is silence, on every route. |
| `alerts.sound` | A sound with the alert where the platform has one: Linux's freedesktop sound through `paplay` (else `canberra-gtk-play`), a system sound through `afplay` on macOS, the toast's own sound on Windows, a terminal bell over SSH. Off by default; `notify.json`'s own `desktopSound` and `sshBell` keep working beside it. |
| `alerts.usagePercent` | The plan usage, in percent, a warning starts at (85 by default) — the status line's `⚠`. |

**The switches** (`switches.*`) are not stored anywhere: each one reads and writes the
setting that already exists, so there is only one truth for it.

| Switch | The setting behind it |
|---|---|
| `switches.statusLine` | Claude Code's own `statusLine` key, the one `setup --statusline` writes. A status line someone else set is never overwritten, and reads as off. |
| `switches.sessionNames` | The project's `sessionNames` field. |
| `switches.jobRoute` | The project's `jobs.route` field. |
| `switches.updateHold` | The hold file behind `cc-smart-dev-kit update --hold`. |

`set` and `unset` write one value, and say where:

```sh
cc-smart-dev-kit workflow set autoCommit true                 # your own defaults
cc-smart-dev-kit workflow set openPr draft --project          # the project's committed file
cc-smart-dev-kit workflow unset alerts.sound                  # back to the default
cc-smart-dev-kit workflow set switches.sessionNames true --project
cc-smart-dev-kit workflow set switches.updateHold true
```

A switch is written where it really lives, so `switches.sessionNames` and
`switches.jobRoute` need `--project`, and `switches.statusLine` and `switches.updateHold`
refuse it (they are yours, per machine). A value of the wrong kind, or a setting that is not
one of the settings there are, is refused before anything is written; a file that is not
valid JSON is named, never rewritten.

## A project's `.claude/cc-smart-dev-kit.json`

`cc-smart-dev-kit project init` (§ [`project init`](#project-init)) writes this file and asks
every question it holds.

```json
{
  "requires": ">=0.1",
  "worktrees": {
    "base": "main",
    "prefix": "app-wt-",
    "setup": ["bun", "install"],
    "guardMainFolder": true,
    "bases": { "hotfix/": "main", "release/": "main" },
    "engine": "plugin"
  },
  "protectedBranches": ["main"],
  "sessionNames": true,
  "ownHooks": ["git-guard"],
  "instructions": true,
  "autoMode": ["In my-app: never touch production."],
  "jobs": { "kinds": { "e2e": { "gb": 4, "match": [{ "script": "test:e2e" }] } }, "route": true },
  "workflow": { "openPr": "draft", "autoMerge": true }
}
```

| Field | What it does |
|---|---|
| `requires` | The plugin versions this project needs, as a version range (npm syntax). Checked first: a project needing a newer plugin is told to update, not that a field is unknown. |
| `worktrees` | Turns on the hooks that work with worktrees (the after-merge and leftovers notes, the stash question), and is what the worktree engine needs once the project wires it (§ Worktrees). |
| `worktrees.base` | The branch a new worktree starts from (`origin/<base>`, fetched first). |
| `worktrees.prefix` | The folder-name prefix of a worktree beside the repo (no `/`). |
| `worktrees.setup` | A command run inside a new worktree, as a list of words (`["bun", "install"]`). Its output goes to the hook's log, not to Claude. When it fails, the worktree stays and the next request for it runs the setup again. |
| `worktrees.guardMainFolder` | `true`: refuse edits in the main checkout itself. Off when left out. |
| `worktrees.bases` | A branch-name prefix (ending in `/`) to the base a new worktree for such a branch starts from (`{"hotfix/": "main", "release/": "main"}`). The longest prefix that matches wins; every other branch starts from `base` (§ Worktrees). |
| `worktrees.engine` | `"plugin"` (the default): the project wires cc-smart-dev-kit's worktree engine. `"own"`: it runs an engine of its own, so `doctor` expects no cc-smart-dev-kit hook lines (§ Worktrees). |
| `protectedBranches` | The branches the git guard asks about before a push. Default `["main"]`. |
| `sessionNames` | `true`: each session names itself after its task. Off when left out. |
| `ownHooks` | The plugin hooks this project still runs as its own copy (in its own settings): exactly those stay silent here, so nothing runs twice. `["git-guard"]` while the project still has its own git guard; empty it once that copy is gone (§ The hooks). |
| `instructions` | Accepted now. Today a project loads the opt-in instructions with its own import line (§ Instructions, skills and agents); the field does not load them yet. |
| `autoMode` | Used now: `setup` copies it into your settings ([The auto-mode block](#the-auto-mode-block)). |
| `jobs.kinds` | Used now: the project's own heavy-job kinds over the defaults ([docs/jobs.md](docs/jobs.md) § Kinds). |
| `jobs.route` | `true`: the `job-route` hook sends a heavy Bash command through `cc-smart-dev-kit job run` instead of running it raw (§ The hooks). Off when left out. |
| `workflow` | This project's [workflow](#the-workflow) policy, over your own defaults: what cc-smart-dev-kit may do by itself here. Each field is optional, and the project's value wins field by field. |

`requires` is a version range (npm syntax). When the installed plugin is outside it, the
plugin says so and asks you to run `claude plugin update cc-smart-dev-kit@cc-smart-dev-kit`. A project that
uses a field raises its `requires` to the release that brought the field.

## Develop

See `.claude/CLAUDE.md`. In short: `bun install`, change `src/`, `bun run build`,
`bun run check`, and commit `plugin/dist` with the change.

## Docs

- [Design](docs/design.md): how the parts fit, and why.
- [The AI gateway](docs/gateway.md): the router, its slots, and the judge.
- [Web search](docs/search.md): `cc-smart-dev-kit search`, its cost and its limits.
- [Roadmap](docs/roadmap.md): the phases, done and ahead.
- [Heavy jobs](docs/jobs.md): the machine-wide queue, its kinds, config and limits.
- [Claude Code contract](docs/claude-code-contract.md): the Claude Code behaviour the
  plugin relies on, and the version it was last proved on.
- Windows: [setup](docs/windows-setup.md), [hooks](docs/windows-hooks.md),
  [notifications](docs/windows-notify.md), [heavy jobs](docs/windows-jobs.md),
  [the gateway](docs/windows-gateway.md) ([Windows](#windows) above).
