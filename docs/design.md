# Design

How the `cc-smart-dev-kit` plugin is built, and why. For the phases ahead see `roadmap.md`; for the
Claude Code behaviour it relies on see `claude-code-contract.md`.

## The three parts

| Part | What it is | How it reaches a machine |
|---|---|---|
| **The plugin** | Hooks, skills, agents and bundled scripts in `plugin/`. | `claude plugin install cc-smart-dev-kit@cc-smart-dev-kit`. Claude Code copies `plugin/` into a version folder and updates it. |
| **`cc-smart-dev-kit setup`** | A command that does what a plugin cannot: changes to user files, MCP registration, long-running copies. | Run by hand, once after the install and again when a release asks for it. |
| **The launcher** | `~/.local/bin/cc-smart-dev-kit`, a small `sh` script. | Written by `setup`. |

A plugin alone cannot change a user's `settings.json`, register an MCP server at user
scope, or keep a service running. A setup command alone has no versions and no update
channel. Together they get both. The cost is two places to look, so
`cc-smart-dev-kit doctor` checks both (its list of checks: `README.md` § Commands).

**macOS, Linux and native Windows.** The launcher and `plugin/bin/` are POSIX `sh`
scripts; on Windows they run through Git Bash, which Claude Code gives a shell-form hook
and the Bash tool there. Windows gets a second launcher beside the `sh` one
(`cc-smart-dev-kit.cmd`, for `cmd` and PowerShell), a Scheduled Task where Linux has the
systemd units, and its own memory, lease and stop paths in the job queue: the five
`windows-*.md` pages, and `docs/windows-setup.md` § The short version.

### Why a stable launcher

Claude Code installs each version into its own folder,
`~/.claude/plugins/cache/cc-smart-dev-kit/cc-smart-dev-kit/<version>/`, and deletes an old folder some time
after an update (14 days, the docs say; not proved yet: `claude-code-contract.md`).
Installs and updates are keyed by the version, so every change to `plugin/` raises it;
CI checks that. A terminal, a systemd unit or a cron job cannot point into a folder
whose name changes. The launcher reads Claude Code's `installed_plugins.json`, finds the
user-scope install of `cc-smart-dev-kit@cc-smart-dev-kit`, and runs that version's `dist/cli.js`. It stays
valid across updates.

`setup` writes into the launcher the absolute path of the `bun` that ran it. The
launcher tries that first, then `bun` on PATH, so it also works under systemd and cron.

Inside Claude Code's Bash tool, `plugin/bin/cc-smart-dev-kit` is on PATH as well, and runs the
same CLI from its own version folder.

### Why long-running parts run from copies

Anything that keeps running (the AI gateway's router, and the portal) runs from a copy
in `~/.local/share/cc-smart-dev-kit/`, never from the version folder. Claude Code deletes that
folder after an update (14 days, not proved yet), even under a running process.
`cc-smart-dev-kit gateway setup` copies `dist/router.js` there and writes a systemd user unit
that runs the copy with the absolute path of `bun`, and a socket unit that holds the
router's port across restarts (`gateway.md` § The service). A new plugin version changes nothing
that runs until the person runs `gateway setup` again; `doctor` says when the copy is
older than the installed version.

### The Bun it needs

cc-smart-dev-kit needs Bun 1.4.3 or later. The number lives in one place, `MIN_BUN` in
`src/build-info/bun.ts`, which the router bundle may import (it holds no plugin
version). `package.json` `engines.bun` and the Bun version of both CI workflows follow
it, and a test (`src/build-info/bun.test.ts`) fails when one of them differs.

Why 1.4.3: a request to a backend on this machine carries the backend's key, and it must
never go through a proxy from the environment. `fetch(url, { proxy: false })` says so,
and Bun honours it from 1.4.3 on (oven-sh/bun#42692). Bun 1.4.2 ignores it and sends the
request to `HTTP_PROXY` (measured). No workaround is kept for an older Bun: the owner
chose a required version over one (2026-10-15).

Where it is checked, each time against the Bun running the code (`Bun.version`):

- **The CLI**, at start. On an older Bun every command stops with "cc-smart-dev-kit needs
  Bun ≥ 1.4.3; this is 1.4.2 (<path>). Upgrade this Bun, then run the command again.",
  except the ones that send no key and help the person out: `doctor`, `restore`,
  `version` and help (`src/cli/bun-check.ts`).
- **The hooks' shim** (`plugin/bin/cc-smart-dev-kit-bun.sh`), before it starts bun. A hook
  bundle has no check of its own, and an older Bun is not visibly broken: it drops
  `--no-env-file` without a word (measured on 1.2.23 and 1.3.0: the working folder's `.env`
  values reached the program), so the hook would run on guarantees the plugin does not have.
  The shim asks `bun --version` and fails closed exactly like the no-bun case: a guard asks
  the person, any other hook writes one line and exits 0. It asks only a bun that is **not**
  the one setup baked into the launcher (setup refuses to run on a Bun below `MIN_BUN`, so
  that one is already proved) and that has not been replaced since (its file newer than the
  launcher): a hook pays nothing for the check in the ordinary case, and one `bun --version`
  (2.9 ms median against a 48 ms hook call, measured on Bun 1.4.3) when a bun of the
  person's own is asked. The number lives in the shim too, beside its messages, and
  `src/hooks/bun-shim.test.ts` fails when it differs from `MIN_BUN`.
- **`doctor`**: its first line is the Bun, ✓ or ✗. On an older Bun it skips the gateway
  checks, which send the backend key.
- **`gateway setup`** (`installRouter`): refuses to install the router for an older Bun,
  before it asks or writes anything.
- **The router**, at start: it does not listen on an older Bun. systemd stops trying after
  5 failed starts in 60 s (`StartLimitBurst` in `src/gateway/service.ts`), so upgrading Bun
  in place does not bring the router back by itself. `gateway setup` does: it clears the
  start limit (`systemctl --user reset-failed`) and starts the socket and the unit again,
  with the new Bun's path written into the unit.
- **The tests**: the preload (`src/testing/setup.ts`) stops `bun test` on an older Bun
  with one line. The `package.json` scripts call `"$npm_execpath"` (the Bun running
  `bun run`), never `bun` from PATH, and tests start subprocesses with
  `process.execPath`: `<path>/bun run check` runs every step on that one Bun.

### The two flags on every bun run inside a person's folder

Bun loads the working folder's `.env` files and reads its `bunfig.toml` for whatever it
runs. A command or hook started in a project must see neither: a project's `.env.local`
would look like the person's environment, and a project's `preload` in `bunfig.toml` would
run its own code inside the plugin. So every bun the plugin starts in a person's folder
gets `--no-env-file` and a `--config=` flag pointing at the plugin's own empty
`bunfig.toml`:

- the hook shim `plugin/bin/cc-smart-dev-kit-bun.sh` and the CLI shim
  `plugin/bin/cc-smart-dev-kit` (hand-written `sh`, so they spell both flags themselves);
- the launcher scripts `src/setup/launcher.ts` (hand-written `sh`) and
  `src/setup/launcher-cmd.ts` (hand-written `cmd`, for Windows) write. Their lookup of the
  installed version runs in the launcher's own folder instead: the plugin's config is inside
  the folder that lookup has yet to find. They pass the config only when the installed
  version has one, since bun refuses a config path that does not exist and a 0.2.x install
  has none;
- the portal child, `doctor --live`'s hook command, the background self-update child and
  `browser check`'s two launchers, through `bunConfigArg` in `src/setup/bun-config.ts`;
- not flags but a folder: the browser's MCP child (`bunx @playwright/mcp`, and the bun that runs
  the package) takes no bun flags, so it starts in the browser's own output folder instead
  (§ The browser);
- the commands the README prints for a person to run from a folder of their own, and the
  line `restore` prints when it removed the launcher (`stageOneDone`).

The plugin ships the empty config as `plugin/bunfig.toml`, not `/dev/null`: a device path
is not a config the plugin owns, and the same flag then works on every system. Nothing the
plugin runs needs anything a bunfig would give it, and `src/hooks/bun-shim.test.ts` and
`src/setup/bun-shim.test.ts` run the real bundles with it, in a folder whose own
`bunfig.toml` preload would print a line.

## How the command prints

The command prints through one module, `src/cli/ui/out.ts`, which `src/cli/ui/terminal.ts`
tells what the terminal can do (read once: a TTY or not, `NO_COLOR`, `TERM=dumb`, the width,
an old Windows console). On a terminal it adds colour on the marks and the verdict, wraps to the
width (at most 100 columns) and shows a progress line while a slow step runs; anywhere else it
prints the same words with none of that, so what a log, a test or a pipe reads is what a person
reads. `doctor`, `setup` and `project init` print entirely through it; `browser setup` draws its
marks with it, and every `--dry-run` ends with its one line. The other commands move to it as
they are rebuilt. It is in-house, because a colour or prompt library would be a second runtime
dependency in every bundle. Its marks: ✓ passed, ✗ failed, `·` information, `!` a warning,
`+` `~` `-` a change, `$` a command run or to run; an old Windows console gets `[ok]` `[x]`
`[i]` `[!]`.

**One shape for a command that changes things** (`setup`, `project init`): a heading; the
questions, all before anything runs; the report in groups — `setup`'s sections in one fixed
order (`SETUP_SECTIONS`: the command, Claude Code's settings, the instructions, the companion
plugins, the MCP servers, the browser, projects, the terminal; a section with nothing to say is
left out), `project init`'s one group per file — each with its mark and what it holds in words
("2 changes, 1 warning"), changes first, then information, then what to read or fix; one verdict
line; and **Next steps**, what the person runs now, in order (`Out.next`; a step's command sits on
a line of its own, never wrapped, so it copies whole). The lines a part shares with `restore` or
`doctor` (the MCP registrations, the companions, Serena's clean-up) still come as text with their
mark in front; setup reads each one once, into its section (`reportLine`). The browser's guide is
`browser setup`'s own: setup prints one line while a step is open, and names `browser setup` as a
next step.

**One home for the questions: `src/cli/ui/prompt.ts`.** `confirm` (yes/no), `ask` (a question
with a default) and `secret` (read with no echo, `readSecretLine`) show the default (`[y/N]`,
`[main]`), take Enter for it, ask an answer they cannot read once more with the reason and then
take the default, and take the default at the end of the input, so a run never hangs. With no
terminal there are no prompts at all (`terminalPrompts` answers null): the caller takes the
default, or refuses and names the flag. The secret is never printed or logged; on a terminal
that cannot switch its echo off there is no secret read, and the caller names its `--…-stdin`
flag. `setup`, `restore`, `migrate`, `omniroute`, the gateway and `browser token` all ask
through it.

A check is one type, `Check` (`src/cli/check.ts`), whichever part makes it: a failure must carry
its `fix`, so `doctor` can print a `Fix:` line under every ✗, and the portal shows the same fix.
`doctor` runs its checks group by group (`CHECK_GROUPS`) and prints each group as soon as it is
done, so a slow check (the MCP servers start once; the gateway asks its backends) never leaves the
screen blank. The router bundle, the hooks and `browser mcp` never import the module: their stdout
is read by a program (`out.test.ts` walks their imports). The status-line setting has its own
module (`src/setup/statusline.ts`) for the same reason: the workflow's resolution, which every
hook loads, compares it, and importing it from `setup` pulled all of setup in.

## The installer

`install.sh` (macOS and Linux) and `install.ps1` (native Windows) are **the one command**
that takes a machine from nothing to a working plugin: the marketplaces, the plugin install,
`migrate` and then `setup`, the three secrets only a person has, and `doctor` at the end —
its `--json` report, from which the list of what is left takes each failure and its fix (the
text a person reads folds, wraps and changes its marks with the terminal, so no installer
reads it). Each step prints one line and is skipped when it is already done, so a second run only fixes
what is missing. A step that fails stops with the exact command that retries it, and the run
goes on from there next time.

**Exit codes.** 0: every step the installer ran succeeded and `doctor` is all `✓`. 3:
installed, with items left — `doctor` shows `✗` (the browser's token was skipped, say) — and
the run ends with the list of what is left, each item with the exact line that finishes it.
1: a step failed. 2: refused, and a refusal always comes before the first write, so the
machine is exactly as it was.

**`migrate` on every machine, then `setup`.** The installer does not guess whether a machine
needs the move: `migrate` decides that itself (`oldPiecesPresent` in `src/cli/migrate.ts`
counts the old folders, the launcher, a half-finished move's progress file, the old names in
the gateway config and `CLAUDE.md`) and prints "Nothing to move." with exit 0 on a machine
that needs none (proved by running the real CLI in a temp HOME). `setup` follows it on every
machine, because the move installs neither the instructions nor the launcher. The old
`anymodel` plugin, if `migrate`'s own question left it installed, is asked about after both:
one question, then `claude plugin uninstall anymodel@anymodel` and `claude plugin marketplace
remove anymodel` — last, because removing a marketplace uninstalls the plugins installed
from it.

**What the first real run taught it (2026-10-17).** Six steps were added after that run, and
each one is the fix for something it did:

- **The marketplace's own copy is refreshed first** (`claude plugin marketplace update
  <marketplace>`, `/dev/null` as its stdin), before any version is compared — the same two steps
  in the same order `src/update/` runs (`marketplace update`, then `plugin update`). The live
  machine had the marketplace added hours earlier at 0.4.1: the installer compared the installed
  0.4.1 with the stale clone's 0.4.1, saw them equal, and updated nothing. A shell script cannot
  import `src/update/apply.ts`, so each installer keeps its own copy of the order, and
  `scripts/install.test.ts` proves it runs first.
- **The installed CLI is asked its own version** (`cli.js version`) after the install or update,
  and refused when it is older than the release the installer ships with (each script carries
  that number, and a test keeps it equal to `plugin/.claude-plugin/plugin.json`). The old run
  called `--tavily-key-stdin` on a 0.4.1 CLI, which has no such option, and died there. The
  refusal prints the two commands that fix it and exits 1 — and **nothing after it runs**, so no
  later step can call an option that CLI does not have. A version that cannot be read refuses
  too: this script cannot promise an option a CLI it cannot see understands.
- **The gateway is asked about only when it is not working** (`cc-smart-dev-kit gateway check`,
  a read-only subcommand with an exit code: 0 the key works, 1 no key yet and OmniRoute answers,
  3 it could not be judged, 4 the key is one OmniRoute refuses). The live run asked for a key on
  a machine whose gateway worked; a provider key was pasted over the router's own; every
  affordable subagent fell back to Claude. On 1 the installer asks for OmniRoute's dashboard
  password (setup makes the key itself), on 4 for an OmniRoute API key named exactly, and after
  a refusal it asks **once more** with the reason; a second refusal skips the gateway and puts
  it in "What is left". On 3 (no OmniRoute at all) nothing is asked, the line says the gateway
  needs OmniRoute first, and the item goes to the list.
- **An MCP server of the person's is asked about, never taken over** (`cc-smart-dev-kit mcp
  status --json`, § MCP servers at user scope). The live machine had all four names registered
  by a project's own script; setup left them alone as it must, and its `!` line was lost in the
  installer's output, so the plugin's browser never took over. The installer reads the JSON,
  shows the command that runs instead (never an `env` or a header), and asks per server: a yes
  runs `claude mcp remove <name> --scope user` and then `setup` again, so the plugin registers
  its own WITH its record; a no lists the exact command under "What is left".
- **A marketplace that ssh refuses is added over HTTPS once** (`ssh_refused`, in both scripts).
  Claude Code adds a marketplace over ssh by default, so a machine with no GitHub SSH key — or
  a blocked port 22 — was refused and nothing was added. The one source is retried once as
  `https://github.com/<owner>/<repo>.git`, with a line saying so; the marketplace's name comes
  from the repository's own marketplace file, never from the source, so the same name lands and
  every step after it finds the marketplace. Any other failure is reported as it always was,
  with the command's own words kept for whoever reads the line. One retry, never a loop.
- **The GitHub account is asked before anything is added** (`check_repo_read_access`, the same
  two fix lines `doctor` prints). With `gh` installed and somebody logged in
  (`gh api user --jq .login`, the one call that also proves it), `gh repo view
  <owner>/<repo> --json name` decides: an account that cannot read the repository stops the run
  (exit 1) with the account, the line "ask the repository's owner for read access" and the
  invitation page, because no retry helps until its owner grants access. It is asked at step 2
  too, when git could not read the repository (git's own line there sends the person to fix
  credentials they already have), and skipped when `gh` is missing, nobody is logged in, or the
  account can see the repository — a machine without `gh` installs as before. `doctor` names the
  same two causes, read from the whole of git's error output (`gitFailureCause` over `output`:
  the line that names the cause is not the last one) with `marketplaceAccessAdvice`, and keeps
  its old line for anything else.

**Secrets are cleaned where they are read.** Many terminals (Warp among them) wrap a paste in
the bracketed-paste markers `ESC[200~` … `ESC[201~`, a shell turns that mode on and nothing turns
it off, and a silent read keeps every character: a pasted token arrived as
`ESC[200~<token>ESC[201~` and was refused as the wrong shape, so a person who pasted a good token
saw "the token was not saved" (live, 2026-10-17). The one home for the rule is
`src/cli/secret-line.ts` (`cleanSecretLine`, and `readSecretLine` which uses it); `install.sh`'s
`clean_secret` and `install.ps1`'s `Clear-Secret` strip the same two markers the same way, and
`scripts/install.test.ts` proves the installer's own read. The token step is also ONE question
now — read with no echo, then piped to `browser token` — so a paste cannot land in a yes/no
answer instead, which is the other way that live run walked past the browser with no token file.

**Tavily is not asked for when the machine has a key.** `TAVILY_API_KEY` in the installer's own
environment, the key file `setup` reads, or the key already in the settings: one line says which
one is in use and nothing is written. The rule is `readTavilyKey`'s (`src/mcp/tavily.ts`), which
the installer repeats in shell for the two file checks.

Four decisions are worth naming:

- **The repository is an argument, and the script names no owner.** The plugin's own rule is
  that no company or owner name lives in the repo (`neutrality.md`), so the script cannot
  carry one. `<owner>/<name>` arrives as the argument the README's line passes
  (`bash -s -- <owner>/<name>`; for PowerShell, `& ([scriptblock]::Create(…)) <owner>/<name>`),
  or from `CC_SMART_DEV_KIT_REPO`; with neither it prints one usage line and exits 2. It is
  the same source `claude plugin marketplace add` takes.
- **Every question reads the terminal, never stdin.** The script arrives on a pipe
  (`gh api … | bash`, `irm … | iex`), so its stdin is the script itself: a question read
  from stdin would eat the script. `install.sh` opens the terminal once on fd 3 — the
  commands it runs get that fd as their stdin, so `setup`, `migrate`, `browser token` and
  the gateway ask their own questions on the terminal too — and `install.ps1` asks through
  `Read-Host`, which reads the console. `CC_SMART_DEV_KIT_INSTALL_TTY` points the questions
  at a file of answers instead: it is how the tests run the installers, not a thing for
  people.
- **It never writes a secret file, and never puts a secret on a command line.** A command
  line is readable in `/proc` and lands in the shell's history, so each key reaches the
  plugin's own command on stdin and that command owns the file: the browser's token through
  `browser token`, the gateway's key through `gateway setup --backend-key-stdin`, the Tavily
  key through `setup --tavily-key-stdin` (which writes the key file a person may write by
  hand, mode 600, through the same atomic writer as the token). A secret is read with no
  echo, printed by nothing, and logged by nothing.
- **It refuses inside a Claude Code session** (`CLAUDECODE`, the same test `migrate` uses):
  the run may replace the router that session's own model traffic goes through. `--dry-run`
  prints the plan for the machine and changes nothing — no `claude` command, no setup, no
  network; it still reads the machine's local facts, so the plan is about *this* machine —
  and without Bun it says it cannot read what is already installed.
- **Every child that does not ask the person reads nothing**: `claude plugin …`, `bun
  upgrade`, the Bun installer and `doctor` get `/dev/null` as their stdin (PowerShell hands a
  child the console, never the pipeline), so none of them can eat an answer meant for a
  question. The commands that do ask — `migrate`, `setup`, `browser setup`, `browser token` —
  get the terminal.
- **A half-downloaded script does nothing.** `install.sh` puts the whole run inside `main()`
  and calls it on the last line: bash runs the statements it has read before it reaches a
  syntax error, so a file that stops in the middle would otherwise have run the first steps.
  PowerShell parses a whole file before it runs a statement, so a truncated `install.ps1`
  stops at the parse error by itself. `scripts/install.test.ts` proves the bash half.
- **`install.ps1` is pure ASCII** (`[ok]`, `[x]`, `-`, `...`): a Windows console in another
  code page shows `✓` or `·` as mojibake. `install.sh` keeps its marks; a test checks the two
  PowerShell files byte by byte.

What the installers do **not** own: the plugin's version (it comes from
`plugin/.claude-plugin/plugin.json`), the marketplace's name (from
`.claude-plugin/marketplace.json`), and the minimum Bun (`MIN_BUN` in
`src/build-info/bun.ts` — `scripts/install.test.ts` keeps the copy in each script equal to
it, the way CI's setup-bun comment says a test keeps its number equal).

The two scripts are proved by `scripts/install.test.ts` (bash, in a fake world: a temp HOME
and fakes for `claude`, `bun`, `git`, `gh`, `curl` and `uname` on PATH — the fake
`doctor --json` reports a failure while the browser's token is missing, the way the real one does, which is what the
exit-3 path is proved against) and `scripts/install-windows-smoke.ps1` (on the Windows CI
runner, under pwsh AND under Windows PowerShell 5.1). The Windows fakes are one-line `.cmd`
wrappers around the real `bun.exe` running `scripts/install-windows-fakes/*.ts`, so a fake
that reads a secret reads the very stdin the installer piped to it — and, because the fakes'
logic is TypeScript and not batch, `scripts/install.test.ts` runs every one of them on Linux
(0.4.2's first Windows run died inside a batch fake's own argument parsing).

## The AI gateway

An optional local router between Claude Code and the model providers
(`src/gateway/`, design and limits in `gateway.md`):

- Each Claude model goes to the slot of its family when the person gave that slot a chain,
  and to Anthropic byte for byte, on the person's own login, when not. No model is chosen
  for anyone: a fresh setup gives no slot a chain.
- **No prompt text is ever changed.** An affordable backend gets two named, tested format
  translations and nothing else. A slot's Claude target that is not the model asked for gets one,
  `requestForClaudeFallback`: only the fields that Claude model refuses (Claude Code built
  the body for another model), never a word of the prompt. The rules:
  `.claude/rules/gateway.md`.
- Every 4xx / 5xx from any target is logged with the start of its reason, keys masked,
  so a failure can be read in the journal.
- Auto mode's safety check is judged by Claude first; while Claude is limited or down, the worker
  chain's targets that passed the judge test judge in its place (the judge's fallback is on by
  default; `gateway fallback judge off` keeps Claude alone). A judge chain the person sets wins,
  and may hold a `claude-…` target; its first usable target judges every check (the next only
  with the judge's fallback on). A target must pass a test check before it is used; the router
  uses only a target whose test proof is in the config (D44).
- A request that carries an Anthropic server tool (`web_search_*`, `web_fetch_*`) goes to
  Anthropic as sent, whatever its slot; at a Claude capacity failure the router answers it with a
  note that names the Tavily MCP server's search tool (D41, D44; `docs/gateway.md` § Anthropic's
  server tools).
- Every Claude model reaches the slot of its family (haiku → scout, sonnet → worker, opus,
  fable), read from the id Claude Code sends. **Every slot has two modes, Claude or Custom
  (D2): `slots[key]` is the chain in use; a slot absent from it is Claude and stays byte for
  byte on Anthropic.** A chain a slot is not using is saved in `kept[key]`, so switching to
  Claude never forgets it, and a 0.5.x router or CLI (a loose top-level object) reads the same
  file right and writes `kept` back untouched — a rollback turns nothing back on. `gateway
  setup` moves the chains a 0.5.x portal kept in `portal.json` into `kept` and takes the slot
  parts out of that file, so no chain has a second home to disagree with. A chain is the
  person's, any targets in any order, and each slot's fallback switch decides whether its next
  target may answer (it travels with a saved chain; the breaker switch goes with the slot's
  chain, as it always did); the router never adds a target, Claude included. A backend's
  thinking stays, marked as the router's with its own signature inside: removed on a request
  to Claude, which refuses a signature it did not issue, and given back its own signature on a
  request to a backend (D6); the router writes the plan limits it saw, its open breakers and
  the Claude ids Claude Code sent (`seenClaude`) to a small state file that the status line,
  the StopFailure alert and the portal read. The alert's worker runs through the launcher,
  never from the plugin's version folder. The health answer also lists the last 200 routed
  requests (`recent`: metadata only), which the portal's activity feed reads (B6b).
- **The request history (D51): one row per routed `/v1/messages` request** — time, session
  id, model, slot, target, status, latency, tokens, an estimated cost — and never a prompt,
  a system text, a tool, an answer or a key. `bun:sqlite` in the state folder: WAL, written
  in the background and batched, kept 90 days by default (`history.retentionDays`; 0 turns
  it off), a daily purge with incremental vacuum. Its read side (`history-read.ts`) feeds
  `gateway history` and the portal's Flow page; `doctor` and `gateway status` show its size.
  `docs/gateway.md` § The request history.
- **A used-up chain is bridged, not handed back dead (D42, the breaker).** When every target of
  a slot failed for want of capacity and the last one is a backend, the router holds the
  request (up to 240 s from its start, 60 s if it does not stream; the config is read once a
  second, so a changed chain is served at once), asks each resting target once through a single
  probe, and then answers a 429 that Claude Code retries by itself. Anthropic's own answers pass
  unchanged, and the router never fakes its quota headers. The same change caps every
  `retry-after` it relays at 60 (Claude Code fails the request at once above it) and relays a
  backend's refusal as a 424 (Claude Code sends an unknown 400 or 422 again without its deferred
  tools): `gateway.md` § The breaker. What the person hears comes from BR2: the status line
  names an open breaker, and the StopFailure alert says so once per opening, with the person's
  own other backend targets as the way out (`src/hooks/stop-failure.ts`, `breakerAlert`).
- A config `aliases` map lets a machine's old model names reach the new slots while it
  moves. The plugin ships none; a project's migration writes them.
- `gateway on` / `off` change Claude Code's settings only as owned keys through
  `src/setup/`, so `restore` undoes them, and a key someone else set stops it.
- **A backend key is tested before it is saved** (`checkBackendKey`, `src/gateway/backends.ts`):
  one cheap authenticated request (`GET /v1/models`, 5 s) with the key. 401/403 refuses it —
  nothing is written, the key in the file stays, and the message names the key that backend
  wants (for `omniroute`: an OmniRoute API key, not a provider key). Anything else (unreachable,
  a 5xx) is not a silent save either: the key is saved only with `--save-unchecked`, with a WARN
  line. A key that really changes is backed up first (`backupFile`, the one helper: the state
  folder, never beside a file that holds keys). Live, 2026-10-17: a pasted provider key
  overwrote the router's working key, OmniRoute answered 401 to everything, and every affordable
  subagent fell back to Claude.
- **`gateway setup --omniroute-password[-stdin]` makes the router's key in OmniRoute itself**,
  with the person's dashboard password (asked with no echo, never stored, never printed):
  `POST /api/auth/login` (no `Origin` header — OmniRoute skips its CSRF check without one),
  then `POST /api/keys` with the `auth_token` cookie, named
  `cc-smart-dev-kit-router-<hostname>`, `noLog: true` (the router's requests stay out of
  OmniRoute's call log, so no prompt text of the person's lands there). The key that comes back
  goes through the same test and save as one given by hand. The OmniRoute facts and their source
  (the installed OmniRoute 3.8.51, read 2026-10-17): `src/gateway/omniroute-key.ts`.
- **The context is built in one place** (`src/gateway/context.ts`): the runner, the service, the
  machine's facts, and — the part that broke — the terminal `--omniroute-password` reads from.
  `readSecret` is set only when that stream is a terminal whose echo can be switched off
  (`canHideInput`); on a pipe it is left out and the flag says to use stdin. It used to be built
  inside the CLI entry, which never set the field, so every run of that flag answered "this
  terminal cannot hide what you type" on a real terminal too (premium review, 2026-10-17); the
  factory is a module so a test can prove both cases (`context.test.ts`).
- **A key setup made and did not save is deleted again** (`createOmnirouteKey`'s `discard`):
  `DELETE /api/keys/<id>` with the session cookie it still holds. A refused key, an unchecked
  save without `--save-unchecked`, any later failure — the run leaves no unused key in the
  person's dashboard, and a delete that fails names the key's name and id in the error.
- **`gateway check`** answers one read-only question for scripts — the installer's own use: does
  the gateway have an OmniRoute key the backend accepts? Exit 0 works, 1 no key yet (OmniRoute
  answers, so one can be made), 3 could not be judged, 4 the key is refused. It asks the backend
  only, never the router's port (a machine's sessions may be using the router; a test may have a
  real router on that port).
- Every session on the machine goes through the router, so its restart must not make
  them fail. systemd's `cc-smart-dev-kit-router.socket` holds the port (socket activation) and
  passes it to the router; the router accepts on it with `node:net` (Bun's own server
  cannot take an inherited socket) and relays each connection to its own server on a
  private unix socket. On a restart the old router finishes its answers (up to 120 s;
  a longer one is cut, and Claude Code retries it) and new requests wait in the socket:
  none fails (proved live). A connection that never sends a byte is closed after half a
  second, so it cannot hold the drain. A router that keeps failing to start is given up
  after 5 starts in 60 s, and systemd closes the socket with it, so requests are refused
  at once instead of hanging (proved live). The restart still waits for that drain,
  so only a manual `gateway setup` restarts it, only when the copy or a unit changed (or
  an earlier setup did not finish: the restart-pending marker), and only after the
  person says yes (or gives `--yes`). The first setup that moves a router from the older
  plain unit cannot keep the port open (systemd will not open a socket while its service
  runs), and says so before it asks. Before anything, setup asks the port and stops when
  another program holds it; after the restart it waits for the health page.
- Running sessions are taken to keep the router's address until they restart (one live
  look saw otherwise; `claude-code-contract.md`). So `restore` takes the gateway out in
  two stages: first the env keys (the router keeps running), then, after the sessions
  restarted, the router (asked first). Stage 1 also puts back the launcher, and when it had
  created it the file is gone: the line it ends with then names the second run in full
  (`stageOneDone`: `<the bun running it, absolute> --no-env-file --config=<the installed
  version's empty config> <this plugin's dist/cli.js> restore`, with the bundle its entry
  passed in), because `cc-smart-dev-kit` is not on the PATH any more — a bare `bun` would
  need bun on the PATH, which setup never proved. `restore
  --now` does both, with a warning. The
  stop never waits for the router's drain: `disable`, then one `stop --no-block` of the
  socket and the service together, then up to 15 s for the port to close.
- The router bundle carries no version (`src/build-info/names.ts`), so a version bump
  alone never changes `router.js` and never makes a machine restart its router.

## Heavy jobs

One queue for the whole machine (`src/jobs/`, design and limits in `jobs.md`):

- `cc-smart-dev-kit job run --kind <kind> -- <command>` reserves the job's gigabytes, waits while
  they are not free, runs the job, and gives them back however it ends. Kinds and sizes
  are defaults a project can replace in its `cc-smart-dev-kit.json` (`jobs.kinds`); a machine sets
  its limits in `~/.config/cc-smart-dev-kit/jobs.json`. `--exclusive <name>` (with a kind, or
  alone) also keeps a name to one job at a time: a lease that holds the name.
- **The job runs in a process group of its own**, so a signal reaches its workers too,
  and its memory is given back only once the group (and its systemd scope) is empty.
- **Leases are files, judged like the lock.** Each reservation is a small file naming
  its writer's pid and start time. A file whose writer is gone (a dead or reused pid) is
  stale and the next reader removes it, through the same `holderIsGone` as setup's lock.
  So nothing needs cleaning after a crash, and no native code (`flock`) is needed. A
  writer in another pid namespace (a container on the same host) keeps its files alive
  with a heartbeat. A shared folder is for one host: one clock, no network file system.
- **Two kinds of budget,** this machine's and optional shared folders (containers or
  users on one host), taken in a fixed order and given back in reverse, so they never
  wait on each other in a circle. Oldest first, fair share on shared folders, a live check
  against real free memory (cgroup-aware), and no give-up timeout.
- **The launch** puts a job in its own systemd memory group with a kill mark and a low CPU
  and disk I/O weight where Linux allows it, so that under load the desktop and the sessions
  go first, and if memory still runs out, a heavy job dies first. A weight needs its
  controller delegated to the user manager; one that is missing is skipped and `job status`
  says why.
- **The state is per user** (`~/.local/share/cc-smart-dev-kit/jobs/`): nothing in it outlives
  its writers, and no service runs.
- A pure classifier (`classifyHeavyCommand`) says which kind a Bash command runs; a later
  hook routes heavy commands through `job run`. It reads a project's `package.json` through
  an injected reader, only to tell a script from the tool of the same name (`docs/jobs.md`
  § The classifier).

## How `setup` changes user files

`setup` owns **managed** parts of user files, and only those:

- in a JSON settings file, single keys (listed in its state, `owned.json`, each with the
  value cc-smart-dev-kit wrote there, or only its SHA-256 for a secret);
- in a JSON list of strings, single entries, each with the source that wants it (listed
  in `owned-entries.json`): the auto-mode block;
- in a Markdown file, one block between `<!-- cc-smart-dev-kit:begin -->` and
  `<!-- cc-smart-dev-kit:end -->`;
- whole files it creates itself (the launcher, the copy of the instructions).

The guarantees:

- **A fixed order for each write:**
  1. make the backup;
  2. record the change in `changed.json`, so `restore` can undo it (the first time,
     with that backup as the baseline). The record needs the backup's path, so the
     backup comes first;
  3. write a temp file and fsync it;
  4. compare the file with the text read earlier;
  5. rename the temp file over it. A reader never sees half a file.

  A cheap compare also runs before the backup, so a file that changed already gets no
  backup. A backup from a failed try is removed, unless it became the baseline.
- **Fewer lost edits:** when the compare fails, the step starts again from the read, up
  to 3 times, and an ownership claim made in the failed try is undone first. The compare
  narrows the window for a race with another program (Claude Code writes
  `settings.json` too); it does not close it.
- **Backups in the state folder,** `<stateDir>/backups/` (mode 0700), one subfolder per
  file, named from its real path. Never beside the file: a settings file linked from a
  dotfiles repo would get backups, with secrets in them, inside that repo, and a backup
  in a `bin` folder would sit on PATH. A backup is never executable; an executable's
  mode goes into the backup's name.
- **A lock** against two runs at once. It holds the pid, that process's start time and
  the host name. It is stale only when the pid is dead, or alive with a different start
  time (the pid was reused). When the holder cannot be judged, it is stale after 10
  minutes: neither `/proc` nor `ps` gives the start time, the lock was written on
  another host (a home folder shared between machines), or the lock cannot be read.
  Otherwise a live holder is never taken over, and there is no refresh timer. A run
  that removes a stale lock first takes a claim file, `lock.takeover` (O_EXCL), so it
  never removes a live lock that took the stale one's place.
- **Never someone else's key:** a key that exists with another value and is not owned
  is never overwritten; setup stops and says so. One exception, named per key: a value
  that means "nobody chose this yet" — a program's own default, which that program wrote
  into its file itself (claude-mem seeds every default on its first run). Such a key may
  be taken; restore removes it, and the program falls back to the same default. Setup checks `settings.json` before it
  writes the launcher, so such a key (for example `autoUpdate: true`) stops it before
  anything is written.
- **A key the person changed is theirs.** An owned key remembers the value cc-smart-dev-kit
  wrote. When it holds another value now (and not the program's own default), the
  person chose it: setup does not overwrite it (it stops, as for any key not its own),
  and restore leaves it and gives up the ownership. A record from an older `owned.json`
  has no value: it stays owned as before, and gets its value at the next setup. A
  write that sets a secret leaves the file at mode 600.
- **`--dry-run`** shows every change and writes nothing at all: no state folder, no
  lock. Every setup runs this read-only pass first, outside the lock.
- **`restore`** removes what cc-smart-dev-kit added and keeps everything else: its own JSON
  keys and its Markdown block go; a whole file goes back to its **baseline** (the backup
  made at cc-smart-dev-kit's first change to it since the last restore), or is removed when
  setup created it. An object cc-smart-dev-kit created that a removal empties (the `env` its
  own keys went into) goes with its last key, so no `"env": {}` is left behind; an object the
  person had stays, also when it is empty (`createdObjects`, from the baseline backup: a
  baseline that is missing or unreadable proves nothing, and nothing is pruned). An object
  setup created is removed **even when the person emptied it later**: it is still the object
  setup made, and a missing object and `{}` read the same to Claude Code. A record
  (`changed.json`) that cannot be read is not an error here — a read-only pass must go on —
  so nothing is pruned and one line on stderr says so; a command that really writes reads
  the record itself and reports its own error. It backs up
  each file before it changes it. With the gateway on, the
  router's copy and unit wait for a second restore (§ The AI gateway), and its first stage
  names the command that runs the second one — the `bun --no-env-file --config=… …/dist/cli.js
  restore` line, when that stage removed the launcher and `cc-smart-dev-kit` is off the PATH. A
  restore with nothing left changes nothing.

Its state (`<stateDir>`) lives in `$CLAUDE_CONFIG_DIR/cc-smart-dev-kit/` (by default
`~/.claude/cc-smart-dev-kit/`): `owned.json`, `owned-entries.json`, `owned-hooks.json`, `changed.json`, the lock and `backups/`. The
state is per config folder, but the launcher in `~/.local/bin` is shared by all of
them. So a restore under one config folder can remove a launcher another one relies
on. A launcher started without `CLAUDE_CONFIG_DIR` looks in `~/.claude`.

### Who changes what, and when

- **A SessionStart hook** adds a note to the session (§ The hooks) or starts the background
  self-update (§ Updates). It writes no user file, and never restarts or stops anything.
  (Refreshing managed files from it is not built yet; when it is, it goes through
  `src/setup/` under its lock, and `cc-smart-dev-kit setup` does that by hand today.)
- **The background self-update** installs a newer plugin version with Claude Code's own
  `claude plugin` commands. It writes no user file and restarts nothing.
- **A manual run** (`cc-smart-dev-kit setup`, `cc-smart-dev-kit gateway setup`, `restore`) is the
  only thing that restarts or stops a service or changes a permission. It shows the change
  first, and asks before it cuts the answers in flight. Two more restart a service, and both
  are a person's own run too: the **portal's** "Restart the router" (the same `gateway setup
  --yes` the terminal runs, after a confirmation on the page) and **`omniroute update` /
  `rollback`** (which restart the unit the affordable slots answer through). Neither is ever
  started by a hook, a session or the background self-update.

So an automatic update can never restart something or widen a permission without the
user seeing it: a new router version runs only after `gateway setup`, which asks.

## The portal

`cc-smart-dev-kit portal` (`src/portal/`) starts a page on this machine, on `127.0.0.1` only,
to see and change the gateway's settings, the updates, the heavy-job queue, the companions
and OmniRoute. The screens the owner approved (2026-10-16) are `views.ts`, and the copy on
each one follows them.

**Settings and the Project card.** `/settings` shows every workflow setting — the flow after
a finished step, the alerts, the switches — one row each, with the value now and where it
came from (`yours`, `this project`, `default`). A change is one POST that runs the module's
own `writePersonalSetting` (the two project switches go to `writeProjectSetting`), so the
page and `cc-smart-dev-kit workflow show` can never disagree; a row the project sets is
read-only here and links to the Project card, and a value outside its row's own set is
refused in words. The Project card on Machine is about the repo the portal was started in:
state A (no `.claude/cc-smart-dev-kit.json`) or the form, whose first values are the command
line's own detection (`detectFacts` + `defaultAnswers` — the default branch, GitHub's
protected branches). Its **preview is the server's own `planProjectInit`**,
the same pure function the write runs, so the browser never builds the file: a form change is
a `project.preview` POST — at once for a finished edit, 300 ms after the typing pauses in a
text box — and the boxes are drawn from the answer. The answer carries
`projectFilesHash` of the two texts it planned from, the page keeps it, and `project.write`
sends it back: a project file that changed since the preview is refused ("preview again")
rather than written over field by field. `Write the files` asks first and runs
`applyProjectInit` — a backup, an atomic write, two files, and never a commit. The settings
file gets Claude Code's `"worktree": {"baseRef": "head"}` when the base branch is not the
repo's default branch.

**Settings → Projects (B8).** `/api/projects` (`src/portal/api/projects.ts`) lists every
repository from Claude Code's session records (`sessionWorkFolderTimes` in
`src/sessions/command.ts`, the one reader `sessionWorkFolders` is built on), each folder taken
to its main checkout by `checkoutOf` (`src/update/retired-repos.ts`, shared with the retired-repo
scan), plus the roots the person added (`portal-projects.json` in the state folder, written
atomically under the state folder's lock). Each row carries an id (12 hex of the root's
sha256), the last use, the worktree count (`git worktree list --porcelain`), whether the
project files are set and committed (`git status --porcelain` on the two files), and whether
the portal's own folder is in it. `/api/projects/<id>` adds the project-init card for that
root and the open pull requests (`gh pr list`) and crew branches (`listCrew`), each judged by
`checkPullRequest` / `checkBranch` — the merge guard's own code — under **one deadline per
page** (`PROJECT_BRANCHES_DEADLINE_MS`; past it a verdict is `late`, never a guess) and kept
for `PROJECT_BRANCHES_CACHE_MS`. Every git and `gh` child on these paths is awaited
(`Bun.spawn`): merge-check takes an injectable async `GhRunner` (default `spawnGh`), and the
merge guard and `workflow merge-check` await it with their time budget unchanged, so a verdict
never freezes the pages or the live stream. `project.preview` and `project.write` take an
optional `project` id, looked up in that list (an unknown id writes nothing; no path ever comes
from the request), and `project.add {folder}` adds a git folder's main checkout to the list.

**The workflow module is behind one seam** (`src/portal/workflow-adapter.ts`). The values,
the writes, the auto-merge rule and the project's two files all come from `src/workflow/`
and `src/project/init.ts` through one typed interface, injected as `PortalOptions.workflow`
and faked in tests (`src/testing/fake-workflow.ts`). The portal re-implements none of it, and
a test drives both screens without reading a real workflow file, running git, or writing
anything. The project's own defaults are remembered per file text for the run (`server.ts`):
`detectFacts` reads git and, when `gh` is there, GitHub itself, so a form change is a plan,
not a network read.

### What it is, and what it is not

- **Everything it does is real**, and goes through the command line's own code. A slot, the
  gateway switch, the judge, the fallback, the router restart and the OmniRoute update run
  `runGateway` / `runOmniroute` — the same functions, the same checks, the same lock, the
  same lines, with `print` collecting them instead of the terminal (`src/gateway/commands.ts`,
  `src/cli/update.ts` and `src/cli/doctor.ts` each take their output from the caller for
  this). A page can therefore never do something the command line would refuse.
- **The person's own yes.** A browser cannot be asked a terminal question, so each page asks
  before it sends the POST (`data-confirm`) and the action passes the command line its `--yes`.
  The auto-mode trust rules need an explicit confirmation on the page, which stands in for
  the terminal question `setup` asks.
- **What needs `sudo` is not run.** Installing or removing the Warp app shows the exact
  command to copy (the Machine page's Warp card, next to `doctor`'s own line for it).
- **The gateway is optional, and the pages say so.** With no config to read, Overview, Slots
  and Health draw one page: "The gateway is not set up", the command that sets it up, and a
  button to Machine. Machine, Settings, the Project card and the privacy page draw anyway —
  updates, the heavy-job queue, the companions, `doctor` (its gateway line is information,
  never a failure), the workflow settings, OmniRoute and Warp all work without a gateway, and
  `doctor` matters most on a machine that has none. What
  does need the config says so in a short line instead of an invented value: the header's
  router pill, the OmniRoute card's Backend line, the card at the foot of Machine, and the
  privacy page's sentence about the router. A config that is there but unreadable is named
  with its own error (`configExists` tells the two cases apart).
- **A bug in a page is never shown.** `Bun.serve` has an `error` handler (`development:
  false`) that answers the one line `Internal Server Error` with the usual security headers: a
  stack names the source file and the line, and holds this machine's paths.
- **There is no sign-in (D9).** The portal starts with Claude Code and stays up; a page load
  from this machine is served, so any program and any user account on this machine — a Claude
  session using `curl` included — can read and change what it shows. The owner chose that
  trade-off against pairing the browser once. What replaces the refusal: the door below, and
  the session-escape guard, which asks the person before a session's shell command reaches the
  portal's port.

### How it starts (D10)

- **A SessionStart part starts it**, like claude-mem's worker: the update-check hook resolves
  the portal bundle of the version Claude Code records as installed and starts it detached
  with `--ensure` (`src/portal/session-start.ts`, `src/portal/lifecycle.ts`). The hook waits
  for nothing and prints nothing; the starter does the probe, the copy and the start.
- **Never in `claude -p`** (`CLAUDE_CODE_SESSION_ATTENDED=0`), and never on a `clear` or a
  `compact` of a session that is already going: only `startup`, `resume` and an input that
  does not say.
- **The decisions, by the health answer on the one fixed port** (`GET /healthz`: the
  portal's name, pid and version):
  - nothing answers → the copy is refreshed from the installed version through
    `writeManagedFile`, and the server is started detached, with no terminal and its own
    process group, its lines going to `<stateDir>/portal.log`;
  - our own version answers → nothing;
  - an older version answers → that pid (the one that answered) gets SIGTERM, the starter
    waits for the port, and starts this version;
  - a newer version answers → it is left alone: an older install never replaces it (a
    rollback, or an old session's hook after an update);
  - another program holds the port → nothing starts, and one line goes to the log — once,
    not at every session start (`noteHeldPortOnce`).
- **Two sessions at once** each start a starter; one wins the port, and the other finds it
  answering. **A crash** is brought back by the next session start: the probe finds nothing.
- **`cc-smart-dev-kit portal`** makes the same decision in the command itself, then opens
  the page (never in Chrome's `claude-code` profile). `portal status` says what runs and on
  which version (exit 1 when it does not), and `portal stop` signals the pid that answered
  and waits for the port to be free. `doctor` has one line: running (its address and
  version), not running (`·`), another program's port (`✗`).

### The door

`src/portal/guard.ts` is the whole door, pure and tested on its own. Every request, in order:

1. **`Host` exactly ours**: `127.0.0.1:<port>` or `localhost:<port>`, or 403. A page at
   `evil.example` whose DNS points here reaches the portal and gets 403 — that is where DNS
   rebinding stops.
2. **`Origin`, when present, ours**: `http://127.0.0.1:<port>` or `http://localhost:<port>`.
   On a POST it must be present at all: a browser sends `Origin` on every POST, so one
   without it did not come from a page of this portal. **And no other page's load**
   (`fetchSiteAllowed`): anything that is not a navigation (`Sec-Fetch-Mode: navigate`) must
   carry `Sec-Fetch-Site: same-origin` (our own page) or `none` (typed, a bookmark). A page on
   another `127.0.0.1` port is the SAME site, so its `<img src>` was served before this rule
   existed. A request with no `Sec-Fetch-Site` at all is not from a browser that sends it
   (every current one does); the other rules judge it. The stylesheet and the scripts are
   behind this rule too.
3. **A POST carries the CSRF token** that came with a page of ours (`x-ccsdk-csrf`), compared
   in constant time. Nothing else changes anything. The token is made once when the server
   starts and lives in its memory: stopping the portal makes every page's copy dead.

There is **no session and no one-time token** (D9): a GET that passes the rules above is
served, and the address carries no secret. A `Host` or `Origin` refusal, and every refused
POST, are the plain one word, `Forbidden`.

`GET /healthz` is answered through the network rules alone (a read that changes nothing):
the portal's own name, its pid and its version, which is what tells this portal apart from
any other program on the port.

Every answer carries a strict `Content-Security-Policy`: `default-src 'none'`, `script-src
'self'` with no `unsafe-inline`, `style-src 'self'`, `connect-src 'self'`, `form-action
'self'`, `frame-ancestors 'none'`, `img-src 'self' data:`. So no script may be inline, every
handler is `data-*` and an `addEventListener`, no markup carries a `style` attribute (the one
number that must be a value — a meter's width — travels as `data-percent` and the browser
script applies it; `[hidden] { display: none !important }` keeps that working where a class
says `display: flex`), and nothing comes from the internet: no web font, no CDN, a local font
stack. The stylesheet and the two scripts are served by the portal itself (a page cannot draw
without them).

**Keys never reach the page.** Every backend's key goes through `maskKey`, which shows its last
four characters and nothing else (`••••a1b2`; a key shorter than 12 characters shows `••••`), and
a whole key is never in a page, a JSON answer or a log line. A backend's address is shown and
linked (the OmniRoute dashboard) only as `backendAddress` gives it (`src/gateway/settings.ts`):
no user name, password, query or fragment, where a credential can ride. A backend's own error
text — a model list's parse error, a chat's error body, the judge test's detail — goes through
`shownDetail` (`facts.ts`: every URL redacted, the backend's key and anything shaped like one
masked, one line) before a page or an action's answer holds it: a backend can echo the key it
was sent.

**The auto-mode trust rules are written only as shown.** The Machine page's card is the
command line's own dry run (`autoModeChange` in `actions.ts`): `+` for a rule that goes in, `-`
for one the project dropped, and `setup`'s note when a worktree's file differs from the main
checkout's. Its button carries the hash of that change, and `automode.apply` plans it again
under setup's lock and writes nothing when the hash differs: the portal runs in a folder a
session can write, and a rule added after the page was drawn would otherwise be trusted unread.

**It stays up until it is stopped** (D10): no idle clock, so it is there whenever the person
opens it. `cc-smart-dev-kit portal stop` ends it, and a plugin update replaces it at the next
session start. The trade-off is D9's: the page is open to every program and account on this
machine, which is why the door above and the session-escape guard matter.

**A page's own reload is not a request of the person's.** The Health page asks for itself
every five seconds; the page's script stops reloading while the tab is hidden
(`document.hidden`, `visibilitychange`) and looks once more when it comes back.

**The log is newest first, on both pages** (the owner, 2026-10-17: a log read top down the way
`journalctl` prints it puts the line a person opens the page for at the bottom). `routerLog`
(`facts.ts`) keeps the journal's own order — oldest first, which the caller of a page shares —
and the pages reverse it in ONE place: `newestFirst` (`views.ts`), used by the Health page's Log
(newest 120) and by the Overview's "Latest warnings" (the newest three that are not INFO). The
times are the journal's own, unchanged. The server-rendered pages are a full reload, never a
live insertion; the Next.js pages read the stream below.

### Live: the stream, the JSON API and the export (B6b)

**`GET /events` is the live stream** (D51): Server-Sent Events, one-way, through the door's
network rules alone (it changes nothing, and reads need no token under D9). `src/portal/live/`
holds it: `hub.ts` the streams and their format, `sources.ts` what changes. The hub keeps:

- **at most `MAX_STREAMS` (8) at once**, and answers the next connection 429: a page left open
  in every tab must not hold the server's memory without end;
- **a ping every `PING_MS` (15 s)** on every stream, so a closed window or a sleeping laptop is
  noticed and a page can say "reconnecting" rather than show stale values;
- **`Last-Event-ID`**: every event carries `<boot>:<sequence>`, the last `BUFFER_MAX` (512) are
  kept, and a reconnect replays what it missed. An id from another run of the portal, or older
  than the buffer, gets one `reset` event, and the page fetches its answers again;
- **`closing`** when the portal stops for a new version: every stream is told, then closed, and
  the page reloads onto the new portal.

The sources are polled on one timer (`LIVE_POLL_MS`, 2 s): the router's `recent` list from its
health answer (metadata only), the crew store's `events.jsonl` by byte offset per repository,
`gateway-state.json` (limits, fallbacks, an open breaker, `seenClaude`), `guard-asks.jsonl` by
byte offset, the last update-check record, and the heavy-job queue (its lease and ticket
folders' fingerprint, with the queue read only when it changes). The doctor pass and an
action's lines are not polled: the server publishes them when it has them.

**`GET /api/…` is the JSON the Next.js pages fetch** (`src/portal/api/`): `overview`, `slots`,
`health`, `machine`, `settings`, `projects`, `projects/<id>`, `work`, `crew/<id>`, `flow`, `needs`,
`guard-asks`, `worktrees`, `update`, `jobs`, `history` and `requests`, all read-only and all
through the door. Each answer is built from the same readers the server-rendered pages use
(`page-data.ts` is the one home: `server.ts` and the API both call it), so a page and an answer
can never disagree. `work` is the lead and its crew nested plus the other sessions; a crew page
carries its brief, its log, the diff against its base, its report, the reviews recorded on its
branch and the merge check's verdict; `needs` is everything waiting on the person (a crew
question with its options, an open permission prompt, doctor's failures, an open breaker, a
held major version). `history` and `requests` read the router's request log through its own
reader (`src/gateway/history-read.ts`, H1): `historySeries` answers one series per `by` key,
every bucket of the range as zeros where nothing happened, and `recentRequests` pages the
newest rows by id, both with the `slot`, `target`, `model`, `session` and `status=error`
filters; a machine with no database yet answers empty with a note, never an error. Nothing
carries a key or a prompt.

**The heavy-job queue is one reader** (`src/jobs/status.ts`: `readJobs`, `jobsAnswer`,
`statusLines`, `jobsFingerprint`): `job status` prints its lines, `/api/jobs` answers its
shape (`{ memoryGb, freeGb, budgetGb, keptGb, stores: [{ where, freeGb, budgetGb, held,
waiting, note? }] }`), the Machine page shows the same lines, and the `jobs` event carries the
same shape. There is no parser of printed lines anywhere.

**The Next.js export ships inside the plugin** (D49, `plugin/portal-ui/`): built from
`portal/` by `scripts/portal-export.ts` (`bun run build:portal`) and committed like the
bundles, because it is what a machine gets — never `node_modules`, never a Next server. It is
not part of `bun run build`: that step must not need React's dependencies, and CI proves the
export current in its own step (`bun run check:portal`, a byte-for-byte rebuild). The export
is reproducible because `portal/next.config.ts` fixes Next's build id (`generateBuildId`);
without it two builds differed in that id alone. The starter copies it beside the running
bundle, into `~/.local/share/cc-smart-dev-kit/portal-ui/`, through `writeManagedFolder` (a
folder the kit owns whole: a new folder, then a rename; no backup, and `restore` removes it),
and a version whose plugin has no export removes that copy. The server is then given the path
(`staticFolder`), and serves it (`src/portal/static.ts`): one `index.html` per route
(`trailingSlash`), and `_next/static/*` served like `/assets/*` (build output, no machine
facts). Each HTML page gets `<meta name="ccsdk-csrf" content="…">` inserted after its charset at
serve time; the content policy is built from the export's `csp.json`
(`{ styleAttr, styleElem }`, hashes written at build time): `style-src 'self'` plus the
`styleElem` hashes, and `style-src-attr 'unsafe-hashes'` plus the `styleAttr` hashes — the
owner's yes to D49's one loosening, for the exact values the export writes. `script-src` stays
`'self'`. A path never leaves the folder. A route the export does not have falls back to the
server-rendered page, and with no export folder at all the server-rendered pages answer as
before: the switch-over costs nothing.

### The page side: the client, the stream, the actions (B6c)

**One client, chosen in one place** (`portal/src/api/client.ts` › `portalClient()`): the live
client on a page the kit's server serves, the mock client with `?mock=<state>` in the address
or under `next dev` (and then the header says "Mock data"). The live client fetches
`GET /api/…` on the same origin and nothing else; each answer goes through `adapt.ts`, the one
translation into the shape its page draws. A fact the server does not send yet is `null` there
and the page says it does not know (the Machine page's Claude Code and Bun versions, the
router's socket unit, a project's last use): never a value made up to fill a field.

**The API types have one mirror** (`portal/src/api/wire.ts`): every type
`src/portal/api/types.ts` exports, by the same name, written out because the server's file
imports Bun, zod and the gateway, which the app cannot bundle. `src/portal/api/wire-mirror.ts`
checks each pair with the type checker (assignable both ways, the same fields; one way only for
the Project card's opaque `workflow`), and `wire-mirror.test.ts` fails when a server export is
not checked, when the type checker refuses the mirror, or when the app's list of actions is not
`ACTION_NAMES` (`src/portal/actions.ts`). So a changed shape on either side fails `bun test`,
not a page. Generating one from the other was the other choice; it was not taken because the
server's types are built from zod schemas and modules the app has no access to.

**One stream for every tab** (`portal/src/api/stream.ts`): the tab that holds the Web Lock
`ccsdk-portal-events` opens the one `EventSource('/events')` and passes each event to the
others over a `BroadcastChannel`; the next tab takes over when it closes. `EventSource`
resumes by `Last-Event-ID` by itself; a stream that ended for good (an error status) is opened
again after 2 s, doubling to 30 s, and since a new stream has nothing to resume from, the page
is told to `reset`. The header shows "Reconnecting…" while there is no stream. After `closing`
the page reloads once the new portal says `hello` — the one reload, because the new version's
files are new.

**A page reads again when its events say so** (`useResource(read, key, refreshOn)`, the rules in
`portal/src/api/refresh.ts`): in the background, gathering a burst for 300 ms, and keeping what
it shows until the new answer is there. The Overview and Health ask every backend for its model
list, so they read again on `state`, not on each routed request; the Overview adds each
`recent` event to its count instead. `reset` makes every resource read again.

**An action runs in place** (`components/action-button.tsx`, `useAction`): `POST
/api/<action>` with the page's CSRF value; while it runs, its newest `action` line from the
stream; then its result beside the control (`✓`, or `✗ Not done:` with the command's own
words, Details and Try again). A change that restarts or rewrites something asks first in a
native `<dialog>` (`confirm-dialog.tsx`: `showModal()` writes no style, unlike a Radix dialog
under the strict policy), with the safe answer focused. No page is ever reloaded to show a
result (PX-4). A draft (a chain being edited, a setting being changed) holds only while the
server still holds the value it was made from: the Slots card then says "This chain changed
elsewhere" with Load it / Keep mine, and `slot.save` carries the chain's `stamp`
(`slotStamp`, `src/portal/facts.ts`) so the server refuses a save over a newer chain.

**An action never blocks the server.** Every command an action starts with a child is spawned
asynchronously (`Bun.spawn`, with its timeout), not with `Bun.spawnSync`: `claude plugin …` can
take up to 300 s, and the synchronous version froze every page, every action and the stream for
that long — the owner's "lag" bug. The runner's type (`src/update/apply.ts`'s `CommandRunner`)
accepts a promise, so `update.install` awaits the same `applyUpdate` the command line runs; each
step's last line and the action's result go out on the stream (`action` events), so a page shows
the install as it happens. The new actions for D52 — `crew.answer`, `crew.stop`, `crew.resume`,
`crew.rm`, `worktrees.clean` — call the CLI's own functions (`src/crew/`, `runWorktrees` with
its own sinks), not a copy; `worktrees.clean` needs the page's confirmation.

### What it runs from

A copy in `~/.local/share/cc-smart-dev-kit/portal.js`, never the plugin's version folder:
Claude Code deletes an old version folder some time after an update, even under a running
process. The starter and `cc-smart-dev-kit portal` write the copy through `writeManagedFile`
and the export beside it through `writeManagedFolder` (so `restore` removes both), and the
server always runs from it, detached: no terminal, no
pipe, and its lines go to its own log (`<stateDir>/portal.log`). A person who runs the copy
by hand gets the same server in their terminal, with the address printed and Ctrl+C (exit
130, "ended by SIGINT") to stop it. It is a bundle of its own (`src/entries/portal.ts` →
`plugin/dist/portal.js`), so nothing about it changes `router.js` (a changed router bundle
restarts every machine's router).

**The copy sits outside the plugin, so it is told where the plugin is.** The parent passes its
own folder (`--plugin-dir`, and `portal --plugin-dir` is refused as an unknown option: a
person must not point the portal at another folder, which would let it install that folder's
router bundle). Each file the portal needs — the router bundle a restart installs
(`dist/router.js`), the instructions, `hooks/hooks.json` — is then resolved from the version
Claude Code records as installed **at the moment it is needed** (`resolvePluginFolder`,
`src/portal/plugin-folder.ts`), falling back to `--plugin-dir` while that still exists. Two
reasons, both found live: a path made from the copy's own folder resolves
`~/.local/plugin`, where none of those files are (the restart threw ENOENT, and the Machine
page's doctor skipped its router-copy check without saying so); and a run that outlives the
version folder it started in (the portal now stays up for days) makes a path made at startup
go stale. With neither folder there, the action says so in words and stops — the doctor pass
reports it as one failed check — rather than reading a path that is gone.

### What a page cannot know

Two numbers the design's mockups show are not invented, and the pages say so instead:

- **Claude Code's plan-usage percentages.** Claude Code computes them from the headers of its
  own answers and hands them to the status line on stdin (`src/cli/statusline.ts`); nothing
  writes them down. The router records only the limits it saw — which model, which window,
  when it resets — and that is what the Overview shows, with a line naming where the
  percentages live.
- **OmniRoute's prices and image support.** They are in OmniRoute's own catalog, which the
  gateway never reads: `/v1/models` carries an id and a context length, and that is all the
  model table shows.

## OmniRoute

The affordable slots answer through OmniRoute, a program a person installs themselves (a
global Bun or npm install) and runs as a user service (`src/omniroute/`).
`cc-smart-dev-kit omniroute status|update|rollback` keeps it on a version that has had a few
days to prove itself. `doctor` says, as information, when one is waiting.

- **Nothing about one machine is written into the plugin.** The unit is found by reading
  `~/.config/systemd/user/*.service` and taking the one whose `ExecStart` runs OmniRoute; the
  install is found from that command line by walking up to the package's own manifest. With
  no unit, Bun's and npm's global folders and the `omniroute` on PATH are looked in. The
  backend that talks to it is the one named `omniroute` in `gateway.json`, else one on this
  machine whose port the unit's `Environment=` or `EnvironmentFile=` names.
- **Three days.** `newestRelease` reads `https://registry.npmjs.org/omniroute` and takes the
  newest plain `x.y.z` with a published time at least three days old. A canary, a version
  published today and a version the registry has no time for are all left out. A release that
  reaches a machine the hour it is published reaches it before anyone else has run it, and
  OmniRoute is the model path of every affordable slot here.
- **The update.** Record the version it replaces in `<stateDir>/omniroute.json`; install
  through the manager that owns the install (`bun add --global omniroute@<v>`, or
  `npm install --global`); `systemctl --user restart <unit>`; wait until the backend answers
  `GET /v1/models` at all — up to a minute, with a growing pause between tries (`waitForBackend`,
  refused connections are "not listening yet"; an HTTP answer, 401 included, ends the wait);
  then check the model path (`probeModel`, `src/gateway/backends.ts`): `GET /v1/models` with
  the backend's key — a 401 is named as the key, not the version — and one tiny chat to the
  first affordable target of the scout slot (`PROBE_PROMPT`, a fixed word of the plugin's own;
  nothing from a conversation, the machine or the person is sent). On any failure: install the
  old version again, restart, wait and check the same way, and print what failed. The wait is
  why a good release is not rolled back for being slow to listen: `systemctl --user restart`
  returns before OmniRoute binds its port.
- **Record, install, restart and check are one change, under setup's lock** (`withLock`): a
  second `update` or `rollback` — a terminal and the portal, or two terminals — waits for the
  first, and says who holds it when the wait runs out. `rollback` takes the same lock.
- **A folder this user cannot write is refused before anything is recorded or run**
  (`installIsWritable`: the package's folder and the one holding it). A global install under a
  root-owned prefix fails with EACCES halfway through, and the put-back then "fails" the same
  way though nothing changed; the command to copy (`sudo <manager> …`) is printed instead, and
  `sudo` is never run.
- **`--to <version>` follows the three-day rule** (`toRefusal`). It must be a plain `x.y.z`
  that the registry lists and that is at least three days old; a version published this
  morning, a canary, a `https://…` tarball and a `github:…` spec are refused in words and
  nothing runs — `bun add --global omniroute@<spec>` would otherwise install whatever npm
  resolved the spec to. A version npm marks deprecated is not offered by `newestRelease`
  either, and can never be named by `--to`.
- **Never in the background, and never inside a Claude Code session.** It restarts a service
  that answers real requests, so a person runs it, sees each step and reads what failed; and a
  session must not move its own model path mid-turn. The confirmation says what the restart
  costs: while the unit comes back, a slot whose fallback is on falls to its next target,
  and one whose chain is used up fails.
- **`rollback`** installs the recorded version and keeps the record, so a second rollback is a
  no-op rather than a bounce.
- **Every effect goes through an injected `runner`, `registry` and `fetch`**, so a test uses a
  fake bun, a fake systemctl, a fake registry and a fake backend, and never reaches the real
  OmniRoute, the real registry or systemd (`src/omniroute/omniroute.test.ts`).



Before 0.3.0 the plugin's own names — the plugin and marketplace, the command, the
folders, the gateway's slots and the router units — said `anymodel`.
`cc-smart-dev-kit migrate` (`src/cli/migrate.ts`) moves such a machine, and that file is
the only code that still names them (with its test, and `README.md` § Moving from
anymodel). It:

- moves the folders (`~/.config`, the state folder, `~/.local/share`, `~/.local/state`)
  and the launcher file, and rewrites the state folder's records and backups — the file
  paths in `owned.json`, `owned-entries.json` and `changed.json`, each entry's
  `baseline`, and each backup's folder and file name — so `restore` still finds what the
  old setup changed and can still undo it;
- gives the settings keys the old setup owned (and that still hold its value, the
  remembered-value rule) this version's value: the slots' names and the words of their
  descriptions;
- rewrites the instructions block's markers and import path, then refreshes the copy
  through `installInstructions`, the one path `setup` uses;
- renames the gateway config's slots and adds an alias for each old name, so a Claude
  session that is still running (its settings name the old slots) keeps working until it
  restarts;
- replaces the `anymodel-router` units through the gateway's own install path
  (`installRouter`), after stopping and disabling the old ones with `--no-block`, as
  `restore` does;
- says to uninstall the old plugin, and does it after a yes on a terminal.

It refuses to run inside a Claude Code session: it replaces the router that session's own
model traffic goes through. It also stops before writing anything when a target folder is
already there — two folders are never merged by themselves. Every step prints one line,
each changed file gets a backup first, and `--dry-run` writes, runs and stops nothing. A
second run says "Nothing to move.". One thing does not carry over: a judge target's test
proof (the proof's own text changed with the name), so a judge needs its test again.

## Moving a machine from the old names (0.3.0)

Before 0.3.0 the plugin's own names — the plugin and marketplace, the command, the
folders, the gateway's slots and the router units — said `anymodel`.
`cc-smart-dev-kit migrate` (`src/cli/migrate.ts`) moves such a machine, and that file is
the only code that still names them (with its test, and `README.md` § Moving from
anymodel). The command has a fixed order, and the order is the point of it:

1. **Refusals.** Inside a Claude Code session (it replaces the router that session's model
   traffic goes through), and on a Bun older than `MIN_BUN`.
2. **Read and check everything, before anything moves.** The new plugin's install; the
   folders (two are never merged silently); the new state folder, which the move may go
   into when it holds nothing but this plugin's own bookkeeping (a Claude session's start
   writes its `sessions/` record and an update check there before anyone runs `migrate`) —
   anything else in it stops the run, naming what is in each folder; the gateway config
   (readable by its owner alone, and **the whole rewritten config through the schema**, so
   a rewrite that would not be valid is refused here, not after the move); the settings;
   the records (`owned.json`, `owned-entries.json`, `changed.json`); and the Claude
   sessions that started with the old plugin and still run.
3. **Every question**, before a single byte is written: the router restart (only when the
   old router runs) and the old plugin's uninstall (only when it is still installed, and
   only ever on a terminal). A "no" — or no terminal to ask on, and no `--yes` — stops
   with nothing written: a machine that moves without replacing its router would be left
   half moved.
4. **A dry run stops here**, with the plan: the steps it would do, the changes each would
   make, and the question it would ask. It reads the state folder and the records of the
   old names, so its plan is exactly what a real run does.
5. **The moves and the rewrites**, each recorded as it finishes in
   `<stateDir>/migrate-progress.json` (mode 600, removed when the move is done): the
   folders and the launcher file; the state folder's records and backups (the file paths
   in `owned.json`, `owned-entries.json` and `changed.json`, each entry's `baseline`, and
   each backup's folder and file name) so `restore` still finds what the old setup
   changed; the settings keys the old setup owned (and that still hold its value, the
   remembered-value rule — a key the person changed *or removed* since is theirs); the
   instructions block's markers and import path, then the copy through
   `installInstructions`, the one path `setup` uses — **when a block is there**: 0.2.x
   shipped no instructions, so a 0.2.x machine has none, and the move installs none and
   says so in its closing lines (`instructionsToSetup`); the gateway config's slots, with
   an alias for each old name so a session that still holds one keeps working, and an alias
   of a project's own that pointed at an old slot pointed at the renamed one (an alias to
   an alias would make the whole config invalid); the limit state's fallback keys; and the
   launcher's text for this version.
6. **The router.** The old units **whose files are there** are disabled and stopped
   (`--no-block`, one call each, socket first) — a 0.2.x machine has no socket unit, and
   `systemctl disable` on a unit that does not exist fails, which must never stop a move
   (`stopUnits` in `src/gateway/service.ts`, shared with `restore`). Then the old
   router's **own** health page (`/__anymodel/health`) is asked until the port is refused
   or that page stops answering (15 s, bounded); only then are this version's units
   installed through the gateway's own path (`installRouter`) and its health page checked.
   A router that never lets go fails this step, and the step says so.
7. **The closing lines**: restart every session; test the judge again when the old config
   had a tested one (its proof names the old command, so it does not carry over); and the
   old plugin's uninstall commands.

A step that fails prints which step, what the steps before it did (kept), and that running
`migrate` again goes on from there: each step is safe to repeat, and a resumed run skips
the steps the progress file records. "Nothing to move." is not only about the folders
being gone: `oldPiecesPresent` also counts an old slot name in the gateway config, the old
markers in `~/.claude/CLAUDE.md`, an old path in a record or in a backup's name, and an
unfinished run's progress file. Every changed file gets a backup first.

The old names live in one table (`OLD`), and the units the router step works on — both
pairs' names, their folder, and the port — are one injectable table
(`MigrateOptions.router`), so a live check runs the whole command against throwaway
runtime units on a free port without touching a real machine's router.

`renamedPath` renames only the paths this move actually moves (the four folders, the
launcher file, the two unit files): a path of the person's own that happens to carry the
old word in a segment is not ours to rename.

Verified live, with real `systemctl --user` on throwaway runtime units
(`amtest-old-router.service` in `/run/user/<uid>/systemd/user`, a fake old router on a free
port, removed afterwards) and a scratch HOME: the real `systemctl disable` of the socket
unit file a 0.2.x machine never had fails with "Unit … does not exist" (shown first), and
`stopUnits` then skips it, disables and stops the service for real (a read-only `is-active`
after it says `inactive`), and throws nothing; the old router's health page is waited for
against a real server on a real port — held while it answers, and `free` only once the port
is refused. The half that starts and enables this version's units (`installRouter` runs
`systemctl --user enable` and `start`) still has to be run where a check may start a
service; `MigrateOptions.router` is what it needs.

## Updates

Claude Code's own plugin auto-update (`autoUpdate: true`, which `setup` turned on before
0.7.0) did not run on a machine where it was on: 15 minutes after a session started, not
even the marketplace copy was refreshed (anthropics/claude-code#61854). The same two
commands by hand worked at once. So the plugin updates itself (the owner's decision,
2026-10-15). Since 0.7.0 it is the only updater (D39): Claude Code's own auto-update is off
for this marketplace, because it knows nothing of the major hold below and would install a
major version by itself the day it runs.

- **Claude Code's own auto-update off** (`src/setup/auto-update.ts`). Claude Code 2.1.306
  decides by the first of three that is set: the settings' `extraKnownMarketplaces.<name>.
  autoUpdate`, then the `autoUpdate` in its own `known_marketplaces.json`, then its default
  (off for a marketplace that is not Anthropic's). A session start copies a settings value
  into that record, and copies nothing when the settings have none. So a removed key leaves
  an older `true` in the record, and auto-update stays on; only an explicit `false` in the
  settings turns it off (proved live: `claude-code-contract.md`). `setup` manages the key at
  `false`, with the usual ownership rules: an older setup's `true` is its own and becomes
  `false`; a `true` the person set stops setup (`ForeignKeyError`). A machine that reached
  0.7.0 through the background update never ran setup, so each background check first turns
  setup's own leftover `true` to `false` (`turnOffLeftoverAutoUpdate`: `applyManagedJson`
  under the state lock, with no wait), and nothing else: a key a `restore` took away is not
  put back, and a `true` of the person's stays. Every failure there (a busy lock, the
  person's value, a broken settings file) is one line in `update.log`, and the check goes on.
  `doctor` passes while nothing turns it on, and fails on a `true` in the settings (setup's:
  run setup; the person's: remove it by hand, then setup) or in the record.

- **The SessionStart hook** (`src/entries/update-check.ts`, logic in
  `src/update/background.ts`) records which version the session loaded, and starts the
  check in a **detached** process (its own session, no pipe to the hook) when one is due:
  at most once an hour per config folder, and not while updates are held. It needs no
  network and no lock, and returns at once (about 60 ms on a loaded machine, most of it
  bun's own start). It prints nothing, unless the last background check failed and no
  session was told yet, or a major version is held (below): then one `systemMessage`, to
  an attended session only (Claude Code sets `CLAUDE_CODE_SESSION_ATTENDED=0` for the hooks
  of `claude -p`; such a session neither shows it nor counts as told). It runs bun through `plugin/bin/cc-smart-dev-kit-bun.sh`,
  which looks where the launcher does, so a Claude Code started with no bun on PATH
  still runs it.
- **Claude Code's switches for updates are honoured.** While `DISABLE_AUTOUPDATER`,
  `DISABLE_UPDATES` or `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC` is set (environment or
  the `env` of `settings.json`) and `FORCE_AUTOUPDATE_PLUGINS` is not, the hook starts
  nothing and only records "skipped: <name> is set"; the background check asks again
  under its lock. One list for both, and for `doctor`: `src/update/opt-out.ts`.
- **The background check** takes the update lock (`<stateDir>/update/lock`, the same
  `withLock` as setup, but its own file, so a slow update never blocks `cc-smart-dev-kit setup`),
  asks again whether a check is due (two sessions starting together check once), then
  compares the remote head (`git ls-remote`) with Claude Code's copy, and the installed
  version with the copy's (`src/update/check.ts`). When either is behind it runs `claude
  plugin marketplace update cc-smart-dev-kit`, then `claude plugin update cc-smart-dev-kit@cc-smart-dev-kit
  --scope user` when the copy holds a newer version; logs each step to
  `<stateDir>/update.log`; records the result in `update-check.json`; and shows one
  desktop notification when a new version was installed (with the `gateway setup` hint
  when its router differs from the running copy). The detached process and both commands
  run in the home folder, without git variables that point at another repo (`GIT_DIR`,
  `GIT_INDEX_FILE`, …, which a session inside a git hook may carry). A command's output
  that goes into a record passes through the URL redaction. Not failures: a marketplace
  that cannot be read is `unreachable` (information) until it has been so for 24 hours in
  a row, and Claude Code's own refresh holding git's `index.lock` at that moment is
  `skipped`.
- **`cc-smart-dev-kit update`** does the same in the terminal, with each command's output;
  `--check` only reads (the remote's version comes from a shallow fetch into a temp
  folder, never from Claude Code's copy); `--hold` / `--resume` switch the background
  update off and on for this machine, with one atomic write and no lock, and say so when
  a check is running now (it finishes).
- **`doctor`** shows the last check and its result, the hold, and running sessions that
  loaded an older version than the one installed now.
- **A major version waits for the person (D33, since 0.7.0).** A new major one may need the
  person's own work first (1.0.0 refuses the retired worktree fields), so it must not reach a
  machine behind their back. `applyUpdate` (`src/update/apply.ts`) refreshes the
  marketplace, and when the copy's version is a new major one (`isNewMajor` in
  `src/update/major.ts`: the first number grows, compared with `Bun.semver.order`; a
  version it cannot read is no major step) it asks its caller first (`onMajor`). The
  background check says no: it installs nothing, records `skipped` with the reason, and
  writes `<stateDir>/update-major.json` (the version, the version installed then, when it
  was first found, and the why). The hold is its own file, not a new result in
  `update-check.json`: an older version's hook refuses a result it does not know, counts the
  record as no check, and would check again at once. A later check that finds the install
  current (installed by hand, or the release taken back) removes the file.
  - **The session start** shows one line while the file names a version above the installed
    one: "cc-smart-dev-kit 1.0.0 is ready: it is a major version (it refuses old project
    fields). Read What's new, then run `cc-smart-dev-kit update`." Only when the hook's
    input says a session starts (`source` `startup` or `resume`, or no `source`), never on a
    `clear` or a `compact` of the same session; to an attended session only; after a failure
    to tell, in the same `systemMessage`. `update --hold` and Claude Code's switches for
    updates come first: they silence it.
  - **The why comes from the new version.** The running code is the installed version's: it
    cannot know why a later major is one. So each major names its reason in
    `src/update/major-notes.json` (`{ "1.0.0": "it refuses old project fields" }`), and the
    check reads that file from Claude Code's marketplace copy (the new version's repo, just
    refreshed) at `MAJOR_NOTES_PATH`, keeping only short one-line notes of the majors the
    step crosses. Every installed version reads that path, so the file never moves; a test
    keeps the current major's note in it. Without the file the line has no why.
  - **`cc-smart-dev-kit update`** is the person's yes. Before it installs a major version it
    prints that it is one and lists the repos that still carry a retired piece (below); then
    it installs, and asks for `cc-smart-dev-kit setup` (a major version's own one-time steps
    run there). The hold's file goes only once the version it holds is really installed
    (`!isOlder(after, held.version)`): a failed install, or a `claude plugin update` that
    ends well and installs nothing, keeps it, and `update` says on stderr, with exit 1, that
    the major version still waits. `update --check` says when the newer version is a major
    one, and `doctor` shows a held major as a `·` line naming `update`, never `claude plugin
    update` (which would skip the hold).
  - **The repo list** (1.0.0, `src/update/retired-repos.ts`), printed by `update` before a
    major and by every `setup` run (`--dry-run` too): the folders Claude Code's saved
    sessions name (`sessionWorkFolders` in `src/sessions/command.ts`, the same reader
    `sessions` uses: one file per project folder, its newest), each taken to its own checkout
    root and, beside it, to the main checkout: a linked worktree's own file wins over the main
    checkout's, as `loadProjectConfig` reads it, so a long-lived worktree on an older branch
    is its own finding; a folder that is gone or not in git is skipped. A checkout is listed,
    one `!` line with `cd <checkout> && cc-smart-dev-kit project init` (a worktree's line names
    the main checkout too), when its `.claude/cc-smart-dev-kit.json` sets a retired field
    (`retiredFieldsOf`, over `RETIRED_WORKTREE_FIELDS`), is not valid JSON (with the error), or
    one of its two settings files runs an engine hook (`retiredEngineHookOf`). Read-only: no
    other repo is ever written.
  - **An installed version that cannot be read is no major step.** `installed_plugins.json`
    may name no version (`findUserInstall` gives null), or one that is not a version: then
    `isNewMajor` is false, and the background check installs the newer version as before.
  - **A version before 0.7.0 does not know this rule.** Its background check (0.6.0's
    `applyUpdate`) installs whatever is newer. A machine follows the new rule only once a
    session has loaded a version that has it; a session still on the old version that runs
    its SessionStart again (a `/clear`, a compaction) most likely runs the old hook (its
    plugin folder is fixed for the session; not proved). So 0.7.0 ships before 1.0.0, on
    its own, to reach the machines first.

The trade-off, accepted: a bad release reaches every machine within the hour, without a
person running anything. A rollback is a new, higher version, which reaches them the same
way; `--hold` keeps one machine where it is. Proved live: a real Claude Code session's
SessionStart hook started the background check, which outlived the session and ran both
`claude plugin` commands, in a throwaway config folder (`claude-code-contract.md`).

## Per-project opt-in: `.claude/cc-smart-dev-kit.json`

The plugin is installed for the user, so it runs in every project. A project opts in,
and gives its own details, with `.claude/cc-smart-dev-kit.json`:

```json
{
  "requires": ">=0.1",
  "worktrees": { "base": "main", "bases": { "release/": "main" } },
  "instructions": true,
  "autoMode": ["In my-app: never touch production."]
}
```

The hooks use `worktrees`, `protectedBranches` and `sessionNames` (§ The hooks). The plugin
accepts `instructions` and `autoMode` now: `setup` uses `autoMode` (§ Auto mode reads only
user settings), and the opt-in instructions load through the project's own import line
(§ Instructions, skills and agents), so `instructions` does not load them yet. `workflow`
holds the project's policy for what cc-smart-dev-kit may do by itself (§ The workflow).

Two fields came with 0.4.0: `worktrees.bases` (a branch-name prefix to the base a worktree
of such a branch starts from, § Worktrees) and `workflow` (§ The workflow). Both are optional
and nothing else about the file changed, so a project that writes one raises its `requires`
to the release that brought it — which is what `project init` writes.

**The retired engine's fields are refused** (D20, 1.0.0): `worktrees.prefix`,
`worktrees.setup` and `worktrees.engine` (`RETIRED_WORKTREE_FIELDS` in
`src/project/config.ts`) were the plugin's own worktree engine's, and every project uses
Claude Code's own worktrees now. The parse is one function, `checkCcSmartDevKitConfig`, in one
order: `requires` first, then the retired fields, then the strict parse. A retired field gets a
message of its own per field ("`worktrees.prefix` is no longer supported: remove it — Claude
Code's own worktrees need none. `cc-smart-dev-kit project init` removes it"), never the strict
parse's "unknown field (a newer cc-smart-dev-kit may be needed)", which would send the person to
update instead. Its error class, `CcSmartDevKitRetiredFieldError`, is a config error like any
other to every reader — the guards ask, `doctor` fails, the merge guard's committed read names
it — and exists only so the portal's Project card still offers its write, which is the fix.
Every reader goes through it: a file on disk (`loadCcSmartDevKitConfig`), the file as
committed on a branch (`readCommittedConfig`), and the object `workflow set --project` is about
to write (`src/workflow/write.ts`). `ownHooks` is still read on its own, and never throws.
This is a stricter precedent than the retired hook name `serena-root`, which `ownHooks` still
accepts: a project file that sets a retired field fails closed until `project init` cleans it.

- A hook finds the project from its input's `cwd`, which follows the session into a
  worktree. A worktree's own `cc-smart-dev-kit.json` wins; else the main checkout's is used. A moved
  or deleted main checkout, and git older than 2.31, each give a clear error.
- **`requires` is checked before the strict parse.** A project may use a field newer
  than a user's plugin; that user is told to update, not that the field is unknown.
- **Without `cc-smart-dev-kit.json`, the plugin does Claude Code's default** and its guards stay
  silent. A project that never opted in does not notice the plugin.
- **The retired engine's hook lines fail, and `project init` takes them out:** a line in the
  project's `.claude/settings.json` or `.claude/settings.local.json` that still runs
  `cc-smart-dev-kit hook worktree-create|worktree-remove|subagent-stop` gets the fix on stderr
  and exit 1 — never exit 2, which on `SubagentStop` blocks the stop, and the line reads no
  `stop_hook_active`, so every subagent would loop for ever. Exit 1 is a non-blocking error
  there and on `WorktreeRemove` (the session goes on), and any non-zero exit still fails
  `WorktreeCreate` and shows the line. `project init` removes exactly those handlers (found by their command text,
  `retiredEngineHookOf` in `src/hooks/settings-hooks.ts`), shown as `-` lines first, through the
  same backup and atomic write as the rest of its plan; `doctor` names each file that still has
  one (§ The worktree engine).

### How a project adds its own part to a general skill

A general skill reads the project's own additions when they exist. For example,
`/cc-smart-dev-kit:review` also follows the project's `.claude/cc-smart-dev-kit/review.md`, and where they disagree,
the project's text wins. The plugin stays general; each project keeps its own rules in
its own repo.

## Instructions, skills and agents

The plugin carries general working instructions for Claude, 19 skills, 5 agents and two
Workflows, all written for any project (`README.md` § Instructions, skills and agents lists
them).

**The always-on instructions reach Claude through the user's `CLAUDE.md`.** A plugin cannot
add text to every session by itself, but Claude Code loads `<config dir>/CLAUDE.md` in every
session, and an `@path` line there imports another file. So `setup`:

1. copies `plugin/instructions/**.md` to `<stateDir>/instructions/` — each file a whole file
   cc-smart-dev-kit owns, so `restore` removes it; a file a newer plugin no longer ships is taken
   out of the copy (`src/setup/instructions.ts`);
2. then writes one managed block into `<config dir>/CLAUDE.md` that imports `core.md`.

Why a copy: the plugin's own folder has the version in its name and goes away after an
update, so an import cannot point into it. The block names the copy as `~/…` when the config
folder is under `HOME` (so a `CLAUDE.md` shared between machines through a dotfiles repo
stays right on each), else by its absolute path. `--no-instructions` takes the block out
first, then the copy, so nothing ever imports a missing file; a `CLAUDE.md` that setup
created and that holds nothing else is removed.

**Two state files sit beside the copy** (`src/setup/instructions.ts`), in the state folder:

- `no-instructions`: the person's `--no-instructions`. While it is there, a plain `setup`
  keeps the instructions out; `--instructions` removes it; `restore` removes it too (a setup
  after a restore starts fresh). Why stored: a choice that a plain `setup` (run after every
  update) quietly undid would be no choice.
- `instructions-version`: the plugin version that last wrote the copy.
  `instructionsNeedRefresh(paths, version)` is true for an installed copy, not opted out,
  whose stamp names another version. `doctor` uses it (and compares each file with the
  plugin's). `refreshInstructionsCopy(paths, version)` brings only the copy up to that
  version: no block, no other step, no question, nothing when opted out or never installed.
  `refreshDue` also stops a session of an older version from writing its files back over a
  newer copy (`refreshMayWrite`: the installed version writes, and with no record of it only
  one newer than the stamp); a session that may not refresh says why in one stderr line
  (`refreshInstructionsAtSessionStart`).
  It is the **new** version's first session start that calls it: the update itself runs the
  old version's code, which does not know the new files, so the `update-check` SessionStart
  hook refreshes the copy through `refreshInstructionsAtSessionStart` — the copy only,
  quietly, one stderr line when it fails, and nothing when another session holds the state
  lock (that one is doing it). A plugin update therefore reaches the copy within the first
  session after it, and `setup` still refreshes it as before.

**A project's import of an opt-in file loads nothing where the copy is missing** (a teammate
without cc-smart-dev-kit, or after `--no-instructions`), and Claude Code says nothing. `doctor` reads
the memory files Claude Code would load (`CLAUDE.md`, `.claude/CLAUDE.md`, `CLAUDE.local.md`
in the current folder and every folder above) and names a cc-smart-dev-kit import whose file is
missing.

That an import in the user's `CLAUDE.md` reaches the main session and a subagent was proved
live (`claude-code-contract.md` § Instructions). The built-in `Explore` and `Plan` agents load
no `CLAUDE.md`, so a brief to them restates what they must respect.

**Opt-in instructions** (`optin/`) are copied too, but only a project's own import line loads
them: they are for projects that work the way they describe (one session per worktree).

**One home per rule.** Each rule lives in one place: the always-on instructions state it; one
skill holds its procedure and points back; an agent's file holds only that agent's job. The
precedence is stated once, at the top of `core.md`: where the project's own `CLAUDE.md`,
rules or `.claude/cc-smart-dev-kit/<skill>.md` differ, the project's text wins.
`bun run check:duplicates` (`scripts/check-duplicates.ts`, in `bun run check` and CI) fails
when the same sentence of 12 or more words appears in two files of the plugin's
instructions, skills, agents, output styles or workflow scripts — a script's strings are read
because a rule written into a prompt is a rule an agent follows. A deliberate repeat goes in
`scripts/check-duplicates.allow.json` with its reason. It cannot see the same rule said in
other words; that stays a review job.

**The shipped Workflows.** `plugin/workflows/audit-run.js` is the run the `audit` skill starts:
one read-only `auditor` per track on `sonnet` at `max`, a second auditor on `opus` at `xhigh` to
refute every finding (the judgment, D46), one `builder` on `sonnet` at `max` to write the
findings file. `plugin/workflows/review-split.js` is the second opinion the `review` skill takes
on a big change set instead of its single reviewer: one read-only `reviewer` per track, a second
one to refute every finding, and the verified findings merged and ranked. Its launches follow
D46's tier for the change set the caller names with `risky` — `opus` at `xhigh` for a risky one,
`sonnet` at `max` otherwise — and the refuters run on that same tier, because they make the
review's judgment; the audit's verifier is `opus` because the auditors are only the breadth.
Because a literal cannot depend on the change set, the script writes both fixed launch sets and
the caller picks one: a second script would repeat every prompt, which `check:duplicates` fails.
`sonnet` at `max` is the one ordinary-tier literal an affordable worker slot also allows (its
effort must be `max`), so on Claude it runs at the higher of the two efforts the core
instructions name. The reviewers carry `cc-smart-dev-kit:reviewer`, the type `reviewAgents`
lists by default, so the run's return records the review for the merge guard
(`src/workflows/review-split.test.ts` fails when that link breaks). Claude Code loads a
plugin's `workflows/` folder as `<plugin>:<meta.name>`, and the agent guard judges every
`agent(...)` launch in the script before the run starts (§ The agent guard); so every launch
names a literal `model`, `effort` and `agentType`, and `src/workflows/scripts.test.ts` runs each
shipped script against fakes and checks the guard the plugin ships allows every launch. Biome
skips `plugin/workflows`: a script body has a top-level `return`, which the linter's parser
refuses.

**Agents pin no model and no effort.** The caller passes both on each launch, so an agent
never runs on a model nobody chose. Plugin agents and skills are named `cc-smart-dev-kit:<name>`.
An agent that works by a skill loads it with `skills:` in its frontmatter: the skill's text is
in its context from the start (proved live: `claude-code-contract.md` § Instructions). All
five load `cc-smart-dev-kit:impact-analysis`, the one home for finding a symbol's callers and a
file's shape; `rules-maintainer` also loads `cc-smart-dev-kit:self-evolve`. The `reviewer` does not
load the review skill: half of it is the author's (commit, fix, start the reviewer), which
contradicts a read-only agent. It reads the review dimensions, edge-case axes and severity
scale from `skills/review/references/axes.md` instead, found from the base directory Claude
Code prints above each loaded skill (the plugin's folder has the version in its name, so no
fixed path reaches it). `auditor` reads the same axes file the same way. No agent has `memory:`
(only the main session saves memories) or `Agent` (an agent starts no agents).

**The tools each agent lists**, and why (research for the 1.1.0 plan, § R7):

| Agent | Tools | Why |
|---|---|---|
| `reviewer` | Read, Grep, Glob, Bash, LSP, WebSearch, WebFetch, claude-mem's `smart_*` | Bash for `git diff` and the unit tests; no edit tools |
| `rules-maintainer` | Read, Edit, Write, Grep, Glob, Bash, LSP, `smart_*` | Bash for `wc -l` and `git status` |
| `ui-verifier` | Read, Grep, Glob, LSP, `smart_*`, the `mcp__playwright__*` tools | no Bash: it runs no command, only the browser |
| `auditor` | Read, Grep, Glob, Bash, LSP, WebSearch, WebFetch, `smart_*` | a read-only sweep: Bash for `git log` and the tests, no edit tools |
| `builder` | Read, Edit, Write, Grep, Glob, Bash, LSP, `smart_*` | builds code: edit tools, and Bash for its done-check |

`smart_search`, `smart_outline` and `smart_unfold` are the companion plugin's own tool names,
for a file's shape without reading all of it; when they are not there or do not answer (on
Windows they can fail without an error, claude-mem #1247), the agent uses Grep and Read.
`LSP` answers only where a code intelligence plugin runs a language server for the file; with
none, each call returns an error and the agent searches as text. The Playwright tools keep
their usual names (`mcp__playwright__*`): the server is registered for the user (§ MCP servers
at user scope).

**The Grep and Glob trade-off (for the owner).** On macOS, Linux and WSL, Claude Code leaves
the Grep and Glob tools out of a session, and out of an agent that also lists `Bash`; it gives
them back to an agent that lists them without `Bash` (code.claude.com/docs/en/tools-reference
§ Glob tool behavior, read 2026-10-22). So `reviewer` and `rules-maintainer` search with
`grep` and `find` through Bash there — Claude Code's shell runs fast built-in versions of both
— and only `ui-verifier` gets the real tools. The cost: each search is a Bash call, so it
reaches the Bash hooks (claude-mem's file-context hook, the plugin's guards) and the Bash
permission rules, and its output is plain text rather than the tools' structured results.
Dropping `Bash` would bring the tools back, but the reviewer could no longer read `git diff`
or run a test, and the rules maintainer could no longer count lines or check `git status`.
Both keep `Bash`; Grep and Glob stay listed, because on Windows they are in the default set
and the agents use them. The `cc-smart-dev-kit:impact-analysis` skill says what to use when they
are missing.

**The output style** ships but is never switched on: a person picks it with `/output-style`.
## The hooks

The hooks live in `src/hooks/`. Every one of them is wired by the plugin:

- **The plugin's hooks** (`HOOKS`): each one a bundle (`src/entries/<name>.ts` →
  `plugin/dist/<name>.js`), wired in **shell form** in `plugin/hooks/hooks.json` (no `args`;
  the exec form it replaced cannot start on Windows — `.claude/rules/hooks.md`,
  `docs/windows-hooks.md`), so they run in every project. They run through
  `plugin/bin/cc-smart-dev-kit-bun.sh`, a small `sh` script that finds
  bun without PATH (Claude Code's hooks get the PATH it was started with, which may lack
  bun): the bun `cc-smart-dev-kit setup` baked into the launcher, then `$BUN_INSTALL/bin/bun`,
  `~/.bun/bin/bun`, and PATH. With none it answers by its `--missing=` mode: a PreToolUse
  guard passes `--missing=ask`, so it asks the person instead of letting the tool run (a
  guard fails closed, and it asks too when its own bundle file is gone, and its `hooks.json`
  entry says `"onFailure": "block"`); every other hook passes `--missing=quiet`, one line on
  stderr and exit 0; the command `plugin/bin/cc-smart-dev-kit` passes `--missing=fail`, one
  line and exit 1.
  It starts bun with `--no-env-file` and the plugin's own empty config, like the launcher and
  `plugin/bin/cc-smart-dev-kit`: bun would otherwise add the working folder's `.env` files to
  the hook and run its `bunfig.toml`, and a hook must see the environment Claude Code gave
  it, never a project's — the same rule `job run` refuses a job without.
  The baked line is
  single-quoted the way `shellQuote` writes it (each `'` as `'\''`), and the shim undoes
  exactly that, so a bun under a folder like `/home/o'brien` is found.

The contract they follow: `.claude/rules/hooks.md`. The Claude Code behaviour they rely on,
each row proved: `claude-code-contract.md` § Hooks and § Worktrees.

### One frame for every hook

Every hook runs in the same frame (`src/hooks/run.ts`), in this order:

1. **Read the input.** Not JSON, another event, or a `cwd` outside git: nothing to do.
2. **A guard's crew part** (`HookSpec.crewLimits`), before `ownHooks` and before the file: what
   a crew session may never do — push, open a pull request, message a peer without the tag, or
   message its own lead (D24, D47). It answers only in a crew session, so an ordinary session
   pays nothing, and it holds in a project that never opted in and in one whose `ownHooks`
   lists its own copy of the guard. The detectors are each guard's own, shared with its `run`
   (§ The crew talks).
3. **The project's own copy.** When the project's `cc-smart-dev-kit.json`
   lists the hook in `ownHooks` (`["git-guard"]`), the plugin's hook exits 0 and prints
   nothing, so the project's copy runs alone (§ The safe switch). Only that field is read
   (`ownHooksOf`), on its own, so it works even when the rest of the `cc-smart-dev-kit.json` is
   broken or needs a newer plugin. It is explicit on purpose: a project hook on the same
   event is not enough to silence a plugin hook, because it may be a logger, a different
   check, or a copy that does not cover the same commands — and a guard that went quiet for
   that would leave the person unguarded (owner, 2026-10-16). `cc-smart-dev-kit doctor`, run in a
   project, prints one `·` line per listed hook, and warns (`!`) when a listed hook has no
   project hook left to answer, or when a project hook runs next to a plugin hook the list
   does not name. A hook the project wires itself skips this step: that wiring is its
   opt-in. **Two hooks skip the step themselves:** `session-escape-guard` and `job-route`
   are `alwaysOn` (`HookSpec.alwaysOn`), so the frame never reads `ownHooks` for them — the
   project's file is one of the things the first guards, and the second limits what the session
   itself may launch (§ The session-escape guard, § The Bash judge and the job route).
   `ownHooks` does not accept `session-escape-guard`'s name; it still accepts `job-route`'s,
   because a project file written before 1.0.0 may carry it, and the name silences nothing
   (`UNSWITCHABLE_HOOK_NAMES`).
4. **Read `cc-smart-dev-kit.json`.** When it is broken or needs a newer plugin, the hook
   **fails closed**, each in the way that suits its event: a guard asks the person (it cannot
   know whether the project turned it on), an informational hook says one line. "Closed"
   never means silent: a person must hear why.
5. **Run.** An informational hook's error is one line on stderr and exit 0: its bug never
   stops work. A **guard's** error answers through its `onCrash` (`guardCrash` in
   `specs.ts`): it asks about the call in its own domain, so a crash never lets a call
   through.
6. **Record an ask.** An answer that asks the person is appended to `guard-asks.jsonl` in the
   state folder (`src/hooks/ask-log.ts`): the time, the hook, the session, the tool and a
   short reason, put through `maskedLine` so no secret reaches it. The file stays small by
   the rule of `update.log` (past `LOG_MAX_BYTES` the newer half is kept). A write that fails
   is one line on stderr and never changes the answer.

Each hook's answer when it fails (the same table is in `.claude/rules/hooks.md` § Fail safe):

| Failure | A guard (git, merge, main-folder, message, job-route, agent, session-escape, crew-role) | Any other plugin hook | `hook notify` |
|---|---|---|---|
| Its own code throws | `onCrash`: **ask** about the call (none outside its domain; silent on PostToolUse) | one stderr line, exit 0 | one stderr line, exit 0 |
| The input is not JSON | **ask**, in general | one stderr line, exit 0 | one stderr line, exit 0 |
| `cc-smart-dev-kit.json` broken or too new | **ask** (`agent-guard`, `session-escape-guard`, `crew-role` and `lead-notes` judge the call anyway) | one line of context or stderr | not read |
| No bun, or one too old | the shim's `--missing=ask`: **ask** | `--missing=quiet`: stderr, exit 0 | the launcher's line, exit 1 (Claude Code goes on) |
| The bundle file is gone | the shim **asks** | bun's error, exit 1 | not applicable |
| Cannot start, times out, fails (exit code other than 0 and 2) | `"onFailure": "block"`: the call is **blocked** | Claude Code goes on | Claude Code goes on |

The command `plugin/bin/cc-smart-dev-kit` runs through the same shim with `--missing=fail`: no
bun is one stderr line and exit 1, because a command must never report success when it did not run.

The agent guard is also wired on **PostToolUse** for the same tools (`Agent|Task|Workflow`).
Claude Code fires it **at the launch**, with the tool response `status: "async_launched"`,
`agentId`, `resolvedModel` and `outputFile`; the order is PreToolUse, PostToolUse,
SubagentStart, SubagentStop. A launch the guard asked about, and the person allowed, is recorded
there with that `resolvedModel` rather than a rebuilt one (§ The Agent guard).

The frame is general on purpose: later hooks (notifications, the routing of heavy jobs)
are new specs in it.

### Worktrees: Claude Code's own

Every project uses Claude Code's own worktrees (owner, 2026-10-18). A new task starts from
the main checkout with `claude -w <task-name>`, and Claude Code makes
`<repo>/.claude/worktrees/<task-name>` on the branch `worktree-<task-name>` (a `/` in the
name becomes `+`). It keeps its own lock on the worktree, its cleanup marker, the reset of a
reused clean worktree, `-w "#123"` and its Git LFS handling — none of which a hook could
rebuild. Entering an existing worktree is `claude -w <name>`, or `EnterWorktree` with its
`name` (which resumes it as it was left); `EnterWorktree` with a `path` only switches between
worktrees for a session already inside one, and fails from the main checkout. An unrelated
task from inside a worktree goes back to the main checkout first. A subagent with its own
worktree never calls either tool: Claude Code refuses both, and it uses `cd` to move inside
its own checkout.

- **The base comes from `origin`'s default branch** under `worktree.baseRef: "fresh"` (the
  default; it fetches that branch only when the repo was not fetched for 24 hours). A project
  whose base branch is another one sets `"worktree": {"baseRef": "head"}` in its committed
  `.claude/settings.json`: a worktree, and a subagent's worktree, start from the current
  branch. `project init` writes that line, and `doctor` warns with the line to add when a
  non-default base has no `baseRef: "head"`. `baseRef` takes `"fresh"` or `"head"`, never a
  branch name (`docs/claude-code-contract.md` § Worktrees).
- **`.worktreeinclude`** names the git-ignored files a worktree needs; Claude Code copies
  them in. There is no setup step: the session runs the project's install first.
- **`.claude/worktrees/` is git-ignored by the project**; `doctor` warns when it is not.
- **Cleanup:** Claude Code removes a clean worktree of an unnamed session on exit and asks
  first for a named one or one with work left; a subagent's worktree is removed when it made
  no changes. `cc-smart-dev-kit worktrees` finds the repo's
  finished ones, and `cc-smart-dev-kit sessions` lists a project's sessions in its nested
  worktrees (the project folder is the path with every `/` and `.` turned into `-`).

`project init` writes no worktree hook, and takes out what the retired engine left: its fields,
and its hook lines in both project settings files. `doctor` fails (`✗`) on either: the parse
line names a retired field, and one line per settings file names a leftover hook line, both
with `cc-smart-dev-kit project init` as the fix.

### Finished worktrees clean themselves (D48)

Worktrees pile up: one project had 73. Claude Code removes a subagent's worktree by itself
only when it holds no change at all, and `cc-smart-dev-kit worktrees --clean` removes only
what it can prove finished — but only when someone runs it. Since 1.0.0 that safe clean also
runs by itself (owner's decision D48, 2026-10-22).

- **One home for the clean.** `cleanFinished` (`src/worktrees/clean.ts`) removes what the scan
  judged finished, with its branch, forgets a worktree whose folder is gone, and reports what
  it removed and kept. `worktrees --clean` and the background clean both call it, so the two
  cannot judge differently. Nothing forces: the verdict (`verdict.ts`), the replay of a branch
  onto the base (`workOnRef`), and the fresh verdict `removeWorktree` takes right before it
  moves a folder decide, so a session, a program, a Docker container, uncommitted changes, a
  local file, a commit not on the base or a replay that cannot answer all keep the worktree.
- **The background clean** (`src/worktrees/auto-clean.ts`, run by the bundle
  `src/entries/worktrees-clean.ts`) takes the machine-wide lock (`LOCK_PORTS.worktreesClean`)
  and does nothing when it is busy, re-reads `worktrees.autoClean`, fetches `origin/<base>`,
  scans, cleans, and records the result for the hooks in the state folder
  (`src/worktrees/auto-state.ts`: one `worktrees-auto-clean/<key>.json` per repo, one
  `<key>.told.json` for what a session start already showed, and one line per run in
  `worktrees-auto-clean.log`, kept small by the update log's rule). Its own errors are that
  log line too: the process never throws at a person.
- **When it runs.** `after-merge` starts it once per pull request merged into the base, and
  `worktree-leftovers` at an attended session start — at most once an hour per repo (decided
  in the hook for speed, and again under the lock, so sessions that start together clean
  once), never in `claude -p`. Both make ONE call (`startAutoClean`, `src/worktrees/auto-start.ts`):
  it starts the bundle detached (`startDetached`, as the self-update starts its check) with the
  main checkout, the trigger and the session's own folder, so the worktree that session works
  in stays even when Claude Code has not written its record yet. A hook never waits for it.
- **What the person is told.** The next attended session start of that repo shows one
  `systemMessage`, once: `cc-smart-dev-kit removed 2 finished worktrees: app-wt-a, app-wt-b
  (work on main)`, then marks it told (`markTold`, keyed on the removal's number, so a clean
  that finished in between is not marked). The leftovers note still names the worktrees the clean
  did not remove, with the reason — including the reason the last clean itself gave.
- **The off switch** is `worktrees.autoClean` (1.0.0, optional, on when left out): `false`
  starts neither, and the background clean says so in its log.
- **It backs off while git is writing in the repo** (WA1): a project may run its own
  after-merge step in the main checkout (a fetch, a fast-forward, an install) at the moment
  the clean runs git there. When git's own lock files are held (`index.lock`, `HEAD.lock`,
  `packed-refs.lock`, or a ref lock under `refs/`), the run skips this round with one line in
  its log and writes no hourly mark, so the next trigger runs; there is no sleep and no retry
  until success (`gitLockHeld`, `src/worktrees/auto-clean.ts`).

### The worktree engine (retired in 1.0.0)

The engine retired in 1.0.0 (D20; owner, 2026-10-21) and its code is gone: the fields it
read are refused, its three hook names print the fix and exit 1 (a non-blocking error: exit 2
would block every subagent's stop), and `project init` takes both out (§ Per-project opt-in).

What it was, and why it went: a WorktreeCreate hook **replaced** Claude Code's own creation,
for sessions and subagents, in every project where it was wired, and a hook that prints no
folder makes the creation fail (proved live). A hook-made worktree loses the lock Claude
Code puts on a worktree while a session uses it, the marker its periodic sweep looks for, the
reset of a reused clean worktree, `--worktree "#123"` (a pull request) and the neutralised
filter drivers (Git LFS). Claude Code makes the same worktree shape on its own, with all of
that, so the plugin ships no worktree hook at all.

### The plugin's hooks

| Hook | Event (matcher) | On when | What it does |
|---|---|---|---|
| `git-guard` | PreToolUse (Bash, PowerShell) | `cc-smart-dev-kit.json` exists (its crew part needs no file) | Asks before **any** `git push` while `autoPush` is off (D15: the default, so a push leaves the machine), and asks for a force-push (git's abbreviations included: `--forc`), a push to a protected branch (`protectedBranches`, default `main`), `push --all`/`--mirror`, a branch deleted on the remote (`git push origin :x`, `-d`/`--delete`), `reset --hard`, `clean -f`, `worktree remove -f`, a checkout or restore that discards changes, `branch -D`, `stash clear` and an unnamed `stash drop`, and (with `worktrees`) a bare `git stash` / `stash pop`. `autoPush` is read as the merge guard reads its gate (`resolveGate`: the default, the person's `workflow.json`, the project's file committed on `origin/<base>`), so a session cannot switch it off in its own worktree; a policy it cannot read asks. **A crew session never pushes** (D24): a push from one (`CC_SMART_DEV_KIT_CREW` set) is denied, whatever `autoPush` says — the session commits and the lead merges locally. That is the guard's **crew part** (`crewPushAnswer`), which the frame runs before `ownHooks` and the file, so it holds with no `cc-smart-dev-kit.json` and whatever `ownHooks` lists. One shell lexer (`src/shell/command.ts`) reads each command of a line; quoted text, here-docs and comments are data, and shell keywords, wrappers (`timeout 60 git push -f`, `env -i sudo -u me …`, `setsid`/`flock`/`script -c`/`busybox sh -c`, `xargs …`), the here-doc a shell reads as its script, and the text piped into one are read through. `git send-pack` and a `git -c alias.x=push x` on the line push too, and a program the line works out when it runs (`$(which git) push`, `$GIT push`) asks rather than pass unseen — and in a crew session the same words are denied, like any push. Known limits: a git alias from the person's own config, `branch -f`, `checkout -B`, `switch -C`, `ssh`, a script file. Apart from that one refusal it asks, never denies: the person may mean it. |
| `main-folder-guard` | PreToolUse (Edit, Write, NotebookEdit) | `worktrees.guardMainFolder` | Denies an edit of a file in the main checkout itself, with the way into a worktree. (Until 0.6.0 it also placed Serena's edits, with the `serena-root` hook's record; both went with Serena.) |
| `playwright-output` | PreToolUse (`mcp__playwright__.*`) | always (a `USER_HOOKS` bundle: it reads no cc-smart-dev-kit.json) | Rewrites a relative `filename` to an absolute path in the browser's output folder, with `updatedInput` and no permission decision; a relative name with a `..` segment is DENIED (the launcher's `--allow-unrestricted-file-access` means the server takes that path as it is). Answers only while the live `playwright` registration is the one setup recorded — a server of the person's own is left alone entirely. |
| `merge-guard` | PreToolUse (Bash, PowerShell) | `cc-smart-dev-kit.json` exists (its crew part needs no file) | Asks the person before a command that merges a pull request, or opens or readies one (`openPr`, D16: `off` asks before any of them, `draft` lets a draft create through and asks for a ready one and for `gh pr ready`, `ready` asks for neither). Every merge of the line is judged (`gh pr merge`, `gh pr -R owner/repo merge 5`, an alias from `gh alias list`, `--auto` included), and the first the policy does not allow asks, naming that pull request: `autoMerge` on, the base is the integration base (`autoMergeAllowed`), the merge names THIS project's repository (its `origin`), every required check `gh pr checks --required` reports green, and (with `reviewBeforePush`) the head commit's review is recorded. The forms it does not judge ask with the reason — a `gh api` merge, a GraphQL query it cannot read, a shell alias, an extension whose words name a merge — as does a step that moves the merge's folder, branch or repository (`cd`, `git switch`, `GH_REPO=…`, `env`), and a `gh` that is missing or does not answer. **A crew session opens no pull request** (D24): `gh pr create` pushes the branch, so it is denied, and so is a program the line works out when it runs whose words name an opening or a merge (`$GH pr create`). That is the guard's **crew part** (`crewPrAnswer`), which the frame runs before `ownHooks` and the file, so it holds with no `cc-smart-dev-kit.json` and whatever `ownHooks` lists. A `gh pr create` outside the base its head branch belongs to (`worktrees.base`, or `worktrees.bases` for that branch; with no `--base`, the repository's default branch) asks, naming both branches, and never denies (WA1). Read-only `gh`, 10 s a call of the hook's 30 s. § The workflow › The merge guard. |
| `message-guard` | PreToolUse (SendMessage) | `cc-smart-dev-kit.json` exists (its crew part needs no file) | Denies a message to a session that works outside this repo (from Claude Code's session records), and a crew session's message to another crew session of this repo that does not carry the `crew tell` tag (§ The crew talks); a message to the session's own lead is denied with the `crew report` route. The crew rule is the guard's **crew part** (`crewMessageAnswer`), which the frame runs before `ownHooks` and the file, so it holds with no `cc-smart-dev-kit.json` and whatever `ownHooks` lists. |
| `agent-guard` | PreToolUse (Agent, Task, Workflow), and PostToolUse for the record | **machine-wide** | The model a launch really runs on, and the model rules: no `model`/no `effort` → deny; `low` effort → deny on every model (`medium` for searches and reads, `high` for building and reviews, `xhigh` for the hardest judgment, `max` only when the person asks — D13); an affordable slot needs `effort: "max"`; the **`opus` tier** — whatever answers behind the name, and a name whose override or slot answers with a stricter tier counts as that tier — is allowed at `medium`/`high`/`xhigh` for any agent and any purpose, and an **ask** at `max` (the owner's decision D11; in `claude -p` a deny); a launch that declares UI/UX work — `Opus reason: ui`, or `Fable reason: ui-design` — runs only on `opus` or `fable`, at `high` or above (`UI_POLICY`, D50), and is **denied** on Sonnet, Haiku or an affordable slot, or below `high`; the **`fable` tier** is a read-only agent with a `Fable reason:` word, and an agent that can change files (a fork included) only with `build`, as an **ask**. A fork is judged on the session's model, never on the `model` it names. A premium launch is recorded once it is known to run: an allowed one on PreToolUse, an asked one on PostToolUse. § The Agent guard. |
| `session-escape-guard` | PreToolUse (Bash, PowerShell, Edit, Write, NotebookEdit) | **machine-wide**, and `ownHooks` cannot switch it off | Denies `workflow review-done` and any kit command run with `CLAUDECODE` removed; asks before a command that reaches the portal's port, before an edit or write of the kit's own settings, state or installed plugin folder, and before a computed program whose line names the kit command. § The session-escape guard. |
| `fable-session` | SessionStart, PostModelSwitch, Stop | **machine-wide** | One `systemMessage` to the person, once a session, when the session's own model is the **`fable` tier**; nothing to Claude, never an error and never a block — the line itself was seen live (2026-10-17), but not on `PostModelSwitch` or `Stop` yet. The model: at a start, the `model` the input names (no fallback); at a switch, `to_model` — the model the session moved TO; at a stop, the one that answered in the transcript, then `ANTHROPIC_MODEL` — the guard's own reading of the tier. Not `UserPromptSubmit`: it judged the PREVIOUS answer's model, so it missed the switch and warned after a switch back (the live bug of 2026-10-17). § The Fable-session note. |
| `job-route` | PreToolUse (Bash, PowerShell) | **machine-wide**, and `ownHooks` cannot switch it off | The kit's one shell judge (`bash-judge.ts`), in two parts. **The judge** ignores the project's file and runs outside git: a raw `claude --bg` **asks** in an attended session (refused in `claude -p`) showing the `crew start` line; `claude -p` is judged by the launch policy every Agent launch meets (its `--model`/`--effort`: no model refuses, the `fable` tier asks, the `opus` tier at `max` asks; a `Fable reason:` line in its prompt counts); a crew session's `crew start` is denied; a polling loop over `crew list|status` or `claude agents --json` (a repeating `while`/`until`/`do` loop or a `watch`, or a `sleep`/`Start-Sleep` beside a read; a `for`/`foreach` over a fixed list is no poll) is denied. It reads each line in the dialect of the tool that runs it, so the PowerShell tool is judged the same. **The route** is the project's `jobs.route`, Bash only: a line whose every command is heavy, a `cd` or an assignment is rewritten to `cc-smart-dev-kit job run --kind <kind> -- <command>` through `updatedInput` (proved live on 2.1.301); any other line runs raw, as the person's own rules see it (HK hunch 1). **In a lead**, a CI watch, a routed heavy job and the full check get `run_in_background: true` (proved honoured on 2.1.308, and in L1a.1 on 2.1.306). § The Bash judge and the job route. |
| `after-merge` | PostToolUse, PostToolUseFailure (Bash, PowerShell) | `worktrees` | After a pull-request merge (`gh pr merge`, `gh pr -R owner/repo merge 5`, a readable `gh api` merge path, a `gh` alias for one): the steps that clear the merged worktree, the message to send the other sessions when it went into `worktrees.base` (it says what to do after the merge: never commit unfinished work for it, run the project's install if a lock file changed, run the tests it touched), and it starts the background clean of finished worktrees once (§ Finished worktrees clean themselves). A form that names no pull request gets no note. |
| `review-record` | SubagentStart, SubagentStop | `cc-smart-dev-kit.json` exists | When a review agent (`workflow.reviewAgents`) starts, notes the commit the working folder is on and its branch; when it stops, records that start commit on that branch — the record the merge guard reads. Commits made during the review count as change after it. Nothing for an agent that stopped inside its own worktree. § The review record. |
| `subagent-background` | SubagentStop | `cc-smart-dev-kit.json` exists | A subagent that ends its turn with background work **it started** still running (a Bash command, or a subagent it launched) is blocked **once**, with one plain reason: wait for the work or stop it, then report. The input's `background_tasks` is the session's list, so the hook reads the agent's own transcript (`agent_transcript_path`) as JSONL, line by line, and keeps only an id named in a **tool result of the agent's own call** — a Bash background launch (`Command running in background with ID: …`) or an Agent launch (`agentId: …`) — never one in its brief or in a file it read; the ending agent's own entry is dropped (a background subagent appears in its own list). No `additionalContext`, never a second block (`stop_hook_active`), and nothing when the transcript cannot be read. § One frame for every hook. |
| `agent-usage` | SubagentStop | **machine-wide** | One line per subagent in `<stateDir>/agent-usage.jsonl`: the time, the session, the agent's id and type, and per model the replies, the four token sums and an estimated USD cost — from the agent's own transcript, never a word of its content. A second stop of one agent supersedes its first line when read; the record is kept small like the ask log. One stderr line when the transcript cannot be read or the record cannot be written. § Each subagent's usage on record. |
| `worktree-leftovers` | SessionStart (startup, resume) | `worktrees` | Names the finished worktrees (every commit on `origin/<base>`, nothing uncommitted, no session in it, idle an hour, no ignored file that cannot come back) and the ones whose folder is gone, says once what the background clean removed, and starts that clean (at most once an hour per repo, never in `claude -p`). At an attended start it also adds at most one short line about the main checkout — on another branch than `base`, behind `origin/<base>` as git already knows it, or in the middle of a merge, a rebase or a cherry-pick — read-only and with no fetch. It removes nothing itself (§ Finished worktrees clean themselves). |
| `session-name` | SessionStart, UserPromptSubmit | `sessionNames` | Tells the session to name itself after its task (`cc-smart-dev-kit session-name`), then sets that as its title at the next prompt. |
| `crew-role` | SessionStart (startup, resume, compact), PreToolUse (AskUserQuestion, ExitPlanMode), Stop, StopFailure | a crew session (`CC_SMART_DEV_KIT_CREW`) | **machine-wide**: the role card at a start, a resume or a compaction; **its own `cwd` checked against the record's worktree** — inside it a `starting` record is written `working`, outside it an open record is written `failed` with where it started, and its card says to stop (the lead's watch ends the session) — each write reads the state again under the store's lock (`updateCrewIfState`); the two tools that ask the person **denied** with the `crew report --question …` step (D36); at a stop, the last line on the record and one block when the turn ended on a step with no report. No context from Stop. At a StopFailure on a model limit, the record is **paused** with what it waits for (D42, § Lead and the crew › Waiting out a limit). § Lead and the crew › The crew session's and the lead's hooks. |
| `lead-notes` | SessionStart, UserPromptSubmit | a registered lead (the input's `session_id`) | **machine-wide**: one line about what changed among the lead's crew sessions since its last turn, from a per-lead cursor in the store, said once and never twice. § Lead and the crew › The crew session's and the lead's hooks. |

Without `cc-smart-dev-kit.json` every one of them is silent — except the eight machine-wide
ones: `agent-guard` (§ The Agent guard), `job-route` (§ The Bash judge and the job route),
`session-escape-guard` (§ The session-escape guard),
`fable-session` (§ The Fable-session note), `crew-role` and `lead-notes` (§ Lead and the crew),
`agent-usage` (§ Each subagent's usage on record), and
`playwright-output`, which reads no project file at all — and the **crew part** of `git-guard`,
`merge-guard` and `message-guard`, which answers only in a crew session (D24, D47; § The crew
talks), so a project that never opted in
sees only Claude Code's own worktrees and the limits a session may not get around. `job-route`
and `session-escape-guard` are also `alwaysOn`: `ownHooks` cannot switch them off, because they
limit what the session itself may do. The machine-wide `notify` hook needs no project file
and acts without one; the
`workflow.alerts` settings are the one thing it reads from a project that has them (§ The
notifier).

### The Agent guard

`agent-guard` (PreToolUse on `Agent`, the older name `Task`, and `Workflow`) is **machine-wide**, like
`update-check`: it runs with or without `.claude/cc-smart-dev-kit.json`, and a broken or too new file
does not change its answer (the frame hands it the input and the environment instead, and its
`outsideGit` and `onConfigProblem` judge on). A project may still silence it through
`ownHooks`, which is read on its own: the list works even when the rest of the file is broken.
It is wired `--missing=ask`: a guard fails closed.

Why the owner asked for it (2026-10-16): an Agent call that names no model runs on the
session's model — on an Opus session, every plain `Explore` is an Opus spawn — an Opus or
Fable agent spends the person's own plan usage, and a subagent at `low` does work nobody chose
to cheapen. So the guard holds the effort rule first — `medium`, `high`, `xhigh` or `max` only,
`ALLOWED_EFFORTS` in the code, `low` refused on every model (D5, D13: `medium` for searches and
reads, `high` for building and reviews, `xhigh` for the hardest judgment, `max` only when the
person asks) — and then reads the launch's
`model`, `effort`, `subagent_type` and prompt, and resolves the model the launch will really
run on:

1. a family name (`haiku|sonnet|opus|fable`) goes through Claude Code's own override, when
   the person set one (`ANTHROPIC_DEFAULT_<FAMILY>_MODEL`; all four exist on 2.1.301, Fable
   included; `gateway on` writes none since 0.5.0), then — with the gateway on
   (`ANTHROPIC_BASE_URL` in Claude Code's settings) — the family's slot, the way the router
   picks it (`FAMILY_SLOTS`: haiku → scout, sonnet → worker, opus → opus, fable → fable): its
   chain's first target answers, read from `gateway.json` through the gateway's own
   `loadConfigFile`. A slot with no chain answers as Claude, and the Claude model answers. So `sonnet` is
   an affordable slot (effort `max`) exactly when the gateway is on and the worker's chain
   starts with a `<backend>:<model>`;
2. a full Claude id goes through its family's slot the same way; a slot key or
   `<backend>:<model>` is resolved as itself (a slot's first target answers); **any other name** (`best`, `opusplan`,
   `default`, `inherit`, a name no rule knows) is resolved the strictest way — the rule for a
   Claude id with no family to read — because only what the guard can prove affordable is
   affordable;
3. a `fork` always inherits: its model is the session's own, read from the tail of the hook
   input's `transcript_path` (`lastClaudeModel`, shared with the StopFailure alert; a
   sidechain line is a subagent's, not the session's), else from `ANTHROPIC_MODEL`; an
   unknown one counts as Claude Opus.

**Before those steps, Claude Code's own overrides decide which name and which effort the launch
really gets** (`effectiveLaunch` in the launch policy; the order proved live on 2.1.306, and in
Claude Code's own docs and code):

| Override | What the launch runs on |
|---|---|
| `CLAUDE_CODE_SUBAGENT_MODEL_FORCE` on (`1`, `true`, `yes` or `on`, the values Claude Code reads as on) | `CLAUDE_CODE_SUBAGENT_MODEL`; unset or `inherit`: the session's own model (step 3's reading; unknown → the `opus` tier). The call's `model` does not count. |
| `CLAUDE_CODE_WORKFLOW_SUBAGENT_MODEL` (not empty, not `inherit`) | its model, for a Workflow `agent()` only; FORCE comes first; an Agent call is not touched |
| neither | the call's own `model`. A plain `CLAUDE_CODE_SUBAGENT_MODEL` is only a default for a call that names none, after the agent's own definition, which no hook can read — so such a call is still refused for naming no model |
| `CLAUDE_CODE_EFFORT_LEVEL` (not empty) | that effort for every launch, whatever the call names |

The guard reads them from its own environment. **A settings file's `env` reaches a hook's
environment** (proved live on 2.1.306, for `--settings` and for a project's
`.claude/settings.json`), so that is all it reads — no settings file of its own. **Under FORCE
Claude Code takes `model` off the Agent tool, and under `CLAUDE_CODE_EFFORT_LEVEL` it takes
`effort` off** (proved live: the PreToolUse `tool_input` carries neither). So before 1.0.0
the guard refused every Agent launch there ("names no `model`"); now such a launch is judged on
what the variable sets. Every ask and refusal says which override applied ("This launch runs on
`haiku` because `CLAUDE_CODE_SUBAGENT_MODEL_FORCE` is set …"), and the record names the model
the launch really runs on. Two refusals rest on the variable alone, and only the person can
change it, so the message says where it is set: a `CLAUDE_CODE_EFFORT_LEVEL` no subagent may run
at (`low`, or a level no rule knows), and anything but `max` while an affordable slot answers.
`auto` (`EFFORT_AUTO`: the model picks its own default) is the person's own choice, like a
fork's inherited effort: it is never refused for itself, and since no model's default is `max`,
the `opus` tier runs it with no question (recorded as `opus:auto`); Sonnet and Haiku run it, the
`fable` tier keeps its reason-line rules, and only an affordable slot refuses it. Refusing it
would lock out every launch, the same way the missing `effort` once did. A fork keeps its rule: the session's model, and the effort it names,
else the session's own. Two readings are the stricter one on purpose: under FORCE alone the
built-in Explore agent runs on its own listed model (Opus where the session runs Fable), but a
person's own agent named `Explore` runs on the session's, and a hook cannot tell them apart, so
both read as the session's model. One case is not covered: Claude Code's code (2.1.306) still
reads `CLAUDE_CODE_WORKFLOW_SUBAGENT_MODEL` under FORCE when an admin's managed settings set it,
and the guard reads no managed settings, so it judges FORCE's model there.

A **Workflow** tool call is judged too: its `agent(...)` launches run inside the tool and pass
no hook of their own (proved live on 2.1.301 — a project hook with the matcher
`Agent|Task|Workflow` saw the `Workflow` call and nothing else), so the guard reads the
script's text: the `model`, `effort` and `agentType` of each call, and its prompt when that
is a fixed string literal (`readWorkflowScript` — a template that builds its text, `` `${…}` ``,
is not one, and neither is a literal an operator changes, `effort: "high" && "max"` or
`"a" + b`). An option counts only as a key of the call's own options object, quoted or not
— never the same words in the prompt or in a nested object (`schema: { effort: … }`). A
`model` held in a variable is refused rather than guessed, and a prompt built at run time is
refused for a Fable launch (its reason line cannot be read). Two things are refused for the
whole call (`workflowRefusal`), because no rule can hold for a launch the guard cannot follow:
`agent` or `workflow` mentioned without a direct call (`const run = agent; run(…)`,
`agent?.(…)`, either passed around), and a call whose options are built at run time (a
`...spread`, a computed `[…]` key, the same key twice). The strictest launch of the call
answers for the whole call. A launch with no readable `model` is judged, not refused, when
FORCE or `CLAUDE_CODE_WORKFLOW_SUBAGENT_MODEL` names the model it runs on.

**Which script a Workflow call runs** (G2; `judgeWorkflowCall`, the files in
`src/hooks/agent-guard-workflows.ts`). Proved live on 2.1.306, the call's PreToolUse input holds
one of four shapes — `{"script": …}` inline, `{"name":"probe"}` for a saved workflow,
`{"scriptPath":"<path>"}` for a path run, `{"name":"<plugin>:<meta.name>"}` for a plugin's —
and the guard finds the script the way Claude Code's own code (2.1.306) does:

| The call names | The script the guard reads |
|---|---|
| `script` | that text — it runs whatever else the call names |
| `scriptPath` | that file, relative to the input's `cwd`; one over 524288 bytes is refused, as Claude Code refuses it |
| a bare `name` | the `.js` file whose `meta.name` is that name — the file's own name plays no part — in `.claude/workflows/`, from the `cwd` up to the repo root (never the home folder itself), then in the user's `<config>/workflows/`; the nearest folder wins, the project's over the user's |
| `<plugin>:<name>` | the file whose `meta.name` is `<name>` in that plugin's `workflows/` folder, or in the paths its manifest's `workflows` lists instead; the plugin's folder is `CLAUDE_PLUGIN_ROOT` for this plugin, else its install in Claude Code's `installed_plugins.json` (a `project` or `local` install whose folder holds the `cwd`, the deepest first, before the `user` one) |

`meta` is read the way Claude Code reads it: `export const meta = { … }` as the first statement,
a pure literal (no variable, no `${…}`, no spread, no computed key, no method), with a non-empty
`name` and `description`; a file without one is no workflow. Each nested `workflow("<name>")`
or `workflow({ scriptPath: "…" })` in the script is found the same way and judged with it, one
level deep as Claude Code runs them; a nested workflow named at run time, or a nested script
that nests again, refuses the whole call. **Two files in one folder that claim one
`meta.name`** with different texts: Claude Code keeps the one its folder listing gives last,
an order the guard cannot know, so the guard treats the name as unreadable (two copies of one
text are one script). A run the guard cannot read — a built-in workflow (`deep-research`: its
script is inside Claude Code), a missing file, those two files, a `resumeFromRunId` (the run
goes on from a script the guard does not see), a call that names none of the three — **asks**,
naming why, and is **denied in `claude -p`**, where nobody can answer. Known limits: a script
that changes between the guard's read and the run is judged as it was read; an override that
does not parse (Claude Code then keeps the farther copy) is judged as written; and a launch in
a loop is one launch to the record.

The rules are in one table in `src/hooks/agent-guard.ts` (its header). The policy under them —
which model a launch really runs on (`resolveLaunchModel`), the effort levels
(`ALLOWED_EFFORTS`), the Fable reason words and the crew kinds (§ Lead and the crew) — is one
pure module, `src/models/launch-policy.ts`, which the guard imports and the crew launcher and
the Bash judge share; the guard keeps the hook's own parts (reading a Workflow script, the agent
types, the record, the messages). The one list a person
may extend is an environment variable (`CC_SMART_DEV_KIT_AGENT_GUARD_READ_ONLY_AGENTS`, the
read-only agent types the Fable rule reads), and the answer is a PreToolUse `deny` (the rule, in
words, to Claude) or an `ask` (a Fable launch, and an `opus`-tier launch at effort `max`; the
person approves each one, and the opus-tier ask rests on the effort, not on a prompt).

**The `opus` tier** (the owner's decision D11, 2026-10-17) is judged by its effort alone: at
`high` or `xhigh` it runs with no question, for any agent type and any purpose — a review or a
build, with or without a reason line — and at `max` (`OPUS_ASK_EFFORT`) it asks the person,
naming the model and the effort. An `Opus reason: <word>` line is optional: when a prompt has
one, its first word goes into the record, and nothing else reads it. A fork names no effort —
it runs at the session's own, which the person chose — so an `opus`-tier fork is allowed; a
fork that names `max` itself is held to the same rule. **The free path is for a reading the
guard can prove is the Opus family**: the `opus` name, a Claude Opus id (a cloud provider's
`us.anthropic.claude-opus-…` too), the opus slot, or an id the person's own
`ANTHROPIC_DEFAULT_<FAMILY>_MODEL` names for it. A reading with no family — a name no rule
knows (`best`, `inherit`, an id the guard cannot read) — may stand for a higher tier, so it
asks at any effort, is refused in `claude -p`, and is recorded as `opus:unreadable`. (Before D11 the tier needed a review
agent type or a listed reason word, and refused every launch but a review at `high`; that
reason list, the review-agent list and its variable are gone.)

**UI/UX work** (the owner's decision D50, 2026-10-22) is the one case where a prompt line decides:
`Opus reason: ui` or `Fable reason: ui-design` declares it, and `UI_POLICY` in the same pure
module holds the rule — the tiers `opus` and `fable`, and the lowest effort `high` — one home, so
lifting the rule is one change when a cheap open-source model proves good at UI/UX. A declared
launch is denied on Sonnet, Haiku or an affordable slot, and below `high`, before any rule below
would allow it; the denial names the allowed models and efforts. The prompt is never sniffed for
keywords: a prompt that merely talks about a page or a layout is left alone, because a false
positive would block real work. Checking is not design: the `ui-verifier` may run on `sonnet`,
and the design verdict is made on `opus` or `fable` (`/cc-smart-dev-kit:ui-verify`). The same
rule reaches the crew kinds (§ The kinds): `ui` is `opus` at `high`, and the launcher refuses an
override that would put it elsewhere.

An `ask` in a session nobody
watches (`claude -p`, `CLAUDE_CODE_SESSION_ATTENDED=0`) is refused just like a deny — Claude
Code cannot ask anyone there (proved live on 2.1.301) — so the guard answers that denial with
a message that says why; an Opus-family launch below `max` needs no answer, so it stays
allowed there, one at `max` is told to run at `medium`, `high` or `xhigh`, or in an
interactive session, and one with no family is told to name `opus`. Every premium launch is
recorded once it is known to run — an allowed one on PreToolUse, an asked one on PostToolUse
(`RAN_EVENT`: the call ran, so the person said yes; one they refuse is never recorded) — once
per `tool_use_id` and launch index (a Workflow's launches all share its one `tool_use_id`, so
each is its own line, under its index), in
`<stateDir>/agent-launches.jsonl`. Each line carries the `effort` it really ran at and the
reason `word` as their own fields, and keeps `reason`, why it ran as one string, for a reader
that knows only that — the `opus` tier as `opus:<effort>`, with the prompt's reason word after
it when there is one (`opus:xhigh`, `opus:max:security`; a fork `opus:session-effort`), and the
`fable` tier by its word (`fable:build` for a builder the person asked for). An older line with
only `reason` is taken apart once, when it is read (`reasonParts`). `cc-smart-dev-kit usage`
lists them (count, by effort, by word) — the transcripts say which model wrote a reply, never
why it was allowed. A Workflow call denied as a whole records none of its launches: nothing in
it ran; an `ask` names every launch of the script that asks, not only the first.

**Tiers, not vendors** (the owner, 2026-10-16). `LaunchModel.tier` is what the rules go by:
`opus` and `fable` mean the tier whatever answers behind them — a family name keeps its tier
through `ANTHROPIC_DEFAULT_<FAMILY>_MODEL` and through its family's slot, a Claude id has its
family's, and a name the guard cannot read is the `opus` tier, the strict reading. So an
override that points `opus` at a backend never becomes an affordable slot, is never forced to
`max`, and still asks at `max`; the messages name both, `` `opus` (answered by
openai:gpt-5.5) ``.

The Fable rules are the owner's of 2026-10-16, and each is the person's call:

- **A read-only agent** (Plan, Reviewer, Explore, auditor) takes any word of
  `FABLE_REASONS` — `hard`, `rewrite`, `ui-design`, `architecture`, `review`, `plan`,
  `unsatisfied` — where `unsatisfied` is a fresh attempt after the person did not like the main
  session's answer (`subagent-decision` § Choosing Fable has the brief it gets) and `review` is
  a second opinion on a hard or high-stakes change the session may run on Fable by its own
  judgment (`review` § Second opinion has the conditions).
- **An agent that can change files** — any other type, a fork included — takes the one word
  `build`: the person asked for Fable to build it, and approves that launch. Every other word,
  and no line at all, is denied with the line it needs (`FABLE_BUILD_REASON`, which is not one
  of the read-only words). A fork of a session whose own model is the `fable` tier is judged the
  same way, so such a session can fork with `Fable reason: build - …` and is not refused
  outright.

### Each subagent's usage on record

`agent-usage` (SubagentStop) is **machine-wide**, like the Agent guard's launch record and for
the same reason: what a subagent's replies cost is the person's own spend, not a project's
policy. At every subagent's stop it reads the agent's own transcript
(`agent_transcript_path`) and appends one line to `<stateDir>/agent-usage.jsonl`
(`src/hooks/agent-usage.ts`). The line holds the time, the session, the agent's id and type,
and per model the replies, the four token sums (`input_tokens`, `output_tokens`,
`cache_read_input_tokens`, `cache_creation_input_tokens`) and an estimated USD cost from the
one price home (`src/gateway/prices.ts`, Claude's list price; a model with no row — an
affordable backend's — is recorded with its tokens and no price, and `unpriced` counts those
replies). **Never content**: a transcript's text, tool input and tool result are skipped. A
reply is counted once by `message.id`, though Claude Code writes one `assistant` line per
content block, each carrying the reply's whole usage. A second stop for one agent (a block
made it continue) appends a newer line with the whole transcript, and `readAgentUsage` keeps
the newest per session and agent, so a cost is never a sum of two halves. The record is kept
small like the ask log (`src/hooks/jsonl-log.ts`: `LOG_MAX_BYTES`, the newer half kept). An
unreadable transcript, and a record that cannot be written, are one stderr line and exit 0. A
project that runs its own copy lists the name in `ownHooks`. `cc-smart-dev-kit usage` shows
each session's agents by type and model, their tokens and their cost (`README.md` § The usage
limit), and `usage --json` is the same facts as one object a portal can read.

The **subagent status line** (MD-13) is the same fact on screen: `plugin/settings.json` sets
Claude Code's `subagentStatusLine` to `cc-smart-dev-kit subagent-statusline`
(`src/cli/subagent-statusline.ts`), and the agent panel's row body for each subagent becomes
`<label> · <slot> → <model> → <effort>`, the slot taken from the model's Claude family with
the router's own mapping (`familySlotFor`). It is a plugin setting, not a hook: Claude Code
runs the command on each refresh tick with `columns` and one entry per visible subagent on
stdin, and the command answers one `{"id","content"}` line per row (proved offline on
2.1.308, `docs/claude-code-contract.md`). The command names the launcher, never
`${CLAUDE_PLUGIN_ROOT}`: a plugin's settings file does not expand that variable (proved: the
literal string ran, exit 127), and the launcher is the one path an update cannot break.

### The session-escape guard

`session-escape-guard` (PreToolUse on `Bash`, `PowerShell`, `Edit`, `Write` and `NotebookEdit`)
stops a session from loosening the limits the person set for it. `src/hooks/session-escape-guard.ts`
is the whole of it. It is **machine-wide** like `agent-guard` (it runs with or without
`.claude/cc-smart-dev-kit.json`, in a folder outside git, and when the file is broken or too new)
and **`alwaysOn`**: `ownHooks` cannot silence it and does not accept its name, because the
project's file is one of the things it guards — a session could otherwise list the guard there
first. It is wired `--missing=ask` with `"onFailure": "block"`, and a crash of its own asks about
the calls in its domain (§ One frame for every hook).

| The call | The answer | Why |
|---|---|---|
| A line that runs `cc-smart-dev-kit workflow review-done` | **deny** | A review is recorded by the review-record hook when a review agent returns. A session never records its own. |
| A line that runs a kit command (the launcher, or `bun …/dist/cli.js` / `portal.js`) with `CLAUDECODE` removed | **deny** | The kit's commands that change this machine's settings (the workflow gate, the portal, updates) refuse to run while Claude Code's `CLAUDECODE` is set — a courtesy a command can drop. This is the lock. |
| A line that reaches the portal's port (20150) on this machine | **ask** | The portal has no sign-in of its own (D9): its pages change the gateway, the judge, updates and the review gate. |
| An Edit, Write or NotebookEdit of a `.claude/cc-smart-dev-kit.json`, the kit's settings folder (`workflow.json`, `gateway.json`), its state folder (the review record, the ask log) or its installed plugin folder (`plugins/cache/<marketplace>/<plugin>`) | **ask** | They hold the limits the guards enforce: the project's gate and `ownHooks`, the person's own policy, the record of what was reviewed, and the guard bundles Claude Code runs. |

**How `CLAUDECODE` counts as removed.** The shell reader (`src/shell/command.ts`) gives each
command of the line, its wrappers (`setsid env …`, `flock <file> env …`, `script -c …`,
`busybox sh -c …`), and the lines it runs (`bash -c`, `eval`, a here-string,
`cc-smart-dev-kit job run --`, `ssh host '…'`). On one command: `CLAUDECODE=…` before it, `env -u
CLAUDECODE`, `env --unset`, `env -i` (and `env -`), `sudo`/`doas`/`su`/`runuser`/`ssh`/`systemd-run`
(a fresh environment). For the commands after it in the same line: `unset CLAUDECODE`, `export
CLAUDECODE=…`, `export -n`, `declare +x`, a step that is only `CLAUDECODE=`, and in PowerShell any
write to `$env:CLAUDECODE` (`Remove-Item Env:CLAUDECODE`, `SetEnvironmentVariable`; the whole
line counts, because PowerShell's lexer cuts at braces). A kit command is also found as an
argument of a runner (`find -exec`, `watch`, `parallel`), **and the words before the kit word
inside that runner's arguments count too** — `find … -exec env -u CLAUDECODE <kit> …`, `flock
<file> env -u CLAUDECODE <kit> …` — except after programs that only read their arguments (`ls`,
`grep`, `git`, `echo`…), so `env -u CLAUDECODE claude -p` and `env -u
CLAUDECODE bun test` — the usual way to start a nested session — are not touched. PowerShell's
`Start-Process` is read by its `-FilePath`/`-ArgumentList` (or the positional words), and
`-UseNewEnvironment` starts the command with a fresh environment, the same as `sudo`. Claude Code's
Bash tool keeps no `export` or `unset` from one call to the next (seen live 2026-10-22: an
`unset CLAUDECODE` in one call, `CLAUDECODE=1` again in the next), so a line is the unit. A
program the line works out when it runs (`$(which <kit>)`, `$KIT`) cannot be named: when the
line names the kit command, the guard **asks** instead of staying silent.

**How an edit is matched.** The path the call names is taken as written and as a real path (an
Edit follows a link, so `notes.txt` linking to `workflow.json` changes `workflow.json`);
either one that is a `.claude/cc-smart-dev-kit.json` (any folder: the main checkout, a worktree
inside `.claude/worktrees/`, a folder outside git), or inside the settings or state folder
(`cliPaths()`, so `CLAUDE_CONFIG_DIR` moves the state folder with it) or the installed plugin
folder, asks. **Each folder is compared as written and by its real path**, so a home folder whose
`~/.config` is a link cannot hide the file. Names compare without case.

**How a shell write is matched.** A Bash or PowerShell line that writes those same files asks,
with the Edit's reason: a redirect (`>`, `>>`, `>|`, `&>`; `2>&1` and `>&2` name no file; the
reader's `redirectionTargets` gives the targets), `tee` (and `Tee-Object`), `sed -i` / `perl -i`,
`cp` / `mv` / `install` / `ln` (`-t` and `--target-directory` included) and PowerShell's
`Copy-Item` / `Move-Item` (`-Destination`, or the last word), `dd of=`, `Set-Content`,
`Add-Content`, `Out-File` (`sc`, `ac`, `si`, `ni`, … — PowerShell takes any prefix of a
parameter name). Every target goes through the same `kitFileKind` as an Edit, as written (the
`~`, a relative path against the input's `cwd` and against each `cd` / `Set-Location` /
`Push-Location` the line ran before it) and as a real path, with each folder compared as written
and by its real path. **On Windows the Bash tool is Git Bash**, so a line may name a native file
in MSYS2's own form (`/c/Users/…` for `C:/Users/…`): the target is read as the drive it names
before the comparison (`shellTargetPath`, on Windows and for a Bash line only; PowerShell runs
natively), beside the Win32 forms Git Bash also accepts (`C:/…`, and a quoted `"C:\…"`, where
Bash keeps the backslashes). A write into the installed plugin folder asks too (never a deny: a
person may mean it before an update), and Claude Code's own `claude plugin …` commands are not
touched.
A target the line works out when it
runs (`> $FILE`, `$(mktemp)`, a glob) cannot be resolved: it asks only when the line also names
a protected file or folder by text (`cc-smart-dev-kit.json`, `.config/cc-smart-dev-kit`, the
state folder, the plugin cache folder), and passes otherwise. `cat`, `grep`, `sed` without `-i`,
`cp` *from* the file and a message that names it all pass.

**What it does not read.** The limit is the one the review gate has: it stops mistakes and the
easy shortcut, not a same-user process set on getting past it. A script file's content (`env -u
CLAUDECODE sh run.sh`), a program or port named at run time (`curl localhost:$PORT`), a portal
started with another `--port`, a hostname that resolves to this machine, and a file written by a
program the guard does not know (`python -c "open(…,'w')"`, `rsync`, `truncate`) are not read.
The portal check reads the text of the whole command, so a script in a here-doc that connects
counts — and so does a commit message that only mentions the address: one extra question, not a
miss.

### The Fable-session note

`fable-session` (SessionStart, PostModelSwitch, Stop) is machine-wide like `agent-guard`: the
model the main session runs on is the person's choice, and Claude never cares — no
`additionalContext`, no error, no block. The person may not have meant the `fable` tier, though
(it spends the plan's limits faster than Opus), so they get one `systemMessage` — a line Claude
Code shows the person, never Claude — once in a session (`fable-session.ts`). **The line was
seen live on a real session (2026-10-17)** — through `UserPromptSubmit`, the event this hook has
since left — and that it shows on `PostModelSwitch` and `Stop` is still not proved
(`docs/claude-code-contract.md` has the rows and the owed run).

Which model, per event:
- a **start**: only the `model` the input names — no fallback there (the schema Claude Code
  2.1.300 carries has `source` and an optional `model`);
- a **switch** (`PostModelSwitch`): `to_model` — "the resolved model id the session runs after
  the switch", from Claude Code's own input schema (2.1.302, read from the shipped binary). So
  the line appears AT the switch;
- a **finished answer** (`Stop`): the model that answered, from the transcript's last assistant
  message, then `ANTHROPIC_MODEL` (`sessionModelOf`, one home with the guard's fork rule). This
  is the catch-all for a Claude Code that fires no `PostModelSwitch`, and it cannot fire for a
  model the session has already left.

**`UserPromptSubmit` was the bug** (live, 2026-10-17): the model read there is the transcript's
last answer — the PREVIOUS turn's — so the hook ran one turn behind. It missed the switch to
Fable, and then warned while the person was back on Opus. Stop judges the answer that just
ended, and a switch back is a different answer.

The tier is read the guard's way too (`resolveLaunchModel`, `ANTHROPIC_DEFAULT_FABLE_MODEL` and
the fable slot's chain while the gateway is on included), so there is no second list of what
counts as Fable, and a tier a backend answers warns the same, naming the model (`the
\`fable\` model, openai:gpt-5.5`).

What it costs: a session that was told stops at the mark; a session on anything else pays one
`existsSync`, and — at a stop — the transcript's tail; the gateway config and Claude Code's
settings (is the gateway on?) are read only when the model text could be Fable at all
(`couldBeFable`). A session nobody
watches (`claude -p`) is told nothing and keeps no mark. The mark that keeps it to once a session
is `<TMPDIR>/cc-smart-dev-kit-session-names/<session id>.fable`, beside the session's own name
files (`namesDir`, one home), so the OS clears it; it is made with `wx`, so two runs that race
cannot both speak, and a mark that cannot be made means the line is not said at all — never
twice.

### The notifier

`notify` is a `USER_HOOKS` bundle: it never enters the frame, because it is about the machine
(`src/hooks/notify.ts`, its header is the full contract). Its own opt-in needs no
`cc-smart-dev-kit.json`; the one thing it reads from a project's file is the `workflow.alerts`
settings, when a project has them (§ The workflow › The alert settings).

**Which events, one alert each** (`plugin/hooks/hooks.json`): `Notification` (a session's own
"needs you" types, `worker_permission_prompt` included — `PLUGIN_NOTIFY_TYPES`; the idle
wait is left out — the `Stop` alert
already announced that turn); `Stop` (the turn's last answer as the body, from the
transcript's tail, 300 ms after the event because Claude Code writes it just then);
`PreToolUse` on `AskUserQuestion|ExitPlanMode` (Claude Code raises no Notification at the
moment Claude asks, so this covers it); `PostToolUse`, `PostToolUseFailure` on the same two
tools and `UserPromptSubmit` (that wait is over: the mark goes, nothing is shown); and
`StopFailure` (the turn died). A `rate_limit` stop belongs to the `stop-failure` hook only
where that hook will show its alert — a desktop to show it on, the gateway set up, and a
plan limit (`stopFailureWillAlert`) — so one stop never gives two alerts; where it has no
alert to give (no desktop, no gateway, a short rate limit, which is no plan limit), the
notifier announces the stopped turn on its own routes.

**Agent view and background sessions.** Claude Code raises `Notification` hooks in the
list's own process while `claude agents` is open: `agent_needs_input` while a session waits,
and `agent_completed` with "<label> finished" or "<label> failed". **That process runs only
the hooks in settings files, never a plugin's `hooks.json`** (proved live on 2.1.302,
`docs/claude-code-contract.md`), so `cc-smart-dev-kit setup` manages one user-level entry in
`~/.claude/settings.json` (`src/setup/user-notify-hook.ts`): matcher
`agent_needs_input|agent_completed`, the command
`"$HOME/.local/bin/cc-smart-dev-kit" hook notify`, timeout 10. It runs the same function the
bundle's entry runs (`src/hooks/notify-entry.ts`) through the launcher, so a plugin update
that deletes the old version folder cannot break it. The plugin's `hooks.json` leaves these
two types out (`NOTIFY_MATCHER`), so a normal session never runs the alert twice. The entry's
record is `owned-hooks.json`, never a `changed.json` kind: an older running cc-smart-dev-kit
(a portal copy, a session that has not restarted) refuses a changed.json kind it does not
know. An entry the person edited (another timeout, a redirection) is theirs — setup leaves
it, claims nothing and adds no second one, and `doctor` shows it as information, never a
failure. A hand-written entry setup replaced (it ran the plugin's own `dist/notify.js`, from a
version folder) does not come back on restore: the managed entry goes, and the file's backup
has the old one. A background update never runs setup, so when the entry is missing its
notification says `cc-smart-dev-kit setup` writes it (`NOTIFY_HOOK_SETUP_HINT`). The hook input is the
list's session and folder, so those alerts carry no session name (`titled(kind, null)`), and
the per-session question mark says nothing about them. `agent_needs_input` also comes from a
session's own process (a teammate's setup question, auto mode's classifier notice), and the
input carries no sign of which: both get the agent-view handling, so that one alert loses its
`· <session>` and its mark — a cost taken knowingly, since guessing from the message's words
would be wrong for one of them. On a Linux desktop the one-alert-per-session key adds the
session the message names (`agentViewKey`): one background session's alert never closes
another's. The list never writes a hook's `terminalSequence` out, so these types take the
devices first (`device-then-field`), and the field only when no device is found. A background session has
`CLAUDE_JOB_DIR` set (Claude Code's environment-variables page) and inherits the daemon's
`DISPLAY` and terminal variables, so an alert of its own would go to the wrong place: the
notifier and the usage-limit alert stay silent there, and agent view is the one place its
alerts come from while the list is open (`background-session.ts`). The owner accepted the
trade-off (2026-10-18): with no list open, a background session does not alert. The alert's
moment is its own field (`Alert.moment`), set with its words in `alertFor`: the
finished/failed split of `agent_completed` is what `alerts.events` filters on, like every
other moment.

**The waits that stay quiet**, all from the team's older notification script, which this
replaces: the permission prompt about six seconds after a question (the same wait — a mark
file per session, `/run/user/<uid>/cc-smart-dev-kit-notify-asked-<session>`, holds until anything
ends it, and only for ten minutes so a wait that ended unrecorded never hides a later alert);
a turn another session started (`startedByPeer`: `turnOrigin: "peer"` without a
`senderTaskId`, a human prompt into the turn or a helper agent's launch alerting as before);
the same error twice in a row (a per-session file remembers the last error, cleared by a turn
that ends well); a `stop_hook_active` Stop (a hook made Claude continue). One alert per
session per event, never two.

**The routes**, chosen per alert: **the desktop** — `notify-send` on Linux, and only with a
desktop (`DISPLAY` or `WAYLAND_DISPLAY`: a session over SSH with no desktop has no bus to
show anything on), `osascript` on
macOS, a PowerShell toast on Windows (`src/hooks/windows-toast.ts`, `docs/windows-notify.md`),
plus the freedesktop sound through `paplay`; **the SSH terminal** — with no desktop
route and `SSH_CONNECTION` or `SSH_TTY` set, the same title and body as OSC 777
(`ESC ] 777 ; notify ; <title> ; <body> BEL`), sanitised with `oneLine` (controls gone, one
line, capped) and sent through the hook's `terminalSequence` output field (Claude Code 2.1.141
and later writes it to the session's terminal itself, and wraps it for tmux — a wrapped
sequence in the field is rejected, so the field carries the bare one), or straight to
`/dev/tty` (wrapped for tmux by `tmuxPassthrough` when `TMUX` is set) for a Claude Code
without that field; **Warp at the far end** — `farEndIsWarp` sends that SSH alert in Warp's
own agent format instead: OSC 777 with `warp://cli-agent` and one JSON object (`v`, `agent`,
`event`, `session_id`, `cwd`, `project`, then `response` for a stop or `summary` for a wait;
`error_type` only when the input names a real StopFailure reason, because Warp shows it as a
prefix of the text). Warp shows its popup while the person is in front, and a desktop
notification with a sound while they are not, and it decides the sound itself: no extra BEL.
Proved live 2026-10-18 on a Windows PC reached over SSH from a pane without Warp's shell
integration; the plain OSC 777 gave a silent Windows notification there. The far end counts
as Warp when `isWarpTerminal` says so, when `LC_TERMINAL=WarpTerminal` arrives (the client's
`SetEnv`, through sshd's usual `AcceptEnv LANG LC_*`), or when the person set `sshWarp`; a
named terminal in `TERM_PROGRAM` (VS Code's `vscode`) says it is not Warp, while tmux's own
`tmux` says nothing about the far end. One function maps the event (`warpEventOf`): finished
→ `stop`, failed → `stop_failure`, and every wait and question — a permission prompt, a
crew session's prompt, agent view's `agent_needs_input`, a question — → `permission_request`.
`agent_needs_input` is never sent: Warp showed only a tab badge for it and no popup, while
`permission_request` showed the popup (proved live on Windows Warp, 2026-10-19);
**the session's own device** — for an event whose answer Claude Code does
not read at all (`StopFailure`), for agent view's own alerts (the list reads the field but
never writes it out: only a session's conversation view sets up that writer, 2.1.302, so the
list's own pty is the route there), and for a Claude Code too old for the field, where `/dev/tty`
is tried first and a hook on 2.1.301 has no controlling terminal at all (ENXIO): the pty
Claude Code is attached to, found from its pid (`CLAUDE_PID`, then the hook's parent:
`/proc/<pid>/fd/0`, then 1 and 2), written to only when this user owns it, and wrapped for
tmux like `/dev/tty` (proved live 2026-10-16: the alert arrived in the terminal beyond tmux,
exactly once; `src/hooks/terminal.ts`, `docs/claude-code-contract.md`); **nothing** — no desktop route, not over SSH, or **inside Warp** with
Warp's own plugin on (`TERM_PROGRAM=WarpTerminal`, or the `WARP_*` pair a background session
keeps), whose hooks already show a finished turn, a question, a permission prompt and an
error. In Warp ours plays only the sound, and shows a question (`elicitation_*`), a waiting
agent or agent view's finished/failed alert itself (Warp's plugin has no `agent_completed`):
those may sit in a tab the person is not looking at (owner, 2026-10-11). A
session that is none of those — no desktop, no SSH, no Warp — gets nothing, and that is not a
failure: an alert on every turn would be noise.

**The Linux desktop gives the alert more, where its tools are there**
(`src/hooks/desktop-alert.ts`): a click raises the session's terminal window, the alert
leaves the screen for the notification centre after a minute (`ALERT_SCREEN_MS`), only one
alert per session is on screen at a time, and XFCE's Do Not Disturb keeps an ordinary
alert's sound off (an urgent one sounds anyway, as XFCE shows those under Do Not Disturb
too). These are the desktop behaviours of the older notification script this replaces,
ported so a machine that moves to the plugin loses nothing.

Everything that waits runs in a detached worker — the `alert-worker` the usage-limit alert
already uses, through the launcher, never in the hook — and each extra runs only where its
tool is on PATH: `xdotool` to raise a window (the terminal's `WINDOWID`, or a VS Code or
Warp window found by its class and title); `gdbus`, the notification server itself, for the
notification's id — the minute and the one-per-session rule need it, and `notify-send`
never says which id it got — or a `notify-send` whose `--help` lists `--action` and
`--wait`, where the server has actions; `xfconf-query` for XFCE's Do Not Disturb setting.
Without them the hook keeps today's plain `notify-send`, and `doctor` names a missing tool
as information. One thing the older script did is **not** ported: picking the session's tab
inside XFCE Terminal (its accessibility service, AT-SPI, reached through Python bindings
this plugin does not carry) — the window is raised, and the tab stays where it is. macOS,
Windows and the SSH terminal are unchanged.

**The title** is `<kind> · <session>`: the session's newest `customTitle` from the
transcript's tail (`cleanSessionName`), else the folder of the hook's `cwd`; agent view's
alerts carry no session name, because their input is the list's. **The settings**
are `~/.claude/cc-smart-dev-kit/notify.json`: `desktopSound` (default on), `sshBell` (default off,
one BEL after an SSH alert) and `sshWarp` (default off: the fallback that says the far end of
an SSH session is Warp). The notifier starts detached, so a slow one never holds the
hook. `setup` does not touch anyone's own notification hooks: a person with those removes
them by hand when they switch to this one.

**tmux** (`src/setup/tmux.ts`): a sequence written inside a pane is parsed by tmux and
dropped, so it reaches the outer terminal only inside tmux's passthrough wrapper, and only
while `allow-passthrough` allows it. `cc-smart-dev-kit setup` adds one managed line (`set -g
allow-passthrough all`) to `~/.tmux.conf` when tmux is installed — `all`, so an alert from a
window the person is not looking at arrives too (owner, 2026-10-16) — prints `tmux set -g
allow-passthrough all` when a server is running (it never changes a running server itself),
and `restore` takes the line out through the same `file-line` record (`managed-line.ts`) that
keeps every line the person wrote. `doctor` reports, as information, a missing line and a
running server that does not pass alerts through.

### The Bash judge and the job route

`job-route` (PreToolUse on Bash and PowerShell) is the kit's one shell judge, and it keeps its
public name: `hooks.json`, project files and `ownHooks` values stay valid. It is **machine-wide**
and **`alwaysOn`** — the frame skips the `ownHooks` step and `ownHooks` cannot switch it off — and
it runs outside git, and with a broken or too new `cc-smart-dev-kit.json`: a session must not be
able to switch off the limits on its own launches by editing a file it owns (the reason
`session-escape-guard` is always on too). A project file that still lists `"job-route"` keeps
parsing (`UNSWITCHABLE_HOOK_NAMES`), it silences nothing, and `doctor` prints one `·` line that
it can go. Two parts sit in it, and only one reads the project.

**Both shell tools.** Claude Code has a PowerShell tool beside Bash on native Windows, so the
judge is wired on both and reads each line in its tool's dialect (`dialectOfTool`): a limit a
session steps around by choosing the other shell tool is not a limit. The route and the lead's
background move stay **Bash only**: their rewritten line names the `sh` launcher and, for
anything but one plain command, `sh -c`, which the PowerShell tool cannot run — a wrong rewrite
is worse than none, so a PowerShell line is judged and otherwise left as it was written.

**The judge** (`src/hooks/bash-judge.ts`, the rules; `job-route.ts`, the answer) reads the line
with the one shell reader and answers four things:

- **a raw background session**, `claude --bg` / `--background`: an **ask** in an attended
  session, a **denial** in `claude -p` (nobody answers there) and in a crew session (a crew
  session never starts crew sessions). The ask shows the `crew start` line — that session is
  recorded in the store, gets its own worktree, a lead and a report (D25) — and the line for a
  session that leads nothing yet (`crew lead --plan`). The crew launcher picks the kind's
  model and effort; for another one the person starts the session themselves (the launcher
  refuses an override the Agent guard would ask about, W1a), so the judge never asks a second
  time about an override.
- **a print run**, `claude -p` / `--print`: the launch policy every Agent launch meets
  (`judgeLaunch`, § The Agent guard) on its `--model` and `--effort`, after Claude Code's own
  overrides; the prompt is read for a `Fable reason:` line. No model or no effort is refused, the
  `fable` tier asks, the `opus` tier at `max` asks — and in an outer `claude -p`, every ask is a
  refusal. A `claude` subcommand (`claude agents`, `claude stop`, …) is not a launch and is left
  alone. The reader steps over the wrappers around a launch (`setsid claude --bg`, `flock <file>
  claude --bg`), and reads `npx` / `bunx` / `pnpm dlx` of `@anthropic-ai/claude-code` as `claude`.
  A program the line works out when it runs (`$(which claude) --bg`) is judged by the same
  words: `--bg` is a background launch, and `-p` counts as one only when a word names Claude
  Code (`cp -p` is no launch).
- **a crew session's `crew start`**: denied, in the launcher's own words (`CREW_NEVER_DOES`,
  `src/crew/brief.ts`): the need goes to the lead with `crew report --question`.
- **polling**: a `crew list` / `crew status` read or a `claude agents --json` read that repeats
  over time — inside a `while` / `until` / `do` loop (bash, the condition included) or a
  PowerShell `while` / `do`, or a `watch` — or beside a `sleep` or `Start-Sleep`, is denied — a
  crew session's news arrives by itself, through the lead's watch and the monitors. A
  `for` / `foreach` over a fixed list with no wait is no poll (F2a-6), and neither is a read
  whose output a later loop walks (`claude agents --json | … | while read id; do …`). One read,
  and `crew watch` itself, pass.

**The route** is the heavy-job queue's door, and the project's opt-in: with
`"jobs": { "route": true }` in its `.claude/cc-smart-dev-kit.json` (the `switches.jobRoute`
switch), a command its kinds classify as heavy is sent through the queue instead of running raw
(`docs/jobs.md` § The route). It answers with Claude Code's `updatedInput` — the same tool input,
its `command` replaced by `"$HOME/.local/bin/cc-smart-dev-kit" job run --kind <kind> --
<command>` — proved live on 2.1.301 (`claude-code-contract.md`). It gives no
`permissionDecision`: the rewrite replaces the input and the permission system still decides
about the new command, so a person's own rule for Bash keeps working. **Only a line whose every
command is heavy, a `cd` or an assignment is queued** (`classifyRoutableLine`); any other line
runs raw. Why: Claude Code matches a person's `Bash(…)` rules against the command it is about
to run and does not look inside `bash -c '…'`, so a rewritten `tsc && rm -f x` would hide its
`rm` from a `Bash(rm:*)` rule (proved on 2.1.308, `claude-code-contract.md`).
`REWRITE_SUPPORTED` in the hook is the one switch, and with it false the same command line is
denied instead, never silently left raw. A command already inside `cc-smart-dev-kit job run` is
left alone. A name the project's `package.json` defines as a script is matched only by a
`script` kind, never by a tool of the same name: a `tsc` script that already wraps the job is
not wrapped again (`docs/jobs.md` § The classifier). It is the one guard that changes the call
rather than asking about it.

**A lead never waits on what it started** (D22): in a session recorded as a lead (`crew lead`,
`readLead`), a CI watch (`gh pr checks --watch`, `gh run watch`), a queued job and the project's
full check (`bun run check`, `npm run check`, … — its package manager's `check` script) are
moved to the background with `run_in_background: true`, proved honoured on 2.1.308 (offline:
a fake Anthropic server, a throwaway `HOME`, the `job-route` bundle as the project's hook — the
tool result read `Command running in background with ID: …`; L1a.1 proved the same on 2.1.306).
A routed heavy job gets the queue
and the background in one rewrite. The whole line must be that thing (and `cd`s and
assignments), so a compound line is left as the model wrote it, and a call already asking for
the background keeps its own input.

**Left in the project that had them** (project values or project tools, not general): a ban
on one package manager, the local database wipe guard, the heavy-job guard, a pull request
into a release branch, the main checkout following the base branch after each merge
(installs and migrations), the notes about one project's dev notes, migrations and env
files, and the claude-mem start-folder note. **Ported in Phase 4, with the MCP servers the
plugin registers:** the Serena root record (Serena's edits in the main-folder guard — the
`serena-root` hook, retired with Serena in 0.6.0) and the Playwright output folder (the
`playwright-output` hook, above).
**Not ported:** the Windows helper that
removes a worktree after the session lets go of it — the plugin removes one when its session
asks (the WorktreeRemove hook) or by `cc-smart-dev-kit worktrees --clean`, and it moves the
folder before it deletes it, so a program still using it makes the removal fail and touch
nothing (`docs/windows-setup.md`);
and, from the older notification script, the tab pick inside XFCE Terminal (AT-SPI reached
through Python bindings, which this plugin does not carry — the window raise itself came
over, § The notifier). The alerts, the waits they skip, the titles, the sounds, the click
that raises the window, the minute on screen, the one-alert-per-session rule and the XFCE
Do-Not-Disturb check are the same as that script's — they are the `notify` hook's contract
(§ The notifier, `src/hooks/desktop-alert.ts`).

### `doctor --live`

`cc-smart-dev-kit doctor --live` (opt-in; it uses the person's login and costs a few cents) makes one
throwaway repo in a temp folder, without `cc-smart-dev-kit.json` (Claude Code's own worktrees,
what every project uses), and runs one `claude -p` session in it with
this plugin (`--plugin-dir`), only the EnterWorktree, ExitWorktree and Bash tools,
`--allowedTools` for exactly the calls it makes (never a mode that skips the permission
checks), and a three-step prompt: enter a worktree, `git status` there, leave with
"remove". Every hook run is logged (`CC_SMART_DEV_KIT_HOOK_LOG`, with each run's `cwd` and the spec's
`logFacts`), and it checks: the plugin's hooks fired (SessionStart,
the git guard), the git guard **read the command line** (its log names the programs it
parsed: a hook that fired is not a guard that answered), no WorktreeCreate hook ran, Claude
Code made its own worktree and the session worked in it, and ExitWorktree removed it. No
repo wires a worktree hook: the retired engine's is gone with the engine. When all pass it
records the Claude Code version in the state folder (`live-check.json`); plain `doctor` shows
that line, and says to run it again when the installed Claude Code is another version.

## The workflow

The workflow is the policy for what cc-smart-dev-kit may do **by itself**: commit a finished
step, push the branch, open a pull request, merge it, and how. It is one module
(`src/workflow/`) of small pieces, and none of them runs a git command: they decide, and
whatever runs a command asks them first.

**Resolution, field by field** (`resolve.ts`), the project over the person over the built-in
default:

| Where | What holds it |
|---|---|
| `"project"` | the `workflow` object in the project's `.claude/cc-smart-dev-kit.json`, committed with the code |
| `"personal"` | `~/.config/cc-smart-dev-kit/workflow.json` (folder 0700, file 0600, atomic writes like the other config files) |
| `"default"` | `workflowDefaults` in `schema.ts`: the safe ones — nothing is committed, pushed or merged without the person, and every alert is on |

`resolveWorkflow(paths, projectConfig)` returns every value with the source it came from, so
`cc-smart-dev-kit workflow show` (and the portal's settings page) can say *why* a value is what
it is; both read a key's value through one map, `resolvedValueOf`, so a new setting is one
entry there (the type checker refuses a key without one). A group (`alerts`,
`fixesAfterReview`, `crew`) merges field by field like the rest. The one schema is reused by `src/project/config.ts` for the project's `workflow`
object, so a field can never mean two things in the two files. A broken personal file throws
`WorkflowConfigError`, which names the file and the field: the person must hear it. A field
with a wrong kind can never be written (`write.ts` validates the whole file before the
write), and a file it may not change is left alone rather than half-written.

**The switches are the exception, on purpose.** `switches.statusLine`, `switches.sessionNames`,
`switches.jobRoute` and `switches.updateHold` are not stored in either workflow file: each
names a setting that already exists (Claude Code's `statusLine`, the project's
`sessionNames`, its `jobs.route`, the `update-hold` file), and the resolver reports that
setting's value *now*, with the place it lives as its source. A `workflow set` writes that
setting — Claude Code's own key through `applyManagedJson`, so a status line someone else
set is never overwritten — which is why a switch cannot be stored and why the schema refuses
a `switches` object written into a file by hand. One truth per switch.

**The auto-merge rule** (`auto-merge.ts`, `autoMergeAllowed`) is a pure function with its own
tests, because it decides whether a command may run without a person:

```
autoMergeAllowed(resolved, projectConfig, prBase, defaultBranch)
```

True only when `autoMerge` is on **and** the project names an integration base
(`worktrees.base`) **and** the pull request's base is exactly that base **and** that base is
not the repository's default branch (a merge there is a release, never a hook's decision)
**and** it is not a target of `worktrees.bases` (then another family of branches feeds it,
so it is not a plain integration base). The integration base may itself be in
`protectedBranches`: it is the one branch this may write to, and the git guard still asks
about a push of it by hand. Every other protected branch is never a target, because the
pull request's base must be the integration base — so those keep asking the person, which is
the whole point of protecting them. CI green and the review done are the caller's checks
(the merge guard hook), not this one's: this function answers about branches only.
`autoMergeRefusal` is the same rule in words — the reason the merge guard asks — and
`autoMergeAllowed` is `autoMergeRefusal(…) === null`, so the five conditions live in one
place (`auto-merge.ts`).

**Who follows a setting: a hook where a hook can, the instructions where only the session can.**

| Setting | Followed by |
|---|---|
| `autoCommit`, `clearWorktreeAfterMerge` | the skills (`commit`, `worktree`): each reads `cc-smart-dev-kit workflow show` and follows it. Nothing else can: a commit and a folder are the session's own doing, and no hook sees them as one act. |
| `autoPush` | the **git guard hook** (`src/hooks/git-guard.ts`), PreToolUse on Bash and PowerShell: while it is off (the default) the guard asks before every `git push` (D15), reading the value as committed on the base (`resolveGate`); a crew session's push is denied whatever it says (D24). |
| `openPr` | the **merge guard hook** (`src/hooks/merge-guard.ts`): `off` asks before `gh pr create` and `gh pr ready`, `draft` asks for a pull request that does not open as a draft and for every `gh pr ready`, `ready` asks for neither (D16); read as committed on the base, and a crew session's `gh pr create` is denied (D24). |
| `autoMerge` | the **merge guard hook** (`src/hooks/merge-guard.ts`), PreToolUse on Bash and PowerShell — the one step a hook can stand in front of. `mergeMethod` and `deleteBranch` stay instructions: they say how a merge the guard allowed is made. |
| `reviewBeforePush` | both: the **review-record hook** writes the record when a review agent finishes (§ The review record), and the merge guard reads it. |
| `reviewAgents` | both: the **review-record hook** records only an agent listed there, and the **merge guard** trusts a record only when the list committed on the pull request's base names the agent that wrote it. A project that runs its own reviewer names it (the plugin's `cc-smart-dev-kit:reviewer` by default). |
| `alerts.events`, `alerts.sound` | the two alert hooks, `notify` and `stop-failure` (§ The notifier). |
| `alerts.usagePercent` | the status line (`src/cli/statusline.ts`), whose warning share it is. |
| `fixesAfterReview.*` | `readCover` (`src/workflow/review-cover.ts`, § The review record): the limits a change after a review may reach and still be covered. Resolved, shown by `workflow show` with their source (and as one `in force` line), and written by `workflow set`; the merge guard judges with them, through `merge-check.ts`. |
| `crew.enabled`, `crew.max`, `crew.maxOpus`, `crew.memoryGb`, `crew.tag` | `crew lead` and `crew start` (`src/crew/`, § Lead and the crew): the switch they refuse without, the two caps (D37) and the free memory a start is queued by, and the tag in the names. |
| the other `crew.*` | nothing yet: resolved, shown by `workflow show` with their source, and written by `workflow set`. The later crew session parts (the watch, the crew session's own hooks) will read them. |

**The merge guard** asks the person before a merge its rules do not allow, and lets one through
with no question only when **all** of these hold: `autoMerge` is on (`autoMergeOff` is the first
check, before any `gh` call, so a machine without `gh` hears the real reason); `autoMergeAllowed`
says yes for the pull request's base; the merge names **this project's own repository**
(`--repo`/`-R` is compared, owner/name case-insensitively, against the `origin` remote read with
git — the policy is about the repository the work is in, so another one always asks); every
required check `gh pr checks --required --json name,bucket` reports is green (a `skipping` check
counts as passed, which is GitHub's own rule for a merge); and — with `reviewBeforePush` on —
the head from `gh pr view` is covered by a review (D17, § The review record).

**The judgment is one home**, `src/workflow/merge-check.ts`: `checkPullRequest` reads those
facts and decides, `checkBranch` does the same for a local branch against a base (the review gate
only: a local merge has no pull request's checks or `autoMerge`), and
`cc-smart-dev-kit workflow merge-check [<pr>… | --branch <b> --base <base>]` prints each verdict
(`allowed`, or the reason it asks; exit 0 when every one is allowed, 1 when any asks) — the
guard's own words, without making a merge. The hook keeps the rules about the command line: what
is a merge, `--admin`, and another repository; it reads `ownHooks` from the integration base
before any gh call, so a project that runs its own merge guard answers alone, and a crew session
never opens a pull request (D24).

**D31: the exact merge is answered `allow`.** Auto mode's built-in "Merge Without Review" rule
blocks every merge no person approved; a hook's `allow` skips the classifier for that call
(proved live, L1a.5). So `merge-guard` answers `allow`, with a short reason, only when the WHOLE
line is exactly `gh pr merge <n>` with flags gh 2.102.0 has (`exactMergeOf` in `after-merge.ts`:
one reading, one command, no wrapper or assignment before gh, no pipe, no writing redirection, no
alias, a number rather than a branch or URL) and the whole policy above passed. Any other
passing form — `timeout 60 gh pr merge 7`, `gh pr merge 5 && gh pr merge 6`, an alias, an
unknown flag, an armed `--auto` merge (it lands later, so a commit pushed after the check would
merge unread) — stays silent, so auto mode's own rule still applies to it; an unknown
`gh pr merge` flag asks. **A crew session never gets `allow`** (D24: it never merges; the
lead does), so silence is all it can get, and auto mode's rule still applies there.

**It also governs opening a pull request** (D16, `openPr`): it reads `gh pr create`, `gh pr
new` and `gh pr ready` — a `-R`, a `gh alias`, a `gh api` POST to the repository's pulls
endpoint, the GraphQL `createPullRequest` and `markPullRequestReadyForReview` — and the
committed `openPr` decides: `off` asks before any of them, `draft` lets a create that opens
as a draft through (`--draft`, `-d`, `-fd`, `--draft=true`) and asks for one that opens
ready and for every `gh pr ready`, `ready` asks for neither. `gh pr ready --undo` opens
nothing. The value is read with `resolveGate` like the merge's, from the base this checkout
names (`worktrees.base`); a policy it cannot read asks. **A crew session opens no pull
request at all** (D24): `gh pr create` pushes the branch, so it is denied whatever `openPr`
says — the lead opens it, or the person does.

**An opening outside the base its head branch belongs to asks** (WA1): `gh pr create`'s
`--base` (`-B`) is compared with the base `worktrees.base` or the `worktrees.bases` prefix
mapping gives that branch (`baseForBranch` in `src/project/config.ts`, the longest prefix),
and with no `--base` the pull request opens into the repository's default branch — read with
`gh repo view`, then git's `origin/HEAD` — so that asks too when it is not the base. The
question names both branches, and it never denies: the person may mean it. A `gh pr ready`
and a `gh api` opening, which names its base in its own fields, are not part of this check.

**The settings that cannot work together are named where they are shown** (D16): one pure
function, `workflowClashes` in `src/workflow/clashes.ts`, called by `workflow show`,
`workflow set` (after the write), `project init` (in its plan, before anything is written)
and the portal's Settings page (a `!` line under the row). The pairs: `openPr` on with
`autoPush` off (the pull request waits for a push a person must approve every time),
`autoMerge` on with no `worktrees.base` (there is no branch it may merge into by itself),
and `autoMerge` on with `openPr: draft` (a draft is never merged). Each line says the fix.

**The review gate is read as committed on the pull request's base**, never from a checkout's
working copy. Every value the guard judges with — `autoMerge`, `reviewBeforePush`,
`reviewAgents`, `fixesAfterReview.*` (the limits a fix after a review may reach and still count,
D17, § The review record — read and shown with the gate, and the guard judges with them through
`merge-check.ts`), `worktrees.base` and `worktrees.bases`, and whether the committed `ownHooks`
hands the merge to the project's own guard — comes from the built-in default, the person's
`workflow.json`, and `.claude/cc-smart-dev-kit.json` as `git` holds it at `origin/<base>`
(`resolveGate` in `src/workflow/resolve.ts`, over `readCommittedConfig` in
`src/project/resolve.ts`: `rev-parse` and `cat-file`, no fetch). A session edits its own
worktree's file in a second; it cannot change what a branch it has not pushed to says, and a
push to the base is what the guards and the review stand in front of. Two reads, one function:
before any `gh` call, the base this checkout names (`worktrees.base`), so `autoMerge` off still
asks without `gh`; then, once `gh pr view` names the pull request's base, that base's file,
which judges the merge (`autoMergeRefusal` gets its `worktrees`). No `origin/<base>` (a new
repository, a fork, a branch never fetched), no file there, or a file this plugin cannot use
(broken, or a `requires` it does not meet) asks, naming which. Because nothing is fetched, a
policy change counts once it is committed, pushed and fetched. `cc-smart-dev-kit workflow
show` prints the gate's own lines (`gate autoMerge = …`) from the same read, so it never
disagrees with the guard, even while the checkout's file says something else; `workflow
set|unset` of a gate key (`REVIEW_GATE_KEYS` in `schema.ts`) refuses inside Claude Code, and
the guard's "autoMerge is off" question says to commit the change to the base and push it.

**Every merge of the line is judged**, in the order it runs them: `gh pr merge 5 && gh pr merge
6` reads both, and the first the policy does not allow asks, naming that pull request
(`mergeCalls`, in `after-merge.ts` — the one reader of a merge command line, on the one lexer
every guard uses, `src/shell/command.ts`). The forms it reads: `gh pr [<its own flags>] merge …`
(`gh pr -R owner/repo merge 5`, `-R` before the subcommand), `--auto` (an armed merge lands once
the checks pass, with nobody watching) while `--disable-auto` is no merge, and a `gh <word>`
that is no gh command — an alias, looked up once in `gh alias list` (a local file read) and
judged like its expansion, with a shell alias (`!…`) asking. The forms it never judges ask with
the reason: a `gh api` merge (the pull-request merge endpoint in any method spelling, or a
GraphQL query naming `mergePullRequest`/`enablePullRequestAutoMerge` — or one it cannot read at
all), an extension whose words name a merge, and a command whose earlier steps change the folder,
the branch or the repository the merge acts on (`cd`/`pushd`/`git -C`, `git switch`/`checkout`,
a `GH_REPO=`/`GH_HOST=` assignment, an `env` prefix): the guard does not follow those, it asks. A
quote, a here-doc or a comment is not a command, and the wrappers the git guard reads work the
same way (`timeout 60 gh pr merge 5`, `setsid gh pr merge 5`). A program the line works out when
it runs (`$(which gh) pr merge 5`, `$GH pr merge 5`) cannot be named, so a line whose words name
a merge asks rather than pass unseen.

Everything it reads is read-only (`gh pr view`, `gh repo view`, `gh pr checks`, `gh alias
list`), each call takes 10 s and the hook has 30 s (`hooks.json`), and only a command that
really asks for a merge reaches them. **It fails closed**: a `gh` that is missing, fails, or
answers something the guard cannot read is a question, never silence. In a project with no
`cc-smart-dev-kit.json` it stays silent like every plugin hook: there is no policy to judge with,
and a project that never opted in must not notice the plugin. A project that keeps its own
merge guard silences this one with `ownHooks`, like the other guards; the guard also reads
`ownHooks` from the committed file of the base. (The frame's own `ownHooks` step still reads
the checkout's file, for every plugin hook alike: `src/hooks/run.ts`.)

**The review record** (`src/workflow/reviews.ts`) is what "the review is done" means to a hook.
One small JSON file per repository, `<stateDir>/reviews/<key>.json` (mode 0600, written
atomically, the newest 50 commits kept), where the key is a hash of the main checkout — the same
key the after-merge note makes, so every worktree of a repository shares one record. Each entry
is `sha → { at, by, branches? }`: when it was first recorded, every writer that recorded it (an
agent type, or `workflow review-done` for the person by hand), and the branches the reviewer was
on (since 1.0.0). An entry without `branches` — a 0.6.0 record, a review on a detached HEAD, one
written by hand — still reads and counts for its exact commit only. An entry an older plugin
wrote (`sha → time`) names no writer and counts for nothing: that commit asks once.

**A review counts for its branch and the fixes after it (D17).** A review of commit R covers a
later head H when R's record names H's branch and the change made since R, **the base's own
changes taken out**, stays within the limits the base commits (`workflow.fixesAfterReview`,
default 200 lines, 10 files, 20%): covered while its lines are at most `lines` or `percent`% of
the reviewed change's lines, whichever is more, **and** its files at most `files` or `percent`%
of the reviewed files, whichever is more. `0`/`0`/`0` means the exact reviewed commit only. A
review of H itself covers H on any branch, as before. The one home is
`src/workflow/review-cover.ts` (`readCover`, and the pure `coverRefusal`):

- `B = git merge-base H origin/<base>`, then `T = git merge-tree --write-tree B R` — the reviewed
  change replayed on the base H's branch is on. merge-tree writes the objects it makes, so it runs
  with a **temporary object folder** (`GIT_OBJECT_DIRECTORY`, the repository's own objects read
  through `GIT_ALTERNATE_OBJECT_DIRECTORIES`), removed after: nothing is written into the
  repository. A conflicted replay (exit 1) still prints a valid tree, with the conflict markers in
  its files, so a conflict resolved by hand counts as change.
- The change after the review is `git diff --numstat -z -M T H` (no textconv, no external diff);
  the reviewed size is the same count over `merge-base(R, origin/<base>)..R`. Lines are added plus
  deleted; files are paths.
- So the base merged into the branch, or a rebase that only moved it, counts for nothing; a fix
  commit, a rebase that edits, a hand-resolved conflict and a new file count. A revert of the
  reviewed change counts its whole size. A review on another branch never covers, so a stacked
  pull request is not covered by the review of the branch below it.
- A review whose change is already all in the base (`git diff --quiet B T`: its branch was
  squash-merged and the name used again) is no candidate. Of several candidates, the covered one
  with the smallest change is named; when none is covered, the reason is about the smallest.
- Files the base marks `linguist-generated` (`git check-attr --source=origin/<base>`: the base's
  attributes, so a pull request's own `.gitattributes` hides nothing; this repo marks
  `plugin/dist/**`) are listed, not counted. A binary file in the change is never covered.
- Anything it cannot read is "not covered", with the reason: the head or the reviewed commit not in
  this checkout ("fetch it"), no `origin/<base>`, the caller's time running out, or git older than
  2.40 (`check-attr --source` came in 2.40; `doctor` warns with one `!` line, and such a machine
  matches the exact head only). It never fetches.

The limits come from this repo's own fix rounds: 10% of the reviewed change is covered, 105% and
160% ask. A limit is a trade: up to 200 lines written after the review merge unread, which is the
point of not paying a second review for a small fix. **The merge guard judges with this rule**
(D17b): `checkPullRequest` in `src/workflow/merge-check.ts` reads the cover for the pull request's
head on its head branch, and asks with the counts and the limit when the fixes are over it; a
record of the exact head still covers at once, on any branch, with no git run.
`cc-smart-dev-kit workflow merge-check --branch <branch> --base <base>` prints the same verdict
for a local merge — the lead's hand-back gate (D22) — and `workflow show` prints the limits in
force on one `gate fixesAfterReview in force:` line.

**Every write holds the record's own lock** (`withLock` on the
`reviews/` folder, a 3 s wait): two reviewers that finish at once both land. It is not the
state folder's shared lock, whose 10 s wait is as long as the hook may run.

**Who writes it: the review agent's own start and end** (`src/hooks/review-record.ts`,
`SubagentStart` and `SubagentStop`). A record a session writes for itself is only the
session's word — any caller could name a commit nobody read — so the one writer is the hook
Claude Code tells when a subagent starts and is done. At the start, when the agent's
`agent_type` is one the workflow's `reviewAgents` lists, it notes the commit the input's `cwd`
is on and its branch (`git symbolic-ref --quiet --short HEAD`; none on a detached HEAD), keyed
by `agent_id` (`<key>.starts.json`; Claude Code's `agent-` prefix and the bare id are one agent;
the first start stays when a resumed agent starts again; a day-old start is dropped). At the end
it takes that start back and records **the start commit, on its branch** — never the commit the
folder is on at the stop: a fix committed while the reviewer read is a fix it never saw, and it
counts as change after the review like every later fix (D17, above). A stop with no start seen
records nothing (one stderr line says to run the review again). The names are compared by
`recordsReview` in `reviews.ts`, the one home of that question: a `plugin:name` exactly, a bare
name only for an agent with no plugin prefix — Claude Code reports a plugin agent as
`plugin:name` (code.claude.com/docs/en/hooks § SubagentStart), so another plugin's
`reviewer`, or a project agent of that name, never counts for `cc-smart-dev-kit:reviewer`. The
Agent guard keeps no review list since D11: every `opus`-tier launch below `max` runs with no
question, a review or not.
The list the hook reads is the checkout's own, but the record keeps the agent that wrote it,
and the merge guard judges that agent against the list committed on the base (`hasReview`):
a list a session adds to in its own worktree records nothing the guard trusts. **SubagentStop,
not PostToolUse on the Agent tool**: on Claude Code 2.1.301 every Agent call runs in the
background — the tool call returns at launch, and the agent's end comes later — so a
PostToolUse hook would record the commit before the reviewer had read a line. A plugin
SubagentStop is allowed by `.claude/rules/hooks.md` because this hook touches no worktree;
its SubagentStart cannot block a launch and adds no context. A run whose `cwd` is inside a
subagent's own worktree records nothing: its branch is a fresh one from the base, never the
commit a reviewer read. Success prints nothing at all; a record that cannot be written is one
stderr line, exit 0. `cc-smart-dev-kit workflow review-done [--sha <commit>]` stays for the
person's own terminal and **refuses inside Claude Code** (`CLAUDECODE`): it resolves the
commit with `git rev-parse` and records it `by` the person, which the guard trusts whatever
the list says; `cc-smart-dev-kit workflow show` prints whether the commit here has a record
the gate's own list trusts.

**What these checks are, and are not.** The review gate, the record and the `CLAUDECODE`
refusals stop mistakes — a session that switches a setting off in its own checkout, a stray
`review-done`, another plugin's agent that happens to be called `reviewer`. They are not a lock
against a process set on getting past them: anything that runs as the person can write the
person's own files (the record, `workflow.json`), drop `CLAUDECODE` (`env -u CLAUDECODE`), or
push to a branch the person may push to. What holds against that is the repository's own
branch protection and the person's yes to a merge.

**The alert settings** are read by hooks that run often and must never fail
(`src/workflow/alerts.ts`): `alertsAt(paths, cwd, env)` resolves them once per run — the
project's over the person's over the built-in defaults — and a file it cannot use (a broken
`cc-smart-dev-kit.json`, a broken personal `workflow.json`) drops that file alone: every value
that can still be read stays, the project's over the person's (`alertsFrom({}, project)` when
the person's file is the broken one), with one line for stderr. A folder that is not a project, or a hook input with no `cwd`, is not a problem
and says nothing. The sound itself is one home per platform (`src/hooks/alert-sound.ts`): the
freedesktop sound through `paplay` or `canberra-gtk-play` on Linux, a system sound through
`afplay` on macOS, the toast's own sound on Windows, and the SSH terminal's bell in `notify.ts`.

## The safe switch

A project may already have its own copy of a piece the plugin now ships (a guard, a note).
Moving it to the plugin must never run it twice or leave a gap:

The project names its own copies, and the plugin steps aside for exactly those:

1. **The project lists each plugin hook it still runs itself**: `ownHooks: ["git-guard"]`
   in its `cc-smart-dev-kit.json`. The plugin's copy of that hook then stays silent there
   (§ The hooks › One frame for every hook). A plugin hook the list does not name still
   speaks, so a gap is never silent, and a project hook on the same event alone silences
   nothing.
2. Every machine gets the plugin, and `cc-smart-dev-kit doctor` is green on each.
3. **Then the project removes its copy**, one at a time, and takes that name out of
   `ownHooks`; with the list empty it raises `requires` in its `cc-smart-dev-kit.json`.
4. **A small fail-closed check in the project** covers a machine without the plugin: it
   stops risky work instead of going on unguarded.

Rollback is a new release with the old behaviour. A version number never goes down.

`cc-smart-dev-kit doctor` follows the switch at both ends: a name in `ownHooks` whose event has no
project hook left to answer is a warning (the project is unguarded while it is listed), and
a project hook running next to a plugin hook that is not listed is a warning too (both may
answer the same command). The second warning leaves the machine-wide hooks out
(`MACHINE_WIDE_HOOKS` in `src/hooks/specs.ts`: `stop-failure`, `update-check`, `notify` and
`agent-guard`): they answer about the machine, not the project, so a project hook on their
event is not a second copy of a plugin piece.

**A plugin hook the plugin retires** keeps its name in the schema as a retired name
(`RETIRED_HOOK_NAMES` in `src/project/config.ts`; today `serena-root`, 0.6.0): a project file
that still lists it parses, and the name silences nothing, because no hook of that name runs.
Refusing it would fail the strict parse, and every guard would then ask about every call.
`doctor` prints one `·` line that the name can go.

The retired worktree engine is not part of the switch: a project that still has its lines or
its fields fixes both with one run of `cc-smart-dev-kit project init` (README § Worktrees), in
one commit. `cc-smart-dev-kit doctor` names what is left.

## The browser

The Playwright MCP server (`src/browser/`, rules in `.claude/rules/browser.md`) drives **the
person's own Google Chrome**, through the **Playwright extension**, in ONE Chrome profile of its
own named `claude-code`. The owner decided this (2026-10-16), replacing 0.3.0's shared browser:
the plugin starts no Chrome, keeps no profile folder of its own, and no longer carries the tab
filter that made each session's windows its own.

- **Extension mode is the only mode.** `browser mcp` runs the pinned `@playwright/mcp` with
  `--extension --browser=chrome --profile-dir-name=<the profile's folder>`; Playwright itself
  connects to the running Chrome (`cdpRelay.ts` opens the connect page, starting Chrome when it
  is not running). The registration is unchanged — `{"command": <launcher>, "args":
  ["browser","mcp"]}` — because the mode is the launcher's own business and every setting
  reaches the MCP through its environment or `argv`.
- **One answer to "which profile".** `claudeCodeProfileOn` (`chrome.ts`) finds the `claude-code`
  profile — its folder, else the folder `Local State` names `claude-code` (Chrome's own "Add
  profile" makes `Profile 2`) — and the launcher, `doctor`, `browser setup` and the portal all
  ask it. The launcher passes that FOLDER name to `--profile-dir-name`; it once always passed
  `claude-code`, so a profile named in Chrome's dialog showed ✓ in `doctor` and failed in the
  MCP. With no profile yet it passes `claude-code`, and the MCP's own error names it.
- **Google Chrome only.** `chromeCandidates` lists Google Chrome's own places (and a macOS
  `~/Applications` copy), never a Chromium: the MCP's `--browser=chrome` drives Google Chrome
  and its profile folder, while a Chromium keeps its profiles elsewhere (a snap one in yet
  another place), so a Chromium found here was reported as "Google Chrome" for a browser the
  MCP never drives. Pairing each Chromium with its own folder and channel would mean a second
  launch mode nobody has proved; dropping it keeps `doctor` and the MCP looking at the same
  browser.
- **The MCP runs in the browser's output folder**, never in the session's. Claude Code starts the
  launcher in the session's folder, and bun reads the working folder's `bunfig.toml` (its
  `preload`) and `.env` for every bun it starts — bunx looks in its `node_modules` first too. The
  launcher itself runs with the plugin's two flags (§ The two flags), but the `bunx` child it
  starts, and the bun that runs the package, would not: the process that holds the token ran the
  project's own preload (proved with a planted one, `launcher.test.ts`). So the child starts in
  `cliPaths().browserOutputDir`, which the launcher has just made private. A relative upload
  path is then read from that folder; a session gives full paths.
- **Every outcome of `browser token` is decided in one place** (`savePastedToken`,
  `src/browser/token.ts`): saved (0), Ctrl+C (130), a shape that is not the token (1), and a read
  that FAILED (1, with its own reason and the two ways in). The CLI used to map every failure to
  "Nothing was saved (Ctrl+C)" with 130 — a lie about a broken pipe or a terminal that cannot
  hide what is typed, and a script could not tell it from a person pressing Ctrl+C (premium
  review, 2026-10-17).
- **The token is required, and there is no approval mode.** Without a token the extension asks a
  person to approve every connection, in a page, and waits without a deadline; the owner's rule
  is that the plugin never runs that way, so `browser mcp` exits non-zero with one stderr line
  (which Claude Code shows as the server's error) and starts nothing. The token lives in
  `~/.config/cc-smart-dev-kit/playwright-extension.token` (mode 0600; on Windows the profile's
  ACL, `isOwnerOnly`), and goes into the MCP
  child's ENVIRONMENT only: `argv` is world-readable in `/proc`, and `~/.claude.json` holds no
  secret. A wrong token does not fall back to an approval page: the extension answers the connect
  page with *Invalid token provided.*, and the MCP fails after its own 30-second deadline with a
  message naming the profile and the variable. Nothing retries.
- **The token is pasted by the person, and that is deliberate.** It is generated inside the
  extension and kept in its own `localStorage`; Playwright's own tests read it off the status
  page. Reading it out of the profile's LevelDB is unsupported, breaks silently, and is not done
  (README § The browser, owed check 3). The status page's Copy button copies the whole line
  (`PLAYWRIGHT_MCP_EXTENSION_TOKEN=…`), so both the line and the bare token are accepted, and the
  shape (43 URL-safe characters: 32 random bytes, base64, URL-safe) is checked at paste time — a
  half-copied token is refused at once instead of turning into a 30-second wait later. A paste
  arrives with the bracketed-paste markers around it from some terminals (Warp among them), and
  a read that echoes nothing keeps them: they are stripped before the shape is checked
  (`cleanSecretLine`, `src/cli/secret-line.ts` — one home for every secret read), or a token a
  person really pasted is refused as "55 characters" and saved nowhere (live, 2026-10-17).
- **What the person gains, and what it costs.** They watch the work in a real Chrome window and
  can take the page over; there is no browser of ours to keep alive. The costs are upstream and
  neither is planned to change: every connection brings that window to the front and switches its
  active tab (microsoft/playwright#42343), and a second extension in that profile breaks the
  session (microsoft/playwright#43230, open — `doctor` warns by name). There is no headless mode:
  a machine with no desktop cannot use the browser at all.
- **What counts as "another extension" is Chrome's own record** (`otherExtensions`,
  `src/browser/chrome.ts`), never the folders on disk. The folders are wrong in both directions,
  and both were seen live (2026-10-17): Chrome's `Temp` folder sits under
  `<profile>/Extensions/` while an install runs and has no manifest, and `chrome://extensions`
  hides Chrome's own extensions (Web Store Payments is an `kExternalComponent`, `location: 10`,
  with `was_installed_by_default: true`), so the person could find neither of the two names
  `doctor` printed. So: a folder with a manifest (a name is read from it, `__MSG_…__` resolved
  from the extension's own `_locales`, else the id), and a record that is not Chrome's own —
  `location` 5 (`kComponent`) or 10 (`kExternalComponent`), or `was_installed_by_default: true`
  (the values are Chromium's `ManifestLocation`, `extensions/common/mojom/manifest.mojom`, read
  2026-10-17). An entry with no folder is left out too: Chrome keeps the record after an
  extension is gone, and a folder whose name is not an id at all (32 characters, `a`–`p`) is not
  an extension whatever it holds — Chrome's own `Temp` and `scoped_dir…` folders sit under
  `Extensions/` while an install runs (premium review, 2026-10-17).
- **The profile is the person's.** `browser setup` finds Chrome per OS (`chrome.ts`), makes the
  `claude-code` profile by opening the extension's Web Store page in it, and pre-registers the
  extension for that user on macOS and Windows (the per-user External Extensions JSON, the HKCU
  `update_url` key) — the person still clicks **Add to Chrome** and **Enable**. The writes the
  plugin makes inside Chrome's own folder are the profile's display name, in **both** places
  Chrome reads it — `Local State`'s `profile.info_cache.<dir>.name` (the profile menu) and the
  profile's own `Preferences` → `profile.name` (the picker's fallback) — and only while no Chrome
  runs on that user data folder (Chrome rewrites both from memory; when it is running, the page
  says to close Chrome and run `browser setup` again, or to rename the profile in Chrome). Both
  go through `applyManagedJson`, so a backup is made and `restore` puts them back. Writing only
  `Local State` left a profile that looked unnamed in Chrome (live, 2026-10-17). Every other byte
  of Chrome's files is read only, and `restore` never deletes a profile or touches the extension:
  it removes the token file and the pre-registration, and says so.
- **The file-URL switch is checked, never set.** A `file://` page needs the profile's "Allow
  access to file URLs" for the extension AND `--allow-unrestricted-file-access` for the MCP (which
  blocks `file://` navigation by default). Chrome keeps the switch per extension as
  `extensions.settings.<id>.newAllowFileAccess` in the profile's `Preferences`/`Secure
  Preferences` (`extension_prefs.cc`); those files are hash-signed, so `allowsFileUrls` only reads
  them, `doctor` says ✗ with the exact page to open, and `browser check` proves it by loading a
  local page.
- **Where a named file goes.** `@playwright/mcp` resolves a file the CALLER names
  (`filename: "home-dark.png"`) against the folder the MCP process was started in — proved live on
  0.0.83 — so a named screenshot would land beside the project's files. The `playwright-output`
  hook (PreToolUse on `mcp__playwright__.*`) rewrites a relative name into `browserOutputDir`
  first, with `updatedInput`, and REFUSES a relative name with a `..` segment (the launcher's
  `--allow-unrestricted-file-access` means the server itself no longer stops one, and that switch
  is what lets the server take an absolute path from any worktree); an absolute path is left as the
  caller wrote it. The hook answers only while the live `playwright` registration is the one setup
  recorded — a `playwright` of the person's own has its own output folder, and a hook that rewrote
  its files would be the bug.
- **`cc-smart-dev-kit setup`'s part is read-only and host-free** (`browserSetupReport`): it reads
  the profile and the token under the home folder (never Chrome's executable — that is a host
  fact `doctor` and `browser setup` report by name), prints the state and, while a step is open,
  the same guide `browser setup` prints. It never starts Chrome, never asks, never blocks, and
  never reports the browser ready while the token is missing.
- **`doctor` and the portal read the same lines** (`browser/doctor.ts`, `section: "browser"`):
  Chrome found, the `claude-code` profile, the extension in it and its version, any OTHER
  extension, the file-URL switch, and the token file (never its value). The `playwright`
  server's registration and start stay `mcpChecks`' own lines (`mcp/doctor.ts`) — one home for
  that fact. These are file checks — the same ones Playwright
  makes before it connects — so neither ever starts Chrome. The portal draws them on a Browser card
  (the guide as one numbered list, each step's address or command in a `codeBox` of its own with
  a Copy button, a setup button and a masked token field) and leaves them out of the Doctor
  card's list, so no line appears twice on one page.
- **0.3.0's leftovers are reported, never touched** (`browser/legacy.ts`). The upgrade leaves two
  things behind: the old shared profile folder `<dataDir>/playwright` (which may hold sign-ins) and
  the detached Chrome 0.3.0 started on it, whose debug port is unauthenticated on 127.0.0.1. The
  plugin never deletes a person's browser data (owner, 2026-10-16), so `doctor` prints a `!` line
  with the profile's path and the exact command that removes it (`rm -rf` on macOS and Linux,
  PowerShell's `Remove-Item` on Windows, `~` only where a shell takes it), and a `!` line naming
  the old Chrome's pid when it still runs — its child processes carry the same `--user-data-dir`
  and a `--type=` switch, so only the browser process is named. Detection is read only and per
  platform (Linux's `/proc/<pid>/cmdline`, macOS's `ps -ww -axo pid=,command=`, a read-only
  PowerShell `Get-CimInstance Win32_Process`; never `wmic`), it runs only where a trace of 0.3.0's
  browser is there (its folder or its picker file), and a listing that cannot be read is a `·`
  "could not check" — never a claim that nothing runs. `cc-smart-dev-kit setup` prints the same
  facts as information, and never asks a question about them.
- **Nothing in `src/browser/` reads the environment.** The home folder, the platform and every
  file call are arguments (`ChromeDeps`), so a test points them at a temp world
  (`src/testing/chrome-world.ts`) and never touches the real `~/.config`. The Chrome executable and
  the Windows registry are fakes there; the files under the temp home are real, because the managed
  writers read and write the file itself.
- **`browser check` is the live proof**: one real launcher and one real MCP against the person's
  Chrome — a connection with no approval page, a `file://` page, a screenshot the server names and
  one a caller names, an upload, a download, and `browser_close`. Its prerequisites (Chrome,
  profile, extension, token) are checked first, so a missing piece is one clear line instead of a
  30-second wait; what it opens and what stays behind is printed before it starts.

## Lead and the crew

A person talks to one small **lead** session. It plans, and starts each phase of the plan as a
**crew session**: a background session (`claude --bg`) in its own worktree, on its own branch, that
builds, tests, reviews and commits the phase and hands back a report. The lead never waits on a
crew session — the news arrives by itself — and merges the finished branches locally. Background
sessions win over subagents alone (every hand-back lands in the lead's context, and a long phase
rots it) and over agent teams (no worktree isolation, no resume).

This section holds the contracts every part of it builds on — the switch, the kinds, the names
and the store — and the commands that act on them: `crew lead` and the launcher,
`crew start` (§ The lead and the launch, below), the board and the end of a crew session, `crew
list`, `status`, `kinds`, `attach`, `stop`, `resume` and `rm` (§ The board and the end of a
crew session), what a crew session says: its steps, its report, its question, the lead's
answer, the lead's watch, the hand-off, its own time line, and a note to another crew session
(§ The crew session's steps, its report, and the lead's watch, § The crew talks), and the crew
session's and the lead's hooks (§ The crew session's and the lead's hooks).

**The instructions** say when a phase goes to a crew session (`core.md` § Lead the work: a phase with
its own worktree, branch and review, or work longer than about 30 minutes), and two skills hold
the procedures: `lead` (register, split, start, hear the news, route the questions, the merge
gate, caps, hand-offs, restarts) and `crew` (build the phase end to end, the steps, the
report, the questions). Each points at the commands it uses and copies none of their tables:
the kinds come from `crew kinds` (or `crew --help`), the caps from `workflow show`.

**The switch** (D34) is `workflow.crew.enabled`, off by default, in the person's
`workflow.json` (every project's default) and in a project's `.claude/cc-smart-dev-kit.json`,
which wins field by field like every workflow setting (§ The workflow). Beside it in the same
group sit the limits a lead keeps its crew to — how many run on the machine at once, and how
many of those on the opus tier (D37), the free memory a new one needs, when a quiet one is reported, when a long one hands off, when a
blocked one is stopped (D35: a crew session never outlives its work) — and the `tag` of their names.
`workflow show` prints each with its source.

**The kinds** (D46, D50) say what a phase needs, and so the model and effort its crew session runs on:
`CREW_KINDS` in `src/models/launch-policy.ts`, the one home of the launch policy the Agent
guard judges subagents by (§ The Agent guard). Routine work — `build`, `docs`, `tests` — runs on
`sonnet`, the worker slot: at `max` when an affordable gateway slot answers it, at `high` when
Claude Sonnet does (`isAffordable`, the guard's own reading of "affordable"). So does code that
touches security, money, permissions, a schema or deploy plumbing: it builds like any other code.
Work that needs judgment — `architecture` — runs on `opus` at `xhigh`, whatever answers the
tier. `ui` is the exception (`UI_POLICY`, D50): it runs on `opus` at `high`, never on an
affordable model — `crewLaunch` names a tier, so `isAffordable` is false whatever answers it,
and `crew kinds` prints `never` in its affordable-slot column. A `ui` session's override that
would put it on an affordable model or below `high` is refused by the launcher with one plain
line (`uiRefusal`), before the guard is asked. `crewLaunch(kind, gateway, env)` makes that
choice from the same reading of the gateway the guard makes, so a crew session never starts on a
model or an effort the guard would refuse a subagent; a test runs every kind through the guard.

**The names** (D26, `src/crew/names.ts`) show the role, because agent view has no parent link
and no grouping by lead — the name is how a person, and the portal, groups the sessions:

| Session | Name |
|---|---|
| a lead | `LEAD <tag> <plan>` |
| a crew session | `C <tag> <phase> <slug>`, and ` 2`, ` 3` for a hand-off's next crew session |

- **Role and phase first**, so a list that cuts a name still shows them. A tag is at most
  `MAX_TAG` (12) characters and a phase `MAX_PHASE` (8), so `C <tag> <phase>` always fits in the
  first `NAME_VIEW` (24) characters (the width agent view really shows is not proved live yet),
  and the whole name fits in `MAX_SESSION_NAME` (60): the clean title every session's name goes
  through (`cleanSessionName`, which moved here from the session-name hook). What a long name
  loses is the end of its slug or plan, never the hand-off number.
- **ASCII only, no brackets or quotes**, so a name is safe in a title bar, a shell line and a file
  name, and it **never ends in `]`**: the message guard drops the ` [ref]` ListAgents prints after
  a name before it looks the name up (`withoutListRef`, one home), so a name of ours that ended in
  `]` would not match itself there. Every part goes through `namePart`: accents dropped, any other
  character a `-`, no `--`, a letter or a digit at each end. A phase is the crew session's identity, so
  one that is not already clean is refused rather than changed (`isPhase`).
- **The tag** names the repository: the main checkout's folder name, made clean and short, or
  `workflow.crew.tag` (`crewTag`). A folder name that leaves nothing (one of non-Latin
  letters only) is refused with the line to set the tag.
- `roleOf(name)` reads the shape only — `lead`, `crew`, or null for any other name, a ListAgents
  ` [ref]` read past. A person may name a session in that shape by hand, so **the store, never the
  name, is what anything that stops or removes a session goes by.**

**The store** (`src/crew/store.ts`) is what the kit knows of each lead and crew session, per
repository, under the state folder:

```
<stateDir>/crew/<repo key>/crew/<crew id>.json   one record per crew session
<stateDir>/crew/<repo key>/leads/<session id>.json    one record per lead
<stateDir>/crew/<repo key>/reports/<crew id>.json   a crew session's hand-back report
<stateDir>/crew/<repo key>/files/<crew id>/         its brief.md and its settings.json
<stateDir>/crew/<repo key>/events.jsonl               every change, one line each, append-only
<stateDir>/crew/<repo key>/watch/<lead id>.json       where that lead's watch is in the log
<stateDir>/crew/<repo key>/notes/<lead id>.json       where that lead's notes hook is in the log
<stateDir>/crew/<repo key>/stop/<crew id>.json        where that crew session's Stop hook is in the log
<stateDir>/crew/<repo key>/self/<crew id>.json      what that crew session's own watch last said
<stateDir>/crew/lock                                  the machine-wide lock of a start decision
```

- **The key is the review record's** (`repoKey`, a hash of the main checkout's folder), so every
  worktree of a repository shares one store, as it shares one review record. It is the kit's own
  state: folders 0700, files 0600, each record written whole through the kit's atomic write.
- **Every write holds the store's own lock** (`withLock` on the repository's folder, 3 s at most),
  not the state folder's shared one: two leads, or a lead and a crew reporting at once, both
  land. A state change and its `state` event are written under one hold, so the log never misses
  a change; a new crew session is one `created` event, a step, a report or a question one line each.
  Every change of a crew record goes through one read-modify-write (`changeCrew`).
- **A crew record** holds who it is (its id — a plain file name, known before any session
  exists: `<phase>-<slug>-<6 hex>`, so a second try of a phase never meets the first's record —,
  its name, its session's id and short id, its lead), what it does (the repository, the plan, the
  phase and slug, the kind, the model as named with the slot and the model that answer it
  (`answeringSlot`), the effort, the permission mode, the worktree, the branch, the ref it starts
  from, the base and its commit once it starts, the phases it waits for, the files of its brief)
  and where it is: its state, its last line, its report, its pull request, its memory, its
  questions, what it waits for while `paused` (`waitingFor`: a gateway slot whose breaker is
  open, Claude's own plan limit, or `unknown` when the router's state explains nothing; with the
  pause before it, `lastPause`: when it began and the hold-off a re-pause doubles —
  § Waiting out a limit), when its session started (`startedAt`, optional: the crew session's own time caps count
  from it, not from when it was recorded), the crew session it continues (`continues`, optional: the id
  of the old crew session, set by a hand-off and by nothing else), whether the lead had merged its
  work before its removal (`mergedBeforeRemoval`, optional: set by the store when the state becomes
  `removed`, from the state the record was in — the fact a phase that waits for it starts on), and when it was recorded and
  changed. The states are `queued`, `starting`,
  `working`, `blocked`, `paused`, `quiet`, `done`, `failed`, `stopped`, `handoff`, `merged` and
  `removed` (`CREW_STATES`, each one's meaning in the file). **A lead record** holds its session
  id, name, repository, plan, the tag its crew sessions' names carry, and folder, and may hold
  `pausedAgents`: the ids of its own subagents that stopped on an API error and wait to be woken.
  Both new fields are optional (`waitingFor` and `pausedAgents`), and a record an older kit wrote
  reads as it was.
- **A crew session's questions** (D36): a crew session never asks the person. A question to its lead — the
  question, two or more options, the one it recommends (counted from 1), when it was asked — goes
  at the end of its `questions` with a `question` event (`addCrewQuestion`), and the crew session goes
  on with what the question does not block; the lead's answer is recorded once, with its time
  (`answerCrewQuestion`). A recommendation that is not one of the options, or an answer without
  its time, is refused.
- **The hand-back report** is what a crew session gives the lead when its phase ends: its status (`done`,
  `blocked`, `failed`, `handoff`), the phase, the branch and base commits, the pull request, the
  diff counted, the files it changed outside its brief, the targeted tests and the whole suite,
  the other checks, the one review (agent, model, effort, the commit it read, each finding and its
  fix), the docs it changed, what only the lead may do, what is still open — and, when blocked,
  the question it waits on (a blocked report without one is refused).
- **The events log is read from an offset**, whole lines only: a line a writer has not finished
  is left for the next read, a line that cannot be read is counted and skipped, and a log shorter
  than the offset (replaced) is read from its start.
- **Older and newer kits share the store.** A daemon's spare process, or a session started before
  an update, runs older code. Every record, event and report carries the schema `version` it was
  written with; a reader keeps every field it does not know and reads a state, kind, event type
  or report status it does not know as itself; an update by an older kit keeps what a newer one
  wrote, and the newer version number. A record that lacks a field this kit needs is broken: a
  single read throws, naming the file and the field, and a list names it under `broken` and
  goes on.

### The lead and the launch

**`crew lead [--plan <slug>] [--tag <tag>]`** (`src/crew/lead.ts`) records the session
that runs it as a lead of this repository. **Which session** is found the way L1a.1 proved it:
the nearest ancestor process with a Claude Code session record, `<config folder>/sessions/<pid>.json`
(`callingSession`, `src/crew/session.ts`; parents from `/proc` on Linux, one process listing
elsewhere). Its name, `LEAD <tag> <plan>`, is written into the lead record as data: the
session-name hook applies it later, and the command prints the `/rename` line meanwhile. The tag is
`--tag`, else `workflow.crew.tag`, else the main checkout's folder name; the plan is `--plan`,
else the plan this session already leads, else the branch.

**`crew start <phase> --slug <slug> --kind <kind> --brief <file|-> …`** (`src/crew/start.ts`)
**returns at once** (D25) with one line — `started …`, `queued …` or `failed …` — and never waits,
polls or retries. In order:

1. **The refusals** (exit 1, a line and its `Fix:`), shared with `crew lead` (`caller.ts`): the
   caller is a crew session (`CC_SMART_DEV_KIT_CREW` set); the folder is not in a git project, or its
   kit config does not read; crew sessions are off here (D34, resolved as `workflow show` resolves it);
   no Claude Code session runs the command; that session is in bypass mode — its command line
   (`--dangerously-skip-permissions`, `--permission-mode bypassPermissions`) where the machine
   shows it, else `permissions.defaultMode` in the checkout's `settings.local.json`, its
   `settings.json`, then the person's (`bypass.ts`): a lead there would act on every crew session's
   message with no question. Then: no lead recorded for this session here (`crew lead` first);
   a brief that cannot be read, or is empty; no `claude` (PATH, then `~/.local/bin`); a base that
   is no commit. A wrong command line is exit 2: no phase, slug or kind, an unknown kind, an effort
   a crew session never runs at, a phase that waits for itself.
2. **The model and effort**: the kind's (`crewLaunch`, D46). An override (`--model`, `--effort`;
   a model alone runs at the kind's effort, or `max` when an affordable model answers it) is
   judged by the Agent guard's own `judgeLaunch`: one it refuses is refused with its words, and
   one it would **ask** the person about (`opus` at `max`, an unreadable name) is refused too,
   because `crew start` never asks — the person starts such a session themselves. Fable is
   refused: no crew session carries the person's `Fable reason: build` line.
3. **Start now, or queued** (`places.ts`), decided under one machine-wide lock
   (`<stateDir>/crew/lock`) so two starts never both take the last place, and recorded
   (`starting` or `queued`) under the same hold. First the name must be free: no crew session of this
   repository holds the branch (`holdsName`: every record but a `removed` one, and a `failed` one
   that never got a session and left no worktree), and neither the branch nor the folder exists. Then, in order: **its phases** (`--waits-for`) — each phase's newest crew session here must be
   `merged`, or `removed` after that merge (`mergedBeforeRemoval`, kept by the store): a
   `removed` crew session whose work the lead never merged releases nothing, because `crew rm`
   removes a queued or failed phase too, and a dependent that started from it would build on
   work that is not on the lead's branch; **a crew session that finished its phase (`done`) is not enough**, because
   the lead has not merged it yet, and a dependent phase that branched before the merge would
   miss the work it waits for; **the two caps** (D37)
   — the crew of every repository on this machine in `starting`, `working`, `blocked`,
   `paused` or `quiet` stay below `workflow.crew.max` (6), and, for a new opus-tier crew session, the
   opus-tier ones among them stay below `workflow.crew.maxOpus` (2): the tier the model's name
   stands for, recorded at launch (`model.tier`), so the opus kinds (`architecture`, `ui`) and an
   override onto opus both count; the queued line names the cap that holds it; **the memory** — the memory free now less what heavy
   jobs reserved and have not used yet (the job queue's own reading) is at least
   `workflow.crew.memoryGb` (no check where free memory cannot be read: macOS). The store alone
   decides, so a start never waits on agent view; the watch keeps the states true. A start that
   finds a free place takes it, also while older crew sessions wait: each lead's watch starts its own
   queued ones. A queued crew session has no worktree yet and its `base` is null: it is cut from its
   `baseRef` when it starts, so a phase that waited for another starts from the merged result.
4. **Its files** (`files/<id>/`): `brief.md` — the brief as given, then a fixed frame (`brief.ts`):
   who it is and for whom, its worktree and branch, the files it owns, the git rule (D24: commit on
   its branch, never push, never open a pull request, never merge), how it hands back
   (`crew report --status done|failed`), and D36's rule: never ask the person or call
   AskUserQuestion; a question goes to the lead with `crew report --question … --option …
   --recommend <n>`, the crew session goes on with what it does not block, and `--status blocked` only
   when nothing is left — and `settings.json`, `{"env":{"CC_SMART_DEV_KIT_CREW":"<id>",
   "CLAUDE_CODE_RETRY_WATCHDOG":"1","CLAUDE_CODE_RETRY_WATCHDOG_USAGE_LIMIT_RECHECK_MS":"300000"}}`:
   the two watchdog keys are CC1's (`src/setup/retry-watchdog.ts`), and there is **no wait
   limit** on purpose (D42: keep waiting), so no `…_MAX_WAIT_MS` and no
   `…_MAX_USAGE_LIMIT_WAIT_MS`. A crew session is unattended, which is what the watchdog is for.
5. **The launch**, for a crew session that starts: `git worktree add -b crew/<phase>-<slug>
   .claude/worktrees/crew-<phase>-<slug> <base commit>` in the main checkout (fast; anything slow,
   a dependency install, is the crew session's own first step), the `.worktreeinclude` files copied
   (`src/worktrees/include.ts`, as Claude Code does for its own worktrees), then from the main
   checkout `claude --bg -w crew-<phase>-<slug> --name "C <tag> <phase> <slug>" --model <m> --effort
   <e> --permission-mode auto --autocompact auto --settings <settings.json> "<first line>"`. The
   first line names the crew session, its lead and the brief's path; it holds no `"` or `%`, which a
   `.cmd`'s `cmd.exe` line could not carry. `--autocompact auto`: the kit knows no model's window
   (`gateway.json` holds none for a backend), so Claude Code's own stands. The settings are a
   **file** on every platform. On Windows a `claude.cmd` runs through `cmd /d /s /v:off /c` with
   one quoted line (`windowsRun`, the hooks' own quoting); a `claude.exe` runs as it is.
6. **The session id, and never the folder**: the short id is read from `backgrounded · <id> ·
   <name>` (`--session-id` is ignored with `--bg`), then `claude agents --json --all` is read once
   for the session's id. The crew session is recorded with it and `startedAt`, and stays
   **`starting`**; a row that is missing, or a list that does not read, is failed with no retry.
   **Its `cwd` is not judged there**: agent view reports the launch folder until a `--bg -w`
   session has entered its worktree (proved live on 2.1.308, `docs/claude-code-contract.md`), so the one
   immediate read raced the move and failed and stopped every crew session of the first live use
   (H101). **The session judges its own folder** at its `SessionStart` (`crew-role`): its input's
   `cwd` against the record's worktree. Inside it, the role card, and a `starting` record becomes
   `working` (one state event, "started in its worktree"). Outside it, an open record is `failed`
   with where it started (a phase that already ended keeps its state: `merged` is what a
   dependent phase waits for), and the card tells it to do nothing and end its turn — so the
   lead's watch stops the session (D35). **The hook does not stop it itself**: a SessionStart
   answer's `{"continue": false}` is not acted on in 2.1.308 (`docs/claude-code-contract.md`).
   A `starting` crew session whose session died before its `SessionStart`
   is the watch's own store-truth rule: agent view says `failed` or `stopped`, and the record says
   so too. When nothing started — `claude` refused (`Workspace not trusted`: open the repo once
   with `claude` and accept the trust prompt), or `claude --bg` failed — the worktree and its
   branch are taken back (the branch only while it still points at its base), so a second try
   finds the name free. When a session may have started — no `backgrounded` line, or no answer in
   time — the worktree stays.

### The board and the end of a crew session

`crew list`, `status`, `kinds` and `attach` read; `stop`, `resume` and `rm` act (`board.ts`,
`end.ts`, `remove.ts`; their help is one table, `usage.ts`, which the help table's rows
(`src/cli/help.ts`) and `crew --help` read too). All of them look a crew session up **in this
repository's store only**, by its name (also the ` [ref]` form ListAgents prints), its id, its
session's short id or its session id. A name that matches two crew sessions is refused and both are
named, so the store, never a guess, decides which session is meant (D35). A crew session's own
session (`CC_SMART_DEV_KIT_CREW` set) never runs `stop`, `rm` or `resume`.

- **`list`** shows the repository's crew sessions (`--all`: every repository), newest first, one block
  each. The state's age is the newest `state` or `created` event about the crew session, not
  `updatedAt`: the watch writes a line or a memory reading every few seconds, and that changes
  the record without changing what the crew session does. Its last step or line is its newest event
  with a line, else `lastLine`. **The files its brief gives it** (`--files`) are one line of the
  block when it names any, so the board is the ownership map too: two crew sessions that list one
  file collide. A queued crew session says what holds it, recomputed from the store the
  way `crew start` decides (`placeFor`: the phases it waits for, then the cap of all crew sessions,
  the opus cap, the memory), or that a place is free and only its lead's watch is left to start
  it. `--json` prints the records as stored. A record that cannot be read is named on stderr and
  the rest still prints.
- **`stop`** runs `claude stop <short id>`: the conversation stays on disk. A crew session that was
  running becomes `stopped`; one that ended with an outcome (`done`, `failed`, `handoff`,
  `merged`) keeps it, because a phase that waits for it (`--waits-for`) reads only a merge,
  and stopping its process changes nothing about that. A stop Claude Code refuses for a session
  that agent view does not list counts as stopped (the goal is met); one it refuses for a listed
  session is an error and changes nothing.
- **`resume`** runs `claude respawn <short id>` for that one session — never `--all`, which
  restarts every background session on the machine — and the crew session is `working` again. It is
  refused for a crew session that is `removed` or `merged`, or has no session yet. It does not check
  the caps: the person or the lead asked for exactly this session.
- **`rm`** ends a finished crew session, and refuses at the first step that would lose something. A
  crew session commits on its branch and never pushes (D24), so **only the lead's branch decides**
  whether its work is kept: `workOnRef` (`src/worktrees/scan.ts`, the one answer `crew rm` and
  the lead's watch share) asks it of the crew session's branch against the commit checked out in the
  lead's own folder (its lead record's `cwd`; the ref the crew session was cut from when that folder is
  gone). The work is there when the branch is an ancestor (a merge commit, a fast-forward), or
  when merging it into that commit changes nothing (`git merge-tree --write-tree`, the replay
  `worktrees --clean` uses: it sees a squash merge). A conflict, an error or a git older than 2.38
  is not certain, and the crew session is kept. Then: uncommitted work in the worktree refuses it (before any
  side effect), and so does a lock a person took on it (`git worktree lock`; Claude Code's own
  lock — its reason starts `claude session` — is released, and **locked again with the same
  reason if a later step refuses**, because the lock is what keeps `worktrees --clean` and the
  background clean off the worktree); the session is stopped; the kit's
  own finished-worktree verdict (`src/worktrees/scan.ts`, the one `worktrees --clean` uses) judges
  the worktree **against the lead's branch rather than `origin/<base>`** (`ScanOptions.against`)
  and removes it, then its branch by the same rule (`deleteBranchOnRef`); and only then
  `claude rm <short id>`, which refuses a worktree that is still there (proved live, L1a.1). A
  `claude rm` that fails leaves the crew session `stopped` with a `step` event saying what is left, and
  a second `crew rm` goes straight to it. Nothing is ever forced: `claude rm` has two force
  flags (`--discard-unpushed`, `--force-remove-worktree`), and neither is used.
  A squash-merged crew branch is removed like any other; a squash that missed a later commit
  of the crew session is refused, with the count. **A queued crew session is removed at once**,
  and so is one whose launch left nothing behind: the removal records whether the lead had merged
  first (`mergedBeforeRemoval`), so the phases that wait for it start on that fact alone.

### The crew session's steps, its report, and the lead's watch

The lead never waits on a crew session (D25). Everything a crew session says arrives by itself: **the
events log** for what the crew session did, **the watch** for what the lead reads, and **the answer**
for what the lead says back.

**A step** — `cc-smart-dev-kit crew step <step> [--note <text>]` (`src/crew/step.ts`) — is
one milestone of a crew session's phase: a failing test, a passing one, the whole suite, the review
that starts and ends, the fixes, the commit, the pull request, the hand-off
(`CREW_STEPS`, one list). **Only a crew records steps**: the crew session is the one
`CC_SMART_DEV_KIT_CREW` names (its Bash tool carries it, L1a.1), and a session that names none
is refused. The command reads HEAD's sha itself, so the crew session never has to name its own commit,
and appends **one** event (`type: "step"`, the step's name, the sha, the note, the time). A step
the crew session does not know is refused, with the list of the ones it does.

**The hand-back report** — `cc-smart-dev-kit crew report --status done|blocked|failed|handoff
[--file <file|->]` (`src/crew/report.ts`) — is what the crew session gives its lead. **The command
fills the mechanical facts**, so the crew session never looks them up: the branch and its head, the
base it started from, the diff counted against that base (`git diff --numstat -z --no-renames`,
`diff.ts`), the files it changed that its brief did not name (the brief's `--files` globs; a brief
that names none names no boundary), the review the record holds for its branch, and its pull
request. A diff git cannot give — the base is gone, the folder is no worktree — is a refusal,
never "no file changed". The crew session gives the rest, and the command checks it against the store's
report shape before it writes anything: the targeted tests and the whole suite, the other
checks, the review's findings, the docs, what only the lead may do, and what is still open. The
file holds that part as JSON, or as prose, which is kept as the report's `summary`; with no file
the part is empty and the facts are still filled. A report that claims a review **the review
record does not hold** is refused — so the lead's gate (D22) never has to doubt it. The report
ends the crew session's phase: its state becomes the status, and the report file, the record and the
`report` event are written under one hold. **Only a `blocked` report carries a question** — the
one it waits on, or else the newest the crew session asked that nobody answered; a `done` report with
an old open question in it would tell the lead the crew session is blocked.

**A question** — `crew report --question "<the question>" --option "<choice>" --option
"<choice>" [--recommend <n>]` — goes to the lead (D36). It is recorded at the end of the
crew session's `questions`, with a `question` event, and **the crew session's state does not move**: it goes
on with every part of the phase the question does not block. `--status blocked` says the crew session
has nothing left to do. A question needs two options at least, and a recommendation that is one
of them; `--option` and `--recommend` without a `--question`, and a `--file` with one, are
mistakes (exit 2).

**The answer** — `cc-smart-dev-kit crew answer <crew session> "<the answer>"` (`src/crew/answer.ts`)
— comes back from the lead (an answer that starts with `--` is given after a bare `--`). A
**running** crew session gets it as a message: the CLI cannot send one itself (Claude Code's
`SendMessage` is a tool only a session holds), so the command prints the one line the lead sends
it with — `SendMessage {"to":"<name>","message":"<text>"}`, the tool's arguments as JSON, so a
quote or a line break in the answer is escaped and never changed — and records the answer, so the
question is answered once. A **stopped** crew session (D35: the watch stops a blocked crew session that
idles past `workflow.crew.idleStopMinutes`) is resumed with the answer as its next prompt:
`claude --bg --resume <session id> "<text>"`, the form `claude --help` gives in 2.1.306 ("With
--resume <session-id>, continues that session in the background under the same ID"), run in the
crew session's own worktree. **A crew session the answer reaches or resumes is `working` again, in the same
hold that records the answer**: a record that kept saying `blocked` would let the watch stop a
crew session that is busy. A stopped crew session that ended its phase (a `done`, `failed` or `handoff`
report) is not resumed by an answer, and a crew session the store does not know is never answered: the
store, not the name, says what is a crew session.

**The watch** — `cc-smart-dev-kit crew watch [--lead <session>] [--once] [--timeout
<seconds>]` (`src/crew/watch.ts`) — is the lead's window. It prints **one line per change and
nothing else**, from two readers:

- **the store's events log** (`events.jsonl`), read from the byte after the last whole line the
  last pass read (the store's own reader, `readCrewEvents`; a line a writer has not finished is
  left for the next read). A step, a report, a question and a state change are each one line, and
  **a change of state is said from its event and from nowhere else**: the watch's own acts write
  events too, and the pass reads the log a second time at its end, so a change it makes is said
  once, in the same pass. A report's line names the review the record holds, the phases that wait
  for this one and the report's file: `C kit B6b portal-live: done · review ✓ · unblocks B6c, B6d
  · report <path>`; a `blocked` one says what it waits on, a `failed` one why. Where the watch
  goes on is **per lead** (`<store>/watch/<lead session id>.json`), so two leads watch their own
  crew sessions and neither loses the other's lines; the mark is written when the lead records itself
  (`crew lead`), so the lines before it are history the lead already saw.
- **agent view** (`claude agents --json --all`), read on every pass. It raises four alerts, each
  said once while it lasts and none of them an action: a crew session that **needs the person** (a
  permission prompt or an input), one whose transcript has not moved for
  `workflow.crew.quietMinutes` (**quiet**), one whose turn **ended with no report**, and one that
  **never confirmed its worktree** — its session is listed and alive, but its own start hook has
  not turned the `starting` record `working` within `WORKTREE_CONFIRM_MS` (3 minutes: the hook
  may have crashed, been silenced by `ownHooks`, or run outside git). It
  also keeps the store true, because the caps count the crew that hold a place
  (`RUNNING_STATES`): a session that **failed** is recorded `failed`, and one the person
  **stopped by hand** is recorded `stopped`; neither then holds a place and keeps a queued crew session
  waiting for ever. A permission wait does **not** make a crew session `blocked`: the idle stop below
  would kill a crew session that only waits for the person to approve a call.

The watch **acts** as well, because a crew session never outlives its work (D35), and only on crew sessions
the store records — a session the kit does not know is the person's own:

- it **starts the queued crew sessions** of this lead when a place frees — through the launcher's own
  path (`startQueued`, in `start.ts`: the same `launch` that `crew start` runs, never a second
  launcher). A queued crew session is cut from its `baseRef` when it starts, so a phase that waited for
  another starts from the merged result, and the folder `claude -w` opens is the record's own
  worktree, so a hand-off's numbered folder is the right one. A queued crew session held by a
  phase that was **removed before its work was merged** never starts by itself, and the watch
  says so **once**, with the way to drop the wait (`crew rm` the queued crew session, then start
  its phase again): the work it waits for is not on the lead's branch, so pretending it is
  merged would build the next phase on nothing;
- it **resumes the paused crew sessions** of this lead once the gateway answers again (D42): one
  first (the canary), the others `RESUME_SPACING_MS` (30 s) apart and only after the router
  answered a request since, and never while a slot's breaker is open or a Claude limit is
  current (§ Waiting out a limit);
- it **ends** a crew session whose turn ended with a `done` or a `failed` report (`claude stop <id>`;
  the conversation stays; a session that crashed has nothing to stop), and a `blocked` one that
  has idled past `workflow.crew.idleStopMinutes` (an answer brings it back). A `done` record
  becomes `stopped`; a `failed` one **stays `failed`** (the board must show why it ended), and its
  one line says so. A stop that fails is said once, not on every pass;
- it **marks a crew session `merged`** when the lead merged its branch, and the line says `crew rm`
  removes it. The branch must hold a commit of its own (its tip is not the base it was cut from —
  a crew session that failed before it committed is an ancestor of the lead's branch for that reason
  alone), and its work must be on the commit **the lead's own folder** is on (the lead's record
  holds it; the main checkout when that is gone): `workOnRef`, the answer `crew rm` gives too —
  its tip is an ancestor, or merging it changes nothing, which is how a squash merge shows. When
  git cannot say, it is not marked. The merge is looked for on every
  crew session whose work is over (`done`, `failed`, `handoff`, `stopped`): a crew session stopped after its
  turn ended is merged later, when the lead merges the branch.

The watch's memory reading (`/proc/<pid>/status`'s `VmRSS` on Linux, nothing elsewhere) goes into
the crew session's record without moving its `updatedAt` (the idle stop counts from it), where `crew
list` and the portal read it, and into the event the watch writes when it ends the crew session.
It is **Linux only**, and it is never faked: on macOS and Windows the board and `crew status`
show `-` (`docs/windows-setup.md` § The short version).

`--once` ends on the next change: the fallback where monitors do not run (the lead runs it with
`run_in_background: true`, re-armed per event, and the end of the run starts the lead's next
turn); a pass with nothing to say waits for the next, so it never wakes the lead with no news.
`--timeout <seconds>` bounds the wait.

#### Waiting out a limit

A model limit ends a turn the retry watchdog did not outlast — the plan's usage limit, an
overloaded model, a server error. The kit waits it out, with no time limit (D42: the owner chose
"keep waiting"; no `limitWaitHours`, no `…_MAX_WAIT_MS`), in three parts (`src/crew/wait.ts`):

- **Each crew session's own settings turn the watchdog on** (the keys CC1 writes for a machine,
  `src/setup/retry-watchdog.ts`), so most limits are waited out inside the turn.
- **The pause** (`crew-role`, StopFailure): a stop with `rate_limit`, `overloaded` or
  `server_error` marks the record `paused` and takes `waitingFor` from the router's limit state,
  in this order: `slot` — the slot the crew session's model reaches has a current breaker record,
  with the time it opened; `claude-limit` — a current plan limit, the session's own model first,
  else the freshest of a model whose family has a slot, with its reset time; `unknown` —
  nothing the state file explains. One `state` event carries the line the watch shows
  (`C kit B6b portal-live: paused — worker slot limited since 21:05; goes on by itself when it
  answers`), and `lastPause` records when the wait began and the hold-off it carries: 0 on a
  first pause, then 5, 10 and 20 minutes while pauses come within 15 minutes of each other.
  A crew session that ended its phase, was stopped, or still waits in the queue pauses nothing.
- **The resume** (the lead's watch): never while the slot's breaker is open (its first target in
  use is not one the record says rests) or the model's limit is current. A slot wait is over when
  the breaker record closed (the router recorded an answer — only an answer closes it) or the
  chain's first target changed; a Claude limit's when the reset time passed, plus
  `LIMIT_RESET_JITTER_MS` (90 s), and the router dropped the record; an `unknown` wait's after
  its hold-off, with no breaker or limit that would explain it now. One crew session goes first
  (the canary); the next no sooner than 30 s after it, and only once the router answered a
  request since — its health page's count grew, and the state file's closed breaker or dropped
  limit is that answer when the page is not there. The transport is `crew answer`'s: a message
  for a session whose process lives (the watch prints the `SendMessage` line, because only a
  session holds that tool), `claude --bg --resume <id> "<text>"` for one whose session has no
  process; the text names what changed and the phase. The record is `working` with its wait
  cleared, in the same act. `crew resume --paused` is the person's way at once — after `/login`
  on another account — for every paused crew session of a lead.

**The hand-off** — `crew start <phase> --continue <old crew session>` — starts the next crew session of a
phase that ran out of room: the same phase and slug, cut from the **old crew session's head** (not
the lead's branch), with the old brief and what the old crew session left behind as its brief — its
report: the branch and the counts, the docs, the files outside the brief, what only the lead may
do, what is open, and its own words (`summary`) — and the next number in its name (`C <tag>
<phase> <slug> 2`, and ` 3` after that). Its branch and its worktree folder carry the same number
as a suffix (`crew/<phase>-<slug>-2`), so the next crew session never takes the branch or the folder of
the one before it; its id keeps the one scheme (`<phase>-<slug>-<6 hex>`). It is a new launch, so
it goes through the same launch policy a fresh start does (`chooseLaunch`): the old crew session's model
and effort are asked for again, and the Agent guard judges them now. **The old crew session's Claude session
is stopped; its record stays `handoff`** — the store's word for "handed off to a next crew session, and
ended" — and so do its branch and its worktree, so the lead can read what it did and `crew rm`
can clean it up. Only a crew session that handed off can be continued, **once**: a second `--continue`
of the same crew session is refused while its next crew session is not failed or removed, and a report that
cannot be read is a refusal (a hand-off without it would lose what the next crew session must know).
**The chain is recorded, never worked out**: the next crew session's record holds the old crew session's id
(`continues`), because a number at the end of a branch or a slug proves nothing — a phase whose
slug is `step-2` has a branch that ends in `-2` too.

**The crew session's own line** — `cc-smart-dev-kit crew self-watch [--once]`
(`src/crew/self-watch.ts`) — runs in the crew session's own monitor, and **keeps running**: it looks
every minute and prints a line only when the crew session should act, so a crew session that is fine sees
nothing. It reads the crew session's own transcript tail: the last reply's `usage` (its input, its cache
written and its cache read) against the window of the model that wrote that reply
(`transcript.ts`). **The kit knows no backend's window**: a Claude model — an id, or the family
name a crew session is launched with — has Claude Code's own 200 000 tokens, or 1 000 000 with the
`[1m]` suffix (a family name that really has a larger window makes the crew session hand off early,
never late), and a model the kit does not know has no window and so no context line. At
`workflow.crew.handoffPercent` (70 %) the crew session is told to **hand off**: commit the work in
progress and run `crew report --status handoff`. At `workflow.crew.softHours` (2) it gets a
**note** (the phase is long); at `workflow.crew.maxHours` (4) it is told to hand off again —
the hours count from when its session **started** (`startedAt` in the record), not from when it
was recorded, because a crew session that waited in the queue has not run for the hours it waited. The
same line is not said again before 15 minutes have passed, so a crew session that ignored it sees it
again and a crew session that acted does not; the loop ends when the crew session's phase is over. A monitor
is a process of the host, whose environment may not carry the settings' `env`, so this one command
finds its crew session by its worktree when `CC_SMART_DEV_KIT_CREW` is not set; `--once` checks once
and exits (for a hook, and for a host where monitors do not run).

**The monitors** (`plugin/monitors/monitors.json`) arm the two of them: `crew-events` on the
lead's skill (`on-skill-invoke:cc-smart-dev-kit:lead`) runs the watch, and `crew-self` on the
crew session's (`on-skill-invoke:cc-smart-dev-kit:crew`) runs the self-watch. The file is an array of
monitors with exactly the four fields Claude Code's loader reads (`name`, `command`,
`description`, `when`); `when` for a plugin's own skill is the namespaced
`on-skill-invoke:<plugin>:<skill>` (the loader compares it with the name the skill is invoked by,
`<plugin>:<skill>`). Each stdout line reaches the model as a task notification — **at most ten at
once and then one every two seconds**; the host drops the rest with a notice — which is why the
watch says only what is news. **They are session-scoped**: the host arms them as persistent tasks
of the session, and they end with it, so the long-lived-parts rule of `bundles-and-releases.md` (a
part that outlives a session must run from a copy in `~/.local/share/`) does not apply to them.
**They do not run where telemetry is off** (`DISABLE_TELEMETRY`, or
`CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC`), and there the lead uses `crew watch --once` in the
background instead — the fallback the lead skill names. On native Windows each command is a
`$HOME` shell line naming the launcher, so it needs Git Bash; that Claude Code starts a monitor
through Git Bash there is the one live check owed (`docs/windows-setup.md` § The owner's
checklist, step 5). The watch knows which case it is in (the
environment and the user's settings' `env`, `telemetry.ts`) and says so once, so the lead knows to
re-arm it; the watch's own help names the fallback too. **`claude plugin validate` does not read
this file** (it checks a monitors path or an inline list in the manifest, not the default
location), so `monitors.test.ts` is what keeps it to the loader's shape; one wrong key would stop
the whole plugin from loading.

### The crew talks

**Hub and spoke** (D47, `.claude/research/archive/2026-10-22-crew-design.md` § 3). Status flows
through the lead: a crew session tells it what it did and what it needs with `crew report`, and
the lead answers with `crew answer`; both are recorded in the store, so the watch's line wakes
the lead and a restart loses nothing. Two crew sessions talk **directly only when one's contract
touches the other's**, and then in one of two kinds and no other.

**`crew tell <name…> --kind contract|question "<text>"`** (`src/crew/tell.ts`) is the one way.
Each `<name>` must be **a live crew session of the same lead in the store** — the name or id the
board shows, its record in a `RUNNING_STATES` state with a session id. A name the store does not
know, the lead itself, a crew session of another lead, one that is not running, and the sender's
own name are each refused with one line, and **nothing is recorded or printed: all or none**. A
third kind is a usage mistake (exit 2). So the store, never a name, decides who a crew session may
tell, as it decides everything else about a crew session.

- **The words are one home** (`src/crew/tell-format.ts`): `crew tell` writes them and the
  message guard checks them, so the two can never disagree about what a tagged message is.
- **The first line is the tag and the point**, because it is the preview the receiver sees (and
  the summary a `SendMessage` line carries): `[<phase>] CONTRACT: <what changed: file:symbol,
  commit>` — a contract note ends with `No reply needed.` — or `[<phase>] QUESTION: <the ask>`.
  The phase is the sender's own. The facts live in the files and commits; the note points at them,
  and one note carries the related facts together.
- **The command records a `tell` event** — the kind, from, to, and the first line — so the lead's
  watch shows it as one line (`<name>: told <names> · <kind> · <first line>`), and then prints
  **one `SendMessage` line per receiver**, the JSON form `crew answer` prints: only a session holds
  the tool, so the crew session sends it.
- **Never status.** "How it goes" and "done" are the lead's, through `crew report`: the crew
  skill says so, and the guard below refuses the alternative.

**The message guard** (`src/hooks/message-guard.ts`, PreToolUse on `SendMessage`) is the
enforcement. Its other-repo rule is unchanged and runs first (§ The hooks): a message to a session
that works outside this repo is denied. Then, when the sender is a crew session (its environment
names a crew id, `CREW_ENV`) whose record this repo's store holds, and the target is the name of
**another crew session of the same repo**, the message's first line must carry the tag
`[<its phase>] CONTRACT:` or `[<its phase>] QUESTION:`; an untagged one is **denied**, and the
refusal names `crew tell`, its two kinds, and `crew report --status done` for a hand-back. A
message to the session's **own lead** is denied too, with the `crew report` route — the lead is
matched by name, as `crew tell` matches it (`src/crew/tell.ts`), because the lead hears its crew
through the recorded report and never a raw message. A message **from the lead**, and one to a
session the store does not record (a person's own session, a subagent, a session on another
machine), is not judged. That crew rule is the guard's **crew part** (`crewMessageAnswer`): the
frame runs it **before `ownHooks` and before the project's file**, so it holds in a project with
no `cc-smart-dev-kit.json` and in one whose `ownHooks` names `message-guard` (D24, D47; the same
for the crew parts of `git-guard` and `merge-guard`, § The hooks). A store the guard cannot read
says nothing about the two sessions, so the message goes through, as every check a guard cannot
make does.

**The lead's loop** (the procedure is the `lead` skill, which copies no table). At plan approval
the lead **starts the whole plan at once**, each later phase with `--waits-for` the phases it
builds on: the queue and the watch start each phase when what it waits for is merged and a place
is free, so the lead never keeps a list of what is ready. On each watch line it acts in that
turn — a hand-back is checked and merged (the watch starts the dependants), a technical question
is answered with `crew answer`, the person's question goes to `AskUserQuestion`, "needs you" is
`claude attach <name>` — and between lines it does the integration work that is its own and stays
free for the person. **It never polls, waits or sleeps**, and a turn that ends with a ready phase
not started is a fault (an eval case, `evals/cases/lead-starts-the-whole-plan`).

### The crew session's and the lead's hooks

Two hooks make the store and the sessions meet. Both are **machine-wide** (`MACHINE_WIDE_HOOKS`):
each is silent unless its own session is the one it is about, and neither reads
`.claude/cc-smart-dev-kit.json` for its answer.

- **`crew-role`** (`src/hooks/crew-role.ts`) is silent unless `CC_SMART_DEV_KIT_CREW` names a crew
  session in its environment (the settings file `crew start` launches the session with, L1a.1). At
  **SessionStart** (startup, resume, compact) it adds the **role card**: the name
  (`C <tag> <phase> <slug>`), the phase and plan, the files the phase owns, the brief's path, the
  report line, the `crew tell` line, and the git rule (commit on its branch, never push). A
  resumed or compacted crew session gets it again, because its first prompt is gone from its
  context. **The input's `cwd` is checked against the record's worktree** (H101): inside it, a
  `starting` record becomes `working`; outside it, an open record is `failed` with where it
  started (the lead's watch stops the session) and the card tells it to do nothing and end its
  turn.
  At **PreToolUse** on `AskUserQuestion` and `ExitPlanMode` it **denies** the call with the
  `crew report --question …` step (D36): a crew session never asks the person. The deny reads no
  store and no project file, so it is the same with no `cc-smart-dev-kit.json`, a broken or too new
  one, and outside git. At **Stop** it records the session's last line on its record (`lastLine`,
  masked and clipped) and **gives no context** — a Stop hook's `additionalContext` keeps the turn
  going and starves hand-backs (L1a.1). When the newest `step` or `report` event of the crew
  session is a `step`, the turn ended mid-phase with no report: it **blocks once** with the report
  line as its reason (`{"decision":"block","reason":…}`), and never again while `stop_hook_active`
  is true. The events log is read from a **per-crew cursor** (`<store>/stop/<crew id>.json`: the
  byte after the last line it read, and the newest `step` or `report` it saw), through the store's
  one `readCrewEvents`, so a Stop costs the same on day 30 as on day 1: the log only grows.
  Claude Code shows each block as a `stop-hook-error` notification and caps consecutive
  blocks at 9; this hook blocks at most once per turn. Nothing runs while `background_tasks` is not
  empty: that turn is not over, and Claude Code wakes the session when the work lands. At
  **StopFailure** on `rate_limit`, `overloaded` or `server_error` it marks the crew session
  **paused**, with what it waits for taken from the router's state file (D42, § Waiting out a
  limit), and answers nothing: Claude Code ignores that hook's output, so the pause is the
  record and its event, and the lead's watch is what resumes it. A store that
  cannot be read is one line on stderr and no block.
- **`lead-notes`** (`src/hooks/lead-notes.ts`) is silent unless the input's `session_id` is a lead
  recorded in this repository. Each turn a lead starts — `UserPromptSubmit` (which also fires on a
  hand-back turn, L1a.1) and SessionStart — it reads the events log from a per-lead cursor
  (`<store>/notes/<lead id>.json`, seeded at the log's end the first time), keeps this lead's
  events, and adds **one line**: the newest news, rendered by the watch's own `eventLine`, plus
  `(and N more…)` when there is older news in the same turn. The cursor moves past every event
  read, whether or not a line came of it, so a restart never says the same thing twice. The review
  mark on a report line uses the built-in review agents: this hook reads no project file, and the
  watch's own line is the one that resolves a project's list.

## Sessions and worktrees

Two commands that read what Claude Code and git already keep, and change only what a person
asked for (`src/sessions/`, `src/worktrees/`):

- **`cc-smart-dev-kit sessions`** reads Claude Code's own session files
  (`<config folder>/projects/<project folder>/*.jsonl`): the name is the last `agent-name` or
  `ai-title` entry, the folder and worktree come from the last `cwd`, `relocated` or
  `worktree-state` entry, and a session that ended cleanly ends with `cost-state`. Nothing is
  tracked on the side, so a crash cannot leave half a record — except `--open`'s own marker:
  one small file per session it just opened (a few minutes, in the state folder), because a
  resumed session takes a moment to write to its file and a quick second run would otherwise
  open a second copy. `--open` reopens what was open
  when the machine last went down or a window closed; the whole rule, and why one session
  alone cannot be told from `/exit`, is in the file's header. Which terminal does the opening
  is picked from the machine (Warp wins where it is; XFCE Terminal is Linux's fallback), and
  a session already running is never opened twice.
- **`cc-smart-dev-kit worktrees`** judges every worktree of the repo against
  `origin/<base>`: the verdict is a pure function of the facts (`verdict.ts`), so every reason
  to keep a worktree is one testable rule, and the facts themselves (git's list, the running
  sessions, Docker's mounts, the programs using it) come from `machine-facts.ts` and
  `scan.ts` — reading each process's parent too, so the command that asked about a worktree,
  and the shells that started it, are not taken for programs using it. Whether the work is on
  the base is asked four ways: every commit by ancestry, every commit under another sha
  (`git cherry`), a merge of the branch into the base that changes nothing
  (`git merge-tree --write-tree`, which is what sees a squash merge), and a merged pull
  request that merged this very head. `--clean` and `--remove`
  hold a port as a lock (`ports.ts`), move a worktree
  aside before deleting it, and delete a branch only when the base holds its work.
  The plugin's own leftovers hook uses the same verdict; the dev-server probe the project
  this came from had (one project's `.dev-server.json` and ports) is **not** ported — the
  general rule is a program running from the worktree, or working in it.

### The flow report

`cc-smart-dev-kit report` answers what a week of sessions cost in a person's time, from the
transcripts Claude Code already writes. One reader, `src/sessions/flow.ts`, for the command
(`src/cli/report.ts`) and later for the portal; it counts, and prints counts, times, tool names
and hook names — never a word of a message, the same rule as `usage`.

- **What it reads.** The same files as `usage`: `<config folder>/projects/<project folder>/<session
  id>.jsonl`, and each subagent's own transcript beside it. A session includes its subagents: a
  nested launch is a launch in the session. The fields are undocumented, so their contract rows
  are marked "seen, may change" (`docs/claude-code-contract.md`); a missing or renamed field
  skips that record into "records skipped" instead of guessing.
- **The measures.** Agent launches per reply (`message.id` groups a reply's lines; `Agent` and
  `Task` are launches), the replies with two or more, and the parallel share; "most at once" is
  the overlap of the subagent transcripts' first and last timestamps. A permission prompt is a
  tool result whose `permissionDecision.source` starts with `user`; its wait is the result's time
  minus the tool call's line — an **upper bound**, and the report says so. The asker is the hook
  whose PreToolUse `hook_success` attachment carries the same `toolUseID` and an `ask` answer,
  named from the script in its `command`; with none, Claude Code's own prompt. `AskUserQuestion`
  and `ExitPlanMode` are questions, counted apart. A turn's `turn_duration` plus the next user
  line's `turnOrigin` gives the idle time until the person wrote and the waits on background work
  (grouped by what woke them). Compactions come from `compact_boundary` with its trigger and
  tokens; auto-mode blocks are a `reject` from `config`, labelled by the bracketed rule in the
  result (the label only) or by its `reasonType`; a merge that asked is a `gh pr merge` Bash call
  whose result came after a person's answer.
- **The ask log.** When the hook frame's `guard-asks.jsonl` exists (`{at, hook, kind,
  tool_use_id, session_id}`), it is preferred to the attachment for the asker and the reason kind.
  It is written before the tool's result, so the run that counts a prompt already has it. Without
  it the attachments answer, and the merge's reason is "not recorded".
- **The cache.** `<stateDir>/flow/<project folder>.json`, mode 0600, written atomically: per
  transcript, its inode, size and mtime, the byte offset after the last whole line, the open state
  (pending calls, the last reply, the last turn end), and hourly buckets for eight days. A grown
  file is read from its offset; one that shrank or was replaced starts its session's counts again.
  The cache is derived data — last writer wins, no lock, and a failed write never fails the report.
  Its version changes when the buckets' meaning does.
- **The limits.** The window is at most eight days, because that is what the buckets keep. A
  prompt's wait is an upper bound and includes the person's own reading time. "Waiting on you now"
  lists calls asked and unanswered in the last 24 hours; an older one belongs to a session that is
  gone. A measure the version never wrote — no `turn_duration`, no `permissionDecision`, no hook
  ask — prints "not recorded by this version", never a zero.

## MCP servers at user scope

`setup` registers MCP servers at user scope, through Claude Code's own
`claude mcp add-json --scope user` (`src/mcp/`). The plugin does not serve them: a server
served from a plugin gets a new tool-name prefix, which would break every permission rule,
hook matcher and agent tool list that names `mcp__<server>__*`; and a server from a project
file or the "local" scope is stopped by Claude Code as soon as the session's folder changes,
which every session that works in a worktree does. Registered for the user, the names stay.

- **Three servers** (`SERVER_NAMES`): `playwright` (the browser above), `sequential-thinking`,
  and `tavily-websearch`. Each version is pinned in `src/mcp/versions.ts`; the file's header
  says why, and how to move one. A project's own servers stay in that project.
- **A retired server** (`RETIRED_SERVER_NAMES`; today `serena`, dropped in 0.6.0 — one server
  per session at about 3 GB each in a large project, for tools sessions seldom called) is taken
  back by the next setup, in `src/mcp/retired.ts`, the one home of that cleanup:
  `planRetiredServers` plans a `remove` only while the record says setup registered it AND
  Claude Code still holds exactly that JSON — the rule a Tavily server without a key follows —
  so `applyMcpServers` runs `claude mcp remove`. A record marked `pending` (an older setup's pin
  update stopped after its `add-json`, so the record holds the old JSON and Claude Code the
  newer) counts too when the live config has setup's own shape — `uvx`, `--from` Serena's
  repository, `--context` setup's own context file — as `planMcpServers`' pending branch
  reasons with the JSON it would write (`setupMadeIt`, which `doctor` asks too). Any other
  `serena` stays (its record, if any, is forgotten), and the lines say only what is known:
  setup has no record of registering it as it is. Then, in setup's locked pass, `planSerenaCleanup` and
  `applySerenaCleanup` remove what 0.5.x left beside it: the context file
  (`<dataDir>/serena/contexts/worktree.yml`, a whole file setup owned) through
  `removeManagedFile` (a backup first) and `forgetChange`, its folder only when nothing else is
  in it, and the `serena-root` records (`<stateDir>/serena-root/`). The context file stays while
  any MCP registration in Claude Code's own config — the user scope but the ones this run took
  back, and every folder's local scope — still names it, or when that config does not read:
  a Serena of the person's own may start with it. Only the servers are read there, never the
  rest of the file (a prompt may quote the path). The dry pass counts the planned removals;
  the real pass counts only those that succeeded (`McpApplyResult.removed`), so a failed
  `claude mcp remove` keeps the file its registration names. `doctor` asks the same
  functions (`retiredChecks`): one ✗ line while setup owes any of it, none after, and a `·`
  line for a `serena` that is not setup's. `mcp status` lists only `SERVER_NAMES`, so the
  installer never offers to replace a retired name. `restore` needs nothing new: it takes back
  a recorded registration and a tracked file the way it takes back any other.
- **The settings' own `env` counts as a key** (`readTavilyKey`): `TAVILY_API_KEY` in the process
  environment, then the `env` of the settings files (the map Claude Code expands an MCP server's
  `${VAR}` from — `userSettings`/`flagSettings`/`policySettings` `.env`, read in the installed
  2.1.302), then the key file setup owns. A key that lives only in the settings is a key Claude
  Code really uses, so setup registers the server instead of reporting no key — while the
  installer, which already read the settings, had stopped asking for one (premium review,
  2026-10-17). `TAVILY_API_KEY` in the settings is *kept* then (`tavilyKeyPlan: keep`): it is not
  the person's environment shadowing a stale copy, so nothing is written or removed.
- **The Tavily key is never written into a registration or printed.** The header carries
  `Bearer ${TAVILY_API_KEY}`, which Claude Code fills in at connect time; the key itself comes
  from the environment or from a 0600 key file, which setup copies into the `env` of the
  settings as an owned **secret** key (masked in output, a hash in `owned.json`, the file left
  at mode 600 — the machinery `src/setup/managed-json.ts` already had for claude-mem's key).
  A key file others can read is refused with the command that fixes it, never with the key in
  it — off Windows: there a mode says nothing and the profile's ACL protects the file, so no key
  file is refused (`isOwnerOnly`). Without a key the server is skipped with a note — and a
  recorded Tavily server of ours is taken back, and the owned `env` key removed (only while it
  still holds what setup wrote), so a key that moved to the environment (or went away) does not
  leave a stale copy behind.
- **What setup registered is recorded** (`<stateDir>/mcp-servers.json`: the name, the exact
  JSON, when, and whether an update is in flight), so `restore` removes exactly that: each
  server that still holds what setup wrote (`claude mcp remove <name> --scope user`), then the
  record and the Tavily `env` key (and, for a machine setup reached before 0.6.0, Serena's
  context file, a tracked whole file like any other). A server the person re-pointed — or
  removed — is theirs and stays: the record is forgotten, and a later restore does not try it
  again (a `·` line says the exact command that adds it back). A server of the person's own
  under one of these names is never taken over; setup says how to hand it back.
- **An update is marked while it runs.** A pin move is `claude mcp remove` then `add-json`:
  the record is marked `pending` before the remove and cleared only after the add succeeds, so
  a server that is registered no more WHILE the mark is set is setup's own half-finished work
  and is registered again — never mistaken for a server the person took away. Reading "not
  registered" out of a config that did not read is impossible: when
  `<config dir>/.claude.json` cannot be read, setup and restore touch nothing at all and keep
  every record, with one line saying `cannot read <file>: nothing changed`.
- **`doctor` checks each one**: registered at user scope (read from Claude Code's own config,
  never written by hand), and it starts (`claude mcp get`, which starts it once), with the
  scope checked too — a project `.mcp.json` or a local copy wins over the user's, and a
  session that moves into a worktree would lose it. No Tavily key is a `·` line, never a
  failure. A server registered at user scope by **something else** under one of these names is
  a `!` line naming what runs instead — that is why the plugin's browser is not the one
  starting — with the command that hands the name back.
- **`cc-smart-dev-kit mcp status [--json]`** (`src/mcp/status.ts`) is the read-only answer to
  "which of these are the plugin's?": the same rule as setup's own (`sameConfig` against the
  record — one home), a line each, and `--json` for a script. Exit 1 means Claude Code's own
  config could not be read, so "nothing is foreign" and "could not check" are never confused.
  **Every name in `SERVER_NAMES` is reported, Tavily included with no key** (premium review,
  2026-10-17: it used to be left out then, so a `tavily-websearch` a project's script had registered was never
  offered for replacement on a machine whose key arrived later in the installer's step 7), and a
  record file that cannot be read gives `unknown` — never `foreign`, or the installer would
  offer to replace a server that is probably the plugin's own.
  The line shows the server's **command and arguments** (or a remote server's URL) and never an
  `env` or a `headers`. A key can also sit in a URL's query, fragment or userinfo, or in an
  argument (`npx mcp-remote <url>` with a key in the query, `--api-key X`, `--token=X`): a URL
  goes through `redactUrl` (its one home: query, fragment and userinfo all hidden) and such an
  argument's value becomes `•••`, and the command is shown by its own name (`basename`).
- **A same-name server one scope down wins over the plugin's** (`overridingServer`): the local
  scope (Claude Code's own file, `projects[<cwd>].mcpServers`) or a project's `.mcp.json` at the
  folder doctor runs in (or a parent, up to the one holding `.git`) takes precedence over the
  user-scope registration, so `doctor` warns with what runs instead — the same
  `describeServerConfig` line, never a key (premium review, 2026-10-17).
  **The installer asks with it** (live, 2026-10-17: all four names were registered by a
  project's own script, setup's `!` line was lost among the installer's output, and the plugin's
  browser never took over): per foreign server, "Replace it with cc-smart-dev-kit's?"; a yes
  removes it (`claude mcp remove <name> --scope user`) and runs `setup` again, so the plugin
  registers its own **with its record** — the record is what lets `restore` take it back later —
  and a no lists the exact command under "What is left".


## Auto mode reads only user settings

Claude Code's auto mode reads `autoMode` from the user's settings (and managed settings,
and `--settings`), never from a project's `.claude/settings.json`: a repo could otherwise
grant itself trust (proved live: `claude-code-contract.md`). So `setup`, run in a
project, copies that project's `autoMode` rules from its `cc-smart-dev-kit.json` into
`autoMode.environment` in the user's `settings.json`. The project owns the wording; the
plugin only copies it.

- **Owned entries, not an owned list.** The list is shared with the person and other
  tools, so cc-smart-dev-kit owns single entries (`src/setup/managed-entries.ts`), each recorded
  with its source: the project's main checkout, one source for all its worktrees. A
  setup in a project makes that project's owned entries exactly its `autoMode`: new ones
  are added at the end, dropped ones taken out. An entry two projects want stays until
  the last one drops it. An entry already in the list that cc-smart-dev-kit did not add is left
  alone and never owned.
- **`"$defaults"` first.** A list without `"$defaults"` replaces Claude Code's built-in
  entries instead of adding to them (seen live). When setup creates the list, it puts
  `"$defaults"` first and owns it; it goes only with the list, when nothing but it is
  left. A restore with entries of the person's left keeps it, and no longer claims it.
- **Trust rules are asked, always of a person at a terminal.** A change is shown as `+` /
  `-` lines, then asked; `--yes` skips the question, not the lines, and only on a
  terminal. With no terminal the entries are left out, whatever the flags, and setup
  says so — a `--dry-run` with no terminal prints that same note, beside the entries it
  would otherwise write, so it never promises what such a run will not do
  (`autoModeAsking` in `src/cli/setup.ts`, the one place the terminal is decided). A
  change of the same entries again is no change: nothing is shown or asked.
- **The question names the file.** In a worktree with its own `cc-smart-dev-kit.json`, that file
  is where the entries come from; when it says something else than the main checkout's,
  the question says so plainly.
- **Only one part of setup.** A project setup cannot read (an invalid or too-new
  `cc-smart-dev-kit.json`, git older than 2.31, a worktree whose main checkout is gone) leaves
  the entries out with a note; the launcher, the auto-update key and the companions still
  happen. Outside git, setup needs no git.
- **Every question first.** The auto-mode question and Warp's commands are asked before
  anything runs or is written. A "no" drops only what depends on it.

## Companion plugins

cc-smart-dev-kit depends on claude-mem and frontend-design (`plugin.json` `dependencies`, with
`allowCrossMarketplaceDependenciesOn` in `marketplace.json`). A dependency is the
plugin system's own way to bring another plugin along: Claude Code installs it, keeps it
in its version range, and does not load cc-smart-dev-kit without it. The plugin's code reads the
list from `plugin.json` at build time (`DEPENDENCIES`), and `src/machine/companions.ts`
knows where each marketplace comes from.

Claude Code installs a dependency only from a marketplace the person added, and installs
the missing ones when that marketplace is added (both seen live). So `setup` adds a
missing marketplace with `claude plugin marketplace add`, which brings the companion;
with the marketplace there and the plugin gone, it runs `claude plugin install`. It never
turns on a companion the person turned off, and never updates one: it says what to run.
These are Claude Code's own commands on its own files, so `restore` does not undo them.

## Claude Code's retry watchdog, offered for the person's own sessions (D42)

Claude Code's `CLAUDE_CODE_RETRY_WATCHDOG=1` makes a session wait and retry, instead of failing,
when a model is limited or down. Proved on 2.1.306: Claude Code reads it from a settings file's
`env`, it retries past 11 requests, and `CLAUDE_CODE_RETRY_WATCHDOG_USAGE_LIMIT_RECHECK_MS` makes
it check whether a usage limit was lifted early. It is the only way the lead's own subagents
survive a limit in process, so `setup` offers it; it never takes it.

- **One home**: `src/setup/retry-watchdog.ts` holds the two env names, their values
  (`RETRY_WATCHDOG_VALUE`, `RETRY_WATCHDOG_RECHECK_MS` = 300000), the two flags, the "no" file, the
  question, the state `doctor` reads and its lines. `src/cli/setup.ts` holds only the ask and the
  write.
- **Waits with no limit** (the owner's choice, D42): no `…_MAX_WAIT_MS` and no
  `…_MAX_USAGE_LIMIT_WAIT_MS` is written, so a session keeps waiting until a model answers.
- **Asked once, default no.** The question comes with setup's other questions, on a terminal only,
  and says the trade-offs: every session waits ("Retrying in …"; Esc cancels), a `claude -p`
  script can hang, the lead's subagents survive a limit only this way. A "no" is remembered in
  `<stateDir>/retry-watchdog-declined`, the way the status line's "no" is. It is not asked when a
  flag decided, when either key is already in the settings' `env`, or after a "no". With no
  terminal nothing is asked or changed, and `--dry-run` names what a real run does.
- **Two owned keys** under `env`, through `applyManagedJson` (backup, atomic write, lock,
  ownership). `--retry-watchdog` writes them without the question; `--no-retry-watchdog` removes
  the ones that are ours and remembers a "no". A value the person set is theirs: a different one
  stops setup in the read-only pass (`ForeignKeyError`); the same one is named and left alone.
  `restore` removes ours like any owned key, and the `env` object with them when setup made it.
- **`doctor`** has one `·` line (`retryWatchdogState`): on (ours), on (the person's own), off with
  the command that turns it on, or off because the person's own value leaves it off. It is
  information, never a failure.

## claude-mem: the two start blocks, off (D23)

claude-mem puts two blocks at the start of every session: work state (a to-do list, with the
instruction to use its `work_state_write` tool) and the memory-use block (how to use the
memories it loaded). Measured over 14 days, together they pass Claude Code's 10,000-character
hook output limit in 36 of 218 starts. The owner decided both go off on every machine (D23).

- **Two keys in `~/.claude-mem/settings.json`**: `CLAUDE_MEM_WORK_STATE_ENABLED` (13.36.0 and
  later; `false` also makes its work_state tools answer "Work state is turned off") and
  `CLAUDE_MEM_MEMORY_INSTRUCTIONS_ENABLED` (13.35.0 and later), both `"false"`
  (`START_BLOCK_KEYS`).
- **Planned on their own.** `claudeMemPlan` (`src/machine/claude-mem.ts`) builds them whenever
  claude-mem is installed, separate from the gateway's provider keys: no affordable scout
  changes nothing about them, and a backend check that fails drops only the provider keys. An
  older claude-mem gets them too: its `loadFromFile` overlays only the defaults it knows, so
  an unknown key changes nothing. `plugin.json` asks for 13.36.0, so both exist on every
  machine that installs claude-mem.
- **Owned like the provider keys**, through `applyManagedJson`: claude-mem's own default
  (`"true"` or `""`) counts as unchosen; any other value is the person's, and setup names it
  in a `!` line. A value setup wrote and the person changed since is theirs too — also
  `"true"`, which is the README's way back on, so setup never undoes it. `restore` removes
  both keys, and claude-mem falls back to its defaults.
- **A session's to-do home.** While work state is off, setup sets
  `env.CLAUDE_CODE_ENABLE_TODO_TOOLS: "1"` in the user settings (`src/cli/setup.ts`, through
  `applyManagedJson`). Live proof on Claude Code 2.1.306: the task tools (`TaskCreate`, …) are
  absent in `claude -p` and foreground sessions on newer models, and present in background
  ones; `1` turns them on everywhere. A value the person set is theirs: it stays, named in an
  information line. `doctor` checks it while work state is off.
- **Said before the write.** When the plan changes work state, setup prints one `!` line: the
  lists stop showing, `work_state_read` reads one while the switch is still on, and
  `CLAUDE_MEM_WORK_STATE_ENABLED` set to `"true"` turns it back on. After a write it prints the
  restart step: a new session's start hook reads the settings, and claude-mem's worker reads
  them when it starts.
- **An old nested file** (only `env`, which claude-mem rewrites flat on its next start) waits
  as a whole, the two start blocks included: a key written under `env` would lose its owned
  path in the rewrite.
- `doctor` shows both values and who set each (cc-smart-dev-kit's setup, the person, or
  claude-mem's default); a value the person set is information, never a failure.

## claude-mem on the gateway

claude-mem's summaries run on Claude Haiku, on the person's own login, by default. Its work
is Haiku's, so it follows the gateway's slot for Haiku, the scout: when the person gave the
scout a chain whose first target is a `<backend>:<model>`, `setup` points claude-mem's
openai-compatible provider straight at that backend and model (`src/machine/claude-mem.ts`).
A scout with no chain (a fresh `gateway setup` writes none) or one that starts with a Claude
model leaves claude-mem on Claude; the worker's chain is never used for it.

**No model of the plugin's own** (owner, 2026-10-17): setup writes no quota fallback.
claude-mem's `CLAUDE_MEM_QUOTA_FALLBACK_PROVIDER` / `…_MODEL` keep claude-mem's defaults or
the person's values. The fixed Claude Haiku id that 0.4.3 and earlier wrote there is taken out
again while it still holds cc-smart-dev-kit's value (`RETIRED_KEYS`), and a value the person
set or changed stays. A removal alone sends no check to the backend.

- Five more keys in claude-mem's settings, owned through `applyManagedJson`. claude-mem's
  seeded defaults count as unchosen; any other value of the five is the person's
  choice (also one cc-smart-dev-kit wrote and the person changed since, and a key pool of their
  own in `CLAUDE_MEM_OPENAI_COMPAT_API_KEYS`), and then none of them change.
- **Straight to the backend, not through the router.** claude-mem speaks OpenAI's format
  and the router speaks Anthropic's. The key is the backend's key from `gateway.json`.
- **Checked before the write, the way claude-mem calls it:** claude-mem's custom preset
  adds `/chat/completions` to its base URL (its worker, 13.35.0), so setup sends one
  `POST <backend>/v1/chat/completions` for the model with the key and `max_tokens: 1`;
  it must answer, or nothing is written. `--dry-run` sends nothing.
- **An old nested file** (only `env` at the top, holding claude-mem's keys) is left
  alone: claude-mem itself rewrites such a file flat on its next start, and drops any
  flat key written beside `env` then (its `loadFromFile`), so a key written either way
  now would be lost or no longer owned.
- **No affordable scout target any more** while the keys are still cc-smart-dev-kit's: setup
  says that claude-mem still points at the old backend, and how to fix it.
- **No chroma workaround.** An older pin of claude-mem's vector search (`pydantic<2.12`
  through a wrapped `uvx`) is not needed: claude-mem 13.35.0 ships its own pin
  (`pydantic<2.14`, its CHANGELOG, #4595), and the kit needs 13.36.0 or newer, so no
  warning is needed below it.

## Warp

The Warp terminal is opt-in (`setup --warp`): plain `setup` never installs a system app,
and never Warp's plugin either. `src/machine/warp.ts` asks the system's own package
manager (apt, dnf, Homebrew) whether Warp is there, builds the exact install or remove
commands, and `setup` shows them and asks. They need root, so:

- they run only on a terminal, after the person said yes; `sudo` asks for the password
  itself, and cc-smart-dev-kit never sees, stores or pipes it. With no terminal, or a "no", the
  Warp part is left out (its plugin too) and the rest of setup goes on; setup exits 1;
- the key and the source file are made by cc-smart-dev-kit in its own state folder, then put in
  place by `sudo install` (apt) or imported from there with `rpm --import` (dnf). No
  downloaded script ever runs;
- **the key is pinned.** It is downloaded over HTTPS, every redirect checked, and must
  hold exactly one key with the fingerprint `0913165C78D5B7A41B42AC657FF7AB39D60F803F`
  (`gpg --show-keys`, with a fresh gpg home in the state folder). That fingerprint came
  from the key at Warp's documented address, and the same key is built into Warp's own
  package (below). Another key stops the Warp part before any command runs;
- `--remove-warp` on dnf removes only the `gpg-pubkey` whose id (version) is the end of
  that fingerprint, never a key picked by its name;
- a command that fails half way lists what ran before it and names
  `cc-smart-dev-kit setup --remove-warp` to undo it.

**What Warp's .deb writes** (read from the control member of `warp-terminal`
0.2026.10.07.08.29.stable.00, the amd64 package and the arm64 one, fetched from Warp's apt
repository and unpacked, never installed). Its postinst:

- writes Warp's key, built into the script, to `<apt trustedparts>/warpdotdev.gpg`
  (`/etc/apt/trusted.gpg.d/warpdotdev.gpg` with apt's defaults) on every install and
  upgrade;
- writes the source `<apt sourceparts>/warpdotdev.sources` (deb822, with a two-line
  "automatically configured" header, `Architectures:` — `amd64` in the amd64 package,
  `arm64` in the arm64 one: each package writes the architecture it is for — and
  `Signed-By: /etc/apt/trusted.gpg.d/warpdotdev.gpg`), but only when neither that file
  nor `warpdotdev.list` exists;
- its postrm, on purge, removes the key and both source files.

So cc-smart-dev-kit writes the same key path, and the source with the same path and the very
same text — this machine's architecture in the `Architectures:` line — before the first
install; the package then finds its source there and leaves it. apt never sees two Warp
sources or two Signed-By values. A source already there (the package's, or a `.list`
from Warp's manual guide) is kept as it is.

Warp's apt repository has `amd64` and `arm64` packages (its `Packages` files, read
2026-10-16), and its rpm repository `x86_64` and `aarch64` builds (its repodata, read
2026-10-15), so a Debian-family or Fedora-family machine is installed for on either
x86_64 or arm64; other architectures get the download link.

Warp's Claude plugin is not a dependency (a machine may have no Warp). Only `--warp`
adds it; `doctor` names `cc-smart-dev-kit setup --warp` when the app is there without it.
`--remove-warp` removes it with the app.

## Neutral by design

The plugin carries only general behaviour. Every project value — a branch, a folder
prefix, a command, a rule's wording — is a `cc-smart-dev-kit.json` field or a file in the project's
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
