# The installer


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
saw "the token was not saved" (seen live). The one home for the rule is
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
