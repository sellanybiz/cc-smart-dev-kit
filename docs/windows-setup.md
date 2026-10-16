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
| The gateway service | **Not on Windows.** `systemd` is Linux-only, and `gateway setup` refuses with that sentence rather than pretending. |
| The heavy-job queue | Runs `plain` on Windows (no memory ceiling), and the live free-memory reading is Linux-only. |
| Notifications | A desktop toast and the sound are Linux and macOS only for now; the terminal route (`terminalSequence`) is Claude Code's own and platform-neutral. |

## Where things live: one folder, three shells

**Decision: the plugin keeps the POSIX layout on Windows, under `%USERPROFILE%`.**

| What | Windows |
|---|---|
| Claude Code's folder | `%USERPROFILE%\.claude` |
| The launcher | `%USERPROFILE%\.local\bin\cc-smart-dev-kit` and `…\.cmd` |
| State (lock, records, backups) | `%USERPROFILE%\.claude\cc-smart-dev-kit` |
| Data (router copy, portal copy, Chrome profile) | `%USERPROFILE%\.local\share\cc-smart-dev-kit` |
| The gateway's config | `%USERPROFILE%\.config\cc-smart-dev-kit\gateway.json` |

Why, and what it costs:

- **One folder, three shells.** Git Bash exports `HOME`, PowerShell sets `USERPROFILE`, and
  the plugin resolves both (`homeDir()`). A person can be in Git Bash, then in `cmd`, then
  read the same paths in `doctor` output and in a doc, and they agree.
- **`%APPDATA%` and `%LOCALAPPDATA%` are not used** for the plugin's own files. Doing that
  would need every path to come through one resolver that also knows those variables, and it
  would split Git Bash (`$HOME\.config`) from the CLI — two homes for one rule. The two
  places that *do* read `AppData` are folders belonging to **other** programs (Chrome's
  profile, Warp's tab configs), and both build it from the home folder on purpose.
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
`--no-env-file`, passing every argument through and returning its exit code. Git Bash keeps
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

## Linux-only checks are information, never failures

`doctor` reports the parts a Windows machine simply does not have as `·` lines, not `✗`:

- `tmux: not on Windows, so no passthrough line is managed there` (setup writes `~/.tmux.conf`
  only where tmux is installed);
- the gateway (`gateway setup` needs systemd, and says so);
- the job queue's free-memory reading (`free memory cannot be read on this system`).

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
4. **Chrome**: `browser check --headless` end to end on the one shared Chrome — the `lockfile`
   detection, which has no `SingletonLock` on Windows. Research live test 8.
5. **`worktrees --clean`**: a finished worktree with a running program in it, and one without —
   the PowerShell process scan, `hostPath`, and "a folder in use cannot be renamed". Research
   live test 9.
6. **`sessions --open`** in Windows Terminal: `wt.exe -d <folder> cmd /k …` opens one window per
   session, and the `--open` marker file stops a second run from opening a second copy.
7. **File modes**: `setup` completes on Windows with a lock and a state folder; nothing crashes
   over `chmod`/`fchmod`, and the state folder's ACL keeps other accounts out.
8. **The paths**: `doctor` prints the `~`-shortened paths and they point under `%USERPROFILE%`;
   Git Bash, PowerShell and `cmd` all reach the same `installed_plugins.json`.
9. **Git Bash absent** (deliberately): `doctor` says `✗ Git Bash was not found`, and in a
   session a hook that needs bash errors visibly instead of passing silently.
10. **Ctrl+C**: in a real console, `cc-smart-dev-kit portal` then Ctrl+C — the exit code is 130
    (`echo %ERRORLEVEL%` right after), and the parent prints nothing odd.
