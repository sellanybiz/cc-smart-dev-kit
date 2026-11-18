# Heavy-job queue catches the real heavy work; sessions work in worktrees

**Summary.** The queue misses the work that loads the machine most: `bun test`, package scripts
and git hooks that run tests on commit or push. This plan queues those, and makes every light run
(print-only, a few named files) start at once with no wrapper. It also makes worktree-first the
kit's working default, so sessions stop editing the main checkout. Plan slug: `heavy-queue-coverage`.

## Context

The person found sessions overloading the machine although `switches.jobRoute` is on. Proved by
running `classifyRoutableLine` with `DEFAULT_KINDS` and this repo's `package.json`:

| Line | Today |
|---|---|
| `bunx tsc --noEmit`, `npx vitest run`, `next build` | queued |
| `bun test` (any form) | raw — `test` is in `BUN_COMMANDS` (`src/jobs/classify.ts:205`), `toolOf` returns undefined; even a project kind cannot match it |
| `bun run test`, `bun run typecheck`, `npm test` | raw — a script name matches only `{ script }` rules; the defaults have none; the body is never read |
| `git commit`, `git push` with a heavy hook | raw — the hook's `tsc` / tests run as git's child; the route sees only `git` |
| `bunx tsc --noEmit && bun test` | raw — `bun test` is not heavy, so the line is not "every command heavy" |

A light run is queued by mistake too: a line the route wraps as `<shell> -c '…'`
(`cd app && bunx vitest run a.test.ts`) reaches `job run` as `zsh -c …`; `toolCallOfArgv`
(`classify.ts:451`) does not look inside `-c`, `namesOnlyFiles` reads `-c` as a valued flag, finds
no operand, and the run takes a slot (`src/jobs/commands.ts:135-139`). No test covers it.

And sessions keep working in the main checkout: the `main-folder-guard` is off by default and off
here (`worktrees.guardMainFolder: false`), it sees only Edit/Write/NotebookEdit, and nothing puts a
session into a worktree.

**The person's rulings (2026-11-18):**
1. Light runs must not wait: a light line is left raw by the route and takes no slot.
2. `tsc` on named files is light, like vitest on named files.
3. Git hooks are queued through a kit hooks folder that git uses **for that one command only**:
   the route puts `GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=core.hooksPath GIT_CONFIG_VALUE_0=<folder>`
   in front of `git commit` / `git push` in a repo whose hook is heavy. Nothing goes into the
   person's settings. (Chosen over a session-wide setting, which breaks hook installers and
   leaks into editors and tmux started from a session.)
4. A package script is queued by its body only when **every** command in the body is heavy; a
   mixed script (`check`: lint + tsc + tests) is queued when the project names it in
   `jobs.kinds` (this repo adds `check`).
5. The worktree fix is part of this plan (one pull request).

## Research (condensed; full notes move to `.claude/research/archive/` on approval)

- **Claude Code permission matching** (code.claude.com/docs/en/permissions § Wrappers): "A deny
  or ask rule matches past any leading assignment, so `Bash(rm *)` in deny still matches
  `FOO=bar rm -rf tmp/`. An allow rule won't match past an assignment of any other variable."
  So the git prefix keeps the person's deny/ask rules working; an allow-listed `git push` may ask
  once more in manual mode. A rewritten `job run -- …` line hides its inner words from rules
  (contract row, proved on 2.1.308), which is why the route never wraps git or mixed scripts.
- **git** (git 2.53 docs, probed read-only by the senior engineer): `GIT_CONFIG_COUNT` pairs
  override config files and lose to `git -c`; with the pair set, `rev-parse --git-path hooks`
  answers the kit folder, with `GIT_CONFIG_COUNT=0` the real one. Local transports clear the pair
  (`environment.c` `local_repo_env`). `--no-verify` skips `pre-commit`, `commit-msg`,
  `pre-merge-commit`, `pre-push`; git just does not call them. A non-executable hook is skipped
  with a hint. Git ≥ 2.31 has the pair; the kit already needs 2.31.
- **husky v9**: `core.hooksPath=.husky/_`, a stub for every hook name; the stub runs
  `.husky/<name>` with `sh -e`, adds `node_modules/.bin` to PATH, honours `HUSKY=0`. So the shim
  must execute the stub (the file in the real hooks folder), and read `.husky/<name>` only to
  classify it. lefthook / pre-commit keep commands in YAML: classified by the hook file (light
  unless a kind matches, e.g. `{ "tool": "lefthook", "sub": ["run", "pre-push"] }`).
- **bun test** (bun.com/docs/cli/test): a positional argument is a path **filter**; only one
  starting with `./` or `/` names one file.
- **Settled facts in the code**: `spawnAndWait` passes stdin through (`src/jobs/launch.ts:105`),
  which pre-push needs; `writeManagedFolder` writes `0o644` only (`src/setup/managed-folder.ts`),
  so the shim needs an executable mode.

## Approach

### A. One light-run judge (`src/jobs/`)

`runWeight(line, kinds, source)` in `classify.ts` — the one home of "light / heavy(kind) / none",
used by the route, `job run`, the PowerShell denial and the broken-config ask
(`src/hooks/job-route.ts:283,404,427`):

- Unwraps `<shell> -c '<line>'` through `nestedCommand`; file operands are checked in the folder
  each command runs in (after a `cd`).
- **Light** only on a positive finding: every heavy-kind command is print-only (`isPrintOnly`,
  the documented any-option rule; `classify.ts`'s all-options `printsOnly` folds into it, test
  `tsc --noEmit --version`) or names only existing files under its kind's `noSlotForFiles`. A
  `job run --kind x` whose command the judge cannot read keeps its slot. Several heavy-kind runs
  sent to the background (`a & b &`) are not light.
- **Watch runs** (`--watch`, `vitest watch|dev`, `tsc -w`, `bun test --watch`) are never queued:
  they do not end, and a queued one would hold the slot for ever. Ruling, written in § Limits.

### B. Coverage (`src/jobs/`)

- **`bun test`**: `toolOf` turns it into `{ name: "bun", args: ["test", …] }`; defaults add
  `{ tool: "bun", sub: ["test"] }` to `test:run` and the `--coverage` form to `test:coverage`.
  Named files count only with a `./` or `/` start.
- **`tsc` on named files**: the `tsc` kind sets `noSlotForFiles`; `-p`, `--build`, no operand stay
  full runs.
- **Flag tables per tool** (`vitest`, `jest`, `bun test`, `tsc`), looked up by the matched call's
  tool; an unknown tool and every `{ script }` rule keep today's shared vitest/jest table, so a
  project kind behaves as before. No kind field is added: the project contract is unchanged.
- **Scripts by body**: `packageScripts` returns `ReadonlyMap<name, body>` from the nearest
  `package.json` walking up to the checkout root (as the runners do); `--cwd`, `-C`, `--dir`
  move the folder. A name with no `{ script }` match is classified by its body with the
  **all-heavy** walk (`routableKinds`); `$npm_execpath` reads as the runner; extra arguments go to
  a one-command body; `pre`/`post` scripts are added where that runner runs them (bun, npm, pnpm,
  yarn checked against their docs in the phase). A `(folder, script)` visited set stops cycles.
  Multi-package forms (`--filter`, `-r`, `--workspaces`, `turbo`, `nx`) are not read: § Limits,
  and a project kind covers them.
- **`cross-env`** joins the shell reader's wrappers (`invocationOf`, `src/shell/command.ts`), with
  its `VAR=x` words stepped over. The guards share the reader, so they see through it too
  (impact traced in the phase).

### C. The route (`src/hooks/job-route.ts`, `src/jobs/commands.ts`)

- A light line stays raw. `job run` decides its slot through `runWeight`.
- A routed line and a prefixed git line ask Claude Code for the Bash tool's longest `timeout`
  when the call set none (through the same `updatedInput`), so a wait does not end in a timeout
  that then tempts `--no-verify`. A live proof decides it; without one, the waiting line says
  "run it in the background" instead.

### D. Git hooks, per command

- **Where**: each segment of the line that is `git commit`, `git merge` or `git push` (read with
  git-guard's `gitCalls`, moved to a shared home in `src/shell/` so both use one git option
  reader; `-C` honoured; no prefix with `--no-verify` / commit's `-n`). The three assignments are
  inserted before that segment's first word, **byte for byte otherwise** (the shell reader gives
  the segment's offset; a line it cannot place exactly stays raw). Raw lines only: a routed line
  never holds git (git is not heavy), so a prefixed hook never runs inside a job — no nesting.
- **When**: the route is on for the repo, the kit folder is present with every file executable
  (one `stat` each time: a missing folder means no prefix, never a skipped hook), and that
  command's real hook is heavy. The real folder comes from
  `GIT_CONFIG_COUNT=0 git rev-parse --path-format=absolute --git-path hooks` (one git call, the
  guards' 5 s budget, inside the hook's 10 s). The hook body is classified **any-heavy** (nothing
  is hidden: the git line stays visible), following husky's stub to `.husky/<name>`.
- **The kit folder** `<dataDir>/git-hooks/` (path from `cliPaths()`): one POSIX `sh` script under
  every client-side hook name in `git help githooks`, plus `pre-receive`, `update`,
  `post-receive` and `post-update` as plain passthrough; never `push-to-checkout` or
  `proc-receive`, whose presence changes git's behaviour. Each script:
  1. finds the real hooks folder and the real file (absolute path); none → exit 0; husky stub
     whose `../<name>` is missing → exit 0 (no CLI start); a file git would skip (not
     executable) → print git's own hint, exit 0;
  2. asks `cc-smart-dev-kit job hook <name> </dev/null`, which prints `direct` or
     `queue <kind>` — any other answer, a missing launcher or a failing one → step 3 with
     `direct`, so a broken kit never blocks a commit;
  3. `direct`: `exec` the real file with git's args, stdin and environment; `queue <kind>`:
     `exec` the launcher's `job run --kind <kind> -- <real file> <args>` (stdin passes through).
  Setup writes it through `writeManagedFolder` with a new per-file mode option (`0755`, through
  `setFileMode`); `update` rewrites it; `restore` removes it. No settings key.
- **doctor**: the folder and every name present and executable; a stale copy (hash differs from
  this version's) is named with the fix `cc-smart-dev-kit setup`.
- **Windows**: the route does not prefix on native Windows yet (one doctor line); a follow-up
  project task holds the proof through Git for Windows' `sh`.

### E. Worktree-first

Why sessions stay in the main checkout (read in the code): the guard is off here
(`guardMainFolder: false`); it sees only Edit/Write/NotebookEdit
(`src/hooks/specs.ts:203-219`); the "always work in your own worktree" line lives in the opt-in
`plugin/instructions/optin/worktrees.md` only; and no session-start line tells a session in the
main checkout to move (`src/hooks/worktree-leftovers.ts` warns about the main checkout's branch,
never about the session's own place).

**The default stays as it is** (ruling, with the reason): `project init` already writes
`guardMainFolder: true` when its answer is yes, its default (`src/cli/project-init.ts:499-501`),
and deletes the key on a no (`src/project/init.ts:402-403`). So a missing key may be a person's
explicit no; turning "left out" into "on" would override it, and narrowing a field is a major
change (`.claude/rules/cc-smart-dev-kit-json.md`). New projects already get the guard; this plan
makes it work everywhere it is on, and turns it on here.

1. **Plan mode keeps working.** The guard lets a write into the session's plans folder through:
   `plansDirectory` resolved exactly as `verify-gate` does today (`src/hooks/verify-gate.ts:248-260`),
   moved to one shared home that both hooks import. Nothing else under `.claude/` is exempt.
2. **Bash writes in the main checkout are refused too** (same field, same refusal text with
   `EnterWorktree`). The guard's spec adds Bash; per step of the line it reads, with the shell
   reader the other guards use: redirection targets (`redirectionTargets`,
   `src/shell/command.ts:1365`), `tee` / `sed -i` / `cp` / `mv` / `rm` / `touch` / `mkdir` / `ln`
   operands, and git commands that change the work tree or its branch (`checkout`, `switch`,
   `reset`, `restore`, `stash`, `commit`, `merge`, `rebase`, `pull`, `cherry-pick`, `revert`,
   `apply`, `am`, `clean`) through `gitCalls`, moved from `src/hooks/git-guard.ts` to a shared
   `src/shell/` home (so git options are read by one reader). Each target is resolved in the
   folder the step runs in (after a `cd`, `git -C`). A literal target in the main checkout (not
   in a linked worktree, not in the plans folder) → deny. A word the reader cannot read
   (computed, `$VAR`) → let through, as the guard does today for anything it cannot work out.
   `/dev/null`, temp folders and paths outside the repo pass. Read-only git (`status`, `log`,
   `diff`, `fetch`, `worktree add`/`list`) passes, so a session can still look and make a worktree.
3. **A session told where it is.** At an attended session start in the main checkout of a project
   with the guard on, `worktree-leftovers` adds one line: this session is in the main checkout,
   and the first change goes into a worktree — `EnterWorktree` with the task's name (or
   `claude -w <name>` for the person). Silent in `claude -p`, in a worktree, and with the guard off.
4. **This repo turns the guard on** (`.claude/cc-smart-dev-kit.json`, main session, after phase 1
   is merged so plan mode is not blocked here).
5. **The handoff after plan mode.** The `plan-task` and `worktree` skills say it in one step: in a
   project with the guard on, enter the worktree first, then move the approved plan file into it
   (plan mode wrote it in the main checkout's plans folder). One home for the sentence; the other
   skill points to it.

Contract row `docs/claude-code-contract.md:448` (which root plan mode uses for `plansDirectory` in
a worktree session) is proved live by the main session before the guard phase's review.

## Edge cases (axes from `review/references/axes.md`; the reviews' findings folded in)

**Data and input**
- Script name equal to a tool (`"tsc": "tsc --noEmit"`): its body is read, `tsc` inside is the
  tool (the visited set stops a self-lookup).
- Body with an expansion the reader cannot read: no kind (raw); a test pins it.
- Broken / missing `package.json`, `scripts` not an object: no bodies; names behave as today.
- `bun test a.test.ts` (filter, not a path) and `bun test --bail a.ts` (optional value): heavy.
- vitest operands are filters too (`a.test.ts` matches `data.test.ts`): today's rule, unchanged,
  documented.
- tsc given files ignores `tsconfig.json` and, without `--noEmit`, writes `.js` files: the
  person's ruling stands; `docs/jobs.md` says so, and that one entry file may pull the whole
  import graph.
- Hook written in Node or Python: read as shell text, finds nothing, runs direct (light).
- A hook name a later git adds: not in the folder → that hook is skipped only for prefixed
  commands; doctor compares the folder against `git help githooks`' list of the running git.

**State and timing**
- Two sessions commit with heavy pre-commit hooks: oldest ticket first.
- A hook waiting for the slot holds `index.lock` (`git commit -a`) or an idle push connection:
  the waiting lines name the holder; § Limits says so.
- A kit update rewrites the folder while a hook runs: whole-file writes (temp + rename).
- `restore` while a session runs: no settings key exists, so nothing stale; the next line's
  `stat` finds no folder and prefixes nothing.

**Access**
- The person's deny/ask rules: still match the prefixed git line (documented above; a live
  proof adds the contract row). Mixed scripts are never wrapped; light lines are no longer wrapped.
- `git -c core.hooksPath=/dev/null` still wins.
- A line already carrying its own `GIT_CONFIG_*` assignment: no prefix.

**Environment**
- The pair reaches git's children (the hook and anything it runs); local transports clear it.
- Linked worktrees share the main checkout's hooks; `--path-format=absolute` keeps a relative
  husky path right from a subfolder.
- No YAML parser: lefthook / pre-commit commands are not read (§ Limits).

**Worktree guard**
- A session that must run something in the main checkout on purpose (the person asked for a
  fast-forward there): the guard denies with the reason; the person runs it, as the leftovers
  hook already tells them. No bypass flag is added.
- `bun run build` writing `plugin/dist` in the main checkout: a script's writes are not read —
  the guard catches literal targets only, and says so in § Limits.
- A subagent with `isolation: "worktree"`: its cwd is its worktree, so it passes; one started
  without isolation in the main checkout is refused, which is the point.
- Linked worktree nested under `<main>/.claude/worktrees/`: `innermostWorktree` already counts it
  as its own (tested today); the Bash path reuses the same test.
- `git worktree add` from the main checkout: read-only for the main work tree → passes.
- A redirect to a file the session just made in the main checkout (`> notes.txt`): denied — the
  file belongs in the worktree.
- `ownHooks` naming `main-folder-guard`: silences the Bash side too (one hook, one switch).

## What could break (consumers)

- `classifyHeavyCommand`, `routableLine`, `classifyRoutableLine`, `toolCallOfArgv`, `toolOf`:
  `src/hooks/job-route.ts:196,283,286,404,427`, `src/jobs/commands.ts:135`, `classify.test.ts`,
  `shell-parity.test.ts`. The new `bun test` and script answers reach the PowerShell denial and
  the broken-config ask; both move to `runWeight`.
- `packageScripts`: only `job-route.ts:372` and its test.
- `invocationOf` (`cross-env`) and `gitCalls` (moved): every guard that reads the shell or git —
  traced with `/cc-smart-dev-kit:impact-analysis` in their phases.
- `writeManagedFolder` (mode option): portal and every managed folder; default mode unchanged.
- `DEFAULT_KINDS`: `job kinds`, `kinds.test.ts`, `/api/jobs`.
- `main-folder-guard` gaining Bash: `specs.ts` (its matcher), `plugin/hooks/hooks.json` if it
  lists matchers per hook, `matrix.test.ts`, `fail-closed.test.ts`, `guards.test.ts`; `editedFile`
  is imported by `verify-gate.ts:47`. The plans-folder resolver moves out of `verify-gate.ts`.
- `gitCalls` moved: `git-guard.ts` and the merge reader import it from the new home.
- `worktree-leftovers` session-start text: `worktree-leftovers.test.ts`, the session-start rule's
  limits (`.claude/rules/session-start.md`).

## A simpler approach?

- Default `{ script }` rules for `test` / `typecheck` only: misses other names and light `test`
  scripts. Rejected.
- Wrapping git in `job run`: hides it from the person's rules. Rejected.
- A session-wide git setting: breaks installers, leaks to editors and tmux. Rejected by the person.

## Rollback

Each phase is its own commit. A release that reverts them is the rollback; `restore` (or the
reverted version's setup) removes the kit folder. No settings key and no project field is added,
so no project or settings file needs a change.

## How we prove it

- **Failing tests first**: `bun test` → `test:run`; `bun run typecheck` (body `tsc --noEmit`) →
  `tsc`; `"$npm_execpath" test` → `test:run`; a mixed `check` body → raw; a shell-wrapped
  named-file vitest line → light; a shell-wrapped full run → heavy.
- `shell-parity.test.ts` rows for every new form; `job-route.test.ts` rows for PowerShell and
  the broken-config ask.
- The kit folder against **real git** in temp repos (`src/testing/`): `.git/hooks`,
  `core.hooksPath`, husky v9 (non-executable `.husky/pre-commit`, no `post-commit`: no CLI
  start), no hook, non-executable hook, `--no-verify`, pre-push stdin, a launcher that exits 1
  (the hook still runs and its own exit code comes back), a subfolder and a linked worktree.
- Setup / update / restore / doctor with the fake machine and a temp `HOME`; `--dry-run`.
- **Live proofs, main session, first** (they gate the git phases): a deny rule
  `Bash(git push *)` still fires on the prefixed line; `updatedInput` can raise `timeout`; then a
  throwaway repo with a husky pre-push running `bun test`, two sessions pushing at once — the
  second prints the waiting line — and `bun test ./one.test.ts` starting at once. Contract rows
  for each.
- **Worktree guard tests first**: an Edit of `<main>/.claude/plans/x.md` passes (fails today
  when the guard is on); `echo x > <main>/a.txt`, `sed -i … <main>/a.ts`, `git checkout -b x` and
  `git commit` in the main checkout are denied; the same in a linked worktree pass; `git status`,
  `git worktree add`, `> /dev/null`, a `$VAR` target pass.
- Session-start line: attended in the main checkout with the guard on → one line; worktree,
  `claude -p`, guard off → none.
- Live (main session): plan mode in the main checkout with the guard on writes its plan file;
  a Bash `echo > file` in the main checkout is refused with the `EnterWorktree` step.
- `bun run check` once at the end, both validates, `build:check`, `check:portal` untouched.

## Phases

Worktree from `main` (the main checkout is on `main`; `feat/deploy-tasks` has its own worktree).
Builders: `cc-smart-dev-kit:builder`, `sonnet`, `high`; reviews: `sonnet` `high`, except the
shell reader, git and setup phases (`opus` `xhigh`).

| Phase | Area and files | Blocked by |
|---|---|---|
| `judge` | `src/jobs/classify.ts`, `kinds.ts`, `package-scripts.ts`, `src/shell/command.ts` (`cross-env`) and their tests, `shell-parity.test.ts` | — |
| `route` | `src/hooks/job-route.ts`, `src/jobs/commands.ts` and tests (light lines raw, `job run` slot, PowerShell and ask paths, timeout) | `judge` |
| `hookfolder` | `src/jobs/git-hooks.ts` (new: real folder, hook body, husky), `src/jobs/hook-command.ts` (new: `job hook`), the folder's script text, `src/setup/managed-folder.ts` mode, setup / update / restore wiring, `src/cli/paths.ts`, `src/jobs/doctor.ts`, tests with real git | `judge` |
| `guard` | `src/hooks/main-folder-guard.ts` (Bash side, plans exemption), the plans-folder resolver moved out of `src/hooks/verify-gate.ts`, `gitCalls` moved from `src/hooks/git-guard.ts` to `src/shell/git-calls.ts`, `src/hooks/specs.ts` (matcher), tests | — |
| `gitroute` | the git prefix in `src/hooks/job-route.ts` (uses `src/shell/git-calls.ts`), tests | `route`, `hookfolder`, `guard` |
| `nudge` | `src/hooks/worktree-leftovers.ts` session-start line, its tests | — |
| `docs` | `cc-smart-dev-kit:rules-maintainer`: `docs/jobs.md`, `docs/design/jobs.md`, `docs/design/hooks.md`, `docs/design/setup.md`, `README.md`, `CHANGELOG.md`, `.claude/rules/setup-and-managed-files.md` (a second owned folder), `plugin/skills/plan-task` and `plugin/skills/worktree` (the handoff step), contract rows | all |

Waves: **1** `judge`, `guard`, `nudge` · **2** `route`, `hookfolder` · **3** `gitroute` · **4** `docs`.

Main session keeps: the live proofs, wiring `job hook` into `commands.ts`, this repo's
`.claude/cc-smart-dev-kit.json` (`guardMainFolder: true` once `guard` is merged, and
`jobs.kinds.check`), the version bump, `bun run build` with `plugin/dist`, the final full check
and the final review (`opus`, `xhigh`).
Follow-up project tasks: Windows git prefix; project Claude Code hooks and dev servers outside the
queue; per-job memory cap; lefthook/pre-commit YAML.
