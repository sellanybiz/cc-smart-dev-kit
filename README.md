# cc-smart-dev-kit

`cc-smart-dev-kit` lets a person use any model with Claude Code. It is a plugin anyone can
install: a local AI gateway, hooks, skills, agents, and the `cc-smart-dev-kit` command, which sets
up and checks a machine. Nothing in it is tied to one project. A project opts in, and sets its own details, in its own
`.claude/cc-smart-dev-kit.json`.

This repo is also the plugin's marketplace (a list of plugins Claude Code can install
from), named `cc-smart-dev-kit`.

## Install

**One command installs the plugin.** In the lines below, `<owner>/cc-smart-dev-kit` is the
repository, and it is the script's argument (the script names no owner: the `repository` field
of `plugin/.claude-plugin/plugin.json` is where the plugin reads its own).

**macOS, Linux and Git Bash.** This repo is private, so start it with `gh`, which sends the
script's own bytes down the pipe:

```sh
gh api repos/<owner>/cc-smart-dev-kit/contents/install.sh -H "Accept: application/vnd.github.raw" | bash -s -- <owner>/cc-smart-dev-kit
```

A public fork can be installed from the raw URL instead:

```sh
curl -fsSL https://raw.githubusercontent.com/<owner>/cc-smart-dev-kit/main/install.sh | bash -s -- <owner>/cc-smart-dev-kit
```

**Windows.** Native Windows (not WSL) uses `install.ps1`, for PowerShell 5.1 and `pwsh`, with
the same steps, the same words and the same exit codes. It is downloaded to a temp file and
run as **that file**, so the exit codes are real and a refusal never closes your window:

```powershell
$f = Join-Path $env:TEMP "cc-smart-dev-kit-install.ps1"
gh api repos/<owner>/cc-smart-dev-kit/contents/install.ps1 -H "Accept: application/vnd.github.raw" | Set-Content -Path $f
powershell -NoProfile -ExecutionPolicy Bypass -File $f <owner>/cc-smart-dev-kit
Remove-Item $f
```

```powershell
$f = Join-Path $env:TEMP "cc-smart-dev-kit-install.ps1"
irm https://raw.githubusercontent.com/<owner>/cc-smart-dev-kit/main/install.ps1 | Set-Content -Path $f
powershell -NoProfile -ExecutionPolicy Bypass -File $f <owner>/cc-smart-dev-kit
Remove-Item $f
```

(`pwsh -File` in place of `powershell -File` runs the same file under PowerShell 7. From a
folder with the script in it, `powershell -NoProfile -ExecutionPolicy Bypass -File
.\install.ps1 <owner>/cc-smart-dev-kit` is the same run.)

The installer does the whole install, in order: it checks the machine, installs or upgrades
[Bun](https://bun.sh) 1.4.3 or later when it is missing or older, adds the three marketplaces,
installs the plugin, runs `migrate` and then `setup` (the move is a no-op on a machine without
the old names), asks for the three things only you have — the browser's token, the gateway's
key, the Tavily key — and ends with `doctor` (it reads its `--json` report) and, when something
is left, the list of what is left: each item the run skipped, and each of doctor's failures with
its `Fix:` line. It asks before it installs or upgrades anything, it prints the exact command that retries
a step that failed, and running it again goes on from there.

- **Run it in your own terminal.** Every question reads the terminal, never the pipe the
  script arrived on, and the installer refuses to run inside a Claude Code session: it may
  replace the router that session's own model traffic goes through.
- **The gateway.** The installer asks `cc-smart-dev-kit gateway check` first — a read-only
  question — and asks for a key only when the gateway needs one: no config, no OmniRoute key
  yet, or a key OmniRoute refuses (HTTP 401/403). Two different secrets can be asked for:
  - **no key yet**, and OmniRoute answers on this machine: your **OmniRoute dashboard password**
    (the one you log in with; not stored, never shown). `gateway setup` makes the router's key
    in OmniRoute itself, tests it and saves it.
  - **a key OmniRoute refuses** (or one you want to replace): **the OmniRoute API key the router
    uses — OmniRoute's own dashboard, its API keys page — not your Ollama key.** OmniRoute
    refuses a provider key with HTTP 401, so a wrong paste is refused, keeps the key already in
    the file, says why, and the question comes once more.
  A key that cannot be checked (OmniRoute not running, a 5xx) is saved with a warning, never
  silently. With no OmniRoute at all, nothing is asked and the gateway goes on the list at the end.
- **An MCP server of yours.** If one of the plugin's three server names (`playwright`,
  `sequential-thinking`, `tavily-websearch`) is registered at user scope by something else — a
  project's own script, say — setup leaves it alone, as it must. The installer then shows what
  runs instead and asks whether to replace it, one server at a time. A yes runs
  `claude mcp remove <name> --scope user` and then setup again, so the plugin's own server is
  registered **with its record** (the record is what lets `restore` take it back); a no lists it
  under "What is left" with the exact command.
- **The Tavily key is not asked for when you have one**: `TAVILY_API_KEY` in your environment,
  the key file setup reads, or the key already in your settings — one line says which it is
  using, and nothing is written.
- **It needs GitHub.** Before it compares any version it refreshes
  Claude Code's own copy of the marketplace (`claude plugin marketplace update`), which fetches
  from the repository — without that, "is the plugin up to date?" compares two stale numbers.
  Offline, that step fails: the installer **stops** with the line `✗ refreshing the
  cc-smart-dev-kit marketplace failed` and the exact command that retries it, and running it
  again goes on from there once the network is back. (The Bun step's `curl`, the
  `claude plugin …` steps and `git` all need the network too.)
- **It needs GitHub through your own account.** Claude Code adds a marketplace over ssh by
  default: on a machine with no GitHub SSH key (or a blocked port 22) the installer adds that
  source over HTTPS instead, says so in one line, and goes on — the marketplace's name comes
  from the repository's own marketplace file, so it lands under the same name either way. And
  before it adds anything, when `gh` is installed and logged in, it asks
  `gh repo view <owner>/cc-smart-dev-kit --json name`: an account that cannot read the
  repository stops the run (exit 1) with the account (`gh api user --jq .login`), the line
  "ask the repository's owner for read access", and the invitation page
  `https://github.com/<owner>/cc-smart-dev-kit/invitations`.
- `--dry-run` (`-DryRun` on Windows) prints the plan for this machine and changes nothing —
  no command that writes, no network.
- It never writes a secret file and never puts a secret on a command line: each key goes to
  the plugin's own command on stdin, and that command owns the file.
- Exit codes:

  | Code | What it means |
  |---|---|
  | 0 | done: every step the installer ran succeeded, and `doctor` is all ✓ |
  | 3 | installed, with items left: `doctor` shows ✗ (the browser's token was skipped, say) — the list at the end names each item and the line that finishes it |
  | 1 | a step failed: the line names the exact command that retries it (or, for a repository the account cannot read, the access its owner must grant) |
  | 2 | refused: inside a Claude Code session, a question answered no, or no terminal to ask on |

What you need first: macOS, Linux or Windows (native Windows; the parts that are `sh`
scripts run through Git Bash there — [Windows](#windows)),
[Claude Code](https://code.claude.com) on your PATH, and read access to this repo with git —
an SSH key, or a git credential helper when the repo is private (`gh auth login`, then
`gh auth setup-git`); with no SSH key the installer adds the marketplace over HTTPS instead, and
it stops early when the GitHub account it finds cannot read the repository. The installer checks
all three and says how to fix what is missing.
Bun is the one thing it installs for you, after asking.

**[Bun](https://bun.sh) 1.4.3 or later** is needed by everything the plugin runs — the
by-hand steps below and the plugin itself. An older Bun would send a backend's key through
a proxy and would ignore the flags that keep a project's `.env` files and `bunfig.toml` out
of the plugin, so on one only `doctor`, `restore`, `version` and `--help` run, and the hooks
do not run at all: the hook shim stops before starting one.

### By hand

The same install, step by step, for a machine where you would rather run it yourself — the
installer above is the same thing with the checks, the questions and the retries built in.
You need [Bun](https://bun.sh) **1.4.3 or later** first (`bun --version`; `curl -fsSL
https://bun.sh/install | bash`, or Bun's PowerShell installer on Windows), because every
step below runs the plugin through it.

1. Add the marketplace. `<owner>/cc-smart-dev-kit` is where this repo lives: the `repository`
   field of `plugin/.claude-plugin/plugin.json`. Add the marketplaces of the two
   companion plugins too (see [Companion plugins](#companion-plugins)):

   ```sh
   claude plugin marketplace add <owner>/cc-smart-dev-kit
   claude plugin marketplace add thedotmack/claude-mem
   claude plugin marketplace add anthropics/claude-plugins-official
   ```

   (refused over ssh on a machine with no GitHub SSH key: add
   `https://github.com/<owner>/cc-smart-dev-kit.git` instead)

2. Install the plugin for your user. Claude Code installs the companions with it:

   ```sh
   claude plugin install cc-smart-dev-kit@cc-smart-dev-kit
   ```

   Skipped the two companion marketplaces? The install still succeeds, with a warning
   that cc-smart-dev-kit will not load without them. The setup in step 3 adds them, and that
   installs the companions.

3. Run the first setup. The `cc-smart-dev-kit` command does not exist yet, so run the copy
   that Claude Code installed. Paste the one line for your platform: it finds the newest
   installed version by itself.

   On macOS, Linux and Git Bash:

   ```sh
   d="$HOME/.claude/plugins/cache/cc-smart-dev-kit/cc-smart-dev-kit"; v="$(ls "$d" | sort -t. -k1,1n -k2,2n -k3,3n | tail -n1)"; bun --no-env-file --config="$d/$v/bunfig.toml" "$d/$v/dist/cli.js" setup
   ```

   On native Windows, in PowerShell 5.1 or `pwsh`:

   ```powershell
   $d = Join-Path $env:USERPROFILE ".claude\plugins\cache\cc-smart-dev-kit\cc-smart-dev-kit"; $v = (Get-ChildItem $d -Directory | Sort-Object { [version]($_.Name -replace "-.*$", "") } | Select-Object -Last 1).Name; bun --no-env-file --config="$d\$v\bunfig.toml" "$d\$v\dist\cli.js" setup
   ```

   Each line finds the newest version in its own way. In the `sh` line, `ls` lists the
   installed versions, `sort -t. -k1,1n -k2,2n -k3,3n` puts them in version order — `0.5.0`,
   then `0.9.0`, then `0.10.0` — and `tail -n1` takes the newest. In the PowerShell line,
   `Get-ChildItem` lists the version folders, `Sort-Object` orders them by version number, and
   `Select-Object -Last 1` takes the newest.

   Both flags matter: Bun adds the `.env` files of the folder you run the command from and
   reads its `bunfig.toml`, so without them a project's `.env.local` (its `TAVILY_API_KEY`,
   say) or a project's `preload` would reach setup. The launcher,
   `plugin/bin/cc-smart-dev-kit` and the hooks' bun shim all pass both for the same reason.
   The bundle path is the newest version's own folder (`$d/$v/dist/cli.js` on macOS, Linux and
   Git Bash; `$d\$v\dist\cli.js` on Windows) and the empty config sits beside it, so a later
   version ships its own.

   Setup installs the launcher `~/.local/bin/cc-smart-dev-kit`, turns Claude Code's own plugin
   auto-update off (the kit updates itself, below), registers the MCP servers for your user ([MCP servers](#mcp-servers)), installs
   the plugin's general instructions for Claude (§ Instructions, skills
   and agents), adds any companion marketplace that is missing, and says whether the
   [browser](#the-browser) is ready (the browser needs the Playwright extension in a Chrome
   profile of its own, and its token). Add
   `--dry-run` to see the changes first; it writes and runs nothing at all. Add
   `--no-instructions` to leave the instructions out (setup remembers that choice).

   Setup's report has a section per part (the command, Claude Code's settings, the
   instructions, the companion plugins, the MCP servers, the browser, your projects, the
   terminal), each change one line with its mark (`+` created, `~` changed, `-` removed, `$` a
   command), then one verdict line, then **Next steps**: what to run now, in order — the line
   that puts `~/.local/bin` on your PATH (for your shell) when it is not there yet,
   `cc-smart-dev-kit browser setup` while the browser's steps are open, and a new Claude Code
   session after a change.

4. Do the next steps setup printed: `cc-smart-dev-kit browser setup` walks you through the
   browser's steps ([The browser](#the-browser)); without the token, the browser tools do not
   work. Then restart Claude Code.

After that, use `cc-smart-dev-kit setup` to set up again (for example after an update).

## What it does

| Part | What you get |
|---|---|
| The `cc-smart-dev-kit` command | Sets a machine up, checks it, updates it and takes it back out: [Install](#install), [Commands](#commands), [`doctor`](#doctor), `restore`. |
| The AI gateway (optional) | A local router that sends each Claude model family's work to the models you choose, with a fallback, a breaker and a tested judge: [The AI gateway](#the-ai-gateway-optional). |
| The portal | A page on this machine with the same facts and actions as the commands, always up with your sessions: [The portal](#the-portal). |
| The hooks and guards | Small programs at the moments that matter: a guard before a git push, a merge, an agent launch or an edit of your settings; the notifier; the self-update: [The hooks](#the-hooks). |
| The browser | Claude Code's browser tools on **your own** Google Chrome, in a profile of its own: [The browser](#the-browser). |
| MCP servers | `playwright`, `sequential-thinking` and `tavily-websearch`, registered for your user: [MCP servers](#mcp-servers). |
| The heavy-job queue | One queue for the machine's type checks, lints, tests and builds, so they do not run all at once: [Heavy jobs](#heavy-jobs-one-queue-for-the-machine). |
| The crew | A lead session that starts background crew sessions for a plan's phases, each in its own worktree, and merges their branches: [The workflow](#the-workflow). |
| Worktrees and sessions | Claude Code's own worktrees, a command that clears the finished ones, and one that brings a session back: [Worktrees](#worktrees), [Sessions](#sessions). |

## Release notes

What each release changed — the "What's new" an update message points you to — is in
[CHANGELOG.md](CHANGELOG.md), newest first. This version is **1.1.0**: the portal, crew caps
per lead, and a verification gate.

## Older versions

The removals and migrations an upgrade still acts on. Everything else about an older release
is in [CHANGELOG.md](CHANGELOG.md).

### 0.6.0: Serena is removed

The plugin no longer registers the Serena MCP server. `cc-smart-dev-kit setup` takes back what
an older setup made for it; a Serena of your own stays. When it ran, why it went, and what to
remove by hand: [CHANGELOG.md](CHANGELOG.md) § 0.6.0: Serena is removed.

### Anymodel (0.2.x): the old names

[Moving from anymodel](#moving-from-anymodel), and [docs/migrate.md](docs/migrate.md) for a
machine and for a project.

## Windows

The plugin runs on **native Windows** (not WSL). What it does there, and where Windows
differs:

| Part | On Windows |
|---|---|
| The `sh` parts | Need **Git Bash** (Git for Windows): Claude Code runs a shell-form hook and the Bash tool through it, and the plugin's own hooks are `sh` scripts. `doctor` finds it, or says `✗ Git Bash was not found`. |
| The installer | [`install.ps1`](#install) for PowerShell 5.1 and `pwsh`: the same steps and the same words as `install.sh`, with `-DryRun` in place of `--dry-run`. What it installs needs Git Bash (the row above). |
| The launcher | `~/.local/bin/cc-smart-dev-kit` for Git Bash, and `cc-smart-dev-kit.cmd` beside it for `cmd` and PowerShell. `setup` writes both. |
| Every path | The same layout as Linux and macOS, under `%USERPROFILE%` (`%USERPROFILE%\.claude`, `…\.local\share\cc-smart-dev-kit`, `…\.config\cc-smart-dev-kit`). |
| The gateway | A per-user **Scheduled Task** instead of the systemd units. A restart refuses requests for a moment (Claude Code retries them), and a stop cuts the answers in flight. |
| The heavy-job queue | Runs each job as a plain child, with no memory ceiling, and reads the free memory Windows reports. |
| The crew | Works: `claude` is found as `claude.exe` or npm's `claude.cmd` (a `.cmd` runs through `cmd.exe`), and a command's session comes from PowerShell's process list. A crew session's memory is the one Linux-only figure: the board shows `-`. |
| The guards | Work through Git Bash. The shell judge (`job-route`) is wired on **Bash and PowerShell** and reads each in its own dialect; its queue rewrite stays Bash-only. |
| The background clean | Works: the detached clean goes through `cmd /c start` so it outlives the hook, with no console window. |
| The plugin's monitors | The commands are `$HOME` shell lines, so they need Git Bash. That Claude Code starts a monitor with Git Bash on Windows is the one live check owed (`docs/windows-setup.md`). |
| Notifications | A desktop toast through PowerShell (Windows plays the toast's own sound); the terminal route is Claude Code's own. |
| `sessions --open` | Warp tabs where Warp is there, else a Windows Terminal window each. |

Five pages say how, and what still has to be tested there:

- [docs/windows-setup.md](docs/windows-setup.md): the folders, the `.cmd` launcher, file modes
  vs the profile's ACL, Git Bash, a row per 1.0.0 part, and **the owner's six-step checklist**
  for a real Windows PC (the installer one-liner, `doctor`, a normal session, the gateway, a
  small crew session, the portal).
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

### Setup, updates and reports

| Command | What it does |
|---|---|
| `cc-smart-dev-kit setup` | Installs and refreshes everything it owns — the launcher, the instructions, the companions, the MCP servers, the tmux line, claude-mem's keys and the auto-mode entries — and prints a section per part, then the next steps in order. Every question comes first. Full text: [below](#cc-smart-dev-kit-setup). |
| `cc-smart-dev-kit setup --no-instructions` | Takes the instructions' block and copy out and **keeps them out**: setup stores the choice (`~/.claude/cc-smart-dev-kit/no-instructions`), so a later plain `cc-smart-dev-kit setup` leaves them out too. `--instructions` clears that choice and installs them again. `restore` clears it as well. |
| `cc-smart-dev-kit setup --yes` | On a terminal: the same, and writes the auto-mode entries without asking (they are still shown). With no terminal, they are left out, also with `--yes`. |
| `cc-smart-dev-kit setup --project <dir>` | Reads the auto-mode entries from the project in `<dir>`, not from the folder you are in. |
| `cc-smart-dev-kit setup --warp` | Also installs the Warp terminal, then its Claude plugin. The commands are shown first and asked; `sudo` asks for your password. |
| `cc-smart-dev-kit setup --remove-warp` | Removes the Warp terminal, its package source and key, your Warp shortcuts and its Claude plugin. Shown and asked first. |
| `cc-smart-dev-kit setup --tavily-key-stdin` | Takes the Tavily key on **stdin** (never an argument: a command line is readable in `/proc` and lands in the shell's history), writes it to the key file `~/.claude/cc-smart-dev-kit/tavily.key` (mode 600, atomically) and then treats it as a key from that file, so a later setup keeps it. An empty stdin is refused. This is the [installer](#install)'s way in for the key. |
| `cc-smart-dev-kit setup --statusline` | Also sets Claude Code's status line to `cc-smart-dev-kit statusline`, as a key cc-smart-dev-kit owns, without asking (also after an earlier "no"). It never replaces a status line you set: one you set yourself, also after setup had set it, stops setup before it writes anything, and `restore` leaves it. |
| `cc-smart-dev-kit setup --retry-watchdog` | Turns on [Claude Code's retry watchdog](#waiting-at-a-limit-claude-codes-retry-watchdog) now, also after an earlier "no": three keys under `env` in `settings.json` (the watchdog, its recheck, and the 24-hour cap), owned by cc-smart-dev-kit. It is on by default, so a plain setup needs no flag. A value you set yourself is never overwritten: a different one stops setup before it writes anything; the same one is named and left alone. |
| `cc-smart-dev-kit setup --no-retry-watchdog` | Takes cc-smart-dev-kit's three keys out again and remembers it as a "no" (`~/.claude/cc-smart-dev-kit/retry-watchdog-declined`), so a later plain setup leaves them out. A key you wrote yourself is not touched. |
| `cc-smart-dev-kit usage [--hours <n>] [--project <folder or name>] [--json]` | Which models answered on this machine, per session, from Claude Code's transcripts: the main session's replies by model, and apart, its subagents (how each was launched, the model of each reply, the share on Opus). Each subagent's own record adds its type, its replies by model, its input/output/cache tokens and an estimated cost (Claude's list price; a backend whose price is unknown is counted with no cost). A removed crew session's conversation, which the kit moves to its crew archive (see `crew rm`), still counts, and its line says so. Default: the last 6 hours. It also shows auto mode's safety checks, which the gateway's router counted, by day, with the tokens each answer reported (below). `--json` prints the same facts as one object. Read only; no message text. |
| `cc-smart-dev-kit report [--hours <n> \| --days <n>] [--project <folder or name>] [--session <id>] [--json]` | What this machine's Claude Code sessions did in the window (default: the last 7 days; at most 8): per session, the time Claude Code timed for its turns, agent launches and the parallel share, the minutes blocked on permission prompts and which guard asked, the questions, the waits on background work, the idle time until the person wrote, the compactions, auto-mode's blocks by rule, and the merges that asked — then the totals, every prompt's cause, and the calls waiting on you now. Read only; no message text. A prompt's wait is an upper bound: from the tool call's line to the person's answer. `--json` prints the whole report. |
| `cc-smart-dev-kit mcp status [--json]` | Read-only: the three MCP servers cc-smart-dev-kit registers for your user, and which of them are registered by something else instead (a project's own script, say). One line each, naming what runs instead (the command and its arguments — never an `env` or a `headers`), or `--json` for a script. Exit 1 means Claude Code's own config could not be read, so "nothing is foreign" and "could not check" are never confused. The [installer](#install) asks with it before it replaces one of yours; `doctor` warns from the same facts. |
| `cc-smart-dev-kit doctor [--verbose] [--json] [--live]` | Checks the install, the cc-smart-dev-kit files the current project's `CLAUDE.md` imports, and the project of the folder you run it in (the list is below), in groups. A group that passed shows one line; a group with a ✗ or a `!` shows every line, and each ✗ has a `Fix:` line under it. `·` is information and `!` a warning (neither is a failure). The last line is the verdict, and the exit code is 1 when a check fails. `--verbose` opens every group; `--json` prints the whole report for a program (the installers read it). `--live` also proves the hooks and Claude Code's own worktrees on the Claude Code installed here (below); it never runs without the flag. |
| `cc-smart-dev-kit restore [--yes] [--now]` | Removes what setup added and keeps everything else, including any value you changed since, `gateway.json`, and the state it still needs. With the gateway on it runs in two stages, so running sessions are not cut off. Full text: [below](#cc-smart-dev-kit-restore). |
| `cc-smart-dev-kit update [--check \| --hold \| --resume]` | Installs a newer cc-smart-dev-kit now, showing each step: `claude plugin marketplace update cc-smart-dev-kit`, then `claude plugin update cc-smart-dev-kit@cc-smart-dev-kit --scope user` when there is a newer version; a new major version too, which the background update holds for this. `--check` only says whether a newer version exists, and whether it is a major one (it reads the remote's version without changing anything). `--hold` stops the background update on this machine; `--resume` starts it again. Both answer at once (no lock); while a check runs, they say "A check is running now; it finishes." Nothing restarts: restart Claude sessions to load the new version. |
| `cc-smart-dev-kit migrate [--dry-run] [--yes]` | Moves a machine that still has the plugin's old `anymodel` names ([Moving from anymodel](#moving-from-anymodel)). It reads and checks everything, asks every question, and writes nothing before they are answered: a "no" leaves the machine as it was. Then it prints its steps and walks them; a step that fails keeps what the steps before it did, and the next run goes on from there. `--dry-run` prints that plan and writes, runs and stops nothing. `--yes` answers the router question without asking; the old plugin is uninstalled only after a yes on a terminal, and only when it is still installed. Refuses to run inside a Claude Code session: it replaces the router that session's own model traffic goes through. On a 0.2.x machine the command does not exist yet: run the plugin's `dist/cli.js` with bun (the section above has the line). |
| `cc-smart-dev-kit version` | Prints the version. |

#### `cc-smart-dev-kit setup`

Installs the launcher, turns Claude Code's own plugin auto-update off for this marketplace (`extraKnownMarketplaces["cc-smart-dev-kit"].autoUpdate: false`: the background update below is the one updater, so a major version waits for you), writes one user-level `Notification` hook for agent view ([Notifications](#notifications)), and installs the [instructions](#instructions-skills-and-agents): a copy in `~/.claude/cc-smart-dev-kit/instructions/`, imported by a cc-smart-dev-kit block in `~/.claude/CLAUDE.md` (your own text there is kept); each run refreshes the copy, so run it after a plugin update. Adds a missing [companion](#companion-plugins) marketplace (or plugin). Adds the [tmux line](#notifications) to `~/.tmux.conf` when tmux is installed (kept next to your own lines, removed again by `restore`), and names the command that applies it to a running tmux server as a next step. Points [claude-mem at the gateway's affordable model](#claude-mem-on-the-gateway) when both are set up, and turns [claude-mem's two start blocks off, with Claude Code's own task tools on](#claude-mem) whenever claude-mem is installed. Copies the project's [auto-mode entries](#the-auto-mode-block) into your settings, after it shows them and asks. It never touches [Warp](#warp) or its plugin without `--warp`. Every question comes before anything runs or is written. `--dry-run` shows the changes, and writes, runs and checks nothing at all (it reaches no network). A settings key you set yourself (for example `autoUpdate: true`, also after setup had set it) stops setup before it writes or runs anything. Without `claude` on your PATH, setup skips only the `claude plugin …` steps, names them, does the rest, and exits with 1. Run in a terminal with no status line set, setup also offers [cc-smart-dev-kit's status line](#the-usage-limit-the-alert-the-status-line-and-usage) (once: it remembers a "no"), and `--yes` skips that question and remembers no "no". Setup turns [Claude Code's retry watchdog](#waiting-at-a-limit-claude-codes-retry-watchdog) on by default, with or without a terminal and with `--yes`, unless a "no" is on file or you set a key of your own; `--no-retry-watchdog` takes it out and remembers the "no". A question shows its default and takes Enter for it; an answer it cannot read is asked again once. The report has a section per part, one verdict line, and the next steps to run, in order.

#### `cc-smart-dev-kit restore`

Removes what setup added (its settings keys, the auto-mode entries it copied, the [agent view notification hook](#notifications), claude-mem's keys (also the ones you chose in the [portal](#claude-mem-from-the-portal), with the record of those choices), its block in `CLAUDE.md`, the instructions' copy, the [tmux line](#notifications) it added, the three [retry watchdog](#waiting-at-a-limit-claude-codes-retry-watchdog) keys, and a stored `--no-instructions` choice) and keeps everything else. A key setup set and you changed since is yours: it stays. The plugins and marketplaces setup added stay installed: remove them with `claude plugin uninstall` and `claude plugin marketplace remove`. The launcher goes back to how it was before setup first changed it, or is removed when setup created it. With the gateway installed and on, it runs in **two stages**, because running Claude sessions still send every request to the router: the first restore removes everything but the router (the gateway's env keys too, and the launcher when setup created it — so `cc-smart-dev-kit` may be off your PATH then, and the line it prints is the `bun --no-env-file --config=… …/dist/cli.js restore` form of [Install](#install) step 3, with the bun running the restore, its own absolute path, and your installed version) and says to restart every running session; the second disables and stops the router and its socket (it asks, because that cuts answers in flight; `--yes` skips the question), waits up to 15 s for its port to close (not for its answers in flight, which finish in the background; and not at all when the unit was not running or another program answers on the port: it says so), and removes its copy, its units and its limit state (`~/.local/state/cc-smart-dev-kit/gateway-state.json`). `--now` does both at once, after a warning that every running session fails until it restarts (asked, or `--yes`). It keeps `gateway.json`, which holds your key. Some of cc-smart-dev-kit's own state stays too, and restore never removes the state folder `~/.claude/cc-smart-dev-kit/` itself, or a folder outside it. Still there afterwards: the backups a later restore or a hand-undo reads, the records (now empty), the running sessions' and the background update's bookkeeping, and the live-check record. The heavy-job queue's folder `~/.local/share/cc-smart-dev-kit/jobs/` stays as it is, with its `leases/` and `tickets/` folders (empty once no job runs). A restore with nothing left changes nothing.

### The project and its workflow

| Command | What it does |
|---|---|
| `cc-smart-dev-kit statusline` | The status line itself: plan usage, a warning from 85 %, any gateway fallback in use, and a slot whose every target is limited or down (the breaker). Reads the JSON Claude Code passes on stdin, and records the 5-hour window it read for the crew's opus usage guard ([`crew.usagePercent`](#the-workflow), D54). |
| `cc-smart-dev-kit hook <notify>` | The notifier hook (below): `setup` wires `hook notify` in your user settings for agent view; it reads the hook's input on stdin and answers as Claude Code expects. The three worktree names of the plugin's retired worktree engine (**retired in 1.0.0**) only print the fix on stderr and exit 1 — a non-blocking error, so a leftover line never blocks a subagent's stop; `cc-smart-dev-kit project init` takes such a line out of the project's settings (§ Worktrees). |
| `cc-smart-dev-kit project init [--dry-run] [--yes] [flags]` | Sets a project up ([`project init`](#project-init)): it writes the project's `.claude/cc-smart-dev-kit.json` (the worktrees, the protected branches, the guards, and optionally the [workflow](#the-workflow) policy) and, when the base branch is not the repo's default branch, `"worktree": {"baseRef": "head"}` in `.claude/settings.json`. It asks first, showing each default, which comes from the repo (the base from `origin/HEAD`, the protected branches from git and, when `gh` is installed and answers, GitHub); every question has a flag, so a run with no terminal writes nothing unless `--yes` is given. It never commits. `cc-smart-dev-kit project init --help` lists the flags. |
| `cc-smart-dev-kit workflow [show] \| set <setting> <value> [--project] \| unset <setting> [--project] \| review-done [--sha <commit>] \| merge-check [<pr>… \| --branch <b> --base <base>]` | What cc-smart-dev-kit may do by itself here — commit, push, open a pull request, merge — and the switches that map onto settings which already exist ([The workflow](#the-workflow)). `show` (the default) prints each value and where it came from: the project's file, your own defaults, or the built-in default, whether the commit here has a recorded review, and the `fixesAfterReview` limits in force. `set` and `unset` write one value; `--project` writes the project's committed file. `review-done` records that a commit had its one premium review, for your own terminal: it refuses inside Claude Code, where the [review-record hook](#the-workflow) writes the record when a review agent returns. `merge-check` judges a merge **without making it**, with the merge guard's own judgment: each pull request number, or a local branch against a base, one line per verdict (`allowed`, or the reason it asks); exit 0 when every one is allowed, 1 when any asks. A lead uses `--branch` as its hand-back gate (§ [The workflow](#the-workflow)). |
| `cc-smart-dev-kit session-name <session id> <name>` | Names a Claude session after its task. A session runs it itself when the project turns on `sessionNames` (below). A crew session is refused: `crew start --name` gave it the name its lead, `crew answer` and the message guard address it by. |

### The gateway and OmniRoute

| Command | What it does |
|---|---|
| `cc-smart-dev-kit gateway <command>` | The optional AI gateway (below). |
| `cc-smart-dev-kit omniroute <status\|update\|rollback>` | The OmniRoute behind the gateway's affordable slots (below): what is installed, the newest npm release at least three days old, the user unit that runs it, and the backend that talks to it. `update` installs the newest such release, restarts its unit, checks the model path, and puts the old version back when the new one does not answer. `rollback` installs the version the last update replaced. `update` and `rollback` refuse to run inside a Claude Code session, and are never in the background. |

### The browser

| Command | What it does |
|---|---|
| `cc-smart-dev-kit browser mcp` | Starts the Playwright MCP server on **your own Google Chrome**, through the Playwright extension, in the profile `claude-code` ([The browser](#the-browser)). `setup` registers it as the `playwright` MCP server; you do not run it by hand. **It refuses to start without the token**: without one the extension would ask you to approve every connection. When Chrome is closed — after a machine restart, say — it starts your own Chrome with that profile first and waits for it, so the first browser call works with nobody at the desktop; a Chrome that cannot be started (no reachable desktop, an error) is one line naming the one step, at once. |
| `cc-smart-dev-kit browser setup [--dry-run]` | Finds Chrome, opens the Playwright extension's Web Store page in the `claude-code` profile (Chrome makes that profile on that launch, if it is not there yet), pre-registers the extension for your user on macOS and Windows, and prints the steps that are left for you. It never installs or removes an extension, and never deletes a profile. `--dry-run` prints the same lines and runs and writes nothing. |
| `cc-smart-dev-kit browser token [--clear]` | Saves the token the extension's status page shows — paste the whole line (its Copy button copies `PLAYWRIGHT_MCP_EXTENSION_TOKEN=…`), and it is not echoed while you type. It is written to `~/.config/cc-smart-dev-kit/playwright-extension.token` (mode 600 on Linux and macOS; on Windows your profile's own permissions keep it yours), and is never printed again. `--clear` removes it. |
| `cc-smart-dev-kit browser check` | Proves the browser end to end on your own Chrome: a real connection with **no approval page**, a `file://` page (which needs "Allow access to file URLs"), screenshots (one the server names, one a caller names), an upload, a download, and `browser_close`. Exit 0 when every check passed. It opens that Chrome window once, and the tabs of its connection stay behind. It always ends: one limit bounds the whole run, and shorter ones the start, each answer and each stop — a Chrome that cannot start fails it at once instead of hanging it. |

### The portal and the job queue

| Command | What it does |
|---|---|
| `cc-smart-dev-kit portal [status\|stop] [--no-open]` | The local portal (below): a page on this machine to see and change the gateway's settings, the updates, the heavy-job queue, the companions and the OmniRoute. It starts with Claude Code, like claude-mem's worker: a new session starts it when it is not running, and a plugin update restarts it onto the new version. It binds `127.0.0.1` only and stays up until you stop it. `portal` opens it (starting it when needed), `status` says whether it runs and on which version, `stop` ends it, and `--no-open` prints the address instead of opening your browser. There is no sign-in: any program or account on this machine can open it (below). |
| `cc-smart-dev-kit job <command>` | The machine-wide queue for heavy jobs (below). |

### Sessions and worktrees

| Command | What it does |
|---|---|
| `cc-smart-dev-kit sessions [--open] [--dry-run]` | This project's Claude Code sessions of the last two days, by name and worktree, with the command that resumes each ([Sessions](#sessions)). With Warp installed it also saves a Warp tab for each. `--open` reopens every session that was open when the machine went down or its window closed (Warp tabs, or a terminal window each: XFCE Terminal on Linux, Windows Terminal on Windows); `--dry-run` says what it would open and opens nothing. |
| `cc-smart-dev-kit sessions --finished [--remove] [--yes] [--id <short-id>…]` | Lists background sessions finished (`done` or `stopped`) for more than one day, with name, folder and age. Crew sessions and leads never enter this list, even after a rename. Unknown kinds, waiting or working sessions, damaged role records and missing end-time evidence stay out. `--remove` shows the list and asks once, or takes `--yes`; repeat `--id` to limit removal to exact eligible short ids. It checks each candidate again before `claude rm`. A registered or locked worktree must be cleared first through `worktrees --clean` or its session's `ExitWorktree`; removal reports that refusal and continues with later eligible sessions, returning exit 1 if any failed. Nothing is removed automatically. The same command also sweeps what **removed crew sessions** left in `/resume`: it lists the conversations of crew records the store marks removed that are still in `~/.claude/projects/`, their worktrees' empty project folders, and the crew archives past `crew.archiveDays`; `--remove` asks once more (or takes `--yes`), reads them again, then moves each conversation into the kit's crew archive (as `crew rm` does), removes each empty folder and deletes each expired archive. A lead's session, a crew session still on the board, one a running Claude holds and one written after its record was removed are never listed or taken; a crew store it cannot read fails closed. `--id` names finished background sessions only and leaves this part out. |
| `cc-smart-dev-kit worktrees [--clean] [--remove <path>] [--no-fetch] [--json]` | Every worktree of this repo: who works in it, and which are finished ([Worktrees](#worktrees)). `--clean` removes the finished ones with their branches; `--remove <path>` removes one now, for the session that has just finished in it, so without the one-hour wait; `--no-fetch` judges against `origin/<base>` as it is. `--json` prints the same facts as one object, changes nothing and fetches nothing (it takes neither `--clean` nor `--remove`): it is the answer the portal's Worktrees page reads. `--clean` and `--remove` run in the main checkout only, one at a time. **A crew session's worktree is named as one** (the session, its lead, its state, and `crew rm` or the watch as who removes it): `--remove` leaves it to `crew rm`, which takes its record, branch and session with the folder. `--clean` and the background clean also use that same removal when its lead is proved gone and ancestry or a no-change merge proves its work reached the project base; unmerged work stays with resume, continuation and removal steps. The summary then says `N crew worktrees: their leads remove them`. A proved stale Linux Claude lock may be released only in the initial PID namespace, after the normal finished-worktree checks; a nested sandbox or unreadable namespace cannot prove a host locker dead; live and unreadable lockers stay, and a live one whose work reached the base names `ExitWorktree` (remove) or closing its session. |

### The crew

| Command | What it does |
|---|---|
| `cc-smart-dev-kit crew lead [--plan <slug>] [--tag <tag>] [--end]` | Records the Claude Code session that runs it (from its own Bash tool) as the lead of a plan in this repository (`--end` marks that existing plan ended; another normal `crew lead` reopens it), named `LEAD <tag> <plan>`. The tag is `--tag`, else [`crew.tag`](#the-workflow), else the main checkout's folder name; the plan is `--plan`, else the plan this session already leads, else the branch. The session takes that name at its next prompt by itself (no setting), replacing the name it had; a name you give it with `/rename` after that stays. Only a session id no name record can be made for, or a project running its own `lead-notes` hook, gets a `/rename` line to type. Refused outside a Claude Code session, in a crew session, in a session in bypass mode, and while crew sessions are off ([`crew.enabled`](#the-workflow)). |
| `cc-smart-dev-kit crew lead tell <lead…> --kind contract\|question "<text>"` | Tells one or more **other leads of this repository** a contract change, or asks them a contract question (a text that starts with `--` goes after a bare `--`) — the same two kinds `crew tell` has, tagged with the sending lead's name (`[LEAD <tag> <plan>] CONTRACT: …`, which ends "No reply needed.", or `[LEAD <tag> <plan>] QUESTION: …`). A `<lead>` is a session that ran `crew lead` here: its name, its session id, or the first 8 characters of it. The store decides: a lead this repository does not record (another repository's lead included), yourself, and a session that never ran `crew lead` are each refused, and **nothing is recorded or printed**. A crew session never runs it: it talks to its own lead through `crew report`. Each receiving lead gets one store event, so its watch and its missed-news note show the line, and the command prints one `SendMessage` line per lead. |
| `cc-smart-dev-kit crew start <phase> --sl | Starts one crew session for a lead: a background session in its own worktree and branch, and it returns at once with `started`, `queued` (and why) or `failed`. It also warns on a file clash with another lead and on a phase that already has a session. Full text: [below](#cc-smart-dev-kit-crew-start). |
| `cc-smart-dev-kit crew start <phase> --continue <crew session>` | The hand-off: starts the next crew session of a phase that ran out of room. The same phase, cut from the **old crew session's head** (not the lead's branch), with the old brief and what the old crew session left behind (its report and its own words), and the next number in its name (`C <tag> <plan> <phase> <slug> 2`, then ` 3`); its branch and worktree carry the same number (`crew/<phase>-<slug>-2`). The old crew session's **session is stopped, not removed**: its record stays `handoff`, and its branch and worktree stay for `crew rm`. A crew session that handed off (`crew report --status handoff`), stopped, ended done or failed can be continued, once; the model and effort are judged by the agent guard again, as for any start. |
| `cc-smart-dev-kit crew step <step> [--note <text>]` | Records one milestone of a crew session's phase: the step's name, the time and HEAD's sha (the command reads the sha itself). A crew session runs it; the lead sees one line. The steps: `tests-red`, `tests-green`, `suite-green`, `review-started`, `review-done`, `fixes-done`, `committed`, `pr-opened`, `handoff`. Refused outside a crew session. |
| `cc-smart-dev-kit crew report --status done\|blocked\|failed\|handoff [--file <file\|->]` | The hand-back report a crew session gives its lead. The command fills the mechanical facts — the branch and its head, the base, the diff counts, the files outside the brief, the review the record holds, the pull request — and the crew session gives the rest: the targeted tests and the whole suite, the other checks, the review's findings, the docs, what only the lead may do, what is still open. The file holds that part as JSON (checked field by field) or as prose (kept as the report's summary). A report that claims a review the record does not hold is refused, and so is a diff git cannot give (the report never says "no file changed" for a base that is gone). **A `done` report waits until no task on the session's own to-do list is open**: each open one is named, and nothing is written until it is finished (`TaskUpdate` status `completed`) or deleted (`status deleted`) with the reason under `open` in the report — a `handoff`, `blocked` or `failed` report is never held, and a session with no list at all gets the report plus one `note:` line. The report ends the phase: the crew session's state becomes the status, and a `blocked` report names the question it waits on (the crew session's own, or else the one it asked that nobody answered). |
| `cc-smart-dev-kit crew report --question "<the question>" --option "<choice>" --option "<choice>" [--recommend <n>]` | Records a question for the lead. **The crew session goes on** with everything the question does not block; its state does not move. A crew session never asks you. Two options at least, and a recommendation that is one of them. |
| `cc-smart-dev-kit crew answer <crew session> "<the answer>"` | The lead's answer to a crew session's question (an answer that starts with `--` goes after a bare `--`). A running crew session gets it as a message: the command prints the one line the lead sends it with (`SendMessage {"to":"…","message":"…"}`, the tool's arguments as JSON). A stopped crew session is resumed with the answer as its next prompt (`claude --bg --resume <session id> "<text>"`); the conversation stays on disk. A crew session that had been waiting for the answer is working again. A crew session the store does not know is never answered, and neither is one that ended its phase. The portal answers through the same command, with `--as-person`: its click is the person's, not a crew session's (D52). The flag says no Claude Code session runs the command, so one that does is refused with one line — it is the portal's, and it never skips a check. |
| `cc-smart-dev-kit crew tell <name…> --kind contract\|question "<text>"` | Tells one or more other crew sessions of your lead a contract change, or asks them a contract question (a text that starts with `--` goes after a bare `--`). Every `<name>` must be a live crew session of the same lead in the store — the name or id `crew list` shows; your lead, another lead's crew session, and one whose session is not running are each refused, and nothing is recorded or printed. It records the note for the lead (`crew watch` shows one line) and prints one `SendMessage` line per receiver, to send as it is: only a session can send a message. The first line is the tag the receiver sees — `[<phase>] CONTRACT: <what changed: file:symbol, commit>`, which ends the note with "No reply needed.", or `[<phase>] QUESTION: <the ask>`. Status, and that a phase is done, go to the lead with `crew report`, never to a peer. |
| `cc-smart-dev-kit crew wat | The lead's window on its crew: one line per change, and it starts, resumes and ends crew sessions as places free and limits lift. Full text: [below](#cc-smart-dev-kit-crew-watch). |
| `cc-smart-dev-kit crew self-watch [--once]` | The crew session's own line about its context and its time, run by the crew session's monitor: it keeps looking, and at [`crew.handoffPercent`](#the-workflow) of its context the crew session is told to hand off (commit the work in progress, then `crew report --status handoff`), at [`crew.softHours`](#the-workflow) it gets a note, and at [`crew.maxHours`](#the-workflow) it is told to hand off again — the hours count from when its session started. The line repeats every 15 minutes while it is ignored; a crew session that is fine sees nothing. A model the kit does not know the window of has no context line (the time lines still apply). `--once` checks once and exits. |
| `cc-smart-dev-kit crew list [--all] [--json] [--discarded]` | The board: every crew session of this repository, newest first (`--all`: every repository on this machine). One block each: its name, phase and kind, the model it runs on (and the gateway slot that answers it), its effort, its state and since when (from its last state change, not its last write), its branch, the files its brief gives it, the memory its session holds (once the lead's watch has read it; Linux only — a `-` on macOS and Windows), its lead, and the last step or line it said. So it is the address book and the ownership map in one: two crew sessions that list one file collide. A queued crew session says what holds it: the phases it waits for, its lead's [`crew.perLead`](#the-workflow) or `crew.perLeadOpus` reached, the machine's [`crew.max`](#the-workflow) ceiling or an optional `crew.maxOpus`, too little free memory, or the 5-hour usage window past [`crew.usagePercent`](#the-workflow). With a queued opus crew session waiting only for its lead's watch, and no window reading stored, one line says the opus usage guard does not hold. `--json` prints the crew records as one JSON list, newest first. `--all` also observes lead presence and marks a lead gone only after more than a day unknown to agent view, or an explicitly ended lead record (`crew lead --end`); unreadable view proves nothing. `--discarded` lists recoverable archives, their age and the `git branch <name> <archive-ref>` recovery line; cleaners prune them after 30 days. |
| `cc-smart-dev-kit crew status <name\|id>` | One crew session in full: its record, where its brief and its report are, the question it asked its lead that has no answer yet, and its last events. `<name\|id>` is the crew session's name (put a name with spaces in quotes), its id, or its session's short id; a name that matches two **live** crew sessions is refused, and both are named — one whose other matches are `removed` means the live one. Read only. |
| `cc-smart-dev-kit crew stop <name\|id>` | Stops one crew session's Claude session (`claude stop`). Its conversation is kept: `crew resume` or `claude attach` brings it back. A crew session that was running is marked `stopped`; one that already ended with an outcome (`done`, `failed`, `handoff`, `merged`) keeps it. Only a session in the crew store is ever stopped, never one of your own, and a crew session's own session cannot run it. |
| `cc-smart-dev-kit crew rm <name\|id> [--discard [--yes]]` | Ends a crew session whose work the lead merged; a queued crew session that never started is removed at once, since nothing else went. Refused until the branch the crew session was cut from (the ref its record's `baseRef` names) holds the work of its branch (every commit, or a merge that changes nothing, which is how a squash merge shows; when git cannot say, the crew session is kept; a branch with no commit of its own has nothing to lose, so the removal goes on): it says how many commits are missing and where to merge. Then, in order: uncommitted work and a lock you took by hand refuse before side effects; the session is stopped, then Claude Code's lock is released (a later refusal restores the same reason); the verdict ignores **the programs its own finished turn left running**, and only after every other safety check passes are those programs (the full check it started in the background, with its `sh` and `bash`) stopped — SIGTERM, a short grace, then SIGKILL, one line said — when the session is gone or stopped and every program there is its own (its readable environment carries this crew id; an unreadable environment, including macOS, never proves ownership); a program someone else started there — a shell or a dev server of yours, however long it has run — still keeps the worktree, and one such program keeps them all; folders an earlier removal moved aside (`…-removing-<time>`) and could not remove are finished here too — those git still lists under the usual checks, those it no longer lists only when nothing runs from them and no file in them is newer than the move; the worktree is judged the way [`worktrees`](#worktrees) judges one (no program or Docker container uses it, no file git does not keep) and removed, then its branch; only then `claude rm` deletes the session, and the crew session is marked `removed`, keeping whether you had merged it first (`mergedBeforeRemoval`: the phases that wait for it start on that, never on a removal alone). `claude rm` leaves the conversation in Claude Code's `/resume` list, so once it succeeded the removal also **moves the session's conversation out of `~/.claude/projects/`** — the transcript, its folder of subagent transcripts and tool results, and the project folder once it holds nothing — into the kit's own `crew-archive` folder (`~/.claude/cc-smart-dev-kit/crew-archive/<repo key>/<crew id>/`, the repo key being the crew store's own; each file gzipped, beside a copy of the report), and `/resume` is clean the moment the work is merged. The conversation is the only record of why a crew session did what it did, so it is kept for [`crew.archiveDays`](#the-workflow) (7) and then deleted; the same step deletes the older archives. A failed `claude rm` moves nothing. A lead's session, a session any crew record still on the board names, a session a running Claude holds and every file the store does not name stay where they are; a conversation that cannot be moved says why and never fails the removal. To bring an archived conversation back, gunzip its files to the same place under `~/.claude/projects/` (`gunzip -c <file>.gz > <file>`), and `claude --resume <id>` works again. The watch's removal after a merge runs these same steps. A watch-recorded merge proof accepts only the exact crew head it proved, using the immutable lead commit throughout removal even after the lead branch was rewritten; any newer crew commit and any old record without proof still needs today's merge check. Normal removal never forces unmerged work. Explicit `--discard` first shows the missing commits, dirty/untracked files and ignored files, asks once (or takes `--yes`), then archives all work at a unique `refs/crew-discarded/<crew-id>` ref (with an attempt suffix when needed) before removal. Ignored files must be regular UTF-8 text: at most 64 KiB each, 256 files and 1 MiB total, with no symlinks or binary files; anything outside that rule refuses. A separate staged version survives in the archive commit's parent. Recover within 30 days with `git branch <name> <archive-ref>`; `crew list --discarded` prints the exact command. A person's program or container still refuses. The watch never discards. The portal API exposes the same confirmation facts and token, but its new cleanup controls need a separate UI phase. |
| `cc-smart-dev-kit crew resume <name\|id>` | Brings that one crew session's Claude session back (`claude --bg --resume <session id>`) **in its own worktree**, with its own settings and MCP files and the model, effort and permission mode it was launched with, so it is still the same crew session and still lean; it keeps its conversation. Never `claude respawn` (it does not re-apply the worktree and comes back in the main checkout) and never all sessions. A session that still has a process is left alone — the line says it runs already — because a resume would start a copy beside it; an agent view that cannot be read is refused rather than guessed. Refused for a crew session that is `removed` or `merged`, has no session yet, or whose worktree or settings file is gone (one line says so). |
| `cc-smart-dev-kit crew resume --paused [--lead <session>]` | Brings every **paused** crew session of the lead back at once, the way on after you ran `/login` on another account. Each goes back the way the lead's watch brings one back: a session whose process still lives gets the message line to send (never a copy), one whose process is gone is resumed in its worktree with its own files; its record is `working` again with its wait cleared. `--lead` names the lead when the command's own session is not whose crew sessions to resume. One that cannot come back — or whose worktree is gone — is named and the others still go (exit 1). Never `claude respawn --all`. |
| `cc-smart-dev-kit crew attach <name\|id>` | Prints `claude attach <id>`, the command that opens the crew session's Claude session in a terminal (Ctrl+Z drops back to your shell and the session keeps running). It needs a terminal, so it is not run for you. |
| `cc-smart-dev-kit crew kinds` | The kinds of crew phase (`crew start --kind`): the model each runs on, its effort on Claude and on an affordable gateway slot (`never` for `ui`, which runs only on a tier), and what it is for. Built from the same table the launcher and the agent guard read. |

#### `cc-smart-dev-kit crew start`

<slug> --kind <kind> --brief <file\|-> [--base <ref>] [--files <glob,…>] [--model <model>] [--effort <effort>] [--waits-for <phase,…>]` | Starts one crew session for a lead: a background Claude Code session named `C <tag> <plan> <phase> <slug>` (the plan is its lead's), in its own worktree `.claude/worktrees/crew-<phase>-<slug>` on the branch `crew/<phase>-<slug>`, cut from `--base` or the lead's branch. **It returns at once** with one line: `started` (with the session's short id, the model and effort, the branch and its base commit), `queued` (and why: the phases it waits for, its lead's [`crew.perLead`](#the-workflow) or `crew.perLeadOpus` reached, the machine's [`crew.max`](#the-workflow) ceiling or an optional `crew.maxOpus`, too little free memory, or — for an opus-tier crew session — the 5-hour usage window past [`crew.usagePercent`](#the-workflow); the lead's watch starts it later), or `failed` (and why). One note line may follow a start: an opus-tier crew session that starts while no usage-window reading is stored says the opus guard does not hold. **A file clash is one more line**: when the phase's `--files` overlap those of a running or queued crew session of **another lead** in this repository, `clash: …` names that lead, its crew session and the files they share (the tracked files decide; for files that do not exist yet, two patterns under one folder count as shared). It never blocks — two leads may mean to share a file — and the other lead's watch says the same line. **A phase that already has a live crew session of yours**, under another slug, gets one line more: `note: … is already on phase …` names it and says to remove it first — two crew sessions on one phase is a mistake. The kind gives the model and effort (`build`, `docs`, `tests`, `security`, `money`, `permissions`, `schema`, `deploy` on sonnet; `architecture` on opus at `xhigh`; `ui` on opus at `high`, never an affordable model — UI/UX design is not affordable work); `--model`/`--effort` override them, judged by the agent guard's rules — a `ui` session's override that would put it below `high` or on an affordable model is refused with one line naming the allowed models — and one the guard would ask you about (opus at `max`, Fable) is refused: start that session yourself. The brief (`-`: stdin) is saved with a fixed frame: commit on your branch and never push (the lead handles git), how to hand back, and how to ask the lead a question — a crew session never asks you. Run `crew lead` in the session first. A repository you never opened with `claude` is refused ("Workspace not trusted"): open it once and accept the trust prompt. `--waits-for` counts a phase as finished only when the lead **merged** it (or the crew session was removed after that merge), so a dependent phase never branches before the merge. A phase whose crew session you removed before merging its work releases nothing: the watch says so once, and the dependent stays queued until you start and merge that phase again, or drop the wait (`crew rm` the queued crew session, then start its phase again). Each crew session's own settings turn Claude Code's retry watchdog on with no wait limit, so a turn waits out a model limit instead of ending; what still ends is marked `paused` and resumed by the lead's watch. **A crew session starts lean:** it loads this plugin and the project's own instructions, keeps Tavily for research (and the browser for a `ui` kind), and turns every other plugin and MCP server off for itself, except the plugins this one (or a kept one) depends on, which must stay on for it to load — so its context goes to the phase, not to the machine's other tools. A project whose phases need more names it in [`crew.keep`](#the-workflow). The launcher records the session's id and leaves the crew session `starting`: `claude agents` reports the folder a session was launched in until it has entered its worktree, so the session's own start hook decides — a session in any other folder is marked failed and stopped.

#### `cc-smart-dev-kit crew watch`

[--lead <session>] [--once] [--timeout <seconds>]` | The lead's window on its crew: **one line per change** — their steps, their reports, their questions, the person writing to one (read its next report against the brief), what they need from you (a permission prompt reads "needs you"), **a note another lead of this repository told you** (`LEAD <tag> <plan>: contract from another lead · …`), **a file clash** between a crew session of yours and another lead's phase (`clash: …`), **a pull request another lead merged into the base** (the line says what to merge, and when), a crew session that crashed or that you stopped by hand (it stops holding a place), a crew session that has gone quiet ([`crew.quietMinutes`](#the-workflow)), one whose turn ended with no report, one whose own start hook never confirmed it reached its worktree (after 3 minutes: the hook may have crashed, be silenced by `ownHooks`, or run outside git), one that **paused** at a model limit (it says what it waits for), and a queued crew session held by a phase that was removed before its work was merged (said once, with the way to drop the wait). It also starts the queued crew sessions when a place frees, **resumes the paused ones once the gateway answers again** — one first, the others 30 s apart and only after the router answered a request since, never while a slot's breaker is open or a Claude limit is current, and a crew session that pauses again within 15 minutes waits 5, then 10, then 20 minutes — ends the ones whose work is done (`claude stop`, so a crew session never outlives its work; a `done` or `failed` record keeps its outcome), and marks the ones whose branch was merged into the branch it was cut from (a merge commit, a fast-forward or a squash merge, the same answer `crew rm` gives) — **then removes them with `crew rm`'s own steps**: every later continuation holds the removal back until its work is merged into the first record's base (said once), and a refusal (a program of someone else's runs there, or work nobody committed) is said once and left for you. A handed-off record goes the same way once its work is merged. **A `stopped` record is marked merged, so what waits for it starts, but never removed by the watch: that is your call.** Every few minutes the watch also finishes a removal that stopped halfway (`…-removing-<time>`), and a finished crew session's unanswered question is closed, so it leaves the Needs page. Only sessions the kit's crew store records are ever stopped or resumed. `--once` ends on the next change: the fallback where the plugin's monitors do not run (the lead runs it in the background, and again after each event). `--timeout` bounds the wait.

**Help on one command:** `cc-smart-dev-kit help <command>`, or `<command> --help` — for a
subcommand too, as in `cc-smart-dev-kit gateway setup --help`. Either prints that command's own
help and runs nothing. Run `cc-smart-dev-kit` alone for the short list: the commands to start
with, two examples, and the names of the rest. A wrong command or option prints one line and the
`--help` line that explains it. `cc-smart-dev-kit help` with no command prints the same short
list.

### Waiting at a limit: Claude Code's retry watchdog

When a model is limited or down, a Claude Code session fails after a few retries. With
`CLAUDE_CODE_RETRY_WATCHDOG=1`, Claude Code's retry watchdog makes the session wait and retry
instead ("Retrying in …"; Esc cancels), and, with `CLAUDE_CODE_RETRY_WATCHDOG_USAGE_LIMIT_RECHECK_MS`,
it checks every few minutes whether a usage limit was lifted early. Claude Code reads both from
the `env` of `settings.json` (proved on 2.1.306).

**`cc-smart-dev-kit setup` turns it on by default**, with no question, on a terminal or not, and
with `--yes` or not. It writes three keys under `env` in `~/.claude/settings.json`, owned by
cc-smart-dev-kit:

- `CLAUDE_CODE_RETRY_WATCHDOG` = `1`;
- `CLAUDE_CODE_RETRY_WATCHDOG_USAGE_LIMIT_RECHECK_MS` = `300000` (five minutes);
- `CLAUDE_CODE_RETRY_WATCHDOG_MAX_USAGE_LIMIT_WAIT_MS` = `86400000` (24 hours).

The last one is the cap: a usage limit that resets **more than 24 hours away** ends the wait, so
a `claude -p` script returns instead of waiting for days. The 5-hour limit, and a model that is
down or overloaded, are still waited out with **no time limit** (no `…_MAX_WAIT_MS`): a session
keeps waiting until a model answers. What that means:

- every Claude session on the machine waits at a limit instead of failing;
- a `claude -p` script can wait until a model answers, or at most 24 hours for a usage limit;
- the lead's own subagents survive a limit only this way.

`--retry-watchdog` turns it on now, also after an earlier "no"; `--no-retry-watchdog` takes the
three keys out again and remembers a "no", so a later plain setup leaves them out. A value you
set yourself is yours: setup leaves it alone (and adds no cap beside a
`CLAUDE_CODE_RETRY_WATCHDOG` of your own), `restore` removes only cc-smart-dev-kit's three keys,
and `doctor` has one `·` line that says whether it is on. A machine that already has the two keys
an older setup wrote gets the cap at its next setup.

### The background update

Claude Code's own plugin auto-update can fail to run (anthropics/claude-code#61854), and it
knows nothing of the major hold below, so it is off for this marketplace (since 0.7.0: `setup`
writes `autoUpdate: false`, and each background check turns an older setup's `true` to
`false`). cc-smart-dev-kit updates itself. When a Claude session starts, its hook checks, **at
most once an hour**, in the background, and never makes the session wait or prints anything:

1. It compares the marketplace's remote head (`git ls-remote`, with no password prompt
   in a terminal: `GIT_TERMINAL_PROMPT=0` and ssh `BatchMode`; a git credential helper
   that opens a window of its own may still show it) with Claude Code's local copy, and
   the installed version with the copy's. A local copy whose head git cannot read counts as
   not behind: only the two versions decide then.
2. When either is behind, it runs the same two commands as `cc-smart-dev-kit update`, in your
   home folder and without git variables like `GIT_DIR` that a session may carry, logs
   each step to `~/.claude/cc-smart-dev-kit/update.log`, and shows one desktop notification when
   a new version was installed (`notify-send` on Linux, `osascript` on macOS, a PowerShell
   toast on Windows): "cc-smart-dev-kit
   X installed; restart Claude sessions to load it". When the new version's router
   differs from the one running, the notification adds the `cc-smart-dev-kit gateway setup` hint;
   when agent view's notification hook is missing (a background update never runs setup, so it
   never writes that hook), the notification says `cc-smart-dev-kit setup` writes it.

It never restarts the router, a service or a session. A new router still needs
`cc-smart-dev-kit gateway setup`, which asks first. When a background update fails, the next
interactive session start says so once (a `claude -p` run does not count). A marketplace
that cannot be read counts as a failure only after 24 hours in a row (a laptop offline
for a day is not a failure); Claude Code refreshing the same marketplace at that moment
is "skipped", and the next check tries again. The trade-off, accepted on purpose: a bad
release reaches every machine within the hour. `cc-smart-dev-kit update --hold` keeps one
machine where it is.

**A major version waits for you** (since 0.7.0). A patch or a minor version installs by
itself. A new major version (the first number grows: 0.7.0 → 1.0.0, 1.4.2 → 2.0.0) does
not, because it may need work in your projects first: 1.0.0 refuses the retired worktree
fields. The check refreshes the marketplace, installs nothing, and records "skipped: 1.0.0
is a major version (…): it waits for `cc-smart-dev-kit update`". Until you install it, each
interactive session start shows one line:

```text
cc-smart-dev-kit 1.0.0 is ready: it is a major version (it refuses old project fields). Read What's new, then run `cc-smart-dev-kit update`.
```

It is shown when a session starts or resumes, not on a `/clear` or a compaction of the same
session, and never in a `claude -p` run. The words in brackets come from the new version
itself (`src/update/major-notes.json` in its marketplace copy); without them the line has
none. `cc-smart-dev-kit update` is your yes: it says the version is a major one, then lists
every repo your saved Claude sessions worked in that still carries a retired worktree field
(`worktrees.prefix`, `setup`, `engine`) or an engine hook line
(`cc-smart-dev-kit hook worktree-create`, …) in `.claude/settings.json` or
`.claude/settings.local.json`, one `!` line each with its fix — a linked worktree's own files
count too, and its line names the worktree:

```text
! ~/Code/my-app still has worktrees.prefix in .claude/cc-smart-dev-kit.json, retired in 1.0.0: cd /home/user/Code/my-app && cc-smart-dev-kit project init
```

Then it installs the new version, the line goes, and it asks you to run
`cc-smart-dev-kit setup` (a major version's own one-time steps run there).
`cc-smart-dev-kit setup` lists the same repos on every run. Both only read those repos;
`project init`, run in each, makes the change (a repo whose `cc-smart-dev-kit.json` is not
valid JSON is listed with the error).
When the install fails, or ends without installing it, the hold stays and `update` says the
major version still waits. An installed version that cannot be read is no major step: the
background check installs as before. `update --check` says when the newer version is a
major one. `update --hold` still wins: while it holds, nothing is checked and no line is
shown. Versions before 0.7.0 do not have this rule: their background check installs any
newer version within the hour.

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

## doctor

`doctor` prints its checks in groups (the plugin, updates, companion plugins, MCP servers,
the browser, alerts and limits, this project, the gateway, the live check), each as soon as it
is done; on a terminal the group being checked stands on the line meanwhile. A group that
passed folds to one line and keeps only its `·` notes; a group with a failure or a warning
shows every line, each failure with its fix under it. The last line says what the run found:

```
✓ The plugin         6 passed
✗ Updates            1 to fix, 2 passed, 1 note
  ✗ installed 1.0.0, marketplace has 1.1.0
    Fix: claude plugin update cc-smart-dev-kit@cc-smart-dev-kit
  ✓ can read the marketplace at git@github.com:example-org/cc-smart-dev-kit.git
  ✓ plugin updates are on
  · background update: no check yet (a new Claude session checks, at most once an hour)
· Gateway            1 note
  · gateway: not set up (optional). To use it: cc-smart-dev-kit gateway setup

✗ 1 to fix, 8 passed. Run each Fix: line above, then: cc-smart-dev-kit doctor
```

On a terminal the marks and the verdict are in colour and long lines wrap to its width (at most
100 columns). Anything else — a pipe, a file, CI, `NO_COLOR` set, `TERM=dumb` — gets the same
words with no colour, no progress line and no wrapping. An old Windows console (no Windows
Terminal, no VS Code) gets ASCII marks: `[ok]`, `[x]`, `[i]`, `[!]`. `--json` prints the report
as one JSON object instead: `format`, `version`, `ok`, `counts`, and `groups`, each with its `id`,
`title`, `status` and `checks` (`status`, `text`, and `fix` on a failure).

`doctor` checks that:

- the Bun running it is 1.4.3 or later. On an older one it skips the gateway checks:
  they send the backend key;
- the plugin is installed **and turned on**: an install whose `enabledPlugins` entry in
  `~/.claude/settings.json` is not `true` loads no hook, skill or command, so its fix is
  `claude plugin enable cc-smart-dev-kit@cc-smart-dev-kit`;
- the installed version is up to date with the marketplace's local copy. When it is behind, ✗
  says "installed X, marketplace has Y", fixed by `claude plugin update cc-smart-dev-kit@cc-smart-dev-kit`.
  When the local copy or its version cannot be read, the fix is `claude plugin marketplace
  update cc-smart-dev-kit`. A new major version in the copy is no failure: a `·` line says it
  waits for `cc-smart-dev-kit update`;
- the launcher matches the script setup would write for the `bun` baked into it, and
  that `bun` is executable;
- on Windows, the second launcher and Git Bash: `~/.local/bin/cc-smart-dev-kit.cmd` is there,
  is this version's and runs (through `cmd.exe`), Git Bash is found (the `✗` says to install
  Git for Windows or to set `CLAUDE_CODE_GIT_BASH_PATH`; a `!` for a variable Claude Code
  ignores), and `tmux: not on Windows` is a `·` line (§ Windows);
- the instructions: the copy in `~/.claude/cc-smart-dev-kit/instructions/` is this plugin
  version's (its version stamp, and each file against the plugin's), and `~/.claude/CLAUDE.md`
  still holds the block that imports it. A ✗'s fix is `cc-smart-dev-kit setup`. After
  `--no-instructions`, a `·` line says they are left out, as information;
- the current project: when a `CLAUDE.md`, `.claude/CLAUDE.md` or `CLAUDE.local.md` in the
  current folder or a folder above it imports a cc-smart-dev-kit file
  (`@~/.claude/cc-smart-dev-kit/instructions/…`), that file exists. A missing one loads nothing and
  Claude Code says nothing about it, so doctor fails, fixed by `cc-smart-dev-kit setup` (or, after
  `--no-instructions`, a `·` line with `cc-smart-dev-kit setup --instructions`). No import, no line;
- git can read the marketplace (`git ls-remote`, with no password prompt in a terminal:
  `GIT_TERMINAL_PROMPT=0`; a git credential helper with a window of its own may still
  show one). It adds ssh `BatchMode` only when you have no ssh command of your own
  (`GIT_SSH_COMMAND`, `GIT_SSH` or `core.sshCommand`). It prints URLs without
  credentials. When it cannot, the ✗ names the cause when git's own words say it — ssh to
  GitHub was refused (add the marketplace over HTTPS instead), or the GitHub account cannot
  read the repository (ask its owner for read access, then accept the invitation) — and keeps
  its old line for anything else;
- Claude Code's own plugin auto-update is off for this marketplace. It fails when it is on (`autoUpdate: true` in `settings.json`, or Claude Code's own record in `known_marketplaces.json` with no key in the settings): it knows nothing of the major hold, so it would install a major version by itself. For setup's own leftover `true` the fix is `cc-smart-dev-kit setup`; for a `true` you set, remove it by hand, then run setup;
- Claude Code's [retry watchdog](#waiting-at-a-limit-claude-codes-retry-watchdog), as information (`·`), never a failure: on (set by cc-smart-dev-kit), on (your own `CLAUDE_CODE_RETRY_WATCHDOG`), off with the command that turns it on, or off because your own value leaves it off;
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
- claude-mem's two start blocks are off in `~/.claude-mem/settings.json` ([claude-mem](#claude-mem)):
  work state and the memory-use block, each shown with whether setup or you set it. Both on,
  and nobody having chosen them, is a ✗ that names `cc-smart-dev-kit setup` (together they
  overflow Claude Code's start context in about one start in six); a value you set is
  information (`·`), never a failure. While work state is off, a second line checks
  `env.CLAUDE_CODE_ENABLE_TODO_TOOLS` in `~/.claude/settings.json`: ✗ when it is not set, ✓
  when it is `"1"`, and `·` for a value you set yourself;
- Warp: the app and its version, and its Claude plugin. Not installed, or installed
  without its plugin (or with it turned off), is information (`·`): Warp is optional.
  ✗ only for the plugin without the app;
- the browser: Google Chrome is installed, the `claude-code` Chrome profile is there, the
  Playwright extension is installed in it and it is the ONLY extension there (a second one
  breaks a browser session: microsoft/playwright#43230, open — a `!` line names it), the profile
  lets the extension open `file://` pages, and the extension's token is saved. Whether Chrome is
  running is information (`·`): when it is closed — after a machine restart, say — the first
  browser call starts it in that profile itself. A ✗ names the
  command or the click that fixes it; without the token nothing runs at all
  ([The browser](#the-browser)). Whether the `playwright` server is registered and starts is the
  MCP servers' own line, just below;
- the MCP servers setup registers (the `playwright` browser, `sequential-thinking`,
  `tavily-websearch`): each is registered at user scope and starts
  (`claude mcp get`, which starts it once). ✗ when one is missing (fix: `cc-smart-dev-kit setup`)
  or when another copy of it wins — a project's `.mcp.json`, or the local scope — naming
  what to remove. Without a Tavily key its server is skipped, as a `·` line that names the
  key file: a person who never wanted web search loses nothing. A key is never printed;
- what an older setup left for Serena ([0.6.0](#060-serena-is-removed)): one ✗ line while
  setup still has to take back the `serena` registration it made, its context file or the
  `serena-root` records (fix: `cc-smart-dev-kit setup`), and nothing once it has. A `serena`
  of your own is a `·` line: it stays;
- OmniRoute, when it is installed here: a `·` line when a newer release has been out for
  three days (with `cc-smart-dev-kit omniroute update`), and nothing when it is the newest or
  the registry cannot be read. Never a failure (§ OmniRoute updates);
- tmux, when it is on your PATH: whether `~/.tmux.conf` has the line that lets an alert out
  of a pane (§ Notifications), and, inside a tmux session, whether the running server passes
  alerts through. Both are information (`·`) with the fix (`cc-smart-dev-kit setup`, or
  `tmux set -g allow-passthrough all`): tmux is optional. When neither is wrong — the line
  is in the file, and you are outside tmux, or inside one whose passthrough is `all` —
  doctor prints no tmux line at all;
- the portal: ✓ while it runs, with its address, version and process; `·` when it is not
  running (it starts with the next Claude Code session, or now with `cc-smart-dev-kit
  portal`); `!` when it runs an older version, which the next session start restarts onto
  this one; ✗ when another program holds its port, so it cannot start
  ([The portal](#the-portal));
- agent view's notification hook: the user-level `Notification` hook setup writes into
  `~/.claude/settings.json` (matcher `agent_needs_input|agent_completed`). A ✗ says it is
  missing or runs something else, fixed by `cc-smart-dev-kit setup` (§ Notifications);
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
  router set up by an older version has none: ✗, fixed by `cc-smart-dev-kit gateway setup`), the
  router answers on its port (when it does not, the ✗ says which of two cases it is: the
  socket is open but no router answers, so every request waits; or the router failed to
  start again and again, so systemd closed the socket and every request is refused; both
  name `journalctl --user -u cc-smart-dev-kit-router -n 30`), each backend answers, every judge
  target of your own judge chain passed the judge test (a worker target that did not is information, never a failure); and, as
  information, each slot's first target. Without
  `gateway.json` (set up with `--no-backend-key`), a `·` line says every slot answers on
  Claude. When it was never set up, doctor says "gateway: not set up (optional)" as
  information (`·`), not as a failure; with only `gateway.json` left (restore keeps it),
  "gateway.json kept; the gateway is not installed";
- the project of the folder you run it in (nothing outside a git project; a `·` line
  when git is not on PATH):
  - ✗ when `.claude/cc-smart-dev-kit.json` cannot be used: it names the file and the field.
    A field of the retired worktree engine (`worktrees.prefix`, `worktrees.setup`,
    `worktrees.engine`) is one of them: the line names the field and
    `cc-smart-dev-kit project init` as the fix (§ Worktrees);
  - ✗ for each of the project's settings files (`.claude/settings.json`,
    `.claude/settings.local.json`) that still runs the retired engine's
    `cc-smart-dev-kit hook worktree-create`, `worktree-remove` or `subagent-stop`, known by its
    command text: each such hook fails every time it runs, and the line names
    `cc-smart-dev-kit project init`, which takes the lines out. It shows beside the ✗ for a
    retired field, so one run of `project init` fixes both;
  - `!` when `.claude/worktrees/` is not git-ignored in the repo, so Claude Code's own
    worktrees would show up in `git status`;
  - `!` when `worktrees.base` is not the repo's default branch and the project's settings do
    not set `"worktree": {"baseRef": "head"}`, so a new worktree would be cut from the default
    branch instead; the line names the one line to add;
  - as information (`·`), each plugin hook the project's `ownHooks` turns off here, and each
    retired hook name it still lists (`serena-root`): accepted, it silences nothing and can go;
  - `!` warnings (never a failure) for an `ownHooks` entry with no project hook left to
    answer, and for a project hook that runs next to a plugin hook `ownHooks` does not
    name: both would answer (§ The hooks);
  - `!` warnings for the plugin's old `anymodel` names a project still carries from 0.2.x
    (`.claude/anymodel.json`, a `.claude/anymodel/` folder, a settings hook that calls
    `~/.local/bin/anymodel`): each names the new file, folder or command (§ Projects that
    used the old name);
  - `!` in a project with a `cc-smart-dev-kit.json`, when git is older than 2.40: a fix made
    after a review cannot be measured there, so each fix needs a review of the exact new head
    (§ The review record);
- the last live check, as information (`·`), when `doctor --live` passed on this machine
  before: the Claude Code version it passed on, and "run it again" when the installed
  Claude Code is another version.

`doctor --live` makes one throwaway repo in a temp folder and runs one short `claude -p`
session in it, with **the plugin being checked** (`--plugin-dir`), only the EnterWorktree,
ExitWorktree and Bash tools, permission for exactly the calls it makes (`--allowedTools`),
and a three-step prompt: enter a worktree, run `git status` there, leave with "remove". It
uses your Claude login and costs a few cents. It checks that the plugin's hooks fired
(SessionStart, and the git guard before the Bash call), that the git guard read the command
line (the hook log names the programs it parsed: `git`), that no WorktreeCreate hook ran and
Claude Code made its own worktree, and that it removed it. When everything passes it records
the Claude Code version in `~/.claude/cc-smart-dev-kit/live-check.json`. The temp folder is
removed.

## Backups and config folders

Setup only changes the keys it owns. Before each change it makes a backup in
`~/.claude/cc-smart-dev-kit/backups/` (a private folder, one subfolder per file), never beside
the file. A backup is never executable.

The command follows `HOME` and `CLAUDE_CONFIG_DIR`. With `CLAUDE_CONFIG_DIR` set, its
state and backups live under that folder. The launcher `~/.local/bin/cc-smart-dev-kit` is one
file for every config folder, so a `restore` under one config folder can remove a
launcher another one still uses. A launcher started without `CLAUDE_CONFIG_DIR` looks in
`~/.claude`.

## Moving from anymodel

Until 0.3.0 the plugin, its marketplace, its command and its slots were named `anymodel`,
and a machine that ran 0.2.x still carries that version's folders, launcher, router units and
slot names. **The [one command](#install) does the move**: it installs this version, runs
`migrate` (which decides by itself what to move), then `setup`. How to move a machine by
hand, what `migrate` moves, and the order it moves it in: **[docs/migrate.md](docs/migrate.md)**.
`migrate` refuses inside a Claude Code session, because it replaces the router that session's
own model traffic goes through.

### Projects that used the old name

`migrate` moves your **machine's** own files. A project keeps what 0.2.x wrote in its own
`.claude/` folder, so run `cc-smart-dev-kit doctor` inside the project: it warns about each
one, with the name it becomes. The three cases — `.claude/anymodel.json`,
`.claude/anymodel/`, and a hook that still calls the old launcher — are in
[docs/migrate.md](docs/migrate.md) § Projects that used the old name.

## The AI gateway (optional)

A local router, `cc-smart-dev-kit-router`, sends each Claude model's work to the models you
choose: one slot per model family (scout = Haiku, worker = Sonnet, opus, fable) and one for auto
mode's safety checks (judge). Every slot is **Claude or Custom** (D2): a slot with no chain in
use is Claude — that model is plain Claude, on your own login — and one with a chain in `slots`
is Custom. A switch to Claude saves the chain in `kept`, so it is never lost and never used;
`gateway slot <slot> custom` brings it back. A fresh setup gives no slot a chain: the plugin
picks no model for you. No prompt text
is ever changed. The service that keeps the
router running is a systemd user unit on Linux and a per-user Scheduled Task on Windows
(see [Windows](#windows)); macOS has neither, and `gateway setup` refuses there.
How it works: [docs/gateway.md](docs/gateway.md).

| Command | What it does |
|---|---|
| `cc-smart-dev-kit gateway check` | One read-only question, for scripts (the installer asks it): does the gateway have an OmniRoute key the backend accepts? Exit 0 yes, 1 no key yet (OmniRoute answers, so one can be made), 3 it could not be judged (nothing answers, or the config cannot be read), 4 the key is one OmniRoute refuses. It asks the backend only — never the router's port — and prints one line saying what it found; a 1 or a 4 adds a `Fix:` line and the setup commands that fix it. |
| `cc-smart-dev-kit gateway setup [--yes] [--backend-key-stdin <backend> \| --omniroute-password[-stdin] \| --no-backend-key] [--save-unchecked]` | On a terminal with no key flag and no `--yes`, it first asks OmniRoute's address, its API key (no echo), a chain per model slot from the live model list (off unless you pick), and whether to turn the gateway on; Ctrl+C at a question exits 130 with nothing changed ([The AI gateway](#the-ai-gateway-optional), step 2). Makes `~/.config/cc-smart-dev-kit/gateway.json` (mode 600; the key on stdin, never argv), copies the router to `~/.local/share/cc-smart-dev-kit/router.js`, writes the systemd user units `cc-smart-dev-kit-router.socket` (it holds the port) and `cc-smart-dev-kit-router.service`, starts them, and waits up to 5 s for the router to answer. First of all it asks the router's port: when another program holds it (an older router, say), it stops and writes nothing. When the router runs and the copy or a unit changed, it says what the restart does and asks; `--yes` skips the question. A restart lets the answers in flight finish (up to 120 s; an answer still running then is cut, and Claude Code retries it), and new requests wait in the socket meanwhile, so none of them fails. A connection that sends nothing is closed half a second after the restart starts, so it cannot hold the restart. The exceptions are the restarts that must open the socket again (the first setup that moves a router from an older version to its socket, a socket that was stopped, a changed socket unit or port): until the old router has finished its answers, new requests fail, and setup's warning names which case it is. When the socket cannot open at all, setup says so and starts the router without it (the router binds the port itself). A router that fails to start 5 times within 60 s is given up: systemd then closes its socket too, so requests are refused at once instead of waiting; `doctor` names it, and `gateway setup` starts both again. A setup that stopped half way is finished by the next one. In Claude Code's settings it does one thing only: it takes out the model keys 0.4.3's `gateway on` wrote (`ANTHROPIC_DEFAULT_HAIKU_MODEL` / `…_SONNET_MODEL` and their `…_NAME` / `…_DESCRIPTION`), where cc-smart-dev-kit still owns them; then restart every open Claude session. In `gateway.json` it drops the `claude-sonnet-5-5` 0.4.x put at the end of a scout or worker chain that is still that exact default, and it moves the chains the old portal kept in `portal.json` into `kept` (the portal's file then holds no slot state; both files are backed up first). |
| `cc-smart-dev-kit gateway status` | Router health (open breakers included), each backend, the slots, whether Claude Code points at the gateway, and the request history's size and retention, each finding marked (`✓` `✗` `!` `·`; the slot rows are a plain table), then one verdict and the next step: not set up yet (`gateway setup`), the config cannot be read, the router does not answer (`Fix:` setup starts it again), Claude Code points at another address (`gateway on`), a backend does not answer, Claude Code does not use it (`gateway on`), or all well. Keys are masked. |
| `cc-smart-dev-kit gateway history [1h\|4h\|1d\|7d\|14d\|30d\|90d] [--by target\|slot\|model\|session] [--slot <name>] [--target <target>] [--model <model>] [--session <id>] [--errors]` | The request history: one row per routed request, never a prompt, a tool or an answer. Per target (the default), slot, model or session: requests, errors, input/output/cache tokens, the estimated cost and the worst bucket's p95 latency, for the range (default `1d`). `--errors` keeps only statuses of 400 or more. The portal's Flow page charts the same data. |
| `cc-smart-dev-kit gateway models` | Every model each backend offers, and the slots. |
| `cc-smart-dev-kit gateway slot <scout\|worker\|opus\|fable> <target>[,<target>…]` | Custom: a slot's chain (any targets, any order, from `gateway models`); live. `slot <slot> claude` (or `off`): Claude again, and the chain is saved, not used. `slot <slot> custom`: the saved chain again, with its fallback switch. `slot <slot> clear`: delete the chain, in use or saved. |
| `cc-smart-dev-kit gateway slot judge <target>[,<target>…]` | Your own judge for auto mode, in the order you give: a `claude-<model>` target as it is, any other target only after it blocks a test force push to `main`. A weak judge can let a risky command through, and it reads the conversation. Without it, Claude judges first, and while Claude is limited or down the worker slot's targets that passed the same test judge. `slot judge claude` (or `off`): back to that, with the chain saved; `slot judge custom` uses the saved chain again (untested targets are tested first). |
| `cc-smart-dev-kit gateway fallback <slot> on\|off` | May the next target answer when the one before it fails or rests? On by default for scout, worker and judge, off for opus and fable. Off: only the first answers, the rest stay saved. `fallback judge off`: Claude alone judges. |
| `cc-smart-dev-kit gateway breaker <slot> on\|off` | When every target of a slot is limited or down, may the router hold the request for a while and then ask Claude Code to retry (up to 240 s, `timeouts.breakerHoldMs`; 0 holds none)? Off: the last answer goes back at once. On by default for every slot but the judge, which never holds, so it has no switch. |
| `cc-smart-dev-kit gateway on` | Points Claude Code at the router: sets its env keys in your `settings.json` as keys cc-smart-dev-kit owns. A gateway key someone else set stops it; nothing is overwritten. Every running session switches on save. |
| `cc-smart-dev-kit gateway off` | Removes exactly the keys `on` set. Restart the sessions afterwards. |
| `cc-smart-dev-kit gateway serve` | Runs the router in the terminal. |

**The request history.** The router logs one row per routed request — the time, the Claude
Code session id, the model, slot, target and status, the latency, the tokens the answer
reported and an estimated cost — in `~/.local/state/cc-smart-dev-kit/history.db`. It is
**never** a prompt, a system text, a tool, an answer or a key. Rows are kept 90 days by
default: `"history": {"retentionDays": 7}` in `gateway.json` changes that, and `0` turns the
log off. `gateway history` and the portal's Flow page read it; `doctor` and `gateway status`
show its size. [docs/gateway.md](docs/gateway.md) § The request history.

### First setup

1. Run OmniRoute on this machine at `http://127.0.0.1:20128`: setup writes that address
   for the `omniroute` backend. Give it a connection to a provider (Ollama Cloud, say).
   OmniRoute somewhere else: setup's first question takes its address (or, after setup, change
   `backends.omniroute.baseUrl` in `~/.config/cc-smart-dev-kit/gateway.json`).
2. **The key: answer setup's questions, let setup make one, or give it one you have.** On a
   terminal, `cc-smart-dev-kit gateway setup` with no key flag asks, one question at a time:
   OmniRoute's address, its API key (read with no echo; Enter keeps the saved one), a chain for
   each model slot — scout, worker, fable, opus — picked by number from OmniRoute's live model
   list (Enter keeps the slot as it is, "off" for one with no chain: nothing is picked for you),
   and whether to turn the gateway on now (default no). It asks everything before it changes
   anything, and Ctrl+C at a question stops it (exit 130) with nothing changed. The judge is not
   asked: `gateway slot judge` tests a target first. With no terminal, or with `--yes` or a key
   flag, nothing is asked. `setup` can also log in to OmniRoute
   with your dashboard password and make the router's key itself:

   ```sh
   cc-smart-dev-kit gateway setup --omniroute-password
   ```

   It asks for the password with no echo (or takes it with `--omniroute-password-stdin <
   password-file`), never stores it, and makes a key named
   `cc-smart-dev-kit-router-<machine>` in OmniRoute's own API keys. To give setup a key you
   already made, put it in a file only you can read and hand it over **on stdin** — the first
   key is always the `omniroute` backend's, because a new config is created around it:

   ```sh
   cc-smart-dev-kit gateway setup --backend-key-stdin omniroute < key-file
   ```

   Why a file: a key typed at the prompt shows on the screen, and setup reads to the end
   of the input, so typing it also needs Ctrl-D. A key as an argument would land in the
   shell history and the process list, so setup refuses one there. No key yet:
   `cc-smart-dev-kit gateway setup --no-backend-key` (every slot off: every model plain Claude).
   Once the gateway is set up, the [portal](#the-gateways-key-from-the-portal) changes this key
   too, both ways, with the same checks.
3. **The key is tested before it is saved.** setup makes one cheap authenticated request to the
   backend (`GET /v1/models`, a 5-second timeout):
   - **HTTP 401 or 403: refused.** Nothing is saved, the key already in the file stays, and the
     line says which key that backend wants — for `omniroute`, an **OmniRoute API key** (made in
     OmniRoute's own dashboard, its API keys page), the one the router itself uses, **not** a
     provider key such as an Ollama Cloud one.
   - **Anything else (unreachable, a 5xx): not refused, but not saved silently either.** setup
     says it could not be checked and saves nothing unless you add `--save-unchecked`, which
     saves it with a warning line (`!`) naming `cc-smart-dev-kit gateway check` for later.
   - **A key that replaces one in the file is backed up first**: the whole file as it was, in
     `~/.claude/cc-smart-dev-kit/backups/<the file's path, encoded>/gateway.json.bak-cc-smart-dev-kit-<stamp>`
     (the state folder, never beside the config — a backup beside it would sit in `~/.config`
     with a key in it). The line after the change says which folder. This is a plain backup, not
     a managed change: `restore` leaves `gateway.json` alone on purpose (it holds your key), so
     copy the file back by hand if you want the old key.
4. `cc-smart-dev-kit gateway status`, then `cc-smart-dev-kit gateway on`. Every slot is
   Claude until you give it a chain: `cc-smart-dev-kit gateway models` lists what each backend
   offers, then `cc-smart-dev-kit gateway slot <slot> <target>[,…]` sets one — with nothing
   set, every model is plain Claude on your own login. To check the key alone (read-only, no
   restart): `cc-smart-dev-kit gateway check`.

Auto mode's safety checks are judged by Claude first. While Claude is limited or down, the
targets of your worker slot that passed the judge test judge in its place (`gateway setup` and
`gateway slot worker` run the test and say which target passed and which failed; a target that
failed stays a worker model and never judges; `gateway fallback judge off` keeps Claude alone).
You can give the judge slot a chain of your own, which wins, and a judge set before 0.5.0 must be
tested and set again (`cc-smart-dev-kit gateway slot judge <target>[,…]`). A more affordable judge
can block good work, and a weak one can let a risky command through, so `slot judge` first tests
each target on one obvious case and refuses a target that lets it run. The router
recognises the check by its prompt. If Claude Code rewords that prompt, the check is
routed by its model name until the router is updated (see
[docs/gateway.md](docs/gateway.md) § Known limits; [roadmap](docs/roadmap.md) Phase 3).

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
  ([docs/design/omniroute.md](docs/design/omniroute.md) § OmniRoute).
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
  back, a request to an OmniRoute target fails — a slot with its fallback on moves to its
  next target, if it has one; any other slot answers with that error.
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
  set up). On Linux it offers "Use <target> until it resets", which turns on the fallback of
  your model's slot: `gateway slot <slot> <model>,<targets>` (the model first; then, when only
  that model's own window ran out, a Claude target of another family from your own chains;
  then the affordable targets of your worker chain, then your scout's), then
  `gateway fallback <slot> on`. If the slot already has your chain with its fallback off, only
  the second command runs. "Wait" does nothing; after "Use", send a message in Claude Code to
  go on. The plugin names no model of its own: with no affordable target in your chains, the
  alert offers nothing and points at `gateway models`. On macOS and Windows it names the
  commands (a Windows toast has no action button).
  It needs a desktop to show the alert on: where there is none
  (an SSH session, a headless machine) or the gateway was never set up, the `notify` hook
  announces the stopped turn instead. A short rate limit is not the plan's limit: Claude Code
  retries it, and the `notify` hook announces the turn only if it dies then.
- **The breaker's alert.** When every target of a slot is limited or down, the router holds
  the request for a while and then answers a 429 Claude Code retries
  ([docs/gateway.md](docs/gateway.md) § The breaker). If a turn still stops, the same hook
  says so once per breaker opening: the slot, since when, each target and why it rests, and,
  on Linux, "Use <target>" runs `gateway slot <slot> <the backend targets of your other
  chains>`. It names no model of its own: with none, it points at `gateway models`. The text
  ends with "then send a message to go on", or "Claude Code goes on by itself" while its
  retry watchdog is on
  ([Waiting at a limit](#waiting-at-a-limit-claude-codes-retry-watchdog)).
- **The status line.** `cc-smart-dev-kit setup --statusline` sets Claude Code's status line to
  `cc-smart-dev-kit statusline`. It shows your 5-hour and 7-day plan usage, warns from 85 %,
  shows any fallback in use, and, while a slot's breaker is open, `<slot> slot: every target
  limited since 21:05 → gateway slot <slot> <targets>`.
- **Each subagent's row in the agent panel.** The plugin's own `settings.json` sets Claude
  Code's `subagentStatusLine`, so every subagent's row reads `<label> · <slot> → <model> →
  <effort>` — the slot its requests reach (scout, worker, opus or fable, from the model's
  Claude family), the model Claude Code resolved, and the effort it runs at. It is the same
  routing `agent-guard` judges, on screen while the agent runs.
- **`cc-smart-dev-kit usage`** reads Claude Code's own transcripts and shows, per session, the
  main session's replies by model and, apart, its subagents: how each was launched, which
  model wrote each reply, and the share on Opus. Each subagent's stop also leaves its own
  record (`~/.claude/cc-smart-dev-kit/agent-usage.jsonl`): its type, its replies by model,
  the four token sums and an estimated USD cost from Claude's list price — a backend whose
  price is unknown is counted with its tokens and no cost. It also lists the Opus and Fable launches
  the `agent-guard` hook let run, counted by the effort each ran at and by why: its
  `Opus reason:` or `Fable reason:` word when it gave one (a line from an older version, which
  holds only the reason, is read the same way) — an Opus or Fable agent spends your own plan
  usage.
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

`cc-smart-dev-kit portal` opens a small web page on this machine: the same facts as the
commands above, and the same actions, with a form instead of a command line.

**It starts with Claude Code and stays up** — like claude-mem's worker. A new session starts
it when it is not running, and a plugin update hands it over to the new version at the next
session start (never back to an older one). It is always on one fixed local port, so
`http://127.0.0.1:20150/` is the address whenever a session is running:

```
$ cc-smart-dev-kit portal
The portal was not running: started it (version 1.1.0).
  http://127.0.0.1:20150/
```

Your default browser opens that address — unless Chrome's `claude-code` profile is on this
machine, the one Claude Code drives: then nothing is opened for you, and the line under the
address says where to open it instead. `--no-open` only prints it.

```
$ cc-smart-dev-kit portal status
The portal is running at http://127.0.0.1:20150 (version 1.1.0, process 48211).

$ cc-smart-dev-kit portal stop
The portal stopped.
```

`status` exits 1 when the portal is not running, or when another program holds its port. A
crash is brought back by the next session start; two sessions that start together start it
once. If another program holds port 20150, nothing is started and the portal's log
(`~/.claude/cc-smart-dev-kit/portal.log`) says so once. `doctor` has one line about it.

### The gateway's key from the portal

The Machine page's OmniRoute card holds the gateway's own OmniRoute key: the key the gateway's
requests to OmniRoute carry. It says whether a key is set, never the key, and changes it two
ways, as `gateway setup` does on a terminal:

- **Paste a key** into the masked field and **Save this key**.
- **Make a key from your OmniRoute password**: the portal logs in to OmniRoute's dashboard with
  it once, makes a key named `cc-smart-dev-kit-router-<machine>`, and saves that. The password
  is never stored.

Each asks first, then runs setup's own key steps, and nothing else of setup: OmniRoute is asked
with the key first, and a key it refuses (401 or 403) changes nothing and says which key it
wants. A check OmniRoute does not answer saves nothing, unless you tick **Save it even if
OmniRoute does not answer now** (setup's `--save-unchecked`): then the key is saved untested,
and the result says so in the warning colour, and stays until you try again. A key that replaces one is backed up first, and a
key made but not saved is deleted again in OmniRoute. The router reads the new key by itself:
nothing restarts. A machine with no gateway yet is set up in a terminal first (`gateway setup`
also installs the router), and the card says so. Neither the key nor the password is ever in
an answer, a log line or the live stream; both fields are emptied after a save.

### Open the portal from another computer (SSH)

The portal binds `127.0.0.1` only, so another computer never reaches it directly — that is the
point. To open it from a laptop, forward the port over SSH, with **the same port on both ends**:

```sh
ssh -L 20150:127.0.0.1:20150 <user>@<host>
```

Then open `http://127.0.0.1:20150/` on the laptop. `20150` is the portal's one fixed port
(`DEFAULT_PORTAL_PORT` in `src/ports.ts`); use that number on both sides. The same port at both
ends matters because the door checks the `Host` header exactly: with
`-L 8080:127.0.0.1:20150` the browser would send `Host: 127.0.0.1:8080`, and the portal refuses
it. The browser's own `Sec-Fetch-Site` header arrives as it always does — SSH forwards the bytes
untouched — so the door's other rule holds through the tunnel too.

**There is no sign-in.** Any program and any user account on this machine can open the page —
a Claude session running `curl` included — and can change the slots, the judge, the updates
and the workflow settings. That is a deliberate trade-off: the alternative was pairing every
browser once. What still holds: the page binds `127.0.0.1` and nothing else, refuses another
website and DNS rebinding, and every change needs the CSRF token that came with the page. And
the session-escape guard asks you before a session's shell command reaches this port, so a
session cannot switch the review gate off through it unseen. Never open the portal in the
Chrome profile Claude Code drives (its own, `claude-code`): Claude could then reach its
buttons.

**It updates as things happen.** While a page is open, the portal keeps one live connection
(`/events`, Server-Sent Events) and shows a routed request, a crew step, a plan limit, a guard's
question, an update check or a change in the heavy-job queue as it lands. Several tabs share it;
more than eight open tabs are refused with a short line instead of holding the server open. The
pages fetch their facts from read-only `/api/…` answers (the portal's own interface, not a
public API), and an action that runs a command no longer freezes anything: installing an update
shows each step while it runs, and the pages and the stream stay live. When the connection
drops, the header says "Reconnecting…" and the page keeps what it last knew; it catches up by
itself when the portal answers again.

**Every change is made in place.** A button that restarts or rewrites something asks first, in
the page, naming the exact change (Stop a crew session, save a chain, switch a slot, write a
project's own setting); then it shows "Working…" and the command's newest line, and its result
beside the button — `✓` with what changed, or `✗ Not done:` with the command's own words,
**Details** and **Try again**. The page is never reloaded to show it, so an edit elsewhere on the
page is never lost. A page drawn from mock data (`?mock=` in its address, for a look at its other
states) says "Mock data" in its header and sends nothing. A page whose subject is not there (a
crew session removed after its merge, an unknown project) says so and links back, with no
**Try again**.

The pages, each following the design the owner approved (2026-10-16):

| Screen | What it shows |
|---|---|
| **Overview** | The traffic now: requests a minute, fallbacks, open breakers, the crew sessions running, and the plan's **5-hour window** as Claude Code's status line last recorded it (its share and when it resets; the 7-day windows are written nowhere, so none is shown). Requests and the estimated cost over time, the heavy-job queue at a glance, the newest of **Needs you**, and the three **switches** — the gateway, your own judge, the opus and fable slots — each asked first and saved at once. The fallbacks and the plan limits the router saw are tabs of the requests table. |
| **Needs you** | Everything that waits for you, newest first: a crew session's question with its options (answer it here); a permission prompt in a session's terminal, with a **Copy** for its `claude attach <id>` command when the session is a crew session; each failing `doctor` check with its fix and the report group it belongs to; every open breaker with how many requests wait right now; and a held major update. When the permission prompts cannot be read (the flow report did not run), the page says so and why, never an empty list. |
| **Usage** | Tokens and the estimated cost over time, by slot, target, model and session, with each session's own totals under them. |
| **Work** | Every lead on the machine — each repository's — with its crew sessions nested: each one's state and for how long, the files it owns, what it waits for, its model and slot, its newest line, its memory over time, and **Stop**, **Resume**, **Remove** and a **Copy** of its `claude attach` command. Under them, your other Claude Code sessions of the project the portal runs in, from the last two days — a portal starts in your home folder, which is no project, so this list is empty unless you started it in a project, and the page says so — with the model of their last reply and their state — working, waiting for your answer, idle, or ended — and a **Copy** of `claude --resume` for one that is not running. |
| **A crew session's page** | Opened from Work: its brief, its steps, the diff against its base with each changed file's own lines, its memory over time, the merge check with the review and what that review still covers, the reviews recorded on its branch, and its hand-back report. |
| **Flow** | How the work moved in the last 24 hours or 7 days: agent launches and the time sessions waited for your answers per hour (per six hours over 7 days), parallel work, the guard asks that stopped them most, and the sessions' own totals. |
| **Slots** | One card per slot. **Who answers**: Claude or Custom, both named (`gateway slot <slot> claude\|custom`); Custom stays unavailable, with its reason, until a chain is saved (the judge: until every backend target passed the force-push test). **The chain**: the one in use, or the one saved while Claude answers ("Saved, not in use"); drag a target or use its arrows, add one from the backends' live model list, or type one, which the server checks with the command line's own rule before it joins (`✗ "omnirout:glm-5.3": backend "omnirout" is not in the config`). Edits stay a draft until **Save**, which asks first and runs `gateway slot <slot> <targets>` (in Claude mode it says that saving puts the chain in use). A save over a chain that changed since the page read it (another tab, the command line) is refused, and the card offers **Load it** or **Keep mine**. **Test each target** marks each one (one tiny chat to an affordable model, the force-push test for a judge). **Fallback** and **Breaker** save at once, after a confirmation (`gateway fallback`, `gateway breaker`; the judge has no breaker). Each target shows its last day from the request history. |
| **Health** | The router's counters, what holds its port across restarts (the socket unit, or the Windows task) in `doctor`'s own words with its fix, each backend and whether it answers, the targets resting, latency and errors over time, and its journal. When the router does not answer: why, the commands that show its state and its log, and **Restart the router** (`gateway setup --yes`), asked first. |
| **Guard log** | What each guard asked you or refused, newest first and paged by the server: pick a range, a guard or a session; the asks per guard over the range are charted, and the two menus offer what the range holds. |
| **Machine** | The kit's version; Claude Code's (`claude --version`) and whether `doctor --live` proved it; the Bun the portal runs on against the one the kit needs; `doctor` with each failure's fix and **Run doctor**; the heavy-job queue with its CPU and I/O weights; Updates (installed, newest, last check, **Check now**, a held major); the companion plugins (**Turn it on** for one turned off); the MCP servers setup registers; the **Browser card** (**Set up the browser**, the steps, and a masked field that saves the extension's token: the stored value is never on the page); OmniRoute (**Update** and **Roll back**, each saying what the restart costs, and [the gateway's key](#the-gateways-key-from-the-portal): paste one, or make one with your OmniRoute password); the [claude-mem card](#claude-mem-from-the-portal) (where its summaries go, its key, its fallback, and who set each); the project's auto-mode trust rules with **Write them**; Warp; and the worktrees with **Clean finished now**. |
| **Settings** | Every workflow setting, one row each: what Claude does after a finished step (auto commit, auto push, the pull request, the auto-merge rule, the merge method, the branch and the worktree), the alerts (which events, the sound, the usage-limit percentage), the switches (the status line, the session names, the heavy-job queue, the update hold), and the **crew caps** (crew sessions per lead, of those on Opus, the machine's ceiling, and the share of the 5-hour window past which a new Opus crew session waits). Each row says where its value comes from — `yours`, `this project` or `default` — and a row the project sets is read-only here. Its **Projects** tab lists every project you work in, with each one's page (below). |
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
line and **Set up this project**, which opens the form — the base branch, the branches that
start from another base, the protected branches and the three guards. Its first values are
what `cc-smart-dev-kit project init` would offer for this repo (its default branch — the
remote's `origin/HEAD`, else the repo's only branch, else `main`, else `master`, else the
branch you are on — and the branches GitHub protects), never a value this page made up. The
preview is that command's own plan, made on the server and sent to the page: a box
asks again once the typing pauses (300 ms, and at once when an edit is finished), so the boxes
follow the words, and the browser never builds the file. Each answer carries the hash of the
two files it was planned from, and **Write the files** sends it back: a project file someone
changed in between makes the write refuse ("preview again") rather than quietly write their
change away. The write itself goes through the same `applyProjectInit` (a backup, then an
atomic write), asks first, and **never commits**: commit them with the project.

**Settings → Projects** lists every project you work in, newest use first. The list comes
from Claude Code's own session records (the folders under `~/.claude/projects/`), each
worktree folded into the repository it belongs to; a folder that is gone or not in git is
left out. Each row shows when you last used it, its worktrees, whether it is set up, and
**not committed yet** when its project files differ from what is committed on the branch it
is on (the merge gate reads the file merged into the base and pushed, so commit the files and
merge them). A project that is not
set up has **Set up**: its page previews the two files with `project init`'s own plan, asks
first, and writes them, exactly as the Project card does. **Add a folder** adds a repository
no session has used yet: it must be a full path inside a git checkout, and its main checkout
is kept in `portal-projects.json` in cc-smart-dev-kit's state folder. A project's page also
shows its open pull requests and its crew branches that still wait for a merge, each with the
merge guard's own verdict (`workflow merge-check`): `allowed`, the reason it would ask, "ran
late" when the time for the branches ran out (about 8 seconds per page), or "not read" when a
fact could not be read. Without `gh` the page shows the crew branches and a line that says the
pull requests could not be read. The verdicts are kept for a minute, and a read the time cut
short is read again at the next look. The page names a project by an id from this list, never
by a path: a write reaches only a folder on the list, and **Add a folder** is how any git
checkout on this machine gets onto it.

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
runs — the same checks, the same lock, the same words (`docs/design/portal.md` § The portal). What
needs `sudo` is not run: the Machine page's Warp card shows `cc-smart-dev-kit setup --warp`
and `--remove-warp` as commands to copy, and never runs them.
Writing the auto-mode trust rules needs an explicit confirmation on the page, which stands in
for the terminal question the command line asks. The card shows the change exactly as
`cc-smart-dev-kit setup` prints it — `+` for a rule that goes in, `-` for one the project no
longer asks for, and the note when a worktree's file is not the main checkout's — and the
button carries the hash of what the page showed: a rule added to the project's file after the
page was drawn makes the write refuse ("read them again") instead of trusting a rule nobody
read. With nothing to change, the card says so and offers no button.

**How it stays private.** It binds `127.0.0.1` and nothing else; the `Host` header must be
exactly `127.0.0.1:<port>` or `localhost:<port>` (that is where a DNS-rebinding page stops);
a foreign `Origin` is refused; anything but a page load needs the browser's `Sec-Fetch-Site`
to say `same-origin` or `none`, so another page — even one on another `127.0.0.1` port, which
a browser counts as the same site — cannot load the portal's pages or files into its own;
and a change (a POST) must carry an `Origin` of ours **and** the CSRF token that came with
the page. There is no token in the address and no session cookie any more (D9): the trade-off
is that every program and account on this machine can open the page, above. A `Host` or
`Origin` that is not ours stays the one word, "Forbidden". A strict `Content-Security-Policy`
allows no inline script and nothing from the internet — no web font, no CDN. A backend key
never reaches the page: it shows as `••••a1b2`, its last four characters and nothing else
(`maskKey`); a backend's address is shown, and linked, without a user name, password, query or
fragment; and a backend's own error text is masked before a page or an answer holds it (a
backend can echo the key it was sent). And the portal stays up until you stop it — `portal
stop` — so it is there whenever you open it.

It runs from a copy in `~/.local/share/cc-smart-dev-kit/portal.js`, never from the plugin's
version folder: Claude Code deletes an old version folder some time after an update, even
under a running process, and the portal now outlives many of them. The copy is a managed
file, so `cc-smart-dev-kit restore` removes it. The session-start part copies the installed
version's bundle there before it starts it; the running server is told where the plugin is
(`--plugin-dir`), and every file it needs — the router bundle a restart installs, the
instructions, `hooks/hooks.json` — is resolved from the version Claude Code records as
installed **at the moment it is needed**; a folder a later update deleted is named in words
instead of failing.

**The pages themselves ship inside the plugin.** They are a Next.js static export
(`portal-ui/`, built from `portal/` by `bun run build:portal` and committed like the
bundles), copied beside `portal.js` into `~/.local/share/cc-smart-dev-kit/portal-ui/` — a
managed folder, so `restore` removes it too, and a version change replaces it. There is no
Next server and no `node_modules` on a machine: the portal's own Bun server serves those
files behind the same door as everything else. A version with no export (an older install)
keeps the server-rendered pages, which answer exactly as before.

**The history pages read the router's own request log** (never a prompt or an answer: the
time, the session id, the model, the slot, the target, the status, the latency, the token
counts and an estimated cost; a request whose model the list gives no price for is counted
apart, never added as $0). `GET /api/history?range=1h|4h|1d|7d|14d|30d|90d&by=target|slot|model|session`
answers one series per key, every bucket of the window included, and `GET /api/requests`
pages the newest rows first, within the same `range` (`1d` when it names none); both take
`slot`, `target`, `model`, `session` and `status=error`, and both answer empty — not an
error — on a machine that has logged no request yet. `GET /api/history/keys?range=…` lists
the slots, targets, models and sessions the range holds, for the filter menus, and
`GET /api/history/rate` answers the model requests of the last five minutes and since the
router started, for the Overview's card — the router's own counter counts Claude Code's
health pings too, and these do not.

**The guard log pages on the server too.** `GET /api/guard-asks?range=…&cursor=…&limit=…`
answers one page of the guards' questions, newest first, with a cursor for the page after it,
the asks per guard for the range's chart, and the guards and sessions the range holds, for the
filter menus. The other answers carry what a page needs to explain itself: a crew session's
changed files each with its own line counts, its memory over time, and why its merge is allowed
or refused (the review, the change after it, and what that review still covers); every open
breaker with how many requests wait right now; each failing `doctor` check with its fix and its
section; and each worktree's idle minutes and the removals auto-clean has not reported yet.

## Instructions, skills and agents

The plugin gives Claude general working instructions, skills and agents, written for any
project.

**The always-on instructions** (`plugin/instructions/core.md`): Claude works as the senior
engineer and team lead — it plans, splits the work into independent phases, places each one
(inline, a subagent, or a crew session where [`crew.enabled`](#the-workflow) is on),
starts them at the same time, never waits on them, checks each hand-back and gets one
second-opinion review per change set. Also: the role, delegation, each subagent's model and effort, review, the core
principles, how to end a turn, and keeping docs true. `cc-smart-dev-kit setup` installs them for your
user, **on by default**:

- a copy goes to `~/.claude/cc-smart-dev-kit/instructions/` (refreshed by every setup, and by the
  first session start after a plugin update — only of the installed version, or of one newer
  than the copy: a session of the older version that still runs never writes its files back);
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
  `doctor` says when the copy is behind the installed plugin. A session still running an
  older plugin never writes its files back over a newer copy: only the installed plugin
  version writes the copy (and with no record of it, only a version newer than the copy), and
  the session says why in one line on stderr.

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
values (`base`, `bases`) from the project's `.claude/cc-smart-dev-kit.json`, field
`worktrees`.

That committed import line points at **each person's own copy**. For a teammate without
cc-smart-dev-kit, or one who ran `cc-smart-dev-kit setup --no-instructions`, the file is not there, and the
import loads nothing — Claude Code gives no error. `cc-smart-dev-kit doctor`, run in the project,
names such a missing import.

**19 skills** (`/cc-smart-dev-kit:<name>`; each also loads on its own when its topic comes up):

| Skill | Use it for |
|---|---|
| `review` | Your own review before a commit, and the one second opinion per change set. |
| `plan-task` | Planning work whose design is open, in plan mode: research, questions, the plan file, approval, phases and owners. |
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
| `lead` | Leading crew sessions: register, start each phase, hear the news without waiting, route questions, merge. |
| `crew` | Inside a crew session: build the phase end to end, mark each step, ask the lead, hand back the report. |
| `audit` | A sweep of an area for one class of defect, not a diff: scope, tracks and budget, the `audit-run` workflow, then every finding proved in the code. |

The plugin ships two workflows. The `audit` skill starts `audit-run`
(`plugin/workflows/audit-run.js`): one read-only `auditor` per track, a second one to refute each
finding, and a `builder` to write the report. For a big change set, the `review` skill takes its
second opinion from `review-split` (`plugin/workflows/review-split.js`) instead of one reviewer:
one read-only `reviewer` per track, a second one to refute each finding, and the verified findings
merged and ranked. Each script fixes its agents' models and efforts — `review-split`'s on `opus` at
`xhigh` for a risky change set and `sonnet` at `max` for any other — and `agent-guard` reads them
before the run starts.

**5 agents** (`cc-smart-dev-kit:<name>`; the caller passes the model and effort on each launch, so
none is pinned in their files). Each loads the `impact-analysis` skill at start, through its
`skills:` field, and `rules-maintainer` also loads `self-evolve`. Each can use claude-mem's
`smart_outline`, `smart_search` and `smart_unfold`, and Claude Code's `LSP` tool where a
language server runs; without them, Grep and Read do the job (why each agent has the tools it
has: `docs/design/instructions.md` § Instructions, skills and agents):

| Agent | Job | Needs |
|---|---|---|
| `reviewer` | The read-only second opinion on a change set. | — |
| `rules-maintainer` | Edits to instruction files, with a duplicate and conflict check. | — |
| `ui-verifier` | Drives the running app in a browser and measures; the design verdict stays with you, on `opus` or `fable`. | the **Playwright** MCP server |
| `auditor` | The read-only sweep of an area for one class of defect; findings with evidence, hunches apart, and its coverage. | — |
| `builder` | One briefed build phase: its files only, the failing test first, the done-check run and reported. | — |

The MCP servers keep their usual tool names (`mcp__playwright__*`) because they are registered
for your user, not served by the plugin.

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
| `claude-mem@thedotmack` (memory across sessions) | `thedotmack/claude-mem` | 13.36.0 or newer |
| `frontend-design@claude-plugins-official` | `anthropics/claude-plugins-official` | any |

- **Claude Code installs a dependency only from a marketplace you added.** Without it,
  `claude plugin install cc-smart-dev-kit@cc-smart-dev-kit` succeeds with a warning, and cc-smart-dev-kit does not
  load. `cc-smart-dev-kit setup` adds each missing marketplace, and that installs the companion.
- **A companion you have already stays as it is.** A claude-mem in the range is not
  updated or reinstalled. One older than 13.36.0 stops the install: run
  `claude plugin update claude-mem@thedotmack` first. (Setup still writes the two start
  blocks for an older one: see [claude-mem](#claude-mem).)
- **You turned one off?** Setup leaves it off and says how to turn it on; cc-smart-dev-kit does
  not load while it is off.
- `restore` does not uninstall them.

## claude-mem

claude-mem (a [companion plugin](#companion-plugins)) writes a summary of every session,
keeps a memory across sessions, and puts two blocks at the start of every session. `setup`
changes its settings in `~/.claude-mem/settings.json` (`$CLAUDE_MEM_DATA_DIR/settings.json`
when you set that variable), and only there; everything else in that file stays as it is.

### The two start blocks, off

A session's start begins with claude-mem's **work state** (a to-do list, which tells the
session to use its `work_state_write` tool) and its **memory-use block** (how to use the
memories it loaded). Together they pass Claude Code's 10,000-character hook output limit in
about one start in six (measured over 14 days: 36 of 218 starts). So `setup` turns both off:

- `CLAUDE_MEM_WORK_STATE_ENABLED`: `"false"` (claude-mem 13.36.0 or newer; this also removes
  its work_state tools);
- `CLAUDE_MEM_MEMORY_INSTRUCTIONS_ENABLED`: `"false"` (claude-mem 13.35.0 or newer).

`setup` writes both whenever claude-mem is installed, whether or not the gateway is set up,
and to an older claude-mem too: a key it does not know changes nothing there. With work state
off a session has no to-do list from claude-mem, so `setup` also turns on Claude Code's own
task tools (`TaskCreate`, `TaskList`, …): `env.CLAUDE_CODE_ENABLE_TODO_TOOLS` set to `"1"` in
`~/.claude/settings.json`. They are off in `claude -p` and foreground sessions on newer models,
and on in background sessions; `1` turns them on everywhere.

- **Read a list before it goes.** claude-mem keeps its stored lists. Its `work_state_read`
  tool answers while work state is on, so read one first; after the switch is off that tool
  answers "Work state is turned off". Turning work state back on reads them again.
- **Turn one back on.** Set it to `"true"` in `~/.claude-mem/settings.json`: claude-mem's own
  default is `"true"`, and a later `setup` leaves a value you set alone (also `"true"`), while
  `doctor` shows it as your choice. With work state on, Claude Code's task tools are not
  needed; setup leaves the setting it wrote, and `restore` removes it.
- **Restart.** A new Claude Code session reads claude-mem's settings at its start, and
  claude-mem's worker reads them when it starts. `setup` prints this step when it changes them.
- **Back to claude-mem's defaults.** `restore` removes both keys, and the task-tools setting
  when setup set it, so claude-mem uses its own defaults again (`"true"` for both blocks).

### claude-mem on the gateway

claude-mem's summaries run, by default, with Claude Haiku on your own Claude
login. Its work is Haiku's, so it follows the gateway's scout slot: when the
[gateway](#the-ai-gateway-optional) is set up, claude-mem is installed (13.36.0 or newer), and
you gave the scout a chain whose first target is an affordable `<backend>:<model>`, `setup`
points claude-mem at that model, straight at its backend. A scout with no chain, or one that
starts with a Claude model, leaves claude-mem on Claude. Setup writes no fallback model:
claude-mem's own quota fallback (`CLAUDE_MEM_QUOTA_FALLBACK_*`) keeps its defaults or your
values, and the fixed Claude Haiku fallback older versions wrote there is taken out again while
it still holds setup's value. It sets five more keys in `~/.claude-mem/settings.json`
(`$CLAUDE_MEM_DATA_DIR/settings.json` when you set that variable):

- `CLAUDE_MEM_PROVIDER`: `openai-compatible`, with `…_PRESET` `custom`;
- `CLAUDE_MEM_OPENAI_COMPAT_BASE_URL`, `…_MODEL` and `…_API_KEY`: the scout chain's first
  target, its backend's address plus `/v1`, and that backend's key from `gateway.json`.

The rules:

- **Your choice stands.** claude-mem writes its own defaults into the file on its first
  run; setup changes a key only while it holds that default (`""`, or `claude` for the
  provider), or the value setup wrote there itself. One key set to anything else
  (also a key setup set and you changed since), a key pool of your own in
  `CLAUDE_MEM_OPENAI_COMPAT_API_KEYS`, or a choice you made in the
  [portal](#claude-mem-from-the-portal), and setup changes none of them and says so.
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
- **The scout has no affordable first target any more** (removed, or it starts with Claude)
  while claude-mem still holds setup's keys: setup says so, and how to fix it (run setup
  again once the scout starts with one, or `restore`).
- `restore` removes the keys that still hold what setup wrote, so claude-mem goes back
  to its own defaults; a key you changed since stays.

### claude-mem from the portal

The [portal](#the-portal)'s Machine page has a claude-mem card. It shows where claude-mem's
summaries go, the key that opens that backend, and its quota fallback, each with who set it:
claude-mem's own default, setup (from the scout slot), you in the portal, or you by hand in
the file. **What claude-mem summarises from every session leaves this machine for the model
you choose here**, and the card says so.

- **Route and model**: Claude on your own login, or a model from the gateway's live list
  (the same list, and the same check, as the Slots page: a model its backend does not list is
  refused). It sets the five keys setup sets (above).
- **Key**: the gateway's own key for that backend (what setup uses), or another key you paste
  into a masked field. The key is never shown, printed or logged in full again (its last four
  characters at most); the file stays at mode 600. A key that is one of the gateway's own
  follows the backend: move the route from one backend to another and claude-mem gets the new
  backend's key. A key you pasted stays with you.
- **Fallback** (`CLAUDE_MEM_QUOTA_FALLBACK_PROVIDER` and `…_MODEL`): what takes claude-mem's
  work while its route's provider is limited. Off (claude-mem waits), Claude (claude-mem's own
  Claude model, or one from the list), or a backend model. claude-mem has one OpenAI-compatible
  setting, so a backend fallback needs a route that is not a backend model, and a Claude
  fallback a route that is not Claude: a fallback that is the route's own provider never takes
  over, and the card says so. Since claude-mem 13.37.0 an empty fallback means Claude and
  `off` means none; before it, an empty one means none (and "off" writes that).
- **Let setup decide again** forgets your choices and runs setup's own claude-mem step: the
  route follows the scout slot again, and the fallback goes back to claude-mem's default.

The rules:

- **Each change asks first**, then runs the kit's own code: a route, key or fallback that
  sends work to a backend is checked with one tiny chat first, and nothing is written when it
  does not answer, or when claude-mem's settings changed while it checked (another tab, say).
  claude-mem reads its file each time it uses it, so no restart is needed.
- **Your choice, kept.** Each write goes through setup's lock with a backup, is owned like
  setup's keys, and is recorded as yours
  (`~/.claude/cc-smart-dev-kit/claude-mem-choices.json`): a later `setup` leaves the provider
  keys, and a fallback you chose, as they are. `restore` takes your writes out and removes
  that record, so the next setup follows the scout slot again.
- **A value you set by hand stays yours.** The card says so, and a change to it is refused
  in words: change it in the file, or remove it there to set it here.
- claude-mem not installed, older than 13.29.0, or with a file it cannot read: the card says
  why, with the command that fixes it.

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
holds it), runs the job, and gives the memory back however the job ends. Under load a job
also gives way on CPU and disk I/O, so the desktop, your sessions and your own work stay
responsive; an idle machine still gives the job every core. How it works, the kinds, the
config and the limits: [docs/jobs.md](docs/jobs.md).

| Command | What it does |
|---|---|
| `cc-smart-dev-kit job run [--kind <kind>] [--gb <n>] [--exclusive <name>] -- <command…>` | Waits until this machine (and any shared folder) has the memory, then runs the command. Its stdin, stdout, stderr and exit code pass through; SIGINT, SIGTERM and SIGHUP are sent on to the whole job. `--exclusive <name>`: at most one job with that name at a time, in order (with a kind, or alone). |
| `cc-smart-dev-kit job status` | The memory, the budget, the CPU and I/O weights (or why one is not set), and who holds or waits, here and on each shared folder. |
| `cc-smart-dev-kit job kinds` | The kinds (`tsc`, `lint:typed`, `test:run`, `test:coverage`, `build`, `image:build`, and the project's own) and what each reserves. |

The state is per user, in `~/.local/share/cc-smart-dev-kit/jobs/`. A machine sets its limits
(`budgetGb`, `reserveGb`, `launch`, `slice`, `cpuWeight`, `ioWeight`), and optional shared
folders for containers or users on one host, in
`~/.config/cc-smart-dev-kit/jobs.json`.
## The hooks

The plugin's hooks run in every project. Most stay silent in a **project without
`.claude/cc-smart-dev-kit.json`**; the ones that are about your machine, not a project —
`agent-guard`, `job-route`, `session-escape-guard`, `fable-session`, `crew-role`, `lead-notes`, `notify` and
`playwright-output` — run there too (§ Notifications below). The plugin ships no worktree hook:
every project uses Claude Code's own worktrees (§ Worktrees); the retired engine's three hook
names only print the fix where a project still wires them. Each hook runs through `bin/cc-smart-dev-kit-bun.sh`, which finds bun even when your
PATH has none: the bun `cc-smart-dev-kit setup` saved in the launcher first, then
`$BUN_INSTALL/bin/bun`, `~/.bun/bin/bun`, and bun on PATH. It starts bun with
`--no-env-file` and the plugin's own empty `bunfig.toml`, so a hook never reads the working
folder's `.env` files or its `bunfig.toml` (a project's `preload`). With no bun at all, or one
older than 1.4.3, a PreToolUse guard asks you before every call it covers (`--missing=ask`: a
guard fails closed), and every other hook writes one line on stderr and the session goes on
(`--missing=quiet`).

| Hook | When | What it does |
|---|---|---|
| `git-guard` | before a Bash or PowerShell command | Asks you before any `git push` while `autoPush` is off (the default: a push leaves the machine), and **refuses any `git push` from a crew session** (`CC_SMART_DEV_KIT_CREW` is set in its environment — a crew session commits on its own branch and the lead merges it locally, and Claude Code's own background sessions push a worktree's branch on their own; the refusal holds in a project with no `.claude/cc-smart-dev-kit.json` and whatever `ownHooks` lists). `autoPush` is read as the merge guard reads its gate: the default, your own `workflow.json`, and the project's file as committed on `origin/<worktrees.base>` — never a checkout's own copy, so a session cannot switch the question off in its worktree; a policy it cannot read asks. A `git push --dry-run` sends nothing and asks nothing. It also asks you before a force-push, a push to a protected branch (`protectedBranches`: named, matched by a wildcard refspec, or sent by a bare `git push` the way your `push.default` and `remote.<name>.push` say), `push --all` / `--mirror`, a branch deleted on the remote (`git push origin :x`, `--delete`), `reset --hard`, `clean -f`, `worktree remove -f`, a checkout or restore that throws changes away, `branch -D`, `stash clear` and an unnamed `stash drop` (they throw work away), and (with `worktrees`) a bare `git stash` or `stash pop`: every worktree shares one stash. A line is read with its tool's quoting, Bash or PowerShell. Text in quotes, quoted here-docs and comments is not a command; a substitution (`$( … )`, a backtick, an unquoted here-doc body), a shell keyword, a wrapper and its options (`timeout 60 git push -f`, `env -S '…'`, `sudo -u me …`, `doas …`), git's own options (`--config-env x=y`), a here-doc fed to `sh`, the text piped into `sh`, and `job run`'s queued command are read through. Git's own abbreviations count (`--forc` is `--force`). Not read: a git alias (`-c alias.x=…`, or one of your own), `branch -f`, `checkout -B`, `switch -C`, brace expansion (`{git,push}`), a program named at run time (`$(…)`, a variable), `-EncodedCommand`, `ssh`, a script file, a `cd` it cannot follow (`cd -`, `cd ~/x`, `cd $DIR`), and a branch it cannot name; `git checkout <name>` cannot tell a file from a branch, so it stays silent. **It stops mistakes, not a process that sets out to get past it**: a session with a shell can always run what it means some other way. |
| `main-folder-guard` | before Edit, Write, NotebookEdit | With `worktrees.guardMainFolder`: refuses an edit of a file in the main checkout itself, and says how to get into a worktree. |
| `playwright-output` | before every `mcp__playwright__*` call | Puts a screenshot or snapshot the caller names by a relative `filename` into the browser's output folder instead of the folder the session runs in (`@playwright/mcp` resolves a caller-named file against the process's own folder). |
| `merge-guard` | before a Bash or PowerShell command | Asks you before a command that merges a pull request, and before one that opens or readies one (`openPr`). The forms it reads: `gh pr merge` (`gh pr -R owner/repo merge 5` included), `--auto` (an armed merge lands once the checks pass, with nobody watching), a `gh alias` that expands to one (read from `gh alias list`), and — asking whatever the policy says — a `gh api` call to the pull-request merge endpoint (`repos/o/r/pulls/5/merge`, any method spelling) or a GraphQL query that names `mergePullRequest` / `enablePullRequestAutoMerge`. **Every merge in the command is judged**: `gh pr merge 5 && gh pr merge 6` checks both, and the first it does not allow asks, naming that pull request. It reads three facts, read-only: the pull request (`gh pr view`), the repository's default branch (`gh repo view`), and its required checks (`gh pr checks --required`; a skipped one counts as passing, GitHub's own rule). It lets a merge through only when `autoMerge` is on, the pull request's base is the project's integration base, every required check passed, and — with `reviewBeforePush` on — a [recorded review](#the-workflow) covers the head: a review of the head itself, or of an earlier commit of its branch whose change since stays within `fixesAfterReview`. **For an exact `gh pr merge <n>` with flags gh has, that passing merge is answered `allow`**: it runs with no question, and no auto-mode "Merge Without Review" block either — the guard's own checks are what protect it — with a short reason. Any other passing form (a wrapper, a second command, an alias, a branch or URL instead of a number, a flag this guard does not know, an armed `--auto` merge) stays silent as before, so auto mode's own rule still applies; an unknown flag asks; and **a crew session never gets `allow`** (it never merges: the lead does). **It reads that policy as committed on the pull request's base** (`origin/<base>`, as last fetched), never from a checkout's own copy of `.claude/cc-smart-dev-kit.json`: a session cannot switch the gate off by editing its worktree's file. No such ref, no file there, or a file it cannot use asks you. For a pull request opened (`gh pr create`, `gh pr new`) or made ready (`gh pr ready`), `openPr` decides: `off` asks before any of them, `draft` lets one that opens as a draft through and asks for one that does not (`--draft`) and for every `gh pr ready`, `ready` asks about neither. **A pull request that would open outside the base its head branch belongs to also asks, naming both branches**: its `--base` (`-B`) is compared with `worktrees.base`, or with the `worktrees.bases` base for that branch (the longest prefix that matches); with no `--base` the pull request opens into the repository's default branch (read with `gh repo view`, then git's `origin/HEAD`), and asks when that is not the base. It asks, never refuses: you may mean it. It reads the same forms (a `gh alias`, a `gh api` POST to the repository's pulls endpoint, the GraphQL `createPullRequest` / `markPullRequestReadyForReview`) and the same policy, committed on `origin/<worktrees.base>`. **A crew session never opens a pull request**: `gh pr create` pushes the branch, so it is refused whatever `openPr` says — in a project with no `.claude/cc-smart-dev-kit.json` and whatever `ownHooks` lists, too. Every other case asks you, with the reason it asks; so does a merge that names a repository other than this project's own (`--repo`/`-R`: the policy covers this repository only), one whose earlier steps change the folder, branch or repository it acts on (`cd`, `git switch`, `GH_REPO=…`, `env`), and a `gh` that is missing, fails, or answers something it cannot read. A merge with `--admin` (any value) always asks, whatever the policy says, naming the pull request: `--admin` merges past the repository's branch protection — its required reviews (a code-owner approval among them), its required checks and its merge queue — so you decide each one. It asks rather than refuses, because a release may use `--admin` on purpose. In a project without `.claude/cc-smart-dev-kit.json` it stays silent, like every project hook. |
| `message-guard` | before SendMessage | Refuses a message to a session that works outside this repo (ListAgents lists every session on the machine). A crew session's message to another crew session of this repo must carry the first line `crew tell` writes — `[<phase>] CONTRACT:` or `[<phase>] QUESTION:` — and the refusal names `crew tell`; a message to its own lead is refused with the `crew report` route (the lead hears its crew through the recorded report, never a raw message), and a message from your lead, and one to a session the store does not record, is not judged. The crew rule holds in a project with no `.claude/cc-smart-dev-kit.json` and whatever `ownHooks` lists. |
| `agent-guard` | before an Agent launch, and after it for the record | **Machine-wide** (it runs with or without `.claude/cc-smart-dev-kit.json`): it resolves the model the launch really runs on and holds the model rules. **It judges the model and effort Claude Code really gives the launch, after Claude Code's own overrides**, read from the hook's environment (a settings file's `env` reaches it there too): `CLAUDE_CODE_SUBAGENT_MODEL_FORCE` (on as `1`, `true`, `yes` or `on`) puts every launch on `CLAUDE_CODE_SUBAGENT_MODEL`, or on the session's own model when that is unset or `inherit` (one the guard cannot read counts as the `opus` tier); next, `CLAUDE_CODE_WORKFLOW_SUBAGENT_MODEL` puts every Workflow `agent()` on its model (never an Agent call); next, the call's own `model` — a plain `CLAUDE_CODE_SUBAGENT_MODEL` never beats it. `CLAUDE_CODE_EFFORT_LEVEL` sets the effort of every launch, whatever the call names. Under FORCE or `CLAUDE_CODE_EFFORT_LEVEL`, Claude Code takes `model` or `effort` off the Agent tool, so such a call names neither and is judged on what the variable sets, never refused for it; an ask or a refusal names the variable ("This launch runs on `haiku` because `CLAUDE_CODE_SUBAGENT_MODEL_FORCE` is set …"). `CLAUDE_CODE_EFFORT_LEVEL=auto` (the model picks its own default, never `max`) is your own choice, like a fork's effort: allowed on Claude Sonnet and Haiku, allowed with no question on the `opus` tier, and the `fable` tier's reason-line rules as always. A `CLAUDE_CODE_EFFORT_LEVEL` no subagent may run at (`low`), or anything but `max` (`auto` included) on an affordable slot, refuses every launch until you change or remove the variable, and the message says so. A fork keeps its own rule (below), and the record names the model the launch really ran on. Without an override, a launch with no `model` or no `effort` is refused (it would inherit the session's, which nobody chose); `effort` `low` is refused on every model, a Claude model and an affordable slot alike (a subagent runs at `medium`, `high`, `xhigh` or `max` only); an affordable gateway slot needs `effort: "max"`: a slot key, a `<backend>:<model>` target, or `haiku` / `sonnet` (or their ids) while the gateway is on and that family's slot (scout, worker) has a chain whose first target is a backend, read from `gateway.json`; with no chain, or one that starts with a `claude-…` model, the launch is Claude — a name no rule knows (`best`, `opusplan`, `default`, …) is the `opus` tier without a proved family, so it asks you at every effort (refused in `claude -p`): it may stand for a higher tier; **`opus` and `fable` mean the TIER, whatever model answers behind them** — an override, or the opus or fable slot's chain, that points one at another vendor keeps the tier's rules, is never affordable and never forced to `max`, and the question names both (`` `opus` (answered by openai:gpt-5.5) ``); a name never runs below the tier of what answers it — `sonnet` whose override or worker chain is a Claude Opus id is the `opus` tier; **a launch read as Opus (the `opus` name, a Claude Opus id, the opus slot) runs with no question at `medium`, `high` or `xhigh`** — any agent, any purpose, review or not, no reason line needed — and **asks you at `max`**, naming the model and the effort (in `claude -p`, with nobody to answer, a `max` launch is refused and the message says to run it at `medium`, `high` or `xhigh`, or in an interactive session); an `Opus reason: <word>` line is optional, and only names the purpose in the record — but `Opus reason: ui`, and `Fable reason: ui-design`, declare UI/UX work: **such a launch runs only on `opus` or `fable`, at `high`, `xhigh` or `max` (`UI_POLICY`), and is refused on Sonnet, Haiku or an affordable slot, or below `high`**; a fork runs at the session's own effort, which you chose, so an `opus`-tier fork is allowed; on the `fable` tier a read-only agent (Plan, Reviewer, Explore, auditor) with a `Fable reason: <word> - <why>` line (punctuation after the word is fine) asks you — `build` is the builder's own word, refused there — and an agent that can change files — a builder, or a fork — asks with `Fable reason: build - <what you asked for>`. A fork always runs on the session's model and effort (Claude Code ignores a `model` a fork is given) and needs no `model`; an unknown session model counts as the `opus` tier. A **Workflow** call is judged the same way, from the `agent(...)` options in its script — a launch whose `model` is built at run time, or whose `model` or `effort` an operator changes (`"high" && "max"`), is refused, never guessed, and a script that hands `agent` or `workflow` around (`const run = agent; run(…)`, `agent?.(…)`) or builds a call's options at run time (a `...spread`, a computed key) is refused whole — because (proved live) a workflow's agents run inside the tool and pass no hook of their own. **Every run is judged, however it names its script**: an inline `script`; a `scriptPath` (relative to the session's folder); a saved workflow's `name` — the `.js` file whose `meta.name` is that name, in `.claude/workflows/` from the session's folder up to the repo root, then in `~/.claude/workflows/`, the nearest first; a plugin's `<plugin>:<name>`, from that plugin's installed `workflows/` folder; and each workflow its script nests with a literal `workflow("<name>")` or `workflow({ scriptPath: "…" })`, one level deep. A nested workflow named at run time, or one that nests again, refuses the whole call. A run whose script the guard cannot read — a built-in workflow such as `deep-research`, a missing file, two files in one folder that claim the same `meta.name`, a `resumeFromRunId` — asks you, saying why, and is refused in `claude -p`. A deny refuses the whole call, so none of its launches is recorded, and an ask names every launch that asks. Every premium-tier launch is recorded once it is known to run — an allowed one before the call, an asked one after it ran (you said yes); one you refuse never; each launch of a workflow on its own line — and `cc-smart-dev-kit usage` counts them by the effort they ran at and by why: for the `opus` tier its `Opus reason:` word when the prompt has one; for the `fable` tier its `Fable reason:` word. **In a registered lead's session, a launch that can change files waits for the crew queue** (D59): while a `crew start` from that lead would queue right now — its `perLead`/`perLeadOpus`, the machine's `max`/`maxOpus`, the free memory, or, for an opus-tier launch, the 5-hour usage window — the launch is refused, with the cap that holds and the `crew start` step, because a builder subagent runs outside every one of those counts and has none of a crew phase's worktree, review, report gate or to-do list. The built-in `Explore`, `Plan`, `claude-code-guide` and `statusline-setup`, the kit's own `cc-smart-dev-kit:reviewer`, `:auditor` and `:ui-verifier`, and a Workflow that names one of the kit's own read-only ones (`cc-smart-dev-kit:audit-run`, `:review-split`, with no `script`, `scriptPath` or `resumeFromRunId`) are never held; anything the guard cannot work out — no lead record for the session, a project file or a store it cannot read — lets the launch through. |
| `session-escape-guard` | before a Bash, PowerShell, Edit, Write or NotebookEdit call | **Machine-wide**, and `ownHooks` cannot switch it off. Stops a session from loosening its own limits. It **refuses** `cc-smart-dev-kit workflow review-done` (a review is recorded by the review-record hook when a review agent returns, never by the session) and any `cc-smart-dev-kit` command run with `CLAUDECODE` removed (`env -u CLAUDECODE …`, `CLAUDECODE= …`, `unset CLAUDECODE; …`, `env -i`, `sudo`): the commands that change your settings refuse to run inside Claude Code, and this keeps a session from dropping the marker. It **asks you** before a command that reaches the portal's port (20150) on this machine — the portal has no sign-in — and before an Edit or Write of a `.claude/cc-smart-dev-kit.json`, of `~/.config/cc-smart-dev-kit/` (your workflow and gateway settings), or of the kit's state folder (the review record) — a shell line that writes them asks the same way: `>`, `>>`, `tee`, `sed -i`, `cp`/`mv` onto the path, `dd of=`, and PowerShell's `Set-Content`, `Add-Content`, `Out-File`, `Copy-Item` and `Move-Item`. Reading one (`cat`, `grep`) asks nothing. It does not read a script file, a port held in a variable, a target it works out when it runs (unless the line also names one of those files), or a write by a program it does not know. |
| `fable-session` | a session starts; a model switch; each answer ends | **Machine-wide**: when the session's own model is the `fable` tier — Claude Fable, or a model an override points that tier at — it shows *you* one line, once a session: the premium tier uses your plan's limits faster than Opus, so switch with `/model` if you did not mean to. Nothing goes to Claude, never an error and never a block. A session start judges only the `model` the start names; a switch judges `to_model` — the model the session moved TO — so the line appears AT the switch; a finished answer is judged by the model that answered it, which is the catch-all for a Claude Code that fires no `PostModelSwitch`, and can never fire for a model the session has already left (the old `UserPromptSubmit` read was one turn behind: it missed the switch to Fable and warned after the switch back). The line was seen live on a real session (2026-10-17); that `systemMessage` shows on `PostModelSwitch` and `Stop` is not proved yet (the contract's § Relied on, not proved yet). |
| `job-route` | before a Bash or PowerShell command | **Machine-wide**, and `ownHooks` cannot switch it off: it judges what a line does, whatever the project's file says. **Both shells**: it reads a Bash line and a PowerShell line in that tool's own dialect, so the judge is not stepped around by changing tools on Windows; the queue rewrite below stays Bash-only, because its rewritten line is a `sh` line the PowerShell tool cannot run. **Launches**: a raw `claude --bg` **asks you** in an attended session — and is refused in `claude -p`, where nobody answers — showing the `crew start` line that records the session, gives it a worktree and a lead, and hears its report; `claude -p` is judged by the same launch policy as every Agent launch (its `--model` and `--effort`: no model refuses, the `fable` tier asks, the `opus` tier at `max` asks), and a `Fable reason:` line in its prompt counts as it does for an agent; a crew session's lead command — `crew start`, `answer`, `stop`, `rm`, `resume`, `watch`, `lead`, `lead tell` — is refused (it hands the need to its lead, and the hook's own environment is the session's own, so unsetting the variable on the command line does not get past it). **Polling** for crew news — a `crew list`/`crew status` or `claude agents --json` read in a `while`/`until`/`for`/`foreach` loop or a `watch`, or next to a `sleep`/`Start-Sleep` — is refused: a crew session's news arrives by itself, through the lead's watch and the monitors. **The route**, with `"jobs": { "route": true }`: a heavy command (the project's own [kinds](docs/jobs.md#kinds)) is sent through the machine's queue — rewritten to `cc-smart-dev-kit job run --kind <kind> -- <command>`, byte for byte the same command. Only a line whose every command is heavy, a `cd` or an assignment is queued: anything else runs raw. Claude Code matches your own Bash rules (`deny`, `ask`) against the command it runs, and a rewritten line holds your command as one quoted word, so a queued `bunx tsc && rm -f x` would hide the `rm` from a `Bash(rm:*)` rule (proved on 2.1.308). A command already inside `cc-smart-dev-kit job run` is left as it is. A name the project's `package.json` defines as a script is matched only by a `script` kind, never by a tool of the same name, so a `tsc` script that already wraps the job is not wrapped again. **In a lead** (`crew lead`), a CI watch (`gh pr checks --watch`, `gh run watch`), a routed heavy job and the project's full check (`bun run check`, `npm run check`, … its package manager's `check` script) are moved to the background with `run_in_background: true`, so the lead never waits on them. |
| `after-merge` | after a pull-request merge | With `worktrees`: the steps to clear the worktree that was merged, and, for a merge into `worktrees.base`, the message to send **the other leads of the repo and your own sessions — never a crew session**, which follows its own lead's branch and must not take the base in; each other lead also gets one `merge` event, so its watch says the line without waiting for the message. It also starts the background clean of finished worktrees (once per merge, `worktrees.autoClean`). The message says what to do after the merge too: never commit unfinished work just to take it, run the install your project uses if the merge changed a lock file, and run the tests the merge touched. Noted forms: `gh pr merge`, `gh pr -R owner/repo merge 5`, a `gh api` merge whose path names the pull request, and a `gh` alias that expands to one ([The hooks](#the-hooks) has the guard's row). A form that names no pull request — a shell alias, a GraphQL merge, a runner such as `xargs` — gets no note. Its own calls (the alias list, the worktree list, `gh pr view`, the origin) share one 25 s budget inside the hook's 30 s, so they cannot add up past it: a note that would not fit is skipped. |
| `review-record` | when a subagent starts, and when it finishes | When the agent is one `reviewAgents` lists (the plugin's reviewer by default): notes the commit the session's working folder is on at its start, and its branch, and records that start commit on that branch at its end: commits made while it read count as change after the review. It is the record the merge guard reads for a merge it would make with no person watching ([The review record](#the-workflow)). It writes nothing for an agent that stopped inside its own worktree. |
| `subagent-background` | when a subagent finishes | A subagent never hands back while background work it started still runs — a Bash command or a subagent it launched. It blocks the stop **once**, with one plain reason ("Your background work is still running: wait for it or stop it, then report."), and the subagent goes on with that reason; the stop the block itself caused is never blocked again, and it gives Claude no context. Only the agent's **own** work counts: the input's list is the session's (a background subagent appears in its own list, and a foreground subagent sees the main session's background commands), so the hook keeps a task whose id appears in a tool result of the subagent's own Bash call (`Command running in background with ID: …`) or Agent call (`agentId: …`) — never an id in its brief or in a file it read, which is not work it started. Nothing is blocked when it cannot read that transcript, and a project without `.claude/cc-smart-dev-kit.json` sees nothing. |
| `verify-gate` | each answer ends | With `checks.fast`: one **block** when this session changed files after the last Bash or PowerShell call that ran the check, naming the command. Silent on the stop its own block caused (`stop_hook_active`), in a crew session (its report gate answers), on a turn that still waits on background work, with no `checks.fast`, and when the transcript cannot be read. The reminder is given once per change — a change after it earns the next one — so a check that fails gets one reminder and never traps the turn; the notifier's "finished" alert waits for the stop that really ends the turn. |
| `worktree-leftovers` | a session starts | With `worktrees`: names the worktrees that are finished (every commit on `origin/<base>`, nothing uncommitted, no running session, idle for an hour) or whose folder is gone — never a crew session's worktree or a locked one, which `worktrees --clean` keeps, so naming them would send you to a command that does nothing — says once what the background clean removed, and starts that clean (at most once an hour per repo, never in `claude -p`, `worktrees.autoClean`). At an attended start it also adds up to three short lines about the main checkout — on another branch than `base`, behind `origin/<base>` as git already knows it, or in the middle of a merge, a rebase or a cherry-pick — read-only and with no fetch. With `worktrees.guardMainFolder` on, each such line names the command for the person to run in the main checkout, never a step for the session; a fast-forward is always `git merge --ff-only`. It removes nothing itself. |
| `session-name` | a session starts; each prompt | With `sessionNames`: asks the session to name itself after its task, then sets that name at the next prompt. A recorded lead is left alone: its role name is `lead-notes'`. A crew session is left alone too: `crew start --name` named it, and that name is its address for its lead, `crew answer` and the message guard. |
| `crew-role` | a crew session starts, resumes or compacts; each prompt; before `AskUserQuestion` and `ExitPlanMode`, and before each `Edit`, `Write` or `NotebookEdit`; each answer ends; a turn ends on an error | **Machine-wide**, and silent unless the session is a crew session (`CC_SMART_DEV_KIT_CREW`, set by `crew start`). At a start it adds the **role card**: its name, phase, owned files, its brief's path, the report line, the `crew tell` line and the git rule (commit on its branch, never push). **It also checks the session's own folder against its worktree**: an open crew session anywhere else is marked failed with the reason (the lead's watch then stops it), and its card says to do nothing and end the turn. It **refuses** `AskUserQuestion` and `ExitPlanMode` with the `crew report --question …` step: a crew session asks its lead, never you. **It refuses the session's first `Edit`, `Write` or `NotebookEdit` until its to-do list has a task**, with the step that names it: look the task tools up (`ToolSearch` with `select:TaskCreate,TaskUpdate,TaskList`), then one `TaskCreate` per part of the brief, each with its done-check. Once a task exists the hook answers from its own cache and reads nothing more, and the card at the start names the same first step. **A prompt you type into a crew session is recorded**: one event with its first line, and the lead's watch prints it, so the lead reads the next report against the brief; a message from another session, a monitor's line and the lead's own resumes are not your word and are recorded as nothing. At the end of a turn it keeps the session's last line on its record, and blocks **once** with the report line when the turn ended on a step with no report; it gives Claude no context (a Stop hook's context starves hand-backs), and stays out of a turn that waits on background work. When a turn ends on a model limit (`rate_limit`, `overloaded` or `server_error`), it marks the crew session **paused** with what it waits for — its gateway slot's breaker, Claude's plan limit, or nothing the router explains — and the lead's watch resumes it once the gateway answers again. |
| `lead-notes` | a session starts; each prompt | **Machine-wide**, and silent unless the session is a lead recorded in this repository (`crew lead`). **At a session start** — a start, a resume, a clear or a compaction — it adds one line first: your crew sessions build the work, because your context is re-read on every turn; never at a prompt and never on an edit. Each turn adds **one line** about what changed since its last turn — among its crew sessions, a note another lead told it, a file clash, a merge another lead made into the base — the newest store event, as the watch prints it, and how many more there were — from a per-lead cursor, so nothing is said twice, even after a restart. **While your session has no to-do list** it adds one more line at each prompt: put the person's asks and your open work on it (`TaskCreate`), and keep it true as they move — a reminder, never a block, and gone once a task exists. At a prompt it also **names the session** `LEAD <tag> <plan>` (`sessionTitle`, beside the line in one answer), no setting needed: never when the session is already called that, and never again once the kit set it — a `/rename` you give it after that stays, and a new plan registered with `crew lead` takes its new name. |

**A project that still has its own copy of a hook says so**: `ownHooks` in its
`.claude/cc-smart-dev-kit.json` lists the plugin hooks that copy replaces (`["git-guard"]`), and
exactly those plugin hooks stay silent there, so nothing runs twice. `agent-guard` is
machine-wide — it runs without cc-smart-dev-kit.json too — but it is in that list like the others,
so a project with its own Agent guard silences it the same way. `job-route` and
`session-escape-guard` are the opposite: `ownHooks` cannot switch them off, because they limit
what the session itself may do (`job-route` judges every launch, whatever a file the session
can edit says). A project file that still lists one keeps parsing — the name silences
nothing — and `doctor` prints one `·` line saying it can go. Only that list counts:
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
| a permission prompt, an MCP prompt, a background agent or crew session waiting | `Claude needs you · <session>` |
| a question (`AskUserQuestion`) or a plan for your OK (`ExitPlanMode`) | `Claude asks you · <session>`, with the question |
| the turn ended | `Claude finished · <session>`, with the turn's last answer |
| the turn died on an error | `Claude stopped · <session>`, with the error |
| agent view: a session waits, or finished or failed | `Claude needs you`, `Claude finished` or `Claude stopped`, with the list's message |

`<session>` is the session's `/rename` name when it has one, else its folder. Agent view's
alerts carry no session name: Claude Code raises them in the list's own process, and the
message says which session it is. Questions need
a hook of their own: Claude Code raises no notification at the moment Claude asks. A few
waits stay quiet on purpose: the idle wait (the "finished" alert already announced that
turn), the permission prompt that follows a question about six seconds later (the same wait),
a "finished" alert for a turn another session started (a merge broadcast wakes every session
of a repo), the same error twice in a row (until a turn ends well), and a stop at the plan's
usage limit **where the `stop-failure` hook shows that alert itself** (a desktop, and the
gateway set up — never two alerts for one stop). Where that hook has no alert to show (no
desktop, no gateway), the stopped turn is this hook's alert like any other.

**Agent view** (`claude agents`, the list of sessions) raises its own alerts while the list is
open: one for a session that needs your input, and one when a session finished or failed.
Two limits are Claude Code's own: the list alerts only for a session it saw in another state
first (one that starts and waits or finishes within seconds gives none), and **while you are
inside a session you opened from the list, it raises no alert for the others**. To keep every
alert, leave one tab on the list and open a session in another tab with
`claude attach <name>`. The
first says `Claude needs you`; the others say `Claude finished` or `Claude stopped`, and the
list's message says which session and how it ended. **Agent view runs only the hooks in
settings files, never a plugin's**, so `cc-smart-dev-kit setup` writes one user-level
`Notification` hook in `~/.claude/settings.json`, with the matcher
`agent_needs_input|agent_completed`. It runs `cc-smart-dev-kit hook notify` through the
launcher, so a plugin update never breaks it. `cc-smart-dev-kit restore` takes the hook out,
`doctor` says when it is missing, and every hook of your own stays as it is. If you edit that
entry (a longer timeout, a redirection), it is yours: setup leaves it and adds no second one,
and `doctor` shows it as information, never a failure. If setup replaced a hand-written entry
that ran the plugin's own `dist/notify.js`, `restore` removes the managed entry and does not
bring the old one back: it named a version folder an update deletes, and the file's backup has
it. **A background session** (one Claude Code
started outside a terminal) shows no alert of its own: it inherits the display and terminal
variables of the program that started it, so its own alert would go to the wrong place. Agent
view is the one place its alerts come from while the list is open; with no list open, it does
not alert.

**A desktop** shows the alert through `notify-send` on Linux (it needs a desktop:
`DISPLAY` or `WAYLAND_DISPLAY`) or `osascript` on macOS, and plays the freedesktop sound
when `paplay` is installed. **An SSH session** with no desktop to show it on gets the same
alert in the terminal you are looking at, as an OSC 777 notification — no `notify-send`
needed on a server: Claude Code writes the sequence for the hook (2.1.141 or later, wrapped
for tmux itself), and for an event whose answer Claude Code does not read (the usage-limit
alert) the hook writes it to the terminal device Claude Code's own session is attached to.
**When the terminal at the far end of the SSH session is Warp**, the alert goes in Warp's own
agent format instead: Warp shows its popup while it is in front, and a desktop notification
with a sound while it is not (proved live on a Windows PC reached over SSH, 2026-10-18). A
plain OSC 777 gives only a silent Windows notification there. A Warp tab sends nothing over
SSH by default, so the client has to say it is Warp — with `LC_TERMINAL`, which sshd lets
through with its usual `AcceptEnv LANG LC_*` (the Debian and Ubuntu default):

```sh
ssh -o SetEnv=LC_TERMINAL=WarpTerminal <host>
```

or one line in that host's block of `~/.ssh/config`:

```
Host <host>
  SetEnv LC_TERMINAL=WarpTerminal
```

`ssh -G <host>` shows what the client will send. Inside tmux, a pane keeps the variables of
the moment its tmux server started: after you change `SetEnv`, restart tmux, or the alert
keeps its old form. A server whose sshd does not forward
`LC_TERMINAL` needs the `sshWarp` fallback setting below.
**Inside Warp** Warp's own
Claude Code plugin shows a finished turn, a question, a permission prompt and an error
itself, so ours stays quiet and plays only the sound — except a question, a waiting agent or
agent view's finished/failed alert (Warp's plugin has no such alert), which may sit in a tab
you are not looking at: those stay ours. With no desktop, no SSH and
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

One settings file, `~/.claude/cc-smart-dev-kit/notify.json` (all three keys optional):

```json
{ "desktopSound": true, "sshBell": false, "sshWarp": false }
```

`desktopSound` (default `true`) plays the freedesktop sound with a desktop notification.
`sshBell` (default `false`) sends a terminal bell after an SSH alert, for a terminal that
ignores the notification. Not with Warp at the far end: Warp decides the sound itself.
`sshWarp` (default `false`) treats the far end of an SSH session as Warp when nothing else
names it, so the alert goes in Warp's agent format. Turn it on only when you connect from
Warp: another terminal ignores the sequence, and the alert is lost.

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

**Google Chrome only.** The MCP drives Google Chrome (`--browser=chrome`) and its own profile
folder (`~/.config/google-chrome` on Linux), so the plugin looks for Google Chrome alone — in
`/opt/google/chrome`, `/usr/bin` and, on macOS, `/Applications` or your own `~/Applications`. A
Chromium keeps its profiles elsewhere, so it is not reported as Chrome. A profile you made in
Chrome's own **Add profile** dialog and named `claude-code` (its folder is then `Profile 2` or
similar) is found by that name, and the MCP is told that same folder, so `doctor` and the
browser can never disagree about which profile it is.

Why your Chrome and not a browser of its own: you see what Claude does, you can sign in once in
that profile, and there is no second browser of ours to keep alive. The costs, both upstream and
neither planned to change:

- **Every connection brings the `claude-code` window to the front and switches its active tab**
  (microsoft/playwright#42343, closed as not planned). Nothing here can stop that.
- **The `claude-code` profile must hold the Playwright extension and nothing else.** A second
  extension that injects a frame into pages breaks the session (microsoft/playwright#43230, open).
  `doctor` names any other extension in that profile; `browser setup` says the same. **What
  counts as another extension is Chrome's own record, never the folders on disk**: a folder with
  a manifest, and a location that is not one of Chrome's own (a component, an external
  component, or an extension Chrome installed for itself) — so Chrome's `Temp` folder while an
  install runs, a record left behind after an extension is gone, and built-ins like Chrome Web
  Store Payments (which are hidden from `chrome://extensions` and cannot be removed there) are
  not named. An extra extension that IS there is named by its manifest name, with its id.
- **There is no headless mode.** A machine with no desktop cannot use the browser at all — and the
  first browser call says so in one line instead of waiting out the MCP's deadline.

**Chrome closed is not a problem.** After a machine restart Chrome is closed, and that used to
leave the browser broken until you opened Chrome by hand. Now the first browser call starts your
own Chrome with the `claude-code` profile itself, on your desktop — on Linux from a background
session too: it takes the desktop's display settings from your graphical session, which a
background session does not inherit. It goes on once Chrome is up, so the call works with nobody
at the desktop. A Chrome that cannot be started — no reachable desktop, or an error of Chrome's
own — is one line at once, naming the one step: open Google Chrome with that profile, then start a
new session.

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
   (`cc-smart-dev-kit portal`, § The portal). Then start a new Claude session. **Paste the line
   itself**; the bracketed-paste markers some terminals wrap a paste in
   (`ESC[200~` … `ESC[201~`, Warp among them) are stripped, as is a stray CR — a token that
   arrives with them is saved, not refused. Every path that saves nothing (Ctrl+C, an empty
   line, a shape that is not the token's) exits non-zero and says why, so a script around it
   cannot walk on with no token file.
6. The profile's own name: `browser setup` writes it into **both** files Chrome reads it from —
   `Local State`'s `profile.info_cache.claude-code.name` and the profile's `Preferences`
   (`profile.name`) — so the profile shows as `claude-code` rather than "Person 1". Chrome
   rewrites both from memory while it runs, so this happens only with Chrome closed: when it is
   running, `browser setup` says so and you run it again after closing Chrome (or rename the
   profile in Chrome's own menu).

`cc-smart-dev-kit setup` prints the same state and the same steps, and never reports the browser
ready while the token is missing; it is read-only there, so the one command that opens the window
is `browser setup`.

Where the token lives, and where it does not: `~/.config/cc-smart-dev-kit/playwright-extension.token`,
mode 600 on Linux and macOS, readable by you alone (on Windows a file mode says nothing: your user
profile's own permissions keep it yours); the launcher puts it in the Playwright MCP child's
**environment**, never in a command line (`argv` is world-readable in `/proc`) and never in
`~/.claude.json`. No command, page or log ever prints its value: the portal's Browser card shows a
masked field and says "a token is set".

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
  the `playwright-output` hook rewrites a relative name into that output folder first, and refuses
  a relative name with a `..` in it. A path a session gives in full is left as it is. The hook acts
  only while the live `playwright` server is the one setup registered.
- **The MCP runs in that output folder, never in your project's.** Claude Code starts
  `browser mcp` in the session's folder; bun reads the working folder's `bunfig.toml` (its
  `preload`) and `.env` for every bun it starts, and bunx looks in its `node_modules` first, so
  in a project's folder the process that holds the token would run the project's own code. Give
  a file to upload by its full path: a relative one is read from the output folder.
- **`browser check`** proves all of it on your real Chrome: a connection with no approval page, a
  `file://` page, a screenshot the server names and one a caller names, an upload through the MCP's
  file-upload tool, a download, and `browser_close`. Run it when the browser misbehaves.
- **Nothing here is a second browser.** The plugin starts no browser of its own and keeps no profile
  of its own. When Chrome is closed it starts YOUR Google Chrome, with the `claude-code` profile,
  and it never deletes one. The single thing it may write inside Chrome's own folder is the
  profile's **display name** in `Local State`, and only while no Chrome is running on that user data
  folder (`restore` puts that one name back; every other byte of that file is left as it is).
- **What 0.3.0 left is left alone.** 0.3.0 kept its shared profile at
  `~/.local/share/cc-smart-dev-kit/playwright` (with its file picker beside it) and started a
  **detached** Chrome on that folder. Nothing here reads or deletes either — the folder may hold
  sign-ins, so removing it is your call. `doctor` names the folder and the exact command that
  deletes it, and, while that old Chrome still runs, names its pid: its debug port has no
  password, so any program on this machine can drive that signed-in browser until it is closed.
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
    channel mapping at all (the plugin no longer looks for a Chromium).
11. **Uploads from the output folder**: the MCP now runs in the output folder, so a relative
    upload path is read from there. Check that `browser check`'s upload (a full path) still
    passes, and that a session that names a file relative to its project gets a clear error.
12. **A Chrome the kit starts, after a restart**: with Chrome closed, the first browser call must
    start it in the `claude-code` profile and connect with nobody at the desktop — run
    `browser check` with Chrome closed, from a terminal session and from a background one (the
    launcher takes the display from the systemd user manager there), on Linux. With no reachable
    display at all, the call must end at once with its one line, never wait 30 seconds. Owed:
    proved in tests (`src/browser/chrome-start.test.ts`), not yet live.
13. **A profile Chrome's own dialog made** (`Profile 2`, named `claude-code` in Chrome): the MCP
    is told `--profile-dir-name=Profile 2` and must connect to that profile.
14. **`doctor` must not open a page.** Its MCP check runs `claude mcp get playwright`, which starts
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
| `playwright` | The browser ([The browser](#the-browser)): the launcher, `browser mcp`, on your own Chrome through the Playwright extension. On Windows it starts the `.cmd` launcher through `cmd.exe /c` — Claude Code starts the server as a program, and a program there cannot run the `sh` launcher. |
| `sequential-thinking` | `@modelcontextprotocol/server-sequential-thinking`, at a pinned version, through `bunx`. |
| `tavily-websearch` | [Tavily](https://tavily.com)'s remote web-search server (`https://mcp.tavily.com/mcp/`). Its key is **never** written into a registration or printed: the header carries `Bearer ${TAVILY_API_KEY}`, which Claude Code fills in from its own environment at connect time. |

- **The Tavily key**, in this order:
  1. `TAVILY_API_KEY` in your environment, set by you: nothing for setup to do.
  2. `env.TAVILY_API_KEY` in your `settings.json`, set by you: nothing to do either — Claude
     Code fills the header from there too.
  3. The key file `~/.claude/cc-smart-dev-kit/tavily.key` — **mode 600**, which setup copies
     into the `env` of your `settings.json` as a secret key cc-smart-dev-kit owns (masked in
     output, kept as a hash in `owned.json`, and the settings file left at mode 600). A new key
     in the file replaces the copy at the next setup.
  4. The copy setup wrote on an earlier run, when the key file is gone since: still a working
     key, so it stays.

  Which value is setup's own copy is told by its hash in `owned.json`, not by where it is
  found: Claude Code hands the settings' `env` to its own shell, so a setup run inside a Claude
  Code session sees the copy in its environment too, and still knows it as its own. Without a
  key the server is skipped, and setup says so. A key file others can read, or an empty one,
  is refused with the command that fixes it — never with the key in it. On Windows a mode says
  nothing (the profile's ACL protects the file), so a key file there is read whatever its bits
  say. `cc-smart-dev-kit setup --tavily-key-stdin` takes the key on stdin and writes that key
  file for you (the [installer](#install) uses it); the key never reaches a command line, and
  `restore` leaves the file — it is your key, not a settings key setup owns. When your own key
  moves to your environment, the copy setup wrote is removed; when no key is left at all
  (setup's copy taken out by hand too), a Tavily server setup had registered is taken back —
  never a stale registration left behind.
- **Every `claude mcp` step runs inside setup's lock, and its record comes first.** Before
  each `claude mcp add-json` (and before an update's `remove`), setup writes the server's
  record in `~/.claude/cc-smart-dev-kit/mcp-servers.json`, marked as in flight. A setup that
  stops halfway — a crash, a closed terminal — leaves a server the next setup finishes or keeps
  as its own, never one it reads as someone else's. When that record file cannot be read, no
  server is added, removed or updated, the file stays as it is (it may still say what setup
  registered), and one line says to fix it by hand.
- Versions are **pinned** (`src/mcp/versions.ts`): a server started as `@latest` asks the
  registry on every session start and installs whatever was published a minute ago, and
  re-resolving a dependency tree makes the start slow enough to fail inside Claude Code's
  start limit. Moving a pin: change it here, run `cc-smart-dev-kit setup` again, restart Claude
  Code, and check `cc-smart-dev-kit doctor`.
- **A server of your own is never taken over.** One registered under one of these names that
  cc-smart-dev-kit did not write is left alone, with a note saying how to hand it back
  (`claude mcp remove <name> --scope user`, then setup). One setup wrote and you re-pointed
  since is yours too, and `restore` leaves it.
- **A server the plugin retired** (`serena`, in 0.6.0): the next setup takes back the
  registration it made, by the same rule — only while the record says it is setup's and it
  still holds exactly that — and never one of yours under that name. `mcp status` no longer
  lists the name, so the installer never offers to replace yours
  ([0.6.0](#060-serena-is-removed)).
- **`cc-smart-dev-kit mcp status [--json]`** answers, read-only, which of the three are the
  plugin's and which are registered by something else: `! playwright: registered by something
  else (node /opt/tools/server.js). To let setup manage it: claude mcp remove playwright
  --scope user, then cc-smart-dev-kit setup`. The command and its arguments are shown; an
  `env` or a `headers` in that config never is (a person's own server may hold a key there).
  `--json` prints the same for a script; exit 1 means Claude Code's own config could not be
  read, so "nothing is foreign" and "could not check" are not confused. **The
  [installer](#install) asks with it**: per foreign server, "Replace it with
  cc-smart-dev-kit's?" — a yes removes it and runs setup again (the plugin then registers its
  own **with its record**, which is what makes `restore` able to take it back), a no lists it
  under "What is left" with the exact command.
- **`restore` takes exactly those back**: each server that still holds what setup registered
  is removed (`claude mcp remove <name> --scope user`), the record goes
  (`~/.claude/cc-smart-dev-kit/mcp-servers.json`), and so does the
  Tavily `env` key. A server you re-pointed — or removed yourself — stays, and setup says so
  with the exact command that adds it back (a server you removed is never registered again).
  A server restore could not remove keeps its record, so the next `restore` tries again; that,
  and a record file restore cannot read (kept, never deleted), make `restore` exit 1.
- `doctor` checks each one: registered at user scope, and it starts (`claude mcp get`, which
  starts it once). A server registered somewhere else — a project's `.mcp.json`, or the local
  scope — is a ✗ naming what wins over yours. A server registered at user scope by **something
  else** under one of these names is a `!` line naming what runs instead (that is why the
  plugin's browser is not the one starting), with the command that hands the name back. No
  Tavily key is a `·` line, never a failure.
- **A project's own servers are the project's.** The plugin never knows them: they belong in
  that project's own configuration, where the project can keep them true.

## Sessions

A power cut or a closed terminal window loses the tabs and the running programs, never the
sessions: Claude Code writes every session to disk as it goes
(`~/.claude/projects/<folder>/<session id>.jsonl`), and `claude --resume <id>` brings one back
with its history. `cc-smart-dev-kit sessions` lists this project's sessions of the last two
days by name and worktree, with the command that resumes each, and saves one Warp tab per
session (Warp's "+" menu → `Claude · <name>`; the tab files carry the project's own key, so
two projects on one machine never remove each other's tabs).

**Which folders are this project's:** its main checkout, and Claude Code's own worktrees inside
it (`.claude/worktrees/`). A project folder next to it in the same Code folder is another
project's, and is left alone. A session running in another project's folder is never listed,
and never reopened.

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
what it would open and opens nothing. A window that could not be opened is named, and the
command exits 1, so a script around it can tell that a session did not come back.

## Worktrees

Every project uses **Claude Code's own worktrees**: `<repo>/.claude/worktrees/<name>` on the
branch `worktree-<name>`. The plugin wires no worktree hook, so Claude Code's own handling
holds: it locks a worktree while a session uses it, marks it for its own cleanup, supports
`claude -w "#123"` (a pull request), and handles Git LFS.

- **A new task starts from the main checkout:** `claude -w <task-name>`. Use dashes, not
  slashes: a `/` in a name becomes `+` in both the folder and the branch. An existing
  worktree opens the same way by its name — `claude -w <name>`, or `EnterWorktree` with its
  `name`, which resumes it as it was left — while `EnterWorktree` with a `path` only switches
  between worktrees for a session already inside one.
- **The branch is cut from `origin`'s default branch** by default (`fresh`: it fetches that
  branch only when the repo was not fetched in the last 24 hours). A project whose work
  branches from another branch sets `"worktree": {"baseRef": "head"}` in its committed
  `.claude/settings.json`: a new worktree then starts from the current branch — start new
  work from the main checkout on the base branch (`git switch <base>` first if it was switched
  to explore) — and a subagent's worktree gets the session's commits too. `baseRef` takes only
  `"fresh"` or `"head"`, never a branch name. `cc-smart-dev-kit doctor` warns when the base
  branch is not the default and the line is missing. `project init` writes it.
- **Git-ignored files a worktree needs** (`.env.local` and the like) are named in
  `.worktreeinclude`, which Claude Code copies into each new worktree.
- **There is no setup step.** The session runs the project's own install first (for example
  `bun install`, and again after a pull that changes the lockfile).
- **`.claude/worktrees/` must be git-ignored:** add it to the repo's `.gitignore` and commit
  that. `cc-smart-dev-kit doctor`, run in the project, warns when it is not.
- **A subagent with `isolation: "worktree"`** gets its own worktree, cut from the same base
  as the session's (the session's branch with `baseRef: "head"`, else `origin`'s default
  branch), usually with no packages installed.

**Clearing a worktree.** Claude Code removes a clean worktree of an unnamed session on exit,
and asks first for a named one or one with work left; a subagent's worktree is removed when it
made no changes. After a merge, the
after-merge note asks the session to clear the one it worked in. `cc-smart-dev-kit worktrees`
finds the repo's finished ones (§ below).

**The plugin's own worktree engine was retired in 1.0.0.** A project that still has what it
left fixes it with one run of `cc-smart-dev-kit project init` (`--dry-run` shows the `-` lines
first, and writes nothing):

- **Its fields are refused.** A `.claude/cc-smart-dev-kit.json` that still sets
  `worktrees.prefix`, `worktrees.setup` or `worktrees.engine` does not load: every hook that
  reads the file fails closed (a guard asks before every call in its domain), and the error
  names each field — "`worktrees.prefix` is no longer supported: remove it — Claude Code's own
  worktrees need none". `project init` removes them; `cc-smart-dev-kit doctor` names them.
- **Its hook lines fail.** A line in `.claude/settings.json` or `.claude/settings.local.json`
  that runs `cc-smart-dev-kit hook worktree-create`, `worktree-remove` or `subagent-stop` now
  prints the fix and exits 1. That is a non-blocking error on `SubagentStop` and
  `WorktreeRemove`, so a leftover line never loops a subagent nor stops a session; a leftover
  WorktreeCreate line still fails the creation, so Claude Code cannot make a worktree while it
  is there. `project init` takes exactly those lines out — every other hook in the same list
  stays — and `doctor` names each file that still has one.
- **A base branch that is not the repo's default** needs `"worktree": {"baseRef": "head"}` in
  `.claude/settings.json`; `project init` adds it.

A committed file counts too: the merge guard reads the policy committed on the pull
request's base, so until the fixed file is committed and pushed there, a merge asks and names
the field.

### Clearing the finished ones: `cc-smart-dev-kit worktrees`

`cc-smart-dev-kit worktrees` lists every worktree of the repo after fetching
`origin/<base>`, with what is left on each and which are finished. A worktree is **finished**
when removing it can lose nothing and disturb no one:

- no running Claude session works in it (`~/.claude/sessions/<pid>.json`);
- no program runs from inside it, and none works in it — a dev server started there is one.
  The `worktrees` command's own process, and the shells that started it, are left out of it:
  their command line names the folder only because they were asked about it — their working
  folder still counts, so a shell that really sits in the worktree keeps it. A working folder is
  read on Linux only: on macOS and Windows the command line alone counts, and a Claude session in
  the worktree is kept by the rule above;
- no Docker container, running or stopped, mounts files from inside it;
- the work on it is on `origin/<base>`: every commit by ancestry, every commit under another
  sha (`git cherry` — a rebase or a cherry-pick merge), a merge of the branch into the base
  that changes nothing (`git merge-tree --write-tree` — a squash merge leaves one commit of
  its own on the base and none of the branch's), or its merged pull request (`gh pr list`).
  A commit the base does not have keeps the worktree, whatever the rest says; and the
  `git merge-tree` way needs git 2.38 or newer — on an older one the worktree is kept, and
  the reason names the git that cannot answer;
- git has not touched it for an hour (a worktree made a minute ago is not finished: its
  session has not moved into it yet);
- nothing in it is changed or untracked, and it holds no ignored file that cannot come back
  (an edited `.env.local`, a notes file, a key). Dependency folders, build output, caches and
  a file the main checkout still holds byte for byte do not block.

**The verdict is taken again right before anything is removed**, on the folder as it is then:
a worktree that was finished when the list was printed and has a new commit a minute later is
kept. `--clean` removes the finished ones, with their branches (a branch goes only when
`origin/<base>` holds its work, by any of the ways above). `--remove <path>` removes one
now — for a session that has just finished in it, so without the one-hour wait. Both run in the
main checkout only (a session working in a worktree leaves it first) and one at a time; a
second run says so and does nothing. A worktree whose folder is gone is named, and
`git worktree prune` forgets it.

**A crew session's worktree normally stays with its lead.** A crew session's work goes to its **lead's**
branch, which reaches `origin/<base>` only when the lead's pull request merges (and a squash
merge never makes those commits ancestors of it), so this clean would keep every one of them
and then say "Nothing finished to clear" — and clearing one would leave its record, its branch
and its Claude session behind. The list names such a worktree as a crew session's, with the
session, its lead, its state and who removes it (`crew rm`, or the lead's watch once the branch is
merged), and the summary says `N crew worktrees: their leads remove them`. `--clean`, `--remove`
and the background clean leave it alone while its lead remains. When its lead is explicitly ended
(`crew lead --end`), or unknown to agent view for more than a day, the clean removes it only after
ancestry or a no-change merge proves its work reached the base, through `crew rm`'s own steps.
Otherwise it stays with a removal or continuation line. Finished discard archives expire after
30 days. Live and unprovable locks stay; a proved stale Linux Claude lock can be released only
after the normal safety checks, and a failed move restores its lock. **A removal that stopped halfway is finished here:** a folder named
`<path>-removing-<time>` is what a removal moved aside before git could remove it. While git
still lists it, it asks for neither the idle hour nor the commits on the base (its branch keeps
them): nothing may run from it, and nothing in it may be uncommitted beyond tracked files the
removal itself deleted. When git no longer lists it — `git worktree remove` deleted its
registration, then failed on a file — the list shows it as `(no worktree)` and `--clean`
removes what is left only when nothing runs from it, it is no repository, it crosses no mount
and no file in it is newer than the move its name records; otherwise it stays, with the reason.

**The finished ones also clean themselves** (`worktrees.autoClean`, on unless a project turns
it off). After a pull request merges into the base, and when a session starts, the plugin
runs that same clean by itself: the same verdict, in a detached process, so nothing waits for
it and no program is ever forced. A session start starts it at most once an hour per repo,
and never in `claude -p`, where nobody would read the line. The next session you start in that
repo says once what it removed — `cc-smart-dev-kit removed 2 finished worktrees: app-wt-a,
app-wt-b (work on main)` — and the note below still names the ones it did not remove, with the
reason. Everything it removed, kept and every error goes to `cc-smart-dev-kit`'s own state
folder (`worktrees-auto-clean/`, one file per repo, and `worktrees-auto-clean.log`, kept
small). Off:

```json
{ "worktrees": { "base": "main", "autoClean": false } }
```

**A worktree that holds a git submodule** cannot be moved or removed by git at all
(`git worktree move` and `git worktree remove` both refuse one), so it is kept with that
reason, never with "try again". Commit and push its work, delete the folder by hand, and run
`cc-smart-dev-kit worktrees` again: a worktree whose folder is gone is forgotten (its branch
goes when the base holds its commits).

**A worktree on a removable disk (a USB drive, a network share): lock it** —
`git worktree lock <folder>`. A LOCKED worktree is never taken, so a folder that is simply
not connected costs nothing. An UNLOCKED one whose folder is missing reads as gone, and
`--clean` prunes it (`git worktree prune` forgets it for good: when the disk comes back, git
sees an ordinary folder) and deletes its branch when the base holds every commit on it. Its
`forgot …` line says to lock it next time.

The base branch comes from the project's `cc-smart-dev-kit.json` `worktrees.base`; without that
file (or without the field) the remote's default branch (`origin/HEAD`), else `main`, with
one line saying which was used.

A session's own worktree is normally cleared by the session. The after-merge note, right
after its branch's pull request merged, says `ExitWorktree` with action `remove`. Claude Code
checks a worktree under `.claude/worktrees/` itself; for one outside it, the note says to check
`git status --porcelain` and `git log @{u}..` first, and only then to pass `discard_changes
true`. When `ExitWorktree` cannot, it says `cc-smart-dev-kit worktrees --remove <path>`, which
removes the folder and the branch only when the worktree is finished. The SessionStart note, when finished worktrees are left behind, points at
`cc-smart-dev-kit worktrees --clean` — and the background clean above has usually taken them
already.

## `project init`

`cc-smart-dev-kit project init` writes the two files a project opts in with, so nobody has to
copy them from this page:

- `.claude/cc-smart-dev-kit.json` — the project's settings (below);
- `.claude/settings.json` — `"worktree": {"baseRef": "head"}` when the chosen base branch is
  not the repo's default branch, so a new worktree starts from the current branch. It is
  merged with whatever that file already has; nothing else there changes, and a project on
  the default branch gets no line.

It writes no worktree hook: every project uses Claude Code's own worktrees (§ Worktrees).
**It takes out what the retired worktree engine left:** the fields `worktrees.prefix`,
`worktrees.setup` and `worktrees.engine` (a file that holds one no longer loads), and every
`cc-smart-dev-kit hook worktree-create|worktree-remove|subagent-stop` line in
`.claude/settings.json` and `.claude/settings.local.json`. Each is a `-` line in the plan
before anything is written; every other hook stays. The engine's old flags (`--prefix`,
`--setup`, `--no-setup`, `--engine`) are refused, exit 2.

It asks first and shows every default, which it reads from the repo: the base branch from
`origin/HEAD` — else the repo's only branch when it has one (a repo whose only branch is `dev`
works from `dev`, never from a `main` it does not have), else `main`, else `master`, else the
branch HEAD is on — the bases offered for `hotfix/` and `release/` from the default branch,
the protected branches from the default branch and the base plus, when `gh` is installed
and answers, the branches GitHub protects (a read-only `gh api`; anything missing is skipped
quietly), and the fast check from `package.json`'s scripts — `typecheck`, `lint`, `check`, `test`,
in that order — run with the package manager its lockfile names. The questions are counted
(`[2/8]`), each shows its default in brackets, and Enter
keeps it; a list question takes `none` for an empty list, so does the fast check, and an answer
it cannot read is asked
again once, with the reason. Then it prints the plan, one group per file — the changes line by
line (`+` added, `~` changed, `-` taken out), and the settings files merged with what they have
— asks `Write these files? [y/N]`, writes them (a backup first, in
`~/.claude/cc-smart-dev-kit/backups/`), and ends with the next steps. **Nothing is
committed:** the first next step is the `git add … && git commit` line for the files to commit
with the project (`.claude/settings.local.json` is your own, and stays uncommitted); the second
is the plugin version every teammate needs.

Every question has a flag, so it also runs without a terminal:

```sh
cc-smart-dev-kit project init --base dev --bases "hotfix/=main,release/=main" \
  --protected "main,dev" --check "bun run typecheck" --guard-main-folder \
  --session-names --workflow "openPr=draft"
```

`cc-smart-dev-kit project init --help` lists them all; each yes/no question has a `--no-` flag
too (`--no-guard-main-folder`, `--no-session-names`, `--no-job-route`, `--no-check`), so a run
with no
terminal can answer either way. With no terminal it writes nothing unless
`--yes` is given: it prints the plan and the line to run instead. `--dry-run` prints the plan
of the flags and the defaults, asks nothing (on a terminal too), and writes nothing at all. Run it again on a project that has a file: it shows the diff and
asks, and `--yes` keeps every field the flags do not set. A `--workflow` word changes only
the setting it names — `--workflow autoPush=true` keeps `crew.*`, `fixesAfterReview.*` and
every other workflow field the file holds; a dotted key (`crew.enabled=false`) changes only
its own field. A `requires` the file already has
is never lowered (a project needing a newer plugin keeps its range); an older one is raised to
the oldest plugin that reads the file — 0.5.2, the version that made `worktrees.prefix`
optional, 1.0 for a file that sets `workflow.crew`, `workflow.fixesAfterReview` or
`worktrees.autoClean`, or 1.1 for a file that sets `checks` —
never to the version running here, so a teammate on an older plugin is not refused for a
file that reads fine there. A plan the plugin itself would refuse (a `bases` prefix that does
not end with `/`, a key no version knows) is an error before anything is written.

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
crew.enabled = true (personal)
crew.tag = (the main checkout's folder name) (default)
switches.sessionNames = true (project)
gate: what the merge guard judges with, from origin/dev:.claude/cc-smart-dev-kit.json as committed (this checkout's own copy does not count)
gate autoMerge = true (project, committed on origin/dev)
gate reviewBeforePush = true (default)
gate reviewAgents = cc-smart-dev-kit:reviewer (default)
gate fixesAfterReview.lines = 200 (default)
gate fixesAfterReview.files = 10 (default)
gate fixesAfterReview.percent = 20 (default)
review-done = no (HEAD 1a2b3c4)
```

A setting that cannot work with another is shown after those lines, one `!` line each with
its fix — `workflow show` and `workflow set` print it, and so do `project init` and the
portal's Settings page:

```
! openPr is draft and autoMerge is on: a draft pull request is never merged, so autoMerge never acts on the pull request a session opens. Fix: set openPr ready (`cc-smart-dev-kit workflow set openPr ready`) so the pull request can merge, or turn autoMerge off (`cc-smart-dev-kit workflow set autoMerge false`).
```

The pairs are: `openPr` on with `autoPush` off (the push a pull request needs asks every
time), `autoMerge` on with no `worktrees.base` (there is no branch it may merge into by
itself), and `autoMerge` on with `openPr: draft` (a draft is never merged). `src/workflow/clashes.ts`
holds the rules, once, for all four places.

The `gate` lines are **the review gate**: `autoMerge`, `reviewBeforePush`, `reviewAgents` and
`fixesAfterReview.*` as the merge guard reads them. The guard reads the project's part from the file **as committed
on the pull request's base** (`origin/<base>`, as last fetched; nothing is fetched for it),
never from a checkout's working copy — so a change to the gate counts once you commit it to
the base, push it, and the checkout has fetched it. The other rows show this checkout's file,
which the skills follow. When the committed file cannot be read (no `origin/<base>`, no file
there, or one this plugin cannot use), the line says so, and the merge guard asks before every
merge.

| Setting | Default | What it means |
|---|---|---|
| `autoCommit` | `false` | Commit each finished, reviewed step without asking. |
| `autoPush` | `false` | Push the session's own branch. Off: the git guard asks before every `git push`, whatever branch it sends, and reads this value as committed on the base. Never a protected branch: the git guard still asks there. |
| `openPr` | `"off"` | Open a pull request for the branch: `"off"`, `"draft"` or `"ready"`. The merge guard asks before `gh pr create` and `gh pr ready` unless this allows it, and reads it as committed on the base. |
| `autoMerge` | `false` | Merge into the project's integration base, after CI is green and the review is done. |
| `mergeMethod` | `"merge"` | `"merge"`, `"squash"` or `"rebase"`. |
| `deleteBranch` | `false` | Delete the branch after its merge. |
| `reviewBeforePush` | `true` | Run the review before a push. |
| `reviewAgents` | `["cc-smart-dev-kit:reviewer"]` | The subagent types whose return records a review (§ The review record), by the exact name Claude Code reports: `plugin:name` for a plugin's agent, the frontmatter `name` for a project's own. |
| `fixesAfterReview.lines` | `200` | How many lines (added plus deleted) may change on the branch after its review while the review still counts — or `fixesAfterReview.percent` of the reviewed change's lines, when that is more. The base's own changes, and files the base marks `linguist-generated`, are not counted (§ The review record). A whole number, 0 or more. |
| `fixesAfterReview.files` | `10` | The same for the files changed after the review: both limits must hold. |
| `fixesAfterReview.percent` | `20` | The share, in percent of the reviewed change, a fix round may reach in lines and in files, when that is more than `lines` and `files`. `0` for all three: only the exact reviewed commit counts. |
| `clearWorktreeAfterMerge` | `false` | Clear the worktree once its pull request merged. |
| `alerts.events` | all four | Which moments alert: `needs-you`, `question`, `finished`, `failed`. |
| `alerts.sound` | `false` | A sound with the alert. |
| `alerts.usagePercent` | `85` | The plan usage, in percent, a warning starts at (1–100). |
| `crew.enabled` | `false` | Lead and crew sessions may run here: a lead starts background crew sessions for its plan's phases. Off: a lead uses subagents only. Set it in your own file for every project, or in a project's file for that one. |
| `crew.keep` | not set | What a crew session keeps beside this plugin, for projects whose phases need more: a Claude Code plugin by its id (`plugin:name@marketplace`), or an MCP server this plugin registers (`server:name` — `playwright`, `sequential-thinking`, `tavily-websearch`). A crew session turns every other plugin off for itself, except what this plugin and a kept plugin depend on (a plugin whose dependency is off does not load), and loads no other MCP server (`crew start` passes `--strict-mcp-config` with only what its kind needs: Tavily, and the browser for a `ui` kind). A plugin named here must be enabled on the machine, or `crew start` refuses with the line to fix. |
| `crew.idleStopMinutes` | `10` | Minutes a blocked crew session waits before its session is stopped; an answer brings it back. |
| `crew.max` | `24` | The machine's safety ceiling: at most this many crew sessions run on this machine at once, across every lead. A lead's own `crew.perLead` is what usually holds a new crew session; the ceiling protects the machine. A crew session past it waits in the queue (`crew start` still returns at once). A value you set keeps binding — keep it above the sum of your leads' caps, or the ceiling fills and the leads queue as they did before the per-lead caps. |
| `crew.maxOpus` | not set | An optional machine-wide ceiling on the opus tier: the opus kinds (`architecture`, `ui`), or a crew session moved onto opus with `--model`. Not set, there is no machine-wide count: each lead's `crew.perLeadOpus` alone bounds the opus tier. |
| `crew.memoryGb` | `2` | The free memory, in GB, a new crew session needs; below it, the crew session waits in the queue. |
| `crew.perLead` | `4` | At most this many crew sessions run for one lead at once, in every repository on this machine. One lead can then never take every place and starve the others. A crew session past it waits in the queue, and its lead's watch starts it when a place frees. |
| `crew.perLeadOpus` | `2` | At most this many of one lead's crew sessions on the opus tier. An opus crew session past it waits; the lead's sonnet crew sessions still start. |
| `crew.usagePercent` | `85` | Past this share of the plan's 5-hour usage window, a new **opus-tier** crew session waits — unless the gateway's opus slot has a chain with its fallback on, which answers past the window. The window is the one Claude Code's status line reads: cc-smart-dev-kit's status line records it (`cc-smart-dev-kit setup --statusline`), and with no reading stored the guard does not hold, and `crew start` and `crew list` say so once. |
| `crew.quietMinutes` | `20` | Minutes a working crew session may write nothing before the lead hears it is quiet (an alert only). |
| `crew.handoffPercent` | `70` | The share of its context, in percent (1–100), at which a crew session hands off to a next one. |
| `crew.softHours` | `2` | Hours after which a crew session still running is told its phase is long, and to tell the lead where it stands (a step with a note) or hand off. |
| `crew.maxHours` | `4` | Hours after which a crew session hands off. |
| `crew.archiveDays` | `7` | Days a removed crew session's conversation stays in the kit's crew archive before it is deleted (a whole number, 1 or more). Removing a crew session moves its conversation out of `/resume` into the archive; `crew rm`, the watch's removal and `sessions --finished --remove` delete the archives older than this. |
| `crew.tag` | the main checkout's folder name | The word that names the repository in every lead's and crew session's name (`LEAD <tag> <plan>`, `C <tag> <plan> <phase> <slug>`): 1–12 ASCII letters, digits, `.`, `_` and `-`, a letter or a digit at each end. |

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
| `autoCommit`, `clearWorktreeAfterMerge` | the instructions: the `commit` and `worktree` skills read `cc-smart-dev-kit workflow show` and follow it. No hook acts on them: a commit and a folder are the session's own doing. |
| `autoPush` | the **git guard hook**, which asks before every push while it is off. |
| `openPr` | the **merge guard hook**, which asks before `gh pr create` / `gh pr ready` unless it allows them. |
| `autoMerge` | the **merge guard hook**, which asks you before a merge its rules do not allow — every merge form it reads, in this repository only, and every merge with `--admin` — and answers `allow` for an exact `gh pr merge <n>` whose whole policy passed. |
| `mergeMethod`, `deleteBranch` | the instructions: they say how a merge the guard allowed is made, and whether its branch goes afterwards. No hook reads them. |
| `reviewBeforePush` | both: the **review-record hook** writes the record when the review agent finishes (§ below), and the merge guard asks about a merge whose head no record covers (§ The review record). |
| `reviewAgents` | both: the **review-record hook** records only an agent listed there, and the **merge guard** trusts a record only when the list committed on the base names the agent that wrote it. |
| `alerts.events`, `alerts.sound` | the two alert hooks, `notify` and `stop-failure` (§ Notifications). |
| `alerts.usagePercent` | the status line: from that share of a plan window it warns. |
| `fixesAfterReview.*` | how much a branch may change after its review and still count as reviewed: the merge guard judges a merge with them, and `workflow merge-check` prints the same verdicts (§ The review record, below). |
| `crew.*` | the lead and its crew: `crew.enabled` is the switch the lead and the launcher refuse without; `crew.keep` is what a crew session keeps beside this plugin; `crew.perLead` and `crew.perLeadOpus` are one lead's caps, `crew.max` the machine's safety ceiling and `crew.maxOpus` an optional machine-wide opus ceiling; `crew.memoryGb` is the free memory a start needs; `crew.usagePercent` is the share of the 5-hour window past which a new opus crew session waits; `crew.idleStopMinutes` is how long a blocked crew session waits before the watch stops it; `crew.quietMinutes` is how long a working crew session may write nothing before the lead hears it is quiet; `crew.handoffPercent`, `crew.softHours` and `crew.maxHours` are the crew session's own context and time caps; `crew.archiveDays` is how long a removed crew session's conversation is kept in the kit's archive; `crew.tag` names the repository in every name. |

**The review record.** The record says one thing: the commit the change set was on had its one
premium review. It is one small JSON file per repository under
`~/.claude/cc-smart-dev-kit/reviews/` (mode 0600), and `cc-smart-dev-kit workflow show` prints
whether the commit here has a record the gate trusts. It is written **by the review-record
hook**: Claude Code tells it when a subagent starts and when it finishes, and if that agent is
one `reviewAgents` lists (by default the plugin's own reviewer) it notes the commit the
working folder is on at the start, and its branch, and records **that start commit, on that
branch**, at the end. A fix committed while the reviewer read is a fix it never saw: it counts
as change after the review, like every later fix.

**A review counts for its branch and the fixes after it.** A review of an earlier commit of the
same branch covers the branch's new head while the change made since the review — the base's
own changes taken out — stays within `fixesAfterReview` (by default 200 lines, 10 files, or 20%
of the reviewed change when that is more; `0`/`0`/`0`: the exact reviewed commit only). Merging
the base into the branch, or a rebase that only moves it, adds nothing; a fix commit, a rebase
that edits, a conflict resolved by hand and a new file all count. Files your base branch marks
`linguist-generated` in its `.gitattributes` are listed, not counted (a pull request's own
`.gitattributes` hides nothing); a binary file changed after the review is never covered. A
review on another branch never counts, nor one whose change is already in the base (a
squash-merged branch whose name is used again). It needs git 2.40 or newer: `doctor` warns on an
older one, and then only a review of the exact head counts. A record without a branch (written by
0.6.0, on a detached HEAD, or by hand) counts for its exact commit only. The merge guard judges
with this rule, and `cc-smart-dev-kit workflow merge-check --branch <branch> --base <base>`
prints the same verdict for a lead's local merge; a fix over the limit asks, with the counts and
the limit in the question.

A name matches exactly: a
`plugin:name` only that plugin's agent, a bare name only an agent with no plugin prefix, so
another plugin's `reviewer` never counts for `cc-smart-dev-kit:reviewer`. An agent that stopped
inside its own worktree records nothing: that worktree's branch is a fresh one from the base,
never the commit a reviewer read. `cc-smart-dev-kit workflow review-done [--sha <commit>]`
records one by hand for the person's own terminal: it refuses inside Claude Code, where a
record a session writes for itself is only the session's own word. With `reviewBeforePush` on,
the merge guard reads the record for the pull request's head commit: no record by an agent the
committed `reviewAgents` names (or by you), and the merge asks you. A record an older plugin
wrote names no agent, so its commit asks once.

**Inside Claude Code, `workflow set` and `unset` of a gate setting** (`autoMerge`,
`reviewBeforePush`, `reviewAgents`, `fixesAfterReview.*`) **refuse**, in both files: the gate
is yours to change.
Run them in your own terminal; for the project's part, commit `.claude/cc-smart-dev-kit.json`
to the base and push it.

**What the gate is, and is not.** The committed policy, the record and these refusals stop
mistakes: a session that switches the gate off in its own checkout, a stray `review-done`,
another plugin's agent named `reviewer`. They are not a lock against a process set on getting
past them: anything that runs as you can write your own files (the record, `workflow.json`),
drop `CLAUDECODE` (`env -u CLAUDECODE`), or push to a branch you may push to. Your
repository's branch protection, and your yes to a merge, are what hold against that.

**The alert settings**, read by `notify`, `stop-failure` and the status line:

| Setting | What it does |
|---|---|
| `alerts.events` | Which moments alert: `needs-you` (a permission prompt, an MCP prompt, a background agent waiting), `question` (a question, or a plan for your OK), `finished` (a turn ended, or agent view says a session finished), `failed` (a turn died, or agent view says a session failed). A moment left out is silence, on every route. |
| `alerts.sound` | A sound with the alert where the platform has one: Linux's freedesktop sound through `paplay` (else `canberra-gtk-play`), a system sound through `afplay` on macOS, the toast's own sound on Windows, a terminal bell over SSH (not with Warp at the far end, which plays its own). Off by default; `notify.json`'s own `desktopSound` and `sshBell` keep working beside it. |
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
  "requires": ">=0.5.2",
  "worktrees": {
    "base": "main",
    "guardMainFolder": true,
    "autoClean": true,
    "bases": { "hotfix/": "main", "release/": "main" }
  },
  "protectedBranches": ["main"],
  "checks": { "fast": "bun run typecheck && bun test src/changed" },
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
| `worktrees` | Turns on the notes and guards that work with worktrees (the after-merge and leftovers notes, the stash question, the main-folder guard). Every project uses Claude Code's own worktrees (§ Worktrees). |
| `worktrees.base` | The branch a new worktree starts from and pull requests go into; the base the after-merge and leftovers notes compare with. |
| `worktrees.prefix` | **Retired in 1.0.0, and refused**: the folder-name prefix the plugin's worktree engine gave a worktree beside the repo. A file that still sets it does not load; `cc-smart-dev-kit project init` removes it (§ Worktrees). |
| `worktrees.setup` | **Retired in 1.0.0, and refused**: a command the engine ran inside a new worktree. A project runs its own install itself; `cc-smart-dev-kit project init` removes the field. |
| `worktrees.guardMainFolder` | `true`: refuse edits in the main checkout itself. Off when left out. |
| `worktrees.autoClean` | `false`: the finished worktrees do not clean themselves. On when left out: after a merge into the base, and at an attended session start (at most once an hour), the plugin runs the same safe clean as `cc-smart-dev-kit worktrees --clean` in the background (§ Worktrees). A field of 1.0.0: a project that sets it needs `"requires": ">=1.0"`. |
| `worktrees.bases` | A branch-name prefix (ending in `/`) to the base that branch family's pull requests go into (`{"hotfix/": "main", "release/": "main"}`). The longest prefix that matches wins; every other branch's requests go into `base`. Auto-merge, the merge guard's opening check and the after-merge note read it; to start a task from another base, switch the main checkout to it first with `baseRef: "head"`, or `git worktree add` it as Claude Code's docs say. |
| `worktrees.engine` | **Retired in 1.0.0, and refused**: it said who made the project's worktrees. Every project uses Claude Code's own; `cc-smart-dev-kit project init` removes the field. |
| `protectedBranches` | The branches the git guard asks about before a push. Default `["main"]`. |
| `checks.fast` | The fast check a session runs before it stops: one command, as you would type it (`"bun run typecheck && bun test src/changed"`). The `verify-gate` hook blocks a stop **once per change** when the session changed files and no Bash or PowerShell call ran this command after the last change (§ The hooks). A field of 1.1.0: a project that sets it needs `"requires": ">=1.1"`. |
| `sessionNames` | `true`: each session names itself after its task. Off when left out. |
| `ownHooks` | The plugin hooks this project still runs as its own copy (in its own settings): exactly those stay silent here, so nothing runs twice. `["git-guard"]` while the project still has its own git guard; empty it once that copy is gone (§ The hooks). A retired hook name (`serena-root`, 0.6.0) is still accepted and silences nothing. `session-escape-guard` cannot be listed: no project can switch it off. |
| `instructions` | Accepted now. Today a project loads the opt-in instructions with its own import line (§ Instructions, skills and agents); the field does not load them yet. |
| `autoMode` | Used now: `setup` copies it into your settings ([The auto-mode block](#the-auto-mode-block)). |
| `jobs.kinds` | Used now: the project's own heavy-job kinds over the defaults ([docs/jobs.md](docs/jobs.md) § Kinds). |
| `jobs.route` | `true`: the `job-route` hook sends a heavy Bash command through `cc-smart-dev-kit job run` instead of running it raw (§ The hooks). Off when left out. That hook's other part — the launch judge, and a lead's background moves — reads neither this field nor any other: it runs machine-wide. |
| `workflow` | This project's [workflow](#the-workflow) policy, over your own defaults: what cc-smart-dev-kit may do by itself here. Each field is optional, and the project's value wins field by field. |
| `workflow.fixesAfterReview` | How much a branch may change after its review and still count as reviewed: `lines`, `files` and `percent` (§ [The workflow](#the-workflow)). Part of the review gate, so the merge guard reads it as committed on the base. |
| `workflow.crew` | Lead and crew sessions here: `enabled` (off by default), the limits a lead keeps its crew to, and the `tag` in their names (§ [The workflow](#the-workflow)). It wins over the same fields in your own file. |

`requires` is a version range (npm syntax). When the installed plugin is outside it, the
plugin says so and asks you to run `claude plugin update cc-smart-dev-kit@cc-smart-dev-kit`. A project that
uses a field raises its `requires` to the release that brought the field: a file written
without `worktrees.prefix` asks for at least `>=0.5.2`, the version that made it optional, so
a teammate on an older plugin is told to update instead of failing the file's parse.
`worktrees.autoClean` came with 1.0.0 (an optional field: a minor change), so a project that
sets it asks for `>=1.0`.
`checks` came with 1.1.0 the same way, so a project that sets it asks for `>=1.1`.
`worktrees.prefix`, `worktrees.setup` and `worktrees.engine` retired with the plugin's
worktree engine in 1.0.0: a file that still sets one does not load, and the error names each
field and the fix, `cc-smart-dev-kit project init`.

## Develop

See `.claude/CLAUDE.md`. In short: `bun install`, change `src/`, `bun run build`,
`bun run check`, and commit `plugin/dist` with the change.

## Docs

- [Design](docs/design.md): how the parts fit, and why — an index to a page per part under
  `docs/design/`.
- [Changelog](CHANGELOG.md): what each release changed, newest first.
- [Moving from anymodel](docs/migrate.md): the move for a machine that ran 0.2.x, and what a
  project keeps from those names.
- [The AI gateway](docs/gateway.md): the router, its slots, and the judge.
- [Roadmap](docs/roadmap.md): the phases, done and ahead.
- [Heavy jobs](docs/jobs.md): the machine-wide queue, its kinds, config and limits.
- [Claude Code contract](docs/claude-code-contract.md): the Claude Code behaviour the
  plugin relies on, and the version it was last proved on.
- Windows: [setup](docs/windows-setup.md), [hooks](docs/windows-hooks.md),
  [notifications](docs/windows-notify.md), [heavy jobs](docs/windows-jobs.md),
  [the gateway](docs/windows-gateway.md) ([Windows](#windows) above).
