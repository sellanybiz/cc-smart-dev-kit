# Mixed lines: heavy work never runs past the queue (`mixed-line-route`)

**Summary.** A heavy command inside a mixed Bash line (`bun run check; echo "exit $?"`,
`echo start && bun test`, `bun test; git status`) runs raw, and nobody is told. Lines whose
other commands are only harmless glue will be queued whole; any other mix with heavy work is
refused, with the fix spelled out. One route phase, one docs phase, then a minor release.

## Context

Seen live on 2026-11-19 with the installed 5.3.0. A session ran
`OUT=…; { echo …; bun run check; …; claude plugin validate …; ( cd portal && bun run test ); … } > $OUT 2>&1`
and the CPU went to 100%, while `job status` showed 0 of 1 slots in use. The real hook,
fed the same lines (probe: `scratchpad/route-probe.sh`), gave:

| Line | Today |
|---|---|
| `bun run check` / `… 2>&1 \| tail -20` / `cd portal && bun run test` / `bun run typecheck && bun test` | queued |
| `bun run check; echo "exit $?"` / `echo start && bun test` / `bun test; git status --short` / `bun run check && claude plugin validate …` / the session's block | **raw, no answer** |

**The cause.** `routableLine` (`src/jobs/classify.ts`) queues a line only when every command
in it is heavy, a `cd` or an assignment. That rule protects the person's permission rules:
Claude Code matches `Bash(...)` deny and ask rules against the command it runs, so a wrapped
`tsc && rm x` would hide the `rm` (proved on 2.1.308). But when the rule says no, `jobRoute`
(`src/hooks/job-route.ts`) answers nothing at all: the heavy part runs raw, silently.

**The owner's decision (2026-11-19): "Safe glue + refuse rest".**

## Approach

### 1. Glue may ride in a queued line (`src/jobs/classify.ts`)

In `scan`'s `all` mode (the route's rule), a step that is **glue** passes, like a `cd` or an
assignment. A line is still routable only when it holds at least one heavy command.

Glue has two parts.

**Commands nobody writes permission rules for:**
- `echo`, `printf`, `true`, `false`, `:`, `pwd`, `test`, `[`.
- Their arguments may hold expansions (`echo "exit $?"`). None of them can write a file or run a program.

**Output readers, from `READ_ONLY_FILTERS`, with that table's own argument checks:**
- **The one list stays one.** The glue reader reuses each program's `FilterCheck`, and a new
  reader added to the table is glue too.
- **Two differences from a filter in a pipe:**
  - A reader may name files (`tail -5 out.log`, `grep -E "exit" $OUT`), because reading a file changes nothing.
  - `cat` may name files.
- **Readers whose check reads their script or options** (`sed`, `awk`, `sort`, `uniq`, `rg`,
  `tee`): glue only when no word is filled in by the shell. Their check must see the real
  words. `tee` stays glue only with no file (`teeWritesNoFile`), as in the filter rule: a
  person's `Bash(tee:*)` rule must see a `tee` that writes.

**Structure, not commands:**
- The empty steps and bracket steps left by `{ … }` and `( … )`.
- A step that is only redirections (`} > out.log 2>&1`).

These pass when every real command inside them passes. Today they make every group unroutable.

**What glue never covers:**
- A substitution's inner command is its own step (checked: `echo $(rm -rf x)` reads `rm`), so it is judged on its own.
- A runner (`find`, `watch`, …), a wrapper, or a program not in the lists above.

`runWeight` treats glue as understood, so glue beside a light run keeps it light.
`bun test ./a.test.ts; echo done` stays raw, and nothing is refused.

**Where the glue table lives.** Next to `READ_ONLY_FILTERS` in `classify.ts`, with a doc
comment that says why each entry is safe. It is the one list: `docs/jobs.md` and the README
quote it from there.

### 2. Any other mix with heavy work is refused (`src/hooks/job-route.ts`)

New function `mixedLineDenial(command, kinds, source)`, next to `powerShellDenial` and
`routeDenial`. It is used in `jobRoute`'s Bash branch, before `routeGitHooks`:
- **When:** the route is on and `routeHeavyCommand` gave null.
- **What it checks:** whether the line holds an unqueued heavy run. That is
  `classifyUnqueuedHeavy` (a line that already runs `job run` gives null), weighed heavy by `runWeight`.
- **If so:** deny (`toolDecision("deny", …)`).
- **So:** `bun test && git commit -m x` is refused, not git-prefixed with a raw `bun test` beside it.

The deny reason is short and plain:
- **The why:** this line runs heavy work (`<kind>`) beside other commands. The queue cannot
  take it whole without hiding those commands from your permission rules, and run raw it
  would not wait for a slot.
- **The fix:** run the heavy command on its own line, where it waits for a slot. It may keep
  a `cd` before it, a redirection, a pipe into `tail`/`head`/`grep`, and `echo`/`printf`
  around it. Then run the rest in a separate call.
- **The command:** when the scan can name the heavy step's text, the reason quotes it.

**Unchanged:**
- Route off: silent. Outside git: silent.
- A PowerShell line keeps `powerShellDenial`.
- A git-only line keeps `routeGitHooks`.
- A line the reader cannot read is let through, as the hook's contract says.
- While the person is away, a deny stays a deny (not an ask), so nothing is parked.

## Files to change

- `src/jobs/classify.ts`, `src/jobs/classify.test.ts`
- `src/hooks/job-route.ts`, `src/hooks/job-route.test.ts`
- `docs/jobs.md` (§ The route: `job-route`, § The classifier, § Limits)
- `README.md` (the `job-route` row, its "anything else runs raw" sentence)
- `docs/design/hooks.md` (only if it states the route's every-command rule; the builder checks)
- Release, in the main session: `CHANGELOG.md`, `plugin/.claude-plugin/plugin.json`,
  `install.sh`, `install.ps1`, `plugin/dist/`

## Patterns to follow

- **One shell reader:** `src/shell/command.ts`. No new splitting; a new spelling is fixed in the reader (`.claude/rules/hooks.md`).
- **One filter list:** `READ_ONLY_FILTERS` and its `FilterCheck`s are reused, not copied.
- **Deny answers:** `toolDecision("deny", …)`, the same shape as `powerShellDenial` and `routeDenial`.
- **Tests:**
  - `routeHeavyCommand` / `routableLine` rows in `classify.test.ts`, and `jobRoute` through `contextFor` in `job-route.test.ts`.
  - Expected values are written by hand, and every new row fails first (`.claude/rules/testing.md`).

## Edge cases

- **Glue hiding a dangerous command:** `echo $(rm -rf x) && bun test`. `rm` is its own step, so the line is refused, not queued.
- **`tee` writing a file:** `bun test | tee out.log`. That's the existing filter rule; with a file it is not glue, so a mixed line is refused.
- **Expansions:**
  - `echo "exit $?"` and `grep x $OUT`: glue.
  - `sed "$S" f`: not glue, because its check cannot read the script.
- **Groups and subshells:**
  - `{ echo a; bun test; } > out.log 2>&1`: queued whole.
  - `( cd portal && bun run test )`: queued.
  - A group holding `claude …` or `git status`: refused.
- **`[ -d node_modules ] || bun install && bun test`:** `bun install` is not glue and not heavy, so the line is refused, with the fix.
- **A light run beside other commands** (`bun test ./a.test.ts; git status`, the file exists): not refused. A test pins it.
- **A watch run beside other commands** (`bun test --watch; echo x`): weight none, not refused.
- **A line that already queues itself** (`cc-smart-dev-kit job run -- bun test; echo done`): not refused.
- **Heavy work with a git command** (`bun test && git commit`): refused. A git-only line still gets the hooks prefix.
- **Exit codes:** a line queued whole runs through the person's shell (`routedShell`), so `$?`, `&&` and `;` behave as written.
- **A refusal loop:** the session's split line (`bun run check > log 2>&1`) is queued. A test proves the line the reason suggests is routable.
- **Route off, outside git, PowerShell:** unchanged (existing tests keep passing).
- **Cost:** one extra any-heavy scan, only on lines the route did not take. Linear, within the hook's budget (`.claude/rules/hooks.md`, the 64 KB test).

## What could break

- **`routableLine` / `classifyRoutableLine`:** callers `job-route.ts` (`routeHeavyCommand`, `powerShellDenial`) and `job hook`'s classifier path. More lines become routable, and a test pins each new shape.
- **`runWeight`:** shared by the route and `job run`'s slot judgment (`src/jobs/commands.ts`). Glue becoming understood can only turn heavy into light where the rest is a light run. Pinned by tests.
- **Sessions that today run a mixed heavy line raw** will get a refusal and one retry. That is intended; the reason carries the fix.

## A simpler approach?

- **Refuse every mixed line, with no glue:** simpler, but every `bun run check; echo $?` costs a retry. The owner chose glue.
- **Queue the whole line:** hides inner commands from deny rules. Rejected.

## Rollback

Revert the release commit. The route returns to "every command heavy, else silent". No state, schema or config changes.

## How we prove it

- **Red first:** before the fix, new rows fail in `classify.test.ts` (glue lines not routable) and in `job-route.test.ts` (mixed heavy lines answer nothing).
- **The live table above, through the real hook** (`route-probe.sh` against the built bundle):
  - each "raw" line becomes queued (glue only) or refused (other mix);
  - the queued lines stay queued.
- **Checks:** `bun run check`, both `claude plugin validate --strict`, CI on the pull request.
- **Only you can judge:** after the update, a session's next mixed heavy line is refused with
  the fix, and `cc-smart-dev-kit job status` shows its retry waiting in the queue.

## Phases

| Phase | Files | Builder | Waits for |
|---|---|---|---|
| `route`: glue in the routable rule, and the refusal of other mixed heavy lines | `classify.ts`, `classify.test.ts`, `job-route.ts`, `job-route.test.ts` | `cc-smart-dev-kit:builder`, sonnet, high | — |
| `docs`: the route's rule and its refusal in the docs | `docs/jobs.md`, `README.md`, `docs/design/hooks.md` | `cc-smart-dev-kit:builder`, sonnet, high | `route` |

- **Reviews:** each phase by `cc-smart-dev-kit:senior-engineer`. `route` touches a guard's
  answer, so it gets `opus` at `xhigh`; `docs` gets `sonnet` at `high`. Then one final review
  on `opus` at `xhigh`.
- **Release (main session):** the next free minor version over `main` at merge time (another
  plan targets 5.4.0), the CHANGELOG, the bundles and the full check.
