# The AI Gateway on native Windows

The gateway is the local router between Claude Code and every model
(`docs/gateway.md`): Claude models go to Anthropic byte for byte on the person's own login,
and the `haiku` / `sonnet` names point at slots of more affordable models. On Windows the
router is the same program and the same bundle (`plugin/dist/router.js`); what differs is
**how it is kept running** and **what a restart costs**.

Owner (2026-10-16): **native Windows, not WSL**. The service is a per-user **Scheduled
Task**, never a Windows service, and nothing in this path needs an administrator.

- Code: `src/gateway/service-windows.ts` (the task's definition, the PowerShell commands,
  the driver), `src/gateway/service.ts` (`RouterService`, `installRouter`),
  `src/gateway/commands.ts` (`routerService`, the choice), `src/gateway/doctor.ts`.
- The router itself did not change: with no socket inherited it binds `127.0.0.1:<port>`
  itself (the `gateway serve` path), so its health page, its port, and its `Host` / `Origin`
  checks are the same as on Linux.

## The task

`cc-smart-dev-kit-router`, registered by `cc-smart-dev-kit gateway setup`:

| Part | What it is | Why |
|---|---|---|
| Trigger | logon of this user (`LogonTrigger`, `UserId`) | the systemd unit's `WantedBy=default.target`: the first request does not wait for the router |
| Principal | this user, `InteractiveToken`, `LeastPrivilege` | a per-user, no-elevation task: no password is stored, nothing runs as another account |
| Action | `"<bun.exe>" --no-env-file "<router copy>"`, working folder the home folder | the unit's `ExecStart`: the bun that ran setup, never a file in the plugin's version folder, and no `.env` file is loaded |
| `MultipleInstancesPolicy` | `IgnoreNew` | one router, as one unit |
| `DisallowStartIfOnBatteries`, `StopIfGoingOnBatteries` | `false` | a laptop would otherwise never run the router |
| `StartWhenAvailable` | `true` | a logon trigger missed while the machine was off still starts it |
| `IdleSettings` | `StopOnIdleEnd` / `RestartOnIdle` `false` | the machine going idle must not stop the router |
| `ExecutionTimeLimit` | `PT0S` | Task Scheduler's default is three days; the router runs until it is stopped |
| `RestartOnFailure` | 3 tries, a minute apart | the nearest thing to systemd's `Restart=always` |

The definition is a file, `~/.local/share/cc-smart-dev-kit/router-task.xml` (mode 644), and
`Register-ScheduledTask -Xml` registers the task **from it** — `gateway setup`,
`doctor` and `restore` all read that one file, as they read the unit files on Linux. The
port is written into the task's description: the router reads its port from `gateway.json`,
so nothing else in the definition would change when the port does and setup would never
restart the router on a moved port (on Linux the socket unit changes there).

Everything is PowerShell, never `schtasks`: `schtasks` prints localized words (a task is
"Ready" in one Windows language and "Bereit" in another), while `Get-ScheduledTask` answers
with Task Scheduler's own state names (`Running`, `Ready`, `Disabled`, `Queued`, `Unknown`)
and its result codes, which are the same on every Windows language. A `'` in a path is
quoted; a `"` or a control character is refused, as `checkUnitPath` refuses one for a unit
file.

The account the task runs as comes from `USERDOMAIN` / `USERNAME` in the environment; when
they are not there, Windows itself is asked once
(`[System.Security.Principal.WindowsIdentity]::GetCurrent().Name`) and the answer is kept.

## What Windows loses

The Linux design leans on the socket unit: systemd, not the router, holds
`127.0.0.1:<port>`, so a restart of the router refuses **no** request (proved live:
0 of 66 requests failed across a restart, `docs/gateway.md` § What was proved). There is no
per-user socket activation on Windows, so:

- **A restart refuses requests for a moment.** The task is stopped and started again; until
  the new router answers, a request gets "connection refused", which Claude Code retries.
  `TASK_RESTART_WARNING` says exactly that before the question — never the Linux sentence.
- **A stop cuts the answers in flight.** `Stop-ScheduledTask` terminates the process
  (`AllowHardTerminate`), so the router's SIGTERM drain never runs: an answer being
  streamed when the task is stopped ends there, and Claude Code retries. The limit state
  file is written atomically, so a cut never leaves it half-written.
- **There is no journal.** A task has no console, so the router's log goes nowhere;
  `doctor`'s hint is to stop the task and run `cc-smart-dev-kit gateway serve` in a
  terminal, and the task's own last result code is what doctor shows otherwise.
- **The router is not restarted at boot, only at logon.** That matches the Linux unit
  (`WantedBy=default.target`, which needs `loginctl enable-linger` to run at boot).
- **File modes do not exist.** The definition file is mode 644 like the units; the profile's
  ACL is what protects a file on Windows (`.claude/rules/setup-and-managed-files.md`).

This is the honest scope of the guarantee: on Windows "the gateway is up" means the task is
`Running`, and a restart is a short outage, not a wait in a queue.

## Commands

`gateway setup`, `on`, `off`, `status`, `serve`, `slot`, `models` are the same commands and
the same words; `setup` installs the task instead of the units. On a machine with neither
systemd nor PowerShell, `setup` still refuses with the existing message.

| Command | On Windows |
|---|---|
| `gateway setup [--yes]` | writes the copy and the task's definition, registers the task, then starts it (`Start-ScheduledTask`) and waits up to 5 s for the health page. A running router is restarted only after the yes, says `TASK_RESTART_WARNING` first, and the restart stops it, waits up to 5 s for its port to close, and starts it again |
| `gateway on` / `off` | unchanged: they change Claude Code's settings, which is the same on every platform |
| `gateway status` | unchanged: the health page over HTTP, the backends, the slots, the settings |
| `gateway serve` | unchanged: the router in a terminal (stop the task first, or the port is taken) |
| `doctor` | the task's state (`Running` / `Ready` / `Disabled` / `not registered`), the definition file, whether the registered task runs the router's copy, and the health page. When the router does not answer, the hint is `gateway serve`, not `journalctl` |
| `restore` | the task is stopped (`Stop-ScheduledTask`) and removed (`Unregister-ScheduledTask`) — an entry left behind would start the router at every logon — and the port is waited for, exactly as the two systemd units are stopped and disabled. The two stages (env keys first, then the router) are the same |
| `migrate` | unchanged: it only replaces a 0.2.x machine's **systemd units**, so on Windows it says to remove those files by hand, then run `gateway setup` |

`installRouter` is one flow for both platforms: refuse an old bun, ask the port
(another program there stops setup before anything is written), write the copy and the
service's definition, register/enable, start or restart, wait for the health page, and keep
the restart-pending marker when that never answers. `RouterService` is the driver — the
systemd one in `src/gateway/service.ts`, the Scheduled Task one in
`src/gateway/service-windows.ts` — and no other code branches on the platform.

The task is registered again only when it must be: `filesUnchanged` also asks whether the
**registered** task runs what setup writes (case-insensitively: Windows paths differ in case
between programs), so a task someone re-pointed by hand is repaired by the next `setup`
instead of being left stale.

## What is owed, live, on a Windows machine

Windows behaviour cannot be proved from Linux: a fake Task Scheduler and an injected
platform cover the logic (see the tests below), but these need a real Windows run
(research § 5.3, live test 13):

1. `gateway setup` registers the task without an elevation prompt, and the router answers
   `http://127.0.0.1:<port>/__cc-smart-dev-kit/health`.
2. The task appears in Task Scheduler as `cc-smart-dev-kit-router`, "Run only when user is
   logged on", no elevation, and starts the router at the next logon.
3. `Register-ScheduledTask -Xml` accepts the definition as written (element order,
   `PT0S`, `RestartOnFailure`), and `Get-ScheduledTask`'s state names come back in the
   words this code expects.
4. A restart: `gateway setup --yes` with a changed copy — the router is stopped, its port
   closes, it starts again, and Claude Code's retry covers the moment of refusal.
5. `Stop-ScheduledTask` really frees the port (a stopped router must not hold it), and it
   kills the whole process tree.
6. `doctor`'s lines on a real machine: a stopped task, a task someone removed, a task
   re-pointed by hand.
7. `restore --yes`: the task is gone from Task Scheduler and nothing starts at the next logon.
8. A machine where the account cannot be read from the environment (the PowerShell fallback).
9. A machine with **no PowerShell**: setup refuses (it is on PATH of every Windows 10/11).
10. A restart on a battery-powered laptop actually starts the task.

## The tests (all on Linux, with a fake machine)

- `src/gateway/commands.test.ts` § "the router as a Windows Scheduled Task": a fake
  `powershell` answers the task queries, logs each call, and reads the definition file back
  on `register` — so the action the driver sees is the one setup wrote. The first install
  (copy, definition, registration, start, health), nothing changed, a task that runs
  another program, the restart with and without a yes, the port still held after the stop,
  a router that never answers, `stop` for restore (running, ready, and no task at all), the
  definition text by hand, `renderTask`'s escapes and refusals, `parseTaskFacts`,
  `taskRunsCopy`, `routerServiceKind`, `windowsAccount`, and the account fallback.
- `src/cli/gateway-cli.test.ts` § "… gateway on Windows": `machine({ windows: true })` runs
  the real `gateway setup`, `gateway on`, `restore --yes` and `doctor` **in process**, with
  `service: "scheduled-task"` injected and the fake Task Scheduler as the runner — the
  printed lines, the definition file, the registration, the restore, and doctor's three
  Windows lines.
- Each of these was seen to fail before its change: with the platform mapping removed
  (`win32` → `none`), with the factory returning the systemd driver, and with the
  stop-and-wait before a restart removed.
