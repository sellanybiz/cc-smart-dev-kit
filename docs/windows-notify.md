# Alerts and the background self-update on native Windows

What the plugin does on Windows when Claude needs the person, when a turn ends, and when a
usage limit stops a turn — plus the background update check that runs after a session start.
Native Windows, not WSL. Every unproved claim below has a **live test** at the end, and
nothing here is proved on a Windows machine yet.

## The desktop alert: a PowerShell toast

The three systems each get their own sender (`src/update/apply.ts` § `notifyCommand`):
`notify-send` on Linux, `osascript` on macOS, and on Windows a **toast** built by
`src/hooks/windows-toast.ts`. The notifier hook (`src/hooks/notify.ts`), the StopFailure
usage-limit alert (`src/hooks/stop-failure.ts`) and the update hook all use it.

- **Which program.** `powershell` — Windows PowerShell 5.1, which ships with Windows 10 and
  11 and can load WinRT types. PowerShell 7 (`pwsh`) cannot load them without extra
  assemblies, so it is never used, and never looked for. No module and no extra install is
  needed (BurntToast is not used).
- **The API.** `[Windows.UI.Notifications.ToastNotificationManager]` with the AppUserModelID
  `{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\WindowsPowerShell\v1.0\powershell.exe` — PowerShell's
  own, which every Windows 10/11 install registers as a Start Menu shortcut. An unpackaged
  app can show a toast only under an AUMID a shortcut registers, and this is the one that is
  always there. The notification shows "Windows PowerShell" as its app name.
- **The fallback.** If the WinRT call throws, the script shows a notification-area balloon
  (`System.Windows.Forms.NotifyIcon.ShowBalloonTip`), which needs no AUMID. The icon must stay
  alive while the shell picks the balloon up, so that path waits four seconds before it exits.
- **`critical`.** Linux's `--urgency=critical` (stays on screen, shows under Do Not Disturb)
  becomes a **reminder** toast (`<toast scenario="reminder">`): it stays on screen until the
  person dismisses it and it reaches them with Focus Assist on.
- **Sound.** None of ours: Windows plays the sound of its own notification. `playSound`
  stays Linux-only (it needs `paplay` and the freedesktop sounds).
- **The text can never change the program.** The title and the body become **base64 of their
  UTF-8 bytes**, and the script decodes them itself
  (`[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String(…))`): no character of them is
  part of the script's own source, and the base64 alphabet has no quote, no backslash and no
  line break. A PowerShell **single-quoted** literal is *not* enough — the tokenizer reads five
  characters as a single quote (`'`, U+2018, U+2019, U+201A, U+201B; `about_Quoting_Rules` §
  Including quote characters in a string), and doubling only `'` let `don’t` end the string (no
  toast at all) and `’; Start-Process calc; ’` run code that reached the alert through a model's
  answer. The whole script still travels as one `-EncodedCommand` argument (base64 of UTF-16LE),
  so no character of the alert is ever on a command line a shell parses. In the toast XML the
  title and the body are appended as text nodes (`CreateTextNode`), never XML source.
  `src/hooks/windows-toast.test.ts` pins each of these (a smart quote, an injection, `$`,
  backticks, a line break, an emoji).
- **It never blocks the hook.** The hook starts the toast and returns without waiting for it.
  On Windows that takes the trampoline below, because a plain detached child dies with its
  hook there; what is waited for there is the trampoline's own start (a few milliseconds),
  never the toast.

The usage-limit alert names the command, as macOS already does: a toast with a button ("Use
<target> until it resets") needs an activation callback and a registered protocol, so the
action stays Linux-only for now. On Windows the StopFailure hook also skips the detached
worker (`usesAlertWorker`): the worker exists to wait for a click, and Windows has no click
to wait for — the hook shows the plain toast itself.

## A detached child must outlive its hook: the `cmd /c start` trampoline

A hook returns at once, so the programs it starts — the notifier, the usage-limit alert, and
the background update check — have to survive that exit. On Linux and macOS `detached: true`
does it (the child gets its own session). **On Windows it does not**: Bun puts every child in
a kill-on-close job object, and `detached` does not break out of it, so the child dies the
moment the hook exits (open Bun bug, oven-sh/bun#31603). A notifier that dies at once shows
nothing.

So on Windows `src/hooks/detached.ts` starts them through

```
cmd /d /s /v:off /c "start "" /b "<program>" "<arg>" …"
```

`""` is the window title `start` takes as its first quoted argument, `/b` starts without a
new window, and the program breaks away from the job object. **The trampoline hands cmd.exe
one line, and cmd.exe reads that line itself**, so every argument is wrapped in double quotes
(a `&` would start a second command, a `^` would eat the next character, `%name%` would become
a variable's value — inside double quotes too: Microsoft's `cmd` page for the special
characters, and ss64's "Escape Percents" for the `%` nothing escapes at a command line). The
whole line is one pair of quotes, which `/s` strips; `/d` keeps the registry's AutoRun command
out of a hook; `/v:off` keeps a `!` in a path a `!` whatever the registry says; and the line
is passed with `windowsVerbatimArguments`, so the spawner cannot quote it a second time. An
argument cmd.exe has no way to carry — a `"`, a `%`, a line break, a NUL — is **not started at
all**: one line on stderr says which argument and why, because a mangled line is worse than no
line. The trampoline itself is waited for (it returns at once), so the program is running
before the hook returns; the program is never waited for. `windowsHide: true` keeps a console
window from flashing. This is the workaround the Bun issue records as verified.

## The background self-update

`src/update/background.ts` § `backgroundCheckArgv` builds the argv per system
(`src/entries/update-check.ts` starts it):

| System | argv |
|---|---|
| Linux, macOS | `<bun> <dist/update-check.js> --background` — unchanged |
| Windows | the same argv behind the trampoline above: `cmd /d /s /v:off /c "start "" /b "<bun.exe>" "--no-env-file" "<dist/update-check.js>" "--background""` |

`--no-env-file` is Windows-only: the trampoline starts in the home folder, where Bun would
otherwise load a `.env` of the person's into the check. Linux and macOS keep exactly the argv
they had. The check itself (`claude plugin marketplace update …`, then `claude plugin
update …`) is unchanged and still runs in the home folder with `gitEnv`.

## The terminal route on Windows

The alert reaches a terminal in one of two ways: the hook's `terminalSequence` field, which
**Claude Code itself** writes to the session's terminal, or writing a terminal device
(`/dev/tty`, then the session's own pty from `/proc`). Both devices are POSIX; on Windows
`ttyDevice` returns null and nothing is tried — a path of that name there would be an ordinary
file on the current drive, and a write would land in that file instead of a terminal. So on
Windows the only terminal route is the `terminalSequence` field, and only for the events whose
answer Claude Code reads (`Notification`, `PreToolUse`, `Stop`).

The route matters only when there is no desktop route: with PowerShell on PATH the toast is
always the route on Windows, including over an SSH session into the machine (where the toast
shows on that machine's desktop, which the person may not be looking at).

**Not proved yet:** whether Windows Terminal or Warp on Windows understands OSC 777 at all,
and whether Warp there sets `TERM_PROGRAM`/`WARP_*`. No OSC 9 variant was added: nothing in
the research supports it over OSC 777, and a guess here would be a wrong one.

## What is still owed (live tests on a Windows machine)

1. **A toast renders from a hook process** (live test 5 of the Windows support research):
   run a session, let a permission prompt wait, and see the Windows notification. Which of
   the two routes showed it (toast or balloon) is what the test tells us; if the balloon is
   the one that works, the order of the two should be swapped.
2. **The reminder toast**: that `<toast scenario="reminder">` is accepted under the PowerShell
   AUMID, stays on screen, and reaches the person with Focus Assist on.
3. **`terminalSequence` arrives in Windows Terminal / Warp** when the alert goes that way (the
   same live test 5).
4. **The self-update survives its hook** (live test 7 of the Windows support research): does
   the background check run, log, and install a newer version after the hook returned — with
   the trampoline, and with the plain `detached` spawn as the control that it really is
   needed?
5. **`powershell` resolves**: `Bun.which("powershell")` and `Bun.spawnSync(["powershell", …])`
   on a hook's PATH. Bun's PATHEXT resolution is unproved; if `powershell.exe` has to be
   spelled out, that is a one-line change in `src/hooks/windows-toast.ts` (`TOAST_SHELL`).
6. **The `claude` command the update runs**: `which("claude")` may find `claude.cmd` (an npm
   install) rather than a `.exe`. Bun spawning a `.cmd` without a shell is unproved — if
   `claude plugin marketplace update` fails there, `capturingRunner`
   (`src/update/apply.ts`) needs the `cmd /c` treatment claude-mem's runner gives `bun.cmd`.
7. **A hook whose PATH has no PowerShell**: the notifier should fall to the SSH-terminal
   route, and with no SSH stay silent rather than fail.
8. **The trampoline line starts the right program** (the quoting, `src/hooks/detached.ts`):
   with a bun at a path holding a space, a `&`, a `^`, a `!` and parentheses
   (`C:\Program Files\Bun & Co\bun!.exe`), the background check runs with exactly those
   arguments — not a second command, not a path with a character missing.
9. **`windowsVerbatimArguments` really is honoured on Windows**: if Bun quoted that one line
   again, every `"` in it would come back escaped and the line would be mangled. Three things
   say it is honoured (Bun's own types: "no quoting or escaping of arguments is done on
   Windows"; oven-sh/bun#29636's fix, which uses this option with `cmd /d /s /c` for the same
   reason; the option's name in the 1.4.3 binary), and none of them is a run.
10. **The `.cmd` launcher from an odd profile folder** (`src/setup/launcher-cmd.ts`): with
    `%USERPROFILE%` holding a `&`, a `%` or a `!`, `cc-smart-dev-kit doctor` (from `cmd` and
    from PowerShell) runs and reports its version — the paths are quoted, the baked bun's `%`
    is doubled, and `setlocal DisableDelayedExpansion` holds the `!`.
