# Heavy jobs on Windows

Windows uses the same fixed machine-wide limit: one heavy run at a time. A run on named
files skips the queue. There is no memory reading, CPU or I/O weight, systemd slice, shared
folder, light lane or machine queue setting. **There are no CPU or memory limits on Windows**:
the caps (`job set cpu`, `job set memory`) need Linux with a systemd user manager (`jobs.md`
§ CPU and memory limits), and a Windows job runs without them, with no line and no `doctor`
warning, only an information line. `job run`, `job status` and `job kinds` work as on
Linux (`jobs.md`). Two things work differently, because Windows has no `/proc` and no signals:
who holds a lease, and how a job's tree is ended. This page is those two things, what they
cost, and the live checks still owed on a Windows machine.

## Leases: who holds the slot

A lease names its writer: a pid, that process's start time, the host name, the pid namespace
(`src/jobs/store.ts`). Linux and macOS read the start time from `/proc`, then from `ps`.
Windows has neither, so (`src/jobs/windows.ts`):

- **The start time comes from PowerShell**, one call per check:

  ```text
  (Get-Process -Id <pid> -ErrorAction Stop).StartTime.ToFileTimeUtc()
  ```

  That is the kernel's own creation time, in 100-nanosecond ticks since 1601, and the lease
  stores it as `win:<ticks>`. The same process reads the same text; another process that took
  the pid (the pid was reused) reads another, so **a reused pid is told from the holder**.
- **Liveness is `process.kill(pid, 0)`**, Node's existence test: it sends nothing, also on
  Windows, and throws when the process is gone. A dead holder's lease is freed at the next look,
  with no clean-up step, exactly as on Linux — no PowerShell call is needed for that.
  `processIsGone` reads only the code `ESRCH` as "gone"; any other error counts as alive
  (`EPERM`: another user's process), so the wait errs toward waiting, never toward running on
  top of a live holder. The Windows CI job proves the code Bun throws
  (`scripts/windows-hook-smoke.sh`, case 6: it ends a child, then checks the code and
  `processIsGone` for it and for the running process); a different code fails that job before a
  release.
- **Fail safe: a holder nobody can judge counts as alive.** A start time that cannot be read —
  no PowerShell on the machine, or a process it may not open — hands the recorded value back,
  so the holder counts as held and a waiting job keeps waiting. It never runs on top of a slot
  someone may still hold. A start time another system wrote (a lease Linux or macOS wrote)
  cannot be compared on Windows either: it counts as alive too.
- A pid reused inside one Windows clock tick (about 16 ms) could still look like the same
  process. That mistake makes a job wait, never run on top.
- **The folder's lock** (one job taking the slot at a time) is judged by the pid alone: a lock
  whose writer is gone is freed at the next look, and one whose writer died with its pid taken by
  another process is taken over 30 seconds after it was written (the age rule).
- **The lease files are written whole, as on Linux**: a temp file beside the lease, then a
  rename. The folder comes from Windows' own path rules (a path separates with `\`), so the temp
  file lands in the leases folder.
- Everything else is as on Linux: the files (their modes are harmless on Windows, where a mode
  only sets the read-only bit and the folder's access rights protect a file), the 5-second
  heartbeat and the 30-second rule for a writer this machine cannot judge.

Every PowerShell or `taskkill` call gives up after 10 seconds, so a call that does not answer
never hangs `job status`, a job's wait, or a stop.

## Running a job

- **A plain child.** Windows has no cgroup, so a job runs as a plain child with its lease, the
  same as macOS. The queue applies in full: the slot, the oldest-ticket line, `--exclusive`.
- **Stopping a job ends its process tree with `taskkill`.** Windows has no signals, so SIGINT,
  SIGTERM and SIGHUP all mean the same thing there:

  ```text
  taskkill /PID <job pid> /T /F
  ```

  That is what makes a person's Ctrl+C at `job run` end the job too: the job runs in a process
  group of its own (it has no console of its own), so it never sees the terminal's own Ctrl+C —
  `job run` gets it and ends the tree. Windows has no graceful stop: the job ends forcefully, and
  `job run` passes on the code its runtime reports for that end. A `taskkill` that reports 128
  ("no such process") has nothing to do: the job was already gone. Where `taskkill` cannot run at
  all, `job run` falls back to Node's own kill for the job's first process.
- **`job run` watches the job's first process** on Windows, not its whole process group: a
  worker the job leaves behind is not seen, so the slot is given back while it still runs. On
  Linux the group is watched instead.
- **The route sends heavy commands to the Bash tool.** The `job-route` hook rewrites a heavy Bash
  line into `job run`, but it cannot rewrite a PowerShell one: the rewritten line is a `sh` line.
  So where the job route is on, a heavy PowerShell line (`bunx tsc --noEmit`) is refused, and the
  refusal names the Bash tool and the exact Bash line to run, which then waits for the slot
  (`jobs.md` § The route). It does this only when Git Bash is found — the same finder `doctor`
  uses, in Claude Code's own order (`CLAUDE_CODE_GIT_BASH_PATH`, then Git's install folders, then
  beside the `git` on PATH; `src/cli/git-bash.ts`) — because without Git Bash Claude Code has no
  Bash tool to send it to. A light or print-only PowerShell line, and every PowerShell line while
  the route is off, runs as written.
- **Nesting is found on Linux only** (`/proc`). On Windows a heavy job must not start another one
  through `cc-smart-dev-kit job run`: the inner one would queue for the slot its parent holds.
  Same as macOS.

## Limits

- Nothing caps one job's memory or its CPU share: the slot is what keeps heavy jobs apart.
- A worker a job leaves behind is not seen when `job run` ends: its slot is given back while the
  worker runs.
- A holder whose start time cannot be read counts as alive, however long it runs: only its pid
  being gone frees its lease. If PowerShell cannot run on a machine at all, a lease is therefore
  kept until its process ends (a dead pid is still freed at once).
- A pid reused inside one clock tick (about 16 ms) can look like the holder.
- A git hook never waits for the slot on native Windows: the route gives `git commit`, `git merge`
  and `git push` no git hooks prefix there yet, so the repo's own hooks run as they always did
  (`jobs.md` § Git hooks). The hooks folder's scripts are `sh` scripts, still unproved through Git
  for Windows' `sh`.
- `PowerShell` means Windows PowerShell 5.1 (`powershell.exe`), which ships with Windows 10 (1809
  or later) and Windows 11.

## Live checks still owed

On native Windows, prove two full runs serialize, a targeted file run bypasses the queue,
a killed owner is recovered safely, cancellation reaches children, and stdout, stderr and
exit codes pass through. A Linux test is not proof of Windows process behavior. None of these
can be checked from Linux: each is one `job run` in a terminal, and the numbers to write down.

1. **Two sessions, one queue.** In one window:
   `cc-smart-dev-kit job run --kind tsc -- sh -c "sleep 120"`. In a second window:
   `cc-smart-dev-kit job run --kind tsc -- true`, and `cc-smart-dev-kit job status`. Expected:
   the second job waits with "this machine's only slot is taken", and its waiting line and
   `job status` name the first holder (host, kind, command, folder, since, pid). The lease file's
   `holder.startTime` is `win:<digits>`. The start-time call, by hand (it answers one number):
   `powershell -NoProfile -Command "(Get-Process -Id $PID).StartTime.ToFileTimeUtc()"`.
2. **A targeted run.** With the first job of item 1 running,
   `cc-smart-dev-kit job run --kind test:run -- bunx vitest run src/a.test.ts` (a file that
   exists) starts at once.
3. **Staleness after a killed holder.** With the first job running, kill its `job run` with
   `taskkill /F /PID <the job run's pid>`. Expected: the lease is gone at the next `job status`
   or `job run` — at once, not 30 seconds later (its pid is dead), and the waiting job starts.
   Write down whether the job's own process (the `sleep`) survives it.
4. **Ctrl+C.** At a `job run` in Windows Terminal, PowerShell and Git Bash: Ctrl+C must end the
   job's tree (no `sleep`/`vitest` left in Task Manager), end `job run`, and free the lease.
   Write down the exit code `job run` reports. Also: Ctrl+C while the job waits (it should free
   its place in the line and end with 130).
5. **A worker left behind.** One `job run` with a job that starts a helper and ends:
   `cc-smart-dev-kit job run --kind tsc -- cmd /c "start /b ping -n 120 127.0.0.1 > NUL & exit"`.
   Expected on the current design: `job run` ends at once, the `ping` lives on, and the slot is
   given back while it runs (§ Running a job). Write down whether the `ping` really survives: if
   the child of a Bun process is ended with it, this limit does not exist and the page changes.
6. **PowerShell blocked.** On a machine where `powershell.exe` cannot run (a policy, or a PATH
   without it): a running job's lease must count as held (a second job waits), and a killed job's
   lease must still be freed (its pid is dead).
7. **A heavy PowerShell line with the route on.** In a project with `"jobs": { "route": true }`,
   ask a session to run `bunx tsc --noEmit` with the PowerShell tool. Expected: the call is
   refused, the reason names the Bash tool and the line `bunx tsc --noEmit`, and the session runs
   it again with the Bash tool, where it goes through `job run`. Then the same with
   `CLAUDE_CODE_GIT_BASH_PATH` pointing at no file and Git not installed: the PowerShell line runs
   as written. Write down the Claude Code version.
8. **Output.** stdout, stderr and the exit code of a failing job (`cmd /c exit 3`) pass through
   `job run` unchanged.

See [Heavy jobs](jobs.md) and [Windows setup](windows-setup.md).
