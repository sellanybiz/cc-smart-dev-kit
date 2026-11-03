# Heavy jobs

One heavy run at a time per machine. There is no concurrency setting. Small runs on named
files bypass the queue, so a targeted check need not wait behind a full build.

A **heavy job** is a command that can use many gigabytes: a TypeScript type check, a
type-aware lint, a test run, a production build, a container image build. When many Claude
sessions and their agents run on one machine, they start these at the same time. The machine
runs out of memory, and the kernel kills what it picks: often the desktop, and every session
with it. A rule like "one heavy job at a time" in each session does not help: nothing limits
heavy jobs **across** sessions, agents and people. So each heavy job runs through
`cc-smart-dev-kit job run`, and the next one waits for the slot.

The same queue runs on native Windows, where a lease's start time and how a job's tree is
ended differ: [Windows](windows-jobs.md).

## Commands

```sh
cc-smart-dev-kit job run --kind test:run -- bun test
cc-smart-dev-kit job run --kind image:build --exclusive image -- docker buildx build .
cc-smart-dev-kit job status
cc-smart-dev-kit job kinds
```

| Command | What it does |
|---|---|
| `job run [--kind <kind>] [--exclusive <name>] -- <command…>` | Waits for the machine's one slot, runs the command, and gives the slot back when it ends. The command keeps its stdin, stdout, stderr and exit code, and signals reach its child processes too. `--kind`, `--exclusive`, or both. |
| `job status` | Who holds the slot and who waits, and the job route for the folder it runs in: on or off, and whether the project, your own `switches.jobRoute` or the default decided. Stale files it finds are removed. Its lines and the portal's `/api/jobs` come from one reader (`src/jobs/status.ts`), so the queue has one shape and no printed line is parsed again. |
| `job kinds` | Every kind: where it comes from (`default` or `project`) and its `about` line. Not its match rules: those are in `cc-smart-dev-kit.json` and § Kinds. |

## How a job runs

1. **Narrow runs go at once.** A run that only prints (`tsc --version`) or a test run on named
   files (§ Kinds) takes no slot and never opens the queue, unless it has `--exclusive`.
2. **Nesting.** A heavy job may start another one (a script that runs the type check, then the
   build). The inner one must not wait for a slot its parent holds. So `job run` walks its
   parent processes (`/proc/<pid>/stat`) and, when one of them holds a lease on this machine,
   runs its command directly. Linux only. An inner job with `--exclusive` still takes its name,
   unless an ancestor holds that name already (§ One job per name).
3. **Take the slot.** A job with a kind takes the one slot, and waits until it is free
   (§ Waiting). A job with a name only (`--exclusive` without `--kind`) takes no slot.
4. **Run.** The job starts in a process group of its own (§ The job's own process group).
5. **End.** `job run` ends with the job's exit code: the code itself, 128 + n for a job killed
   by signal n, 127 when the command cannot start, 2 for a wrong `job run` command line or a
   config it cannot use (`cc-smart-dev-kit.json`, a state folder it cannot make): then the job
   never starts. The slot is given back however the job ends, once no process of the job is
   left.

## What a job prints

The job's output is the job's: stdout and stderr are passed through untouched, so anything
`job run` itself has to say goes to stderr, each line prefixed `[cc-smart-dev-kit job]`. A job
that never waits prints none of the lines below: a free machine gets no noise.

```text
[cc-smart-dev-kit job] Heavy job waits for a free slot: bunx tsc --noEmit. Why: this machine's only slot is taken.
[cc-smart-dev-kit job] A pipe (| tail) hides this job's exit status: the "Heavy job ended" line carries it.
[cc-smart-dev-kit job]   this machine: a heavy slot is held by host-a: build, bun run build in /home/user/app, since 11:44 (pid 4242)
   … a line a minute while it waits …
[cc-smart-dev-kit job] Heavy job starts after 18 min: bunx tsc --noEmit
   … the job's own output, on stdout and stderr, while it runs …
[cc-smart-dev-kit job] Heavy job ended: bunx tsc --noEmit, exit 0 after 3 min
```

- **The waiting line**, once when the wait starts and then every minute, with why it waits
  and who holds the slot (person, kind, command, folder, since when, pid). **The first one
  carries the pipe hint**, once per job: a job whose output goes down a pipe (`| tail`)
  reports the pipe's own status, so the hint points at the end line, which holds the job's own.
- **The start line** says the wait is over, and how long it took.
- **The end line** says how the job ended, and how long it ran. A job a signal stops **while it
  waits** never starts, so it gets neither this line nor the start line.
  - `exit 0` is the job's own exit code — the one a pipe hides. A job a signal ended says
    `stopped by SIGTERM` instead, and `job run` itself exits with 128 + that signal's number.
  - `stopped by SIGTERM (sent on by job run)`: the signal `job run` caught (a Ctrl+C at it, or
    a `kill` at it) is also the one that ended the job. A signal from somewhere else — the
    kernel's OOM killer, another process's `kill` — is named without a sender.
  - `(its leftover processes were stopped)`: the job's own process was gone, but processes it
    left behind had to be stopped, so its slot was freed by force.

## Kinds

A kind only says **which commands the queue counts**. It has no size.

| Kind | Finds | Takes no slot with |
|---|---|---|
| `tsc` | `tsc`, `tsgo`, `vue-tsc` | `--version`, `--help`, `--listFilesOnly`, `--showConfig`, `-v`, `-h`. |
| `lint:typed` | `eslint` with a typed config (an argument holds `typed.` or `type-checked`), `oxlint --type-aware` | `--help`, `--version`, `-h`, `-v`. |
| `test:coverage` | `vitest` / `jest` with `--coverage` | `--help`, `--version`, `-h`, `-v`. |
| `test:run` | `vitest`, `jest` | `--help`, `--version`, `-h`, `-v`; a run on named files. |
| `build` | `next build` | none. |
| `image:build` | `docker build`, `docker buildx build`, `docker compose build`, `podman build`, `buildah build` and their other build forms | none. |

When one command matches two kinds (`vitest --coverage` is a coverage run and a test run), the
**first kind listed wins**: the table is the order, with the specific kind before the general
one, and a project's own kinds come after the defaults. Several heavy commands in one line are
named by the **first** one the line runs. `job run` adds nothing to a command: a test runner
gets no `--maxWorkers`, so with the slot it uses what it would use outside the queue.

**A project's own kinds.** `.claude/cc-smart-dev-kit.json` can replace a kind or add one:

```json
{
  "requires": ">=0.3",
  "jobs": {
    "kinds": {
      "tsc": { "printOnly": ["--version", "--help"], "match": [{ "tool": "tsc" }] },
      "e2e": { "about": "Browser tests.", "match": [{ "script": "test:e2e" }] }
    }
  }
}
```

A project kind with a default's name replaces that kind **whole**: what it says is all there
is. The fields:

| Field | Meaning |
|---|---|
| `printOnly` | Options that only print and stop: a run with any of them takes no slot. |
| `match` | How the classifier finds the kind (§ The classifier): `{ "tool", "sub", "flags", "argIncludes", "valued" }` or `{ "script" }`. |
| `about` | One line for `job kinds`. |
| `noSlotForFiles` | `true`: a run whose operands are all existing files, at most 10 of them (`vitest run src/a.test.ts`), runs at once with no slot. A run with no operand, or with one that is not a file (a folder, a pattern, a name filter), is a full run and waits. So does a run with an option the reader does not know, written without `=`: its next word may be its value, a file or not. A named file is still a filter to the runner: vitest reads each word as a part of a path and jest as a regular expression, so `vitest run a.test.ts` also runs `data.test.ts`. A full path (`src/a.test.ts`) keeps the run narrow. Came with 1.5.0: a project that sets it raises `requires` to `>=1.5`. |
| `skipWords` | With `noSlotForFiles`: the words after the tool that are a subcommand, not an operand (`run` in `vitest run`). |
| `valuedFlags` | With `noSlotForFiles`: the options whose value is the next word (`--config x.ts`, `-t name`), over vitest's and jest's own list, so that value is not read as an operand. |

The default `test:run` kind sets `noSlotForFiles`, with `run` as its skip word. `test:coverage`
does not: a coverage run instruments and reports on the whole project whatever files it names.
For a `script` kind, the operands are the words after the script's name (`bun run test
src/a.test.ts`). Each operand is checked against the folder the job runs in.

**Old fields.** A project file written for an older plugin may still set `gb`, `filesGb`,
`maxFiles`, `workers` or `light` on a kind (`IGNORED_KIND_FIELDS`, `src/jobs/kinds.ts`). They
still parse, so the file keeps working, and the queue ignores every one of them. `doctor` says
once, in the project's lines, that they can go. The project's file cannot set how many jobs
run at once: the slot is the machine's, and there is one.

## The route: `job-route`

A heavy command typed by hand runs raw. It can be sent through the queue instead, and that is
the `switches.jobRoute` switch. Where it is set, and which one wins:

1. **The project**, when its `.claude/cc-smart-dev-kit.json` has `"jobs": { "route": true }`
   (or `false`: the project turns it off for itself). The project's value wins, as every other
   workflow setting does.
2. **The person's machine-wide default**, in their own `~/.config/cc-smart-dev-kit/workflow.json`
   as `"switches": { "jobRoute": true }`. Set it with
   `cc-smart-dev-kit workflow set switches.jobRoute true` (or `false`), without `--project`.
3. **Off.** Until someone says on.

`cc-smart-dev-kit workflow show` prints the value and where it came from. The hook reads it
through the one resolver (`resolveJobRoute`, `src/workflow/resolve.ts`), never a reader of its
own; a personal file that cannot be read leaves the project's value and the default standing.

When it is on, the plugin's `job-route` hook (PreToolUse on Bash; `src/hooks/job-route.ts`)
rewrites the call to

    "$HOME/.local/bin/cc-smart-dev-kit" job run --kind <kind> -- <command>

through the hook's `updatedInput` — byte for byte the same command, in the same folder — so
the slot and the waiting line come out the same as a person's own `job run`. One plain command
goes in as its own argv words (`bunx vitest run src/a.test.ts`); anything else (a pipe, `&&`, a
glob, an expansion) through the **person's own shell** (`<shell> -c '<the line>'`: `$SHELL` when
it is bash or zsh, else `bash` where the machine has it, else `sh` — never `/bin/sh`, which is
dash on Debian and Ubuntu, and cannot read bash syntax). A command already inside
`cc-smart-dev-kit job run` is left alone. Outside git there is no project, so a heavy command
there runs raw. The hook's other part, the launch judge, is always on:
`docs/design/hooks.md` § The Bash judge and the job route.

**Only a line whose every command is heavy, a `cd` or an assignment is queued**
(`classifyRoutableLine` in `src/jobs/classify.ts`); any other line runs raw. Claude Code
matches a person's own Bash rules (`deny`, `ask`) against the words of the command it is about
to run and does not look inside `bash -c '…'`, so a rewritten `tsc && rm -f x` would hide its
`rm` from a `Bash(rm:*)` rule (proved on 2.1.308, `claude-code-contract.md`). So a line that runs
anything else (`echo`, `rm`, a shell keyword with a non-heavy body, a substitution, or a runner —
`find`, `watch`, `su`, `parallel`, which do work of their own beside the command they run)
stays as written, and the person's rules see it. A line of heavy commands only — `cd app &&
bunx tsc --noEmit && bunx vitest run` — is queued as one job under the first kind it runs: one
slot for the whole line.

**One heavy command piped into read-only filters is queued too** (`routableLine`): `bunx tsc
--noEmit 2>&1 | tail -20` becomes `… job run --kind tsc -- <shell> -c 'bunx tsc --noEmit 2>&1'
| tail -20`. The filters stay **outside** the wrapper, as plain words of the line, so the
person's own Bash rules still see every one of them. A filter is one of `tail`, `head`, `grep`
(`egrep`, `fgrep`), `rg`, `wc`, `cut`, `tr`, `uniq`, `sort`, `cat` (with no file), `tee` (with no
file but `/dev/null`), and `sed` or `awk` with a script that only prints. Anything else after
the pipe — a filter with an option that writes, a second heavy command, a filter **before** the
heavy one (`cat x | tsc`), `|&`, a group in parentheses — keeps the whole line raw. The exit
code is the pipeline's own, exactly as without the queue.

**A heavy PowerShell line is refused while the route is on.** The rewritten line is a `sh` line
the PowerShell tool cannot run, so a heavy command run there would not wait for the slot. The
hook denies it and names the Bash tool with the exact Bash line to run when the line is one
plain command. It does so only where the Bash tool can exist — always off Windows, and on
Windows only when Git Bash is found (`src/cli/git-bash.ts`). A light PowerShell line, a
print-only one, and every PowerShell line with the route off are left as written.

**The folder.** The rewritten command runs in the Bash tool's own shell, so it starts in the
folder that shell is in. A `cd` **inside** the command lives only for that command.

## One job per name: `--exclusive`

Some jobs must not run twice at once even when no slot is involved: two container image builds
that share one build cache, a deploy. `--exclusive <name>` keeps a name to one job:

```sh
cc-smart-dev-kit job run --kind image:build --exclusive image -- docker buildx build .
cc-smart-dev-kit job run --exclusive deploy -- ./deploy.sh
```

- **With a kind, or alone.** `--kind` and `--exclusive` combine: the job needs the slot and the
  name. `--exclusive` alone takes no slot. One of the two is required.
- **In order.** The name is held by a lease, like the slot. Waiting jobs with the same name go
  oldest first. A job that waits for a name someone holds does not hold up jobs that need only
  the slot; a name-only job never waits behind jobs that wait for the slot.
- **Nested.** A job inside a heavy job that holds the name runs directly. One inside a heavy job
  that does not hold it takes the name as soon as nobody holds it, without a place in the line:
  in the line, it could wait behind a job that waits for the slot its own parent holds, and
  neither would move.
- A name is a word: letters, digits, `.`, `_`, `:`, `-`, at most 64 characters.

## Waiting

A waiting job looks again every half second:

- **Oldest first.** A waiting job holds a ticket with its start time. Only the oldest live
  ticket may take the slot, so no job is starved by a stream of newer ones.
- **No give-up timeout.** Running anyway after a while is the crash again. A waiting job says so
  at once, then every minute (§ What a job prints). A holder that holds only a name is listed as
  `a name is held by` and uses no slot.

## Mixed versions during an update

During an update an older `job run` may still hold a lease while the new one starts. Both read
the same files, so:

- **The new `job run` counts every live lease as one slot**, whatever the record says it
  reserved: the lease of an older run that held gigabytes takes the slot. A lease that holds a
  name alone (a record number of 0) takes none.
- **The new `job run` writes `1` in the old `gb` field for a job that holds the slot, and `0`
  for a name alone.** An older `job run` that reads those records sees a small holder and goes
  on counting by its own settings, so while both run, an older one may start a job beside the
  new one's. The mix lasts until the older runs end.
- **The state files keep their names and shapes** (`leases/`, `tickets/`, `lock`), so nothing
  needs moving.

## Where the state lives

```text
~/.local/share/cc-smart-dev-kit/jobs/leases/<token>.json    a job holds the slot (or only a name)
~/.local/share/cc-smart-dev-kit/jobs/tickets/<token>.json   a job waits for its turn
~/.local/share/cc-smart-dev-kit/jobs/lock                   held for a moment while a job takes the slot
```

- **The folder is per user.** Separate users on one machine do not see each other's jobs.
- **Each file names its writer:** the pid, that process's start time, the host name and the pid
  namespace. The record inside (who, what, where, since) is data for the waiting lines, read as
  untrusted text; one that does not parse is "unknown". On Windows the start time comes from
  PowerShell (`windows-jobs.md`).
- **Stale files clean themselves up.** A file is stale when its writer is gone: its pid is dead,
  or alive with another start time (the pid was reused). This is the same judge as setup's lock
  (`holderIsGone` in `src/setup/lock.ts`). A stale file counts for nothing, and the next look
  removes it. So a `job run` killed with SIGKILL frees its slot at the next look, with no
  clean-up step. An owner that cannot be proved gone keeps its lease.
- **A writer this machine cannot see** (another pid namespace: a container on this host that
  shares the folder) cannot be judged by its pid. It touches its files every 5 seconds (the
  heartbeat); a file not touched for 30 seconds is stale.
- **Taking the slot** happens under the folder's lock (the same `withLock` as setup), so two jobs
  never both take it.
- **Every file is written whole** (a temp file, then a rename). A temp file a crashed writer
  left is removed by a look once it is a minute old.

## The job's own process group

- **Signals.** The job starts in a process group (a session) of its own, so `job run` can signal
  all of it: a test runner's workers and a build's helpers too, not only the first process.
  SIGINT, SIGTERM and SIGHUP are sent on, each once: in its own session the job no longer gets
  a terminal's Ctrl+C itself, so `job run` sends it on, and a test runner never sees a second
  one ("force quit").
- **Leftovers.** The slot is given back only once the group is empty: a worker that lives on
  after the job's first process ended still uses memory. Leftovers get 2 seconds to end by
  themselves, then SIGTERM, then (5 seconds later) SIGKILL, and `job run` says so. It never
  hangs on them: when some still run 5 seconds after SIGKILL, it says so, and the slot is given
  back anyway.
- **Windows** has no signals and no process groups to signal, so stopping a job (Ctrl+C at
  `job run`, or `job run` ended) ends its whole process tree with `taskkill /PID <pid> /T /F`
  (`windows-jobs.md`).

## The environment

The job gets exactly the environment `job run` was given. Bun loads the `.env` files of the
working folder into a script's environment by itself, so the launchers start the CLI with
`bun --no-env-file`. A `job run` started without it, in a folder with `.env` files, refuses
(exit 2) and says to run `cc-smart-dev-kit setup` (an older launcher).

## The classifier

`classifyHeavyCommand(bashCommand, kinds)` (`src/jobs/classify.ts`) says which kind a Bash
command runs, or null: it is what the route names a job by. The route adds one rule on top
(`classifyRoutableLine`): a line is queued only when every command in it is heavy, a `cd` or an
assignment, or when one heavy command is piped into read-only filters (§ The route). It reads
the line with the one shell reader the guards use too (`src/shell/command.ts`), so the queue and
the guards see the same commands: a tool inside quotes, an `echo`, a quoted here-doc, a comment
or a commit message is text, not a run; a substitution (`$( … )`, a backtick, the body of an
unquoted here-doc) is a run. It finds the tool behind `bunx`, `bun x`, `bun run`, `bun <name>`,
`npx`, `npm exec`, `npm run`, `pnpm`, `yarn`, `node_modules/.bin/` paths and `node <script
path>`; behind a shell keyword (`if`, `while`, `!`); behind the wrappers `time`, `timeout`,
`nice`, `ionice`, `nohup`, `stdbuf`, `env`, `sudo`, `doas`, `exec`, `command`, `builtin` and
`xargs`, **with their own options**; inside `bash -c '…'`, `env -S '…'`, a here-doc or a pipe
fed to a shell; and behind a name the shell resolves first (`b\unx`, `$'bunx'`). The reader's
cases are pinned in `src/jobs/shell-parity.test.ts`.

**A script is a script, not the tool of the same name.** A `package.json` script is found only
through a kind's `{ "script": "<name>" }` rule. To tell a script from a tool, the classifier
reads the project's `package.json` in the folder the line runs in (after a `cd`, the folder it
moves to), through an injected reader (`packageScripts` in `src/jobs/package-scripts.ts`), once
per folder and run. A name that is a **script** there matches only a `script` rule, so a
project whose `tsc` script already wraps the type check is not queued a second time. A name that
is **no script** there is the package manager's `node_modules/.bin/<name>`, so a tool rule
matches it. With no `package.json` there, or one the reader cannot use, the answer is the tool —
a broken file is treated as no file. These cases are in `src/jobs/classify.test.ts` and, through
the hook, in `src/hooks/bash-judge.test.ts`.

## What 2.0 took out

There are no memory checks, CPU or I/O weights, systemd slices, `choom`, shared folders,
fair-share rules, light lane or `job set`. The queue never changes process priority. An old
`jobs` setting or machine `jobs.json` file is ignored since 2.0; no file is cleaned up.

## Limits

- **The slot prevents two full heavy runs from competing.** It does not cap the memory or CPU
  one run uses: one job alone may use all the machine's memory and every core.
- **It is machine-local**, not a distributed lock.
- **A `job run` killed with SIGKILL** frees its lease at the next look, but its job keeps
  running, unaccounted. In its own process group, a kill of `job run`'s group does not reach it
  either.
- **The job has no controlling terminal** (its own session): a job that asks a question on
  `/dev/tty` cannot, and Ctrl+Z stops `job run` only, not the job. Heavy jobs are builds and
  checks that ask nothing.
- **A hung job holds the slot for ever:** there is no timeout. Every waiting line names it.
- **Nesting is found on Linux only.** On macOS and Windows, a heavy job must not start another
  one through `job run`.
- **Windows:** `job run` watches the job's first process, so a worker left behind is not seen
  and the slot is given back while it runs; and a holder whose start time cannot be read counts
  as alive (`windows-jobs.md`).
- **A dead ticket from another pid namespace** cannot be judged by its pid: it holds the line
  until it is stale, 30 seconds after its last touch.
- **The classifier's `typed.` rule for ESLint** can match a file whose name holds that text.
- **The queue is not a substitute** for running targeted checks while building and one full
  check at the end.

See [the design](design/jobs.md).
