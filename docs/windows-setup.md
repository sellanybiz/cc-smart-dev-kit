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
| `sessions` | Lists sessions and saves Warp tabs. `--open` brings sessions back in Warp tabs where Warp is there, else in **Windows Terminal** window each (`wt.exe`), else it says what to do by hand. |
| `worktrees` | The scan and the removal are already Windows-aware (a PowerShell process scan, `hostPath`, move-before-delete). |
| The gateway service | A per-user **Scheduled Task**, `cc-smart-dev-kit-router`, instead of the systemd units: `gateway setup` writes its definition and registers it, `doctor` reads its state, `restore` stops and removes it. No socket activation and no journal (`windows-gateway.md`). |
| The heavy-job queue | Runs each job as a plain child (no memory ceiling); the free memory comes from Windows itself (`os.freemem`, `windows-jobs.md`). |
| Notifications | A desktop toast through PowerShell, and Windows plays the sound of its own notification; the terminal route (`terminalSequence`) is Claude Code's own and platform-neutral (`windows-notify.md`). |

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
  the `claude-code` profile lives, and Warp's tab configs), and they build it from the home
  folder on purpose.
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
- **`sessions --open`** brings sessions back in Warp tabs when Warp is installed (its data
  folder shows it), else in a **Windows Terminal** window each: `wt.exe -d <main checkout> cmd
  /k "claude --resume <id>"`. `cmd /k` keeps the window open after Claude exits, as a Warp tab
  and an XFCE Terminal window do. With neither Warp nor Windows Terminal it says so and prints
  each `claude --resume` line instead of failing.
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
  Windows' own code instead of 130. Owed: press Ctrl+C in a real Windows console and read the
  code back (`echo %ERRORLEVEL%`).

## Owed: run these on a real Windows machine

Nothing below has been run on Windows yet. Each one is a live check, not a unit test.

1. **Git Bash, end to end** — `cc-smart-dev-kit doctor` shows the Git Bash `✓`, and a guard
   actually blocks in a real Claude Code session (a force-push denied). Research live test 1.
2. **The control**: the shell-form hook command (a `.sh` first token) runs through Git Bash with
   `${CLAUDE_PLUGIN_ROOT}` in forward-slash form. Research live tests 1 and 2.
3. **The `.cmd` from PowerShell and from `cmd`**: `cc-smart-dev-kit setup`, then `doctor`, then
   `version`. It must find bun, find the plugin folder, and pass arguments and the exit code
   through. Research live test 3.
4. **Chrome**: `browser setup`, then `browser check`, on the person's own Chrome through the
   Playwright extension in the `claude-code` profile: the `%LOCALAPPDATA%` profile path, the
   Windows `lockfile` check (there is no `SingletonLock` there), the HKCU pre-registration and
   its Enable click, and the Web Store install. Research live test 8, and the owed list in
   README § The browser.
5. **`worktrees --clean`**: a finished worktree with a running program in it, and one without —
   the PowerShell process scan, `hostPath`, and "a folder in use cannot be renamed". Research
   live test 9.
6. **`sessions --open`** in Windows Terminal: `wt.exe -d <folder> cmd /k …` opens one window per
   session, and the `--open` marker file stops a second run from opening a second copy.
7. **File modes**: `setup` completes on Windows with a lock and a state folder; nothing crashes
   over `chmod`/`fchmod`, and the state folder's ACL keeps other accounts out. Then the readers
   side, by hand: `gateway status` reads the config (no "can be read by other users" line),
   `browser mcp` finds the token, and `doctor` reads the Tavily key file — none of them refused
   over a mode, and no message saying `chmod 600`. (The readers' own tests run in the Windows CI
   job; this is the live run.)
8. **The paths**: `doctor` prints the `~`-shortened paths and they point under `%USERPROFILE%`;
   Git Bash, PowerShell and `cmd` all reach the same `installed_plugins.json`.
9. **Git Bash absent** (deliberately): `doctor` says `✗ Git Bash was not found`, and in a
   session a hook that needs bash errors visibly instead of passing silently.
10. **Ctrl+C**: in a real console, `cc-smart-dev-kit portal` then Ctrl+C — the exit code is 130
    (`echo %ERRORLEVEL%` right after), and the parent prints nothing odd.
11. **The browser's MCP server through `cmd.exe /c`**: after `setup`, `claude mcp get playwright`
    shows `cmd.exe /c …\cc-smart-dev-kit.cmd browser mcp` and says Connected; a session's
    Playwright tools answer; and when the session ends no `cmd.exe` or bun is left running, and
    no "Terminate batch job (Y/N)?" waits in a console.
12. **The instructions' copy**: after `setup`, `doctor` shows the instructions `✓` (the copy is
    found as installed), and `restore` removes the copy's folders.
