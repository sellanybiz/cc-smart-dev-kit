# Heavy jobs on Windows

`cc-smart-dev-kit job` works the same on native Windows: `job run` waits for the memory a job
needs, runs it and gives the memory back; `job status` shows who holds and who waits;
`job kinds` lists the kinds. Three things work differently, because Windows has no `/proc`,
no memory groups and no signals. This page is those three things, what they cost, and the
live checks still owed on a Windows machine. The queue itself — the budgets, the line, the
shared folders, the launch on Linux — is `jobs.md`.

## Memory

- The total is `os.totalmem()` and the free memory is `os.freemem()`: Windows reads both
  itself, and there is no cgroup to lower them. (`machineMemory`, `src/jobs/memory.ts`.)
- **The budget rule is the same:** this machine's memory in whole GB less `reserveGb`
  (22 by default), and never less than the largest default job (14 GB), so that job can
  always run alone.
- **The live check is on.** A job waits while the real free memory, less what admitted jobs
  have not used yet, is below what it needs (and never when no other heavy job holds memory
  here, so a wait always ends). Windows counts its standby cache as used, so `os.freemem()`
  is lower than what the machine can really hand out: the live check then waits longer than
  it must. That is the safe side — a job waits, it never overruns.
- `job status` reads the free number and says plainly that there is no ceiling:

  ```text
  Memory: 31.9 GB, 11.2 GB free now.
  Budget for heavy jobs here: 14 GB (31 GB of memory less 22 GB kept for everything else).
  No memory ceiling on this system: Windows has no memory group, so a heavy job runs as a
  plain child, and the queue is what keeps heavy jobs apart.
  ```

## Leases: who holds memory

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
- **Fail safe: a holder nobody can judge counts as alive.** A start time that cannot be read
  — no PowerShell on the machine, or a process it may not open — hands the recorded value
  back, so the holder counts as held and a waiting job keeps waiting. It never runs on top
  of memory someone may still hold. A start time another system wrote (a lease Linux or
  macOS wrote) cannot be compared on Windows either: it counts as alive too.
- A pid reused inside one Windows clock tick (about 16 ms) could still look like the same
  process. That mistake makes a job wait, never run on top.
- **The folder's lock** (one job taking memory at a time) is judged by the pid alone: a lock
  whose writer is gone is freed at the next look, and one whose writer died with its pid
  taken by another process is taken over 30 seconds after it was written (the age rule). The
  Linux and macOS path also reads that lock's start time; on Windows only a POSIX `ps` on
  PATH (Git Bash has one) gives it one.
- Everything else is as on Linux: the files (their modes are harmless on Windows, where a
  mode only sets the read-only bit and the folder's access rights are what protects a file),
  the 5-second heartbeat, the 30-second rule for a writer this machine cannot judge, the
  shared folders, and the note for a file this user may not read.

## Running a job

- **No memory group and no kill mark.** Windows has no cgroup and no `choom`, so a job runs
  as a plain child with its lease, the same as macOS. The queue applies in full: the budget,
  the oldest-ticket line, the fair share, the live check, `--exclusive`.
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
  worker the job leaves behind is not seen, so the memory is given back while it still runs.
  On Linux the group is watched instead. (Whether a worker can outlive `job run` at all
  there depends on how Bun ends a child it started: § Live checks, item 5.)
- **Nesting is found on Linux only** (`/proc`). On Windows a heavy job must not start
  another one through `cc-smart-dev-kit job run`: the inner one would queue for memory its
  parent holds. Same as macOS.

## Limits

- No memory ceiling, no kill mark, no "killed for memory" line: the queue is what keeps
  heavy jobs apart, and nothing caps one job's memory.
- The live check uses Windows' free memory, which counts the standby cache as used: it can
  make a job wait longer than the machine needs.
- A worker a job leaves behind is not seen when `job run` ends: its memory is given back
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
2. **`job status` wording.** Expected: a real free number near Task Manager's, the budget
   line, the ceiling line from § Memory, and the holders below. Also with a `jobs.json` that
   sets `budgetGb`. The start-time call, by hand (it answers one number, the ticks):
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
   memory is given back while it runs (§ Running a job). Write down whether the `ping`
   really survives: if the child of a Bun process is ended with it, this limit does not
   exist and the page changes. A job that ends by itself must not print "the job left
   processes running": that line means its first process was still there after it ended,
   which on Windows should not happen.
6. **PowerShell blocked.** On a machine where `powershell.exe` cannot run (a policy, or a
   PATH without it): a running job's lease must count as held (a second job waits), and a
   killed job's lease must still be freed (its pid is dead). Expected: a job waits longer
   than it must, and no job ever runs on top of a live holder.
