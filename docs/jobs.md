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

The same queue runs on native Windows, where a lease's start time and how a job's tree is
ended differ: [Windows](windows-jobs.md).

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
| `job status` | The limit, its source, who holds slots and who waits (the waiting jobs in the order the queue serves them, the same order the waiting line's place counts), and the job route for the folder it runs in: on or off, and whether the project, your own `switches.jobRoute` or the default decided. Stale files it finds are removed. Its lines and the portal's `/api/jobs` come from one reader (`src/jobs/status.ts`), so the queue has one shape and no printed line is parsed again. |
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
  which holds the job's own. The background hint: a call that runs the job in the foreground
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
- **The route needs every command of the body to be heavy or glue** (a `cd`, an assignment,
  glue such as `echo`, or another such script are fine; § The route). A **mixed** script —
  `biome check . && tsc --noEmit` — is never routed, because the queue would also hold the lint.
  The line that calls it is not refused either, because the other command sits in the script's
  body, which the person cannot split off their own line. To queue it, give the project a kind
  with `{ "script": "check" }`: the whole script then waits for one slot.
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
script's body. Outside git there is no project, so a heavy command there runs raw. The hook's other part, the launch judge, is always on:
`docs/design/hooks.md` § The Bash judge and the job route.

**A line is queued whole only when every command in it is heavy, a `cd`, an assignment or
glue** (`routableLine` in `src/jobs/classify.ts`; `classifyRoutableLine` gives its kind), and at
least one is heavy. Claude Code matches a person's own Bash rules (`deny`, `ask`) against the
words of the command it is about to run and does not look inside `bash -c '…'`, so a rewritten
`tsc && rm -f x` would hide its `rm` from a `Bash(rm:*)` rule (proved on 2.1.308,
`claude-code-contract.md`). **Glue** is a command nobody writes such a rule against, because it
cannot write a file or run another program. A line of heavy commands and glue — `cd app && bunx
tsc --noEmit && bunx vitest run`, or `bun run check; echo "exit $?"` — is queued as one job under
the first kind it runs: one slot for the whole line. What counts as glue (`isGlueCommand`):

- **The commands of `GLUE_COMMANDS`**: `:`, `[`, `echo`, `false`, `printf`, `pwd`, `test` and
  `true`, each only under its argument rule. `printf` needs a plain format that is no option
  (`-v` sets a variable, and bash runs a command in the subscript of its name). `test` and `[`
  take no `-v` or `-R` (the same subscript) and no word the shell fills in. A glue word holds no
  arithmetic, indirect or prompt expansion (`$(( … ))`, `$[ … ]`, `${x[ … ]}`, `${x:n}`,
  `${!x}`, `${x@P}`): bash reads a variable's value there as code.
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
other commands in a separate call. A refusal is a deny whoever is away: the session reads the
fix and retries, so nothing is parked. These lines are no mix, and stay as they were:

- a **light run** (named files, print-only), a **watch run**, and a line that **queues itself**,
  because they take no slot;
- a line whose only non-glue command sits in a **package script's body**, or in shells nested
  too deep: the person cannot split it off their own line, so the hook does not blame them;
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
  guards' short time budget, 8 s of the hook's 10).

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
  for a line the queue takes whole, for a run that takes no slot, and for a line whose non-glue
  command sits in a package script's body or in shells nested too deep.
- **`runWeight(line, kinds, source)`**: how heavy is the run? `{ weight: "light" }` (it only
  prints, or names only existing files), `{ weight: "heavy", kind }` (it waits for a slot), or
  `{ weight: "none" }` (no heavy command in the line, a watch run, or a line that queues
  itself). The route and `job run` both ask it, so a line is judged the same where it is routed
  and where it runs. It unwraps `bash -c '…'` and `zsh -c '…'`, and reads each command's files
  in the folder it runs in (after a `cd`). **Light needs a positive finding**: every heavy
  command only prints or names existing files, and every other command of the line is one the
  reader understands: a `cd`, an assignment, glue (the same `GLUE_COMMANDS` and readers the
  route uses, § The route) or a script it followed. Anything else is heavy.

The classifier reads the line with the one shell reader the guards use too
(`src/shell/command.ts`), so the queue and the guards see the same commands: a tool inside
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
hook, in `src/hooks/bash-judge.test.ts`.

## What 2.0 took out

There are no memory checks, CPU or I/O weights, systemd slices, `choom`, shared folders,
fair-share rules, light lane or old resource-setting commands. Since 2.1, `job set max` chooses
only the heavy-job count. The queue never changes process priority. An old
`jobs` setting or machine `jobs.json` file is ignored since 2.0; no file is cleaned up.

## Limits

- **The limit caps concurrent full heavy runs (one by default).** It does not cap the memory or CPU
  one run uses: one job alone may use all the machine's memory and every core.
- **It is machine-local**, not a distributed lock.
- **A `job run` killed with SIGKILL** frees its lease at the next look, but its job keeps
  running, unaccounted. In its own process group, a kill of `job run`'s group does not reach it
  either.
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
- **Watch runs are never queued by the route**, and a run the judge cannot read is never
  called light: it keeps its slot. A `job run` you type holds a slot for a watch run too.
- **A package script's own body can still mix.** The route refuses a mixed line the person
  wrote, never one inside a script's body. A script such as `biome check . && tsc --noEmit`
  runs raw, so its heavy part waits for no slot. Give the script a kind (`{ "script": "<name>" }`)
  to queue it whole, or split it into scripts of one job each.
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
