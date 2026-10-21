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

## The installer

`install.sh` (macOS and Linux) and `install.ps1` (native Windows) are **the one command**
that takes a machine from nothing to a working plugin: the marketplaces, the plugin install,
`migrate` and then `setup`, the three secrets only a person has, and `doctor` at the end.
Each step prints one line and is skipped when it is already done, so a second run only fixes
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
and fakes for `claude`, `bun`, `git`, `gh`, `curl` and `uname` on PATH — the fake `doctor`
fails while the browser's token is missing, the way the real one does, which is what the
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
- Auto mode's safety check is judged by Claude unless the person gives the judge slot a
  chain; then its first tested target judges every check (the next only with the judge's
  fallback on). A target must pass a test check before it is set; the router uses only a
  target whose test proof is in the config.
- Every Claude model reaches the slot of its family (haiku → scout, sonnet → worker, opus,
  fable), read from the id Claude Code sends. A slot with no chain is off: that model stays
  byte for byte on Anthropic. A chain is the person's, any targets in any order, and each
  slot's fallback switch decides whether its next target may answer; the router never adds
  a target, Claude included. A backend's thinking stays, marked as the router's with its
  own signature inside: removed on a request to Claude, which refuses a signature it did not
  issue, and given back its own signature on a request to a backend (D6); the router
  writes the plan limits it saw to a small state file that the status line and the
  StopFailure alert read. The alert's worker runs through the launcher, never from the
  plugin's version folder.
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

## Web search

`cc-smart-dev-kit search` (`src/search/`) searches the web, or reads one page's text, through the
same local OmniRoute the gateway uses — same config file, same `omniroute` backend, same
key (`docs/search.md`):

- The command reads the key through the gateway's own config reader, never a copy of it,
  and never prints it: an OmniRoute error answer, or a failed request's reason, is
  masked with the router's own `maskSecrets` before it reaches the terminal. To an
  OmniRoute on this machine the key never goes through a proxy (`directIfLoopback`, the
  rule the gateway's own backend calls use; it needs Bun ≥ 1.4.3, § The Bun it needs).
- Web text is data, not terminal input: every field is printed through
  `src/gateway/plain-text.ts`, the one home (shared with the router's log) that turns
  each control character into a space.
- The plain output is cut (about 2500 characters, 300 a snippet), because Ollama's web
  search puts a whole page in each result's snippet; `--json` prints the whole answer.
- The query, and a `--fetch` URL, go to a third party (the search or fetch provider), so
  `--fetch` refuses a local or private address.
- It is a command, not a service: no part of it runs in the background, and nothing
  changes on a machine until a person runs it.

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
- **The launch** puts a job in its own systemd memory group with a kill mark where Linux
  allows it, so that if memory still runs out, a heavy job dies first.
- **The state is per user** (`~/.local/share/cc-smart-dev-kit/jobs/`): nothing in it outlives
  its writers, and no service runs.
- A pure classifier (`classifyHeavyCommand`) says which kind a Bash command runs; a later
  hook routes heavy commands through `job run`.

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
  writes the launcher, so such a key (for example `autoUpdate: false`) stops it before
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
- **It refuses inside a Claude Code session** (`CLAUDECODE`), in the command and again in the
  bundle the child runs: the portal changes this machine's model path and the safety judge,
  and a session must never do that for itself.

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
   another `127.0.0.1` port is the SAME site — a cookie has no port — so its `<img src>` carried
   the session cookie past `SameSite=Strict` and was served. A request with no `Sec-Fetch-Site`
   at all is not from a browser that sends it (every current one does); the other rules judge
   it. The stylesheet and the scripts are behind this rule too.
3. **A session, or the one-time token**: `GET /?t=<token>` with the token made at start
   exchanges it for the cookie; every other request needs the cookie.
4. **A POST carries the CSRF token** that came with a page of ours (`x-ccsdk-csrf`), compared
   in constant time. The cookie alone never changes anything.

The cookie is `HttpOnly; SameSite=Strict; Path=/` and **not** `Secure` (this is http on
`127.0.0.1`, and a `Secure` cookie would never be stored). **Its name carries the portal's own
port**: `ccsdk_portal_<port>` (`cookieName`). A cookie has no port, and a browser sends every
`127.0.0.1` cookie to every port on `127.0.0.1`, so without the port the second portal would
overwrite the first one's session (and its own), and neither page could hold one while the
other ran.

The token works once. A GET that passes the `Host` and `Origin` checks but holds **no valid
session** — a link already used, or a cookie from a portal that stopped — gets the page that
says so (`expiredPage`) with **403**, and that page holds no fact about the machine: no
version, no port, no token. Running `cc-smart-dev-kit portal` again is what it offers. A
`Host` or `Origin` refusal, and every refused POST, stay the plain one word, `Forbidden`: that
request is not the person's browser. (A portal that has **stopped** is a connection error, not
a 403: nothing listens on the port any more.) `history.replaceState` cleans the token out of
the URL on the first load, so it does not sit in the address bar or in the back button.

Every answer carries a strict `Content-Security-Policy`: `default-src 'none'`, `script-src
'self'` with no `unsafe-inline`, `style-src 'self'`, `connect-src 'self'`, `form-action
'self'`, `frame-ancestors 'none'`, `img-src 'self' data:`. So no script may be inline, every
handler is `data-*` and an `addEventListener`, no markup carries a `style` attribute (the one
number that must be a value — a meter's width — travels as `data-percent` and the browser
script applies it; `[hidden] { display: none !important }` keeps that working where a class
says `display: flex`), and nothing comes from the internet: no web font, no CDN, a local font
stack. The stylesheet and the two scripts are served by the portal itself and need no session
(a page cannot draw without them); everything else does.

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

**It stops after 30 minutes with no request** (`session.ts`): the link and the cookie are
dead, and the process exits. A portal left open on an unlocked screen is a way into every
Claude session on the machine, so it does not stay open by itself.

**A page's own reload is not a request of the person's.** The Health page asks for itself
every five seconds with `?auto=1`; the server serves the page and does **not** touch the idle
clock for it, so an open Health tab cannot hold the portal (and its door) open for ever. The
page's script also stops reloading while the tab is hidden (`document.hidden`,
`visibilitychange`) and looks once more when it comes back.

**The log is newest first, on both pages** (the owner, 2026-10-17: a log read top down the way
`journalctl` prints it puts the line a person opens the page for at the bottom). `routerLog`
(`facts.ts`) keeps the journal's own order — oldest first, which the caller of a page shares —
and the pages reverse it in ONE place: `newestFirst` (`views.ts`), used by the Health page's Log
(newest 120) and by the Overview's "Latest warnings" (the newest three that are not INFO). The
times are the journal's own, unchanged. The page is a full reload, never a live insertion, so
there is nothing else to keep in order.

### What it runs from

A copy in `~/.local/share/cc-smart-dev-kit/portal.js`, never the plugin's version folder:
Claude Code deletes an old version folder some time after an update, even under a running
process. `cc-smart-dev-kit portal` writes the copy through `writeManagedFile` (so `restore`
removes it) and starts it as a **child with this terminal's own stdio** — the link is printed
where the person is looking, and Ctrl+C reaches both through the same process group (the
child exits **130** on Ctrl+C, the code for "ended by SIGINT", and the parent returns it). It
is a bundle of its own (`src/entries/portal.ts` → `plugin/dist/portal.js`), so nothing about
it changes `router.js` (a changed router bundle restarts every machine's router).

**The copy sits outside the plugin, so it is told where the plugin is.** The parent passes its
own folder (`--plugin-dir`, and `portal --plugin-dir` is refused as an unknown option: a
person must not point the portal at another folder, which would let it install that folder's
router bundle). Each file the portal needs — the router bundle a restart installs
(`dist/router.js`), the instructions, `hooks/hooks.json` — is then resolved from the version
Claude Code records as installed **at the moment it is needed** (`resolvePluginFolder`,
`src/portal/plugin-folder.ts`), falling back to `--plugin-dir` while that still exists. Two
reasons, both found live: a path made from the copy's own folder resolves
`~/.local/plugin`, where none of those files are (the restart threw ENOENT, and the Machine
page's doctor skipped its router-copy check without saying so); and a 30-minute run can
outlive the version folder it started in, so a path made at startup goes stale. With neither
folder there, the action says so in words and stops — the doctor pass reports it as one failed
check — rather than reading a path that is gone.

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

Claude Code's own plugin auto-update (`autoUpdate: true`, which `setup` turns on) did not
run on a machine where it was on: 15 minutes after a session started, not even the
marketplace copy was refreshed (anthropics/claude-code#61854). The same two commands by
hand worked at once. So the plugin updates itself (the owner's decision, 2026-10-15):

- **The SessionStart hook** (`src/entries/update-check.ts`, logic in
  `src/update/background.ts`) records which version the session loaded, and starts the
  check in a **detached** process (its own session, no pipe to the hook) when one is due:
  at most once an hour per config folder, and not while updates are held. It needs no
  network and no lock, and returns at once (about 60 ms on a loaded machine, most of it
  bun's own start). It prints nothing, unless the last background check failed and no
  session was told yet: then one `systemMessage`, to an attended session only (Claude
  Code sets `CLAUDE_CODE_SESSION_ATTENDED=0` for the hooks of `claude -p`; such a session
  neither shows it nor counts as told). It runs bun through `plugin/bin/cc-smart-dev-kit-bun.sh`,
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

Three fields came with 0.4.0: `worktrees.bases` (a branch-name prefix to the base a worktree
of such a branch starts from, § Worktrees), `worktrees.engine` (`"plugin"` or `"own"`: who
makes this project's worktrees) and `workflow` (§ The workflow). All three are optional and
nothing else about the file changed, so a project that writes one raises its `requires` to
the release that brought it — which is what `project init` writes. `worktrees.engine` is
deprecated since 0.5.2, with `worktrees.prefix` and `worktrees.setup`: every project uses
Claude Code's own worktrees now (§ Worktrees), the engine retires in the next minor version,
and the three fields stay accepted (no parse failure) until then.

- A hook finds the project from its input's `cwd`, which follows the session into a
  worktree. A worktree's own `cc-smart-dev-kit.json` wins; else the main checkout's is used. A moved
  or deleted main checkout, and git older than 2.31, each give a clear error.
- **`requires` is checked before the strict parse.** A project may use a field newer
  than a user's plugin; that user is told to update, not that the field is unknown.
- **Without `cc-smart-dev-kit.json`, the plugin does Claude Code's default** and its guards stay
  silent. A project that never opted in does not notice the plugin.
- **The worktree engine is deprecated, and needs more than the file:** a project that still
  wires its three hooks in its own `.claude/settings.json` keeps working until the next
  minor version (§ The worktree engine).

### How a project adds its own part to a general skill

A general skill reads the project's own additions when they exist. For example,
`/cc-smart-dev-kit:review` also follows the project's `.claude/cc-smart-dev-kit/review.md`, and where they disagree,
the project's text wins. The plugin stays general; each project keeps its own rules in
its own repo.

## Instructions, skills and agents

The plugin carries general working instructions for Claude, 17 skills and 3 agents, all
written for any project (`README.md` § Instructions, skills and agents lists them).

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
instructions, skills, agents or output styles. A deliberate repeat goes in
`scripts/check-duplicates.allow.json` with its reason. It cannot see the same rule said in
other words; that stays a review job.

**Agents pin no model and no effort.** The caller passes both on each launch, so an agent
never runs on a model nobody chose. Plugin agents and skills are named `cc-smart-dev-kit:<name>`.
An agent that works by a skill loads it with `skills:` in its frontmatter (`reviewer`:
`cc-smart-dev-kit:review`; `rules-maintainer`: `cc-smart-dev-kit:self-evolve`): the skill's text is in its
context from the start, and it needs no path to the plugin's version folder (proved live:
`claude-code-contract.md` § Instructions).
Agents that need an MCP server name its tools as `mcp__playwright__*`: the servers are
registered for the user (§ MCP servers at user scope), so the names stay. The reviewer also
lists claude-mem's `smart_search`, `smart_outline` and `smart_unfold` (the companion plugin's
own tool names), for a big file's shape; when they are not there or do not answer (on Windows
they can fail without an error, claude-mem #1247), it uses Grep and Read.

**The output style** ships but is never switched on: a person picks it with `/output-style`.
## The hooks

The hooks live in `src/hooks/`. There are two kinds, by who wires them (`wiring` in each
spec, `specs.ts`):

- **The plugin's hooks** (`HOOKS`): each one a bundle (`src/entries/<name>.ts` →
  `plugin/dist/<name>.js`), wired in **shell form** in `plugin/hooks/hooks.json` (no `args`;
  the exec form it replaced cannot start on Windows — `.claude/rules/hooks.md`,
  `docs/windows-hooks.md`), so they run in every project. They run through
  `plugin/bin/cc-smart-dev-kit-bun.sh`, a small `sh` script that finds
  bun without PATH (Claude Code's hooks get the PATH it was started with, which may lack
  bun): the bun `cc-smart-dev-kit setup` baked into the launcher, then `$BUN_INSTALL/bin/bun`,
  `~/.bun/bin/bun`, and PATH. With none it answers by its `--missing=` mode and exits 0: a
  PreToolUse guard passes `--missing=ask`, so it asks the person instead of letting the tool
  run (a guard fails closed); every other hook passes `--missing=quiet`, one line on stderr.
  It starts bun with `--no-env-file` and the plugin's own empty config, like the launcher and
  `plugin/bin/cc-smart-dev-kit`: bun would otherwise add the working folder's `.env` files to
  the hook and run its `bunfig.toml`, and a hook must see the environment Claude Code gave
  it, never a project's — the same rule `job run` refuses a job without.
  The baked line is
  single-quoted the way `shellQuote` writes it (each `'` as `'\''`), and the shim undoes
  exactly that, so a bun under a folder like `/home/o'brien` is found.
- **The deprecated worktree engine** (`PROJECT_HOOKS`): WorktreeCreate, WorktreeRemove and
  SubagentStop, which a project still on the engine wires itself as `cc-smart-dev-kit hook
  <name>` (§ The worktree engine). The launcher already runs its baked bun.

The contract they follow: `.claude/rules/hooks.md`. The Claude Code behaviour they rely on,
each row proved: `claude-code-contract.md` § Hooks and § Worktrees.

### One frame for every hook

Every hook, of both kinds, runs in the same frame (`src/hooks/run.ts`), in this order:

1. **Read the input.** Not JSON, another event, or a `cwd` outside git: nothing to do.
2. **The project's own copy, for a plugin hook only.** When the project's `cc-smart-dev-kit.json`
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
   opt-in.
3. **Read `cc-smart-dev-kit.json`.** When it is broken, needs a newer plugin, or lacks what the hook
   `needs` (the engine needs `worktrees`), the hook **fails closed**, each in the way that
   suits its event: a guard asks the person (it cannot know whether the project turned it
   on), WorktreeCreate fails with the reason, WorktreeRemove keeps the worktree, an
   informational hook says one line. "Closed" never means silent: a person must hear why.
4. **Run.** Any error is one line on stderr and exit 0 (a hook's bug never stops work),
   except WorktreeCreate and WorktreeRemove, which exit 1: they cannot succeed without
   their folder.

The frame is general on purpose: later hooks (notifications, the routing of heavy jobs)
are new specs in it, plugin-wired or project-wired.

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

`project init` writes no worktree hook, and `doctor` warns (`!`) when a project still sets
`worktrees.engine`, `worktrees.prefix` or `worktrees.setup`, or wires the engine's hook lines,
naming the steps to move; the engine retires in the next minor version.

### The worktree engine (deprecated)

The engine still works in this release for a project that wired it before 0.5.2, and it is
deleted in the next minor version (owner, 2026-10-18). `worktrees.prefix` is optional in the
schema now; a project on the engine must still set it, and the create hook fails closed and
says so when it is missing. The rest of this section describes the engine as it was.

A WorktreeCreate hook **replaces** Claude Code's own creation, for sessions and subagents,
in every project where it is wired, and a hook that prints no folder makes the creation fail
(proved live). So a plugin WorktreeCreate cannot step aside for a project that never opted
in: it would have to rebuild Claude Code's own worktrees there, and it cannot rebuild them
whole. A hook-made worktree loses the lock Claude Code puts on a worktree while a session
uses it, the marker its periodic sweep looks for, the reset of a reused clean worktree,
`--worktree "#123"` (a pull request) and the neutralised filter drivers (Git LFS). **So the
engine is opt-in per project** (owner, 2026-10-15): the plugin wires no WorktreeCreate or
WorktreeRemove, and no SubagentStop that touches a worktree — the engine's `subagent-stop`
removes one, so it stays the project's; a SubagentStop that touches none (`review-record`)
may be the plugin's (`.claude/rules/hooks.md`). A project that wired the engine before 0.5.2:

1. gave its `cc-smart-dev-kit.json` a `worktrees` field, and
2. wired the three hooks in its own `.claude/settings.json` (`cc-smart-dev-kit hook` prints the
   lines, from `src/hooks/project-wiring.ts`).

Each line is a shell string, `"$HOME/.local/bin/cc-smart-dev-kit" hook <name>`: the shell fills in
`$HOME`, so the launcher is found by its full path whatever PATH Claude Code was started
with, and the launcher runs the bun setup baked into it. The bare name `cc-smart-dev-kit` would need
`~/.local/bin` on that PATH, which an IDE or a desktop launcher may not give. Without the
launcher (setup never ran), Claude Code's creation fails and shows the shell's "not found"
(proved live). Wired without `worktrees`, the engine fails closed and names the fix.

Then, in that project:

- **A session's worktree:** `<parent of the main checkout>/<prefix><name>` (a `/` becomes
  `-`) on the branch `<name>`. One creation of a branch runs at a time: a lock file in the
  common git dir (`create-lock.ts`, O_EXCL, holding pid, process start time and session id)
  is held through `git worktree add` and the setup, so a second session asking for the same
  branch mid-create gets one clear refusal instead of two creates fighting over the folder
  and the branch; a lock whose process is gone is taken over. An existing worktree of that
  branch is entered again, unless another running session works in it. Otherwise an existing
  branch is checked out, or a new one is cut (not tracking the base) from `origin/<base>`
  right after `git fetch origin <base>`; a failed fetch refuses, because a new branch starts
  only from the latest base — so **a repo with no `origin` cannot create a new session
  branch** (`git worktree add` gets 500 s, the setup 540 s of the hook's 600 s). Then the project's `setup` runs inside (argv, at most 9 minutes, its
  output on stderr). A setup that fails leaves the worktree and exits 1; entering it again
  runs setup again (a marker in the worktree's git folder records a finished setup).
- **The base is per branch family** (`worktrees.bases`, `baseForBranch`): a branch whose
  name starts with one of those prefixes ends in `/` (a `hotfix/…`, a `release/…`) starts
  from that prefix's base — the longest prefix that matches wins — and every other branch
  from `worktrees.base`. The same base is what `git fetch origin <base>` fetches, so a
  released line of work never inherits the integration base's unreleased work. The
  after-merge note says so too: a session on such a branch is told not to merge the
  integration base in.
- **A project that ran an engine of its own** (`worktrees.engine: "own"`) wired no
  `cc-smart-dev-kit hook` lines. The field is deprecated with the engine and is accepted and
  ignored until the engine retires; `doctor` names it in its `!` line. Everything that only
  *reads* the repo keeps working: the after-merge and worktree-leftovers notes, the stash
  question, and `cc-smart-dev-kit worktrees`, which all read `worktrees.base` and never make
  a worktree.
- **A subagent's worktree (`agent-<hex>`):** what Claude Code would make for it,
  `<main checkout>/.claude/worktrees/<name>` on the branch `worktree-<name>`. The base
  follows Claude Code's `worktree.baseRef` setting: `"fresh"` (the default) is the remote's
  default branch (`origin/HEAD`), fetched when the repo was not fetched for a day, at most
  5 s and never asking for a password; `"head"`, or no remote, is the asking checkout's
  HEAD. No setup: a subagent's worktree must be quick.
- **Both** copy the gitignored files `.worktreeinclude` names, which Claude Code no longer
  does once a hook makes the worktree.

**WorktreeRemove** removes a worktree only when nothing can be lost: not the main checkout,
not locked, no worktree inside it, nothing changed or untracked, and no ignored file git does
not keep (`local-files.ts`: `git status --porcelain --ignored`, minus what comes back by
itself — `node_modules`, build output, caches — and minus a `.worktreeinclude` copy the main
checkout still holds byte for byte). An ignored file that cannot come back (an edited
`.env.local`, a notes file, a key) keeps the worktree, exit 1, and the files are named: `git
worktree remove` deletes ignored files without a word. Then its branch, when every commit on
it is also on another branch or a remote. Uncommitted work: kept, exit 1, and Claude Code
says it was not removed. Its input carries no "discard" field (seen live), and Claude Code
cannot check a worktree outside the repo itself, so `ExitWorktree` needs
`discard_changes: true` there: this hook is then the last check, and it never discards.

**SubagentStop** does what Claude Code does without hooks: a subagent's worktree that
changed nothing (no edit, no commit of its own) goes, with its branch. Claude Code keeps
every worktree a hook made for a subagent and runs no WorktreeRemove for it (its docs; seen
live). It finds the worktree by the subagent shape above.

`cc-smart-dev-kit doctor`, run in a project, checks the engine's wiring against `worktrees`: with
`worktrees`, all three hooks wired; wired without it, ✗; and ✗ for any other WorktreeCreate
hook in the project's or the user's settings (Claude Code runs both and makes two
worktrees).

### The plugin's hooks

| Hook | Event (matcher) | On when | What it does |
|---|---|---|---|
| `git-guard` | PreToolUse (Bash, PowerShell) | `cc-smart-dev-kit.json` exists | Asks before a force-push (git's abbreviations included: `--forc`), a push to a protected branch (`protectedBranches`, default `main`), `push --all`/`--mirror`, a branch deleted on the remote (`git push origin :x`, `-d`/`--delete`), `reset --hard`, `clean -f`, `worktree remove -f`, a checkout or restore that discards changes, `branch -D`, `stash clear` and an unnamed `stash drop`, and (with `worktrees`) a bare `git stash` / `stash pop`. One shell lexer (`shell-command.ts`) reads each command of a line; quoted text, here-docs and comments are data, and shell keywords, wrappers (`timeout 60 git push -f`, `env -i sudo -u me …`, `xargs …`), the here-doc a shell reads as its script, and the text piped into one are read through. Known limits: a git alias, `branch -f`, `checkout -B`, `switch -C`, `ssh`, a script file. "Ask", never "deny": the person may mean it. |
| `main-folder-guard` | PreToolUse (Edit, Write, NotebookEdit) | `worktrees.guardMainFolder` | Denies an edit of a file in the main checkout itself, with the way into a worktree. (Until 0.6.0 it also placed Serena's edits, with the `serena-root` hook's record; both went with Serena.) |
| `playwright-output` | PreToolUse (`mcp__playwright__.*`) | always (a `USER_HOOKS` bundle: it reads no cc-smart-dev-kit.json) | Rewrites a relative `filename` to an absolute path in the browser's output folder, with `updatedInput` and no permission decision; a relative name with a `..` segment is DENIED (the launcher's `--allow-unrestricted-file-access` means the server takes that path as it is). Answers only while the live `playwright` registration is the one setup recorded — a server of the person's own is left alone entirely. |
| `merge-guard` | PreToolUse (Bash, PowerShell) | `cc-smart-dev-kit.json` exists | Asks the person before a command that merges a pull request. Every merge of the line is judged (`gh pr merge`, `gh pr -R owner/repo merge 5`, an alias from `gh alias list`, `--auto` included), and the first the policy does not allow asks, naming that pull request: `autoMerge` on, the base is the integration base (`autoMergeAllowed`), the merge names THIS project's repository (its `origin`), every required check `gh pr checks --required` reports green, and (with `reviewBeforePush`) the head commit's review is recorded. The forms it does not judge ask with the reason — a `gh api` merge, a GraphQL query it cannot read, a shell alias, an extension whose words name a merge — as does a step that moves the merge's folder, branch or repository (`cd`, `git switch`, `GH_REPO=…`, `env`), and a `gh` that is missing or does not answer. Read-only `gh`, 10 s a call of the hook's 30 s. § The workflow › The merge guard. |
| `message-guard` | PreToolUse (SendMessage) | `cc-smart-dev-kit.json` exists | Denies a message to a session that works outside this repo (from Claude Code's session records). |
| `agent-guard` | PreToolUse (Agent, Task, Workflow), and PostToolUse for the record | **machine-wide** | The model a launch really runs on, and the model rules: no `model`/no `effort` → deny; `low` effort → deny on every model (`medium` for searches and reads, `high` for building and reviews, `xhigh` for the hardest judgment, `max` only when the person asks — D13); an affordable slot needs `effort: "max"`; the **`opus` tier** — whatever answers behind the name, and a name whose override or slot answers with a stricter tier counts as that tier — is allowed at `medium`/`high`/`xhigh` for any agent and any purpose, and an **ask** at `max` (the owner's decision D11; in `claude -p` a deny); the **`fable` tier** is a read-only agent with a `Fable reason:` word, and an agent that can change files (a fork included) only with `build`, as an **ask**. A fork is judged on the session's model, never on the `model` it names. A premium launch is recorded once it is known to run: an allowed one on PreToolUse, an asked one on PostToolUse. § The Agent guard. |
| `fable-session` | SessionStart, PostModelSwitch, Stop | **machine-wide** | One `systemMessage` to the person, once a session, when the session's own model is the **`fable` tier**; nothing to Claude, never an error and never a block — the line itself was seen live (2026-10-17), but not on `PostModelSwitch` or `Stop` yet. The model: at a start, the `model` the input names (no fallback); at a switch, `to_model` — the model the session moved TO; at a stop, the one that answered in the transcript, then `ANTHROPIC_MODEL` — the guard's own reading of the tier. Not `UserPromptSubmit`: it judged the PREVIOUS answer's model, so it missed the switch and warned after a switch back (the live bug of 2026-10-17). § The Fable-session note. |
| `job-route` | PreToolUse (Bash) | `jobs.route` | A heavy command is rewritten to `cc-smart-dev-kit job run --kind <kind> -- <command>` through `updatedInput` (proved live on 2.1.301). § The job route. |
| `after-merge` | PostToolUse, PostToolUseFailure (Bash, PowerShell) | `worktrees` | After a pull-request merge (`gh pr merge`, `gh pr -R owner/repo merge 5`, a readable `gh api` merge path, a `gh` alias for one): the steps that clear the merged worktree, and the message to send the other sessions when it went into `worktrees.base`. A form that names no pull request gets no note. |
| `review-record` | SubagentStart, SubagentStop | `cc-smart-dev-kit.json` exists | When a review agent (`workflow.reviewAgents`) starts, notes the commit the working folder is on; when it stops on that same commit, records it — the record the merge guard reads. Nothing for an agent that stopped inside its own worktree, or on another commit. § The review record. |
| `worktree-leftovers` | SessionStart (startup, resume) | `worktrees` | Names the finished worktrees (every commit on `origin/<base>`, nothing uncommitted, no session in it, idle an hour, no ignored file that cannot come back) and the ones whose folder is gone. Removes nothing. |
| `session-name` | SessionStart, UserPromptSubmit | `sessionNames` | Tells the session to name itself after its task (`cc-smart-dev-kit session-name`), then sets that as its title at the next prompt. |

Without `cc-smart-dev-kit.json` every one of them is silent — except the three machine-wide
ones: `agent-guard` (§ The Agent guard), `fable-session` (§ The Fable-session note) and
`playwright-output`, which reads no project file at all — so a project that never opted in
sees only Claude Code's own worktrees. The machine-wide `notify` hook needs no project file
and acts without one; the
`workflow.alerts` settings are the one thing it reads from a project that has them (§ The
notifier).

### The Agent guard

`agent-guard` (PreToolUse on `Agent`, and the older name `Task`) is **machine-wide**, like
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
   `loadConfigFile`. A slot with no chain is off, and the Claude model answers. So `sonnet` is
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

A **Workflow** tool call is judged too: its `agent(...)` launches run inside the tool and pass
no hook of their own (proved live on 2.1.301 — a project hook with the matcher
`Agent|Task|Workflow` saw the `Workflow` call and nothing else), so the guard reads the
`script` text: the `model`, `effort` and `agentType` of each call, and its prompt when that
is a fixed string literal (`readWorkflowScript` — a template that builds its text, `` `${…}` ``,
is not one). An option counts only as a key of the call's own options object, quoted or not
— never the same words in the prompt or in a nested object (`schema: { effort: … }`). A
`model` held in a variable is refused rather than guessed, and a prompt built at run time is
refused for a Fable launch (its reason line cannot be read). Two things are refused for the
whole call (`workflowRefusal`), because no rule can hold for a launch the guard cannot follow:
`agent` mentioned without a direct call (`const run = agent; run(…)`, `agent?.(…)`, `agent`
passed around), and a call whose options are built at run time (a `...spread`, a computed
`[…]` key, the same key twice). The strictest launch of the call answers for the whole call.

The rules are in one table in `src/hooks/agent-guard.ts` (its header). The policy under them —
which model a launch really runs on (`resolveLaunchModel`), the effort levels
(`ALLOWED_EFFORTS`), the Fable reason words and the worker kinds (§ Lead and workers) — is one
pure module, `src/models/launch-policy.ts`, which the guard imports and the worker launcher and
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

An `ask` in a session nobody
watches (`claude -p`, `CLAUDE_CODE_SESSION_ATTENDED=0`) is refused just like a deny — Claude
Code cannot ask anyone there (proved live on 2.1.301) — so the guard answers that denial with
a message that says why; an Opus-family launch below `max` needs no answer, so it stays
allowed there, one at `max` is told to run at `medium`, `high` or `xhigh`, or in an
interactive session, and one with no family is told to name `opus`. Every premium launch is
recorded once it is known to run — an allowed one on PreToolUse, an asked one on PostToolUse
(`RAN_EVENT`: the call ran, so the person said yes; one they refuse is never recorded) — once
per `tool_use_id`, in
`<stateDir>/agent-launches.jsonl` with why it ran — the `opus` tier as `opus:<effort>`, with
the prompt's reason word after it when there is one (`opus:xhigh`, `opus:max:security`; a fork
`opus:session-effort`), and the `fable` tier by its word (`fable:build` for a builder the
person asked for) — and `cc-smart-dev-kit usage` lists them (count,
why) — the transcripts say which model wrote a reply, never why it was allowed. A Workflow call
denied as a whole records none of its launches: nothing in it ran; an `ask` names every launch
of the script that asks, not only the first.

**Tiers, not vendors** (the owner, 2026-10-16). `LaunchModel.tier` is what the rules go by:
`opus` and `fable` mean the tier whatever answers behind them — a family name keeps its tier
through `ANTHROPIC_DEFAULT_<FAMILY>_MODEL` and through its family's slot, a Claude id has its
family's, and a name the guard cannot read is the `opus` tier, the strict reading. So an
override that points `opus` at a backend never becomes an affordable slot, is never forced to
`max`, and still asks at `max`; the messages name both, `` `opus` (answered by
openai:gpt-5.5) ``.

The Fable rules are the owner's of 2026-10-16, and each is the person's call:

- **A read-only agent** (Plan, Reviewer, Explore) takes any word of
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
worker's prompt, agent view's `agent_needs_input`, a question — → `permission_request`.
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

### The job route

`job-route` (PreToolUse on Bash) is the heavy-job queue's door: with `"jobs": { "route": true }`
in the project's `.claude/cc-smart-dev-kit.json`, a command its kinds classify as heavy is sent
through the queue instead of running raw (`docs/jobs.md` § The route). It answers with
Claude Code's `updatedInput` — the same tool input, its `command` replaced by
`"$HOME/.local/bin/cc-smart-dev-kit" job run --kind <kind> -- <command>` — proved live on 2.1.301
(`claude-code-contract.md`). It gives no `permissionDecision`: the rewrite replaces the input
and the permission system still decides about the new command, so a person's own rule for
Bash keeps working. `REWRITE_SUPPORTED` in the hook is the one switch, and with it false the
same command line is denied instead, never silently left raw. A command already
inside `cc-smart-dev-kit job run` is left alone, and `ownHooks` can silence the hook where a project
keeps its own. It is the one guard that changes the call rather than asking about it, which is
why it is opt-in per project.

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

`cc-smart-dev-kit doctor --live` (opt-in; it uses the person's login and costs a few cents) makes two
throwaway repos in a temp folder, one without `cc-smart-dev-kit.json` (Claude Code's own
worktrees, the default every project uses) and one that still wires the deprecated worktree
engine, and runs one `claude -p` session in each with
this plugin (`--plugin-dir`), only the EnterWorktree, ExitWorktree and Bash tools,
`--allowedTools` for exactly the calls it makes (never a mode that skips the permission
checks), and a three-step prompt: enter a worktree, `git status` there, leave with
"remove". The temp repo's project hooks run **the plugin being checked**
(`liveHookCommand`: this CLI's own `plugin/dist/cli.js`, with the bun running it), not the
installed launcher `~/.local/bin/cc-smart-dev-kit`, which would prove whatever version is installed
instead. Every hook run is logged (`CC_SMART_DEV_KIT_HOOK_LOG`, with each run's `cwd` and the spec's
`logFacts`), and it checks: without `cc-smart-dev-kit.json`, the plugin's hooks fired (SessionStart,
the git guard), the git guard **read the command line** (its log names the programs it
parsed: a hook that fired is not a guard that answered), no WorktreeCreate hook ran, Claude
Code made its own worktree and the session worked in it, and ExitWorktree removed it; with
the deprecated engine wired, its WorktreeCreate made the configured folder, the session
worked there, and its WorktreeRemove removed the folder and the branch. When all pass it
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
`fixesAfterReview`, `workers`) merges field by field like the rest. The one schema is reused by `src/project/config.ts` for the project's `workflow`
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
| `autoCommit`, `autoPush`, `openPr`, `clearWorktreeAfterMerge` | the skills (`commit`, `pull-request`, `worktree`): each reads `cc-smart-dev-kit workflow show` and follows it. Nothing else can: a commit, a push and a folder are the session's own doing, and no hook sees them as one act. |
| `autoMerge` | the **merge guard hook** (`src/hooks/merge-guard.ts`), PreToolUse on Bash and PowerShell — the one step a hook can stand in front of. `mergeMethod` and `deleteBranch` stay instructions: they say how a merge the guard allowed is made. |
| `reviewBeforePush` | both: the **review-record hook** writes the record when a review agent finishes (§ The review record), and the merge guard reads it. |
| `reviewAgents` | both: the **review-record hook** records only an agent listed there, and the **merge guard** trusts a record only when the list committed on the pull request's base names the agent that wrote it. A project that runs its own reviewer names it (the plugin's `cc-smart-dev-kit:reviewer` by default). |
| `alerts.events`, `alerts.sound` | the two alert hooks, `notify` and `stop-failure` (§ The notifier). |
| `alerts.usagePercent` | the status line (`src/cli/statusline.ts`), whose warning share it is. |
| `fixesAfterReview.*`, `workers.*` | nothing yet: resolved, shown by `workflow show` with their source, and written by `workflow set`. The merge guard's rule for the fixes after a review (D17) and the lead and worker sessions (§ Lead and workers) are the parts that will read them. |

**The merge guard** asks the person before a merge its rules do not allow, and lets one through
with no question only when **all** of these hold: `autoMerge` is on (`autoMergeOff` is the first
check, before any `gh` call, so a machine without `gh` hears the real reason); `autoMergeAllowed`
says yes for the pull request's base; the merge names **this project's own repository**
(`--repo`/`-R` is compared, owner/name case-insensitively, against the `origin` remote read with
git — the policy is about the repository the work is in, so another one always asks); every
required check `gh pr checks --required --json name,bucket` reports is green (a `skipping` check
counts as passed, which is GitHub's own rule for a merge); and — with `reviewBeforePush` on —
the head commit from `gh pr view` has a recorded review that counts.

**The review gate is read as committed on the pull request's base**, never from a checkout's
working copy. Every value the guard judges with — `autoMerge`, `reviewBeforePush`,
`reviewAgents`, `fixesAfterReview.*` (the limits a fix after a review may reach and still count,
D17 — read and shown with the gate, not judged yet), `worktrees.base` and `worktrees.bases`, and whether the committed `ownHooks`
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
every guard uses, `shell-command.ts`). The forms it reads: `gh pr [<its own flags>] merge …`
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
same way (`timeout 60 gh pr merge 5`).

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
key the after-merge note makes, so every worktree of a repository shares one record. It records
**exactly** one commit: a review of an older commit does not cover a newer one, which is the
point — the merge guard asks about the pull request's head commit, and a commit pushed after the
review is a commit nobody read. Each entry is `sha → { at, by }`: when it was first recorded,
and every writer that recorded it (an agent type, or `workflow review-done` for the person by
hand). An entry an older plugin wrote (`sha → time`) names no writer and counts for nothing:
that commit asks once. **Every write holds the record's own lock** (`withLock` on the
`reviews/` folder, a 3 s wait): two reviewers that finish at once both land. It is not the
state folder's shared lock, whose 10 s wait is as long as the hook may run.

**Who writes it: the review agent's own start and end** (`src/hooks/review-record.ts`,
`SubagentStart` and `SubagentStop`). A record a session writes for itself is only the
session's word — any caller could name a commit nobody read — so the one writer is the hook
Claude Code tells when a subagent starts and is done. At the start, when the agent's
`agent_type` is one the workflow's `reviewAgents` lists, it notes the commit the input's `cwd`
is on, keyed by `agent_id` (`<key>.starts.json`; Claude Code's `agent-` prefix and the bare id
are one agent; the first start stays when a resumed agent starts again; a day-old start is
dropped). At the end it takes that start back and records the commit **only when HEAD is
still the one the agent started on**: a fix committed while the reviewer read moves HEAD, and
then the record says nothing (one stderr line says to run the review again with every fix
committed); a stop with no start seen records nothing either. The names are compared by
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
SubagentStop is allowed by `.claude/rules/hooks.md` because this hook touches no worktree
(the engine's own `subagent-stop`, which removes one, stays the project's opt-in); its
SubagentStart cannot block a launch and adds no context. A run whose `cwd` is inside a
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

The deprecated worktree engine is not part of the switch, because the project wires it
itself: a project still on it moves by taking those lines out and using Claude Code's own
worktrees (README § Worktrees), in one commit. `cc-smart-dev-kit doctor` reports a second
WorktreeCreate left behind.

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

## Lead and workers

A person talks to one small **lead** session. It plans, and starts each phase of the plan as a
**worker**: a background session (`claude --bg`) in its own worktree, on its own branch, that
builds, tests, reviews and commits the phase and hands back a report. The lead never waits on a
worker — the news arrives by itself — and merges the finished branches locally. Background
sessions win over subagents alone (every hand-back lands in the lead's context, and a long phase
rots it) and over agent teams (no worktree isolation, no resume).

This section holds the contracts every part of it builds on: the switch, the kinds, the names
and the store. Nothing acts on them yet; the launcher (`worker start`), the watch that brings the
lead its news, and the worker and lead hooks are later parts, and extend this section.

**The switch** (D34) is `workflow.workers.enabled`, off by default, in the person's
`workflow.json` (every project's default) and in a project's `.claude/cc-smart-dev-kit.json`,
which wins field by field like every workflow setting (§ The workflow). Beside it in the same
group sit the limits a lead keeps its workers to — how many run on the machine at once, the
free memory a new one needs, when a quiet one is reported, when a long one hands off, when a
blocked one is stopped (D35: a worker never outlives its work) — and the `tag` of their names.
`workflow show` prints each with its source.

**The kinds** (D21) say what a phase needs, and so the model and effort its worker runs on:
`WORKER_KINDS` in `src/models/launch-policy.ts`, the one home of the launch policy the Agent
guard judges subagents by (§ The Agent guard). Routine work — `build`, `docs`, `tests` — runs on
`sonnet`, the worker slot: at `max` when an affordable gateway slot answers it, at `high` when
Claude Sonnet does (`isAffordable`, the guard's own reading of "affordable"). Work that needs
judgment — `security`, `money`, `permissions`, `schema`, `deploy`, `architecture`, `ui` — runs on
`opus` at `xhigh`, whatever answers the tier. `workerLaunch(kind, gateway, env)` makes that
choice from the same reading of the gateway the guard makes, so a worker never starts on a model
or an effort the guard would refuse a subagent; a test runs every kind through the guard.

**The names** (D26, `src/workers/names.ts`) show the role, because agent view has no parent link
and no grouping by lead — the name is how a person, and the portal, groups the sessions:

| Session | Name |
|---|---|
| a lead | `LEAD <tag> <plan>` |
| a worker | `W <tag> <phase> <slug>`, and ` 2`, ` 3` for a hand-off's next worker |

- **Role and phase first**, so a list that cuts a name still shows them. A tag is at most
  `MAX_TAG` (12) characters and a phase `MAX_PHASE` (8), so `W <tag> <phase>` always fits in the
  first `NAME_VIEW` (24) characters (the width agent view really shows is not proved live yet),
  and the whole name fits in `MAX_SESSION_NAME` (60): the clean title every session's name goes
  through (`cleanSessionName`, which moved here from the session-name hook). What a long name
  loses is the end of its slug or plan, never the hand-off number.
- **ASCII only, no brackets or quotes**, so a name is safe in a title bar, a shell line and a file
  name, and it **never ends in `]`**: the message guard drops the ` [ref]` ListAgents prints after
  a name before it looks the name up (`withoutListRef`, one home), so a name of ours that ended in
  `]` would not match itself there. Every part goes through `namePart`: accents dropped, any other
  character a `-`, no `--`, a letter or a digit at each end. A phase is the worker's identity, so
  one that is not already clean is refused rather than changed (`isPhase`).
- **The tag** names the repository: the main checkout's folder name, made clean and short, or
  `workflow.workers.tag` (`workerTag`). A folder name that leaves nothing (one of non-Latin
  letters only) is refused with the line to set the tag.
- `roleOf(name)` reads the shape only — `lead`, `worker`, or null for any other name, a ListAgents
  ` [ref]` read past. A person may name a session in that shape by hand, so **the store, never the
  name, is what anything that stops or removes a session goes by.**

**The store** (`src/workers/store.ts`) is what the kit knows of each lead and worker, per
repository, under the state folder:

```
<stateDir>/workers/<repo key>/workers/<worker id>.json   one record per worker
<stateDir>/workers/<repo key>/leads/<session id>.json    one record per lead
<stateDir>/workers/<repo key>/reports/<worker id>.json   a worker's hand-back report
<stateDir>/workers/<repo key>/events.jsonl               every change, one line each, append-only
```

- **The key is the review record's** (`repoKey`, a hash of the main checkout's folder), so every
  worktree of a repository shares one store, as it shares one review record. It is the kit's own
  state: folders 0700, files 0600, each record written whole through the kit's atomic write.
- **Every write holds the store's own lock** (`withLock` on the repository's folder, 3 s at most),
  not the state folder's shared one: two leads, or a lead and a worker reporting at once, both
  land. A state change and its `state` event are written under one hold, so the log never misses
  a change; a new worker is one `created` event, a step or a report one line each.
- **A worker record** holds who it is (its id — a plain file name, known before any session
  exists —, its name, its session's id and short id, its lead), what it does (the repository,
  the plan, the phase and slug, the kind, the model as named with the slot and the model that
  answer it, the effort, the permission mode, the worktree, the branch, the base and its commit,
  the files of its brief) and where it is: its state, its last line, its report, its pull request,
  its memory, and when it was recorded and changed. The states are `queued`, `starting`,
  `working`, `blocked`, `paused`, `quiet`, `done`, `failed`, `stopped`, `handoff`, `merged` and
  `removed` (`WORKER_STATES`, each one's meaning in the file). **A lead record** holds its session
  id, name, repository, plan and folder.
- **The hand-back report** is what a worker gives the lead when its phase ends: its status (`done`,
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
  and the shells that started it, are not taken for programs using it. `--clean` and `--remove`
  hold a port as a lock (`ports.ts`), move a worktree
  aside before deleting it, and delete a branch only when the base holds every commit on it.
  The plugin's own leftovers hook uses the same verdict; the dev-server probe the project
  this came from had (one project's `.dev-server.json` and ports) is **not** ported — the
  general rule is a program running from the worktree, or working in it.

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
  the entries out with a note; the launcher, auto-update and the companions still
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

- Five keys in claude-mem's settings, owned through `applyManagedJson`. claude-mem's
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
  (`pydantic<2.14`, its CHANGELOG, #4595). `doctor` warns (`!`, never a failure) below
  13.35.0.

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
