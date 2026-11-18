# Heavy jobs

`src/jobs/` owns the machine's heavy-job slots, one by default. A project's `jobs.kinds`
classifies heavy commands. A run on named files bypasses the queue. `config.ts` owns the
new `heavy-jobs.json` file, its `maxConcurrent` schema (1–8) and the default. It never reads
legacy `jobs.json` as configuration. No resource estimate, second lane or shared-folder coordination.

`job set max <n>` writes through setup's managed JSON writer under the setup lock, so backups,
atomic writes, ownership and restore work as for other managed keys. Status and doctor show the
value and its source. The shared store note carries that source to the existing Machine page.

Each acquisition counts live leases and reads the limit under the same store lock before writing
its own lease. Concurrent takers cannot exceed it. Waiting jobs reread it, so a raised limit
needs no restart. Lowering the limit leaves existing leases alone and blocks new heavy jobs until
the count falls below it. Stale-process recovery is unchanged. Invalid new settings fail closed.
The default stays 1: competing full suites starved each other, timed out, then passed alone,
causing false failures. The upper bound limits accidental fan-out, not machine resources.

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

- **One judge says how heavy a run is** (`runWeight`, `src/jobs/classify.ts`): light, heavy or none.
  The route and `job run` both ask it, so a line is judged the same where it is routed and where
  it runs. Light needs a positive finding (every heavy command only prints or names existing
  files, and the reader understands every other command); a watch run and a line that queues
  itself are none. Each tool (vitest, jest, `bun test`, tsc) has its own option table in
  `src/jobs/kinds.ts`, and a package script is read by its body. The classifier stays pure: the
  scripts and the files come in through injected readers (`weight-source.ts`).
  `docs/jobs.md` § Kinds, § The classifier.
- **Git hooks go through a folder the kit owns** (`src/jobs/hook-folder.ts`,
  `src/jobs/git-hooks.ts`). A routed `git commit`, `git merge` or `git push` whose own hook is
  heavy gets three `GIT_CONFIG_*` assignments in front of the git word, pointing `core.hooksPath`
  at `<dataDir>/git-hooks/` for that one command. It is a prefix, not a wrapper, so the person's
  own deny and ask rules still read the `git` line. One `sh` script, under every hook name, asks
  `job hook <name>` (`direct` or `queue <kind>`) and either runs the real hook or runs it inside
  `job run --hook`. Every doubt, and every failure of the kit, runs the hook as it is: the kit
  never blocks a commit. `setup` writes the folder, a session start of a new version rewrites it
  in place, `restore` removes it. `docs/jobs.md` § Git hooks.

`job status`, `/api/jobs` and the portal share the same status reader. The queue stores live
state, not project settings. Old machine `jobs.json` settings are ignored since 2.0.

The queue does not read memory, set CPU or I/O weights, create systemd slices, run `choom`,
use shared folders or maintain a light lane. One job may still use all the machine's resources.

Commands, configuration and limits: [Heavy jobs](../jobs.md).
