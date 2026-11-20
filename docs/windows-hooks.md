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
  "command": "\"${CLAUDE_PLUGIN_ROOT}/bin/cc-smart-dev-kit-bun.sh\" --missing=ask \"${CLAUDE_PLUGIN_ROOT}/dist/job-route.js\"",
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
- **`--missing=ask` / `--missing=quiet`**, unchanged: the guard (`job-route`) still fails closed when bun is
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

Claude Code has a PowerShell tool beside Bash on native Windows (`docs/claude-code-contract.md`
§ Windows). The plugin's shell judge, `job-route`, is therefore wired on `Bash|PowerShell`, and
it reads each line in the dialect of the tool that runs it — the one shell reader every hook
uses (`src/shell/command.ts`). A raw `claude --bg`, a `claude -p` launch and `workflow propose`
are judged the same in PowerShell; only the queue rewrite stays Bash-only, because the
rewritten line is a `sh` line the PowerShell tool cannot run. `src/hooks/entries.test.ts` pins
the matcher, and `src/hooks/bash-judge.test.ts` has the PowerShell cases, both run by the
Windows CI job.

## The user's own hook line

Setup no longer installs a notification hook. It removes only the exact owned entry
recorded by an older setup; edited or unowned entries stay for manual cleanup
(`docs/design/hooks.md` § The notifier). There is no replacement hook or Windows toast.

The notifier-only launcher case was removed from `scripts/windows-hook-smoke.sh`.
That script no longer proves `$HOME` expansion or execution of the extensionless launcher
in Git Bash. The real launcher's body is proved on Linux and macOS and is still owed one
Windows run. No notification send or replacement launcher case is installed.

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
