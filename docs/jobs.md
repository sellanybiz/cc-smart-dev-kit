# Heavy jobs

One heavy run at a time per machine by default. You can choose a higher machine limit with
`cc-smart-dev-kit job set max <n>` (1–8). Small runs on named files bypass the queue, so a
targeted check need not wait behind a full build.

The default stays 1 because several full suites at once starve each other, time out, and then
"pass alone". That caused false failures before. Eight is a small upper bound against accidental
fan-out, not a measure of your machine's resources. Raise it only when your full runs coexist well.

The setting is `maxConcurrent` in `~/.config/cc-smart-dev-kit/heavy-jobs.json`, for your user on
this machine, never a project setting. The command uses setup's managed JSON writer, backup,
atomic write and lock. `restore` removes the value the kit wrote and leaves unrelated keys alone.
`job status`, `/api/jobs`, the portal's Machine page and `doctor` show the limit and its source
(the default or the new file). Legacy `jobs.json` and its `maxJobs` are never read as settings;
`doctor` names an old `maxJobs` as a leftover to remove.

A new acquisition reads the current limit under the lease lock. Raising it lets waiting jobs
use new slots without restarting. Lowering it does not stop running jobs: new jobs wait until
the number running falls below the new limit. Invalid new settings fail closed: no heavy job
starts until the file is fixed.

A **heavy job** is a command that can use many gigabytes: a TypeScript type check, a
type-aware lint, a test run, a production build, a container image build. When many Claude
sessions and their agents run on one machine, they start these at the same time. The machine
runs out of memory, and the kernel kills what it picks: often the desktop, and every session
with it. A rule like "one heavy job at a time" in each session does not help: nothing limits
heavy jobs **across** sessions, agents and people. So each heavy job runs through
`cc-smart-dev-kit job run`, and the next one waits for the slot. A hook that git itself runs on
`git commit` or `git push` goes through it too (§ Git hooks).

On Linux with a systemd user manager, a queued job also runs under a CPU cap and a memory cap
(90% each by default), so one job cannot hang the machine: § CPU and memory limits. Choose the
caps with `cc-smart-dev-kit job set cpu <n>` and `cc-smart-dev-kit job set memory <n>`.

The same queue runs on native Windows, where a lease's start time and how a job's tree is
ended differ, and where jobs have no CPU or memory limits: [Windows](windows-jobs.md).

## Commands

```sh
cc-smart-dev-kit job run --kind test:run -- bun test
cc-smart-dev-kit job run --kind image:build --exclusive image -- docker buildx build .
cc-smart-dev-kit job status
cc-smart-dev-kit job kinds
cc-smart-dev-kit job hook pre-commit
```

| Command | What it does |
|---|---|
| `job run [--kind <kind>] [--exclusive <name>] [--hook] -- <command…>` | Waits for a free machine slot, runs the command, and gives the slot back when it ends. The command keeps its stdin, stdout, stderr and exit code, and signals reach its child processes too. `--kind`, `--exclusive`, or both. `--hook` is for the kit's git hooks (§ Git hooks): the slot is taken without reading the command's words, and when the queue cannot be used the command runs at once, so a broken kit never blocks a commit. |
| `job set max <n>` | Sets the machine limit (1–8); default 1. No running job is stopped. |
| `job set cpu <n>` | Caps the CPU of all heavy jobs together at `<n>`% of the machine's CPUs (10–100); default 90. Linux with a systemd user manager (§ CPU and memory limits). |
| `job set memory <n>` | Caps the memory of all heavy jobs together at `<n>`% of the machine's memory (10–100); default 90. Linux with a systemd user manager. A lower cap reaches the running jobs at the next launch, which with the default of one slot comes after the running job ends (§ A lower limit while a job runs). |
| `job status` | The limit, its source, the CPU and memory caps (on Linux), who holds slots and who waits (the waiting jobs in the order the queue serves them, the same order the waiting line's place counts), and the job route for the folder it runs in: on or off, and whether the project, your own `switches.jobRoute` or the default decided. Stale files it finds are removed. Its lines and the portal's `/api/jobs` come from one reader (`src/jobs/status.ts`), so the queue has one shape and no printed line is parsed again. |
| `job kinds` | Every kind: where it comes from (`default` or `project`) and its `about` line. Not its match rules: those are in `cc-smart-dev-kit.json` and § Kinds. |
| `job hook <name>` | For the kit's git hook scripts, not for you: prints `direct` or `queue <kind>` for git hook `<name>` in the repo of the folder it runs in (§ Git hooks). It always ends with 0. |

## How a job runs

1. **Narrow runs go at once.** The judge (`runWeight`, § The classifier) reads the command the
   way a shell would run it. A run it proves light — it only prints (`tsc --version`), or it
   names only files that exist (§ Kinds) — takes no slot and never opens the queue, unless it
   has `--exclusive`. Only a positive finding lowers a run to light; a command the judge cannot
   read keeps its slot. With `--hook` the judge is not asked: the slot is always taken.
2. **Nesting.** A heavy job may start another one (a script that runs the type check, then the
   build). The inner one must not wait for a slot its parent holds. So `job run` walks its
   parent processes (`/proc/<pid>/stat`) and, when one of them holds a lease on this machine,
   runs its command directly. Linux only. An inner job with `--exclusive` still takes its name,
   unless an ancestor holds that name already (§ One job per name).
3. **Take the slot.** A job with a kind takes one slot, and waits until it is free
   (§ Waiting). A job with a name only (`--exclusive` without `--kind`) takes no slot.
4. **Get the limits ready.** A job that holds a slot gets the slice's limits written, and starts
   in a scope of its own inside that slice (§ CPU and memory limits). This happens with the
   slot held, never while the job waits. A nested job, a run with a name only and a print-only
   run take no scope: they run as before. When the limits cannot apply, the job runs as before
   too, and on Linux `job run` says why in one line.
5. **Run.** The job starts in a process group of its own, inside its scope (§ The job's own
   process group).
6. **End.** `job run` ends with the job's exit code: the code itself, 128 + n for a job killed
   by signal n, 127 when the command cannot start, 2 for a wrong `job run` command line or a
   config it cannot use (`cc-smart-dev-kit.json`, a state folder it cannot make): then the job
   never starts. The slot is given back however the job ends, once no process of the job is
   left. When a memory limit stopped the job, `job run` says so before the end line, and the
   job's scope is cleared (§ CPU and memory limits).

## What a job prints

The job's output is the job's: stdout and stderr are passed through untouched, so anything
`job run` itself has to say goes to stderr, each line prefixed `[cc-smart-dev-kit job]`. A job
that never waits prints none of the lines below: a free machine gets no noise.

```text
[cc-smart-dev-kit job] Heavy job waits for a free slot: bunx tsc --noEmit. Why: this machine's only slot is taken. Place: 3rd in line, 2 jobs ahead.
[cc-smart-dev-kit job] A pipe (| tail) hides this job's exit status: the "Heavy job ended" line carries it.
[cc-smart-dev-kit job] A long wait: run it in the background (run_in_background) so the call does not time out.
[cc-smart-dev-kit job]   this machine: a heavy slot is held by host-a: build, bun run build in /home/user/app, since 11:44 (pid 4242)
   … a line a minute while it waits …
[cc-smart-dev-kit job] Heavy job starts after 18 min: bunx tsc --noEmit
   … the job's own output, on stdout and stderr, while it runs …
[cc-smart-dev-kit job] Heavy job ended: bunx tsc --noEmit, exit 0 after 3 min
```

- **The waiting line**, once when the wait starts and then every minute, with why it waits
  and who holds the slot (person, kind, command, folder, since when, pid). **The place** (`Place:
  3rd in line, 2 jobs ahead.`) counts only the jobs that are in the way of this one, never the
  holder; it is left out when none is. `job status` lists every waiting job in the same order.
  **The first line carries two hints**, once per job. The pipe hint: a job whose output goes
  down a pipe (`| tail`) reports the pipe's own status, so the hint points at the end line,
  which holds the job's own. It comes only when the job's output is a pipe or a socket
  (`src/jobs/stdout-pipe.ts`), never when it goes to a file or a terminal; on Windows, where
  that check is not proved, it always comes. The background hint: a call that runs the job in the foreground
  ends at its timeout, so a long wait belongs in the background (`run_in_background`).
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
| `tsc` | `tsc`, `tsgo`, `vue-tsc` | `--version`, `--help`, `--listFilesOnly`, `--showConfig`, `-v`, `-h`; a run on named files. |
| `lint:typed` | `eslint` with a typed config (an argument holds `typed.` or `type-checked`), `oxlint --type-aware` | `--help`, `--version`, `-h`, `-v`. |
| `test:coverage` | `vitest`, `jest` or `bun test` with `--coverage` | `--help`, `--version`, `-h`, `-v`. |
| `test:run` | `vitest`, `jest`, `bun test` | `--help`, `--version`, `-h`, `-v`; a run on named files. |
| `e2e` | `playwright test` | `--list`, `--help`, `-h`. A run on one spec file still takes a slot: it starts the app and its browsers. |
| `build` | `next build` | none. |
| `image:build` | `docker build`, `docker buildx build`, `docker compose build`, `podman build`, `buildah build` and their other build forms | none. |

When one command matches two kinds (`vitest --coverage` is a coverage run and a test run), the
**first kind listed wins**: the table is the order, with the specific kind before the general
one, and a project's own kinds come after the defaults. Several heavy commands in one line are
named by the **first** one the line runs. `job run` adds nothing to a command: a test runner
gets no `--maxWorkers`, so with the slot it uses what it would use outside the queue.

**A run on named files takes no slot** (`noSlotForFiles`: `tsc` and `test:run`). Every operand
must be a file that exists, at most 10, read in the folder the command runs in (after a `cd`,
or with the runner's folder option, § Scripts are read by their body). Each tool has its own
table of options, taken from its `--help` or documentation (`TOOL_OPTIONS`, `src/jobs/kinds.ts`),
because they differ: `-w` is vitest's watch flag and jest's worker count. An option written
without `=` that the table does not know may take the next word, which may be a file, so the
run waits. Options with an optional value (`--bail`, vitest's `-u` and `--silent`, jest's array
options such as `--reporters`) are left out of the tables on purpose: such a run waits.

- **`bun test`**: a positional word is a path filter to Bun, not a file. It counts as a file only
  when it starts with `./` or `/` and exists: `bun test ./src/a.test.ts` is light, `bun test
  src/a.test.ts` is a filter (it may match many files) and waits.
- **vitest and jest**: a named file is still a filter to the runner (vitest reads each word as
  a part of a path, jest as a regular expression), so `vitest run a.test.ts` also runs
  `data.test.ts`. A full path (`src/a.test.ts`) keeps the run narrow. `vitest related` always
  waits: the tests that import a file may be all of them.
- **`tsc`, `tsgo`, `vue-tsc`**: a run that names files (`tsc --noEmit src/a.ts`) is light. `-p`
  and `--project`, `--build` and `-b`, and a run with no file are full runs.
- **A run that only prints** takes no slot, with one rule for every kind: any one print-only
  option is enough, so `tsc --noEmit --version` is light too.
- **A watch run is never queued** (it never ends, so it would hold its slot for ever): `--watch`
  (and `-w` for tsc and vitest), `vitest watch` and `vitest dev`, `bun test --watch`, `jest
  --watch` and `--watchAll`, `playwright test --ui` and `--debug`. `--watch=false` is no watch
  run. `vitest --ui` is not on the list: with no terminal it prints its report and exits, so it
  is a full run and keeps its slot. `job run` itself still queues a watch run you wrote on its
  command line: only the route leaves one alone.

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
| `noSlotForFiles` | `true`: a run whose operands are all existing files, at most 10 of them (`vitest run src/a.test.ts`), runs at once with no slot. A run with no operand, or with one that is not a file (a folder, a pattern, a name filter), is a full run and waits. So does a run with an option the reader does not know, written without `=`: its next word may be its value, a file or not. Came with 1.5.0: a project that sets it raises `requires` to `>=1.5`. |
| `skipWords` | With `noSlotForFiles`: the words after the tool that are a subcommand, not an operand (`run` in `vitest run`). |
| `valuedFlags` | With `noSlotForFiles`: the options whose value is the next word (`--config x.ts`, `-t name`), added to the tool's own table, so that value is not read as an operand. |

The default `test:run` and `tsc` kinds set `noSlotForFiles`; `test:coverage` does not: a coverage
run instruments and reports on the whole project whatever files it names. The default kinds
need no `skipWords` or `valuedFlags`: the tool's own table holds both. A project's own
kind that matches `vitest`, `jest`, `bun test` or `tsc` gets that table too; a kind that matches
any other tool, and every `{ "script" }` rule, reads operands with the older shared list of
vitest's and jest's options, plus its own `skipWords` and `valuedFlags`. For a `script` kind, the
operands are the words after the script's name (`bun run test src/a.test.ts`). Each operand is
checked against the folder the job runs in.

**Old fields.** A project file written for an older plugin may still set `gb`, `filesGb`,
`maxFiles`, `workers` or `light` on a kind (`IGNORED_KIND_FIELDS`, `src/jobs/kinds.ts`). They
still parse, so the file keeps working, and the queue ignores every one of them. `doctor` says
once, in the project's lines, that they can go. The project's file cannot set how many jobs
run at once: the slot is the machine's, and there is one.

### Scripts are read by their body

A `package.json` script is not a tool, and its name says nothing about its work. So the
classifier reads what a script runs:

- **A `{ "script": "<name>" }` rule wins.** A project that names a script in a kind's `match`
  gets that kind for it, whatever the body holds.
- **Any other script is read by its body**, as if the line ran those commands, in the folder of
  the `package.json`. `bun run typecheck` with the body `tsc --noEmit` is a `tsc` run.
  `$npm_execpath` (or `"$npm_execpath"`) as a body's program reads as the runner that ran the
  script, so `"$npm_execpath" test` under `bun run test` is `bun test`. A script that calls
  another script is followed, three levels deep (`MAX_NESTING`); a script that calls itself,
  or goes deeper, is not read.
- **A script whose body runs heavy work is queued whole**, even when a command that is not
  heavy work comes first in the body: `bun run check` with the body `biome check . && tsc
  --noEmit`, or `bun run tsc` with `SKIP_ENV_VALIDATION=1 next typegen && tsc --noEmit`, waits for
  one slot. The kinds are those of the plain walk of the body. This holds only when the call is
  the line's own command and the body takes a slot. It stays raw when the body never ends (a
  watch run, a runner, `--watch` or `--ui`), runs in the background, runs as another user
  (`sudo …`), calls itself or nests too deep. The route does not refuse that line either, because
  the other command sits in the script's body, which the person cannot split off their own line.
  A script whose body runs no heavy work (`lint: "biome check ."`) is an ordinary command of the
  line: `bun run lint && bun test` is refused at `bun run lint`, like `bun test; git status`.
  **New in 6.1.0:** a line such as `bun run check; git status` (that script, plus a command of
  your own) ran raw before and is now refused as a mixed line, like any line you mixed yourself
  (`bun run tsc && rm x`): run the script on its own line. A `{ "script": "check" }` kind still
  queues a script whatever its body holds, under that kind.
- **`pre<name>` and `post<name>`** are read where the runner runs them: Bun, npm, pnpm and Yarn
  classic. Yarn Berry (a `packageManager` of `yarn@2` or newer, or a `.yarnrc.yml`) runs
  none, so none is read.
- **Extra words after the script name** reach a body that is one plain command, so `bun run
  test ./src/a.test.ts` can be light. A body of several commands is never light.
- **The `package.json` is the nearest one**, found walking up from the folder the line runs in
  to the checkout root (the folder with `.git`) and never above it. A file the reader cannot
  use counts as none, and the word is then the tool.
- **A runner's folder option moves the folder**: `bun --cwd`, `pnpm -C` and `--dir`, `npm
  --prefix` and `-C`, `yarn --cwd`.
- **A runner takes some `--` words for itself.** `npm run e2e -- --ui` hands `--ui` to the
  script: npm drops the first `--`, and drops its own flags written before it. Bun and Yarn
  Berry drop a `--` only when it comes first, Yarn classic drops the first one wherever it
  stands, and pnpm keeps it. These come from real runs of each runner, so `bun run e2e -- --ui`
  is read as `playwright test --ui` (a watch run, so never queued).
- **Not read:** several packages at once (`--filter`, `-r`, `--workspaces`, `turbo`, `nx`), and a
  script that already runs `cc-smart-dev-kit job run` (it is queued, and never queued again).

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
dash on Debian and Ubuntu, and cannot read bash syntax). Each word is quoted unless it holds
only letters, digits and `_ . / -`, so one with `=`, `:`, `@`, `,`, `%` or `+` is quoted too. A
command already inside `cc-smart-dev-kit job run` is left alone, also when it is inside a
script's body. Outside git there is no project, so a heavy command there runs raw. The hook itself: `docs/design/hooks.md` § The job route.

**A line is queued whole only when every command in it is heavy, a `cd`, an assignment or
glue** (`routableLine` in `src/jobs/classify.ts`; `classifyRoutableLine` gives its kind), and at
least one is heavy. Claude Code matches a person's own Bash rules (`deny`, `ask`) against the
words of the command it is about to run and does not look inside `bash -c '…'`, so a rewritten
`tsc && rm -f x` would hide its `rm` from a `Bash(rm:*)` rule (proved on 2.1.308,
`claude-code-contract.md`). **Glue** is a command nobody writes such a rule against, because it
cannot write a file or run another program. A line of heavy commands and glue — `cd app && bunx
tsc --noEmit && bunx vitest run`, or `bun run check; echo "exit $?"` — is queued as one job under
the first kind it runs: one slot for the whole line. What counts as glue (`isGlueCommand`):

- **The commands of `GLUE_COMMANDS`**: `:`, `[`, `echo`, `exit`, `export`, `false`, `printf`,
  `pwd`, `return`, `set`, `test` and `true`, each only under its argument rule. `printf` needs a
  plain format that is no option (`-v` sets a variable, and bash runs a command in the subscript
  of its name). `test` and `[` take no `-v` or `-R` (the same subscript) and no word the shell
  fills in. A glue word holds no arithmetic, indirect or prompt expansion (`$(( … ))`, `$[ … ]`,
  `${x[ … ]}`, `${x:n}`, `${!x}`, `${x@P}`): bash reads a variable's value there as code. A
  whole expansion with a literal subscript runs no code and stays fine (`${PIPESTATUS[0]}`,
  `${arr[@]}`, `${#arr[*]}`).
- **Shell state**: `set` with option words only, never `--` and never a word the shell fills
  in. It may turn on only the options that make the shell stop sooner (`-e`, `-u`, `-o errexit`,
  `-o nounset`, `-o pipefail`, as in `set -euo pipefail`); it may turn any option off (`+x`,
  `+o history`). Others can run code no reader saw: `-x` expands `PS4` before each command,
  `-H` turns `!!` history into new commands, `-k` makes a later word an environment variable.
  `exit` and `return` take no word, a number, `$?` or a literal-subscript read such as
  `${PIPESTATUS[0]}`. `export` takes `NAME=value` words only, with no value holding `$(` or a
  backtick. These are glue because the refusal's advice (run the rest in another call) cannot
  work for them: an option or an export does not carry over to the next Bash call.
- **A reader of a pipe**: a program of `READ_ONLY_FILTERS` that has a shape there (every one but
  `rg`; the filters are named below, under "One heavy command piped into read-only filters"),
  only when it reads the pipe and nothing else: piped from the command before it, written bare (no
  path), with plain words (no `$VAR` or `$(…)`), no file word, no file it writes to (`tee` only
  with no argument at all) and no input redirection from a file (`bun test; tail -5 out.log` and
  `cat < .env` are no glue). `rg` has no shape, so it is never glue: with nothing piped it
  searches the folder.
- **The structure of a group**: the `{ … }` or `( … )` around commands, and the redirections of
  the group itself (`{ echo a; bun test; } > out.log 2>&1`). An input from a file other than
  `/dev/null` is no structure (`$(< .env)`, `{ bun test; } < .env`): it would print the file
  inside the queue's shell string, where Claude Code's own read rules no longer see it.

Every command of a glue word's own substitution is judged on its own, and a pipe into a shell
(`… | sh`) is never glue: the script is the reader's guess, so a line with one beside heavy work
is refused. A command with a path (`/bin/echo`), a wrapper (`env echo`), an assignment before it
or a computed name is no glue either.

**A line that mixes heavy work with a command that is not heavy or glue is refused, not left
raw.** Run raw, the heavy part would not wait for a slot, and many heavy runs at once have run
machines out of memory; run queued, the other command would hide from the person's rules. So when a line runs heavy work
that takes a slot beside a command that is neither heavy nor glue (`bun test; git status`,
`tsc && rm -f x`, `bun test; tail -5 out.log`), the hook denies the call (`mixedLineDenial`,
`src/hooks/job-route.ts`; the finder is `mixedHeavyLine`). The reason names the heavy run and
the other command, and says how to fix it: run the heavy command on its own line, where it waits
for a slot (it may keep a `cd` before it, a redirection, `echo` or `printf` around it, and a
pipe into `tail`, `head` or `grep` with plain words and no file for the reader), then run the
other commands in a separate call. To keep an exit code on one line, the reason names the form
`{ cmd; echo "exit $?"; } 2>&1 | tail -20`, which is queued. A refusal is a deny whoever is away: the session reads the
fix and retries, so nothing is parked. These lines are no mix, and stay as they were:

- a **light run** (named files, print-only), a **watch run**, and a line that **queues itself**,
  because they take no slot;
- a line whose only non-glue command sits in a **package script's body**, or in shells nested
  too deep: the person cannot split it off their own line, so the hook does not blame them;
- heavy work **as another user** (`sudo bun test`, `doas …`, `su -c '…'`, `pkexec …`;
  `AS_ANOTHER_USER_NAMES` in `src/shell/command.ts`): queued, the line would start with the
  queue's command, so the person's `sudo` rules would never see it; refused, no split would
  help. It runs raw, as written, without a slot. A command as another user that runs no heavy
  work is blamed like any other (`bun test; sudo echo hi` is refused);
- every line when the **route is off** and every line **outside git**; a **PowerShell** line,
  which has its own refusal (below); and a line with a `git` command and no heavy run of its
  own, which gets the hooks prefix (`routeGitHooks`, § Git hooks).

**One heavy command piped into read-only filters is queued too** (`routableLine`): `bunx tsc
--noEmit 2>&1 | tail -20` becomes `… job run --kind tsc -- <shell> -c 'bunx tsc --noEmit 2>&1'
| tail -20`. The filters stay **outside** the wrapper, as plain words of the line, so the
person's own Bash rules still see every one of them. A filter is one of `tail`, `head`, `grep`
(`egrep`, `fgrep`), `rg`, `wc`, `cut`, `tr`, `uniq`, `sort`, `cat` (with no file), `tee` (with no
file but `/dev/null`), and `sed` or `awk` with a script that only prints. Anything else after
the pipe — a filter with an option that writes, a second heavy command, a filter **before** the
heavy one (`cat x | tsc`), `|&`, a group in parentheses — is no filter, and the line is judged
as a mixed line (above). The exit code is the pipeline's own, exactly as without the queue.

**A light line stays raw.** A line is queued only when the judge (`runWeight`) also says it is
heavy. A run on named files, or one that only prints, starts at once, so wrapping it would only
add the launcher's start. A watch run, and a line that already queues itself, answer `none`:
they must never hold a slot, so they are left raw too (the route never wraps `tsc && vitest
--watch`). The judge calls a line light only when it understands **every** command in it — a
`cd`, an assignment, glue, a heavy-kind command, a script it followed into its body, a read-only
filter: in `tsc --noEmit a.ts && ./build.sh` the unknown `./build.sh` may be the heavy work, so
the line is not light. Several heavy runs sent to the background with `&` are not light.

**The timeout.** A job may wait many minutes for a slot, and a Bash call ends at its timeout.
When the call set none, the rewrite gives it the Bash tool's longest: the larger of
`BASH_MAX_TIMEOUT_MS` (default 600000) and `BASH_DEFAULT_TIMEOUT_MS` (default 120000), read
from the hook's environment (`routedTimeoutMs`). A timeout the call chose is kept, and a call
sent to the background (`run_in_background`) is left alone. The hook's `updatedInput` setting
`timeout` was proved live on 2.1.326 (`claude-code-contract.md`); whether a value set in a
settings file's `env` reaches the hook's environment is not proved, and without it the
defaults hold. The longest timeout is still a limit, so the first waiting line also says to run
a long wait in the background (§ What a job prints). `REWRITE_TIMEOUT_SUPPORTED` in the hook is
the switch to turn the timeout off.

**A git command whose hook is heavy gets a prefix, not a wrapper** (§ Git hooks). Claude Code
reads a person's own Bash rules past a leading variable assignment, but not past
`job run -- git push`: a wrapper would hide the `git` from a `Bash(git push:*)` rule (proved
live on 2.1.326, `claude-code-contract.md`). So the line stays as written, with three
assignments in front of the git command.

**A heavy PowerShell line is refused while the route is on.** The rewritten line is a `sh` line
the PowerShell tool cannot run, so a heavy command run there would not wait for the slot. The
hook denies it and names the Bash tool with the exact Bash line to run when the line is one
plain command. It does so only where the Bash tool can exist — always off Windows, and on
Windows only when Git Bash is found (`src/cli/git-bash.ts`). A light PowerShell line, a
print-only one, and every PowerShell line with the route off are left as written.

**The folder.** The rewritten command runs in the Bash tool's own shell, so it starts in the
folder that shell is in. A `cd` **inside** the command lives only for that command.

## Git hooks

A repo's own hook often runs the heaviest work of a commit: a `pre-commit` that type-checks and
tests, a `pre-push` that builds. It runs inside `git commit` or `git push`, and git is no heavy
command, so the queue never saw it. The route fixes that without touching the person's git
settings, with a folder the kit owns and a prefix on the git line.

**The kit's folder.** `~/.local/share/cc-smart-dev-kit/git-hooks/` holds one `sh` script under
every client-side hook name in `git help githooks`, all with the same text and mode 755. It
also holds a script under the four server-side names (`pre-receive`, `update`, `post-receive`,
`post-update`), which only pass through: a server hook never runs on a commit or a push from
this machine, so none is read or queued. It never holds `push-to-checkout` or `proc-receive`:
git changes what it does when one of them exists. `cc-smart-dev-kit setup` writes the folder,
the first session start of a new version rewrites it (each script in place, one file at a
time, because git reads the folder while a commit runs), and `restore` removes it. It is a
folder the kit owns whole, marked as its own: a folder at that path that the kit did not make
is never replaced, and `doctor` says to move it away. Native Windows has no folder yet: the
scripts are `sh`.

**The prefix.** With the route on, a `git commit`, `git merge` or `git push` whose hook is heavy
gets three variable assignments in front of the `git` word, and no other change:

    GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=core.hooksPath GIT_CONFIG_VALUE_0=<the kit's folder> git commit -m x

**Your permission rules see the prefixed line.** Claude Code matches a `deny` or `ask` rule past
leading variable assignments, so `Bash(git push *)` there still holds (proved live:
`docs/claude-code-contract.md`). An `allow` rule does not: Claude Code's docs say it will not
match past an assignment of another variable. So with `Bash(git push *)` only in your allow
list, a prefixed push asks you again, and nothing that was asked becomes allowed. How auto mode
judges a prefixed line is not proved yet.

Git reads them for that one command, so it uses the kit's folder instead of the repo's own. The
hooks asked about are the ones the command runs: `pre-commit` and `commit-msg` for a commit,
`pre-merge-commit` and `commit-msg` for a merge, `pre-push` for a push. Why a prefix and not
the wrapper the other heavy lines get: § The route. Any doubt leaves the line as written, so no
hook is ever skipped:

- no prefix when the route is off, on native Windows, or when the kit's folder is missing or
  not this version's (`doctor` names it);
- none when the command skips its hooks (`--no-verify`, a commit's `-n`; a push's `-n` is
  `--dry-run`), or sets `core.hooksPath` itself (`git -c core.hooksPath=… commit`: the person's
  own folder still wins), or the line sets any `GIT_CONFIG_*` variable;
- none when the session's environment already sets `core.hooksPath` through `GIT_CONFIG_*`. When
  it holds other pairs (CI often sets a `safe.directory` one), the kit's pair is added after
  them: the count grows by one and nothing is lost;
- none when the command is not plain `git` (a wrapper, a keyword, a computed word), or the
  reader cannot place it exactly in the line (inside `bash -c '…'`, a backtick, a here-doc, a
  bash array's list). `git --git-dir` and `--work-tree` also leave the hook unqueued: `job hook`
  cannot find the repo, answers `direct`, and the hook runs as it is;
- none when the hook is not heavy, or git does not answer in time (the questions share the
  hook's short time budget, 8 s of the hook's 10).

The prefixed call gets the same longest timeout as a wrapped one (§ The route).

**The script** does the same for every name, and tries never to be the thing that breaks a
commit. It takes the kit's own pair out of the environment, so nothing the hook starts (a test
suite that commits in temp repos) sends its own git calls through the folder. It finds the
repo's real hooks folder and the real hook file of that name, with git's own question; no file
means it ends with 0, as git does. A file that is not executable gets git's own hint and ends
with 0. It asks `cc-smart-dev-kit job hook <name>`. Only the answer `queue <kind>` changes
anything: then it runs `job run --hook --kind <kind> -- <the real hook> <git's arguments>`.
Every other answer, a missing launcher and a failing one run the real hook as it is. Standard
input and the environment pass through, so `pre-push` still reads its refs and `pre-commit`
still sees `GIT_INDEX_FILE`.

**How a hook is read** (`job hook`). It finds the repo's real hooks folder: `core.hooksPath` of
the repo, else `<git dir>/hooks`. For husky v9, whose folder (`.husky/_`) holds a stub for every
name, it reads the person's commands in `.husky/<name>`, and a stub with none behind it is no hook.
The text is classified **any-heavy**: one heavy command anywhere in it makes the hook heavy,
because nothing is hidden (the git line is still visible to the person's rules). A package script
in it is followed into its body (`bun run typecheck` reads as `tsc`), from the `package.json` at
the top of the work tree, where git runs the hook, whatever folder the commit was typed in. A
hook that already queues itself (it runs `cc-smart-dev-kit job run …`, directly or through a
script it calls) runs as it is: queued again, it would wait for the slot its own job holds. A
hook that only starts a
manager is queued only when a kind of the project matches a command in that hook's text. The
hook lefthook writes (`lefthook install`) ends with `call_lefthook run "pre-push" "$@"`, a shell
function, and inside it runs `lefthook -h` and `lefthook "$@"`: `lefthook run` is never a
command of the file. So the kind `{ "tool": "lefthook" }`, with no `sub`, queues it (proved
against lefthook's own template, `src/jobs/git-hooks.test.ts`), and `{ "tool": "lefthook",
"sub": ["run"] }` does not; it only matches a hook you wrote that calls `lefthook run …`
directly. The kind then queues every lefthook hook of the project, whatever its YAML runs. It
also matches every `lefthook …` line typed in a session, so `lefthook install` would wait for the
slot too: give the kind `"printOnly": ["-h", "--help", "install"]`, which keeps those light and
still queues the hook:

```json
"lefthook": { "match": [{ "tool": "lefthook" }], "printOnly": ["-h", "--help", "install"] }
```

The managers' own files (lefthook's and pre-commit's YAML) are not read, and no kind is proved for
the pre-commit framework's generated hook. A binary file, or a file over 256 KB, is run as it
is.

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
- **The scope.** With the limits on, the job's processes are also in a systemd scope (§ CPU and
  memory limits). A signal then goes through the scope, with `systemctl --user kill
  --signal=<signal> <unit>`, which reaches a worker that left the group. Every member of the
  group is in the scope, so the signal goes to the group only when systemd did not answer: the
  job gets each signal once. The leftover stop (above) signals both. The job is over only when
  the group and the scope are both empty. The scope is empty when its `cgroup.events` says
  `populated 0`, or when its folder is gone. The queue never stops a running job with
  `systemctl stop`, which waits up to 90 seconds for the unit: it signals the job.
  (`release()` uses `stop --no-block` only on a scope that is already empty.)
- **Windows** has no signals and no process groups to signal, so stopping a job (Ctrl+C at
  `job run`, or `job run` ended) ends its whole process tree with `taskkill /PID <pid> /T /F`
  (`windows-jobs.md`).

## CPU and memory limits

A type check or a test run can use every core and all the memory. The machine then swaps until
it stops answering. A memory cap alone does not stop that: a job that cannot swap makes the
kernel swap out the desktop and the sessions instead, before the job reaches its cap. So the
**caps bound the jobs, and the watchdog and the kill mark are what stop the hang.** The code is
`src/jobs/limits.ts`.

Four words first. **cgroup** is the Linux kernel feature that enforces the limits. A **slice** is
a systemd group of processes that share them. A **scope** is one job's own group inside the
slice. **OOM** means out of memory, and an OOM kill is a process stopped for it.

**Where it applies.** A queued job (one that holds a slot) on Linux with a systemd user manager
and cgroup v2. A nested job, a run with a name only and a print-only run take no scope. A hook
that `job run --hook` queues is limited like any queued job.

### What a job gets

Every queued job runs in a scope of its own inside one slice, `cc_smart_dev_kit_jobs.slice`: the
command's name with each dash an underscore. The name has no dash on purpose. systemd reads a
dash in a slice name as nesting (`foo-bar.slice` is located within `foo.slice`), and a CPU weight
only counts against the siblings in the same parent. A dashed name would sit five levels deep
with no sibling, and the weight would do nothing (proved live: 2001 ms against 2002 ms for the
same burner). Without a dash the slice sits directly under your user manager, beside `app.slice`,
where the weight works (proved live: two burners on one CPU shared it 1 to 5). All heavy jobs
share that slice, so the caps hold for them together, also with `job set max 3`. Before each launch the slice gets the
properties below, written with `systemctl --user set-property --runtime`. A runtime property
lives under `/run/user/<uid>/systemd/user.control/` and is gone at reboot. No file in your home
changes.

| Property | Value | Why |
|---|---|---|
| `CPUQuota` | the CPU percent times the machine's CPUs; empty at 100, which removes it | Caps the jobs' CPU. The CPU count comes from the user manager's `cpuset.cpus.effective`, or else `os.cpus().length`. It is never `availableParallelism()`: a `job run` started under `taskset` must not shrink every job's quota. |
| `CPUWeight` | `20` (systemd's default is 100) | The jobs yield to your apps when the CPU is busy, and never starve. It works because the slice is top level, beside `app.slice`, whose weight is the default 100. An idle machine runs a job at full speed, up to the cap. |
| `MemoryMax` | the memory percent, as `<n>%` | Caps the jobs' memory. systemd reads the percent as a share of the physical memory. |
| `MemorySwapMax` | `0` | The jobs never swap, so they cannot push the desktop out of memory. |
| `MemoryHigh` | `infinity`, written on purpose | A `MemoryHigh` below `MemoryMax` made a job hang for good with no swap (proved live). It is never set lower. |
| `ManagedOOMMemoryPressure`, `ManagedOOMMemoryPressureLimit` | `kill`, `40%` | The watchdog: systemd-oomd stops a job when the slice stalls on memory. |
| `ManagedOOMMemoryPressureDurationSec` | `10s`, in a call of its own | It needs systemd 257. On an older systemd only that call fails, and oomd's own default duration stays. |

A runtime property outlives a job, so every launch writes every property it owns, with the
reset value where a cap is off. Two `job run`s that write the same values at once do no harm.

**The scope** starts with `systemd-run --user --scope --quiet --slice=<slice>
--expand-environment=no (254 and later) -p OOMPolicy=kill --unit=<unique name> -- choom -n 900 --
<the job>`. The scope is not `--collect`ed: a scope that systemd failed keeps its result, which
the watchdog's line reads. Then:

- **`OOMPolicy=kill`** ends the whole job when one of its processes is OOM-killed, so the exit
  code is 137. Without it the user manager's default (`stop`) gave 143.
- **`choom -n 900`** is the kill mark: when the whole machine runs out of memory, the kernel
  kills the job before your desktop. A machine without `choom` runs the job without the mark,
  and the limits still apply.
- **The unit name** holds the slice's name, the kind, the pid of `job run` and its start time
  (base 36). A scope that a SIGKILLed `job run` left behind never clashes with a new one.
- **Stale failed scopes** are cleared at each launch, after the probe and the properties. A `job
  run` killed with SIGKILL never releases its scope, and one that later ends by an OOM kill would
  stay failed until the machine restarts. One call lists the failed scopes of the jobs' unit prefix
  (`systemctl --user list-units --state=failed --plain --no-legend 'cc_smart_dev_kit_jobs-*.scope'`).
  The pid of the `job run` that made each scope is read back from its name, and a scope whose
  wrapper process still exists is **kept**: with `job set max` above 1 another job's scope may have
  failed a moment ago, and its wrapper has yet to read the scope's result (`oom-kill` is how the
  watchdog line is known). The rest are reset by name in one `reset-failed` call, and only when
  any are left. A list that times out skips the reset. Nothing here may stop a job, so no answer is
  needed.

### The job's words are never changed

From systemd 258 on, `systemd-run --scope` expands `$HOME`, `${HOME}` and `$$` in the command.
Before 258 it never does (proved live on 259). A `bun -e` script with a template literal, or
`sh -c 'kill $$'`, would reach the job changed. So the switches carry `--expand-environment=no`
where the systemd has it (254 and later), and the job's words reach it as written. The queue
never rewrites them.

### The probe

`systemd-run` exits with 1 when it cannot make a scope, the same code as a type check that
found errors. So the same switches first run `-- true` (about 30 ms), and only then does the
job start in a scope. The probe tries three sets of switches, and the first that works is the
one the job uses:

1. `OOMPolicy` with `--expand-environment=no` (systemd 254 and later);
2. `OOMPolicy` alone (systemd 253);
3. neither (an older systemd, where there is nothing to switch off).

A timeout stops the probing: another probe would wait as long again. Once the job has started,
its exit code is the answer, and the job is never started a second time.

### When the limits cannot apply, the job still runs

A broken kit never blocks a build, a test or a commit. The checks come in a fixed order, and
the first that fails names the reason: Linux, the settings, the user manager's delegated `cpu`
and `memory` controllers (its `cgroup.controllers` file), `systemd-run`, a command that is found,
the probe, then `set-property`. On Linux `job run` prints the reason as one line on stderr:

```text
[cc-smart-dev-kit job] this job runs without CPU and memory limits: no systemd user manager with cgroup v2 here (its controllers file is missing)
[cc-smart-dev-kit job] this job runs without CPU and memory limits: systemd could not start a scope here (no user session bus?)
[cc-smart-dev-kit job] this job runs without CPU and memory limits: systemd did not answer within 10 s
```

On macOS and Windows it prints nothing (every hook would repeat it), and `doctor` covers it.
Every systemd call has one timeout, 10 seconds, so a hung user bus never hangs a job or a commit
hook. A hung bus costs up to 10 seconds for each systemd call that meets it. When it hangs at
the start, the probe times out and the job runs without limits, so nothing more is called at
the end. When it hangs after the start, the end can wait twice: once for the watchdog read
(only after a SIGKILL the wrapper did not send), once for `release()`'s stop, whose timeout
skips the second call.

- **A command that is not on the PATH** runs plain, so its exit code stays 127 and its message
  stays the one `job run` always gave ("could not start"). `systemd-run` would end with 1 and a
  different message. This case prints no line.
- **A bad `cpuPercent` or `memoryPercent`** runs the job without limits, with one line that
  names the key, its range and the fix:

  ```text
  [cc-smart-dev-kit job] this job runs without CPU and memory limits: /home/user/.config/cc-smart-dev-kit/heavy-jobs.json: cpuPercent must be an integer from 10 to 100 (fix: correct it in that file (a whole number from 10 to 100), or remove it and run cc-smart-dev-kit job set cpu <n>)
  ```

  A typo never blocks the queue: `maxConcurrent` is read apart, and a bad `maxConcurrent` still
  fails closed, as before. `job set` never overwrites a value you wrote by hand (the managed
  file's rule), which is why the fix says to correct or remove it first.

### A job stopped for memory says why

A job that a memory limit stopped gets one line before its end line. It never prints after exit
0, and it never reads an exit code (a killed worker makes its parent exit 1). Three killers can
stop a job, and each has its own line:

- **The cap.** The jobs reached `MemoryMax`: the slice's `oom` count rose.

  ```text
  [cc-smart-dev-kit job] killed for memory: this job reached the memory cap (27.3 GB, 90% of this machine's memory). Run it again when fewer heavy jobs run, or raise the cap with: cc-smart-dev-kit job set memory <n> (exit code 137)
  ```

- **The watchdog.** The jobs stalled on memory below the cap, and systemd-oomd stopped the job.
  oomd leaves no count. It fails the job's scope with `Result=oom-kill`, and `job run` reads
  that with `systemctl --user show` (only for a SIGKILL it did not send itself, and never after
  exit 0). The line says "after 10s" only when this launch's duration call succeeded. Before
  systemd 257 it says "stops a stalled job" with no number.

  ```text
  [cc-smart-dev-kit job] stopped for memory: this job stalled on memory below the cap (27.3 GB, 90% of this machine's memory), and the watchdog (systemd-oomd) stops a stalled job after 10s. Run it again when fewer heavy jobs run, or lower the cap so the jobs leave more for the machine, with: cc-smart-dev-kit job set memory <n> (exit code 137)
  ```

- **The machine.** Only the kernel's `oom_kill` count rose: the whole machine ran out of memory,
  and the kernel picked this job first, because of its kill mark. The line says so, and
  suggests a lower cap, so the jobs leave more for the machine. When `oom_kill` rose and the
  `oom` count cannot be read, the line names both the cap and the machine.

The scope's own `oom_kill` count says whether the kernel killed this job. A killed scope's
folder is usually gone by then (seen live), so then the slice's counts answer. **With `job set
max` above 1, a kernel kill is read from the shared slice, so two jobs that end at once can
share one "killed for memory" line.** With `max` above 1 the cap line and the watchdog line
also say "the heavy jobs together" in place of "this job", because the cap is theirs together.
The watchdog's `Result` is read from the job's own scope, so it is never shared.

### `release()`: each job's scope is cleared

When a job ends, whatever its exit code, its scope is stopped and reset: `systemctl --user stop
--no-block <unit>`, then `reset-failed <unit>`. A scope that systemd failed stays failed until
it is reset (proved live), and a scope whose "empty" notification systemd missed stays `active`
(seen live, under load). Without this step a job would leave a unit behind. The stop does not
wait: the scope is empty already. When the stop times out, the second call is left out, because
a hung bus would only add another 10 seconds to the job's end. This runs after the memory line,
which needs the scope's state.

### A lower limit while a job runs

`job set cpu` and `job set memory` write the settings file and nothing else. The slice gets the
new values at the **next launch**, which writes every property again. A lower limit set while a
job runs reaches the running slice when the next job starts: a lower CPU cap slows the jobs in
it, and a lower memory cap makes the kernel reclaim memory. With no swap, a job that is still
above the new cap is then OOM-killed. With `job set max 1` the next launch comes after the
running job ends, so the new cap meets a running job only when `max` is above 1.

`job set cpu 100` writes an empty `CPUQuota=`, which removes the cap. `job set memory 100`
writes `MemoryMax=100%`, and swap stays 0. To remove all of the slice's drop-ins at once, run
`systemctl --user revert` on the slice.

### Settings, and where to see them

The settings are `cpuPercent` and `memoryPercent` in the machine file named at the top of this
page, beside `maxConcurrent`: each a whole number from 10 to 100, and 90 when the key is missing.
`job set` writes them with the same managed writer and the same locks as `job set max`, and
prints the setting as the status says it:

```text
Heavy-job caps: CPU 70%, memory 90% (/home/user/.config/cc-smart-dev-kit/heavy-jobs.json)
```

- **`job status`**, `/api/jobs` and the portal's Machine page carry the caps in the status note,
  on Linux: `Heavy-job limit: 1 (default). Heavy-job caps: CPU 90%, memory 90% (default)`. A bad
  key reads `Heavy-job caps: off, <file>: cpuPercent must be an integer from 10 to 100`. Where
  the caps cannot apply (a container, WSL without systemd, a controller that is not delegated, no
  `systemd-run`), the note adds the reason: `... memory 90% (default) (not applied here: no systemd
  user manager with cgroup v2 here (its controllers file is missing))`. They read the settings
  file, one cgroup file and the PATH only, and never start a program or systemd, because the
  portal polls them.
- **`doctor`** has lines for the caps, and none of them is a failure. It reads cgroup files and
  the process list only, never systemd:
  - `Heavy-job caps applied on <the slice>: CPU 90%, memory 90% (12 CPUs); the jobs yield to your apps`
    when the slice's `cpu.max` and `memory.max` match the settings (it never claims a cap it
    has not read);
  - an information line, "written to <the slice> when the next heavy job starts", when no job has run since boot and the slice does not exist yet;
  - a warning when the slice carries other values than the settings;
  - a warning with the reason when the caps cannot apply here, and one when the settings are
    bad, each with its fix;
  - a warning when **systemd-oomd** does not run: the caps hold, but nothing stops a heavy job
    that stalls on memory. The fix is `systemctl enable --now systemd-oomd`, as root.

### How it is tested

Every test fakes the system's facts (`LimitFacts`), so a test never touches the host's systemd.
One test file is opt-in and does touch it: `src/jobs/live-systemd.test.ts` runs only with
`CC_SMART_DEV_KIT_LIVE_SYSTEMD=1`.

```sh
CC_SMART_DEV_KIT_LIVE_SYSTEMD=1 bun test src/jobs/live-systemd.test.ts
```

It starts throwaway units in a throwaway slice (never the real one), and the run fails when it
leaves anything behind. It proves that the properties reach the kernel's files, that a CPU
burner is held to its quota, that a job over the cap ends with exit 137 and its line, that exit
codes pass through, and that one SIGINT reaches the job once. Its **stall case** sets a
test-only `MemoryHigh` below `MemoryMax` on the throwaway slice, because a job under the real
limits is killed at the cap and never stalls. It needs `python3`, and it is skipped without it:
systemd-oomd picks its victim by page-scanning activity, so the eater must keep touching its
pages, as a Python `bytearray` does. A Bun `Buffer` is never picked.

## The environment

The job gets exactly the environment `job run` was given. Bun loads the `.env` files of the
working folder into a script's environment by itself, so the launchers start the CLI with
`bun --no-env-file`. A `job run` started without it, in a folder with `.env` files, refuses
(exit 2) and says to run `cc-smart-dev-kit setup` (an older launcher).

## The classifier

`classifyHeavyCommand(bashCommand, kinds)` (`src/jobs/classify.ts`) says which kind a Bash
command runs, or null. The route and the hook's questions ask it, and it asks four things of
one walk of the line:

- **`classifyHeavyCommand`**: the first heavy kind the line runs, anywhere in it (any-heavy). A
  run that only prints is no heavy run.
- **`routableLine`** (`classifyRoutableLine` gives its kind): may the route queue the line? Only
  when every command in it is heavy, a `cd`, an assignment or glue (`GLUE_COMMANDS`, the readers
  of a pipe, the structure of a group; § The route), and at least one is heavy, or when one
  heavy command is piped into read-only filters. A script is followed into its body by the same
  rule (§ Scripts are read by their body).
- **`mixedHeavyLine`**: the other side of that question. It finds a line that runs heavy work
  which takes a slot (weighed as `runWeight` does) beside a command that is neither heavy nor
  glue, and names both, for the route's refusal (`mixedLineDenial`; § The route). It gives null
  for a line the queue takes whole (a script whose body runs heavy work is one), for a run that
  takes no slot, and for a line whose non-glue command sits in a package script's body or in
  shells nested too deep.
- **`runWeight(line, kinds, source)`**: how heavy is the run? `{ weight: "light" }` (it only
  prints, or names only existing files), `{ weight: "heavy", kind }` (it waits for a slot), or
  `{ weight: "none" }` (no heavy command in the line, a watch run, or a line that queues
  itself). The route and `job run` both ask it, so a line is judged the same where it is routed
  and where it runs. It unwraps `bash -c '…'` and `zsh -c '…'`, and reads each command's files
  in the folder it runs in (after a `cd`). **Light needs a positive finding**: every heavy
  command only prints or names existing files, and every other command of the line is one the
  reader understands: a `cd`, an assignment, glue (the same `GLUE_COMMANDS` and readers the
  route uses, § The route) or a script it followed. Anything else is heavy.

The classifier reads the line with the one shell reader the kit's hooks use
(`src/shell/command.ts`), so the queue and the other hooks see the same commands: a tool inside
quotes, an `echo`, a quoted here-doc, a comment or a commit message is text, not a run; a
substitution (`$( … )`, a backtick, the body of an unquoted here-doc) is a run. It finds the
tool behind `bunx`, `bun x`, `bun run`, `bun test`, `bun <name>`, `npx`, `npm exec`, `npm run`,
`pnpm`, `yarn`, `node_modules/.bin/` paths and `node <script path>`; behind a shell keyword
(`if`, `while`, `!`); behind the wrappers `time`, `timeout`, `nice`, `ionice`, `nohup`,
`stdbuf`, `env`, `cross-env`, `sudo`, `doas`, `exec`, `command`, `builtin` and `xargs`,
**with their own options**; inside `bash -c '…'`, `env -S '…'`, a here-doc or a pipe fed to a
shell; and behind a name the shell resolves first (`b\unx`, `$'bunx'`). `cross-env NODE_ENV=test
jest` is a `jest` run: its `VAR=x` words are stepped over. The reader's cases are pinned in
`src/jobs/shell-parity.test.ts`.

**A script is a script, not the tool of the same name.** To tell a script from a tool, the
classifier reads the project's `package.json` in the folder the line runs in, through an
injected reader (`packageScripts` in `src/jobs/package-scripts.ts`), once per folder and run. A
name that is a **script** there matches only a `script` rule, or is read by its body; a project
whose `tsc` script already wraps the type check is not queued a second time. A name that is **no
script** there is the package manager's `node_modules/.bin/<name>`, so a tool rule matches it.
With no `package.json` there, or one the reader cannot use, the answer is the tool: a broken
file is treated as no file. These cases are in `src/jobs/classify.test.ts` and, through the
hook, in `src/hooks/job-route.test.ts`.

## What 2.0 took out

2.0 took out the memory checks, CPU and I/O weights, systemd slices, `choom`, shared folders,
fair-share rules, the light lane and the old resource-setting commands. An old `jobs` setting or
machine `jobs.json` file is ignored since 2.0; no file is cleaned up.

**What came back** (§ CPU and memory limits), because one job could hang the machine:

- the slice, with a CPU quota and a memory ceiling for all heavy jobs together;
- the kill mark (`choom -n 900`) and `OOMPolicy=kill`;
- the probe: an empty scope tried before the job;
- the scope's kill and its emptiness check, and the memory line that names the killer.

**What did not come back:**

- **A memory gate before a start.** A job never waits for free memory. The slot and the caps
  bound it, and a job that reaches the cap is stopped and named.
- **I/O weights.** The jobs get no disk priority.
- **Shared folders, the fair-share rules and the light lane.** The slot count is still the
  only queue setting beside the two caps.
- **A change of `nice`.** The queue never changes a job's process priority. The kill mark is
  the one change to the job's own process, and only where `choom` exists.

Since 2.1, `job set max` chooses the heavy-job count, and since the limits, `job set cpu` and
`job set memory` choose the two caps.

## Limits

- **The limit caps concurrent full heavy runs (one by default).** It does not cap the memory or
  CPU one run uses. Where the caps apply (§ CPU and memory limits), the heavy jobs together stay
  under them: 90% of the CPUs and of the memory by default. Where they do not apply, one job
  alone may use all the machine's memory and every core.
- **The caps need Linux with a systemd user manager and cgroup v2.** The user manager must have
  the `cpu` and `memory` controllers; `doctor` names a missing one. On macOS, Windows, cgroup v1,
  a container without the controllers file, or a machine with no user session bus, the jobs run
  without limits. `doctor` reads cgroup files and the process list only, so it names a missing
  user manager or controller; a missing session bus shows only in the job's own line, because
  only a job's start probes systemd. The caps hold queued jobs only: a command you start
  without `job run` has no cap.
- **A container's own caps are not read.** The percentages are shares of the physical memory and
  of the CPUs the user manager sees, not of a container's memory limit or CPU quota. A container
  with a smaller cap than the machine has may be stopped by its own cap first.
- **The watchdog needs systemd-oomd running.** Without it the caps and the kill mark still
  apply, but nothing stops a job that stalls on memory below the cap. `doctor` warns.
- **A job may be stopped below the memory cap.** When the jobs' slice stalls on memory, the
  watchdog stops a job, even though the cap is not reached. That is the price of a machine that
  does not hang.
- **A kernel kill is read from the shared slice** when the job's scope is already gone, so with
  `job set max` above 1 two jobs that end at once can share one memory line.
- **The live stall test needs a page-scanning eater** (`python3`), because systemd-oomd picks
  its victim by page-scanning activity. A job that only holds memory is never picked.
- **It is machine-local**, not a distributed lock.
- **A `job run` killed with SIGKILL** frees its lease at the next look, but its job keeps
  running, unaccounted, in its scope with the limits still on it. In its own process group, a kill
  of `job run`'s group does not reach it either.
- **The job has no controlling terminal** (its own session): a job that asks a question on
  `/dev/tty` cannot, and Ctrl+Z stops `job run` only, not the job. Heavy jobs are builds and
  checks that ask nothing.
- **A hung job holds the slot for ever:** there is no timeout. Every waiting line names it.
- **Nesting is found on Linux only** (unchanged by the git hooks). On macOS and Windows, a heavy
  job must not start another one through `job run`.
- **Windows:** `job run` watches the job's first process, so a worker left behind is not seen
  and the slot is given back while it runs; and a holder whose start time cannot be read counts
  as alive (`windows-jobs.md`).
- **A dead ticket from another pid namespace** cannot be judged by its pid: it holds the line
  until it is stale, 30 seconds after its last touch.
- **The classifier's `typed.` rule for ESLint** can match a file whose name holds that text.
- **A heavy command run outside the Bash tool is never queued.** The route is a hook on the Bash
  tool only. A build or test run by another tool, such as an editor task, a script a hook starts or
  a program that starts its own children, never meets it. Start it with `job run` yourself.
- **A heavy command in `bash <(…)` or over `ssh` is never queued.** The route reads the line's
  own commands, and what a process substitution produces or what runs on another machine is not
  one of them. Put `job run` inside the script, or on the other machine, to queue it there.
- **Watch runs are never queued by the route**, and a run the judge cannot read is never
  called light: it keeps its slot. A `job run` you type holds a slot for a watch run too.
- **A package script's own body is never refused as a mix.** The route refuses a mixed line the
  person wrote, never one inside a script's body. A script such as `biome check . && tsc
  --noEmit` is queued whole when the call is the line's own command (§ Scripts are read by their
  body). A script that never ends, runs in the background or as another user, calls itself or
  nests too deep still runs raw: give it a kind (`{ "script": "<name>" }`), or split it into
  scripts of one job each.
- **Multi-package script forms are not read** (`--filter`, `-r`, `--workspaces`, `turbo`,
  `nx`): the line runs raw, or takes the slot of the kind you gave it.
- **lefthook's and pre-commit's YAML files are not read.** What their hooks run is invisible: a
  generated lefthook hook is queued only by a kind with `{ "tool": "lefthook" }` (every
  lefthook hook then waits, and so does a typed `lefthook …` line its `printOnly` does not name),
  not by `lefthook run`; the pre-commit framework's has no proved kind (§ Git hooks).
- **`tsc` on named files ignores `tsconfig.json`** and may pull in the whole import graph of
  those files, so a "light" run can still be large. Name few, narrow files.
- **vitest and `bun test` file arguments are filters**, not exact files. A named file that exists
  counts as light (Bun only with `./` or `/`), yet the runner may run more than it.
- **A waiting hook holds git's `index.lock`.** A `git commit` whose `pre-commit` waits for the
  slot keeps the lock, so another git command in that repo that needs the index fails until the
  hook runs.
- **The hook names are git 2.53's** (`HOOK_NAMES` in `src/jobs/git-hooks.ts`, from `git help
  githooks`). A hook name a later git adds has no script in the kit's folder, so for a prefixed
  command git finds no hook of that name and runs nothing. `doctor` does not compare the list
  with the running git's.
- **`git -C <other repo> commit` is judged with this session's project kinds**, while `job hook`
  reads the other repo's: with kinds of its own, that repo may get a prefix it does not need
  (harmless: its `job hook` answers `direct`) or miss one.
- **Git hooks are not prefixed on native Windows yet**: the scripts are `sh`, and the proof
  through Git for Windows is still to do. `doctor` says so.
- **The queue is not a substitute** for running targeted checks while building and one full
  check at the end.

See [the design](design/jobs.md).
