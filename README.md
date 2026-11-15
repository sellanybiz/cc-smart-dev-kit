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
- **This repository's marketplace counts as added only when both of Claude Code's records hold
  it**: its own list (`plugins/known_marketplaces.json`) and your settings
  (`extraKnownMarketplaces` in `~/.claude/settings.json`), which `setup` reads. (The two
  companion marketplaces are judged by the list alone: `setup` reads nothing of them in the
  settings.) On a machine whose settings lost the entry (another tool rewrote `settings.json`,
  say), step 4 runs `claude plugin marketplace add` again, which declares it in the settings and
  fetches nothing, and says so: `re-declared in your settings: <source>`. A settings file the
  installer cannot read is left to `setup`. Before 1.3.0, `setup` stopped there with
  `settings.json does not list the cc-smart-dev-kit marketplace yet`; now `setup` itself, run by
  hand on such a machine, says `does not declare the cc-smart-dev-kit marketplace, although
  Claude Code has it on disk` and gives the same one command.
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

The kit helps the main session build quickly with parallel subagents and worktrees.
Its task system is the ledger; the optional gateway supplies model choices.

| Part | What you get |
|---|---|
| The `cc-smart-dev-kit` command | Sets a machine up, checks it, updates it and takes it back out: [Install](#install), [Commands](#commands), [`doctor`](#doctor), `restore`. |
| The AI gateway (optional) | A local router that sends each Claude model family's work to the models you choose, with a fallback, a breaker and a tested judge: [The AI gateway](#the-ai-gateway-optional). |
| The portal | A page on this machine with the same facts and actions as the commands, always up with your sessions: [The portal](#the-portal). |
| The hooks and guards | Small programs at the moments that matter: a guard before a git push, a merge, an agent launch or an edit of your settings; the self-update: [The hooks](#the-hooks). |
| The browser | Claude Code's browser tools on **your own** Google Chrome, in a profile of its own: [The browser](#the-browser). |
| MCP servers | `playwright`, `sequential-thinking` and `tavily-websearch`, registered for your user: [MCP servers](#mcp-servers). |
| The task system | The kit's own task list: the ledger of plans, phases and steps that the main session and its subagents share: [Tasks](#tasks-1100), [Subagent-driven parallel development](#subagent-driven-parallel-development). |
| The heavy-job queue | One queue for the machine's type checks, lints, tests and builds, so only the chosen number of full runs go at a time (default 1): [Heavy jobs](#heavy-jobs-one-queue-for-the-machine). |
| Worktrees and sessions | Claude Code's own worktrees, a command that clears the finished ones, and one that brings a session back: [Worktrees](#worktrees), [Sessions](#sessions). |

## Subagent-driven parallel development

The main session orchestrates the work. `plan-task` writes the design and puts the plan,
phases and steps in the task system. Each phase task holds its builder's brief: the goal,
files and limits, patterns and tools, and done-check.

The `build` skill starts one builder per ready phase. Phases with disjoint files run at
once in separate git worktrees; phases that share files wait through `blocked_by`.
Each builder records a `Report:` note. The main session records its agent, branch,
worktree and base commit on the phase task, then sends the diff to a fresh reviewer for
spec and quality. Fix rounds resume the same builder, up to three times; after that, a
fresh builder on a stronger model takes over. Builders never start agents or review themselves.

The main session merges each reviewed phase, closes its task and starts what it unblocked.
One final whole-branch review runs on `opus`, followed by one fix pass and one full check.
Commit, push and pull request steps follow the project's workflow policy.

The task system is the ledger. `Ruling:` notes keep decisions; `Report:` notes keep results.
After compaction, `task_list scope plan` and git history show what is done. A finished phase
is not run again. See [the task design](docs/design/tasks.md).

## Release notes

What each release changed — the "What's new" an update message points you to — is in
[CHANGELOG.md](CHANGELOG.md), newest first: the heading at the top is the newest release.

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
| The heavy-job queue | Works: each job runs as a plain child process, and the machine limit keeps full runs within your chosen concurrency (default 1). Nothing caps a job's memory, here or on Linux. |
| The guards | Work through Git Bash. The shell judge (`job-route`) is wired on **Bash and PowerShell** and reads each in its own dialect; its queue rewrite stays Bash-only, so with the job route on a heavy PowerShell line is refused with the Bash line to run instead (only where Git Bash is found). |
| The background clean | Works: the detached clean goes through `cmd /c start` so it outlives the hook, with no console window. |
| Notifications | No custom kit notifications; Claude Code and other plugins keep their own behaviour. |
| `sessions --open` | A terminal window per session: XFCE Terminal on Linux or Windows Terminal on Windows. |

Five pages say how, and what still has to be tested there:

- [docs/windows-setup.md](docs/windows-setup.md): the folders, the `.cmd` launcher, file modes
  vs the profile's ACL (its access control list), Git Bash, a row per part, and **the owner's
  checklist** for a real Windows PC (the installer one-liner, `doctor`, a normal session, the
  gateway, the portal).
- [docs/windows-hooks.md](docs/windows-hooks.md): the hooks' shell form, the `.sh` first token,
  and the owed run: a guard blocking in a real session with bun absent, and Git Bash missing on
  purpose.
- [docs/windows-jobs.md](docs/windows-jobs.md): the memory reading, the `win:` leases and the
  `taskkill` end, and the owed run: two sessions on one queue, `job status`, a killed holder,
  Ctrl+C and a worker left behind.
- [docs/windows-gateway.md](docs/windows-gateway.md): the Scheduled Task, what Windows loses
  (no socket activation, no journal), and the owed run: `gateway setup` without elevation, the
  task's states in `doctor`, a restart, and `restore`.

## Commands

**Help on one command:** `cc-smart-dev-kit help <command>`, or `<command> --help` — for a
subcommand too, as in `cc-smart-dev-kit gateway setup --help`. Either prints that command's own
help and runs nothing. Run `cc-smart-dev-kit` alone for the short list: the commands to start
with, two examples, and the names of the rest. A wrong command or option prints one line and the
`--help` line that explains it. `cc-smart-dev-kit help` with no command prints the same short
list.

### Setup, updates and reports

| Command | What it does |
|---|---|
| `cc-smart-dev-kit setup` | Offers the latest Herdr GUI and installs and refreshes everything it owns — the launcher, the instructions, the companions, the MCP servers, claude-mem's keys and the auto-mode entries — and prints a section per part, then the next steps in order. An already-on gateway with our still-owned router address refreshes the owned model menu, and an off gateway loses a kit menu left behind; a menu you set, changed or removed stays yours, and an off gateway stays off. Every question comes first. Full text: [below](#cc-smart-dev-kit-setup). |
| `cc-smart-dev-kit setup --no-instructions` | Takes the instructions' block and copy out and **keeps them out**: setup stores the choice (`~/.claude/cc-smart-dev-kit/no-instructions`), so a later plain `cc-smart-dev-kit setup` leaves them out too. `--instructions` clears that choice and installs them again. `restore` clears it as well. |
| `cc-smart-dev-kit setup --yes` | On a terminal: the same, and writes the auto-mode entries without asking (they are still shown). With no terminal, trust rules are left out, also with `--yes`. Herdr installation may proceed with `--yes` after its disclosure. |
| `cc-smart-dev-kit setup --project <dir>` | Reads the auto-mode entries from the project in `<dir>`, not from the folder you are in. |
| `cc-smart-dev-kit setup --no-herdr` | Skips the default Herdr GUI offer for this run only; no saved opt-out. See [Herdr GUI](#herdr-gui). |
| `cc-smart-dev-kit setup --tavily-key-stdin` | Takes the Tavily key on **stdin** (never an argument: a command line is readable in `/proc` and lands in the shell's history), writes it to the key file `~/.claude/cc-smart-dev-kit/tavily.key` (mode 600, atomically) and then treats it as a key from that file, so a later setup keeps it. An empty stdin is refused. This is the [installer](#install)'s way in for the key. |
| `cc-smart-dev-kit setup --statusline` | Also sets Claude Code's status line to `cc-smart-dev-kit statusline`, as a key cc-smart-dev-kit owns, without asking (also after an earlier "no"). It never replaces a status line you set: one you set yourself, also after setup had set it, stops setup before it writes anything, and `restore` leaves it. |
| `cc-smart-dev-kit setup --retry-watchdog` | Turns on [Claude Code's retry watchdog](#waiting-at-a-limit-claude-codes-retry-watchdog) now, also after an earlier "no": three keys under `env` in `settings.json` (the watchdog, its recheck, and the 24-hour cap), owned by cc-smart-dev-kit. It is on by default, so a plain setup needs no flag. A value you set yourself is never overwritten: a different one stops setup before it writes anything; the same one is named and left alone. |
| `cc-smart-dev-kit setup --no-retry-watchdog` | Takes cc-smart-dev-kit's three keys out again and remembers it as a "no" (`~/.claude/cc-smart-dev-kit/retry-watchdog-declined`), so a later plain setup leaves them out. A key you wrote yourself is not touched. |
| `cc-smart-dev-kit setup --max-subagents <n>` | Sets the kit's value for how many subagents one session runs at once, a whole number from 1 to 100: [Subagent concurrency](#subagent-concurrency). |
| `cc-smart-dev-kit usage [--hours <n>] [--project <folder or name>] [--json]` | Which models answered on this machine, per session, from Claude Code's transcripts: the main session's replies by model, and apart, its subagents (how each was launched, the model of each reply, the share on Opus). Each subagent's own record adds its type, its replies by model, its input/output/cache tokens and an estimated cost (Claude's list price; a backend whose price is unknown is counted with no cost). Default: the last 6 hours. It also lists the Opus and Fable launches the agent guard allowed, by effort and by reason, and auto mode's safety checks, which the gateway's router counted, by day, with the tokens each answer reported (below). `--json` prints the same facts as one object. Read only; no message text. |
| `cc-smart-dev-kit report [--hours <n> \| --days <n>] [--project <folder or name>] [--session <id>] [--json]` | What this machine's Claude Code sessions did in the window (default: the last 7 days; at most 8): per session, the time Claude Code timed for its turns, agent launches and the parallel share, the minutes blocked on permission prompts and which guard asked, the questions, the waits on background work, the idle time until the person wrote, the compactions, auto-mode's blocks by rule, and the merges that asked — then the totals, every prompt's cause, and the calls waiting on you now. Read only; no message text. A prompt's wait is an upper bound: from the tool call's line to the person's answer. `--json` prints the whole report. |
| `cc-smart-dev-kit mcp status [--json]` | Read-only: the three MCP servers cc-smart-dev-kit registers for your user, and which of them are registered by something else instead (a project's own script, say). One line each, naming what runs instead (the command and its arguments — never an `env` or a `headers`), or `--json` for a script. Exit 1 means Claude Code's own config could not be read, so "nothing is foreign" and "could not check" are never confused. The [installer](#install) asks with it before it replaces one of yours; `doctor` warns from the same facts. |
| `cc-smart-dev-kit doctor [--verbose] [--json] [--live]` | Checks the install, the cc-smart-dev-kit files the current project's `CLAUDE.md` imports, and the project of the folder you run it in (the list is below), in groups. A group that passed shows one line; a group with a ✗ or a `!` shows every line, and each ✗ has a `Fix:` line under it. `·` is information and `!` a warning (neither is a failure). The last line is the verdict, and the exit code is 1 when a check fails. `--verbose` opens every group; `--json` prints the whole report for a program (the installers read it). `--live` also proves the hooks and Claude Code's own worktrees on the Claude Code installed here (below); it never runs without the flag. |
| `cc-smart-dev-kit restore [--yes] [--now]` | Removes what setup added (the subagent cap's key too, while it still holds the kit's value) and keeps everything else, including any value you changed since, `gateway.json`, and the state it still needs. With the gateway on it runs in two stages, so running sessions are not cut off. Full text: [below](#cc-smart-dev-kit-restore). |
| `cc-smart-dev-kit update [--check \| --hold \| --resume]` | Installs a newer cc-smart-dev-kit now, showing each step: `claude plugin marketplace update cc-smart-dev-kit`, then `claude plugin update cc-smart-dev-kit@cc-smart-dev-kit --scope user` when there is a newer version; a new major version too, which the background update holds for this. When an installed companion plugin is outside the range the new version needs, or has no version number, it installs nothing, names the companion and the command that updates it, and exits 1 (§ The background update). `--check` only says whether a newer version exists, and whether it is a major one (it reads the remote's version without changing anything). `--hold` stops the background update on this machine; `--resume` starts it again. Both answer at once (no lock); while a check runs, they say "A check is running now; it finishes." Nothing restarts: restart Claude sessions to load the new version. |
| `cc-smart-dev-kit migrate [--dry-run] [--yes]` | Moves a machine that still has the plugin's old `anymodel` names ([Moving from anymodel](#moving-from-anymodel)). It reads and checks everything, asks every question, and writes nothing before they are answered: a "no" leaves the machine as it was. Then it prints its steps and walks them; a step that fails keeps what the steps before it did, and the next run goes on from there. `--dry-run` prints that plan and writes, runs and stops nothing. `--yes` answers the router question without asking; the old plugin is uninstalled only after a yes on a terminal, and only when it is still installed. Refuses to run inside a Claude Code session: it replaces the router that session's own model traffic goes through. On a 0.2.x machine the command does not exist yet: run the plugin's `dist/cli.js` with bun (the section above has the line). |
| `cc-smart-dev-kit version` | Prints the version. |

#### `cc-smart-dev-kit setup`

Installs the launcher, turns Claude Code's own plugin auto-update off for this marketplace (`extraKnownMarketplaces["cc-smart-dev-kit"].autoUpdate: false`: the background update below is the one updater, so a major version waits for you), retires its exact owned [notification hook and tmux line](#notifications), and installs the [instructions](#instructions-skills-and-agents): a copy in `~/.claude/cc-smart-dev-kit/instructions/`, imported by a cc-smart-dev-kit block in `~/.claude/CLAUDE.md` (your own text there is kept); each run refreshes the copy, so run it after a plugin update. Adds a missing [companion](#companion-plugins) marketplace (or plugin). Moves a gateway set up before 1.2.0 to the Claude defaults, once per machine, with a backup first and one line per change ([First setup](#first-setup)). Points [claude-mem at the gateway's affordable model](#claude-mem-on-the-gateway) when you gave the scout a chain, and back to Claude when it has none, and keeps [both claude-mem start blocks off by default](#claude-mems-start-blocks), with the kit's task tools allowed and Claude Code's list tools hidden on every machine. Copies the project's [auto-mode entries](#the-auto-mode-block) into your settings, after it shows them and asks. Manual setup also offers the latest [Herdr GUI](#herdr-gui) by default; `--no-herdr` skips it for this run. Warp support is removed; setup does not uninstall the app or its old registrations. Every question comes before anything runs or is written. `--dry-run` shows the changes, and writes, runs and checks nothing at all (it reaches no network). A settings key you set yourself (for example `autoUpdate: true`, also after setup had set it) stops setup before it writes or runs anything. Without `claude` on your PATH, setup skips only the `claude plugin …` steps, names them, does the rest, and exits with 1. Run in a terminal with no status line set, setup also offers [cc-smart-dev-kit's status line](#the-usage-limit-the-alert-the-status-line-and-usage) (once: it remembers a "no"), and `--yes` skips that question and remembers no "no". Setup also turns on Remote Control's auto-connect: `remoteControlAtStartup: true` in `~/.claude/settings.json`, so a session connects its [Remote Control](#remote-control) bridge when it starts. It writes the key only while it is absent; a `true` or `false` you set stays as it is, and setup says nothing about it. Setup turns [Claude Code's retry watchdog](#waiting-at-a-limit-claude-codes-retry-watchdog) on by default, with or without a terminal and with `--yes`, unless a "no" is on file or you set a key of your own; `--no-retry-watchdog` takes it out and remembers the "no". A question shows its default and takes Enter for it; an answer it cannot read is asked again once. The report has a section per part, one verdict line, and the next steps to run, in order.

Setup also registers the tasks server through the launcher at user scope, with
`alwaysLoad: true`. It asks before adding `mcp__cc-smart-dev-kit-tasks__*` to
`permissions.allow`, like the auto-mode trust entries; without a terminal it leaves this
entry out. It adds managed deny entries for `TaskCreate`, `TaskUpdate`, `TaskList`,
`TaskGet`, `TodoWrite` — never `TaskStop` or `TaskOutput`. It withdraws its D68 task-tool
opt-in and turns off claude-mem work state; a `"true"` you set after that stays. Restore undoes
these managed changes. [Setup design](docs/design/setup.md).

Setup also sets `plansDirectory: ".claude/plans"` in `~/.claude/settings.json`, so plan
mode uses the project's plan folder. It owns only that key, not the plan files; commit plans
with the project. A value you set or changed stays yours: setup prints a note and continues
its other changes. `setup --dry-run` shows the planned write; restore removes the key only
while it still holds setup's value. Doctor names the user-level folder and notes that project
settings may override it. The exact root used in a worktree session is still
[to prove live](docs/claude-code-contract.md#relied-on-not-proved-yet).

#### Subagent concurrency

Setup writes `env.CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS` as the managed string `"10"` in
Claude Code's user settings. A value you set yourself stays yours. Use
`cc-smart-dev-kit setup --max-subagents <n>` to change the kit's value: it also takes the key
back after you removed it, and over a value of your own it only warns. `restore` takes back
only the value the kit owns. This uses Claude Code's own per-session cap, not a kit queue.
Claude Code's default without the key is 20. A launch past the cap fails and Claude is told
not to retry. The key exists from Claude Code v2.1.217; the live check is still owed.

#### `cc-smart-dev-kit restore`

Removes what setup added (its settings keys, the auto-mode entries it copied, any still-owned retired [notification hook](#notifications), claude-mem's keys (also the ones you chose in the [portal](#claude-mem-from-the-portal), with the record of those choices; a value a [take-over](#cc-smart-dev-kit-claude-mem) recorded goes back as it was, while a taken-over key stays as you set it — or, once cc-smart-dev-kit replaced it, the kit's key stays only with the address it was written for, and where your address comes back your own key comes back with it, from the kit's backup of your file, or the kit's key is removed when no backup holds yours), its block in `CLAUDE.md`, the instructions' copy, any still-owned retired [tmux line](#notifications), the three [retry watchdog](#waiting-at-a-limit-claude-codes-retry-watchdog) keys, the [subagent cap's](#subagent-concurrency) key while it still holds the kit's value, and a stored `--no-instructions` choice) and keeps everything else. A key setup set and you changed since is yours: it stays. Herdr and its upstream-managed app/core, shortcuts and PATH changes stay installed too. The plugins and marketplaces setup added stay installed: remove them with `claude plugin uninstall` and `claude plugin marketplace remove`. The launcher goes back to how it was before setup first changed it, or is removed when setup created it. With the gateway installed and on, it runs in **two stages**, because running Claude sessions still send every request to the router: the first restore restores everything but the router, and **writes Anthropic's own address into each settings file's `ANTHROPIC_BASE_URL` instead of removing the key** — a changed value reaches a running session within about a second whatever the files below hold, where a removed key reaches it only when another file still sets the key — so every running session switches to Anthropic by itself and **nothing needs a restart**. The key stays owned and its file stays tracked, so the second run takes it back. The launcher is restored when setup created it, so `cc-smart-dev-kit` may be off your PATH then, and the line it prints is the `bun --no-env-file --config=… …/dist/cli.js restore` form of [Install](#install) step 3, with the bun running the restore, its own absolute path, and your installed version. The router keeps running until the second run, because nothing proves a request in flight is safe when it stops: the second run is for the stop, not for the sessions. **A project's own gateway key counts too**: a project set to `on` (`gateway project on`, or its team file) keeps that project's sessions on the router, so stage 1 waits for them exactly as it waits for the machine's own key; the second disables and stops the router and its socket (it asks, because that cuts answers in flight; `--yes` skips the question), waits up to 15 s for its port to close (not for its answers in flight, which finish in the background; and not at all when the unit was not running or another program answers on the port: it says so), and removes its copy, its units and its limit state (`~/.local/state/cc-smart-dev-kit/gateway-state.json`). `--now` does both at once, after a warning that every running session fails until it restarts (asked, or `--yes`). It keeps `gateway.json`, which holds your key. Some of cc-smart-dev-kit's own state stays too, and restore never removes the state folder `~/.claude/cc-smart-dev-kit/` itself, or a folder outside it. Still there afterwards: the backups a later restore or a hand-undo reads, the records (now empty), the running sessions' and the background update's bookkeeping, and the live-check record. The heavy-job queue's folder `~/.local/share/cc-smart-dev-kit/jobs/` stays as it is, with its `leases/` and `tickets/` folders (empty once no job runs). A restore with nothing left changes nothing.

### The project and its workflow

| Command | What it does |
|---|---|
| `cc-smart-dev-kit statusline` | The status line itself: the session's context use and effort, plan usage, a warning from 85 %, any gateway fallback in use, a slot whose every target is limited or down (the breaker), and auto mode's safety checks failing with nothing to stand in (since when, why, and the fix). Reads the JSON Claude Code passes on stdin, and records the 5-hour window it read for the portal's Overview. |

| `cc-smart-dev-kit project init [--dry-run] [--yes] [flags]` | Sets a project up ([`project init`](#project-init)): it writes the project's `.claude/cc-smart-dev-kit.json` (the worktrees, the protected branches, the guards, and optionally the [workflow](#the-workflow) policy) and, when the base branch is not the repo's default branch, `"worktree": {"baseRef": "head"}` in `.claude/settings.json`. It asks first, showing each default, which comes from the repo (the base from `origin/HEAD`, the protected branches from git and, when `gh` is installed and answers, GitHub); every question has a flag, so a run with no terminal writes nothing unless `--yes` is given. It never commits. `cc-smart-dev-kit project init --help` lists the flags. |
| `cc-smart-dev-kit workflow [show] \| set <setting> <value> [--project] \| unset <setting> [--project] \| propose <setting> <value> [--unset] [--folder <project>] [--json] \| review-done [--sha <commit>] \| merge-check [<pr>… \| --branch <b> --base <base>]` | What cc-smart-dev-kit may do by itself here — commit, push, open a pull request, merge — and the switches that map onto settings which already exist ([The workflow](#the-workflow)). `show` (the default) prints each value and where it came from: the project's file, your own defaults, or the built-in default, whether the commit here has a recorded review, and the `fixesAfterReview` limits in force. `set` and `unset` write one value; `--project` writes the project's committed file. `propose` changes one of the project's own settings **through a pull request**: a branch and a worktree cut from `origin/<worktrees.base>`, the same writer, the commit, the push and `gh pr create` — never a write in the main checkout, and it counts once merged. Run by a Claude Code session, the shell judge **asks you first** whenever `autoPush` is off or `openPr` is short of `ready` (the gate the git and merge guards read), naming the push and the pull request; in `claude -p` that is a refusal. `review-done` records that a commit had its one premium review, for your own terminal: it refuses inside Claude Code, where the [review-record hook](#the-workflow) writes the record when a review agent returns. `merge-check` judges a merge **without making it**, with the merge guard's own judgment: each pull request number, or a local branch against a base, one line per verdict (`allowed`, or the reason it asks); exit 0 when every one is allowed, 1 when any asks. The main session uses `--branch` before a local merge (§ [The workflow](#the-workflow)). |
| `cc-smart-dev-kit issue file --title <t> --body-file <file\|-> --fingerprint <key> [--label <l>…]` | Files one finding as a GitHub issue in **this project's own repository** (the one `origin` names, on github.com) and prints one line: `filed #<n> <url>`, `updated #<n> <url>` or `refused: <why>` (exit 0, 0, 1). The same `--fingerprint` again updates the issue it filed and never opens a second: the key is hashed into a hidden comment at the end of the body. It **files nothing unless `workflow.issues.enabled` is on** (off by default; § [The workflow](#the-workflow)) in a project with a `.claude/cc-smart-dev-kit.json`, and a public repository needs `issues.allowPublic` too (the line says `public` when it posts there). A title or body with a home path (in each spelling a session writes it: `$HOME`, and for a Windows home `C:\Users\x`, Git Bash's `/c/Users/x` and WSL's `/mnt/c/Users/x`), a key or token of a known shape (`sk-`, `ghp_`, `AKIA…`, `gsk_`, `tvly-`, a JWT, a private key block, a Slack or Discord webhook URL, and a value after `key`, `token`, `secret` or `password` and `:` or `=`, with or without letters before the word) or a URL with credentials is refused with its line and column, never the value, and nothing is sent; the screen knows those shapes only, so read a text before you file it. It also refuses an account with **read access only** to the repository (GitHub drops labels from such an account), and updates only an issue the kit's own account wrote. A session's raw `gh issue create`, `gh label create` or `gh api … /issues` write still asks you (§ The hooks, `merge-guard`). Design: [docs/design/issues.md](docs/design/issues.md). |
| `cc-smart-dev-kit issue fixed --base <branch> --head <branch>` | Prints one `Fixes #<n>` line for each **open** issue the kit marked `fixed-unreleased` (`issues.fixedLabel`, with `issue mark-fixed` below) whose fix is in `<base>..<head>`: the lines a release's pull request body carries. GitHub closes an issue only when a pull request that names it merges into the **default** branch, so a fix merged into a release branch closes nothing until then. It prints nothing when the switch is off or no issue waits (exit 0), and exits 1 with the reason on standard error when GitHub or a branch cannot be read: an empty list from a failed call would look complete. Design: [docs/design/issues.md](docs/design/issues.md). |
| `cc-smart-dev-kit issue mark-fixed --issue <number> --base <branch> --branch <branch> --tip <sha> [--merge <sha>]` | Marks one issue fixed. The main session runs it after it merges a fix: `--branch` is the branch that held the fix, `--tip` its last commit, `--base` the branch it merged into, and `--merge` the merge commit (leave it out when it is not known; both are full 40-character commit ids). It comments "Fixed on `<branch>` at `<commit>`, merged into `<base>`; it closes when `<base>` ships." and adds the fixed label (`issues.fixedLabel`), which it creates when the repository lacks it. It **never closes the issue**: the release's `Fixes #<n>` line does (`issue fixed`). Each step looks at the issue first, so a second run adds no second comment or label; only a comment by the account `gh` is logged in as counts. It needs `workflow.issues.enabled`, as `issue file` does. It prints `marked #<n> fixed`, or `#<n> is already closed` (exit 0); the reason on standard error when the switch is off, GitHub cannot be read or the issue does not exist (exit 1); and the usage for a command line that is not one (exit 2). |
| `cc-smart-dev-kit session-name <session id> <name>` | Names a Claude session after its task. A session runs it itself when the project turns on `sessionNames` (below). |

### The gateway and OmniRoute

| Command | What it does |
|---|---|
| `cc-smart-dev-kit gateway <command>` | The optional AI gateway (below). |
| `cc-smart-dev-kit omniroute <status\|update\|rollback>` | The OmniRoute behind the gateway's affordable slots (below): what is installed, the newest npm release at least three days old, the user unit that runs it, and the backend that talks to it. `update` installs the newest such release, restarts its unit, checks the model path, and puts the old version back when the new one does not answer. `rollback` installs the version the last update replaced. `update` and `rollback` refuse to run inside a Claude Code session, and are never in the background. |

### The browser

| Command | What it does |
|---|---|
| `cc-smart-dev-kit browser mcp` | Starts the Playwright MCP server on **your own Google Chrome**, through the Playwright extension, in the profile `claude-code` ([The browser](#the-browser)). `setup` registers it as the `playwright` MCP server; you do not run it by hand. **It refuses to start without the token**: without one the extension would ask you to approve every connection. When Chrome is closed — after a machine restart, say — the first browser tool call starts your own Chrome with that profile and waits for it (session startup alone opens no Chrome), so the first browser call works with nobody at the desktop; a Chrome that cannot be started (no reachable desktop, an error) is one line naming the one step, at once. |
| `cc-smart-dev-kit browser setup [--dry-run]` | Finds Chrome, opens the Playwright extension's Web Store page in the `claude-code` profile (Chrome makes that profile on that launch, if it is not there yet), pre-registers the extension for your user on macOS and Windows, and prints the steps that are left for you. It never installs or removes an extension, and never deletes a profile. `--dry-run` prints the same lines and runs and writes nothing. |
| `cc-smart-dev-kit browser token [--clear]` | Saves the token the extension's status page shows — paste the whole line (its Copy button copies `PLAYWRIGHT_MCP_EXTENSION_TOKEN=…`), and it is not echoed while you type. It is written to `~/.config/cc-smart-dev-kit/playwright-extension.token` (mode 600 on Linux and macOS; on Windows your profile's own permissions keep it yours), and is never printed again. `--clear` removes it. |
| `cc-smart-dev-kit browser check` | Proves the browser end to end on your own Chrome: a real connection with **no approval page**, a `file://` page (which needs "Allow access to file URLs"), screenshots (one the server names, one a caller names), an upload, a download, and `browser_close`. Exit 0 when every check passed. It opens that Chrome window once, and the tabs of its connection stay behind. It always ends: one limit bounds the whole run, and shorter ones the start, each answer and each stop — a Chrome that cannot start fails it at once instead of hanging it. |

### The portal and the job queue

| Command | What it does |
|---|---|
| `cc-smart-dev-kit portal [status\|stop] [--no-open]` | The local portal (below): a page on this machine to see and change the gateway's settings, the updates, the heavy-job queue, the companions and the OmniRoute. It starts with Claude Code, like claude-mem's worker: a new session starts it when it is not running, and a plugin update restarts it onto the new version. It binds `127.0.0.1` only and stays up until you stop it. `portal` opens it (starting it when needed), `status` says whether it runs and on which version, `stop` ends it, and `--no-open` prints the address instead of opening your browser. There is no sign-in: any program or account on this machine can open it (below). |
| `cc-smart-dev-kit claude-mem [status\|route\|key\|fallback\|take-over]` | claude-mem's route and its model, its key and its quota fallback, from your own terminal — the same choices the Machine page's claude-mem card makes, checked the same way (the backend has to list the model, then one tiny chat) and written through the same lock. The key comes on **stdin**, never as an argument, and is never printed. `take-over` records the values you set by hand in claude-mem's file as cc-smart-dev-kit's own, so the route, the key and the fallback can change; nothing in that file changes until you pick another, and `restore` puts the values back (a key's value is never written down: a taken-over key stays as you set it; once the kit replaced it, the kit's key stays only with the address it was written for, and where your address comes back, your own key comes back with it from the kit's backup, or the kit's key is removed when no backup holds yours). Full text: [below](#cc-smart-dev-kit-claude-mem). |
| `cc-smart-dev-kit job <command>` | The machine-wide queue for heavy jobs (below). |

### Sessions and worktrees

| Command | What it does |
|---|---|
| `cc-smart-dev-kit launch [--no-gateway \| --gateway \| --profile <name>] [-- <claude args>]` | Starts **one** Claude Code session in this folder on a model path of its own, whatever the machine's and the project's settings say ([docs/gateway.md](docs/gateway.md) § One session): `--no-gateway` plain Claude at Anthropic, on your own claude.ai login; `--gateway` this machine's router; `--profile <name>` the router with one profile's chains; with no mode, the settings decide, exactly as for `claude`. In the three modes that pass a file, a login key or helper in your settings (`ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, `apiKeyHelper`) still applies, since the launch file names only the address in `env`: the launch starts anyway and names each such key on stderr with its file, and in `--no-gateway` it names each retired model key that names a slot too (only where its file decides that key). Everything after `--` goes to Claude Code (`--model`, `-p`, `--resume`). A profile launch also carries menu rows where the kit may put a menu, and a `--no-gateway` launch carries plain-Claude rows only to replace the kit's own menu; those rows are fixed at launch. `--gateway` follows the live user menu when ours, or carries machine rows fixed at launch only when no user menu or ownership record exists. It writes one small settings file (mode 600, in `~/.claude/cc-smart-dev-kit/launch/`, its name carrying the process so two launches at once never clash; it is removed when the session ends) and passes it with `--settings`, because a settings file's `env` beats both a shell export and the project's files. The session runs in this folder, attached to this terminal, and its exit code is passed on; a signal sent to the command alone (`kill`) is handed on to the session (not on Windows: there a Ctrl+C or a closed console reaches both by itself, and a kill ends the command alone). It refuses a profile the gateway does not have, `--profile` while the running router does not know profiles (an older copy: `gateway setup` replaces it), `--gateway` or `--profile` on a machine without a gateway, either of them while the router does not answer (`gateway setup` puts it back: `restore` keeps `gateway.json` but removes the router), and running inside a Claude Code session. |
| `cc-smart-dev-kit sessions [--open] [--dry-run]` | This project's Claude Code sessions of the last two days, by name and worktree, with the command that resumes each ([Sessions](#sessions)). `--open` reopens every session that was open when the machine went down or its window closed (a terminal window each: XFCE Terminal on Linux, Windows Terminal on Windows); `--dry-run` says what it would open and opens nothing. |
| `cc-smart-dev-kit sessions --finished [--remove] [--yes] [--id <short-id>…]` | Lists background sessions finished (`done` or `stopped`) for more than one day, with name, folder and age. Unknown kinds, waiting or working sessions, and a session with no proof of when it ended stay out. `--remove` shows the list and asks once, or takes `--yes`; repeat `--id` to limit removal to exact eligible short ids. It checks each candidate again before `claude rm`. A registered or locked worktree must be cleared first through `worktrees --clean` or its session's `ExitWorktree`; removal reports that refusal and continues with later eligible sessions, returning exit 1 if any failed. Nothing is removed automatically. |
| `cc-smart-dev-kit worktrees [--clean] [--remove <path>] [--no-fetch] [--json]` | Every worktree of this repo: who works in it, and which are finished ([Worktrees](#worktrees)). `--clean` removes the finished ones with their branches; `--remove <path>` removes one now, for the session that has just finished in it, so without the one-hour wait; `--no-fetch` judges against `origin/<base>` as it is. `--json` prints the same facts as one object, changes nothing and fetches nothing (it takes neither `--clean` nor `--remove`): it is the answer the portal's worktrees card on the Machine page reads. `--clean` runs in the main checkout only; `--remove` runs from any checkout of the repo except the one holding your own folder, and when another clean holds the lock it waits up to ten minutes, then exits 1 (busy). Run either one with `run_in_background`, `--clean` as well as `--remove`: a removal can take up to ten minutes, and the Bash tool stops waiting after two. They run one at a time. A proved stale Linux Claude lock may be released only in the initial PID namespace (the machine's own process list, not a sandbox's), after the normal finished-worktree checks; a nested sandbox or an unreadable namespace cannot prove a host locker dead. Live and unreadable lockers stay, and a live one whose work reached the base names `ExitWorktree` (keep) with `--remove`, or closing its session. |

### Herdr session orchestration

Ask Claude to "start a session in another repo" or "give this repo the task, no need to
monitor it". `/cc-smart-dev-kit:herdr` chooses a **linked child** (this lead coordinates
and hears back) or an **independent session** (you watch its pane), and names the kind.
A phase inside the lead's plan normally uses a subagent instead. This is separate from
[reopening saved sessions](#sessions) and the [Herdr GUI installer](#herdr-gui).

With Herdr and a compatible hc installed, for example:

```sh
cc-smart-dev-kit herdr start --model sonnet --effort high --mode default --cwd /path/to/repo --name repair -- "Fix the scoped bug; report the result. Start no sessions or agents."
```

Model, effort and mode are required. The child's mode cannot exceed the lead's; plan mode
must be approved first and bypass mode is refused. Fable and Opus at max effort require
`--asked` and always raise the judge's confirmation. That flag never skips the prompt.
Linked operations require a live lead inside Herdr, verified through process ancestry.
Add `--independent` for a session with no lead link; it cannot use `--task`.

The verbs and flags below follow `src/herdr/words.ts` (`HERDR_USAGE`); `herdr --help` is the
installed command's full usage. A usage mistake exits 2; a refusal or failure exits 1.

| After `cc-smart-dev-kit herdr` | What it does |
|---|---|
| `start --model <model> --effort <effort> --mode <mode> [--cwd <dir>] [--on <machine>] [--name <name>] [--task <#n>] [--independent] [--asked] -- <brief>` | Starts a session with a private brief file. `--task` is only for an existing open task in the same project and machine. In git, Claude creates a worktree; existing terminal, folder or branch names are refused. Every session starts through your login shell, so it gets your own PATH. Independent sessions, local or remote, get their own space in Herdr's window; a linked child, local or remote, nests under its lead. Start waits until the child comes up: a child that exits at launch (for example, an untrusted folder) shows its error, is removed, and start fails with no task binding. |
| `list [--all] [--json]` | Owned children, or all kit sessions including independent ones; includes counts and blocked status. |
| `send <terminal> <text>` | Tagged lead text to an owned linked child. A done child gets a plain send, never force; a blocked child needs answer or its pane. |
| `answer <terminal> --expect <msg> --expect-turn <n> (--option <k> \| --text <words>)` | Revalidates the prompt and selects option k with arrows from the current cursor. Always asks you, with the whole prompt quoted; the line must hold only this answer, with literal words. A prompt Claude Code cut short is refused, and a Bash prompt's whole command box on screen must equal the command. Text answers, "Type something" and "Chat about this" are refused; plans, logins, multi-question, multi-select and remembered permissions stay in the pane. |
| `wait [--any \| --all] [--timeout <seconds>] [--seen <addr>:<turn\|?>:<blocked\|error\|done\|end>[,…]]` | Waits for news (default/any) or each child in the initial barrier (all), up to the timeout. Run in a background Bash call. Copy its exact next command, whose percent-encoded address/turn/state cursor covers news already printed. No live children returns immediately; timeout does not mean done. |
| `report <text>` | Child reports to a live Claude lead, or saves a unique private file when it cannot. A report is never your consent. |
| `adopt` | Recovers this repo's same-core linked children after their lead disappears: a lead terminal with no live Claude in it counts as gone. Lists each adopted child's saved report files. A new Claude in the old lead's own terminal is that lead already and needs no adopt. |
| `stop <terminal>` | Stops and removes an owned linked terminal; leaves the worktree for separate cleanup. |
| `machines [list \| allow <name> \| forget <name> \| production <name>]` | Lists or changes remote approval rules. Changes ask you first. |

Remote starts require `--on <machine>` and `--cwd <dir>` on that machine. That machine's
login shell must find `claude` and the kit. They check both, then its kit version, copy the brief with `hc file write --on`, then launch with `--add-dir` for
the private per-child brief/report folder. A remote child saves
reports on its own machine; start and wait print `hc exec … find` and `hc file read` lines
for retrieval. The exec line is for your own terminal: Claude cannot run raw hc writes
or exec through the Bash judge. Local reads are allowed; remote reads ask for production
or unallowlisted machines, and unreadable machine rules ask too. `hc events` must run in
the background.
Use `hc attach <terminal>` yourself for dialogs that cannot be relayed.

Remote approval rules live in `~/.config/cc-smart-dev-kit/machines.json` (not the project's
config, and not moved by `CLAUDE_CONFIG_DIR`):

```json
{ "version": 1, "machines": { "worker": { "allow": true } } }
```

`allow` permits starts without a remote-machine question; an unknown or unallowed machine
asks and requires `--asked`. `production` always asks, even with an allow entry. `forget`
removes the entry. A missing file means no approvals; a broken file is an error, not a free
pass. These rules do not register machines with Herdr or grant network access.

The [design page](docs/design/herdr.md) explains ownership, report files, the relay's remaining
race boundary and live proofs still owed. See [doctor](#doctor) for its current diagnostic limits.

### Tasks (1.10.0)

Work tasks live locally; project obligations travel with the branch. `task_create`,
`task_update`, `task_get`, `task_list`, `task_note` and `task_done` share one store with
`cc-smart-dev-kit task`. Phase tasks hold briefs and the `agent`, `branch`, `worktree` and
`base` fields. `Report:` notes hold results; `Ruling:` notes hold the main session's decisions.
See [tasks](docs/design/tasks.md) for all task fields and the CLI.

The kit owns one task system. Live work stays local across worktrees; project obligations
are Markdown files reviewed with their branch. [Task design](docs/design/tasks.md).
Every command below starts with `cc-smart-dev-kit`.

**Work lives in Session › Plan › Phase › Task**. A task holds no tasks of its own.
A top-level task may belong to a plan; a task with no plan is loose. A task made with neither `plan` nor `parent` is always loose, whatever plans are open: a small fix needs no plan. Each task is **blocking** (the default: its parent cannot be done while it
is open, and a builder is told so before it hands back) or **non-blocking** (noted work that
holds nothing; it stays open when its parent is done). A task can be **blocked by** other
tasks: it cannot start or be done while one of them is open. Lists mark both:
`#5 [pending · non-blocking · blocked by #3] …`. The portal's Tasks tab shows the tree.

| Command | What it does |
|---|---|
| `task add <subject> [--description <text> \| --file <path\|->] [--kind work\|production\|database\|teammate\|follow-up] [--parent <ref>] [--start] [--type blocking\|non-blocking] [--blocked-by <ref>]... [--phase <id>] [--plan <slug>] [--agent <id>] [--branch <name>] [--worktree <absolute-path>] [--base <sha>] [--when now\|next-release\|any] [--weight blocks-release\|after-deploy\|owner] [--flag <flag>]... [--ref <path>]...` | Create work (the default) or a project obligation. Description and file input are alternatives; `-` reads stdin. `--plan` alone makes the plan's own task (subject: its title); `--phase` lays out a phase of the plan (the plan of your latest task when `--plan` is left out); you may lay out the phases of every plan up front, and only one plan runs at a time. `--parent` may name a plan (`#n`): the task waits there for a phase. `--agent`, `--branch`, `--worktree` and `--base` record on a phase who builds it and where: the main session sets them when it starts the phase's builder. A plan holds at most `plans.maxPhases` phases, and a phase starts only once it holds tasks. |
| `task set <ref> [--type blocking\|non-blocking] [--block <ref>]... [--unblock <ref>]... [--parent <ref> \| --top] [--agent <id>] [--branch <name>] [--worktree <absolute-path>] [--base <sha>]` | Change a work task's type, its blockers, its parent, or a phase's agent, branch, worktree and base (`task start` takes those four too). A move that would put a task under another task is refused, and so is a blocker that sits above the task. `--parent` moves a task that waits under a plan to a phase of that plan. |
| `task take <plan-slug\|#n> [--from <session>] [--force]` | Take a plan and its members, or one task, into this session. Live claims need `--force`; a refusal changes nothing. Dead claims need no force. A session id without a process gets ownership but no claim. |
| `task start <ref>` | Claim work and mark it in progress. Refused while a task it is blocked by is open, for a phase with no task, and for work in a plan while another plan of yours is in flight (the refusal names that plan: finish it, or park it). The first start in a plan marks its plan task in progress. |
| `task done <ref> [--evidence <text>] [--note <text>] [--for-everyone]` | Finish work after its blocking tasks; archive a project task. A teammate task is done here unless `--for-everyone` closes it for everyone. A step of a phase finishes only with `--evidence`. |
| `task drop <ref> [--note <text>]` | Drop work no longer needed, with its reason. A step of a phase drops only with `--note`. |
| `task note <ref> [<text> \| --file <path\|->]` | Add a work-log note. |
| `task list [--scope mine\|plan\|project\|all] [--plan <slug>] [--json]` | List tasks in the selected scope. |
| `task list --branch [--base <branch>]` | Project task changes for the pull request body. |
| `task list --branches` | Open project tasks on local unmerged branches. |
| `task show <ref> [--offset <n>] [--history]` | Read a task with its notes and its history: each change with its time, the values before and after, and the session (name and id) and process that made it, or the kit's reason (an import, for example). A deleted task shows its history, its last version included. A project task's history is its file's git log. `--history` also prints every earlier description in full. Output is capped; `--offset` reads more. |
| `task search <text> [--all]` | Search tasks; include closed work with `--all`. |
| `task check [--json]` | Find stale tasks, missed releases, broken refs or files, duplicate titles and new legacy notes. Exit 1 on findings. |
| `task release [--json]` | List release obligations by weight, including missed ones. |
| `task import notes <folder> --kind <kind> [--since YYYY-MM-DD] [--dry-run]` | Import old notes, keeping their Markdown body. |
| `task import claude-mem [--project <name>] [--dry-run]` | Move open claude-mem lists once, each into a plan with one phase and its items as tasks, from the claude-mem project named for this folder. claude-mem's own lists (`my-focus`, `my-rules`, `agent-lifecycle`, `owner-goals` and its month lists) stay out, and a later run drops what an earlier import took from them; one a session added to or changed stays open, and the line names its tasks. Works without claude-mem installed, for that repair. |
| `task delete <ref>` | Delete a mistake, not completed work. Work with notes or tasks under it cannot be deleted. The number is not given to another task. |
| `task mcp` | Run the stdio server; setup registers it. |

The server exposes nine tools: `task_create`, `task_update`, `task_done`, `task_note`,
`task_list`, `task_get`, `task_search`, `task_delete`, `task_take`. `task_list` takes `plan` to select a slug; without it, scope `plan` shows all own plans when there are several, each marked in flight, queued, finishing or parked, in plan-number order (finishing: a plan started under 4.8.0, pending with every phase closed and one done, at its final review). Only one plan runs at a time; parking and resuming are in `/cc-smart-dev-kit:plan-task` § 6. The CLI is the fallback when they
are missing. Work references use a number such as `#12`; project ids use `T-` plus six
base32 characters. The status line shows current work on rows of its own, one per layer: `Plan · <title>` (with `· 2 queued, 1 parked` when your other plans wait), then
`Phases 5/25 · <current phase>` (closed phases out of all the plan's phases), then `Tasks 1/3`
(the current phase's tasks, with the current task's title when it is one). A plan with no phase
shows `Tasks` for its own tasks instead; a loose task shows its title alone. `task_list` and the
portal count a plan the same way: its phases, or its tasks when it has no phase.

**Schema v4:** old nested tasks lift automatically on every write open. A SQLite snapshot
(`work.db.v4.bak`) keeps the pre-move data, including the write-ahead log. Notes and history
stay. Open blocking children remain explicit blockers of their former parents.

**After updating:** run `cc-smart-dev-kit setup`, then restart Claude Code. Run
`cc-smart-dev-kit task import claude-mem` once, in the folder whose lists you want, to move
its open lists. Preview with `--dry-run`. Setup does not import them automatically.

### When you cannot answer: `user`

| Command | What it does |
|---|---|
| `cc-smart-dev-kit user unavailable [--until <time>]` | Marks you as unable to answer, for this machine: asleep, in a meeting, away. `--until` (`8h`, `90m`, `07:30` or an ISO time) says when you are expected back; it is a note, and it never switches back by itself. While it is on, the hooks hold the line ([The hooks](#the-hooks), `user-away`) and every session follows the `user-unavailable` skill: it parks what needs you and goes on. The state lives in the kit's state folder, so it is the machine's unless you run Claude Code on another `CLAUDE_CONFIG_DIR`; and only sessions started after the update carry the hooks, so restart the older ones. In Claude Code's default permission mode a session's own `cc-smart-dev-kit user park` call asks like any command, so allow `Bash(cc-smart-dev-kit user park:*)` once. |
| `cc-smart-dev-kit user available` | You can answer again. What was parked stays on the list. Run `/cc-smart-dev-kit:user-available` in each session that parked something: each session goes through its own items. Run in a session, it says how many items are that session's and which other sessions hold the rest. |
| `cc-smart-dev-kit user status [--json]` | Whether you can answer, since when, and how many items wait, by kind. The parked words and commands are `list`'s: a status never prints them. |
| `cc-smart-dev-kit user park --kind <question\|action\|decision> "<text>" [--command "<command>"] [--option "<option>"]… [--recommend <n>]` | Puts one item on the list. A session does this; so does a hook, for a call it denied. An **action** keeps its exact command, a **question** its options and the recommended one (counted from 1), a **decision** what was chosen, why, and how to undo it. The same item twice, from the same folder, is parked once (the same command from two worktrees is two actions: a yes runs one in its own folder only); empty words or an empty command are refused. |
| `cc-smart-dev-kit user list [--json]` | The items, each with its kind, the session that parked it, when, who answers it, for an action the folder it was parked in, and its command on a line of its own. Who answers it is judged for the session that runs the command: `this session` (it parked it, or the session that parked it ended in this project), `another session` (a running session owns it; `waitsIn` names it), or `no session` (its session ended in another project). The text view shows a control character as a space and says so; `--json` holds every command exact. |
| `cc-smart-dev-kit user clear <n>… \| --all` | Takes answered items off the list. |

The state is one file under the kit's state folder (`user-away/state.json`, mode 0600, written
whole and atomically, one lock for two sessions that park at once). A file that cannot be read is
never read as "available". The list holds 500 items.

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
- the main session's subagents survive a limit only this way.

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
   each step to `~/.claude/cc-smart-dev-kit/update.log`, and records the result. It sends
   no desktop or terminal notification. `doctor` shows the last update result; restart
   Claude sessions to load a newly installed version.

Before it installs, it checks the companion plugins against what the **new** version asks for
(the `dependencies` in the refreshed copy's `plugin.json`). Claude Code will not install a
version while an installed companion is too old for it, so when claude-mem (say) is outside
the new range, or its recorded version is not a version number, the update installs nothing and says what to run first, in one line:
"cc-smart-dev-kit 2.3.0 was not installed, because of a companion plugin it needs:
claude-mem@thedotmack 14.2.0 is outside >=15.0.0. First run: claude plugin update
claude-mem@thedotmack". `cc-smart-dev-kit update` prints that line and exits 1; the background
update records it as a failed update, which the next session start tells you once, however
many hourly checks find the same thing. Run the
command it names, then `cc-smart-dev-kit update`. A companion that is not installed does not
stop the update: when its marketplace is added, Claude Code installs it with the update, and
`doctor` names it either way.

It never restarts the router, a service or a session. A new router still needs
`cc-smart-dev-kit gateway setup`, which asks first. When a background update fails, the next
interactive session start says so once (a `claude -p` run does not count); the same failure
at the hourly checks after it is not told again, and a failure in other words is. A marketplace
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

The Herdr group treats missing hc as optional, warns when hc is too old, and checks its
version when installed. It then reports `Herdr: core not checked`: a no-start core-status
read has not been proved, so real doctor does not yet enumerate live or blocked children.
Use `herdr list --all` to inspect them from a Herdr session.

Task checks cover the server registration, allow entry, five built-in deny entries,
claude-mem's work-state switch, and the local work store's schema version and integrity.
Inside a project, doctor also reports `task check` findings in its task files. Run setup
to repair managed registration or settings; task-file findings name the obligation to fix.

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
  ignores) (§ Windows);
- the instructions: the copy in `~/.claude/cc-smart-dev-kit/instructions/` is this plugin
  version's (each file against the plugin's), and `~/.claude/CLAUDE.md` still holds the block
  that imports it. A ✗'s fix is `cc-smart-dev-kit setup`. A version stamp that names another
  version while every file matches passes, and the line names the old stamp; the next session
  start or `setup` brings it up to date. After
  `--no-instructions`, a `·` line says they are left out, as information;
- the current project: when a `CLAUDE.md`, `.claude/CLAUDE.md` or `CLAUDE.local.md` in the
  current folder or a folder above it imports a cc-smart-dev-kit file
  (`@~/.claude/cc-smart-dev-kit/instructions/…`), that file exists. A missing one loads nothing and
  Claude Code says nothing about it, so doctor fails, fixed by `cc-smart-dev-kit setup` (or, after
  `--no-instructions`, a `·` line with `cc-smart-dev-kit setup --instructions`). No import, no line;
- retired review agents: a ✗ names `cc-smart-dev-kit:reviewer` in the project workflow list
  and tells you to replace it with `cc-smart-dev-kit:senior-engineer`, then merge the change
  by hand or run `cc-smart-dev-kit workflow review-done`, because the merge guard reads the
  base branch's list. A personal `workflow.json` list gets its own ✗ with `workflow set` or
  `unset`, run in your own terminal (inside Claude Code they refuse the gate's keys); those
  changes count at once. A ! names each instruction file that mentions the old id: the
  project's `CLAUDE.md`, `.claude/CLAUDE.md` and `CLAUDE.local.md`, and the Markdown files, at
  any depth, in `.claude/cc-smart-dev-kit/`, `.claude/rules/`, `.claude/agents/`,
  `.claude/skills/`, `.claude/commands/` and `.claude/output-styles/`; files and folders it
  cannot read are skipped;
- git can read the marketplace (`git ls-remote`, with no password prompt in a terminal:
  `GIT_TERMINAL_PROMPT=0`; a git credential helper with a window of its own may still
  show one). It adds ssh `BatchMode` only when you have no ssh command of your own
  (`GIT_SSH_COMMAND`, `GIT_SSH` or `core.sshCommand`). It prints URLs without
  credentials. When it cannot, the ✗ names the cause when git's own words say it — ssh to
  GitHub was refused (add the marketplace over HTTPS instead), or the GitHub account cannot
  read the repository (ask its owner for read access, then accept the invitation) — and keeps
  its old line for anything else;
- Claude Code's own plugin auto-update is off for this marketplace. It fails when it is on (`autoUpdate: true` in `settings.json`, or Claude Code's own record in `known_marketplaces.json` with no key in the settings): it knows nothing of the major hold, so it would install a major version by itself. For setup's own leftover `true` the fix is `cc-smart-dev-kit setup`; for a `true` you set, remove it by hand, then run setup;
- the heavy-job limit and its source (default or the new machine file), plus ignored legacy `maxJobs` with its removal step;
- Claude Code's [retry watchdog](#waiting-at-a-limit-claude-codes-retry-watchdog), as information (`·`), never a failure: on (set by cc-smart-dev-kit), on (your own `CLAUDE_CODE_RETRY_WATCHDOG`), off with the command that turns it on, or off because your own value leaves it off;
- how many subagents a session runs at once ([Subagent concurrency](#subagent-concurrency)), as
  information (`·`), never a failure: the kit's value (set by cc-smart-dev-kit, with the
  `setup --max-subagents <n>` line that changes it); your own value, with the settings file to
  change it in; Claude Code's own default because you removed the key; or Claude Code's own
  default because the key was never set, with `cc-smart-dev-kit setup` to use the kit's value;
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
- [claude-mem's start blocks](#claude-mems-start-blocks): memory-use and work-state blocks
  off, with each value's source. Your own choice is information, not a failure. The task
  checks cover the server, permissions, work-store schema and integrity, and project files;
  setup is the fix for missing managed settings;

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
- the portal: ✓ while it runs, with its address, version and process; `·` when it is not
  running (it starts with the next Claude Code session, or now with `cc-smart-dev-kit
  portal`); `!` when it runs an older version, which the next session start restarts onto
  this one; ✗ when another program holds its port, so it cannot start
  ([The portal](#the-portal));
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
- every project of your portal's list, whether or not the gateway is installed: one `·` line
  each with its own state and the file it comes from (the same reader and words as
  `gateway projects`); `!` for a project pointing at another gateway's address, and ✗ when one
  of its settings files cannot be read (nothing past it is guessed). ✗ for a project whose
  address names a profile (`…/p/<name>`) while the router that answers is an older copy that
  does not know profiles (its health page lists no `profiles` feature): every request there
  fails until `cc-smart-dev-kit gateway setup` puts this version's router in place. `!` too, one line each,
  for Claude Code's own model keys in a project's files — `model` or an
  `ANTHROPIC_DEFAULT_<FAMILY>_MODEL` naming a slot (`cc-smart-dev-kit-worker`) or a backend
  target (`omniroute:<model>`) reaches past the gateway's slots, and
  `CLAUDE_CODE_SUBAGENT_MODEL[_FORCE]` moves an agent launched without a `model` off Claude.
  cc-smart-dev-kit never writes those keys: each line says to remove it by hand
  ([docs/gateway.md](docs/gateway.md) § Per project);
- the gateway, when it is installed (the router copy, or one of its units — on Windows, its
  Scheduled Task — is there): the
  router service is active, the router copy is this plugin version's, the socket unit
  `cc-smart-dev-kit-router.socket` is there, listens on the config's port and is active (a
  router set up by an older version has none: ✗, fixed by `cc-smart-dev-kit gateway setup`), the
  router answers on its port (when it does not, the ✗ says which of two cases it is: the
  socket is open but no router answers, so every request waits; or the router failed to
  start again and again, so systemd closed the socket and every request is refused; both
  name `journalctl --user -u cc-smart-dev-kit-router -n 30`), each backend answers, every judge
  target of your own judge chain passed the judge test (a worker target that did not is information, never a failure); a
  `!` warning, with a `Fix:`, while auto mode's safety checks are failing for want of a stand-in
  for a limited or down Claude (never a failure: nothing is broken); and, as
  information, each slot's first target. Without
  `gateway.json` (set up with `--no-backend-key`), a `·` line says every slot answers on
  Claude. Doctor lists the gateway model menu rows. If user settings fix `model` to a
  concrete id, it explains that `/model <alias>` follows the newest instead; this is
  information, not a failure. When it was never set up, doctor says "gateway: not set up (optional)" as
  information (`·`), not as a failure; with only `gateway.json` left (restore keeps it),
  "gateway.json kept; the gateway is not installed". A `gateway.json` that
  [`setup`'s one-time move to the Claude defaults](#first-setup) has not met yet gets one more `·`
  line that names `cc-smart-dev-kit setup` and what it does (the update never runs it);
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
    name it still lists that silences nothing: a retired hook (`serena-root`, `crew-role`,
    `lead-notes`, `message-guard`) or one no project can switch off (`job-route`). Accepted, it can go;
  - `!` warnings (never a failure) for an `ownHooks` entry with no project hook left to
    answer, and for a project hook that runs next to a plugin hook `ownHooks` does not
    name: both would answer (§ The hooks);
  - as information (`·`), once: a kind in `jobs.kinds` that still sets a size field (`gb`,
    `filesGb`, `maxFiles`, `workers`, `light`). The heavy-job queue ignores them, so they can
    go; the line names the kinds and the fields;
  - `!` warnings for the plugin's old `anymodel` names a project still carries from 0.2.x
    (`.claude/anymodel.json`, a `.claude/anymodel/` folder, a settings hook that calls
    `~/.local/bin/anymodel`): each names the new file, folder or command (§ Projects that
    used the old name);
  - `!` when the file's `requires` lets in a plugin older than the one that brought a field
    the file holds (a file that sets `tasks`, a field of 1.10.0, under `>=1.0`): that plugin
    refuses the whole file instead of saying "update". The fix line names the range to use;
    `project init` and any `workflow set … --project` raise it;
  - `!` in a project with a `cc-smart-dev-kit.json`, when git is older than 2.40: a fix made
    after a review cannot be measured there, so each fix needs a review of the exact new head
    (§ The review record);
  - the project's task files (`cc-smart-dev-kit task check`'s findings): `project tasks: no
    findings`, or one ✗ line per kind of finding, with its count and `task check` as the fix;
    a `·` line when the release branch is not there locally, so missed releases were not
    checked;
  - GitHub Issues, **only while `issues.enabled` is on** (no line, and no `gh` call, while it is
    off): one `✓` line that `gh` is logged in for github.com and can file issues in `origin`'s
    repository (`gh auth status`, and `gh repo view`'s `hasIssuesEnabled` and `viewerPermission`),
    or one `✗` with its fix — `gh` missing or logged out, an `origin` that is not on github.com,
    issues turned off for the repository, or read-only access (a label cannot be applied). Triage
    access, and a public repository while `issues.allowPublic` is off, are `!` warnings;
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
`gateway slot <slot> custom` brings it back. **By default every slot is Claude (the judge's
too), no fallback is on, and the gateway is off** (D66): a fresh setup gives no slot a chain, and
the plugin picks no model for you. A machine set up before 1.2.0 moves there once, at its next
`cc-smart-dev-kit setup`, with a backup first ([below](#first-setup)). No prompt text
is ever changed. The service that keeps the
router running is a systemd user unit on Linux and a per-user Scheduled Task on Windows
(see [Windows](#windows)); macOS has neither, and `gateway setup` refuses there.
How it works: [docs/gateway.md](docs/gateway.md).

| Command | What it does |
|---|---|
| `cc-smart-dev-kit gateway check` | One read-only question, for scripts (the installer asks it): does the gateway have an OmniRoute key the backend accepts? Exit 0 yes, 1 no key yet (OmniRoute answers, so one can be made), 3 it could not be judged (nothing answers, or the config cannot be read), 4 the key is one OmniRoute refuses. It asks the backend only — never the router's port — and prints one line saying what it found; a 1 or a 4 adds a `Fix:` line and the setup commands that fix it. |
| `cc-smart-dev-kit gateway setup [--yes] [--backend-key-stdin <backend> \| --omniroute-password[-stdin] \| --no-backend-key] [--save-unchecked]` | On a terminal with no key flag and no `--yes`, it first asks OmniRoute's address and its API key (no echo); it asks no slot and never turns the gateway on (every slot stays Claude, the gateway stays off); Ctrl+C at a question exits 130 with nothing changed ([The AI gateway](#the-ai-gateway-optional), step 2). Makes `~/.config/cc-smart-dev-kit/gateway.json` (mode 600; the key on stdin, never argv), copies the router to `~/.local/share/cc-smart-dev-kit/router.js`, writes the systemd user units `cc-smart-dev-kit-router.socket` (it holds the port) and `cc-smart-dev-kit-router.service`, starts them, and waits up to 5 s for the router to answer. First of all it asks the router's port: when another program holds it (an older router, say), it stops and writes nothing. When the router runs and the copy or a unit changed, it says what the restart does and asks; `--yes` skips the question. A restart lets the answers in flight finish (up to 120 s; an answer still running then is cut, and Claude Code retries it), and new requests wait in the socket meanwhile, so none of them fails. A connection that sends nothing is closed half a second after the restart starts, so it cannot hold the restart. The exceptions are the restarts that must open the socket again (the first setup that moves a router from an older version to its socket, a socket that was stopped, a changed socket unit or port): until the old router has finished its answers, new requests fail, and setup's warning names which case it is. When the socket cannot open at all, setup says so and starts the router without it (the router binds the port itself). A router that fails to start 5 times within 60 s is given up: systemd then closes its socket too, so requests are refused at once instead of waiting; `doctor` names it, and `gateway setup` starts both again. A setup that stopped half way is finished by the next one. In Claude Code's settings it retires the unchanged kit-owned 4.0.0 Fable pin, refreshes the kit's model menu while its own gateway is on (otherwise it removes an unchanged kit menu left behind), and takes out the model keys 0.4.3's `gateway on` wrote (`ANTHROPIC_DEFAULT_HAIKU_MODEL` / `…_SONNET_MODEL` and their `…_NAME` / `…_DESCRIPTION`), where cc-smart-dev-kit still owns them; then restart every open Claude session. In `gateway.json` it drops the `claude-sonnet-5-5` 0.4.x put at the end of a scout or worker chain that is still that exact default. It no longer reads or changes the old portal's `portal.json` (1.0.1 and older kept the opus, fable and judge chains there; 1.1.0 to 1.4.0 moved them at setup; from 1.4.1 the file stays as it is). A machine that updates from 1.0.x or older straight to 1.4.1 sets each chain again with `gateway slot` (below). |
| `cc-smart-dev-kit gateway status` | Router health (open breakers included), each backend, the slots, whether Claude Code points at the gateway, and the request history's size and retention, each finding marked (`✓` `✗` `!` `·`; the slot rows are a plain table), then one verdict and the next step: not set up yet (`gateway setup`), the config cannot be read, the router does not answer (`Fix:` setup starts it again), Claude Code points at another address (`gateway on`), a backend does not answer, the gateway is off (the router answers and Claude Code does not use it: the default, and the verdict names `gateway on` in its words, with no next step), or all well. Keys are masked. |
| `cc-smart-dev-kit gateway history [1h\|4h\|1d\|7d\|14d\|30d\|90d] [--by target\|slot\|model\|session] [--slot <name>] [--target <target>] [--model <model>] [--session <id>] [--errors]` | The request history: one row per routed request, never a prompt, a tool or an answer. Per target (the default), slot, model or session: requests, errors, input/output/cache tokens, the estimated cost and the worst bucket's p95 latency, for the range (default `1d`). `--errors` keeps only statuses of 400 or more. The portal's Flow page charts the same data. |
| `cc-smart-dev-kit gateway models` | Every model each backend offers, and the slots. |
| `cc-smart-dev-kit gateway slot <scout\|worker\|opus\|fable> <target>[,<target>…]` | Custom: a slot's chain (any targets, any order, from `gateway models`); live. `slot <slot> claude` (or `off`): Claude again, and the chain is saved, not used. `slot <slot> custom`: the saved chain again, with its fallback switch. `slot <slot> clear`: delete the chain, in use or saved. |
| `cc-smart-dev-kit gateway slot judge <target>[,<target>…]` | Your own judge for auto mode, in the order you give: a `claude-<model>` target as it is, any other target only after it blocks a test force push to `main`. A weak judge can let a risky command through, and it reads the conversation. Without it, Claude judges first, and while Claude is limited or down the worker slot's targets that passed the same test judge. `slot judge claude` (or `off`): back to that, with the chain saved; `slot judge custom` uses the saved chain again (untested targets are tested first). |
| `cc-smart-dev-kit gateway fallback <slot> on\|off` | May the next target answer when the one before it fails or rests? Off by default for every slot but the judge (D66): you turn it on, slot by slot. Off: only the first answers, the rest stay saved. The judge's is **on by default** (2026-10-27): the worker's tested targets (and only those) judge auto mode's checks while Claude is limited or down; `fallback judge off`: Claude alone judges. |
| `cc-smart-dev-kit gateway effort <slot> <target> <level>\|off` | Pin a backend target's reasoning effort in its slot: `none`, `low`, `medium`, `high`, `xhigh`, `max`. One test request before saving; a refusal saves nothing. `off` follows Claude Code again. Live, with no restart. No pin for a `claude-…` target. |
| `cc-smart-dev-kit gateway breaker <slot> on\|off` | When every target of a slot is limited or down, may the router hold the request for a while and then ask Claude Code to retry (up to 240 s, `timeouts.breakerHoldMs`; 0 holds none)? Off: the last answer goes back at once. On by default for every slot but the judge, which never holds, so it has no switch. |
| `cc-smart-dev-kit gateway on` | Points Claude Code at the router: sets its env keys in your `settings.json` as keys cc-smart-dev-kit owns. It also owns `modelPicker`: one alias row per Claude family, naming any first target, or "Claude's newest <Family>" when there is no chain. Models are automatic; the kit never writes a model id. Your own menu stays with an information line. The old owned Fable pin is retired; your own value stays. A routing key someone else set stops it. Nothing is overwritten. Every running session switches on save. Remote Control is off while the gateway is on (Claude Code allows it only with `api.anthropic.com` as the address); `gateway off` brings it back, and `gateway on` says so in one line. Whether a session connects by itself at its start is `remoteControlAtStartup`, which `setup` turns on only while you have not set it ([Remote Control](#remote-control)). |
| `cc-smart-dev-kit gateway off` | Points Claude Code back at Anthropic: the owned `ANTHROPIC_BASE_URL` is **set to Anthropic's own address instead of removed**, so every running session switches by itself within about a second — nothing to restart. The key stays owned (its value is the one `off` wrote), so `restore` takes it back later. `ENABLE_TOOL_SEARCH`, the owned model menu and the retired owned Fable pin are removed; tool search waits for each session's next restart. A key you set or changed since is yours and stays. A project that set its own `on` keeps pointing at the router, so `off` names each one with the command that turns it off too (`gateway project off --folder <dir>`). If you set `ANTHROPIC_BASE_URL` in your shell, the settings file's explicit address wins until `restore` removes it. |
| `cc-smart-dev-kit gateway project status [--folder <dir>]` | This project's gateway state and where it comes from: its own personal file, its team file, or the machine's settings — plus what a file it cannot read would mean (nothing is guessed). Says that a `--settings` launch is not visible here. |
| `cc-smart-dev-kit gateway project on\|off\|default [--team] [--profile <name>] [--folder <dir>]` | This project's own state: `on` (this machine's router, or the profile's URL with `--profile`), `off` (Anthropic's own address: your own login, never a logout), or `default` (no key: the machine's settings decide). The model menu follows the machine slots, not project settings; `launch --profile <name>` carries profile rows when the user menu is absent and never managed, or still ours. The personal file `.claude/settings.local.json` by default, kept out of git and taken back by `restore`; `--team` writes `.claude/settings.json` and takes `off` or `default` only. A changed value reaches a running session; a removed key falls to the next file that sets it, and only with none does the session keep its value. Refused, with the fix: another gateway's URL in the file, a personal file git already tracks, a login key or `apiKeyHelper` at any level of the chain (with `on` or `off`), `--team` with `on`, a profile the config does not have, `--profile` while the running router does not know profiles (an older copy still runs: `gateway setup` replaces it; the portal's Gateway card runs this same command). |
| `cc-smart-dev-kit gateway projects [--folder <dir>]` | Every project the portal's Projects page lists — the same list — with its own state and the file it comes from. |
| `cc-smart-dev-kit gateway profile <name> slot <slot> <targets>\|off\|clear` | A profile's own chain for a slot, checked against the live model list exactly as `gateway slot` checks the machine's; `off` (`claude`) is plain Claude there, `clear` forgets it so the machine's chain applies again. The first chain makes the profile. |
| `cc-smart-dev-kit gateway profile <name> fallback <slot> on\|off` | The profile's fallback switch: may its next target answer when the one before it fails or rests? |
| `cc-smart-dev-kit gateway profile <name> breaker <slot> on\|off` | The profile's breaker switch: may the router hold a request while every target the profile uses for that slot is limited or down? Not for the judge, which never holds. |
| `cc-smart-dev-kit gateway profile <name> remove` | Deletes the profile. A project whose URL still names it answers as plain Claude. |
| `cc-smart-dev-kit gateway serve` | Runs the router in the terminal. |

**A project's own state.** `gateway on` is every session's default; `gateway project` gives one
project its own answer. The value is the project's `ANTHROPIC_BASE_URL`, in its **personal**
file — `.claude/settings.local.json` at the main checkout's root, which Claude Code reads for
the checkout, every subfolder and every worktree, before the folder's own `settings.local.json`
(that one decides only what the root's file does not set) — with a managed `.git/info/exclude`
line so it is never committed, and `restore` takes back both. A worktree's own copy of the file
(a project's `.worktreeinclude` makes one) that still holds the router's address is named by
`gateway project status`, `default` and `restore`, and never changed: the kit did not write it. `--team` writes the project's
`.claude/settings.json` instead, for `off` and `default` only: a team file never points
teammates at one person's local router, and a session started in a subfolder does not read it.
A changed value reaches a session already running in the project within about a second; a
removed key moves it, within a few seconds, to the next file that still sets the key (the machine's settings,
say), and only when no file does it keeps its old value until it restarts. The
refusals are one line each, with the fix — another gateway's URL in the file is never
overwritten, a personal file git already tracks is refused for `on` (a router address there
would be committed with it), and `on` or `off` stops while `ANTHROPIC_API_KEY`,
`ANTHROPIC_AUTH_TOKEN` or `apiKeyHelper` is set anywhere in the project's chain, because the
gateway sends your own Claude login. `gateway projects` shows every project with its state. A project that needs other models
gets a **profile** (`gateway profile <name> slot …` — the first chain makes it) and points at
it: `gateway project on --profile <name>`.
[docs/gateway.md](docs/gateway.md) § Per project.

**One session, another path.** `cc-smart-dev-kit launch --no-gateway` starts one session on
plain Claude even where `gateway on` sends everything to the router, and `launch --gateway` or
`launch --profile <name>` does the opposite for one session. It passes a `--settings` file,
which beats the project's personal file, its team file and the machine's settings — for that
session only. [docs/gateway.md](docs/gateway.md) § One session.

**The request history.** The router logs one row per routed request — the time, the Claude
Code session id, the model, slot, profile, target and status, the latency, the tokens the
answer reported and an estimated cost — in `~/.local/state/cc-smart-dev-kit/history.db`. It is
**never** a prompt, a system text, a tool, an answer or a key. Rows are kept 90 days by
default: `"history": {"retentionDays": 7}` in `gateway.json` changes that, and `0` turns the
log off. `gateway history` and the portal's Flow page read it; `doctor` and `gateway status`
show its size. [docs/gateway.md](docs/gateway.md) § The request history.

A backend target can keep one reasoning effort whatever Claude Code sends, including when
thinking is off: `gateway effort <slot> <backend>:<model> xhigh`. The pin is per slot and
target, tested before saving, and shown beside the target by `gateway status`. Switching the
slot to Claude saves the pin with its chain; Custom restores it. Removing a target or clearing
the chain removes its pin. `gateway effort <slot> <target> off` follows Claude Code again.
See [the effort pin](docs/gateway.md#a-backend-targets-effort-pin-d64) for the config and limits.

### First setup

1. Run OmniRoute on this machine at `http://127.0.0.1:20128`: setup writes that address
   for the `omniroute` backend. Give it a connection to the provider whose models you want.
   OmniRoute somewhere else: setup's first question takes its address (or, after setup, change
   `backends.omniroute.baseUrl` in `~/.config/cc-smart-dev-kit/gateway.json`).
2. **The key: answer setup's questions, let setup make one, or give it one you have.** On a
   terminal, `cc-smart-dev-kit gateway setup` with no key flag asks two questions: OmniRoute's
   address, and its API key (read with no echo; Enter keeps the saved one). It asks no slot,
   offers no model, and never turns the gateway on: every slot stays Claude and the gateway stays
   off (D66). It asks both before it changes anything, and Ctrl+C at a question stops it
   (exit 130) with nothing changed. With no terminal, or with `--yes` or a key flag, nothing is
   asked. `setup` can also log in to OmniRoute
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
4. `cc-smart-dev-kit gateway status` shows the router, the backend and the slots. Every slot is
   Claude, and the gateway is off, until you ask otherwise: `cc-smart-dev-kit gateway models`
   lists what each backend offers, `cc-smart-dev-kit gateway slot <slot> <target>[,…]` gives a
   slot a chain, and `cc-smart-dev-kit gateway on` points Claude Code at the router. With
   nothing set, every model is plain Claude on your own login. To check the key alone
   (read-only, no restart): `cc-smart-dev-kit gateway check`.

   **A machine set up before 1.2.0 moves to these defaults once**, in its next `cc-smart-dev-kit
   setup` (the installer runs it): every slot's chain goes (the machine's and each profile's; the
   machine's wait in `kept`, `gateway slot <slot> custom` brings one back), every fallback
   switch goes off (the judge's default is on, so a `fallback judge off` you set stays), and the
   gateway goes off through the code `gateway off` runs. claude-mem
   follows the scout back to Claude on your own login. setup makes a backup of `gateway.json`
   first, prints one line per change (`worker: omniroute:x,omniroute:y → Claude`) and says where
   the backup is; `setup --dry-run` shows the lines and writes nothing. It runs once per machine
   (a marker file, `claude-by-default`, in the state folder; `restore` leaves it, as it leaves
   `gateway.json`), so a chain or a switch you set afterwards is never touched again. A
   project's own switch (`gateway project on`) is the project's choice and stays. A route you
   chose for claude-mem (`claude-mem route`) stays too.

Auto mode's safety checks are judged by Claude first. While Claude is limited or down, the
targets of your worker slot that passed the judge test judge in its place, by default
(`gateway slot worker` and `gateway setup` run the test and say which target passed and which
failed; a target that failed stays a worker model and never judges). With no tested target,
Claude judges alone. `gateway fallback judge off` keeps Claude alone even then. When a check
fails anyway (Claude is limited or down and nothing stood in), auto mode approves nothing, and
the status line, `gateway status` and `doctor` say so, since when, why, and the exact fix
(`gateway setup` to test the worker's targets, `gateway fallback judge on` if you turned the
stand-in off, or the time Claude's limit resets); every session on the gateway is told once to
stop and wait instead of retrying.
You can give the judge slot a chain of your own, which wins, and a judge set before 0.5.0 must be
tested and set again (`cc-smart-dev-kit gateway slot judge <target>[,…]`). A more affordable judge
can block good work, and a weak one can let a risky command through, so `slot judge` first tests
each target on one obvious case and refuses a target that lets it run. The router
recognises the check by its prompt. If Claude Code rewords that prompt, the check is
routed by its model name until the router is updated (see
[docs/gateway.md](docs/gateway.md) § Known limits; [roadmap](docs/roadmap.md) Phase 3).

### Remote Control

`cc-smart-dev-kit setup` turns Remote Control's auto-connect on: `remoteControlAtStartup: true` in
`~/.claude/settings.json`, so a session connects to claude.ai/code and the Claude app when it
starts. It writes the key only while it is absent, with no question. A `true` or `false` you set is
yours: setup leaves it and does not mention it. A key setup wrote and you changed or deleted since
is yours too (setup says so once, and never writes the key again). `restore` removes the key only
while it still holds the `true` setup wrote. You can switch it in `/config` ("Enable Remote
Control for all sessions") at any time. Claude Code reads the key from your user settings (or a
`--settings` file, or managed settings), never from a project's files, and Remote Control needs a
claude.ai subscription login (an API key does not work).

**Remote Control is off while the gateway is on.** Claude Code allows it only when
`ANTHROPIC_BASE_URL` is unset or points at `api.anthropic.com`, and `gateway on` sets it. The key
stays in your settings; `cc-smart-dev-kit gateway off` brings Remote Control back
([docs/gateway.md](docs/gateway.md) § Known limits).

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
The kit sends no usage-limit or breaker notification. The status line and `usage` keep
the usage and reset information below. Plan limits follow the login: an answer from another
model clears a shared window only when its headers prove room. After a login or window
change, the status line hides a saved shared limit and its fallback when the session's own
matching window has a different reset. A matching reset keeps a real limit visible;
per-family limits and sessions with no usage input keep their existing display.
Two logins through one router: one login's answer that proves room ends a record the other login
still hits; that login's next 429 writes it again.

- **The status line.** `cc-smart-dev-kit setup --statusline` sets Claude Code's status line to
  `cc-smart-dev-kit statusline`. It shows the session's context use and reasoning effort
  (below), who really answered while the gateway is on (`Sonnet 5.5 → gpt-6.1-sol`
  for a different backend or fallback; no repeated arrow when a limit banner names it),
  your 5-hour and 7-day plan usage, warns from 85 %, shows any fallback in use, and,
  while a slot's breaker is open, `<slot> slot: every target limited since 21:05 → gateway slot
  <slot> <targets>`, and, while auto mode's safety checks fail because Claude is limited or down
  and nothing stood in, `⛔ auto mode's safety checks are failing since 09:40: Claude is at its plan
  limit (five_hour) until 13:00, and no worker target has passed the judge test →
  cc-smart-dev-kit gateway setup` (the fix follows the cause: `gateway setup` tests the worker's
  targets, `gateway fallback judge on` turns a stand-in you switched off back on, or you wait
  until the reset). `gateway status` and `doctor` print the same words with a `Fix:` line, and the
  session is told once to stop and wait instead of retrying.
  - **The task rows**, below the model, context, usage and cache-miss row: `Plan · <title>`
    (with `· 2 queued, 1 parked` when your other open plans wait behind it),
    then `Phases 5/25 · <current phase>` when the plan has phases, then `Tasks 1/3` (the
    current phase's tasks, with the current task's title when it is one). A plan with no phase
    shows `Tasks` for its own tasks; an empty plan shows `Tasks 0/0`. A task in a phased plan
    but under no phase shows its title on a last row. A loose task shows its title alone; with
    no current work there are no task rows. The command keeps each title whole, with no
    60-character cut; the terminal limits what fits.
  - **The context segment**, always there once Claude Code reports any use, for example
    `ctx 312k · 78% of 400k · xhigh`: the tokens in the context, the share of the window they
    fill, and the reasoning effort. Claude Code itself shows its gauge only near auto-compact and
    has no setting to show it always. The window is the **auto-compact window** you set —
    `/autocompact 400000` saves it as `modelSettings.<model id>.autoCompactWindow` in your
    `settings.json`; a top-level `autoCompactWindow`, a project's `.claude/settings.json` or
    `settings.local.json` and the `CLAUDE_CODE_AUTO_COMPACT_WINDOW` variable count too, in Claude
    Code's order — and with none, or `"auto"`, the model's own window (`1M` for a current model).
    It starts with `⚠` from the same share as the plan usage (`alerts.usagePercent`). It reads
    Claude Code's settings and writes nothing. A session started with `--autocompact <n>` has
    its window on the command line, which the status line cannot see: it shows the setting's.
    Claude Code compacts a little before the window (it keeps about 33 000 tokens free), and
    `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE` lowers that point further; the segment measures against the
    window itself and does not apply either. No segment shows while Claude Code reports no use.
  - **The effort** is the one the session runs at now (`/effort` shows at the next refresh).
    When the session runs on the gateway and the slot's backend target keeps a pinned effort
    (`gateway effort`), the pinned one is shown: it is what answers (the slot's first target, or
    the one a fallback record says answers; a target a held request has not yet moved to is not
    seen). When Claude Code reports no
    effort (a model without the parameter), the line shows none.
  - **A prompt-cache miss**, for a minute: for 60 seconds after Claude Code reports a miss, the
    line ends with `cache miss: tools_changed` (Claude Code's own cause names, from
    `prompt_cache.last_miss_cause`; `cause not known` when it found none), then it is gone until
    the next one. It goes by the miss's own time, so a refresh that never reached your screen
    does not hide it. A miss makes the session write the cache again, which costs usage; the kit
    adds nothing known to cause one, and this is where you would see it. The last miss is kept
    in `~/.claude/cc-smart-dev-kit/cache-miss.json`, and `doctor --live` ends with it.
  - **The plan usage it reads is also written down**: the 5-hour and 7-day windows, in
    `~/.claude/cc-smart-dev-kit/usage-window.json`, only when the numbers change. The portal shows
    the 5-hour one. Claude is never told your plan's usage: the numbers are for you.
- **Each subagent's row in the agent panel.** The plugin's own `settings.json` sets Claude
  Code's `subagentStatusLine`, so every subagent's row reads `<label> · <slot> → <model> →
  <effort> · <context>` — the slot its requests reach (scout, worker, opus or fable, from the
  model's Claude family), the model that really answered while the gateway is on
  (a backend or fallback included; Claude Code's resolved model before its first answer),
  the effort it runs at, and how much of
  its context window it uses (`~45k/200k ctx (23%)`, about: the count runs a little high; left
  out until Claude Code reports a count). On a narrow terminal the label shrinks first, so the
  route and the context stay. It is the same routing `agent-guard` judges, on screen while the
  agent runs.
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
(`/events`, Server-Sent Events) and shows a routed request, a plan limit, a guard's question, an
update check, a change in the heavy-job queue or a changed task as it lands. Several tabs share
it; more than eight open tabs are refused with a short line instead of holding the server open.
The pages fetch their facts from read-only `/api/…` answers (the portal's own interface, not a
public API), and an action that runs a command no longer freezes anything: installing an update
shows each step while it runs, and the pages and the stream stay live. When the connection
drops, the header says "Reconnecting…" and the page keeps what it last knew; it catches up by
itself when the portal answers again.

**Every change is made in place.** A button that restarts or rewrites something asks first, in
the page, naming the exact change (save a chain, switch a slot, write a project's own setting);
then it shows "Working…" and the command's newest line, and its result beside the button — `✓`
with what changed, or `✗ Not done:` with the command's own words, **Details** and **Try
again**. The page is never reloaded to show it, so an edit elsewhere on the page is never lost.
A page drawn from mock data (`?mock=` in its address, for a look at its other states) says
"Mock data" in its header and sends nothing. A page whose subject is not there (an unknown
project) says so and links back, with no **Try again**.

The pages, each following the design the owner approved (2026-10-16):

| Screen | What it shows |
|---|---|
| **Overview** | The traffic now: requests a minute, fallbacks, open breakers, and the plan's **5-hour window** as Claude Code's status line last recorded it (its share and when it resets; the 7-day windows are written nowhere, so none is shown). Requests and the estimated cost over time, the heavy-job queue at a glance, and two **switches** in separate rows — Gateway, then Auto-mode judge — each asked first and saved at once. The judge says "Claude judges" or "Your judge chain judges" and is disabled while the gateway is off ("Works only with the gateway on"). Each model slot keeps its own switch on Slots. The fallbacks and the plan limits the router saw are tabs of the requests table. |
| **Usage** | Tokens and the estimated cost over time, by slot, target, model and session, with each session's own totals under them. |
| **Work** | Your Claude Code sessions of the project the portal runs in, from the last two days — a portal starts in your home folder, which is no project, so this list is empty unless you started it in a project, and the page says so — with the model of their last reply and their state — working, waiting for your answer, idle, or ended — and a **Copy** of `claude --resume` for one that is idle or ended. |
| **Tasks** | Every project's tasks (`/api/tasks`): four counts (open work and how much is in progress, blocked, non-blocking, and task files owed with how many block a release), then two tabs. **Work on this machine** shows each project as session › plan › phase › task: each session named (its short id when it has none), running now or not, running ones first. **Every level folds**, and the page remembers your folds in this browser; done plans and phases start folded. Each row shows its status, a **non-blocking** mark, what it is blocked by, whether a running process holds it (**running**) or its process ended (**claim ended**), its notes and its progress (a plan or a phase counts all its tasks, closed long ago too). **Each phase row is the ledger of its build**: its steps done of its blocking steps, then the agent, branch, worktree (by its folder's name) and base commit (short) the main session set on it. **Click a row** to open the task in a side panel: its facts, description, notes and history. On a plan or a task, **Move to session…** moves it to another session that runs in the project with a name, after a question that names both sessions and says whether a running process still holds it (then the button says **Take it over anyway**). The filter bar: one project, words or a `#number`, status (open, in progress, blocked, closed, all), session, plan, **Running sessions only**, **Non-blocking only**; a match keeps the tasks above it, muted, and the whole view is in the address. A long list shows a page of rows and says how many more wait. **Owed by the project** lists the task files each main checkout keeps, by kind and weight, stale ones marked, with the same project and search. It updates by itself when any session changes a task. |
| **Flow** | How the work moved in the last 24 hours or 7 days: agent launches and the time sessions waited for your answers per hour (per six hours over 7 days), parallel work, the guard asks that stopped them most, and the sessions' own totals. |
| **Slots** | One card per slot. **Who answers**: Claude or Custom, both named (`gateway slot <slot> claude\|custom`); Custom stays unavailable, with its reason, until a chain is saved (the judge: until every backend target passed the force-push test). **The chain**: the one in use, or the one saved while Claude answers ("Saved, not in use"); drag a target or use its arrows, add one from the backends' live model list, or type one, which the server checks with the command line's own rule before it joins (`✗ "omnirout:<model>": backend "omnirout" is not in the config`). Edits stay a draft until **Save**, which asks first and runs `gateway slot <slot> <targets>` (in Claude mode it says that saving puts the chain in use). A save over a chain that changed since the page read it (another tab, the command line) is refused, and the card offers **Load it** or **Keep mine**. **Test each target** marks each one (one tiny chat to an affordable model, the force-push test for a judge). **Fallback** and **Breaker** save at once, after a confirmation (`gateway fallback`, `gateway breaker`; the judge has no breaker). **Effort**: each backend target shows its pin, or "follows Claude Code"; pick a level or "follow Claude Code" and **Set**, which asks first and runs `gateway effort <slot> <target> <level>\|off`. The test request it sends, and a level the backend refuses (nothing is saved), show in place. The pin wins over whatever effort Claude Code sends, and a higher effort is slower and uses more of the subscription's limit. A `claude-…` target has no control: it goes to Anthropic with the effort Claude Code sends. While Claude answers the slot, the saved chain's pins show, and a change waits for Custom. Each target shows its last day from the request history. |
| **Health** | The router's counters, what holds its port across restarts (the socket unit, or the Windows task) in `doctor`'s own words with its fix, each backend and whether it answers, the targets resting, latency and errors over time, and its journal. When the router does not answer: why, the commands that show its state and its log, and **Restart the router** (`gateway setup --yes`), asked first. |
| **Guard log** | What each guard asked you or refused, newest first and paged by the server: pick a range, a guard or a session; the asks per guard over the range are charted, and the two menus offer what the range holds. |
| **Machine** | The kit's version; Claude Code's (`claude --version`) and whether `doctor --live` proved it; the Bun the portal runs on against the one the kit needs; `doctor` with each failure's fix and **Run doctor**; the **Heavy jobs** card (the one slot and whether it is in use; the run that holds it and the runs waiting, in queue order, each with its kind, command, folder, who started it and for how long; and whether a heavy command here goes through the queue, and whose setting decided); Updates (installed, newest, last check, **Check now**, a held major); the companion plugins (**Turn it on** for one turned off); the MCP servers setup registers; the **Browser card** (**Set up the browser**, the steps, and a masked field that saves the extension's token: the stored value is never on the page); OmniRoute (**Update** and **Roll back**, each saying what the restart costs, and [the gateway's key](#the-gateways-key-from-the-portal): paste one, or make one with your OmniRoute password); the [claude-mem card](#claude-mem-from-the-portal) (where its summaries go, its key, its fallback, and who set each); the project's auto-mode trust rules with **Write them**; and the worktrees with **Clean finished now**. |
| **Settings** | Every workflow setting, one row each: what Claude does after a finished step (auto commit, auto push, the pull request, the auto-merge rule, the merge method, the branch, the review before the first push, and the worktree), the usage-warning percentage, and the switches (the status line, the session names, the heavy-job queue, the update hold). Each row says where its value comes from — `Your default`, `This project` or `Built-in default` — and a row the project sets is read-only here: a project's own value is changed on its page. Its **Projects** tab lists every project you work in, with each one's page (below). |
| **How this page stays private** | The security design in plain words, linked from the footer. |

**The Settings page writes one value at a time**, through the same functions the command
line's `workflow set` uses, so the page and `cc-smart-dev-kit workflow show` can never
disagree about this machine: your own choices go to
`~/.config/cc-smart-dev-kit/workflow.json`, and the switch the project owns
(`switches.sessionNames`) is written into the project's committed
`.claude/cc-smart-dev-kit.json` after a confirmation that says so. The heavy-job route
(`switches.jobRoute`) is your own default for every project, and a project that sets its own
wins. A row the project sets is
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
merge them). A project that is not set up has **Set up**: its page previews the two files
with `project init`'s own plan, asks first, and writes them, exactly as the Project card does.
**Add a folder** adds a repository no session has used yet: it must be a full path inside a
git checkout, and its main checkout is kept in `portal-projects.json` in cc-smart-dev-kit's
state folder. A set-up project's page shows its **Workflow** card: every setting its file can
hold, with the value its base commits and where it comes from; a change asks first, then opens
a pull request into the base (below), and the card shows its link or the refusal. Without a
`gh` that can open one, the values show and the controls are off. Every project's page has a
**Gateway** card: what its Claude sessions get (this machine's router, Anthropic's own
address, or what this machine's settings say) and which settings file decides it, and the
project's own state to change, as `gateway project on|off|default` changes it: on, off or
default, in your personal file or (off and default only) the team file, with a profile when
on. A choice the command would refuse is not offered, with its reason. When the project's
address names a profile, the card lists that profile's chains slot by slot over this
machine's and changes a slot or its fallback as `gateway profile` does; a profile is this
machine's, so every project that names it gets the change. A changed address reaches a
running session within about a second; default removes it, so a running session follows to
the next settings file that sets it within a few seconds, and keeps the old address until it
restarts only when none does. Every project's page has a **Tasks** card: one line of its
counts (open work, in progress, blocked; task files owed, and those that block a release) and
**Open in Tasks**, which opens the Tasks page on that project alone. A project's page also
shows its open pull requests in a **Merge check** card, each with the merge guard's own
verdict (`workflow merge-check`): `allowed`, the reason it would ask, "ran late" when the time
for the page ran out (about 8 seconds per page), or "not read" when a fact could not be read.
Without `gh` the card says the pull requests could not be read. The verdicts are kept for a
minute, and a read the time cut short is read again at the next look. The page names a
project by an id from this list, never by a path: a write reaches only a folder on the list,
and **Add a folder** is how any git checkout on this machine gets onto it.

**Without a gateway config** (never set up, or one that cannot be read): Overview, Slots and
Health show "The gateway is not set up", with the command that sets it up and a button to
Machine. **Machine, Settings, the Project card and the privacy page still work**, because
none of them needs the gateway: the updates, the heavy-job queue, the companions, `doctor`,
the workflow settings are all real there — `doctor` matters most on a
machine that has no gateway, and its gateway line is information (`·`), never a failure.
What does need the config says so in a short line instead of showing a made-up value: the
header pill reads "Gateway not set up", the OmniRoute card's Backend line says "the gateway
is not set up", a last card on Machine names the setup command, and the privacy page says
that no router answers here rather than naming a port. A config that is there but broken is
named as such, with its own error.

**Everything it does is real**, and every action runs the same function the command line
runs — the same checks, the same lock, the same words (`docs/design/portal.md` § The portal).
The portal does not install system apps or run the Herdr installer.
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
filter menus. The other answers carry what a page needs to explain itself: every open breaker
with how many requests wait right now; each failing `doctor` check with its fix and its
section; and each worktree's idle minutes and what the last background clean removed.

## Instructions, skills and agents

The plugin gives Claude general working instructions, skills and agents, written for any
project.

**The always-on instructions** (`plugin/instructions/core.md`): the main session plans,
splits the work into independent phases and orchestrates; every worker is a subagent — a
builder, a reviewer or a scout. An approved plan runs through `/cc-smart-dev-kit:build`, with
the kit's tasks as the ledger. Disjoint phases start at the same time in separate worktrees,
the session never waits on a result the next work does not need, and each hand-back is
reviewed and integrated before what it unblocked starts. Also: the role, each subagent's model
and effort, review, the core principles, how to end a turn, and keeping docs true.
`cc-smart-dev-kit setup` installs them for your user, **on by default**:

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

**Skills** (`/cc-smart-dev-kit:<name>`; each also loads on its own when its topic comes up):

| Skill | Use it for |
|---|---|
| `review` | Your own review before a commit, and the one second opinion per change set. |
| `build` | Build an approved plan with parallel worktree builders, phase reviews and the task ledger. |
| `plan-task` | Planning work whose design is open, in plan mode: research, questions, the plan file, approval, phases and owners. |
| `commit` | When to commit, push, open the pull request and ask for the merge. |
| `pull-request` | What every pull request body carries. |
| `verify-change` | The affordable loop after edits; the checks the push will run; testing with the person. |
| `research-first` | Research before you build; reuse before you write your own; choose a new app's stack and architecture from current sources. |
| `subagent-decision` | Which agent for which job, and how to brief it. |
| `herdr` | Separate linked or independent sessions, child reports, remote starts and relaying a question. |
| `impact-analysis` | Every consumer of a shared thing, before and after a change. |
| `code-structure` | Shape code, split responsibilities, name things, place files and decide when to extract. |
| `self-evolve` | Turning a correction into a rule, skill, hook, doc or memory; size budgets. |
| `memory-routing` | Where a fact, a preference or a to-do belongs. |
| `explain` | Teaching code or an idea in plain words. |
| `performance-budget` | Every React or Next.js web app change: the React playbook the code follows, React Compiler on, and the performance and UX budget. |
| `ui-verify` | A browser check of a UI change, and your design verdict. |
| `worktree` | The steps of one-worktree-per-session work (for projects that opt in). |
| `gateway` | The optional AI gateway. |
| `audit` | A sweep of an area for one class of defect, not a diff: scope, tracks and budget, the `audit-run` workflow, then every finding proved in the code. |
| `user-unavailable` | While you cannot answer (`user unavailable`): never stop to ask, take the easy-to-undo choices and park them as decisions, park your questions and the actions that need your yes, go on with the rest, and write the stretch's summary into the list. |
| `user-available` | When you are back: switches the state off, shows what was done while you were away, then goes through the list — decisions to keep or undo, questions in one call, each action run on your yes with its command shown. |

The plugin ships three workflows. The `audit` skill starts `audit-run`
(`plugin/workflows/audit-run.js`): one read-only `auditor` per track, a second one to refute each
finding, and a `builder` to write the report. For a big change set, the `review` skill takes its
second opinion from `review-split` (`plugin/workflows/review-split.js`) instead of one reviewer:
one `senior-engineer` per track, kept from editing, a second one to refute each finding, and the
verified findings merged and ranked; a finding nobody could prove or refute is listed under
Hunches, never dropped. The `research-first` skill starts `research-sweep`
(`plugin/workflows/research-sweep.js`) for a question with several sources: one `researcher`
per angle, then one refuter per claim that opens the cited source, and the verified
claims come back with their sources. Each script fixes its agents' models and efforts — `review-split`'s on `opus` at
`xhigh` for a risky change set and `sonnet` at `high` for any other — and `agent-guard` reads them
before the run starts.

**7 agents** (`cc-smart-dev-kit:<name>`; the caller passes the model and effort on each launch, so
none is pinned in their files). Each but `researcher` loads the `impact-analysis` skill at start,
through its `skills:` field. `rules-maintainer` also loads `self-evolve`; `builder` also loads
`verify-change` and `code-structure`. Each can use claude-mem's
`smart_outline`, `smart_search` and `smart_unfold`, and Claude Code's `LSP` tool where a
language server runs; without them, Grep and Read do the job (why each agent has the tools it
has: `docs/design/instructions.md` § Instructions, skills and agents):

| Agent | Job | Needs |
|---|---|---|
| `senior-engineer` | The second opinion on a change set (a brief with the line `Mode: review`, which the review record counts) or on a plan (`Mode: plan-review`, which it does not), and the consult when a session is stuck. All tools; it researches outside the repo with sources, and reports its findings before any fix. Only a consult may start research agents: a review starts none. | — |
| `edge-case-hunter` | Every scenario that can break a plan or a change: the trigger, what should happen, the gap, and the test that catches it. Read-only. | — |
| `researcher` | The R&D expert: one research question answered from current primary sources, each claim cited and marked confirmed or not. Read-only. | — |
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
| `claude-mem@thedotmack` (memory across sessions) | `thedotmack/claude-mem` | 15.0.0 or newer |
| `frontend-design@claude-plugins-official` | `anthropics/claude-plugins-official` | any |

- **Claude Code installs a dependency only from a marketplace you added.** Without it,
  `claude plugin install cc-smart-dev-kit@cc-smart-dev-kit` succeeds with a warning, and cc-smart-dev-kit does not
  load. `cc-smart-dev-kit setup` adds each missing marketplace, and that installs the companion.
- **A companion you have already stays as it is.** A claude-mem in the range is not
  updated or reinstalled. One older than 15.0.0 stops the install: run
  `claude plugin update claude-mem@thedotmack` first. (Setup still turns the
  memory-use block off for an older one: see [claude-mem's start blocks](#claude-mems-start-blocks).)
- **You turned one off?** Setup leaves it off and says how to turn it on; cc-smart-dev-kit does
  not load while it is off.
- `restore` does not uninstall them.

## claude-mem

claude-mem (a [companion plugin](#companion-plugins)) writes a summary of every session,
keeps a memory across sessions, and puts two blocks at the start of every session. `setup`
changes its settings in `~/.claude-mem/settings.json` (`$CLAUDE_MEM_DATA_DIR/settings.json`
when you set that variable), and only there; everything else in that file stays as it is.

### claude-mem's start blocks

claude-mem's **work state** is its to-do list, kept across sessions. Its **memory-use block**
explains how to use the memories it loaded. `setup` keeps the memory-use block off with
`CLAUDE_MEM_MEMORY_INSTRUCTIONS_ENABLED: "false"` because the kit owns instruction routing;
the block still points at `work_state_write`, replaced by the kit's task list in 1.10.0
(D75, replacing D68). The earlier context overflow (#5180) was fixed in claude-mem 15.7.0.
Doctor also reports My Work auto-refresh: it defaults on and can run logged-in agents outside
the note-taker route shown by the kit. To turn it off, set
`CLAUDE_MEM_WORK_VIEW_AUTO_REFRESH: "false"` in claude-mem's settings file.

- **Memory only.** Setup sets `CLAUDE_MEM_WORK_STATE_ENABLED: "false"`; a `"true"` you set after that
  stays. Stored lists remain available for the one-time `task import claude-mem`.
- **One task system.** The kit's task list replaces Claude Code's own list tools, for every
  session and its subagents; what setup changes for that: [`cc-smart-dev-kit setup`](#cc-smart-dev-kit-setup).
- **Restart and restore.** Restart after setup. Restore undoes only the settings and
  permission entries setup still owns, not your choices or task data. D68's earlier split
  and its context-budget measurements remain in [the design](docs/design/claude-mem.md).

### claude-mem on the gateway

claude-mem's summaries run, by default, with Claude Haiku on your own Claude
login. Its work is Haiku's, so it follows the gateway's scout slot: when the
[gateway](#the-ai-gateway-optional) is set up, claude-mem is installed (15.0.0 or newer), and
you gave the scout a chain whose first target is a `<backend>:<model>`, `setup`
points claude-mem at that model, straight at its backend. A scout with no chain (the default,
D66), or one that starts with a Claude model, puts claude-mem on Claude, on your own login, with
claude-mem's own Haiku: setup takes out the five provider keys below while they hold
cc-smart-dev-kit's values, all five or none (one that is yours keeps them all, and setup names
it), and writes no model id. A route you chose with `claude-mem route` or in the portal stays.
Setup writes no fallback model:
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
  Claude model, or one from the list), or a backend model — on any route. claude-mem ignores a
  fallback whose provider is the route's own, so where the route is already a backend model the
  fallback uses claude-mem's other OpenAI-shaped provider, **OpenRouter**, pointed at the backend
  and model you pick (`CLAUDE_MEM_OPENROUTER_BASE_URL`, `…_MODEL`, `…_API_KEY`, which that choice
  replaces): your summaries reach that backend either way. A Claude fallback needs a route that
  is not Claude, for the same reason, and the card says so. Since claude-mem 13.37.0 an empty fallback means Claude,
  with claude-mem's own model (`CLAUDE_MEM_QUOTA_FALLBACK_MODEL`, else `CLAUDE_MEM_MODEL`:
  Haiku, unless you changed it), and the card shows it so, naming that model; `off` means none.
  Before 13.37.0, an empty one means none (and "off" writes that).
- **Let setup decide again** forgets your choices and runs setup's own claude-mem step: the
  route follows the scout slot again, and the fallback goes back to claude-mem's default. A value
  you set by hand and did not let the kit manage stays yours; one you took over is setup's again.

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
- **A value you set by hand stays yours — until you take it over.** The card names each such
  value at its top and marks each part a change to which it may refuse; a change it does refuse
  says which value stops it: change that value in the file, or take it over. The **take-over**
  is the card's **Let the kit manage these**: it records those values as cc-smart-dev-kit's own, so the route, the key and
  the fallback can change, in place, with no page reload. `cc-smart-dev-kit claude-mem
  take-over` (below) does it from your own terminal. Both name the values they would take and
  ask first. **Nothing in claude-mem's settings file changes**:
  each value stays exactly as it is until you pick another. `restore` puts a taken-over value
  back as it was (one you changed in the file since stays yours). A key's value is never written
  down: `restore` leaves a taken-over key exactly as you set it while it is still yours. Once
  cc-smart-dev-kit replaced it, the key it wrote stays only next to the address it was written
  for. Where `restore` puts your address back (a route that moved to a gateway backend, say),
  your own key comes back with it, read from the kit's backup of your file — the path is named,
  never the key. When no backup holds your key, the kit's key is removed and your address is left
  with none: a key is never left next to an address it was not made for, a gateway backend's
  or one you typed in the portal for another address.
- claude-mem not installed, older than 13.29.0, or with a file it cannot read: the card says
  why, with the command that fixes it.

### `cc-smart-dev-kit claude-mem`

The card's choices, from your own terminal. The command runs the same functions the Machine
page's card does, with the same checks and the same lock, so a machine set here and one set from
the page agree. It needs no Claude Code session and no portal.

- `cc-smart-dev-kit claude-mem` (or `status`): where claude-mem's summaries go and the model
  they run on, the key (never the key itself: none, the gateway's own key for that backend, or
  your own), and the quota fallback with the model that fallback really runs on, each with who
  set it: claude-mem's own default, setup from the scout slot, your choice (from the card or
  from this command), or you by hand in claude-mem's file. It also names the choices a hand-set
  value refuses, and points at the take-over.
- `cc-smart-dev-kit claude-mem route claude|<backend>:<model>`: sends the summaries to Claude on
  your own login, or to a backend model. The model is checked first, the way the card's list is:
  the backend has to list it (`/v1/models`), and then one tiny chat goes to it with the key the
  choice would use. Nothing is written when either check fails.
- `cc-smart-dev-kit claude-mem key [--gateway]`: takes the key on **stdin**, never as an
  argument, checks it with the tiny chat first, and never prints it. On a terminal it is read
  with **no echo**; from a pipe or a file it is read as it is. `--gateway` puts the gateway's own
  key for that backend back, as setup does.
- `cc-smart-dev-kit claude-mem fallback off|claude [<claude model id>]|<backend>:<model>`: what
  takes over while the route's provider is limited, under the rules above.
- `cc-smart-dev-kit claude-mem take-over [--yes]`: records the values you set by hand in
  claude-mem's file as cc-smart-dev-kit's own, so the route, the key and the fallback can change.
  It names them and asks first; `--yes` skips the question, and with no terminal it is the only
  way to take them over. A key's value is never written down, so `restore` leaves a taken-over
  key as you set it. Once cc-smart-dev-kit replaced it, `restore` keeps the kit's key only with
  the address it was written for; where your address comes back, your key comes back with it,
  from the kit's backup of your file (with no backup that holds it, the kit's key is removed).

Every write says what changed, and none needs a restart: claude-mem reads its settings file each
time it uses it. Exit codes: 0 done, 1 a refusal or a failed check, 2 a wrong word or option.

## Herdr GUI

Manual `cc-smart-dev-kit setup` offers the latest **Herdr GUI** (`herdr-app`) by default,
not the TUI. `setup --no-herdr` skips this run only; it stores no opt-out. An existing GUI
on PATH or in its upstream install location is left alone, without updates or configuration.
Warp support is removed: the old `--warp` and `--remove-warp` flags are rejected. Setup does
not uninstall Warp, its package source, keys, shortcuts, old tabs or plugin registrations.
Remove old registrations yourself only after checking what you still use.

Before any setup changes, the offer shows the official app installer
(`https://releases.herdr.dev/app/install.sh`, or `install.ps1` on Windows), its normal
missing-core bootstrap from the same host's `/core/` installer, and upstream-managed paths.
Answer on a terminal, or give `--yes`; without either it skips the install. A decline,
`--no-herdr`, or `--dry-run` downloads and runs nothing. Unrelated setup still proceeds.
Unsupported hosts, Linux without a desktop display, root, or a missing interpreter get
skip guidance and [the manual download page](https://herdr.dev/download/), never a TUI or
package-manager fallback.

The official script is downloaded as data, staged under the setup lock, run with explicit
`sh` or PowerShell arguments, and removed afterwards. Its subprocess clears inherited
`HERDR_` and `HC_` installer controls while keeping normal user-directory/platform variables.
Upstream checks artifact hashes against release manifests; this is **not installer-script
hash verification**. The app's normal core bootstrap is allowed; no custom core installer runs.
A GUI installed without an available core is reported as incomplete, not a successful install.

Upstream owns the app, core, launcher/shortcuts and Windows user PATH changes. Kit restore
does not uninstall them. Herdr's self-update and telemetry defaults remain upstream's;
setup changes no preferences, themes or agents and never launches the app. No background
hook or kit self-update installs Herdr. Real native-platform installer behaviour has not
been proved by the kit's fake-machine tests.

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

When many Claude sessions and subagents run on one machine, type checks, typed lints, test
runs and builds start together and fight for the same memory and cores.
`cc-smart-dev-kit job run` takes one machine slot: **one full heavy run at a time by default**.
Choose 1–8 with `cc-smart-dev-kit job set max <n>`. The default stays 1 because competing full
suites starve each other, time out, and then "pass alone", causing false failures.
It waits while the slots are taken (oldest first, saying who holds them), runs the job, and gives the slot back however the job ends. A run on named files only (at
most 10, for a kind that allows it) and a run that only prints (`tsc --version`) skip the queue,
so a targeted check never waits behind a full build. The project's `jobs.kinds` says which
commands are heavy. How it works, the kinds and the limits: [docs/jobs.md](docs/jobs.md).

| Command | What it does |
|---|---|
| `cc-smart-dev-kit job run [--kind <kind>] [--exclusive <name>] -- <command…>` | Waits until the heavy slot is free, then runs the command. Its stdin, stdout, stderr and exit code pass through; SIGINT, SIGTERM and SIGHUP are sent on to the whole job. `--exclusive <name>`: at most one job with that name at a time, in order (with a kind, or alone, when it takes no slot). A job inside a job that already holds the slot does not wait again. |
| `cc-smart-dev-kit job set max <n>` | Sets your machine limit (1–8, default 1) in the new `~/.config/cc-smart-dev-kit/heavy-jobs.json` as `maxConcurrent`. Backed up and written atomically under setup's lock; `restore` takes back the kit's value. Lowering it never stops running jobs; waiting jobs see changes without a restart. |
| `cc-smart-dev-kit job status` | The limit and its source (default or new file), slots in use, who holds them and who waits, and whether the job route is on for the folder it runs in, and who decided (the project, your own `switches.jobRoute`, or the default). |
| `cc-smart-dev-kit job kinds` | The kinds, the defaults and the project's own, each with its one-line description. |

The queue's state is per user, in `~/.local/share/cc-smart-dev-kit/jobs/`. There are no
memory gates, CPU or I/O weights, systemd slices, shared folders or light lane: the slot does
not cap the memory or the cores one run uses. A machine's old `jobs.json` and its `job set`
values are ignored since 2.0. The new file never reads legacy `maxJobs`; `doctor` names that
leftover with its removal step. `/api/jobs` and the portal's Machine page show the same limit
and source as `job status`.

Whether a project's heavy commands are sent through the queue is the `switches.jobRoute`
setting ([The workflow](#the-workflow)): the project's `jobs.route` when it has one, else your
own default (`cc-smart-dev-kit workflow set switches.jobRoute true`), else off.

## The hooks

The plugin's hooks run in every project. Most stay silent in a **project without
`.claude/cc-smart-dev-kit.json`**; the ones that are about your machine, not a project —
`agent-guard`, `job-route`, `session-escape-guard`, `fable-session`, `tier-view`, `task-start`,
`keep-going`, `builder-finish`, `agent-usage`, `user-away` and `playwright-output` —
run there too. The plugin ships no worktree hook: every project uses
Claude Code's own worktrees (§ Worktrees); the retired engine's three hook names only print the
fix where a project still wires them. Each hook runs through `bin/cc-smart-dev-kit-bun.sh`,
which finds bun even when your PATH has none: the bun `cc-smart-dev-kit setup` saved in the
launcher first, then `$BUN_INSTALL/bin/bun`, `~/.bun/bin/bun`, and bun on PATH. It starts bun
with `--no-env-file` and the plugin's own empty `bunfig.toml`, so a hook never reads the
working folder's `.env` files or its `bunfig.toml` (a project's `preload`). With no bun at all,
or one older than 1.4.3, a PreToolUse guard asks you before every call it covers
(`--missing=ask`: a guard fails closed), and every other hook writes one line on stderr and the
session goes on (`--missing=quiet`).

| Hook | When | What it does |
|---|---|---|
| `git-guard` | before a Bash or PowerShell command | Asks you before any `git push` while `autoPush` is off (the default: a push leaves the machine). `autoPush` is read as the merge guard reads its gate: the default, your own `workflow.json`, and the project's file as committed on `origin/<worktrees.base>` — never a checkout's own copy, so a session cannot switch the question off in its worktree; a policy it cannot read asks. A `git push --dry-run` sends nothing and asks nothing. It also asks you before a force-push, a push to a protected branch (`protectedBranches`: named, matched by a wildcard refspec, or sent by a bare `git push` the way your `push.default` and `remote.<name>.push` say), `push --all` / `--mirror`, a branch deleted on the remote (`git push origin :x`, `--delete`), `reset --hard`, `reset --merge`, `clean -f`, `worktree remove -f`, a checkout or restore that throws changes away, `branch -D`, `stash clear` and an unnamed `stash drop` (they throw work away), and (with `worktrees`, or in any linked worktree, such as a builder's) a bare `git stash` or `stash pop`: every worktree shares one stash. It only ever asks, never refuses: you may mean it. A line is read with its tool's quoting, Bash or PowerShell. Text in quotes, quoted here-docs and comments is not a command; a substitution (`$( … )`, a backtick, an unquoted here-doc body), a shell keyword, a wrapper and its options (`timeout 60 git push -f`, `env -S '…'`, `sudo -u me …`, `doas …`), git's own options (`--config-env x=y`), a here-doc fed to `sh`, the text piped into `sh`, and `job run`'s queued command are read through. Git's own abbreviations count (`--forc` is `--force`), `git send-pack` and an alias set on the line (`git -c alias.x=push x`) are pushes, and a program named at run time (`$(which git) push`, `$GIT push`) asks when its words name a push. Not read: a git alias of your own config, `branch -f`, `checkout -B`, `switch -C`, brace expansion (`{git,push}`), `-EncodedCommand`, `ssh`, a script file, a `cd` it cannot follow (`cd -`, `cd ~/x`, `cd $DIR`), and a branch it cannot name; `git checkout <name>` cannot tell a file from a branch, so it stays silent. **It stops mistakes, not a process that sets out to get past it**: a session with a shell can always run what it means some other way. |
| `main-folder-guard` | before Edit, Write, NotebookEdit | With `worktrees.guardMainFolder`: refuses an edit of a file in the main checkout itself, and says how to get into a worktree. |
| `playwright-output` | before every `mcp__playwright__*` call | Puts a screenshot or snapshot the caller names by a relative `filename` into the browser's output folder instead of the folder the session runs in (`@playwright/mcp` resolves a caller-named file against the process's own folder). |
| `merge-guard` | before a Bash or PowerShell command | Asks you before a command that merges a pull request, and before one that opens or readies one (`openPr`). The forms it reads: `gh pr merge` (`gh pr -R owner/repo merge 5` included), `--auto` (an armed merge lands once the checks pass, with nobody watching), a `gh alias` that expands to one (read from `gh alias list`), and — asking whatever the policy says — a `gh api` call to the pull-request merge endpoint (`repos/o/r/pulls/5/merge`, any method spelling) or a GraphQL query that names `mergePullRequest` / `enablePullRequestAutoMerge`. **Every merge in the command is judged**: `gh pr merge 5 && gh pr merge 6` checks both, and the first it does not allow asks, naming that pull request. It reads three facts, read-only: the pull request (`gh pr view`), the repository's default branch (`gh repo view`), and its required checks (`gh pr checks --required`; a skipped one counts as passing, GitHub's own rule). It lets a merge through only when `autoMerge` is on, the pull request's base is the project's integration base, every required check passed, and — with `reviewBeforePush` on — a [recorded review](#the-workflow) covers the head: a review of the head itself, or of an earlier commit of its branch whose change since stays within `fixesAfterReview`. **For an exact `gh pr merge <n>` with flags gh has, that passing merge is answered `allow`**: it runs with no question, and no auto-mode "Merge Without Review" block either — the guard's own checks are what protect it — with a short reason. Any other passing form (a wrapper, a second command, an alias, a branch or URL instead of a number, a flag this guard does not know, an armed `--auto` merge) stays silent as before, so auto mode's own rule still applies; an unknown flag asks. **It reads that policy as committed on the pull request's base** (`origin/<base>`, as last fetched), never from a checkout's own copy of `.claude/cc-smart-dev-kit.json`: a session cannot switch the gate off by editing its worktree's file. No such ref, no file there, or a file it cannot use asks you. For a pull request opened (`gh pr create`, `gh pr new`) or made ready (`gh pr ready`), `openPr` decides: `off` asks before any of them, `draft` lets one that opens as a draft through and asks for one that does not (`--draft`) and for every `gh pr ready`, `ready` asks about neither. **A pull request that would open outside the base its head branch belongs to also asks, naming both branches**: its `--base` (`-B`) is compared with `worktrees.base`, or with the `worktrees.bases` base for that branch (the longest prefix that matches); with no `--base` the pull request opens into the repository's default branch (read with `gh repo view`, then git's `origin/HEAD`), and asks when that is not the base. It asks, never refuses: you may mean it. It reads the same forms (a `gh alias`, a `gh api` POST to the repository's pulls endpoint, the GraphQL `createPullRequest` / `markPullRequestReadyForReview`) and the same policy, committed on `origin/<worktrees.base>`. Every other case asks you, with the reason it asks; so does a merge that names a repository other than this project's own (`--repo`/`-R`: the policy covers this repository only), one whose earlier steps change the folder, branch or repository it acts on (`cd`, `git switch`, `GH_REPO=…`, `env`), and a `gh` that is missing, fails, or answers something it cannot read. A merge with `--admin` (any value) always asks, whatever the policy says, naming the pull request: `--admin` merges past the repository's branch protection — its required reviews (a code-owner approval among them), its required checks and its merge queue — so you decide each one. It asks rather than refuses, because a release may use `--admin` on purpose. **A raw write to GitHub's issues asks too** (decision D67): `gh issue create`, `edit`, `comment`, `close`, `reopen`, `delete` and the other `gh issue` commands that do not only read, `gh label create`, `edit`, `delete` and `clone`, a `gh api` POST, PATCH, PUT or DELETE to a repository's `issues` or `labels` endpoints, and any GraphQL mutation that is not a pull request one this guard judges — an issue is text that leaves the machine, and a renamed label could change what the kit's labels mean, so a session's own write is your yes. What the guard cannot read whole counts as a write: an endpoint or a query the shell fills in (a `$` expansion or a backtick outside single quotes; GraphQL's own `$n` in single quotes is text), a request from `--input` or `query=@file`, and a `gh` alias that runs a shell command (a `gh` alias is otherwise read for what it expands to). Reads (`gh issue list`, `view`, `status`, a GET) and the kit's own `cc-smart-dev-kit issue file` and `issue mark-fixed` are not asked about. In a project without `.claude/cc-smart-dev-kit.json` it stays silent, like every project hook. |
| `agent-guard` | before an Agent launch, and after it for the record | **Machine-wide** (it runs with or without `.claude/cc-smart-dev-kit.json`): it resolves the model the launch really runs on and holds the model rules. **It judges the model and effort Claude Code really gives the launch, after Claude Code's own overrides**, read from the hook's environment (a settings file's `env` reaches it there too): `CLAUDE_CODE_SUBAGENT_MODEL_FORCE` (on as `1`, `true`, `yes` or `on`) puts every launch on `CLAUDE_CODE_SUBAGENT_MODEL`, or on the session's own model when that is unset or `inherit` (one the guard cannot read counts as the `opus` tier); next, `CLAUDE_CODE_WORKFLOW_SUBAGENT_MODEL` puts every Workflow `agent()` on its model (never an Agent call); next, the call's own `model` — a plain `CLAUDE_CODE_SUBAGENT_MODEL` never beats it. `CLAUDE_CODE_EFFORT_LEVEL` sets the effort of every launch, whatever the call names. Under FORCE or `CLAUDE_CODE_EFFORT_LEVEL`, Claude Code takes `model` or `effort` off the Agent tool, so such a call names neither and is judged on what the variable sets, never refused for it; an ask or a refusal names the variable ("This launch runs on `haiku` because `CLAUDE_CODE_SUBAGENT_MODEL_FORCE` is set …"). `CLAUDE_CODE_EFFORT_LEVEL=auto` (the model picks its own default, never `max`) is your own choice, like a fork's effort: allowed on Sonnet and Haiku (Claude or a backend), allowed with no question on the `opus` tier, and the `fable` tier's reason-line rules as always. A `CLAUDE_CODE_EFFORT_LEVEL` no subagent may run at (`low`) refuses every launch until you change or remove the variable, and the message says so. A fork keeps its own rule (below), and the record names the model the launch really ran on. Without an override, a launch takes its `model` and `effort` from the call, else from the agent's own definition (its frontmatter, found the way Claude Code finds it: the managed agents folder, then the project's `.claude/agents` from the session's folder up to the checkout's root, then your user folder, then a plugin's); a launch with neither, or whose agent the guard cannot see (`--agents`, the SDK), is refused (it would inherit the session's, which nobody chose); `effort` `low` is refused on every model, a Claude model and an affordable slot alike (a subagent runs at `medium`, `high`, `xhigh` or `max` only), and nothing else is required of an affordable gateway slot (a slot key, a `<backend>:<model>` target, or `haiku` / `sonnet` or their ids while the gateway is on and that family's slot (scout, worker) has a chain whose first target is a backend, read from `gateway.json`): Claude picks the effort by the task on every tier, whatever model answers it (the owner's decision, 2026-10-26; a backend at a fixed effort is the router's pin, `gateway effort`); with no chain, or one that starts with a `claude-…` model, the launch is Claude — a name no rule knows (`best`, `opusplan`, `default`, …) is the `opus` tier without a proved family, so it asks you at every effort (refused in `claude -p`): it may stand for a higher tier; **`opus` and `fable` mean the TIER, whatever model answers behind them** — an override, or the opus or fable slot's chain, that points one at another vendor keeps the tier's rules, and the question names both (`` `opus` (answered by openai:gpt-5.5) ``); a premium name keeps its own tier — `opus` whose override or opus slot answers with Claude Fable is the `opus` tier, with no `Fable reason:` line — and a name with no premium tier takes the tier of a premium Claude model that answers it — `sonnet` whose override or worker chain is a Claude Opus id is the `opus` tier; **a launch read as Opus (the `opus` name, a Claude Opus id, the opus slot) runs with no question at `medium`, `high` or `xhigh`** — any agent, any purpose, review or not, no reason line needed — and **asks you at `max`**, naming the model and the effort (in `claude -p`, with nobody to answer, a `max` launch is refused and the message says to run it at `medium`, `high` or `xhigh`, or in an interactive session); an `Opus reason: <word>` line is optional, and only names the purpose in the record — but `Opus reason: ui`, and `Fable reason: ui-design`, declare UI/UX work: **such a launch runs only on `opus` or `fable`, at `high`, `xhigh` or `max` (`UI_POLICY`), and is refused on Sonnet, Haiku or an affordable slot, or below `high`**; a fork runs at the session's own effort, which you chose, so an `opus`-tier fork is allowed; on the `fable` tier a read-only agent (the built-in Plan and Explore, and the kit's auditor, edge-case-hunter and researcher) with a `Fable reason: <word> - <why>` line (punctuation after the word is fine) asks you — `build` is the builder's own word, refused there — and an agent that can change files — a builder, or a fork — asks with `Fable reason: build - <what you asked for>`. A fork always runs on the session's model and effort (Claude Code ignores a `model` a fork is given) and needs no `model`; an unknown session model counts as the `opus` tier. A **Workflow** call is judged the same way, from the `agent(...)` options in its script — a launch whose `model` is built at run time, or whose `model` or `effort` an operator changes (`"high" && "max"`), is refused, never guessed, and a script that hands `agent` or `workflow` around (`const run = agent; run(…)`, `agent?.(…)`) or builds a call's options at run time (a `...spread`, a computed key, options that are not one plain object) is refused whole, and so is a script that does not parse (the guard parses it the way Claude Code runs it, as the body of an async function, and names the parser's message and line) or that could reach `agent` another way (`eval`, `Function`, `arguments`, `globalThis`, `global`, `self`, a `this` outside a non-arrow function, `import()`, `.constructor`); a key built at run time or a string key (`x[k]`, `Reflect.get(o, "constructor")`) is not refused: Claude Code's own vm setting stops that code from running a string as code — because (proved live) a workflow's agents run inside the tool and pass no hook of their own. **Every run is judged, however it names its script**: an inline `script`; a `scriptPath` (relative to the session's folder); a saved workflow's `name` — the `.js` file whose `meta.name` is that name, in `.claude/workflows/` from the session's folder up to the repo root, then in `~/.claude/workflows/`, the nearest first; a plugin's `<plugin>:<name>`, from that plugin's installed `workflows/` folder; and each workflow its script nests with a literal `workflow("<name>")` or `workflow({ scriptPath: "…" })`, one level deep. A nested workflow named at run time, or one that nests again, refuses the whole call. A run whose script the guard cannot read — a built-in workflow such as `deep-research`, a missing file, two files in one folder that claim the same `meta.name`, a `resumeFromRunId` — asks you, saying why, and is refused in `claude -p`. A deny refuses the whole call, so none of its launches is recorded, and an ask names every launch that asks. Every premium-tier launch is recorded once it is known to run — an allowed one before the call, an asked one after it ran (you said yes); one you refuse never; each launch of a workflow on its own line — and `cc-smart-dev-kit usage` counts them by the effort they ran at and by why: for the `opus` tier its `Opus reason:` word when the prompt has one; for the `fable` tier its `Fable reason:` word. How many subagents run at once is Claude Code's own cap ([Subagent concurrency](#subagent-concurrency)), not this guard's. |
| `session-escape-guard` | before a Bash, PowerShell, Edit, Write or NotebookEdit call | **Machine-wide**, and `ownHooks` cannot switch it off. Stops a session from loosening its own limits. It **refuses** `cc-smart-dev-kit workflow review-done` (a review is recorded by the review-record hook when a review agent returns, never by the session) and any `cc-smart-dev-kit` command run with `CLAUDECODE` removed (`env -u CLAUDECODE …`, `CLAUDECODE= …`, `unset CLAUDECODE; …`, `env -i`, `sudo`): the commands that change your settings refuse to run inside Claude Code, and this keeps a session from dropping the marker. It **asks you** before a command that reaches the portal's port (20150) on this machine — the portal has no sign-in — and before an Edit or Write of a `.claude/cc-smart-dev-kit.json`, of `~/.config/cc-smart-dev-kit/` (your workflow and gateway settings), or of the kit's state folder (the review record) — a shell line that writes them asks the same way: `>`, `>>`, `tee`, `sed -i`, `cp`/`mv` onto the path, `dd of=`, and PowerShell's `Set-Content`, `Add-Content`, `Out-File`, `Copy-Item` and `Move-Item`. Reading one (`cat`, `grep`) asks nothing. It does not read a script file, a port held in a variable, a target it works out when it runs (unless the line also names one of those files), or a write by a program it does not know. |
| `fable-session` | a session starts; a model switch; each answer ends | **Machine-wide**: when the session's own model is the `fable` tier — Claude Fable, or a model an override points that tier at, but not Claude Fable that you put first in the `opus` slot or `ANTHROPIC_DEFAULT_OPUS_MODEL` (that is the `opus` tier; a switch to Fable outright still counts) — it shows *you* one line, once a session: the premium tier uses your plan's limits faster than Opus, so switch with `/model` if you did not mean to. **The lead hint** (2.2.0): when the session's own model is neither Claude Opus nor Claude Fable that you put first in the `opus` slot — another Claude model, a backend, or the `opus` tier answered by a backend — it shows you one other line, once a session: the kit works best with the lead on Claude Opus at high effort; switch with `/model` — or, when the `opus` tier itself is answered by a backend, put Claude Opus first in the gateway's `opus` slot (`/cc-smart-dev-kit:gateway`) or start with `launch --no-gateway`. It recommends and never switches; `switches.leadHint` false (your own `workflow.json`) turns it off. A Fable session gets the Fable line only, and a session told the hint that later moves to Fable gets the Fable line too. Each model is judged once a session. Nothing goes to Claude, never an error and never a block. A session start judges only the `model` the start names; a switch judges `to_model` — the model the session moved TO — so the line appears AT the switch; a finished answer is judged by the model that answered it, which is the catch-all for a Claude Code that fires no `PostModelSwitch`, and can never fire for a model the session has already left (the old `UserPromptSubmit` read was one turn behind: it missed the switch to Fable and warned after the switch back). The line was seen live on a real session (2026-10-17); that `systemMessage` shows on `PostModelSwitch` and `Stop` is not proved yet (the contract's § Relied on, not proved yet). |
| `tier-view` | a session starts (any source); each prompt, only when it changed | **Machine-wide**: tells *Claude* what each subagent tier (`haiku`, `sonnet`, `opus`, `fable`) runs now — Claude or a gateway backend — and how to choose: the tier and the effort by the job (`/cc-smart-dev-kit:subagent-decision`), never by the model behind a tier. `opus` at `max` and any `fable` launch ask you. No effort is forced on a backend (pin one with `gateway effort`). While [auto mode's safety checks are failing](#first-setup) because Claude is limited or down and nothing stood in, one more line says so, with the reason and the fix: the model cannot fix it, so it tells you once and waits instead of retrying. Said again at a later prompt only when a slot changed or that line came or went; never a question or a block. Claude is never told your plan's usage. |
| `job-route` | before a Bash or PowerShell command | **Machine-wide**, and `ownHooks` cannot switch it off: it judges what a line does, whatever the project's file says. **Both shells**: it reads a Bash line and a PowerShell line in that tool's own dialect, so the judge is not stepped around by changing tools on Windows; the queue rewrite below stays Bash-only, because its rewritten line is a `sh` line the PowerShell tool cannot run — so while the route is on, a heavy PowerShell line is **refused**, and the reason names the Bash tool and the exact line to run there, where it waits for the slot (only where the Bash tool can exist: on Windows, where Git Bash is found; a light or print-only line runs as written). **Launches**: a raw `claude --bg` **asks you** in an attended session — and is refused in `claude -p`, where nobody answers — because such a session runs beside this one, nobody watches it and it reports to nobody: the reason says to build the work with subagents, which report back to the session that started them. `claude -p` is judged by the same launch policy as every Agent launch (its `--model` and `--effort`: no model refuses, the `fable` tier asks, the `opus` tier at `max` asks), and a `Fable reason:` line in its prompt counts as it does for an agent. `workflow propose` **asks you** first while `autoPush` is off or `openPr` is short of `ready` — it pushes a branch and opens a pull request in children no hook sees — and is refused in `claude -p`. **The route**, with `"jobs": { "route": true }` in the project or `switches.jobRoute` in your own `workflow.json` (the project's value wins; off until one says on; not outside git): a heavy command (the project's own [kinds](docs/jobs.md)) is sent through the machine's queue — rewritten to `cc-smart-dev-kit job run --kind <kind> -- <command>`, byte for byte the same command. Only a line whose every command is heavy, a `cd` or an assignment is queued, and one heavy command piped into read-only filters (`bunx tsc --noEmit 2>&1 \| tail -20`: `tail`, `head`, `grep`, `wc`, `sort` and the like, kept outside the queued command so your rules still see them): anything else runs raw. Claude Code matches your own Bash rules (`deny`, `ask`) against the command it runs, and a rewritten line holds your command as one quoted word, so a queued `bunx tsc && rm -f x` would hide the `rm` from a `Bash(rm:*)` rule (proved on 2.1.308). A command already inside `cc-smart-dev-kit job run` is left as it is. A name the project's `package.json` defines as a script is matched only by a `script` kind, never by a tool of the same name, so a `tsc` script that already wraps the job is not wrapped again. |
| `after-merge` | after a pull-request merge | With `worktrees`: the steps to clear the worktree that was merged (with `clearWorktreeAfterMerge` off: one line that it looks finished, the same steps, and the decision left to you). For a merge into `worktrees.base` it also starts the background clean of finished worktrees (once per merge, `worktrees.autoClean`). It never tells your other sessions about a merge. Noted forms: `gh pr merge`, `gh pr -R owner/repo merge 5`, a `gh api` merge whose path names the pull request, and a `gh` alias that expands to one (`merge-guard` above has the guard's row). A form that names no pull request — a shell alias, a GraphQL merge, a runner such as `xargs` — gets no note. Its own calls (the alias list, the worktree list, `gh pr view`, the origin) share one 25 s budget inside the hook's 30 s, so they cannot add up past it: a note that would not fit is skipped. |
| `review-record` | when a subagent starts, and when it finishes | When the agent is one `reviewAgents` lists (the plugin's reviewer by default): notes the commit the session's working folder is on at its start, and its branch, and records that start commit on that branch at its end: commits made while it read count as change after the review. It is the record the merge guard reads for a merge it would make with no person watching ([The review record](#the-workflow)). It records only when the agent's brief and every prompt it was given after the brief each hold `Mode: review` alone on a line (trailing spaces and tabs allowed). A consult, a review agent resumed for a question (a message it is sent counts, in any form), a review that compacted, a missing or unreadable transcript, or an agent stopped inside its own worktree records nothing. |
| `subagent-background` | when a subagent finishes | A subagent never hands back while background work it started still runs — a Bash command or a subagent it launched. It blocks the stop **once**, with one plain reason ("Your background work is still running: wait for it or stop it, then report."), and the subagent goes on with that reason; the stop the block itself caused is never blocked again, and it gives Claude no context. Only the agent's **own** work counts: the input's list is the session's (a background subagent appears in its own list, and a foreground subagent sees the main session's background commands), so the hook keeps a task whose id appears in a tool result of the subagent's own Bash call (`Command running in background with ID: …`) or Agent call (`agentId: …`) — never an id in its brief or in a file it read, which is not work it started. Nothing is blocked when it cannot read that transcript, and a project without `.claude/cc-smart-dev-kit.json` sees nothing. |
| `builder-finish` | when a subagent finishes | **Machine-wide**: a builder never hands back while its phase still has open steps. It judges only an agent whose type ends in `builder` or `rules-maintainer` (the plugin's `cc-smart-dev-kit:builder` and `cc-smart-dev-kit:rules-maintainer`, the two the build skill gives a phase) and whose brief holds the exact line `Your task: #<n>` — the line the `build` skill writes, read from the first message of the agent's own transcript, never from a later line. While task #n still has open blocking steps (open blocking tasks at any depth under it, the same set `task_done` refuses on; a non-blocking step holds nothing), it blocks the stop **once**, naming each step and how to close it: finish it and close it with `task_done`, or drop it with a note that says why. It gives Claude no context, and the stop its own block caused is never blocked again, so a step that truly cannot close never traps the builder: its caller sees it open in the task list. It reads the tasks under the main checkout's key, so a builder in its own worktree finds what its caller made. Silent for any other agent, without the line, with no task list or no such task, and outside git; a task list it cannot read is one line on stderr. Design: [docs/design/hooks.md](docs/design/hooks.md) § A builder's hand-back. |
| `agent-usage` | when a subagent finishes | **Machine-wide**: writes one line per subagent to `agent-usage.jsonl` in the kit's state folder — the session, the agent's id and type, and per model its replies, its four token counts and an estimated cost — never any content. `cc-smart-dev-kit usage` reads it (§ Commands). A transcript it cannot read, or a line it cannot write, is one line on stderr: a subagent always finishes. |
| `verify-gate` | each answer ends | With `checks.fast`: one **block** when this session changed files after the last Bash or PowerShell call that ran the check, naming the command. Silent on the stop its own block caused (`stop_hook_active`), on a turn that still waits on background work, with no `checks.fast`, and when the transcript cannot be read. The reminder is given once per change — a change after it earns the next one — so a check that fails gets one reminder and never traps the turn. |
| `keep-going` | each answer ends | **Machine-wide**: the main session does not end a turn with a phase of its plan still in progress and nothing that will wake it. It blocks the stop **once per stalled state** when all of these hold: it has not already given the same reminder with no subagent started or resumed since (it reads its own earlier block from the session's transcript); the stop is not the one its own block caused; no background work runs (a builder or a background command wakes the session when it lands); no line of the turn's last answer starts with `Waiting for:`; and a phase of a plan this Claude process works on (a plan that holds a task the process has claimed) is in progress. The reason names each phase in progress and its agent to resume with `SendMessage` (or says to start a fresh builder), then the next ready phase of the same plan to start now (dispatch its builder), closing with `task_done`, or recording a blocker with `task_note` and ending on a `Waiting for: <what>` line, and warns the session against moving a phase back to pending to end the turn. A changed phase, next ready phase or agent earns another block. A subagent's stop is not this hook's: it is the main session's only. The transcript tail is read only after finding a phase in progress; missing or unreadable transcripts keep the decision, and feedback outside the tail is not seen. Silent outside git, with no task store or no session record; a store it cannot read is one line on stderr. Design: [docs/design/hooks.md](docs/design/hooks.md) § The keep-going guard. |
| `worktree-leftovers` | a session starts | With `worktrees`: names the worktrees that are finished (every commit on `origin/<base>`, nothing uncommitted, no running session, idle for an hour) or whose folder is gone — never a locked one, which `worktrees --clean` keeps, so naming it would send you to a command that does nothing — says once what the background clean removed, and starts that clean (at most once an hour per repo, never in `claude -p`, `worktrees.autoClean`). At an attended start it also adds up to three short lines about the main checkout — on another branch than `base`, behind `origin/<base>` as git already knows it, or in the middle of a merge, a rebase or a cherry-pick — read-only and with no fetch. With `worktrees.guardMainFolder` on, each such line names the command for the person to run in the main checkout, never a step for the session; a fast-forward is always `git merge --ff-only`. It removes nothing itself. |
| `user-away` | each prompt; each answer ends; before `AskUserQuestion` and `ExitPlanMode`; when Claude Code's own permission prompt would show; and for every other hook's ask | **Machine-wide**, and `ownHooks` cannot switch it off. **Silent while you are available** (the default). After `cc-smart-dev-kit user unavailable` it holds the line, and **only ever stricter**: a deny where there was a question, never an allow. **`AskUserQuestion` and `ExitPlanMode` are denied** with the step that parks the question (`user park`), so a session never hangs on a question no one reads. **A guard that would ask you** (the push guard, the merge guard, the agent guard, …) **answers deny instead**, with its own words and "parked as #N": the call is put on your list as an `action` with its exact command, so a later yes can run it. **Claude Code's own permission prompt** is denied the same way through the `PermissionRequest` event and parked with its command (proved live on `claude -p`; an interactive and a `--bg` session are not proved yet), except the kit's own `user available`, `user status` and `user list` (nothing else on the line), which get Claude Code's prompt so that you, back at the keyboard, can answer it; if a session still cannot switch the state back, type `! cc-smart-dev-kit user available` in it. An MCP server's input dialog (an elicitation) is not covered. **A note at each prompt**, said once per change (the state, the expected return, the number of parked items) and not at every prompt: "the person is unavailable since …: follow `/cc-smart-dev-kit:user-unavailable`". **Your own prompt does not switch it back** (it may be one line from a phone): it gets its own note that it is still on and how many items wait, and `/cc-smart-dev-kit:user-available` goes through them. **A session you never prompt hears it at the end of its turn** (2.2.0): a session that works on its own (a plan, a monitor) gets no prompt from you, so its stop is **blocked once** with the same note — park what needs you and go on, or end the turn if nothing is left — and it does not end on a question in prose that nobody reads. Once a session heard it, at a prompt or at a stop, its stop is not blocked again for that away period (the session that ran `user unavailable` counts as told), and a change in the number of parked items is said at its next prompt; while you are available, a stop is never blocked. A session that heard "unavailable" is told once when you are available again, with how many items are its own and which sessions hold the rest. A state file that cannot be read changes nothing: the question or the ask goes to you as before, with one line on stderr. Not reached: a project's own copy of a guard (`ownHooks`) answers in Claude Code directly (its resulting prompt is the `PermissionRequest` case), and with no bun at all the shim's `--missing=ask` cannot read the state. |
| `task-start` | a session starts (any source: a start, a resume, a clear or a compaction) | **Machine-wide**: rebuilds the context a start, a clear or a compaction lost with at most eight lines of the kit's open tasks for this project — this Claude process's own first, then those in progress, then the newest — each with its number, its status (non-blocking and blocked marked) and its subject, and no description. An open task that is not this process's own and has not changed for `tasks.staleDays` (30 by default) is not listed: one line counts them and says how to finish or drop them. Says to run `cc-smart-dev-kit setup` while the tasks server is not registered on this machine. |
| `session-name` | a session starts; each prompt | With `sessionNames`: asks the session to name itself after its task, then sets that name at the next prompt. A name you give with `/rename` stays until the session names itself again. |

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

The portal's Needs you page and `/api/needs` are removed, without a replacement inbox or
redirect. Both return normal authenticated not-found responses. Work/Flow waits, guard asks,
user-away parking, doctor checks, gateway breakers and the Machine update controls remain.

The kit sends no custom desktop or terminal notifications. The `notify` and `stop-failure`
hooks, the `hook notify` command, the alert worker and updater notifications are retired.
Claude Code and other installed plugins keep their own notification behaviour.

`cc-smart-dev-kit setup` retires only its exact recorded user-level `Notification` entry
and the exact `set -g allow-passthrough all` line it recorded in `~/.tmux.conf`. Edited or
unowned hooks and lines stay, with a message to check them by hand. A broken ownership
record leaves the affected file alone. It never changes a running tmux server, and
`--dry-run` writes nothing. No replacement notification hook or tmux line is installed.

Old `workflow.alerts.events` and `workflow.alerts.sound` values still load but are ignored;
`workflow show` omits them and `workflow set` refuses them. Existing values are preserved
when another setting is written. The status line still reads `alerts.usagePercent` and
shows plan usage, limits and reset information (§ The usage limit: the alert, the status line, and `usage`).

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
own — returns an error result at once, naming the one step: open Google Chrome with that profile,
then try the tool again. Session startup and listing tools never open Chrome.

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
  of its own. When Chrome is closed the first tool call starts YOUR Google Chrome, with the `claude-code` profile,
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
days by name and worktree, with the command that resumes each. It creates no saved terminal
tabs and leaves old tab files alone.

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

On Linux, `--open` opens each session in an XFCE Terminal window of its own
(through `systemd-run --user` where there is one, so the window takes the desktop session's
environment and opens over SSH too). On Windows it opens a **Windows Terminal** window each
(`wt.exe`). A session already running is never opened again
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
  `name`, which resumes it as it was left — and `EnterWorktree` with a `path` enters an
  existing one: from the launch folder when the path is in `git worktree list`, and from
  inside a worktree when it is another one under `.claude/worktrees/` of the same repo.
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
- nothing in it is changed or untracked that the base does not already hold (below), and it
  holds no ignored file that cannot come back (an edited `.env.local`, a notes file, a key).
  Dependency folders, build output, caches, logs (an ignored `logs/` folder or `.log` file, at
  any depth) and a file the main checkout still holds byte for byte do not block, nor does an
  ignored folder that holds only those.

**Uncommitted files the base already holds.** A builder that never committed in its own folder,
while its lead committed the same files, leaves only copies of work that is merged. A changed,
staged or untracked file counts as held when its exact bytes and file mode are a version that
same path had in a commit of the base's history after the worktree's own HEAD (the base is
`origin/<base>`, or the local `<base>` branch in a repo with no `origin`); a deleted file counts
when the base lost it too. A file put back to a version from before its HEAD keeps the worktree
(a revert someone chose), and so does a symlink, a submodule or a conflict. A file with a filter
driver or `ident` in `.gitattributes` (a notebook output stripper, Git LFS) is compared as it is
on disk, so a filter that drops bytes cannot hide them. The removal takes the same proof again
right before it removes the folder, and reads the folder once more after that: a file written
meanwhile keeps it. The session-start note counts any uncommitted file, so it may not name
such a worktree; `--clean` and the background clean do remove it.

**The verdict is taken again right before anything is removed**, on the folder as it is then:
a worktree that was finished when the list was printed and has a new commit a minute later is
kept. `--clean` removes the finished ones, with their branches (a branch goes only when
`origin/<base>` holds its work, by any of the ways above). `--remove <path>` removes one
now — for a session that has just finished in it, so without the one-hour wait. `--clean` runs in the
main checkout only; `--remove` runs from any checkout except the one that holds your own folder
(a session leaves its worktree first, with `ExitWorktree` keep). Runs go one at a time: a second
`--clean` says so and does nothing, a second `--remove` waits up to ten minutes and then exits 1. A worktree whose folder is gone is named, and
`git worktree prune` forgets it.

**A lock is judged too.** A worktree a live Claude session has locked stays, and so does a lock
whose owner cannot be read. A proved stale Linux Claude lock (its process is gone) is released
only after the normal safety checks, and a removal that fails puts the lock back. A subagent's
lock is stale only when Claude Code also marked that agent finished. `--remove` run by the
session that owns the lock (its `claude` is a parent of the command) may release it, and then
the session's own MCP servers do not keep the folder. Work merged into a branch another
worktree has checked out lets the folder go, and the branch stays until the base holds it.
Design: `docs/design/sessions.md`.

**A removal that stopped halfway is finished here:** a folder named `<path>-removing-<time>` is
what a removal moved aside before git could remove it. While git still lists it, it asks for
neither the idle hour nor the commits on the base (its branch keeps them): nothing may run from
it, and nothing in it may be uncommitted beyond tracked files the removal itself deleted. When
git no longer lists it — `git worktree remove` deleted its registration, then failed on a file
— the list shows it as `(no worktree)` and `--clean` removes what is left only when nothing runs
from it, it is no repository, it crosses no mount and no file in it is newer than the move its
name records; otherwise it stays, with the reason.

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
after its branch's pull request merged, says: stop the dev servers and Monitors started in it,
leave with `ExitWorktree` keep (back to the folder the session started in), then run
`cc-smart-dev-kit worktrees --remove <path>` in the background, which removes the worktree
only when it is finished. That is the note while `clearWorktreeAfterMerge` is on (the default).
With it off, or when your `workflow.json` cannot be read, the note says the worktree looks
finished, lists the same steps, and leaves the decision to you; the session clears nothing.
It never says `remove`:
Claude Code refuses that once the branch has merged the base. A session that did not enter its
worktree with `EnterWorktree` (one started inside it) cannot remove it; it goes when that
session ends. The SessionStart note, when finished worktrees are left behind, points at
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
with no terminal can answer either way. With no terminal it writes nothing unless `--yes` is
given: it prints the plan and the line to run instead. `--dry-run` prints the plan of the flags
and the defaults, asks nothing (on a terminal too), and writes nothing at all. Run it again on a
project that has a file: it shows the diff and asks, and `--yes` keeps every field the flags do
not set. A `--workflow` word changes only the setting it names — `--workflow autoPush=true`
keeps `fixesAfterReview.*` and every other workflow field the file holds; a dotted key
(`alerts.usagePercent=90`) changes only its own field. A `requires` the file already has is never
lowered (a project needing a newer plugin keeps its range); an older one is raised to the oldest
plugin that reads the file (which field needs which release: [A project's
`.claude/cc-smart-dev-kit.json`](#a-projects-claudecc-smart-dev-kitjson)) — never to the version
running here, so a teammate on an older plugin is not refused for a file that reads fine there.
A plan the plugin itself would refuse (a `bases` prefix that does not end with `/`, a key no
version knows) is an error before anything is written.

## The workflow

The workflow is what cc-smart-dev-kit may do **by itself** after a step is finished — commit
it, push the branch, open a pull request, merge it — and how. Two files hold the policy, and
the project's wins field by field:

1. **the project's** `workflow` object in `.claude/cc-smart-dev-kit.json`, committed with the
   code, so a team shares one policy;
2. **yours** in `~/.config/cc-smart-dev-kit/workflow.json` (mode 0600), this machine's defaults;
3. **the built-in default** under both — the safe one: nothing is committed, pushed or
   merged without you, and the status line warns at 85% plan usage.

`cc-smart-dev-kit workflow show` prints every value and where it came from:

```
your own defaults: ~/.config/cc-smart-dev-kit/workflow.json; a project's .claude/cc-smart-dev-kit.json wins field by field
autoCommit = false (default)
openPr = draft (project)
alerts.usagePercent = 85 (default)
plans.maxPhases = 10 (default)
switches.sessionNames = true (project)
gate: what the merge guard judges with, from origin/dev:.claude/cc-smart-dev-kit.json as committed (this checkout's own copy does not count)
gate autoMerge = true (project, committed on origin/dev)
gate reviewBeforePush = true (default)
gate reviewAgents = cc-smart-dev-kit:senior-engineer (default)
gate fixesAfterReview.lines = 200 (default)
gate fixesAfterReview.files = 10 (default)
gate fixesAfterReview.percent = 20 (default)
gate fixesAfterReview in force: 200 lines in 10 files, or 20% of the reviewed change, whichever is more
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
| `reviewAgents` | `["cc-smart-dev-kit:senior-engineer"]` | The subagent types whose return records a review when the agent's brief and every later prompt hold `Mode: review` alone on a line (trailing spaces and tabs allowed; § The review record), by the exact name Claude Code reports: `plugin:name` for a plugin's agent, the frontmatter `name` for a project's own. |
| `fixesAfterReview.lines` | `200` | How many lines (added plus deleted) may change on the branch after its review while the review still counts — or `fixesAfterReview.percent` of the reviewed change's lines, when that is more. The base's own changes, and files the base marks `linguist-generated`, are not counted (§ The review record). A whole number, 0 or more. |
| `fixesAfterReview.files` | `10` | The same for the files changed after the review: both limits must hold. |
| `fixesAfterReview.percent` | `20` | The share, in percent of the reviewed change, a fix round may reach in lines and in files, when that is more than `lines` and `files`. `0` for all three: only the exact reviewed commit counts. |
| `clearWorktreeAfterMerge` | `true` | Clear the worktree once its pull request merged: `ExitWorktree` keep, then `worktrees --remove`. |
| `issues.enabled` | `false` | GitHub Issues, opt-in (D67): the kit may file follow-ups and findings as issues in the project's own repository with `cc-smart-dev-kit issue file`. Off, the command refuses and says how to turn it on. An issue leaves the machine, so, like `autoPush`, it is read from your own file and the project's file **as committed on the base**, and `workflow set`/`unset` of it refuse inside Claude Code. |
| `issues.allowPublic` | `false` | Also file in a **public** repository, where everyone reads the issue. Off, `issue file` refuses a public `origin` and names the command that turns this on. Read and protected like `issues.enabled`. |
| `issues.foundLabel` | `"kit:found"` | The label on every issue the kit files; how it finds the one a fingerprint already filed. A label the repository lacks is created. 1-50 characters, no comma, not starting with `-`. |
| `issues.fixedLabel` | `"fixed-unreleased"` | The label `issue mark-fixed` adds, with a comment, to an issue whose fix was merged; `issue fixed` lists the open ones for the release's `Fixes #<n>` lines. |
| `issues.readyLabel` | `"kit:ready"` | The label a person adds to an issue they chose to have built. None of the kit's commands adds it: `issue file` refuses it as a `--label`, and never rewrites the text of a filed issue that carries it. Which label counts is yours alone: read from your own file and the project's file as committed on the base, and `workflow set`/`unset` of it refuse inside Claude Code (`workflow propose` stays open). The three labels must be three different words (compared without case): a file where two are the same does not load, and `workflow set` writes nothing then. |
| `issues.watch` | — | Accepted and ignored since 2.0: an old file that sets it still loads, nothing reads it, and it is no longer a setting (`workflow show` leaves it out, `workflow set` refuses it). |
| `issues.watchMinutes` | — | The same as `issues.watch`. |
| `alerts.events` | — | Retired: accepted on load and ignored; not shown or writable. |
| `alerts.sound` | — | Retired: the same load-only handling as `alerts.events`. |
| `alerts.usagePercent` | `85` | The plan usage, in percent, a warning starts at (1–100). |
| `plans.maxPhases` | `10` | The most phases one plan may hold (a whole number, 1–50). A plan is a short list of areas, each with its tasks; more phases than this is a plan to split. Your own default, or the project's in this checkout's `.claude/cc-smart-dev-kit.json` (`workflow set plans.maxPhases 12 --project`); the project's wins. Only you raise it: `workflow set` and `unset` of it refuse inside Claude Code, so a session cannot lift its own limit (`propose` stays open). A project that sets it needs `"requires": ">=4.8"`. |

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
| `autoCommit`, `clearWorktreeAfterMerge` | the instructions: the `commit` and `worktree` skills read `cc-smart-dev-kit workflow show` and follow it. The after-merge note also reads `clearWorktreeAfterMerge`: on, it gives the steps that clear the worktree; off, it says the worktree looks finished and leaves the choice to the person. No hook commits or removes anything itself: a commit and a folder are the session's own doing. |
| `autoPush` | the **git guard hook**, which asks before every push while it is off. |
| `openPr` | the **merge guard hook**, which asks before `gh pr create` / `gh pr ready` unless it allows them. |
| `autoMerge` | the **merge guard hook**, which asks you before a merge its rules do not allow — every merge form it reads, in this repository only, and every merge with `--admin` — and answers `allow` for an exact `gh pr merge <n>` whose whole policy passed. |
| `mergeMethod`, `deleteBranch` | the instructions: they say how a merge the guard allowed is made, and whether its branch goes afterwards. No hook reads them. |
| `reviewBeforePush` | both: the **review-record hook** writes the record when the review agent finishes (§ below), and the merge guard asks about a merge whose head no record covers (§ The review record). |
| `reviewAgents` | both: the **review-record hook** records only an agent listed there, and the **merge guard** trusts a record only when the list committed on the base names the agent that wrote it. |
| `issues.enabled`, `issues.allowPublic` | the commands `issue file` and `issue mark-fixed`, which refuse without them, and `issue fixed`, which prints nothing without `issues.enabled`. **The merge guard hook does not read them:** it asks you before a session's raw `gh issue create`, `gh label create`, `gh api … /issues` write and the like, whatever the switches say. `issues.*Label`: `issue file` (the found label, and the ready label it refuses), `issue mark-fixed` and `issue fixed` (the fixed label). |
| `alerts.events`, `alerts.sound` | No runtime consumer; retired load-only keys (§ Notifications). |
| `alerts.usagePercent` | the status line: from that share of a plan window it warns. |
| `plans.maxPhases` | the kit's task store: the most phases one plan may hold ([docs/design/tasks.md](docs/design/tasks.md)). |
| `fixesAfterReview.*` | how much a branch may change after its review and still count as reviewed: the merge guard judges a merge with them, and `workflow merge-check` prints the same verdicts (§ The review record, below). |

**The review record.** The record says one thing: the commit the change set was on had its one
premium review. It is one small JSON file per repository under
`~/.claude/cc-smart-dev-kit/reviews/` (mode 0600), and `cc-smart-dev-kit workflow show` prints
whether the commit here has a record the gate trusts. It is written **by the review-record
hook**: Claude Code tells it when a subagent starts and when it finishes, and if that agent is
one `reviewAgents` lists (by default the plugin's own reviewer) it notes the commit the
working folder is on at the start, and its branch, and records **that start commit, on that
branch**, at the end. A fix committed while the reviewer read is a fix it never saw: it counts
as change after the review, like every later fix. A record also needs a run that was a review
from start to end: the agent's brief (the first user entry of its transcript) holds the line
`Mode: review` (trailing spaces and tabs allowed), and so does every prompt it was given after
the brief — a resume, a message from the session that started it (whether Claude Code writes
it as a user entry or as a queued-command attachment), a task notification, Stop hook
feedback. Tool results are no prompt, nor are the entries Claude Code writes itself when the
agent loads a skill or gets a system reminder (a reminder that ends at its closing tag); any
other entry is. The hook reads the whole transcript, up to 16 MB. So a consult, a review agent
resumed for a question, a review a Stop hook sent back to work, a review that compacted (the
summary counts as a prompt), and a missing, unreadable or larger transcript record nothing,
and the merge guard asks.

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
prints the same verdict for a local merge; a fix over the limit asks, with the counts and
the limit in the question.

A name matches exactly: a
`plugin:name` only that plugin's agent, a bare name only an agent with no plugin prefix, so
another plugin's `reviewer` never counts for `cc-smart-dev-kit:senior-engineer`. An agent that stopped
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

**The usage-warning setting**, read by the status line:

| Setting | What it does |
|---|---|
| `alerts.usagePercent` | The plan usage, in percent, a warning starts at (85 by default). |

`alerts.events` and `alerts.sound` are retired load-only keys (§ Notifications).

**The switches** (`switches.*`) are not stored anywhere, with two exceptions: each one reads and
writes the setting that already exists, so there is only one truth for it. The exceptions are
`switches.jobRoute`, which has two homes, and the project's wins, and `switches.leadHint`, which
lives in your own file alone.

| Switch | The setting behind it |
|---|---|
| `switches.statusLine` | Claude Code's own `statusLine` key, the one `setup --statusline` writes. A status line someone else set is never overwritten, and reads as off. |
| `switches.sessionNames` | The project's `sessionNames` field. |
| `switches.jobRoute` | The project's `jobs.route` field when it has one; else your own default, `switches.jobRoute` in `~/.config/cc-smart-dev-kit/workflow.json` (`workflow set switches.jobRoute true`, without `--project`); else off. `workflow show` says which one answered: `(project)`, `(personal)` or `(default)`. |
| `switches.updateHold` | The hold file behind `cc-smart-dev-kit update --hold`. |
| `switches.leadHint` | `switches.leadHint` in your own `~/.config/cc-smart-dev-kit/workflow.json`; on when left out. While on, a session whose lead model is not Claude Opus tells you once, as a line on your screen (never to Claude): the kit works best with the lead on Claude Opus at high effort. Turn it off (`workflow set switches.leadHint false`) when you lead on another model on purpose. |

`set` and `unset` write one value, and say where:

```sh
cc-smart-dev-kit workflow set autoCommit true                 # your own defaults
cc-smart-dev-kit workflow set openPr draft --project          # the project's committed file
cc-smart-dev-kit workflow unset alerts.usagePercent           # back to the default
cc-smart-dev-kit workflow set switches.sessionNames true --project
cc-smart-dev-kit workflow set switches.updateHold true
```

A switch is written where it really lives, so `switches.sessionNames` needs `--project`, and
`switches.statusLine`, `switches.updateHold` and `switches.leadHint` refuse it (they are yours,
per machine).
`switches.jobRoute` goes to your own file without `--project` (every project follows it) and to
the project's `jobs.route` with it (that project follows its own). A value of the wrong kind, or a setting that is not
one of the settings there are, is refused before anything is written; a file that is not
valid JSON is named, never rewritten.

**The project's own settings change through a pull request.** `.claude/cc-smart-dev-kit.json`
is committed and shared, and the merge guard reads the review gate from the file committed on
the base: a change counts once it is merged, never from a checkout's own copy. So
`cc-smart-dev-kit workflow propose` (and the portal's Workflow card, built on it) never writes
the main checkout. It cuts a branch and a worktree from `origin/<worktrees.base>` (in
`.claude/worktrees/`, so a merged one is cleaned like any finished worktree), writes the one
setting there with the same writer `set --project` uses — so the value is validated and
`requires` is raised in the same commit — commits it, pushes the branch and opens the pull
request with `gh`:

```sh
cc-smart-dev-kit workflow propose autoCommit true
cc-smart-dev-kit workflow propose autoMerge --unset
cc-smart-dev-kit workflow propose openPr draft --folder ~/code/my-app --json
```

A value the base already commits is said and nothing is made (an uncommitted edit in your
checkout is not a policy); the base must carry the project's file (commit and push it first);
`gh` must be installed and logged in for this repository. A failure after the branch exists
takes the worktree and the branch back, and the pushed branch too — except a `gh pr create`
that does not answer in time, which leaves both, since the pull request may be open.
Inside Claude Code the review-gate keys refuse, as `set` does there; outside it — your
terminal, the portal — every key is allowed, because the pull request's review is the gate.
A Claude Code session that runs it is **asked first** whenever the gate the git and merge
guards read — the default, your own `workflow.json`, the project's file as committed on
`origin/<worktrees.base>` — has `autoPush` off or `openPr` short of `ready`: the command pushes
the branch and opens a pull request ready for review in children those guards never see, so the
question names both and the switch that says no. A gate it cannot read, a project it cannot name
(`--folder` worked out when the line runs, a `cd` before it) and a computed program or subcommand
on a line that names the kit are a question too; in `claude -p`, where nobody answers, the
question is a refusal. The portal's Workflow card asks you on its page and runs the command
outside any session, so it is unchanged.

## A project's `.claude/cc-smart-dev-kit.json`

Since 2.0, old `workflow.crew` keys load and are ignored: crew was removed.
Old stores, worktrees and branches are left alone.

`cc-smart-dev-kit project init` (§ [`project init`](#project-init)) writes this file and asks
every question it holds.

```json
{
  "requires": ">=1.10",
  "tasks": { "dir": ".claude/tasks", "staleDays": 30 },
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
  "jobs": {
    "kinds": {
      "e2e": { "match": [{ "script": "test:e2e" }] },
      "test:unit": { "noSlotForFiles": true, "match": [{ "script": "test:unit" }] }
    },
    "route": true
  },
  "workflow": { "openPr": "draft", "autoMerge": true }
}
```

| Field | What it does |
|---|---|
| `requires` | The plugin versions this project needs, as a version range (npm syntax). Checked first: a project needing a newer plugin is told to update, not that a field is unknown. |
| `tasks` | Optional object; all its fields are optional. Since 1.10.0 (`TASKS_SINCE`): setting it needs `requires: >=1.10`. |
| `tasks.dir` | Task folder inside the checkout, default `.claude/tasks`. Use `/`; no absolute path, backslash, or `.`/`..` segment. Shares the in-checkout path check with `worktrees.rebuildable`; that field's contract is unchanged. |
| `tasks.staleDays` | Whole number at least 1; default 30. Open tasks older than this appear in `task check`. |
| `tasks.releaseBranch` | Release branch; default the remote's default from `origin/HEAD`, else `main`. |
| `tasks.legacyFolders` | Old notes folders inside the checkout. `task check` flags new files there, so a branch cannot quietly bring back a retired ledger. |
| `worktrees` | Turns on the notes and guards that work with worktrees (the after-merge and leftovers notes, the stash question, the main-folder guard). Every project uses Claude Code's own worktrees (§ Worktrees). |
| `worktrees.base` | The branch a new worktree starts from and pull requests go into; the base the after-merge and leftovers notes compare with. |
| `worktrees.prefix` | **Retired in 1.0.0, and refused**: the folder-name prefix the plugin's worktree engine gave a worktree beside the repo. A file that still sets it does not load; `cc-smart-dev-kit project init` removes it (§ Worktrees). |
| `worktrees.setup` | **Retired in 1.0.0, and refused**: a command the engine ran inside a new worktree. A project runs its own install itself; `cc-smart-dev-kit project init` removes the field. |
| `worktrees.guardMainFolder` | `true`: refuse edits in the main checkout itself. Off when left out. |
| `worktrees.rebuildable` | Optional list of the project's own ignored paths that come back by themselves, such as `[".tool-cache/", "*.cache"]`. Removing a worktree may lose them. Patterns use `/` and match at any depth, not only at the root: `.tool-cache/` matches `.tool-cache/` and `pkg/.tool-cache/`; a folder ends in `/`. No empty or absolute paths, backslashes, `.` or `..` segments, or patterns with only glob characters and dots (`*`, `.*`); name a folder or file. Never list a file that holds settings or secrets, such as `.env.local`. Only widens the ignored-file safety rule; other removal checks still apply. Read from the main checkout; a missing, broken or too-new file adds nothing. Since 1.9.0: needs `"requires": ">=1.9"`. |
| `worktrees.autoClean` | `false`: the finished worktrees do not clean themselves. On when left out: after a merge into the base, and at an attended session start (at most once an hour), the plugin runs the same safe clean as `cc-smart-dev-kit worktrees --clean` in the background (§ Worktrees). A field of 1.0.0: a project that sets it needs `"requires": ">=1.0"`. |
| `worktrees.bases` | A branch-name prefix (ending in `/`) to the base that branch family's pull requests go into (`{"hotfix/": "main", "release/": "main"}`). The longest prefix that matches wins; every other branch's requests go into `base`. Auto-merge and the merge guard's opening check read it; to start a task from another base, switch the main checkout to it first with `baseRef: "head"`, or `git worktree add` it as Claude Code's docs say. |
| `worktrees.engine` | **Retired in 1.0.0, and refused**: it said who made the project's worktrees. Every project uses Claude Code's own; `cc-smart-dev-kit project init` removes the field. |
| `protectedBranches` | The branches the git guard asks about before a push. Default `["main"]`. |
| `checks.fast` | The fast check a session runs before it stops: one command, as you would type it (`"bun run typecheck && bun test src/changed"`). The `verify-gate` hook blocks a stop **once per change** when the session changed files and no Bash or PowerShell call ran this command after the last change (§ The hooks). A field of 1.1.0: a project that sets it needs `"requires": ">=1.1"`. |
| `sessionNames` | `true`: each session names itself after its task. Off when left out. |
| `ownHooks` | The plugin hooks this project still runs as its own copy (in its own settings): exactly those stay silent here, so nothing runs twice. `["git-guard"]` while the project still has its own git guard; empty it once that copy is gone (§ The hooks). A retired hook name (`serena-root` from 0.6.0; `crew-role` and `lead-notes` from 2.0.0; `message-guard` from 4.3.0) is still accepted and silences nothing. `session-escape-guard` cannot be listed: no project can switch it off. |
| `instructions` | Accepted now. Today a project loads the opt-in instructions with its own import line (§ Instructions, skills and agents); the field does not load them yet. |
| `autoMode` | Used now: `setup` copies it into your settings ([The auto-mode block](#the-auto-mode-block)). |
| `jobs.kinds` | Used now: the project's own heavy-job kinds over the defaults ([docs/jobs.md](docs/jobs.md) § What is heavy). A kind says which commands are heavy (`match`, `printOnly`, `about`) and has no size. `noSlotForFiles: true` lets a run on named files only (`bun run test:unit src/a.test.ts`), up to 10 files, skip the queue; above that it waits for the heavy slot. A run with no operand, or one that is not a file, still waits for the slot. `skipWords` (a subcommand word such as `run`) and `valuedFlags` (an option whose value is the next word) help it find the operands. `noSlotForFiles` is a field of 1.5.0: a project that sets it needs `"requires": ">=1.5"`. A file written for an older plugin may still set `gb`, `filesGb`, `maxFiles`, `workers` or `light`: it still loads, the queue ignores them, and `doctor` says once that they can go. |
| `jobs.route` | `true` or `false`: whether the `job-route` hook sends a heavy Bash command through `cc-smart-dev-kit job run` instead of running it raw (§ The hooks). When left out, your own default decides (`switches.jobRoute` in your `workflow.json`), and without one it is off. The project's value wins over yours. That hook's other part — the launch judge — reads neither this field nor any other: it runs machine-wide. |
| `workflow` | This project's [workflow](#the-workflow) policy, over your own defaults: what cc-smart-dev-kit may do by itself here. Each field is optional, and the project's value wins field by field. |
| `workflow.fixesAfterReview` | How much a branch may change after its review and still count as reviewed: `lines`, `files` and `percent` (§ [The workflow](#the-workflow)). Part of the review gate, so the merge guard reads it as committed on the base. |
| `workflow.plans` | How the kit's plans are shaped (4.8.0): `maxPhases`, the most phases one plan may hold, 1-50 (10 by default) (§ [The workflow](#the-workflow)). |
| `workflow.issues` | GitHub Issues (1.4.0): `enabled` and `allowPublic` (both off by default) and the labels `foundLabel`, `fixedLabel`, `readyLabel` (three different words) (§ [The workflow](#the-workflow); `cc-smart-dev-kit issue file`). Read as committed on the base. `watch` and `watchMinutes` are accepted and ignored since 2.0. |

`requires` is a version range (npm syntax). When the installed plugin is older than the range,
the plugin says so and asks you to run `claude plugin update cc-smart-dev-kit@cc-smart-dev-kit`.
When it is newer than a range with a top (`^1.4` or `>=1.4 <2` under 2.0), an update cannot help:
it asks you to widen `requires` in the file instead (`>=1.4`). A
project that uses a field raises its `requires` to the release that brought the field: a file
written without `worktrees.prefix` asks for at least `>=0.5.2`, the version that made it
optional, so a teammate on an older plugin is told to update instead of failing the file's
parse. `worktrees.autoClean` and `workflow.fixesAfterReview` came with 1.0.0 (optional fields:
a minor change), so a project that sets one asks for `>=1.0`; `checks` asks for `>=1.1`,
`workflow.issues` for `>=1.4`, `worktrees.rebuildable` for `>=1.9`, `tasks` for `>=1.10` and
`workflow.plans` for `>=4.8`. A
`jobs.kinds` field does the same: `noSlotForFiles` asks for `>=1.5` (and the ignored `light`
for `>=1.8`). An `ownHooks` name does the same when its hook came after `ownHooks`:
`subagent-background` asks for `>=1.0`, `verify-gate` and `agent-usage` for `>=1.1`,
`tier-view` for `>=1.3`, `task-start` for `>=1.10`, and `keep-going` and `builder-finish` for
`>=2.0`; the retired `crew-role` and `lead-notes` still ask for `>=1.0`. An older plugin refuses
a key or a hook name it does not know, so it must hear "update" first. The tables are
`JOB_KIND_KEYS_SINCE` and `OWN_HOOK_NAMES_SINCE` in `src/project/config.ts`, and a test fails
when a new key or hook name has no entry. `workflow set --project` raises a `requires` that
sits below what the file's fields need, on any write (never lowers one), and `doctor` warns
about such a file and names the fix. `worktrees.prefix`, `worktrees.setup` and
`worktrees.engine` retired with the plugin's worktree engine in 1.0.0: a file that still sets
one does not load, and the error names each field and the fix, `cc-smart-dev-kit project init`.

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
- [Heavy jobs](docs/jobs.md): the machine-wide queue, its one slot, its kinds and its limits.
- [Claude Code contract](docs/claude-code-contract.md): the Claude Code behaviour the
  plugin relies on, and the version it was last proved on.
- Windows: [setup](docs/windows-setup.md), [hooks](docs/windows-hooks.md),
  [heavy jobs](docs/windows-jobs.md),
  [the gateway](docs/windows-gateway.md) ([Windows](#windows) above).
