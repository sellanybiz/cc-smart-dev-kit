# Heavy jobs on Windows

`cc-smart-dev-kit job` works the same on native Windows: `job run` waits for a free slot (three
heavy jobs run at once by default), runs the job and gives the slot back; `job status` shows
how many slots are in use, who holds them and who waits; `job kinds` lists the kinds; `job set
max-jobs <n>` changes how many run at once. Three things work differently, because Windows has
no `/proc`, no memory groups and no signals. This page is those three things, what they cost,
and the live checks still owed on a Windows machine. The queue itself — the slots, the line, the
shared folders, the launch on Linux — is `jobs.md`.

## Memory

- The total is `os.totalmem()` and the free memory is `os.freemem()`: Windows reads both
  itself, and there is no cgroup to lower them. (`machineMemory`, `src/jobs/memory.ts`.)
- **The queue does not read the free memory.** It counts slots, so Windows' habit of counting
  its standby cache as used costs nothing here: it can no longer make a job wait longer than it
  must. (The crew's start gate still reads the free memory, and so it is a little cautious on
  Windows for the same reason.)
- **There is no ceiling.** On Linux all heavy jobs together run under one memory ceiling of
  their systemd slice. Windows has no memory group, so nothing caps the memory of a job or of
  all of them together: the slots are what keeps heavy jobs apart. Lower `maxJobs`
  (`cc-smart-dev-kit job set max-jobs 2`) on a machine that runs short.
- `job status` says plainly that there is no ceiling:

  ```text
  Memory: 31.9 GB.
  Memory ceiling for heavy jobs: none: Windows has no memory group, so a heavy job runs as a plain child, and the queue is what keeps heavy jobs apart.
  CPU priority: not set: only a Linux systemd user manager has weights.
  Disk I/O priority: not set: only a Linux systemd user manager has weights.
  This machine (~.localsharecc-smart-dev-kitjobs): 0 of 3 slots in use
    nothing held, nobody waits
  Heavy jobs at once on this machine: 3 (the default). Change it with: cc-smart-dev-kit job set max-jobs <n>
  ```

  A weight is a Linux slice setting, and Windows never has one (`jobs.md` § The launch).

## Leases: who holds a slot

A lease names its writer: a pid, that process's start time, the host name, the pid namespace
(`src/jobs/store.ts`). Linux and macOS read the start time from `/proc`, then from `ps`.
Windows has neither, so:

- **The start time comes from PowerShell**, one call per check:

  ```text
  (Get-Process -Id <pid> -ErrorAction Stop).StartTime.ToFileTimeUtc()
  ```

  That is the kernel's own creation time, in 100-nanosecond ticks since 1601, and the lease
  stores it as `win:<ticks>`. The same process reads the same text; another process that
  took the pid (the pid was reused) reads another, so **a reused pid is told from the
  holder**.
- **Liveness is `process.kill(pid, 0)`**, Node's existence test: it sends nothing, also on
  Windows, and throws when the process is gone. A dead holder's lease is freed at the next
  look, with no clean-up step, exactly as on Linux — no PowerShell call is needed for that.
  `processIsGone` reads only the code `ESRCH` as "gone"; any other error counts as alive
  (`EPERM`: another user's process), so the wait errs toward waiting, never toward running on
  top of a live holder. libuv's `uv_kill` returns `UV_ESRCH` for a pid that is gone, but
  that Bun's own `process.kill` throws that code on native Windows was not proved by reading.
  The Windows CI job proves it (`scripts/windows-hook-smoke.sh`, case 6: it ends a child,
  then checks the code Bun throws and `processIsGone` for it and for the running process); a
  different code fails that job, with the code in its message, before a release. It has not
  run on Windows yet — the first run is the proof.
- **Fail safe: a holder nobody can judge counts as alive.** A start time that cannot be read
  — no PowerShell on the machine, or a process it may not open — hands the recorded value
  back, so the holder counts as held and a waiting job keeps waiting. It never runs on top
  of a slot someone may still hold. A start time another system wrote (a lease Linux or
  macOS wrote) cannot be compared on Windows either: it counts as alive too.
- A pid reused inside one Windows clock tick (about 16 ms) could still look like the same
  process. That mistake makes a job wait, never run on top.
- **The folder's lock** (one job taking a slot at a time) is judged by the pid alone: a lock
  whose writer is gone is freed at the next look, and one whose writer died with its pid
  taken by another process is taken over 30 seconds after it was written (the age rule). The
  Linux and macOS path also reads that lock's start time; on Windows only a POSIX `ps` on
  PATH (Git Bash has one) gives it one.
- **The lease files are written whole, as on Linux**: a temp file beside the lease, then a
  rename. The folder comes from Windows' own path rules (a path separates with `\`), so the
  temp file lands in the leases folder and the lease is written where it belongs — the temp
  file of a lease used to be a name with no folder at all, and the write failed.
- Everything else is as on Linux: the files (their modes are harmless on Windows, where a
  mode only sets the read-only bit and the folder's access rights are what protects a file),
  the 5-second heartbeat, the 30-second rule for a writer this machine cannot judge, the
  shared folders, and the note for a file this user may not read.

## Running a job

- **No memory group, no kill mark, no CPU or I/O weight.** Windows has no cgroup and no
  `choom`, so a job runs as a plain child with its lease, the same as macOS. There is no
  slice to carry a ceiling or a weight, and `job status` says they are not set. The queue
  applies in full: the slots, the oldest-ticket line, the fair share, `--exclusive`.
- **No "killed for memory" line.** That line reads the heavy-job slice's `memory.events`,
  which only Linux has.
- **Stopping a job ends its process tree with `taskkill`.** Windows has no signals, so
  SIGINT, SIGTERM and SIGHUP all mean the same thing there:

  ```text
  taskkill /PID <job pid> /T /F
  ```

  That is what makes a person's Ctrl+C at `job run` end the job too: the job runs in a
  process group of its own (it has no console of its own), so it never sees the terminal's
  own Ctrl+C — `job run` gets it and ends the tree. Windows has no graceful stop: the job
  ends forcefully, and `job run` passes on the code its runtime reports for that end
  (128 + 9 in the tests). A `taskkill` that reports 128 ("no such process") has nothing to
  do: the job was already gone. Where `taskkill` cannot run at all, `job run` falls back to
  Node's own kill for the job's first process.
- **`job run` watches the job's first process** on Windows, not its whole process group: a
  worker the job leaves behind is not seen, so the slot is given back while it still runs.
  On Linux the group is watched instead. (Whether a worker can outlive `job run` at all
  there depends on how Bun ends a child it started: § Live checks, item 5.)
- **The route sends heavy commands to the Bash tool.** The `job-route` hook rewrites a heavy
  Bash line into `job run`, but it cannot rewrite a PowerShell one: the rewritten line is a
  `sh` line. So where the job route is on, a heavy PowerShell line (`bunx tsc --noEmit`) is
  refused, and the refusal names the Bash tool and the exact Bash line to run, which then
  waits for a slot (`jobs.md` § The route). It does this only when Git Bash is found — the
  same finder `doctor` uses, in Claude Code's own order (`CLAUDE_CODE_GIT_BASH_PATH`, then
  Git's install folders, then beside the `git` on PATH; `src/cli/git-bash.ts`) — because without Git Bash Claude Code has no
  Bash tool to send it to. A light or print-only PowerShell line, and every PowerShell line
  while the route is off, runs as written. A live check is owed (§ Live checks, item 7).
- **Nesting is found on Linux only** (`/proc`). On Windows a heavy job must not start
  another one through `cc-smart-dev-kit job run`: the inner one would queue for a slot its
  parent holds. Same as macOS.

## Limits

- No memory ceiling, no kill mark, no CPU or I/O weight, no "killed for memory" line: the
  slots are what keeps heavy jobs apart, and nothing caps one job's memory or its CPU share.
- A worker a job leaves behind is not seen when `job run` ends: its slot is given back
  while the worker runs.
- A holder whose start time cannot be read counts as alive, however long it runs: only its
  pid being gone frees its lease. If PowerShell cannot run on a machine at all, a lease is
  therefore kept until its process ends (a dead pid is still freed at once).
- The network file system check is Linux only (`statfs`, `/proc/self/mountinfo`): a shared
  folder on a mapped network drive or a UNC path is not left out the way an NFS or SMB mount
  is on Linux. A shared folder is for one host — keep it on a local disk.
- A pid reused inside one clock tick (about 16 ms) can look like the holder.
- `PowerShell` means Windows PowerShell 5.1 (`powershell.exe`), which ships with Windows 10
  (1809 or later) and Windows 11.

## Live checks owed on a Windows machine

None of these can be checked from Linux: they need one real Windows machine. Each is one
`job run` in a terminal, and the numbers to write down.

1. **Two sessions, one queue.** In one window:
   `cc-smart-dev-kit job run --kind tsc -- sh -c "sleep 120"`. In a second window:
   `cc-smart-dev-kit job run --kind tsc -- true`, and `cc-smart-dev-kit job status`.
   Expected: the second job waits, and its waiting line and `job status` name the first
   holder (host, kind, command, folder, since, pid). The first `job run`'s lease must count
   as held: a start time that came out wrong would free it at once and the second job would
   run on top. The lease file's `holder.startTime` is `win:<digits>`.
2. **`job status` wording.** Expected: the memory total near Task Manager's, the ceiling
   line from § Memory, the slots in use and the holders below, and the line that changes
   `maxJobs`. Also with a `jobs.json` that sets `maxJobs` (`cc-smart-dev-kit job set max-jobs 1`):
   then the second job in item 1 waits with "this machine's only slot is taken". The start-time call, by hand (it answers one number, the ticks):
   `powershell -NoProfile -Command "(Get-Process -Id $PID).StartTime.ToFileTimeUtc()"`.
3. **Staleness after a killed holder.** With the first job running, kill its `job run` with
   `taskkill /F /PID <the job run's pid>` (there is no SIGKILL on Windows). Expected: the
   lease is gone at the next `job status` or `job run` — at once, not 30 seconds later
   (its pid is dead), and the waiting job starts. Write down whether the job's own process
   (the `sleep`) survives it, and compare with item 5: `jobs.md` § Limits.
4. **Ctrl+C.** At a `job run` in Windows Terminal, PowerShell and Git Bash: Ctrl+C must end
   the job's tree (no `sleep`/`vitest` left in Task Manager), end `job run`, and free the
   lease. Write down the exit code `job run` reports. Also: Ctrl+C while the job waits
   (it should free its place in the line and end with 130).
5. **A worker left behind.** One `job run` with a job that starts a helper and ends:
   `cc-smart-dev-kit job run --kind tsc -- cmd /c "start /b ping -n 120 127.0.0.1 > NUL & exit"`.
   Expected on the current design: `job run` ends at once, the `ping` lives on, and the
   slot is given back while it runs (§ Running a job). Write down whether the `ping`
   really survives: if the child of a Bun process is ended with it, this limit does not
   exist and the page changes. A job that ends by itself must not print "the job left
   processes running": that line means its first process was still there after it ended,
   which on Windows should not happen.
6. **PowerShell blocked.** On a machine where `powershell.exe` cannot run (a policy, or a
   PATH without it): a running job's lease must count as held (a second job waits), and a
   killed job's lease must still be freed (its pid is dead). Expected: a job waits longer
   than it must, and no job ever runs on top of a live holder.
7. **A heavy PowerShell line with the route on.** In a project with `"jobs": { "route": true }`,
   ask a session to run `bunx tsc --noEmit` with the PowerShell tool. Expected: the call is
   refused, the reason names the Bash tool and the line `bunx tsc --noEmit`, and the session
   runs it again with the Bash tool, where it goes through `job run`. Then the same with
   `CLAUDE_CODE_GIT_BASH_PATH` pointing at no file and Git not installed: the PowerShell line
   runs as written. Write down the Claude Code version.
