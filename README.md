# anymodel

`anymodel` lets a person use any model with Claude Code. It is a plugin anyone can
install: a local AI gateway, hooks, skills, agents, and the `anymodel` command, which sets
up and checks a machine. Nothing in it is tied to one project. A project opts in, and sets its own details, in its own
`.claude/anymodel.json`.

This repo is also the plugin's marketplace (a list of plugins Claude Code can install
from), named `anymodel`.

## Install

You need macOS or Linux (for now: the launcher and `bin/` are POSIX `sh` scripts),
[Claude Code](https://code.claude.com), [Bun](https://bun.sh) 1.4.3 or later (an older
Bun would send a backend's key through a proxy; `bun --version` shows yours), and read
access to this repo with git (an SSH key, or a git credential helper when the repo is
private). On an older Bun only `doctor`, `restore`, `version` and `--help` run.

1. Add the marketplace. `<owner>/anymodel` is where this repo lives: the `repository`
   field of `plugin/.claude-plugin/plugin.json`. Add the marketplaces of the two
   companion plugins too (see [Companion plugins](#companion-plugins)):

   ```sh
   claude plugin marketplace add <owner>/anymodel
   claude plugin marketplace add thedotmack/claude-mem
   claude plugin marketplace add anthropics/claude-plugins-official
   ```

2. Install the plugin for your user. Claude Code installs the companions with it:

   ```sh
   claude plugin install anymodel@anymodel
   ```

   Skipped the two companion marketplaces? The install still succeeds, with a warning
   that anymodel will not load without them. The setup in step 3 adds them, and that
   installs the companions.

3. Run the first setup. The `anymodel` command does not exist yet, so run it from the
   plugin folder. Put the installed version in place of `<version>` (the install prints
   it; `ls ~/.claude/plugins/cache/anymodel/anymodel/` shows it too):

   ```sh
   bun ~/.claude/plugins/cache/anymodel/anymodel/<version>/dist/cli.js setup
   ```

   Setup installs the launcher `~/.local/bin/anymodel`, turns on auto-update for the
   plugin, installs the plugin's general instructions for Claude (§ Instructions, skills
   and agents), and adds any companion marketplace that is missing. Add `--dry-run` to see
   the changes first; it writes and runs nothing at all. Add `--no-instructions` to leave
   the instructions out (setup remembers that choice).

4. Restart Claude Code.

After that, use `anymodel setup` to set up again (for example after an update).

## Commands

| Command | What it does |
|---|---|
| `anymodel setup` | Installs the launcher, turns on plugin auto-update, and installs the [instructions](#instructions-skills-and-agents): a copy in `~/.claude/anymodel/instructions/`, imported by an anymodel block in `~/.claude/CLAUDE.md` (your own text there is kept); each run refreshes the copy, so run it after a plugin update. Adds a missing [companion](#companion-plugins) marketplace (or plugin). Points [claude-mem at the gateway's cheap model](#claude-mem-on-the-gateway) when both are set up. Copies the project's [auto-mode entries](#the-auto-mode-block) into your settings, after it shows them and asks. It never touches [Warp](#warp) or its plugin without `--warp`. Every question comes before anything runs or is written. `--dry-run` shows the changes, and writes, runs and checks nothing at all (it reaches no network). A settings key you set yourself (for example `autoUpdate: false`, also after setup had set it) stops setup before it writes or runs anything. Without `claude` on your PATH, setup skips only the `claude plugin …` steps, names them, does the rest, and exits with 1. Run in a terminal with no status line set, setup also offers [anymodel's status line](#the-usage-limit-the-alert-the-status-line-and-usage) (once: it remembers a "no"). |
| `anymodel setup --no-instructions` | Takes the instructions' block and copy out and **keeps them out**: setup stores the choice (`~/.claude/anymodel/no-instructions`), so a later plain `anymodel setup` leaves them out too. `--instructions` clears that choice and installs them again. `restore` clears it as well. |
| `anymodel setup --yes` | On a terminal: the same, and writes the auto-mode entries without asking (they are still shown). With no terminal, they are left out, also with `--yes`. |
| `anymodel setup --project <dir>` | Reads the auto-mode entries from the project in `<dir>`, not from the folder you are in. |
| `anymodel setup --warp` | Also installs the Warp terminal, then its Claude plugin. The commands are shown first and asked; `sudo` asks for your password. |
| `anymodel setup --remove-warp` | Removes the Warp terminal, its package source and key, your Warp shortcuts and its Claude plugin. Shown and asked first. |
| `anymodel setup --statusline` | Also sets Claude Code's status line to `anymodel statusline`, as a key anymodel owns, without asking (also after an earlier "no"). It never replaces a status line you set: one you set yourself, also after setup had set it, stops setup before it writes anything, and `restore` leaves it. |
| `anymodel statusline` | The status line itself: plan usage, a warning from 85 %, and any gateway fallback in use. Reads the JSON Claude Code passes on stdin. |
| `anymodel usage [--hours <n>] [--project <folder or name>]` | Which models answered on this machine, per session, from Claude Code's transcripts: the main session's replies by model, and apart, its subagents (how each was launched, the model of each reply, the share on Opus). Default: the last 6 hours. Read only; no message text. |
| `anymodel doctor` | Checks the install, and the anymodel files the current project's `CLAUDE.md` imports (the list is below). Prints ✓ or ✗ for each check, `·` for information and `!` for a warning (neither is a failure), and exits with 1 when a check fails. |
| `anymodel restore [--yes] [--now]` | Removes what setup added (its settings keys, the auto-mode entries it copied, claude-mem's keys, its block in `CLAUDE.md`, the instructions' copy, and a stored `--no-instructions` choice) and keeps everything else. A key setup set and you changed since is yours: it stays. The plugins and marketplaces setup added stay installed: remove them with `claude plugin uninstall` and `claude plugin marketplace remove`. The launcher goes back to how it was before setup first changed it, or is removed when setup created it. With the gateway installed and on, it runs in **two stages**, because running Claude sessions still send every request to the router: the first restore removes everything but the router (the gateway's env keys too) and says to restart every running session; the second disables and stops the router (it asks, because that cuts answers in flight; `--yes` skips the question), waits up to 15 s for its port to close (not for its answers in flight, which finish in the background; and not at all when the unit was not running or another program answers on the port: it says so), and removes its copy, its unit and its limit state (`~/.local/state/anymodel/gateway-state.json`). `--now` does both at once, after a warning that every running session fails until it restarts (asked, or `--yes`). It keeps `gateway.json`, which holds your key. A restore with nothing left changes nothing. |
| `anymodel gateway <command>` | The optional AI gateway (below). |
| `anymodel search "<query>" [--max <n>] [--json]`<br>`anymodel search --fetch <url> [--json]` | Searches the web through the gateway's OmniRoute backend (Ollama's web search among its providers), or reads one page's text with `--fetch`. Prints each result's title, its URL and a short snippet. `--max` asks for 1 to 50 results. The query, or the URL, goes to that search or fetch provider on the internet; `--fetch` refuses a local or private address. Needs the gateway set up (below). |
| `anymodel version` | Prints the version. |

`doctor` checks that:

- the Bun running it is 1.4.3 or later. On an older one it skips the gateway checks:
  they send the backend key;
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
- each companion plugin (`claude-mem@thedotmack`, `frontend-design@claude-plugins-official`)
  is installed and on, and inside its version range. anymodel does not load without them.
  ✗ says what to run: `anymodel setup` (its marketplace or the plugin is missing),
  `claude plugin enable <id>` (you turned it off), or `claude plugin update <id>` (too
  old, or a version that is a commit id, which cannot be checked);
- claude-mem is 13.35.0 or newer. Older is a warning (`!`), not a failure: before
  13.35.0, a fresh install's vector search may not start (pydantic 2.14 broke
  chroma-mcp; 13.35.0 pins pydantic below it);
- Warp: the app and its version, and its Claude plugin. Not installed, or installed
  without its plugin (or with it turned off), is information (`·`): Warp is optional.
  ✗ only for the plugin without the app;
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
  port, each backend answers, every judge target passed the judge test; and, as
  information, each slot's first target. Without
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
| `anymodel gateway slot <scout\|worker> <target>[,<target>…]` | Sets a slot's targets, checked against the backend's model list. Live, no restart. |
| `anymodel gateway slot opus claude-opus-5-5,<target>[,…]` | A fallback for Opus (and `slot fable claude-fable-5-1,…` for Fable): Opus still goes to Anthropic unchanged, and only when Anthropic answers with your plan's usage limit does the next target answer, until Opus answers again. Never on a short rate limit or a server error. `slot opus off` turns it off. |
| `anymodel gateway slot judge <target>[,<target>…]` | A fallback judge for auto mode's safety check, used **only when Claude cannot answer it** (the plan's usage limit, or no valid Claude login). Each target must first block a test check (a force push to `main`), or it is not set. `slot judge off` turns it off. |
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

Auto mode's safety check is judged by Claude whenever Claude can answer it. The judge
slot is **off by default**, and even when it is set it is only a fallback: it answers a
check only when Claude cannot (your plan's usage limit, or no valid Claude login). With no
judge set, Claude Code then asks you. A cheaper judge can block good work, and a weak one
can let a risky command through, so `slot judge` first tests each target on one obvious
case and refuses a target that lets it run. "Claude first" relies on the router
recognising the check by its prompt. If Claude Code rewords that prompt, the check is
routed by its model name until the router is updated (see
[docs/gateway.md](docs/gateway.md) § Known limits; [roadmap](docs/roadmap.md) Phase 3).

### Web search

`anymodel search "bun runtime latest version"` searches the web through the same
OmniRoute backend, with the same key: it prints each result's title, its URL and a short
snippet, and the whole output is cut to about 2500 characters (`--json` prints the whole
answer). `--fetch <url>` reads one page's text instead. It needs the gateway set up — its
own error says so when it is not — and `--fetch` needs a web-fetch provider key inside
OmniRoute. With the default setup a search is free: Ollama's web search costs $0.00, and
OmniRoute caches a query for five minutes. Your OmniRoute key goes only to OmniRoute, but
the query (or the URL) goes on to the search or fetch provider on the internet, so never
put a key, a private host name or private data in it. The details, the measured numbers
and the limits: [docs/search.md](docs/search.md).

### The usage limit: the alert, the status line, and `usage`

- **The alert.** When a turn stops at your plan's usage limit, the plugin's StopFailure
  hook shows a desktop notification about your session's model (only once the gateway is
  set up). On Linux it offers "Use <target> until it resets", which runs the `slot opus`
  command above (the model, then Sonnet when only the Opus window ran out, then the worker
  slot's cheap targets), and "Wait"; after "Use", send a message in Claude Code to go on.
  On macOS it names the command. A short rate limit gets no alert: Claude Code retries it.
- **The status line.** `anymodel setup --statusline` sets Claude Code's status line to
  `anymodel statusline`. It shows your 5-hour and 7-day plan usage, warns from 85 %, and
  shows any fallback in use.
- **`anymodel usage`** reads Claude Code's own transcripts and shows, per session, the
  main session's replies by model and, apart, its subagents: how each was launched, which
  model wrote each reply, and the share on Opus.

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

**17 skills** (`/anymodel:<name>`; each also loads on its own when its topic comes up):

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
| `search` | Quick web lookups and one page's text through the gateway (`anymodel search`). |

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

## Companion plugins

anymodel depends on two other plugins (its `dependencies` in `plugin.json`), and Claude
Code installs and turns them on with it:

| Plugin | Marketplace (`claude plugin marketplace add …`) | Version |
|---|---|---|
| `claude-mem@thedotmack` (memory across sessions) | `thedotmack/claude-mem` | 13.29.0 or newer |
| `frontend-design@claude-plugins-official` | `anthropics/claude-plugins-official` | any |

- **Claude Code installs a dependency only from a marketplace you added.** Without it,
  `claude plugin install anymodel@anymodel` succeeds with a warning, and anymodel does not
  load. `anymodel setup` adds each missing marketplace, and that installs the companion.
- **A companion you have already stays as it is.** A claude-mem in the range is not
  updated or reinstalled. One older than 13.29.0 stops the install: run
  `claude plugin update claude-mem@thedotmack` first.
- **You turned one off?** Setup leaves it off and says how to turn it on; anymodel does
  not load while it is off.
- `restore` does not uninstall them.

## claude-mem on the gateway

claude-mem writes a summary of every session, by default with Claude Haiku on your own
Claude login. When the [gateway](#the-ai-gateway-optional) is set up and claude-mem is
installed (13.29.0 or newer), `setup` points claude-mem at the gateway's cheap model
instead, with Claude Haiku as claude-mem's quota fallback: while the cheap model is in a
quota or rate-limit cooldown, claude-mem sends its work to Claude, and hands it back
once the cheap model answers again. It is not a fallback for a backend that is down or
refuses its key. It sets seven keys in `~/.claude-mem/settings.json`
(`$CLAUDE_MEM_DATA_DIR/settings.json` when you set that variable):

- `CLAUDE_MEM_PROVIDER`: `openai-compatible`, with `…_PRESET` `custom`;
- `CLAUDE_MEM_OPENAI_COMPAT_BASE_URL`, `…_MODEL` and `…_API_KEY`: the first cheap target
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
- **The gateway has no cheap model any more** (removed, or its slots are Claude only)
  while claude-mem still holds setup's keys: setup says so, and how to fix it (run setup
  again once there is one, or `restore`).
- `restore` removes the keys that still hold what setup wrote, so claude-mem goes back
  to its own defaults; a key you changed since stays.

## Warp

The [Warp](https://www.warp.dev) terminal is optional. Plain `setup` never installs the
app or its Claude plugin (`warp@claude-code-warp`, from the marketplace
`warpdotdev/claude-code-warp`); only `--warp` does. When the app is there without the
plugin, `doctor` says so and names `anymodel setup --warp`.

`anymodel setup --warp` installs Warp through your system's own package manager, from
Warp's signed source:

| System | What runs |
|---|---|
| Debian, Ubuntu (x86_64) | Warp's key (downloaded over HTTPS, checked, turned into apt's form by `gpg --dearmor`) into `/etc/apt/trusted.gpg.d/warpdotdev.gpg`, the source file `/etc/apt/sources.list.d/warpdotdev.sources` (the same file, text and Signed-By that Warp's own package writes; kept when a Warp source is there already), `apt-get update`, `apt-get install -y warp-terminal`, all with `sudo` |
| Fedora, RHEL (x86_64, aarch64) | `rpm --import` of Warp's key from the checked copy (never straight from the URL), `/etc/yum.repos.d/warpdotdev.repo` (kept when there), `dnf install -y warp-terminal`, all with `sudo` |
| macOS | `brew install --cask warp` |
| anything else | a message with the download link, [warp.dev/download](https://www.warp.dev/download) |

- **Warp's key is pinned.** It is downloaded over HTTPS only (every redirect too), and
  must hold exactly one key, with the fingerprint anymodel knows
  (`0913165C78D5B7A41B42AC657FF7AB39D60F803F`). Anything else stops the Warp part with a
  message that the key changed, before any command runs.
- **The exact commands are shown first, then asked**, together with any other question,
  before anything runs. With no terminal, or a "no", the Warp commands and Warp's plugin
  are left out; the rest of setup is still done, and setup exits with 1. `--yes` does
  not skip this question.
- **`sudo` asks for your password on your terminal.** anymodel never sees, stores or
  pipes it, and never runs a downloaded script.
- **A command fails half way:** setup lists the commands that ran before it, and says
  that `anymodel setup --remove-warp` undoes them.
- Then it adds Warp's Claude plugin.

`anymodel setup --remove-warp` removes the app (`apt-get purge`, `dnf remove`, or
`brew uninstall --cask`), Warp's package source and key files, your own Warp shortcuts
(`~/Desktop/dev.warp.Warp.desktop`, `~/.local/share/applications/dev.warp.Warp.desktop`;
each backed up first), and Warp's Claude plugin, with its marketplace when no other plugin
of it is installed. On Fedora it removes from rpm only the key whose id is Warp's pinned
key. Warp's own settings folders stay.

## The auto-mode block

Claude Code's [auto mode](https://code.claude.com/docs/en/auto-mode-config) reads its
trust rules (`autoMode.environment`) only from your user settings, never from a project's
`.claude/settings.json`. So a project that wants auto mode to know its rules lists them
in its `anymodel.json` (`autoMode`), and `anymodel setup`, run in that project (or with
`--project <dir>`), copies them into `autoMode.environment` in your `settings.json`:

- **Shown, then asked on a terminal**, because these are trust rules: a person at a
  terminal always decides. `--yes` skips only the question. With no terminal they are
  left out, also with `--yes`, and setup says so.
- **In a worktree**, the question names the file the rules come from: the worktree's own
  `anymodel.json`, or else the main checkout's. When the worktree's own file says
  something else than the main checkout's, the question says so.
- **A project setup cannot read** (an invalid `anymodel.json`, one that needs a newer
  anymodel, git older than 2.31, or a worktree whose main checkout is gone) leaves only
  the auto-mode entries out, with a `!` line that says why; the rest of setup is done.
  Outside git, setup needs no git at all.
- **Only its own entries.** setup adds each entry at the end of the list and owns it;
  it never changes or removes an entry it did not add. When there is no list yet, it
  starts the list with `"$defaults"`, so Claude Code's built-in entries stay in force.
- **The project changes its rules:** the next setup in that project shows the change
  (`+` and `-` lines) and makes exactly that change. Each project's entries are its own.
- `restore` takes out every entry setup added. `"$defaults"` goes too, unless you have
  added entries of your own since.

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
| `autoMode` | Used now: `setup` copies it into your settings ([The auto-mode block](#the-auto-mode-block)). |

`requires` is a version range (npm syntax). When the installed plugin is outside it, the
plugin says so and asks you to run `claude plugin update anymodel@anymodel`.

## Develop

See `.claude/CLAUDE.md`. In short: `bun install`, change `src/`, `bun run build`,
`bun run check`, and commit `plugin/dist` with the change.

## Docs

- [Design](docs/design.md): how the parts fit, and why.
- [The AI gateway](docs/gateway.md): the router, its slots, and the judge.
- [Web search](docs/search.md): `anymodel search`, its cost and its limits.
- [Roadmap](docs/roadmap.md): the phases, done and ahead.
- [Claude Code contract](docs/claude-code-contract.md): the Claude Code behaviour the
  plugin relies on, and the version it was last proved on.
