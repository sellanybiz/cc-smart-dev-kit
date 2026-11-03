# Heavy jobs

`src/jobs/` owns one machine-wide slot for a heavy run. A project's `jobs.kinds` classifies
heavy commands. A run on named files bypasses the queue. The limit is fixed: no setting,
resource estimate, second lane or shared-folder coordination.

`job run` waits in ticket order, acquires the slot, starts the command and returns its exit
code. The lease covers the child process group until the run ends. Signals reach the
children. Stale owners can be recovered after a crash; an owner that cannot be proved gone
keeps its lease. The hook only rewrites the call through this API, never runs a heavy job.

- **`--exclusive <name>`** (with a kind, or alone) also keeps a name to one job at a time: a
  lease that holds the name, and nothing more when the job takes no slot.
- **Leases are files, judged like the lock.** Each lease and ticket is a small file naming its
  writer's pid, its start time and its pid namespace. A file whose writer is gone (a dead or
  reused pid) is stale and the next reader removes it, through the same `holderIsGone` as
  setup's lock (`src/setup/lock.ts`). So nothing needs cleaning after a crash, and no native
  code (`flock`) is needed. A writer in another pid namespace (a container on the same host)
  keeps its files alive with a heartbeat (`HEARTBEAT_MS`, `src/jobs/store.ts`).
- **Mixed versions** during an update: every live lease counts as one slot whatever an older
  `job run` wrote in its record (its `gb` field), so an older writer is never overtaken.
  `docs/jobs.md` § Mixed versions.
- **The state is per user** (`~/.local/share/cc-smart-dev-kit/jobs/`): nothing in it outlives
  its writers, and no service runs.
- **A pure classifier** (`classifyHeavyCommand`, `src/jobs/classify.ts`) says which kind a
  shell command runs; the `job-route` hook routes heavy commands through `job run`. It reads a
  project's `package.json` through an injected reader, only to tell a script from the tool of
  the same name (`docs/jobs.md` § The classifier).

`job status`, `/api/jobs` and the portal share the same status reader. The queue stores live
state, not project settings. Old machine `jobs.json` settings are ignored since 2.0.

The queue does not read memory, set CPU or I/O weights, create systemd slices, run `choom`,
use shared folders or maintain a light lane. One job may still use all the machine's resources.

Commands, configuration and limits: [Heavy jobs](../jobs.md).
