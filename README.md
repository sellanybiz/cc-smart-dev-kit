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

**macOS and Linux.** This repo is private, so start it with `gh`, which sends the script's
own bytes down the pipe:

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

The one command does the whole install, in order: it checks the machine, installs or upgrades
[Bun](https://bun.sh) 1.4.3 or later when it is missing or older, adds the three marketplaces,
installs the plugin, runs `migrate` and then `setup` (the move is a no-op on a machine without
the old names), asks for the three things only you have — the browser's token, the gateway's
key, the Tavily key — and ends with `doctor` and, when something is left, the list of what is
left. It asks before it installs or upgrades anything, it prints the exact command that retries
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
one-liner above is the same thing with the checks, the questions and the retries built in.
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
   that Claude Code installed. Paste this one line: it finds the newest installed version by
   itself.

   ```sh
   d="$HOME/.claude/plugins/cache/cc-smart-dev-kit/cc-smart-dev-kit"; v="$(ls "$d" | sort -t. -k1,1n -k2,2n -k3,3n | tail -n1)"; bun --no-env-file --config="$d/$v/bunfig.toml" "$d/$v/dist/cli.js" setup
   ```

   (`ls` lists the installed versions, `sort -t. -k1,1n -k2,2n -k3,3n` puts them in version
   order — `0.5.0`, then `0.9.0`, then `0.10.0` — and `tail -n1` takes the newest.)

   Both flags matter: Bun adds the `.env` files of the folder you run the command from and
   reads its `bunfig.toml`, so without them a project's `.env.local` (its `TAVILY_API_KEY`,
   say) or a project's `preload` would reach setup. The launcher,
   `plugin/bin/cc-smart-dev-kit` and the hooks' bun shim all pass both for the same reason.
   The bundle path is the newest version's own folder (`$d/$v/dist/cli.js`) and the empty
   config sits beside it (`$d/$v/bunfig.toml`), so a later version ships its own.

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

## 0.6.0: Serena is removed

The plugin no longer registers the Serena MCP server, and its `serena-root` hook and its
`code-explorer` agent are gone. One Serena server ran for each Claude session, at about 3 GB of
memory each in a large project; sessions seldom used it, and Grep, Glob and Read do most code
search. For a file's shape — its functions and exports — claude-mem's `smart_outline`,
`smart_search` and `smart_unfold` do the job (claude-mem is a [companion
plugin](#companion-plugins) setup installs).

**After you update, run `cc-smart-dev-kit setup` once.** It takes back what an older setup made
for Serena, and nothing else:

- the `serena` MCP server, with Claude Code's own `claude mcp remove serena --scope user` —
  only while setup's record says setup registered it, and it still holds exactly what setup
  registered (or, after a pin update an older setup left half done, it still has setup's own
  shape: `uvx`, Serena's repository, and setup's own context file);
- Serena's context file, `~/.local/share/cc-smart-dev-kit/serena/contexts/worktree.yml`
  (a backup goes to the state folder first), and its folder once it is empty;
- the `serena-root` hook's records, `~/.claude/cc-smart-dev-kit/serena-root/`.

`--dry-run` shows each of these first. Until setup has run, `doctor` prints one ✗ line that
says so; after it, nothing.

**A Serena of your own stays.** A `serena` server that setup did not register (or one you
changed since) is never touched: `doctor` shows it as a `·` line. Its context file stays too,
while a registration still starts Serena with it. The main-folder guard no longer looks at
Serena's edit tools, so a Serena you keep can edit a guarded main checkout without a refusal.
To remove a Serena of your own by hand:
`claude mcp remove serena -s user`. A project's own `.serena/` folder (Serena's project
settings and memories) is the project's: delete it when nothing uses it any more.

A project whose `.claude/cc-smart-dev-kit.json` lists `serena-root` in `ownHooks` keeps working:
the name is still accepted, silences nothing, and `doctor` says it can go.

## What's new in 0.5.0

**After you update, run these in your own terminal, in this order:**

1. `cc-smart-dev-kit gateway setup` — updates the router copy on this machine (a plugin update
   alone never does: until this step the older router keeps answering). It also takes out the
   model keys 0.4.3 wrote (`ANTHROPIC_DEFAULT_HAIKU_MODEL` / `…_SONNET_MODEL`, only where
   cc-smart-dev-kit set them), and drops the hidden `claude-sonnet-5-5` from a scout or worker
   chain that is still 0.4.x's default. A slot is reached by the model's family now, so those
   keys are no longer needed.
2. **Restart every open Claude session right after.** A session that is still running may keep
   sending `haiku` / `sonnet` work by the slot's old name; when that slot has no chain, the
   router refuses it with a 400 that says what to do.
3. `cc-smart-dev-kit gateway on` — only if the gateway is not on yet.

Check your scout and worker chains (`cc-smart-dev-kit gateway status`): a Claude model answers
there only if you put it in the chain. Setup took out the `claude-sonnet-5-5` 0.4.x added at
the end of its default chains; a chain you changed is left as it is.

An opus or fable chain set before 0.5.0 starts with its fallback **off**: it moved on only at
the plan's usage limit, and "on" now moves on at any rate limit or server error. Turn it on
with `cc-smart-dev-kit gateway fallback <slot> on` when you want that. An opus or fable chain now
also takes every Opus or Fable id, not only the one 0.4.x keyed it by, and a `claude-…` first
target answers for all of them.

A judge set before 0.5.0 is ignored until it is tested and set again
(`cc-smart-dev-kit gateway slot judge <target>[,…]`), because the judge's job changed: it judged
only when Claude could not, and now it judges every check in Claude's place.

The gateway:

- **Every slot works the same way** ([The AI gateway](#the-ai-gateway-optional)). Opus and Fable
  take any chain, a backend first included (`gateway slot opus omniroute:<model>`), and the scout
  and the worker keep theirs. A slot with no chain is off: that model is plain Claude, on your own
  login. A fresh setup writes no chain, so the plugin picks no model for you; and there is no
  hidden Claude step — a chain whose targets are used up returns its error.
- **Each slot has a fallback switch** ([The AI gateway](#the-ai-gateway-optional)):
  `cc-smart-dev-kit gateway fallback <slot> on|off`. On: the next target answers when the one
  before it fails or rests. Off: only the first answers, and the rest stay saved. On by default
  for scout and worker, off for opus, fable and judge.
- **A request reaches its slot by the model's family**, so `gateway on` no longer pins `haiku`
  and `sonnet`. A newer version of a family (`claude-opus-6-0`) reaches its slot with no change.
- **The judge judges every check** ([First setup](#first-setup)), once you give it a chain; with
  no chain, Claude judges, as before.
- **An affordable model's thinking stays visible** ([The AI gateway](#the-ai-gateway-optional)): the
  router keeps it, marked as its own with the backend's signature inside. It removes it only on a
  request to Claude (no "Invalid `signature`" 400), and gives a backend its own signature back.
- **The usage-limit alert names no model of its own** ([The usage
  limit](#the-usage-limit-the-alert-the-status-line-and-usage)): it offers your model first, then
  targets from your own chains, and its action also turns that slot's fallback on. It covers
  every family that has a slot.
- **`agent-guard` reads affordability from `gateway.json`** ([The hooks](#the-hooks)): a `haiku`
  or `sonnet` launch is affordable while the gateway is on and that family's slot has a chain
  whose first target is a backend — no longer from the model keys 0.4.3 wrote.
- **claude-mem follows the scout slot only** ([claude-mem on the
  gateway](#claude-mem-on-the-gateway)): setup points it at the scout chain's first target when
  that is a backend, writes no quota fallback model any more, and takes out the fixed Claude
  Haiku fallback 0.4.3 wrote there.

Worktrees:

- **`worktrees --remove <path>` no longer finds itself** ([Worktrees](#worktrees)). The command's
  own line (`… worktrees --remove /path/wt`) and the shell that ran it name the folder being
  removed, so on Linux and macOS every removal answered "kept …: programs run from its files:
  bash, bun". Each process's parent is read now (`ps -ww -o pid=,ppid=,args=`, `ParentProcessId`
  on Windows), and the command's own process and those that started it are left out of the
  command-line match; a process whose working folder is inside the worktree still counts, so a
  session or a shell really sitting there keeps it.

The merge guard:

- **`--admin` always asks** ([The hooks](#the-hooks)). The merge guard asks you about every
  `gh pr merge … --admin` (or `--admin=<anything>`), even when `autoMerge` would let the merge
  through: `--admin` merges past the repository's required reviews, required checks and merge
  queue. It asks, never refuses, so a release flow can still use it after your yes.

The installer:

- **The marketplace is added over HTTPS when SSH to GitHub is refused** ([Install](#install)).
  Claude Code adds a marketplace over ssh by default, so a machine with no GitHub SSH key (or a
  port-22 block) failed with nothing added. The installer retries that one source once as
  `https://github.com/<owner>/cc-smart-dev-kit.git`, says so in one line, and goes on — the
  marketplace's name comes from the repository's own marketplace file, so it lands under the
  same name.
- **An account that cannot read the repository is named** ([Install](#install)). With `gh`
  installed and logged in, the installer asks `gh repo view <owner>/cc-smart-dev-kit --json name`
  before it adds anything: the run stops (exit 1) with the account, the line to ask the
  repository's owner for read access, and the invitation page. `doctor`'s marketplace check
  names the same two causes with the same fix lines.

## What's new in 0.4.3

Every change here comes from the installer's FIRST real run, on 2026-10-17, and from what it
left behind on that machine.

- **The marketplace is refreshed before any version is compared** ([Install](#install)). The
  live run had the marketplace added hours earlier at 0.4.1: the installer compared the
  installed 0.4.1 with that stale clone's 0.4.1, saw them equal, updated nothing — and then
  called an option the installed 0.4.1 CLI did not have, so the run died at the Tavily step.
  The installer now runs `claude plugin marketplace update` first (the same order
  `cc-smart-dev-kit update` uses), and then reads the installed CLI's own version: older than the
  release the installer ships with means it stops, with the two exact commands and exit 1,
  instead of calling an option that CLI may not have.
- **A backend key is tested before it is saved** ([The AI gateway](#the-ai-gateway-optional)).
  A person pasted their Ollama Cloud key where the router's OmniRoute key was asked for; it was
  saved unchecked, OmniRoute answered 401 to every request after that, and every affordable
  subagent fell back to Claude until the key was read back out of OmniRoute's own database. Now
  `gateway setup --backend-key-stdin` makes one cheap authenticated request first
  (`GET /v1/models`): a 401 or 403 refuses the key, keeps the one in the file and exits 1, saying
  which key the backend wants. A backend that cannot be asked (unreachable, or a 5xx) saves
  nothing either — unless `--save-unchecked` says you know. And the file is backed up before a
  key that is really changing replaces one.
- **No key yet? setup can make one.** ([First setup](#first-setup))
  `cc-smart-dev-kit gateway setup --omniroute-password` (or `--omniroute-password-stdin`) takes
  your OmniRoute **dashboard** password — asked with no echo, never stored — logs in to the local
  OmniRoute, makes the router's key named `cc-smart-dev-kit-router-<machine>`, tests it and saves
  it. No dashboard trip, no copy-paste.
- **The installer asks before it touches an MCP server of yours** ([MCP
  servers](#mcp-servers)). A project's own script had registered `playwright`, `serena`,
  `sequential-thinking` and `tavily-websearch` at user scope first; setup left them alone (the
  rule) and printed one `!` line nobody saw, so the old browser kept starting and the plugin's
  own never took over. The installer now runs `cc-smart-dev-kit mcp status --json`, shows what
  runs instead, and asks per server: "Replace it with cc-smart-dev-kit's?" — a yes removes it and
  runs setup again (so the plugin registers its own **with its record**), a no lists it under
  "What is left" with the exact command. `doctor` gained a `!` line for the same case.
- **The gateway is asked about only when it is not working** ([First
  setup](#first-setup)). A new read-only `cc-smart-dev-kit gateway check` answers one question
  with an exit code: 0 the key works, 1 no key yet and OmniRoute answers (setup can make one),
  3 it could not be judged, 4 the key in the file is one OmniRoute refuses. The installer asks
  for a key only on 1 and 4 — showing what runs instead and never a key — and asks again **once**
  after a refusal, keeping the old key.
- **A pasted secret no longer arrives broken.** Warp and other terminals wrap a paste in the
  bracketed-paste markers `ESC[200~` … `ESC[201~`, and a read that echoes nothing keeps every
  character: a token a person pasted was refused as "55 characters" and never saved. Every
  secret read now strips those markers and any other control character — in the plugin (one
  home: `src/cli/secret-line.ts`), and in both installers. The token step is also ONE question
  now (paste it, or Enter to skip): a paste can no longer land in a yes/no answer, and every
  path of `browser token` that saves nothing exits non-zero.
- **The `claude-code` profile is named in BOTH of Chrome's files**
  ([The browser](#the-browser)). Chrome reads the display name from `Local State` and falls back
  to the profile's own `Preferences` (`profile.name`); only the first was written, and the person
  saw the profile unnamed. Both are written now, still only while Chrome is closed — while it
  runs, the page says "close Chrome, then run `cc-smart-dev-kit browser setup` again".
- **`doctor` no longer invents extensions.** It judged the profile by the folders on disk, and
  named Chrome's own `Temp` folder and Chrome Web Store Payments — neither of which a person can
  find in `chrome://extensions`. It reads Chrome's own record now: a folder with a manifest, and
  a location that is not a component or an install Chrome made for itself. A real extra
  extension is named by its manifest name (a `__MSG_…__` name resolved from its own locales).
- **Tavily is never asked for twice** ([MCP servers](#mcp-servers)). The person had
  `TAVILY_API_KEY` in their environment and a project already running a Tavily MCP server; the
  installer asked anyway. It says one line instead — "Tavily: using TAVILY_API_KEY from your
  environment" — and asks only when neither the environment, the key file, nor your settings
  have one.
- **The Fable warning is at the switch, or right after Fable's first answer — never after a
  switch away** ([The hooks](#the-hooks)). `fable-session` read the transcript's last answer at
  every prompt, which is the PREVIOUS turn's model: it missed the switch to Fable, and then
  warned while the person was back on Opus. It runs on `PostModelSwitch` (the model the session
  moved TO), on `Stop` (the answer that just finished) and on `SessionStart`, and no longer on
  `UserPromptSubmit`.
- **The portal's log is newest first** ([The portal](#the-portal)): the Health page's Log and the
  Overview's "Latest warnings" both show the newest line at the top, with the times as they are.
- **`gateway setup --omniroute-password` works on a real terminal** ([First
  setup](#first-setup)): the flag asks for the dashboard password with no echo, and the context it
  reads from never carried the reader — every run answered "this terminal cannot hide what you
  type", even on a terminal. It reads the line now, and a key it makes but does not save (a key
  the backend refuses, an unchecked save without `--save-unchecked`) is **deleted again** in
  OmniRoute, so the dashboard keeps no unused key; a delete that fails names the key and its id.
- **Nothing that names a server can print a key** ([MCP servers](#mcp-servers)): a URL's query,
  fragment and userinfo are hidden, an argument after a key-like flag (`--api-key X`) and a
  `name=value` whose name looks like a key (`--token=X`) show `•••`, and the command is shown by
  its own name — in `mcp status`, its `--json`, the installer's question and `doctor`'s line.
- **A Tavily key that lives only in your `settings.json` is a key setup uses** ([MCP
  servers](#mcp-servers)): Claude Code fills `Bearer ${TAVILY_API_KEY}` from the settings' `env`
  as well as from your environment, so setup now reads that copy too — it registers the server
  instead of saying there is no key, while the installer had already stopped asking for one.
- **`tavily-websearch` is offered for replacement like the other three** ([MCP
  servers](#mcp-servers)): the check used to leave it out when the machine had no Tavily key, so
  a server a project's own script had registered under that name was never mentioned. And the
  installer asks again after the Tavily step, when the key has arrived.
- **`doctor` names a same-name server that wins over the plugin's**
  ([MCP servers](#mcp-servers)): a copy at the local scope (`~/.claude.json`,
  `projects[<folder>].mcpServers`) or in a project's `.mcp.json` takes precedence over the
  user-scope one, so that copy is the one Claude Code starts.

## What's new in 0.4.2

- **One command installs the plugin** ([Install](#install)): `install.sh` for macOS and
  Linux, `install.ps1` for native Windows, the same steps, the same words and the same exit
  codes. Each step prints one line and is skipped when it is already done, so a second run
  only fixes what is missing. It asks before it installs or upgrades Bun, asks for the
  browser's token, the gateway's key and the Tavily key (each skippable, never echoed, never
  printed), and ends with `doctor` and — when something is left — the list of what is left,
  each item with the exact line that finishes it. `--dry-run` prints the plan for this
  machine and changes nothing. A step that fails stops with the command that retries it;
  running the installer again goes on from there. It refuses inside a Claude Code session,
  and it never writes a secret file or passes a secret on a command line: each key reaches
  the plugin's own command on stdin. Exit codes: 0 done, 3 installed with items left, 1 a
  step failed, 2 refused.
- **The move runs on every machine, and `setup` always follows it** ([Moving from
  anymodel](#moving-from-anymodel)): `migrate` decides by itself what to move and says
  "Nothing to move." on a machine without the old names, so the installer no longer guesses
  for it — and the old `anymodel` plugin, when it is still installed, is asked about
  afterwards. `setup` then installs the instructions and the launcher, which the move alone
  does not.
- **`cc-smart-dev-kit setup --tavily-key-stdin`** ([MCP servers](#mcp-servers)): the Tavily
  key on stdin, never an argument. setup writes it to the key file it reads a key from
  (`~/.claude/cc-smart-dev-kit/tavily.key`, mode 600, through the same atomic writer as the
  browser's token) and then treats it as a key from that file, so a later setup keeps it.
- **Adding the new marketplace does not reuse the old one** ([Moving from
  anymodel](#moving-from-anymodel)): proved live on a machine that still had the `anymodel`
  marketplace — adding this repo's source made a SECOND marketplace, named
  `cc-smart-dev-kit`. The installer and the move both rely on it, so "already added" is a
  marketplace's own name, never its source.

## What's new in 0.4.1

- **Fable may be a fresh attempt** ([Instructions, skills and agents](#instructions-skills-and-agents)):
  when you are not satisfied with Claude's own answer — a UI/UX design, an engineering problem, a
  fix — the session may launch a read-only Fable advisor for a fresh attempt, with the reason
  `Fable reason: unsatisfied - <what you disliked>`. It proposes a design, a plan or a fix; you
  or a worker build it, and you approve each launch.
- **Fable may build, and a session may run on Fable** ([The hooks](#the-hooks), and the model
  table in [Instructions, skills and agents](#instructions-skills-and-agents)): an agent that can
  change files — a builder, or a fork — runs on Fable with `Fable reason: build - <what you asked
  for>`, which you approve each time; anything else there keeps being refused. Nothing objects to
  a session whose own model is Fable: it is your choice. For a hard or high-stakes change —
  security, money, permissions, a big architecture change — the session may also run the
  second-opinion review on Fable by its own judgment, with the reason
  `Fable reason: review - <why>`, and the guard asks you.
- **A note when the session itself runs on Fable** ([The hooks](#the-hooks)): the new
  `fable-session` hook shows you one line, once a session, when the session's own model is the
  `fable` tier — it uses your plan's limits faster than Opus, so switch with `/model` if you did
  not mean to. Nothing goes to Claude, it never blocks anything, and a `/model` switch to Fable
  is caught once Fable has answered, at the prompt after that. That the line reaches you at all
  is **not yet proved live** (see the owed check in
  [docs/claude-code-contract.md](docs/claude-code-contract.md) § Relied on, not proved yet).
- **A review at effort `max` asks instead of being refused** ([The hooks](#the-hooks)):
  `agent-guard` now asks you to approve a review at `max` — reviews run at `xhigh` unless you asked
  for a deeper one — and records it, so `cc-smart-dev-kit usage` lists it. In `claude -p`, where
  nobody can answer, it is still refused.
- **`opus` and `fable` mean the tier, whatever model answers** ([The hooks](#the-hooks)): an
  `ANTHROPIC_DEFAULT_OPUS_MODEL` / `…_FABLE_MODEL` override (or a model slot) that points one at
  another vendor's model keeps the tier's rules — the reason line, your approval, the review
  rules, and never a forced `max` — and the guard's question names both, like
  `` `opus` (answered by openai:gpt-5.5) ``.

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
  gone; the profile folder 0.3.0 left stays on disk, `doctor` names it and the command that
  deletes it, and nothing here deletes it for you.
- **The instructions work in parallel**: the plugin's general instructions tell Claude to
  start every independent phase at once, and never to wait for a merge, a release, a review
  or an answer it does not need ([Instructions, skills and agents](#instructions-skills-and-agents)).
- **The merge guard, and the review record** ([The workflow](#the-workflow)): the `merge-guard`
  hook asks you before a `gh pr merge` your policy does not allow, and `workflow show` says
  whether the commit here has a recorded review.
- **The effort rule** ([The hooks](#the-hooks)): `agent-guard` allows a subagent only at
  `high`, `xhigh` or `max` — `low`, `medium` or a level it does not know is refused, as
  before a launch with no model or no effort. An affordable slot still runs at `max`; a
  review runs at `xhigh`, unless you asked for a deeper one — `max` then asks you (0.4.1).
- **The alert settings** ([Notifications](#notifications)): `alerts.events` says which moments
  alert, `alerts.sound` adds the platform's sound, and `alerts.usagePercent` is the plan share
  the status line warns from.
- **The Linux desktop extras of the alerts** ([Notifications](#notifications)): a click
  raises the session's window, the alert moves to the notification centre after a minute, one
  alert per session is on screen, and XFCE's Do Not Disturb keeps an ordinary alert quiet —
  each only where its tool is installed.
- **The portal's Settings page, its Project card and its Browser card** ([The
  portal](#the-portal)): the workflow settings with where each value comes from, the project's
  two files planned and written from the form, and the browser's state with the button that
  runs `browser setup`.
- **"Dynamic, not hard-coded"** ([Instructions, skills and agents](#instructions-skills-and-agents)):
  the instructions tell Claude to read every value — a name, a path, a port, a URL, a version,
  a branch, a list — from the one place that owns it, never from a copy in the text.

**After you update, run `cc-smart-dev-kit gateway setup` on every machine with the gateway.**
The router changed in this release (it counts auto mode's safety checks, which `usage` reads),
and that command puts the new copy in place. It asks before it restarts the router, because a
restart cuts the answers in flight.

**The browser needs its two steps too** ([The browser](#the-browser)): the `playwright` server
refuses to start until `cc-smart-dev-kit browser setup` has made the `claude-code` profile and
`cc-smart-dev-kit browser token` has saved the token from the extension's status page. A machine
that ran 0.3.0 also still has its old shared profile at
`~/.local/share/cc-smart-dev-kit/playwright`, and possibly the Chrome 0.3.0 started: nothing uses
either now, and `doctor` names both — where the folder is, the command that deletes it, and the
pid of that Chrome, whose debug port any program on your machine can drive. Neither is deleted
for you: the folder may hold sign-ins, so that call is yours.

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
| `cc-smart-dev-kit setup` | Installs the launcher, turns on plugin auto-update, writes one user-level `Notification` hook for agent view ([Notifications](#notifications)), and installs the [instructions](#instructions-skills-and-agents): a copy in `~/.claude/cc-smart-dev-kit/instructions/`, imported by a cc-smart-dev-kit block in `~/.claude/CLAUDE.md` (your own text there is kept); each run refreshes the copy, so run it after a plugin update. Adds a missing [companion](#companion-plugins) marketplace (or plugin). Adds the [tmux line](#notifications) to `~/.tmux.conf` when tmux is installed (kept next to your own lines, removed again by `restore`), and prints the command that applies it to a running tmux server. Points [claude-mem at the gateway's affordable model](#claude-mem-on-the-gateway) when both are set up, and turns [claude-mem's two start blocks off, with Claude Code's own task tools on](#claude-mem) whenever claude-mem is installed. Copies the project's [auto-mode entries](#the-auto-mode-block) into your settings, after it shows them and asks. It never touches [Warp](#warp) or its plugin without `--warp`. Every question comes before anything runs or is written. `--dry-run` shows the changes, and writes, runs and checks nothing at all (it reaches no network). A settings key you set yourself (for example `autoUpdate: false`, also after setup had set it) stops setup before it writes or runs anything. Without `claude` on your PATH, setup skips only the `claude plugin …` steps, names them, does the rest, and exits with 1. Run in a terminal with no status line set, setup also offers [cc-smart-dev-kit's status line](#the-usage-limit-the-alert-the-status-line-and-usage) (once: it remembers a "no"). |
| `cc-smart-dev-kit setup --no-instructions` | Takes the instructions' block and copy out and **keeps them out**: setup stores the choice (`~/.claude/cc-smart-dev-kit/no-instructions`), so a later plain `cc-smart-dev-kit setup` leaves them out too. `--instructions` clears that choice and installs them again. `restore` clears it as well. |
| `cc-smart-dev-kit setup --yes` | On a terminal: the same, and writes the auto-mode entries without asking (they are still shown). With no terminal, they are left out, also with `--yes`. |
| `cc-smart-dev-kit setup --project <dir>` | Reads the auto-mode entries from the project in `<dir>`, not from the folder you are in. |
| `cc-smart-dev-kit setup --warp` | Also installs the Warp terminal, then its Claude plugin. The commands are shown first and asked; `sudo` asks for your password. |
| `cc-smart-dev-kit setup --remove-warp` | Removes the Warp terminal, its package source and key, your Warp shortcuts and its Claude plugin. Shown and asked first. |
| `cc-smart-dev-kit setup --tavily-key-stdin` | Takes the Tavily key on **stdin** (never an argument: a command line is readable in `/proc` and lands in the shell's history), writes it to the key file `~/.claude/cc-smart-dev-kit/tavily.key` (mode 600, atomically) and then treats it as a key from that file, so a later setup keeps it. An empty stdin is refused. This is the [installer](#install)'s way in for the key. |
| `cc-smart-dev-kit setup --statusline` | Also sets Claude Code's status line to `cc-smart-dev-kit statusline`, as a key cc-smart-dev-kit owns, without asking (also after an earlier "no"). It never replaces a status line you set: one you set yourself, also after setup had set it, stops setup before it writes anything, and `restore` leaves it. |
| `cc-smart-dev-kit statusline` | The status line itself: plan usage, a warning from 85 %, and any gateway fallback in use. Reads the JSON Claude Code passes on stdin. |
| `cc-smart-dev-kit usage [--hours <n>] [--project <folder or name>]` | Which models answered on this machine, per session, from Claude Code's transcripts: the main session's replies by model, and apart, its subagents (how each was launched, the model of each reply, the share on Opus). Default: the last 6 hours. It also shows auto mode's safety checks, which the gateway's router counted, by day, with the tokens each answer reported (below). Read only; no message text. |
| `cc-smart-dev-kit report [--hours <n> \| --days <n>] [--project <folder or name>] [--session <id>] [--json]` | What this machine's Claude Code sessions did in the window (default: the last 7 days; at most 8): per session, the time Claude Code timed for its turns, agent launches and the parallel share, the minutes blocked on permission prompts and which guard asked, the questions, the waits on background work, the idle time until the person wrote, the compactions, auto-mode's blocks by rule, and the merges that asked — then the totals, every prompt's cause, and the calls waiting on you now. Read only; no message text. A prompt's wait is an upper bound: from the tool call's line to the person's answer. `--json` prints the whole report. |
| `cc-smart-dev-kit mcp status [--json]` | Read-only: the three MCP servers cc-smart-dev-kit registers for your user, and which of them are registered by something else instead (a project's own script, say). One line each, naming what runs instead (the command and its arguments — never an `env` or a `headers`), or `--json` for a script. Exit 1 means Claude Code's own config could not be read, so "nothing is foreign" and "could not check" are never confused. The [installer](#install) asks with it before it replaces one of yours; `doctor` warns from the same facts. |
| `cc-smart-dev-kit doctor [--live]` | Checks the install, the cc-smart-dev-kit files the current project's `CLAUDE.md` imports, and the project of the folder you run it in (the list is below). Prints ✓ or ✗ for each check, `·` for information and `!` for a warning (neither is a failure), and exits with 1 when a check fails. `--live` also proves the hooks and both worktree shapes on the Claude Code installed here (below); it never runs without the flag. |
| `cc-smart-dev-kit hook <worktree-create\|worktree-remove\|subagent-stop\|notify>` | The notifier hook (below): `setup` wires `hook notify` in your user settings for agent view; it reads the hook's input on stdin and answers as Claude Code expects. The three worktree names belonged to the plugin's worktree engine, **retired in 1.0.0**: each one prints the fix on stderr and exits 2, reading nothing — `cc-smart-dev-kit project init` takes such a line out of the project's settings (§ Worktrees). |
| `cc-smart-dev-kit project init [--dry-run] [--yes] [flags]` | Sets a project up ([`project init`](#project-init)): it writes the project's `.claude/cc-smart-dev-kit.json` (the worktrees, the protected branches, the guards, and optionally the [workflow](#the-workflow) policy) and, when the base branch is not the repo's default branch, `"worktree": {"baseRef": "head"}` in `.claude/settings.json`. It asks first, showing each default, which comes from the repo (the base from `origin/HEAD`, the protected branches from git and, when `gh` is installed and answers, GitHub); every question has a flag, so a run with no terminal writes nothing unless `--yes` is given. It never commits. `cc-smart-dev-kit project init --help` lists the flags. |
| `cc-smart-dev-kit workflow [show] \| set <setting> <value> [--project] \| unset <setting> [--project] \| review-done [--sha <commit>]` | What cc-smart-dev-kit may do by itself here — commit, push, open a pull request, merge — and the switches that map onto settings which already exist ([The workflow](#the-workflow)). `show` (the default) prints each value and where it came from: the project's file, your own defaults, or the built-in default, and whether the commit here has a recorded review. `set` and `unset` write one value; `--project` writes the project's committed file. `review-done` records that a commit had its one premium review, for your own terminal: it refuses inside Claude Code, where the [review-record hook](#the-workflow) writes the record when a review agent returns. |
| `cc-smart-dev-kit session-name <session id> <name>` | Names a Claude session after its task. A session runs it itself when the project turns on `sessionNames` (below). |
| `cc-smart-dev-kit restore [--yes] [--now]` | Removes what setup added (its settings keys, the auto-mode entries it copied, the [agent view notification hook](#notifications), claude-mem's keys, its block in `CLAUDE.md`, the instructions' copy, the [tmux line](#notifications) it added, and a stored `--no-instructions` choice) and keeps everything else. A key setup set and you changed since is yours: it stays. The plugins and marketplaces setup added stay installed: remove them with `claude plugin uninstall` and `claude plugin marketplace remove`. The launcher goes back to how it was before setup first changed it, or is removed when setup created it. With the gateway installed and on, it runs in **two stages**, because running Claude sessions still send every request to the router: the first restore removes everything but the router (the gateway's env keys too, and the launcher when setup created it — so `cc-smart-dev-kit` may be off your PATH then, and the line it prints is the `bun --no-env-file --config=… …/dist/cli.js restore` form of [Install](#install) step 3, with the bun running the restore, its own absolute path, and your installed version) and says to restart every running session; the second disables and stops the router and its socket (it asks, because that cuts answers in flight; `--yes` skips the question), waits up to 15 s for its port to close (not for its answers in flight, which finish in the background; and not at all when the unit was not running or another program answers on the port: it says so), and removes its copy, its units and its limit state (`~/.local/state/cc-smart-dev-kit/gateway-state.json`). `--now` does both at once, after a warning that every running session fails until it restarts (asked, or `--yes`). It keeps `gateway.json`, which holds your key. Some of cc-smart-dev-kit's own state stays too, and restore never removes the state folder `~/.claude/cc-smart-dev-kit/` itself, or a folder outside it. Still there afterwards: the backups a later restore or a hand-undo reads, the records (now empty), the running sessions' and the background update's bookkeeping, and the live-check record. The heavy-job queue's folder `~/.local/share/cc-smart-dev-kit/jobs/` stays as it is, with its `leases/` and `tickets/` folders (empty once no job runs). A restore with nothing left changes nothing. |
| `cc-smart-dev-kit update [--check \| --hold \| --resume]` | Installs a newer cc-smart-dev-kit now, showing each step: `claude plugin marketplace update cc-smart-dev-kit`, then `claude plugin update cc-smart-dev-kit@cc-smart-dev-kit --scope user` when there is a newer version. `--check` only says whether a newer version exists (it reads the remote's version without changing anything). `--hold` stops the background update on this machine; `--resume` starts it again. Both answer at once (no lock); while a check runs, they say "A check is running now; it finishes." Nothing restarts: restart Claude sessions to load the new version. |
| `cc-smart-dev-kit gateway <command>` | The optional AI gateway (below). |
| `cc-smart-dev-kit browser mcp` | Starts the Playwright MCP server on **your own Google Chrome**, through the Playwright extension, in the profile `claude-code` ([The browser](#the-browser)). `setup` registers it as the `playwright` MCP server; you do not run it by hand. **It refuses to start without the token**: without one the extension would ask you to approve every connection. |
| `cc-smart-dev-kit browser setup [--dry-run]` | Finds Chrome, opens the Playwright extension's Web Store page in the `claude-code` profile (Chrome makes that profile on that launch, if it is not there yet), pre-registers the extension for your user on macOS and Windows, and prints the steps that are left for you. It never installs or removes an extension, and never deletes a profile. `--dry-run` prints the same lines and runs and writes nothing. |
| `cc-smart-dev-kit browser token [--clear]` | Saves the token the extension's status page shows — paste the whole line (its Copy button copies `PLAYWRIGHT_MCP_EXTENSION_TOKEN=…`), and it is not echoed while you type. It is written to `~/.config/cc-smart-dev-kit/playwright-extension.token` (mode 600 on Linux and macOS; on Windows your profile's own permissions keep it yours), and is never printed again. `--clear` removes it. |
| `cc-smart-dev-kit browser check` | Proves the browser end to end on your own Chrome: a real connection with **no approval page**, a `file://` page (which needs "Allow access to file URLs"), screenshots (one the server names, one a caller names), an upload, a download, and `browser_close`. Exit 0 when every check passed. It opens that Chrome window once, and the tabs of its connection stay behind. |
| `cc-smart-dev-kit sessions [--open] [--dry-run]` | This project's Claude Code sessions of the last two days, by name and worktree, with the command that resumes each ([Sessions](#sessions)). With Warp installed it also saves a Warp tab for each. `--open` reopens every session that was open when the machine went down or its window closed (Warp tabs, or a terminal window each: XFCE Terminal on Linux, Windows Terminal on Windows); `--dry-run` says what it would open and opens nothing. |
| `cc-smart-dev-kit worktrees [--clean] [--remove <path>] [--no-fetch]` | Every worktree of this repo: who works in it, and which are finished ([Worktrees](#worktrees)). `--clean` removes the finished ones with their branches; `--remove <path>` removes one now, for the session that has just finished in it, so without the one-hour wait; `--no-fetch` judges against `origin/<base>` as it is. `--clean` and `--remove` run in the main checkout only, one at a time. |
| `cc-smart-dev-kit omniroute <status\|update\|rollback>` | The OmniRoute behind the gateway's affordable slots (below): what is installed, the newest npm release at least three days old, the user unit that runs it, and the backend that talks to it. `update` installs the newest such release, restarts its unit, checks the model path, and puts the old version back when the new one does not answer. `rollback` installs the version the last update replaced. `update` and `rollback` refuse to run inside a Claude Code session, and are never in the background. |
| `cc-smart-dev-kit portal [--port <port>] [--no-open]` | The local portal (below): a page on this machine to see and change the gateway's settings, the updates, the heavy-job queue, the companions and the OmniRoute. It binds `127.0.0.1` only, prints a link with a one-time token, and stops after 30 minutes with no request. It refuses to run inside a Claude Code session: the portal is for you, not for Claude. |
| `cc-smart-dev-kit search "<query>" [--max <n>] [--json]`<br>`cc-smart-dev-kit search --fetch <url> [--json]` | Searches the web through the gateway's OmniRoute backend (Ollama's web search among its providers), or reads one page's text with `--fetch`. Prints each result's title, its URL and a short snippet. `--max` asks for 1 to 50 results. The query, or the URL, goes to that search or fetch provider on the internet; `--fetch` refuses a local or private address. Needs the gateway set up (below). |
| `cc-smart-dev-kit job <command>` | The machine-wide queue for heavy jobs (below). |
| `cc-smart-dev-kit worker lead [--plan <slug>] [--tag <tag>]` | Records the Claude Code session that runs it (from its own Bash tool) as the lead of a plan in this repository, named `LEAD <tag> <plan>`. The tag is `--tag`, else [`workers.tag`](#the-workflow), else the main checkout's folder name; the plan is `--plan`, else the plan this session already leads, else the branch. It prints the `/rename` line that shows the name now. Refused outside a Claude Code session, in a worker, in a session in bypass mode, and while workers are off ([`workers.enabled`](#the-workflow)). |
| `cc-smart-dev-kit worker start <phase> --slug <slug> --kind <kind> --brief <file\|-> [--base <ref>] [--files <glob,…>] [--model <model>] [--effort <effort>] [--waits-for <phase,…>]` | Starts one worker for a lead: a background Claude Code session named `W <tag> <phase> <slug>`, in its own worktree `.claude/worktrees/wk-<phase>-<slug>` on the branch `wk/<phase>-<slug>`, cut from `--base` or the lead's branch. **It returns at once** with one line: `started` (with the session's short id, the model and effort, the branch and its base commit), `queued` (and why: the phases it waits for, [`workers.max`](#the-workflow) or `workers.maxOpus` reached, or too little free memory — the lead's watch starts it later), or `failed` (and why). The kind gives the model and effort (`build`, `docs`, `tests` on sonnet; `security`, `money`, `permissions`, `schema`, `deploy`, `architecture`, `ui` on opus at `xhigh`); `--model`/`--effort` override them, judged by the agent guard's rules, and one the guard would ask you about (opus at `max`, Fable) is refused: start that session yourself. The brief (`-`: stdin) is saved with a fixed frame: commit on your branch and never push (the lead handles git), how to hand back, and how to ask the lead a question — a worker never asks you. Run `worker lead` in the session first. A repository you never opened with `claude` is refused ("Workspace not trusted"): open it once and accept the trust prompt. |
| `cc-smart-dev-kit migrate [--dry-run] [--yes]` | Moves a machine that still has the plugin's old `anymodel` names ([Moving from anymodel](#moving-from-anymodel)). It reads and checks everything, asks every question, and writes nothing before they are answered: a "no" leaves the machine as it was. Then it prints its steps and walks them; a step that fails keeps what the steps before it did, and the next run goes on from there. `--dry-run` prints that plan and writes, runs and stops nothing. `--yes` answers the router question without asking; the old plugin is uninstalled only after a yes on a terminal, and only when it is still installed. Refuses to run inside a Claude Code session: it replaces the router that session's own model traffic goes through. On a 0.2.x machine the command does not exist yet: run the plugin's `dist/cli.js` with bun (the section above has the line). |
| `cc-smart-dev-kit version` | Prints the version. |

**Help on one command:** `cc-smart-dev-kit help <command>`, or `<command> --help` — for a
subcommand too, as in `cc-smart-dev-kit gateway setup --help`. Either prints that command's own
help and runs nothing. Run `cc-smart-dev-kit` alone for the short list: the commands to start
with, two examples, and the names of the rest. A wrong command or option prints one line and the
`--help` line that explains it. `cc-smart-dev-kit help` with no command prints the same short
list.

### The background update

Claude Code's own plugin auto-update can fail to run (anthropics/claude-code#61854), so
cc-smart-dev-kit updates itself. When a Claude session starts, its hook checks, **at most once an
hour**, in the background, and never makes the session wait or prints anything:

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

**A major version waits for you.** A patch or a minor version installs by itself. A new
major version (the first number grows: 0.6.0 → 1.0.0, 1.4.2 → 2.0.0) does not, because it
may need work in your projects first: 1.0.0 refuses the retired worktree fields. The check
refreshes the marketplace, installs nothing, and records "skipped: 1.0.0 is a major version
(…): it waits for `cc-smart-dev-kit update`". Until you install it, each interactive session
start shows one line:

```text
cc-smart-dev-kit 1.0.0 is ready: it is a major version (it refuses old project fields). Read What's new, then run `cc-smart-dev-kit update`.
```

It is shown when a session starts or resumes, not on a `/clear` or a compaction of the same
session, and never in a `claude -p` run. The words in brackets come from the new version
itself (`src/update/major-notes.json` in its marketplace copy); without them the line has
none. `cc-smart-dev-kit update` is your yes: it first lists every repo your saved Claude
sessions worked in that still carries a retired worktree field (`worktrees.prefix`, `setup`,
`engine`) or an engine hook line (`cc-smart-dev-kit hook worktree-create`, …) in
`.claude/settings.json` or `.claude/settings.local.json`, one `!` line each with its fix:

```text
! ~/Code/my-app still has worktrees.prefix in .claude/cc-smart-dev-kit.json, retired in 1.0.0: cd /home/user/Code/my-app && cc-smart-dev-kit project init
```

Then it installs the new version, and the line goes. `cc-smart-dev-kit setup` lists the same
repos on every run. Both only read those repos; `project init`, run in each, makes the change
(a repo whose `cc-smart-dev-kit.json` is not valid JSON is listed with the error). `update
--check` says when the newer version is a major one. `update --hold` still wins: while it
holds, nothing is checked and no line is shown. Versions before 1.0.0 do not have this rule:
their background check installs 1.0.0 within the hour, like any other version.

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
  credentials. When it cannot, the ✗ names the cause when git's own words say it — ssh to
  GitHub was refused (add the marketplace over HTTPS instead), or the GitHub account cannot
  read the repository (ask its owner for read access, then accept the invitation) — and keeps
  its old line for anything else;
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
  lets the extension open `file://` pages, and the extension's token is saved. A ✗ names the
  command or the click that fixes it; without the token nothing runs at all
  ([The browser](#the-browser)). Whether the `playwright` server is registered and starts is the
  MCP servers' own line, just below;
- the MCP servers setup registers (the `playwright` browser, `sequential-thinking`,
  `tavily-websearch`): each is registered at user scope and starts
  (`claude mcp get`, which starts it once). ✗ when one is missing ("Run: cc-smart-dev-kit setup")
  or when another copy of it wins — a project's `.mcp.json`, or the local scope — naming
  what to remove. Without a Tavily key its server is skipped, as a `·` line that names the
  key file: a person who never wanted web search loses nothing. A key is never printed;
- what an older setup left for Serena ([0.6.0](#060-serena-is-removed)): one ✗ line while
  setup still has to take back the `serena` registration it made, its context file or the
  `serena-root` records ("Run: cc-smart-dev-kit setup"), and nothing once it has. A `serena`
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
- agent view's notification hook: the user-level `Notification` hook setup writes into
  `~/.claude/settings.json` (matcher `agent_needs_input|agent_completed`). A ✗ says it is
  missing or runs something else, with "Run: cc-smart-dev-kit setup" (§ Notifications);
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

**The [one command](#install) does the move.** It adds the marketplaces, installs this
version, runs `migrate` (which decides by itself what to move, and says "Nothing to move."
on a machine without the old names), then runs `setup` — and asks about the old plugin if it
is still installed. Run it in your own terminal: `migrate` refuses inside a Claude Code
session, because it replaces the router that session's own model traffic goes through, and
it says to restart your sessions afterwards.

**Name the marketplace in the install line** either way. While the old `anymodel` marketplace
is added, a bare `claude plugin install cc-smart-dev-kit` installs the copy that comes from
`anymodel` (`cc-smart-dev-kit@anymodel`), and removing that marketplace later takes its copy
with it: `cc-smart-dev-kit@cc-smart-dev-kit` is the one to install. The one command does that
itself.

By hand: the `cc-smart-dev-kit` command does not exist on your machine yet — the old launcher
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

Add the marketplace by its **new** name, as the first line does. Adding it makes a SECOND
marketplace: it does **not** reuse the one already added from the same source. **Proved live**
(Claude Code 2.1.301, 2026-10-16) on a machine that had the old marketplace added — the source
`<owner>/anymodel` — where `claude plugin marketplace add <owner>/cc-smart-dev-kit` cloned the
repo and added a marketplace named `cc-smart-dev-kit` (`✔ Successfully added marketplace:
cc-smart-dev-kit (declared in user settings)`), and `claude plugin marketplace list` then
showed both. So "a marketplace is already added" means a marketplace with that **name**, which
is the key `known_marketplaces.json` uses — and the old `anymodel` marketplace stays added,
with its plugins, until the end of the move: `migrate`'s last step uninstalls the old plugin
and removes the old marketplace (it asks first), and the two commands near the end of this
section are the by-hand way. Removing a marketplace also uninstalls the plugins installed from
it (`docs/claude-code-contract.md` § Install and update), which is why the old one goes last.

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
over (the proof's own text changed with the name), so a judge needs its test
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
  `"$HOME/.local/bin/cc-smart-dev-kit" hook <name>` (`cc-smart-dev-kit hook` prints the lines).

## The AI gateway (optional)

A local router, `cc-smart-dev-kit-router`, sends each Claude model's work to the models you
choose: one slot per model family (scout = Haiku, worker = Sonnet, opus, fable) and one for auto
mode's safety checks (judge). A slot with no chain is off — that model is plain Claude, on your
own login. A fresh setup gives no slot a chain: the plugin picks no model for you. No prompt text
is ever changed. The service that keeps the
router running is a systemd user unit on Linux and a per-user Scheduled Task on Windows
(see [Windows](#windows)); macOS has neither, and `gateway setup` refuses there.
How it works: [docs/gateway.md](docs/gateway.md).

| Command | What it does |
|---|---|
| `cc-smart-dev-kit gateway check` | One read-only question, for scripts (the installer asks it): does the gateway have an OmniRoute key the backend accepts? Exit 0 yes, 1 no key yet (OmniRoute answers, so one can be made), 3 it could not be judged (nothing answers, or the config cannot be read), 4 the key is one OmniRoute refuses. It asks the backend only — never the router's port — and prints one line saying what it found. |
| `cc-smart-dev-kit gateway setup [--yes] [--backend-key-stdin <backend> \| --omniroute-password[-stdin] \| --no-backend-key] [--save-unchecked]` | Makes `~/.config/cc-smart-dev-kit/gateway.json` (mode 600; the key on stdin, never argv), copies the router to `~/.local/share/cc-smart-dev-kit/router.js`, writes the systemd user units `cc-smart-dev-kit-router.socket` (it holds the port) and `cc-smart-dev-kit-router.service`, starts them, and waits up to 5 s for the router to answer. First of all it asks the router's port: when another program holds it (an older router, say), it stops and writes nothing. When the router runs and the copy or a unit changed, it says what the restart does and asks; `--yes` skips the question. A restart lets the answers in flight finish (up to 120 s; an answer still running then is cut, and Claude Code retries it), and new requests wait in the socket meanwhile, so none of them fails. A connection that sends nothing is closed half a second after the restart starts, so it cannot hold the restart. The exceptions are the restarts that must open the socket again (the first setup that moves a router from an older version to its socket, a socket that was stopped, a changed socket unit or port): until the old router has finished its answers, new requests fail, and setup's warning names which case it is. When the socket cannot open at all, setup says so and starts the router without it (the router binds the port itself). A router that fails to start 5 times within 60 s is given up: systemd then closes its socket too, so requests are refused at once instead of waiting; `doctor` names it, and `gateway setup` starts both again. A setup that stopped half way is finished by the next one. In Claude Code's settings it does one thing only: it takes out the model keys 0.4.3's `gateway on` wrote (`ANTHROPIC_DEFAULT_HAIKU_MODEL` / `…_SONNET_MODEL` and their `…_NAME` / `…_DESCRIPTION`), where cc-smart-dev-kit still owns them; then restart every open Claude session. In `gateway.json` it drops the `claude-sonnet-5-5` 0.4.x put at the end of a scout or worker chain that is still that exact default. |
| `cc-smart-dev-kit gateway status` | Router health, each backend, the slots, and whether Claude Code points at the gateway. Keys are masked. |
| `cc-smart-dev-kit gateway models` | Every model each backend offers, and the slots. |
| `cc-smart-dev-kit gateway slot <scout\|worker\|opus\|fable> <target>[,<target>…]` | A slot's chain (any targets, any order, from `gateway models`); live. `slot <slot> off`: that model is plain Claude again. |
| `cc-smart-dev-kit gateway slot judge <target>[,<target>…]` | Your own judge for auto mode: its first tested target judges every check in Claude's place. Each target must first block a test force push to `main`. A weak judge can let a risky command through, and it reads the conversation. `slot judge off`: Claude judges. |
| `cc-smart-dev-kit gateway fallback <slot> on\|off` | May the next target answer when the one before it fails or rests? On by default for scout and worker, off for opus, fable and judge. Off: only the first answers, the rest stay saved. |
| `cc-smart-dev-kit gateway on` | Points Claude Code at the router: sets its env keys in your `settings.json` as keys cc-smart-dev-kit owns. A gateway key someone else set stops it; nothing is overwritten. Every running session switches on save. |
| `cc-smart-dev-kit gateway off` | Removes exactly the keys `on` set. Restart the sessions afterwards. |
| `cc-smart-dev-kit gateway serve` | Runs the router in the terminal. |

### First setup

1. Run OmniRoute on this machine at `http://127.0.0.1:20128`: setup writes that address
   for the `omniroute` backend. Give it a connection to a provider (Ollama Cloud, say).
   OmniRoute somewhere else: after setup, change `backends.omniroute.baseUrl` in
   `~/.config/cc-smart-dev-kit/gateway.json`.
2. **The key: let setup make one, or give it one you have.** `setup` can log in to OmniRoute
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
3. **The key is tested before it is saved.** setup makes one cheap authenticated request to the
   backend (`GET /v1/models`, a 5-second timeout):
   - **HTTP 401 or 403: refused.** Nothing is saved, the key already in the file stays, and the
     line says which key that backend wants — for `omniroute`, an **OmniRoute API key** (made in
     OmniRoute's own dashboard, its API keys page), the one the router itself uses, **not** a
     provider key such as an Ollama Cloud one.
   - **Anything else (unreachable, a 5xx): not refused, but not saved silently either.** setup
     says it could not be checked and saves nothing unless you add `--save-unchecked`, which
     saves it with a WARN line naming `cc-smart-dev-kit gateway check` for later.
   - **A key that replaces one in the file is backed up first**: the whole file as it was, in
     `~/.claude/cc-smart-dev-kit/backups/<the file's path, encoded>/gateway.json.bak-cc-smart-dev-kit-<stamp>`
     (the state folder, never beside the config — a backup beside it would sit in `~/.config`
     with a key in it). The line after the change says which folder. This is a plain backup, not
     a managed change: `restore` leaves `gateway.json` alone on purpose (it holds your key), so
     copy the file back by hand if you want the old key.
4. `cc-smart-dev-kit gateway status`, then `cc-smart-dev-kit gateway on`. Every slot is off
   until you give it a chain: `cc-smart-dev-kit gateway models` lists what each backend
   offers, then `cc-smart-dev-kit gateway slot <slot> <target>[,…]` sets one — with nothing
   set, every model is plain Claude on your own login. To check the key alone (read-only, no
   restart): `cc-smart-dev-kit gateway check`.

Auto mode's safety checks are judged by Claude unless you give the judge slot a chain, and a
judge set before 0.5.0 must be tested and set again
(`cc-smart-dev-kit gateway slot judge <target>[,…]`). A more affordable judge can block good
work, and a weak one can let a risky command through, so `slot judge` first tests each target on
one obvious case and refuses a target that lets it run. The router
recognises the check by its prompt. If Claude Code rewords that prompt, the check is
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
- **The status line.** `cc-smart-dev-kit setup --statusline` sets Claude Code's status line to
  `cc-smart-dev-kit statusline`. It shows your 5-hour and 7-day plan usage, warns from 85 %, and
  shows any fallback in use.
- **`cc-smart-dev-kit usage`** reads Claude Code's own transcripts and shows, per session, the
  main session's replies by model and, apart, its subagents: how each was launched, which
  model wrote each reply, and the share on Opus. It also lists the Opus and Fable launches
  the `agent-guard` hook let run, with why: an Opus launch by its effort, or its
  `Opus reason:` word when it gave one, and a Fable launch by its `Fable reason:` word — an
  Opus or Fable agent spends your own plan usage.
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
| **Overview** | The plan limits the router saw and the slots answering from a fallback; every slot's chain; the three switches (the gateway, your own judge, the opus and fable slots); the latest warnings. |
| **Slots** | A chain per slot, built from the backends' live model lists, and a Fallback switch per slot — rows after the first read "kept, not used" while it is off. **Test each target** — one tiny chat to each affordable model, and the force-push test for a judge — then **Save**, after a confirmation that every running Claude session uses it from its next request. Save is held off for the **judge** slot until every backend target has blocked the force-push test; the command line's own rule, said in the judge note. |
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
a browser counts as the same site — cannot load the portal's pages or files into its own; the
one-time token in the link is exchanged on the first load
for an `HttpOnly`, `SameSite=Strict` session cookie whose name carries the portal's own port
(`ccsdk_portal_<port>` — a cookie has no port, and a browser sends every `127.0.0.1` cookie to
every port on it, so two portals on two ports hold their own sessions), and the URL is cleaned;
a change (a POST) must carry an `Origin` of ours **and** the CSRF token that came with the
page. A GET that is the person's own but holds no session (a link already used, a cookie from
a portal that stopped) gets the page that says so, in 403, and it holds no fact about the
machine; a `Host` or `Origin` that is not ours stays the one word, "Forbidden". A strict
`Content-Security-Policy` allows no inline script and nothing from the internet — no web
font, no CDN. A backend key never reaches the page: it shows as `••••a1b2`, its last four
characters and nothing else (`maskKey`); a backend's address is shown, and linked, without a
user name, password, query or fragment; and a backend's own error text is masked before a page
or an answer holds it (a backend can echo the key it was sent). And the portal
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

**3 agents** (`cc-smart-dev-kit:<name>`; the caller passes the model and effort on each launch, so
none is pinned in their files). `reviewer` and `rules-maintainer` load the skill they work by
(`review`, `self-evolve`) at start, through their `skills:` field:

| Agent | Job | Needs |
|---|---|---|
| `reviewer` | The read-only second opinion on a change set. | — (uses claude-mem's `smart_outline`, `smart_search` and `smart_unfold` when they are there and answer; else Grep and Read) |
| `rules-maintainer` | Edits to instruction files, with a duplicate and conflict check. | — |
| `ui-verifier` | Drives the running app in a browser and measures. | the **Playwright** MCP server |

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
- **The scout has no affordable first target any more** (removed, or it starts with Claude)
  while claude-mem still holds setup's keys: setup says so, and how to fix it (run setup
  again once the scout starts with one, or `restore`).
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
`.claude/cc-smart-dev-kit.json`**; the ones that are about your machine, not a project —
`agent-guard`, `fable-session`, `notify` and `playwright-output` — run there too (§ Notifications below). The plugin ships no worktree hook:
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
| `git-guard` | before a Bash or PowerShell command | Asks you before a force-push, a push to a protected branch (`protectedBranches`), `push --all` / `--mirror`, a branch deleted on the remote (`git push origin :x`, `--delete`), `reset --hard`, `clean -f`, `worktree remove -f`, a checkout or restore that throws changes away, `branch -D`, `stash clear` and an unnamed `stash drop` (they throw work away), and (with `worktrees`) a bare `git stash` or `stash pop`: every worktree shares one stash. Text in quotes, here-docs and comments is not a command; a shell keyword, a wrapper (`timeout 60 git push -f`, `sudo -u me …`), a here-doc fed to `sh`, and the text piped into `sh` are read through. Git's own abbreviations count (`--forc` is `--force`). Not read: a git alias (`-c alias.x=…`, or one of your own), `branch -f`, `checkout -B`, `switch -C`, `ssh`, a script file, and a branch it cannot name. |
| `main-folder-guard` | before Edit, Write, NotebookEdit | With `worktrees.guardMainFolder`: refuses an edit of a file in the main checkout itself, and says how to get into a worktree. |
| `playwright-output` | before every `mcp__playwright__*` call | Puts a screenshot or snapshot the caller names by a relative `filename` into the browser's output folder instead of the folder the session runs in (`@playwright/mcp` resolves a caller-named file against the process's own folder). |
| `merge-guard` | before a Bash or PowerShell command | Asks you before a command that merges a pull request. The forms it reads: `gh pr merge` (`gh pr -R owner/repo merge 5` included), `--auto` (an armed merge lands once the checks pass, with nobody watching), a `gh alias` that expands to one (read from `gh alias list`), and — asking whatever the policy says — a `gh api` call to the pull-request merge endpoint (`repos/o/r/pulls/5/merge`, any method spelling) or a GraphQL query that names `mergePullRequest` / `enablePullRequestAutoMerge`. **Every merge in the command is judged**: `gh pr merge 5 && gh pr merge 6` checks both, and the first it does not allow asks, naming that pull request. It reads three facts, read-only: the pull request (`gh pr view`), the repository's default branch (`gh repo view`), and its required checks (`gh pr checks --required`; a skipped one counts as passing, GitHub's own rule). It lets a merge through with no question only when `autoMerge` is on, the pull request's base is the project's integration base, every required check passed, and — with `reviewBeforePush` on — the head commit has a [recorded review](#the-workflow) by an agent `reviewAgents` names, or by you. **It reads that policy as committed on the pull request's base** (`origin/<base>`, as last fetched), never from a checkout's own copy of `.claude/cc-smart-dev-kit.json`: a session cannot switch the gate off by editing its worktree's file. No such ref, no file there, or a file it cannot use asks you. Every other case asks you, with the reason it asks; so does a merge that names a repository other than this project's own (`--repo`/`-R`: the policy covers this repository only), one whose earlier steps change the folder, branch or repository it acts on (`cd`, `git switch`, `GH_REPO=…`, `env`), and a `gh` that is missing, fails, or answers something it cannot read. A merge with `--admin` (any value) always asks, whatever the policy says, naming the pull request: `--admin` merges past the repository's branch protection — its required reviews (a code-owner approval among them), its required checks and its merge queue — so you decide each one. It asks rather than refuses, because a release may use `--admin` on purpose. In a project without `.claude/cc-smart-dev-kit.json` it stays silent, like every project hook. |
| `message-guard` | before SendMessage | Refuses a message to a session that works outside this repo (ListAgents lists every session on the machine). |
| `agent-guard` | before an Agent launch, and after it for the record | **Machine-wide** (it runs with or without `.claude/cc-smart-dev-kit.json`): it resolves the model the launch really runs on and holds the model rules. **It judges the model and effort Claude Code really gives the launch, after Claude Code's own overrides**, read from the hook's environment (a settings file's `env` reaches it there too): `CLAUDE_CODE_SUBAGENT_MODEL_FORCE` (on as `1`, `true`, `yes` or `on`) puts every launch on `CLAUDE_CODE_SUBAGENT_MODEL`, or on the session's own model when that is unset or `inherit` (one the guard cannot read counts as the `opus` tier); next, `CLAUDE_CODE_WORKFLOW_SUBAGENT_MODEL` puts every Workflow `agent()` on its model (never an Agent call); next, the call's own `model` — a plain `CLAUDE_CODE_SUBAGENT_MODEL` never beats it. `CLAUDE_CODE_EFFORT_LEVEL` sets the effort of every launch, whatever the call names. Under FORCE or `CLAUDE_CODE_EFFORT_LEVEL`, Claude Code takes `model` or `effort` off the Agent tool, so such a call names neither and is judged on what the variable sets, never refused for it; an ask or a refusal names the variable ("This launch runs on `haiku` because `CLAUDE_CODE_SUBAGENT_MODEL_FORCE` is set …"). `CLAUDE_CODE_EFFORT_LEVEL=auto` (the model picks its own default, never `max`) is your own choice, like a fork's effort: allowed on Claude Sonnet and Haiku, allowed with no question on the `opus` tier, and the `fable` tier's reason-line rules as always. A `CLAUDE_CODE_EFFORT_LEVEL` no subagent may run at (`low`), or anything but `max` (`auto` included) on an affordable slot, refuses every launch until you change or remove the variable, and the message says so. A fork keeps its own rule (below), and the record names the model the launch really ran on. Without an override, a launch with no `model` or no `effort` is refused (it would inherit the session's, which nobody chose); `effort` `low` is refused on every model, a Claude model and an affordable slot alike (a subagent runs at `medium`, `high`, `xhigh` or `max` only); an affordable gateway slot needs `effort: "max"`: a slot key, a `<backend>:<model>` target, or `haiku` / `sonnet` (or their ids) while the gateway is on and that family's slot (scout, worker) has a chain whose first target is a backend, read from `gateway.json`; with no chain, or one that starts with a `claude-…` model, the launch is Claude — a name no rule knows (`best`, `opusplan`, `default`, …) is the `opus` tier without a proved family, so it asks you at every effort (refused in `claude -p`): it may stand for a higher tier; **`opus` and `fable` mean the TIER, whatever model answers behind them** — an override, or the opus or fable slot's chain, that points one at another vendor keeps the tier's rules, is never affordable and never forced to `max`, and the question names both (`` `opus` (answered by openai:gpt-5.5) ``); a name never runs below the tier of what answers it — `sonnet` whose override or worker chain is a Claude Opus id is the `opus` tier; **a launch read as Opus (the `opus` name, a Claude Opus id, the opus slot) runs with no question at `medium`, `high` or `xhigh`** — any agent, any purpose, review or not, no reason line needed — and **asks you at `max`**, naming the model and the effort (in `claude -p`, with nobody to answer, a `max` launch is refused and the message says to run it at `medium`, `high` or `xhigh`, or in an interactive session); an `Opus reason: <word>` line is optional, and only names the purpose in the record; a fork runs at the session's own effort, which you chose, so an `opus`-tier fork is allowed; on the `fable` tier a read-only agent (Plan, Reviewer, Explore) with a `Fable reason: <word> - <why>` line (punctuation after the word is fine) asks you — `build` is the builder's own word, refused there — and an agent that can change files — a builder, or a fork — asks with `Fable reason: build - <what you asked for>`. A fork always runs on the session's model and effort (Claude Code ignores a `model` a fork is given) and needs no `model`; an unknown session model counts as the `opus` tier. A **Workflow** call is judged the same way, from the `agent(...)` options in its script — a launch whose `model` is built at run time is refused, never guessed, and a script that hands `agent` around (`const run = agent; run(…)`, `agent?.(…)`) or builds a call's options at run time (a `...spread`, a computed key) is refused whole — because (proved live) a workflow's agents run inside the tool and pass no hook of their own; a deny refuses the whole call, so none of its launches is recorded, and an ask names every launch that asks. Every premium-tier launch is recorded once it is known to run — an allowed one before the call, an asked one after it ran (you said yes); one you refuse never — and `cc-smart-dev-kit usage` lists them with why: for the `opus` tier its effort, or its `Opus reason:` word when the prompt has one; for the `fable` tier its `Fable reason:` word. |
| `fable-session` | a session starts; a model switch; each answer ends | **Machine-wide**: when the session's own model is the `fable` tier — Claude Fable, or a model an override points that tier at — it shows *you* one line, once a session: the premium tier uses your plan's limits faster than Opus, so switch with `/model` if you did not mean to. Nothing goes to Claude, never an error and never a block. A session start judges only the `model` the start names; a switch judges `to_model` — the model the session moved TO — so the line appears AT the switch; a finished answer is judged by the model that answered it, which is the catch-all for a Claude Code that fires no `PostModelSwitch`, and can never fire for a model the session has already left (the old `UserPromptSubmit` read was one turn behind: it missed the switch to Fable and warned after the switch back). The line was seen live on a real session (2026-10-17); that `systemMessage` shows on `PostModelSwitch` and `Stop` is not proved yet (the contract's § Relied on, not proved yet). |
| `job-route` | before a Bash command | With `"jobs": { "route": true }`: a heavy command (the project's own [kinds](docs/jobs.md#kinds)) is sent through the machine's queue — rewritten to `cc-smart-dev-kit job run --kind <kind> -- <command>`, byte for byte the same command. A command already inside `cc-smart-dev-kit job run` is left as it is. |
| `after-merge` | after a pull-request merge | With `worktrees`: the steps to clear the worktree that was merged, and, for a merge into `worktrees.base`, the message to send the other sessions of the repo. Noted forms: `gh pr merge`, `gh pr -R owner/repo merge 5`, a `gh api` merge whose path names the pull request, and a `gh` alias that expands to one ([The hooks](#the-hooks) has the guard's row). A form that names no pull request — a shell alias, a GraphQL merge, a runner such as `xargs` — gets no note. |
| `review-record` | when a subagent starts, and when it finishes | When the agent is one `reviewAgents` lists (the plugin's reviewer by default): notes the commit the session's working folder is on at its start, and its branch, and records that start commit on that branch at its end: commits made while it read count as change after the review. It is the record the merge guard reads for a merge it would make with no person watching ([The review record](#the-workflow)). It writes nothing for an agent that stopped inside its own worktree. |
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
- **Nothing here is a second browser.** The plugin starts no Chrome of its own, keeps no profile of
  its own and never deletes one. The single thing it may write inside Chrome's own folder is the
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
12. **Uploads from the output folder**: the MCP now runs in the output folder, so a relative
    upload path is read from there. Check that `browser check`'s upload (a full path) still
    passes, and that a session that names a file relative to its project gets a clear error.
13. **A profile Chrome's own dialog made** (`Profile 2`, named `claude-code` in Chrome): the MCP
    is told `--profile-dir-name=Profile 2` and must connect to that profile.
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
  prints the fix and exits 2, so Claude Code cannot make a worktree while the
  WorktreeCreate line is there. `project init` takes exactly those lines out — every other hook
  in the same list stays — and `doctor` names each file that still has one.
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

A session's own worktree is normally cleared by the session. The after-merge note, right
after its branch's pull request merged, says `ExitWorktree` with action `remove`. Claude Code
checks a worktree under `.claude/worktrees/` itself; for one outside it, the note says to check
`git status --porcelain` and `git log @{u}..` first, and only then to pass `discard_changes
true`. When `ExitWorktree` cannot, it says `cc-smart-dev-kit worktrees --remove <path>`, which
removes the folder and the branch only when the worktree is finished. The SessionStart note, when finished worktrees are left behind, points at
`cc-smart-dev-kit worktrees --clean`.

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
and the protected branches from the default branch and the base plus, when `gh` is installed
and answers, the branches GitHub protects (a read-only `gh api`; anything missing is skipped
quietly). Then it prints the file it will write with the changes line by line, the lines it
adds to (`+`) or takes out of (`-`) each settings file, and writes them — a backup first, in
`~/.claude/cc-smart-dev-kit/backups/`. **Nothing is committed:** commit the two files with the
project (`.claude/settings.local.json` is your own, and stays uncommitted).

Every question has a flag, so it also runs without a terminal:

```sh
cc-smart-dev-kit project init --base dev --bases "hotfix/=main,release/=main" \
  --protected "main,dev" --guard-main-folder --session-names --workflow "openPr=draft"
```

`cc-smart-dev-kit project init --help` lists them all; each yes/no question has a `--no-` flag
too (`--no-guard-main-folder`, `--no-session-names`, `--no-job-route`), so a run with no
terminal can answer either way. With no terminal it writes nothing unless
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
workers.enabled = true (personal)
workers.tag = (the main checkout's folder name) (default)
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
| `autoPush` | `false` | Push the session's own branch. Never a protected branch: the git guard still asks there. |
| `openPr` | `"off"` | Open a pull request for the branch: `"off"`, `"draft"` or `"ready"`. |
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
| `workers.enabled` | `false` | Lead and worker sessions may run here: a lead starts background workers for its plan's phases. Off: a lead uses subagents only. Set it in your own file for every project, or in a project's file for that one. |
| `workers.idleStopMinutes` | `10` | Minutes a blocked worker waits before its session is stopped; an answer brings it back. |
| `workers.max` | `6` | At most this many workers run on this machine at once, across every lead. A worker past the cap waits in the queue (`worker start` still returns at once). |
| `workers.maxOpus` | `2` | At most this many of them on the opus tier: the opus kinds, or a worker moved onto opus with `--model`. An opus worker past it waits in the queue; a sonnet worker still starts. |
| `workers.memoryGb` | `2` | The free memory, in GB, a new worker needs; below it, the worker waits in the queue. |
| `workers.quietMinutes` | `20` | Minutes a working worker may write nothing before the lead hears it is quiet (an alert only). |
| `workers.handoffPercent` | `70` | The share of its context, in percent (1–100), at which a worker hands off to a next one. |
| `workers.softHours` | `2` | Hours after which the lead gets a note about a worker still running. |
| `workers.maxHours` | `4` | Hours after which a worker hands off. |
| `workers.tag` | the main checkout's folder name | The word that names the repository in every lead's and worker's session name (`LEAD <tag> <plan>`, `W <tag> <phase> <slug>`): 1–12 ASCII letters, digits, `.`, `_` and `-`, a letter or a digit at each end. |

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
| `autoMerge` (with `mergeMethod`, `deleteBranch`) | the **merge guard hook**, which asks you before a merge its rules do not allow — every merge form it reads, in this repository only, and every merge with `--admin` (§ The hooks). |
| `reviewBeforePush` | both: the **review-record hook** writes the record when the review agent finishes (§ below), and the merge guard asks about a merge whose head commit has no record. |
| `reviewAgents` | both: the **review-record hook** records only an agent listed there, and the **merge guard** trusts a record only when the list committed on the base names the agent that wrote it. |
| `alerts.events`, `alerts.sound` | the two alert hooks, `notify` and `stop-failure` (§ Notifications). |
| `alerts.usagePercent` | the status line: from that share of a plan window it warns. |
| `fixesAfterReview.*` | how much a branch may change after its review and still count as reviewed (§ The review record, below). Read and shown with the gate; the merge guard judges with them once it moves onto that rule. |
| `workers.*` | nothing yet: they are read and shown, and the parts that act on them come later. |

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
0.6.0, on a detached HEAD, or by hand) counts for its exact commit only. The merge guard still
asks for a record of the exact head commit until it moves onto this rule.

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
  "requires": ">=0.1",
  "worktrees": {
    "base": "main",
    "guardMainFolder": true,
    "bases": { "hotfix/": "main", "release/": "main" }
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
| `worktrees` | Turns on the notes and guards that work with worktrees (the after-merge and leftovers notes, the stash question, the main-folder guard). Every project uses Claude Code's own worktrees (§ Worktrees). |
| `worktrees.base` | The branch a new worktree starts from and pull requests go into; the base the after-merge and leftovers notes compare with. |
| `worktrees.prefix` | **Retired in 1.0.0, and refused**: the folder-name prefix the plugin's worktree engine gave a worktree beside the repo. A file that still sets it does not load; `cc-smart-dev-kit project init` removes it (§ Worktrees). |
| `worktrees.setup` | **Retired in 1.0.0, and refused**: a command the engine ran inside a new worktree. A project runs its own install itself; `cc-smart-dev-kit project init` removes the field. |
| `worktrees.guardMainFolder` | `true`: refuse edits in the main checkout itself. Off when left out. |
| `worktrees.bases` | A branch-name prefix (ending in `/`) to the base that branch family's pull requests go into (`{"hotfix/": "main", "release/": "main"}`). The longest prefix that matches wins; every other branch's requests go into `base`. Auto-merge and the after-merge note read it; to start a task from another base, switch the main checkout to it first with `baseRef: "head"`, or `git worktree add` it as Claude Code's docs say. |
| `worktrees.engine` | **Retired in 1.0.0, and refused**: it said who made the project's worktrees. Every project uses Claude Code's own; `cc-smart-dev-kit project init` removes the field. |
| `protectedBranches` | The branches the git guard asks about before a push. Default `["main"]`. |
| `sessionNames` | `true`: each session names itself after its task. Off when left out. |
| `ownHooks` | The plugin hooks this project still runs as its own copy (in its own settings): exactly those stay silent here, so nothing runs twice. `["git-guard"]` while the project still has its own git guard; empty it once that copy is gone (§ The hooks). A retired hook name (`serena-root`, 0.6.0) is still accepted and silences nothing. |
| `instructions` | Accepted now. Today a project loads the opt-in instructions with its own import line (§ Instructions, skills and agents); the field does not load them yet. |
| `autoMode` | Used now: `setup` copies it into your settings ([The auto-mode block](#the-auto-mode-block)). |
| `jobs.kinds` | Used now: the project's own heavy-job kinds over the defaults ([docs/jobs.md](docs/jobs.md) § Kinds). |
| `jobs.route` | `true`: the `job-route` hook sends a heavy Bash command through `cc-smart-dev-kit job run` instead of running it raw (§ The hooks). Off when left out. |
| `workflow` | This project's [workflow](#the-workflow) policy, over your own defaults: what cc-smart-dev-kit may do by itself here. Each field is optional, and the project's value wins field by field. |
| `workflow.fixesAfterReview` | How much a branch may change after its review and still count as reviewed: `lines`, `files` and `percent` (§ [The workflow](#the-workflow)). Part of the review gate, so the merge guard reads it as committed on the base. |
| `workflow.workers` | Lead and worker sessions here: `enabled` (off by default), the limits a lead keeps its workers to, and the `tag` in their names (§ [The workflow](#the-workflow)). It wins over the same fields in your own file. |

`requires` is a version range (npm syntax). When the installed plugin is outside it, the
plugin says so and asks you to run `claude plugin update cc-smart-dev-kit@cc-smart-dev-kit`. A project that
uses a field raises its `requires` to the release that brought the field: a file written
without `worktrees.prefix` asks for at least `>=0.5.2`, the version that made it optional, so
a teammate on an older plugin is told to update instead of failing the file's parse.
`worktrees.prefix`, `worktrees.setup` and `worktrees.engine` retired with the plugin's
worktree engine in 1.0.0: a file that still sets one does not load, and the error names each
field and the fix, `cc-smart-dev-kit project init`.

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
