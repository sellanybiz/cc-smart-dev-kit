# Windows

What the plugin does on **native Windows** (not WSL), what it does not, and what still has
to be tested on a real Windows machine. Native Windows is the target: PowerShell and
`cmd` are the normal shells there, and Git Bash is what makes the parts that are `sh` work.

Read together with `claude-code-contract.md` (what Claude Code itself does on Windows) and
`design.md` (how the parts fit). Where this page says *owed*, it means no one has run it on
Windows yet.

## The short version

| Part | On Windows |
|---|---|
| The launcher | **Both**: `~/.local/bin/cc-smart-dev-kit` (`sh`, for Git Bash and the project-wired hooks) and `cc-smart-dev-kit.cmd` beside it (for `cmd` and PowerShell). `setup` writes both, `restore` removes both. |
| Every path | The same layout as Linux and macOS, under `%USERPROFILE%` (below). Claude Code's own folder is `%USERPROFILE%\.claude`. |
| `setup`, `doctor`, `restore` | Work. File modes are not protection there (below); `doctor` checks Git Bash and the `.cmd`. |
| The hooks | Need Git Bash (`doctor` checks it). The hook launch path itself is the hook work in `claude-code-contract.md`. |
| The portal | Opens the person's browser with `cmd.exe /c start "" <url>`. |
| `sessions` | Lists sessions. `--open` brings sessions back in a **Windows Terminal** window each (`wt.exe`), else it says what to do by hand. Old saved tabs are left alone. |
| `worktrees` | The scan and the removal are already Windows-aware (a PowerShell process scan, `hostPath`, move-before-delete). |
| The gateway service | A per-user **Scheduled Task**, `cc-smart-dev-kit-router`, instead of the systemd units: `gateway setup` writes its definition and registers it, `doctor` reads its state, `restore` stops and removes it. No socket activation and no journal (`windows-gateway.md`). |
| The heavy-job queue | One heavy run at a time per machine. A named-file run bypasses the queue; no memory or priority settings. See [Windows jobs](windows-jobs.md). |
| Notifications | No custom kit desktop, sound or terminal notifications. Claude Code and other plugins keep their own behaviour. |
| **The always-on guards** (the Agent guard's PostToolUse record, the session-escape guard, the shell judge `job-route`) | **Works.** Shell form through Git Bash. The shell judge is wired on **Bash and PowerShell** and reads a line in the dialect of the tool that runs it (`src/hooks/bash-judge.ts` § `readBash`); its queue rewrite stays Bash-only, because the rewritten line is a `sh` line the PowerShell tool cannot run, so with the route on a heavy PowerShell line is refused with the Bash line to run instead (`src/hooks/job-route.ts` § `jobRoute`; the live check is owed, `docs/windows-jobs.md`). The session-escape guard asks on a `C:\…` settings path, on Git Bash's own `/c/…` form of it, and on PowerShell's `Set-Content`/`Copy-Item` (`src/hooks/session-escape-guard.ts` § `kitFileKind`, `shellTargetPath`). |
| **The hook frame's fail-closed path** (A4) and the shim's `--missing=fail` | **Works.** No bun, or one older than the plugin needs, is an **ask** for a guard and one line on stderr with exit 1 for the command (`plugin/bin/cc-smart-dev-kit-bun.sh`, its `--missing=fail` block); the Windows CI job runs both in Git Bash. |
| **The background clean** (WT, D48) | **Works.** A detached start from a hook goes through `cmd /d /s /v:off /c "start "" /b …"` with every argument quoted, so the clean outlives the hook (`src/hooks/detached.ts` § `windowsStart`, `src/worktrees/auto-start.ts` § `startAutoClean`), and `windowsHide` starts no console window. The scan and removal it calls were already Windows-aware (the `worktrees` row above). |
| **The gateway's breaker** (BR1–BR3) | **Works**, with the Windows service's cost: a restart is the Scheduled Task stopped and started, so it refuses requests for a moment and a stop cuts answers in flight (`windows-gateway.md`). The breaker itself is in the router — the same bundle on every platform. |
| **The retry watchdog keys** (CC1) | **Works.** Three owned keys under `env` in `settings.json`, written through the managed-key path (`src/setup/retry-watchdog.ts` § `RETRY_WATCHDOG_SETTINGS`). No platform code. |
| **The major-version hold and `autoUpdate: false`** (D33, D39) | **Works.** State files and one managed settings key: no platform code (`src/update/major.ts`, `src/setup/auto-update.ts`). |
| **Server tools and the judge** (WS) | **Works.** The router's route is the same bundle and the same rule on every platform (`docs/gateway.md`). |
| **The one shell reader** (A2) | **Works.** It reads Bash and PowerShell and is the only reader every guard uses; its tests run in the Windows CI job. |

Herdr GUI is offered only by manual setup, with `--no-herdr` to skip this run. Its official
PowerShell installer and normal core bootstrap own their app/core, shortcuts and user PATH
changes. No GUI is launched and no preferences are changed. See `README.md` § Herdr GUI for
consent, dry-run, preservation and download boundaries. Real Windows installation is unproved.

The background self-update still uses the detached Windows trampoline
(`src/hooks/detached.ts`); it records its result without sending a toast. Native proof that
the child survives its hook, including odd paths and `.cmd` resolution, is still owed.

## Where things live: one folder, three shells

**Decision: the plugin keeps the POSIX layout on Windows, under `%USERPROFILE%`.**

| What | Windows |
|---|---|
| Claude Code's folder | `%USERPROFILE%\.claude` |
| The launcher | `%USERPROFILE%\.local\bin\cc-smart-dev-kit` and `…\.cmd` |
| State (lock, records, backups) | `%USERPROFILE%\.claude\cc-smart-dev-kit` |
| Data (router copy, portal copy, the browser's output) | `%USERPROFILE%\.local\share\cc-smart-dev-kit` |
| The extension's token | `%USERPROFILE%\.config\cc-smart-dev-kit\playwright-extension.token` (the profile's ACL protects it: a mode there says nothing) |
| The gateway's config | `%USERPROFILE%\.config\cc-smart-dev-kit\gateway.json` |

Why, and what it costs:

- **One folder, three shells.** Git Bash exports `HOME`, PowerShell sets `USERPROFILE`, and
  the plugin resolves both (`homeDir()`). A person can be in Git Bash, then in `cmd`, then
  read the same paths in `doctor` output and in a doc, and they agree.
- **`%APPDATA%` and `%LOCALAPPDATA%` are not used** for the plugin's own files. Doing that
  would need every path to come through one resolver that also knows those variables, and it
  would split Git Bash (`$HOME\.config`) from the CLI — two homes for one rule. The places that
  *do* read `AppData` are folders belonging to **other** programs (Chrome's own user data, where
  the `claude-code` profile lives). Herdr uses its upstream `%LOCALAPPDATA%` destinations,
  not the kit layout, and those files stay outside kit restore.
- **Cost, stated plainly:** a hidden `.local`, `.config` folder in a Windows profile looks
  unusual, and a person browsing their profile will not expect it. The alternative costs
  more than it is worth (above).
- `USERPROFILE` is read **only when the platform is Windows**, so a Linux or macOS run whose
  environment happens to carry it keeps the same folders as before.

`setup` writes the launchers into `%USERPROFILE%\.local\bin`, the folder the plugin's own
per-user files live in. That folder is not on `PATH` on a fresh Windows machine, so `setup`
prints a note naming it and where to add it (Windows Settings → System → About → Advanced
system settings → Environment Variables → Path for your account), then says to open a new
terminal. Until then, the command runs where its folder is spelled out, and in Git Bash it
runs as soon as `~/.local/bin` is on `PATH` there.

## The `.cmd` launcher

`cmd.exe` and PowerShell cannot run a `sh` script, so `setup` writes a second launcher beside
the first: `cc-smart-dev-kit.cmd`. Both do the same thing: find bun, find the user-scope
plugin folder in `installed_plugins.json`, and run that version's `dist/cli.js` with
`--no-env-file` and the plugin's own empty `bunfig.toml` (a version folder with no such file
gets no `--config` flag: bun refuses a config path that does not exist), passing every
argument through and returning its exit code. Git Bash keeps
using the `sh` file (it is what the project-wired hooks call), and nothing has to choose.

Things the `.cmd` has to do differently, and why:

- **bun**: the path baked in by `setup`, then `%USERPROFILE%\.bun\bin\bun.exe`, then
  `%BUN_INSTALL%\bin\bun.exe`, then `bun.exe` on `PATH`.
- **The plugin lookup** prints the folder into a file in `%TEMP%` and `set /p` reads it back.
  A `for /f` over a command whose program path holds spaces (`C:\Program Files\…`) is the
  classic `cmd` quoting trap; a temp file has no such trap.
- **The one-liner carries no double quote** (the whole script passes it as one double-quoted
  `cmd` argument), and no `%` (which `cmd` would read as a variable). Both are checked by a
  test.
- **A `.cmd` is not an executable**: nothing can spawn it without a shell, so `doctor` runs it
  through `cmd.exe /c`. That is also why the *hooks* cannot use a `.cmd` as an exec-form
  command (`claude-code-contract.md`).
- **The browser's MCP server starts it the same way.** Claude Code starts an MCP server as a
  program, and a program on Windows cannot run the `sh` launcher, so on Windows `setup`
  registers `playwright` as `cmd.exe /c <the .cmd> browser mcp` (`launcherArgv` in
  `src/setup/launcher-cmd.ts`) — Claude Code's own advice for a stdio server on native Windows
  is the same `cmd /c` wrapper. Off Windows the registration names the `sh` launcher, as before.
- **Every line ends in CRLF.** `cmd` reads a batch file in blocks, and a `goto` to a label in a
  file with LF-only line ends can miss the label where a block ends. A launcher an older setup
  wrote with LF line ends reads as out of date in `doctor`; `setup` writes it again.

## Paths: `\`, and folder names without case

Every test whether one path is inside another goes through one function, `isInside` in
`src/path-compare.ts`: it turns `\` into `/`, resolves `.` and `..`, and compares without case
on Windows only. A `${folder}/` prefix test never matches a Windows path, which is what kept the
instructions' copy "not installed" there (doctor failed, and a restore left the copy's empty
folders). The tests give it `path.win32` paths, so a Linux run checks the Windows case too.

**A path Claude Code reads is written with `/`.** The `@` import in `~/.claude/CLAUDE.md` is
`@~/.claude/cc-smart-dev-kit/instructions/core.md` on Windows too (`claudeImportPath`): Claude
Code's import parser stops at a backslash, so the `@~\.claude\…` that setup wrote up to 1.4.1
loaded nothing, and Claude Code gave no error (`docs/design/instructions.md` § Instructions,
skills and agents).

## A settings file with a byte order mark

Notepad, and an older PowerShell's `Set-Content -Encoding UTF8`, save UTF-8 with a byte order
mark (U+FEFF) first. `JSON.parse` refuses that character, so every reader of a JSON file a
person may edit (`settings.json`, Claude Code's own files, a project's `.mcp.json`) goes through
`readUserJson` in `src/setup/user-json.ts`, which skips it. A file setup writes again is written
without the mark, the form Claude Code writes itself.

## File modes on Windows: the ACL, not `chmod`

The plugin sets modes everywhere: 0600 for a key or a lock, 0700 for the folder that holds
backups, 0755 for the `sh` launcher.

**On Windows those numbers protect nothing.** `chmod` there only toggles the read-only
attribute: no user/group/other, no execute bit, and `fchmod` (on an open handle) is not
implemented at all. What protects a file on Windows is the **ACL of the user profile** it
lives in — and every path the plugin owns sits under `%USERPROFILE%`, which another account
on the same machine cannot read by default.

So `src/setup/file-mode.ts` is the one home for the rule: off Windows a mode that cannot be
set is thrown (the file would be readable by others); on Windows the call is still made
(harmless) and a failure is not fatal, because the content is written and correct and the
profile's ACL is doing the protecting. Nothing may crash a run over a mode there.

**The same rule reads backwards, and that is what would break Windows worst.** The plugin also
*reads* a mode to decide whether a file is safe: the gateway's config (its keys), the
extension's token, the Tavily key file, the browser's output folder. Off Windows a file whose
group or other bits are set is refused, with a message saying to run `chmod 600`. On Windows
those numbers are made up — `statSync().mode` reports `0666` for a writable file and `0444` for
a read-only one, whatever the ACL says — so that check would refuse **every** file the plugin
owns: the router would run on its fallback config, `browser mcp` would find no token, and the
Tavily key file would be ignored. So `isOwnerOnly(mode, platform)` in the same module answers
what all of those ask: off Windows the bits, and on Windows "yes, the owner's alone" — the ACL
is the protection there, and no file is refused over its bits. No `chmod 600` message is
printed on Windows either. Its tests (and theirs) run in the Windows CI job
(`.github/workflows/windows.yml`), and the Linux job keeps proving the refusal still works
there.

## Git Bash: what needs it, and what doctor says

On Windows, Claude Code runs **shell-form hooks** (and the Bash tool) through Git Bash. The
plugin's own hooks are shell-form `.sh` commands on purpose, so Git Bash is what makes the
guards work there. `doctor` finds it exactly as Claude Code does (this order):

1. `CLAUDE_CODE_GIT_BASH_PATH`, accepted only when the file is named `bash.exe`, `sh.exe`,
   `bash` or `sh` **and** it exists (anything else Claude Code ignores — `doctor` warns about
   it rather than staying quiet);
2. `C:\Program Files\Git\bin\bash.exe`;
3. `C:\Program Files (x86)\Git\bin\bash.exe`;
4. beside the `git` on `PATH`: `<git folder>\..\bin\bash.exe`.

Found: a `✓`. The variable ignored: a `!` naming both. Not found: a `✗` saying to install Git
for Windows (`https://git-scm.com/download/win`) or to set the variable, because without it
Claude Code falls back to PowerShell and a hook that needs bash errors **visibly** instead of
running — which for a guard means the guard is not there.

## What Windows has no answer for is information, never a failure

`doctor` reports the one part a Windows machine simply does not have as a `·` line, not `✗`:

- `tmux: not on Windows, so no passthrough line is managed there` (setup writes `~/.tmux.conf`
  only where tmux is installed).

The gateway and the heavy-job queue have Windows answers of their own (`windows-gateway.md`,
`windows-jobs.md`), so `doctor` checks them there like anything else.

## Sessions, worktrees and the portal

- **The portal** opens the person's default browser with `cmd.exe /c start "" <url>`; there is
  no `xdg-open` on Windows. One home for that rule (`src/machine/open-url.ts`), used by the
  portal and by `sessions` alike.
- **`sessions --open`** brings sessions back in a **Windows Terminal** window each:
  `wt.exe -d <main checkout> cmd /k "claude --resume <id>"`. `cmd /k` keeps the window open
  after Claude exits. With no Windows Terminal it prints each resume command instead.
- **A clean shutdown**: Windows' own shutdown log (`wevtutil qe System`) is not read. The sign
  every platform uses is the time one — several sessions that closed in the same moment before
  the machine started were closed by the shutdown. One session alone still cannot be told from
  one closed with `/exit`, on Windows too.
- **`worktrees`** already branches for Windows where it matters: the process scan goes through
  PowerShell, `hostPath()` converts drive-letter paths, and a worktree is **moved** before it is
  deleted, because a folder a program still uses cannot be renamed on Windows — so the move
  fails and nothing is touched, where a plain removal would delete files up to the first one in
  use and leave half a folder nobody tracks.
- **Ctrl+C**: Windows has no POSIX signals. Pressing Ctrl+C in a console is a console event,
  which Bun maps to `SIGINT` for the process, so the portal's own handler runs there too and
  `cc-smart-dev-kit portal` ends with **130** — the shell's code for "ended by SIGINT", and the
  code the parent returns from the child. There is nothing like Linux's process group to
  forward a signal to, and a parent that the same console event ends first can exit with
  Windows' own code instead of 130. The owner's checklist below runs it (step 5).

## The owner's checklist: run these on a real Windows PC

Native Windows (not WSL), Windows 10 or 11, with **Git for Windows** installed. Run the six in
order, in PowerShell 5.1 (the one Windows ships) or `pwsh`; the exact commands are there so
nothing has to be worked out on the machine. Each says what it must show. `<owner>` is the
repository's publisher, as in `README.md` § Install.

**1. Install, with the one-liner.**

```powershell
$f = Join-Path $env:TEMP "cc-smart-dev-kit-install.ps1"
gh api repos/<owner>/cc-smart-dev-kit/contents/install.ps1 -H "Accept: application/vnd.github.raw" | Set-Content -Path $f
powershell -NoProfile -ExecutionPolicy Bypass -File $f <owner>/cc-smart-dev-kit
Remove-Item $f
```

Shows: exit **0**, or **3** with the items it could not finish named; the marketplaces installed,
the plugin installed, `setup` and `doctor` done. A **2** is a refusal and an **1** a failed step.

**2. `doctor`.** Open a new PowerShell window (so `PATH` is the one setup printed), then:

```powershell
& "$env:USERPROFILE\.local\bin\cc-smart-dev-kit.cmd" doctor
```

Shows: every line `✓` or `·` (`tmux: not on Windows` is a `·`), **no `✗`**; `Git Bash` `✓`;
the `.cmd` launcher `✓`; the instructions copy `✓`; the gateway line is `·` until step 4.
In `cmd`, `"%USERPROFILE%\.local\bin\cc-smart-dev-kit.cmd" version` prints the version and the
exit code is 0.

**3. A normal session.** In a git repository you can try things in, start `claude`, and:

- ask it to run `git push --force` — the git guard **asks** (it must not run in silence);
- ask it to run `claude --bg "x"` — the shell judge **asks**, saying to build the work with
  subagents instead;
- ask it to edit a file in the main checkout from a session in a worktree — the main-folder
  guard asks.

Shows: the hooks run through Git Bash and fail closed where they should; no console window
flashes. No kit notification sender is installed.

**4. The gateway on.**

```powershell
& "$env:USERPROFILE\.local\bin\cc-smart-dev-kit.cmd" gateway setup
& "$env:USERPROFILE\.local\bin\cc-smart-dev-kit.cmd" gateway status
Get-ScheduledTask -TaskName cc-smart-dev-kit-router | Format-List State
```

Shows: no elevation prompt; `State : Running`; status's health page answers, the port is the one
in `gateway.json`, the slots show their chains. Then run `gateway setup --yes` with nothing
changed: it restarts nothing. Change a slot in the portal or with `gateway slot`, run
`gateway setup --yes`: the task is stopped and started, its port closes and reopens, and a
running session's next request works (Claude Code retries the moment of refusal — the expected
cost of Windows, `windows-gateway.md`). `gateway off` and `restore --yes` stop and remove the
task; Task Scheduler no longer lists it.

**5. The portal.**

```powershell
& "$env:USERPROFILE\.local\bin\cc-smart-dev-kit.cmd" portal
```

Shows: the default browser opens the portal at `http://127.0.0.1:<port>`; the pages load with no
console errors; Ctrl+C in the console ends it, and `echo $LASTEXITCODE` (PowerShell) or
`echo %ERRORLEVEL%` (cmd) right after is **130**.

**The other live checks, one line each** — their detail is in the page named, and none of them
blocks 1.0.0 on Windows: Chrome through the Playwright extension (`browser setup`, `browser
check`; `README.md` § The browser), `worktrees --clean` with a program still using a folder
(the PowerShell process scan described above, under `worktrees`), `sessions --open` in Windows Terminal,
the file-mode readers on a real profile (`gateway status`, `browser mcp`, the Tavily key),
Git Bash deliberately absent (`doctor` `✗`, a hook errors visibly), the browser's MCP server
through `cmd.exe /c` (`claude mcp get playwright`), and one `launch --no-gateway` from cmd and
from PowerShell: the CLI writes the settings file, then `cmd.exe` carries its path to a
`claude.cmd` (`docs/gateway.md` § One session — the argv is tested, the live session is not).
