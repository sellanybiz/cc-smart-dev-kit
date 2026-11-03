# The hooks on native Windows

The plugin's hooks run on native Windows, not only on macOS and Linux. This page says what
Windows needs differently in the launch path, and what it costs. The Claude Code behaviour
behind each point, and what is still owed a run on a real Windows machine:
[claude-code-contract.md](claude-code-contract.md) § Windows.

## What runs a hook on Windows

Claude Code runs a **shell-form** hook through a shell: `sh -c` on macOS and Linux, **Git
Bash** on Windows. The other form, exec form, resolves `command` as an executable and spawns
it with no shell — and Windows cannot spawn a shell script that way: it needs a real `.exe`.
Every one of the plugin's hooks used to be exec form, through
`plugin/bin/cc-smart-dev-kit-bun`, an extensionless `sh` script. On Windows that hook could
not start at all, and a guard that cannot start lets the call through.

So every hook in `plugin/hooks/hooks.json` is now shell form:

```json
{
  "type": "command",
  "command": "\"${CLAUDE_PLUGIN_ROOT}/bin/cc-smart-dev-kit-bun.sh\" --missing=ask \"${CLAUDE_PLUGIN_ROOT}/dist/git-guard.js\"",
  "timeout": 10
}
```

Each piece of that string is doing work:

- **No `args`**: that is what makes it shell form. With `args`, Claude Code would spawn the
  shim itself, which Windows cannot do.
- **The shim's name ends in `.sh`**, and it is the first token. Claude Code parses the first
  token of a shell-form command (quotes stripped); when it ends in `.sh`, Claude Code runs
  the whole command as `bash <command>` on Windows. So the shim needs no execute bit there,
  and no shebang handling by Windows.
- **The quotes**: on this form the shell expands `${CLAUDE_PLUGIN_ROOT}` — Claude Code
  exports it instead of substituting it into the string — so the quotes are what keeps a
  plugin folder with a space in it one word. Claude Code hands a shell-form hook that
  variable in the forward-slash Win32 form (`C:/Users/…`), which Git Bash, MSYS tools and
  `bun.exe` all accept.
- **`--missing=ask` / `--missing=quiet`**, unchanged: a guard still fails closed when bun is
  missing, and every other hook still says one line and exits 0.

The same form works unchanged on macOS and Linux: there the shell is `sh`, the shim keeps
its `#!/bin/sh` and its execute bit, and nothing about the hook changes.
`src/hooks/entries.test.ts` checks the form, the quoting and the `.sh` first token of every
entry; `scripts/windows-hook-smoke.sh` runs one real hook through the shim in Git Bash, in
the Windows CI job.

## The shim: finding bun on Windows

`plugin/bin/cc-smart-dev-kit-bun.sh` runs the hook's bundle with bun, and needs no PATH. It
tries, in order: the bun baked into the launcher, `$BUN_INSTALL/bin/bun` (then `bun.exe`
beside it), `~/.bun/bin/bun` (then `bun.exe`), then `bun` on PATH (then `bun.exe`).

On Windows it runs under Git Bash, where

- Bun's installer writes **`bun.exe`**, never a file called `bun` — so both names are tried;
- `$HOME` is Git Bash's own and is `%USERPROFILE%`, so `~/.bun/bin` is the same folder as
  `$USERPROFILE/.bun/bin`;
- `$BUN_INSTALL` and the launcher's baked bun stay in their native `C:\…` form: the MSYS
  runtime behind Git Bash accepts Win32 paths as well as POSIX ones. (Only a real Windows
  run can prove that last point: [claude-code-contract.md](claude-code-contract.md) §
  Windows, the live tests.)

A hook still never needs bun: with none found, `--missing=ask` prints the PreToolUse ask and
`--missing=quiet` writes one line, both exit 0. The command (`plugin/bin/cc-smart-dev-kit`)
passes `--missing=fail` instead: one line on stderr and **exit 1**, because a command must
never report success when it did not run. The Windows CI job runs that mode too.

## The PowerShell tool is judged too

## The user's own hook line

The **user-level notification hook** `setup` writes uses shell form, with the launcher and
the same reasoning:

```json
{ "type": "command", "command": "\"$HOME/.local/bin/cc-smart-dev-kit\" hook notify", "timeout": 10 }
```

No `args`, and the quoting wraps the whole path including `$HOME`. On Windows the shell is
Git Bash: it sets `$HOME`, and it runs the extensionless launcher because the file starts
with `#!` — MSYS2 marks a file executable by its first two characters as well as by
extension, which matters because Windows has no execute bit for `setup` to set. The Windows
CI job runs this exact line against a stand-in launcher, so the form is proved there; the
real launcher's own body (bun from its baked path, the installed plugin's CLI) is proved on
Linux and macOS and is owed one Windows run.

The line sits in Claude Code's user settings, not a project's, and agent view runs it there
on Windows through Git Bash like any other shell-form hook.

## What Windows costs these hooks

- **Git Bash is needed.** With Git for Windows installed, Claude Code runs shell-form hooks
  through Git Bash. Without it, Claude Code's shell tool is PowerShell instead, and these
  hooks — bash-shaped commands — cannot run: they fail, and a guard that cannot run is a
  guard that is not there, while the PowerShell tool still runs commands. Nothing may fail
  silently, so this is a live test owed on a Windows machine with Git Bash deliberately
  absent (claude-code-contract.md § Windows, live test 12).
- **Line endings.** Shell scripts must be LF. Git for Windows defaults to
  `core.autocrlf=true`, which would rewrite them to CRLF on checkout — a shebang whose
  interpreter path ends in `\r` cannot be run, and a value read out of a file keeps the
  `\r`. `.gitattributes` (`* text=auto eol=lf`) keeps every text file LF on every system.
- **`plugin/bin/` on the Bash tool's PATH** is proved on Linux only. Whether Git Bash (as
  opposed to PowerShell) gets that PATH on Windows is still owed a run.
