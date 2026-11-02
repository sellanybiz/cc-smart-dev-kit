# Heavy jobs

One queue for the whole machine (`src/jobs/`, design and limits in `jobs.md`):

- `cc-smart-dev-kit job run --kind <kind> -- <command>` takes one slot, waits while every slot is
  taken, runs the job, and gives the slot back however it ends. **The queue counts jobs, not
  gigabytes**: up to `maxJobs` heavy jobs run at once (3 by default; the person's, machine-wide,
  `job set max-jobs <n>`), and a job has no size — one job alone may use all the memory and every
  core. A kind only says which commands are heavy; kinds are defaults a project can replace in its
  `cc-smart-dev-kit.json` (`jobs.kinds`), and its old size fields still parse and are ignored.
  A machine sets its limits in `~/.config/cc-smart-dev-kit/jobs.json`. `--exclusive <name>` (with a
  kind, or alone) also keeps a name to one job at a time: a lease that holds the name.
- **Two lanes** (D74): a light run — an install (the `install` kind) or a test run on at most
  10 named files — takes one of `lightJobs` light slots (2 by default) instead of a heavy one.
  Light slots are this machine's only; a shared folder counts heavy runs. The lanes never wait
  for each other, so a small run never sits behind a full one, and a burst of installs never
  takes the heavy slots. Why: until 1.8.0 a named-file run took no slot at all and installs were
  not counted, and many sessions running both at once froze a machine.
- **The job runs in a process group of its own**, so a signal reaches its workers too,
  and its slot is given back only once the group (and its systemd scope) is empty.
- **Leases are files, judged like the lock.** Each reservation is a small file naming
  its writer's pid and start time. A file whose writer is gone (a dead or reused pid) is
  stale and the next reader removes it, through the same `holderIsGone` as setup's lock.
  So nothing needs cleaning after a crash, and no native code (`flock`) is needed. A
  writer in another pid namespace (a container on the same host) keeps its files alive
  with a heartbeat. A shared folder is for one host: one clock, no network file system.
- **Two kinds of count,** this machine's slots and optional shared folders' (containers or
  users on one host, each with a `max-jobs` file), taken in a fixed order and given back in
  reverse, so they never wait on each other in a circle. Oldest first, fair share on shared
  folders (a person at half the slots steps aside for another who waits), and no give-up
  timeout.
- **Free memory** (D74): a job waits while the machine has less than `startFreeGb` free (4 GB by
  default), but only while another job of the queue runs here, whose end frees memory. With
  none running it starts: the memory belongs to what never queues, so waiting could last for
  ever. Where there is no free-memory reading (macOS), it holds nothing.
- **The launch** puts a job in its own systemd memory group with a kill mark, and the heavy
  slice has one **memory ceiling for all heavy jobs together** (the machine's memory less
  `reserveGb`), so they can never take the memory kept for the desktop and the sessions and a
  job over it dies inside the slice. A light run gets the kill mark alone, never the heavy
  slice, whose ceiling is for heavy runs. Linux CPU defaults to `idle`, yielding to other work;
  older systemd versions that refuse idle use weight 10. The first refusal is recorded in
  machine-local jobs state: later slices and jobs use 10 without another warning or idle attempt.
  Weights apply only to the default chain's names and the exact configured slice, never a
  foreign parent such as `app.slice`. `cpuWeight` also accepts a number or `off`; off reads
  the current weight and resets it only when it is not already 100 or unset (or the read fails).
  Disk I/O stays off unless `ioWeight` is set. A weight needs its controller delegated to the user manager; one
  that is missing is skipped and `job status` says why.
- **Mixed versions** during an update: every live lease counts as one slot whatever an older
  `job run` wrote in its record (it wrote its GB in the `gb` field; the new one writes 1 for a
  slot and 0 for a name, so the older reader still parses it). From 1.8.0 a record also carries
  its lane; an older reader counts a light run as a heavy slot, so it waits more, never less.
  `docs/jobs.md` § Mixed versions.
- **The state is per user** (`~/.local/share/cc-smart-dev-kit/jobs/`): nothing in it outlives
  its writers, and no service runs.
- A pure classifier (`classifyHeavyCommand`) says which kind a Bash command runs; a later
  hook routes heavy commands through `job run`. It reads a project's `package.json` through
  an injected reader, only to tell a script from the tool of the same name (`docs/jobs.md`
  § The classifier).
