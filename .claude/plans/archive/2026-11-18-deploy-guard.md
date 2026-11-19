# Deploy guard and CI check: open deploy tasks hold a deploy

Slug: `deploy-guard`. On approval this file moves to `.claude/plans/2026-11-18-deploy-guard.md`
on the plan branch `feat/deploy-guard`, in its own worktree.

## Summary

1. A new guard asks you before Claude runs one of the project's own deploy commands while that
   environment has an open blocking problem in its deploy tasks.
2. `task release <env> --check` judges the task files alone, with no git rules, so a CI deploy
   job can run it; the README shows the CI step (docs only, nothing written into the project).
3. One pure check of the task files, `judgeTasks`, holds the rules: the guard, `--check` and the
   before gate all use it.

## Context

5.0.0 made deploy tasks and the `task release` gates, but nothing enforces them. Claude follows
them only when it loads the tasks skill or the project's deploy skill. A deploy command run
directly, or a CI deploy on merge, ignores open tasks. Decisions (the person, 2026-11-18):

- **Scope:** both the guard and a CI check, in one plan.
- **Guard answer:** `ask` (a permission prompt naming the problems), never `deny` or `allow`.
  While the person is away, the hook frame already turns an ask into a deny and parks it.
- **Guard check:** the task files only; no git calls and no deploy-branch rules in the hook.
- **CI delivery: docs only.** No script or file is written into a project. The README shows a CI
  step that fetches the kit's `plugin/dist/cli.js` at a pinned commit and runs `--check` with Bun.
  (A Node script was ruled out: the task-file parser is `Bun.YAML`, `format.ts:134`, and the
  version check is `Bun.semver`, `version-range.ts:31`; on Node every file would read as broken.)

Version: the next minor (5.1.0, or 5.2.0 if the queued 5.1.0 plan ships first). The main session
sets it at release, with the since-table constants below.

## Code exploration (facts the design rests on)

- **Gate rules:** `src/tasks/deploy/release.ts`. `judgeBefore` (:167) gives, in this order: the
  env refusal (`envRefusal` :142), the wrong-branch refusal (`notOnDeployBranch` :113), the HEAD
  refusals (:175-190), open blocking `before` tasks (:192), `brokenRefusals` (:130), and for prod
  the twin loop over `mine` (every open task of the env, :191, :199-213), then non-blocking
  notes (:216-220). No function judges the task files alone.
- **Scanner:** `scanDeployTasks(dir, {archive})` (`src/tasks/deploy/files.ts:74`): `fs` reads, no git.
  `deployTaskLine` (`src/hooks/task-start.ts:28`) already scans in a hook.
- **A CI checkout** is detached and often shallow: `--before` refuses it, and `readGitFacts` needs
  `origin/<base>` and history.
- **Hook frame:** `src/hooks/run.ts` (input, `locateCheckout`, `ownHooks`, `loadProjectConfig`,
  `onConfigProblem`, `onCrash`, the away step, the ask log); answers via `toolDecision`
  (`src/hooks/io.ts:115`). Only merge-guard may answer `allow`.
- **Tool readers:**
  - `invocationOf` and `nestedCommand` (`src/shell/command.ts`) give the program and its nested shells.
  - The real tool behind `npx`, `bunx`, `bun x`, `npm exec`, `pnpm|yarn exec|dlx`,
    `node <path>` and every package-manager script spelling is found by `toolOf`, `toolName` and
    their flag tables in `src/jobs/classify.ts:261-339`.
  - Commands are matched by the rule grammar `matchRuleSchema` (`src/jobs/kinds.ts:5-22`:
    `{tool, sub, flags, argIncludes}` or `{script}`) and `ruleMatches` (`classify.ts:367`).
  - Most guards walk the line themselves (git-guard :608/:710, session-escape :529, job-route,
    classify :409), so new entries in `invocationsOf` would reach almost none of them.
  - job-route's `plainWords` (`job-route.ts:114`) depends on `invocationOf`'s program.
- **Registration:** logic in `src/hooks/`, spec in `specs.ts` `HOOKS`, entry
  `src/entries/<name>.ts`, `plugin/hooks/hooks.json` (`Bash|PowerShell`, `--missing=ask`,
  `onFailure: "block"`), a row in `src/hooks/matrix.test.ts`; `entries.test.ts` checks they match.
  A switchable name needs `PLUGIN_HOOK_NAMES` (`config.ts:17`) and `OWN_HOOK_NAMES_SINCE` (:143).
- **Config:** `tasks` is a `strictObject` (`config.ts:303`); since-table and floors
  (`DEPLOY_TASKS_SINCE` :170); `requiresFloor` (`src/project/init.ts:239`); rule
  `.claude/rules/cc-smart-dev-kit-json.md`. A refine failure refuses the whole file, and then every
  guard fails closed.
- **Init and doctor:** `Prompts.ask` takes free text with a default (`src/cli/ui/prompt.ts:58`).
  The deploy-skill block text is `deployBlockBody()` (`src/project/deploy-block.ts`); its first
  line `## Deploy tasks` is a contract. Doctor compares the block's exact text
  (`project-checks.ts:613-619`).
- **Shipping:** the kit repo is public, has no release tags and no npm package;
  `plugin/dist/cli.js` is one Bun bundle. This repo's own CI uses `oven-sh/setup-bun@v2`.

## Approach

### 1. One check of the task files (`judgeTasks`)

`judgeTasks(env, scan): { refusals: string[]; notes: string[] }` in `release.ts`: open blocking
`before` tasks, broken files and repeated ids, and for prod the twin loop exactly as today
(over every open prod task, so an open prod after-task whose staging twin is open also holds a
prod deploy: today's gate rule, kept). Notes are the open non-blocking `before` tasks. The env
refusal stays outside it.

`judgeBefore` becomes: env refusal, wrong-branch, HEAD refusals, then `judgeTasks`'s refusals and
notes. **First**, before any refactor, a new test pins one exact array holding all six kinds in
today's order; it must pass unchanged after.

`task release <env> --check [--json]`: env refusal plus `judgeTasks` on
`scanDeployTasks(dir, {archive: true})`, in the folder it runs in. No git reads beyond finding the
checkout. Works detached and shallow. Exit 0 / 1 / 2. `--check` with no env, or with `--before`,
`--after` or `--ref`, is a usage error (2). `--json`: `{ok, refusals, notes}`.

### 2. Where a project lists its deploy commands

New optional field `tasks.deployCommands`: `{ "prod"?: Entry[], "staging"?: Entry[] }`. Each entry
is a string or a `MatchRule` (the jobs grammar, `matchRuleSchema`, imported from `kinds.ts`).

- **A string** is one command as typed (`"vercel --prod"`, `"npm run deploy:prod"`,
  `"./scripts/deploy.sh prod"`), read once at load time by the same reader the guard uses.
  - A package-manager script becomes `{script}`, so `npm run x` also matches `pnpm x`, `bun run x`
    and `npm run-script x`.
  - A runner (`npx vercel`) gives its tool.
  - Leading assignments and wrappers are stepped over.
  - The rest become the rule's `tool` and the required words (each word equal, never contained:
    `--prod` does not match `--production`), in order, with extra words allowed.
- **The schema refuses** a string holding a separator (`;`, `&&`, `||`, `|`), an empty list, and
  a key not in `tasks.envs` (unset `envs` means both). The message names the entry.

Core also adds `deploy-guard` to `PLUGIN_HOOK_NAMES` and `OWN_HOOK_NAMES_SINCE`, with
`deployCommands` in the since-table; `requiresFloor` raises `requires` when the field is set.

### 3. One home for the tool readers (`src/shell/`)

`toolOf`, `toolName`, their flag tables and `ruleMatches` move from `src/jobs/classify.ts` to
`src/shell/` (one file, e.g. `src/shell/tool.ts`); `classify.ts` imports them, and the jobs tests
pass unchanged. One case is added there: a shell or interpreter given a script file runs that
file:

- `bash|sh|dash|ksh|zsh <file>`, and those shells' flags with values (`-o pipefail`);
- `source <file>` and `. <file>`;
- `node|python <file>`;
- `bun <file>` vs `bun <subcommand>` (through `BUN_COMMANDS`).

`invocationOf` and `invocationsOf` do not change, so no other guard's answer changes; a test per
consumer proves it (`npx tsc`, `bash x.sh "a; git push -f"`, PowerShell `npx tsc`).

### 4. The guard (`deploy-guard`)

PreToolUse on `Bash|PowerShell`; project-scoped (silent with no project file or no
`deployCommands`); switchable through `ownHooks`; timeout 10 s.

- **Walk** the line the classifier's way (steps, `cd`, nested shells through `nestedCommand`),
  and test each run against every rule with `ruleMatches`.
- **Computed program** (`$DEPLOY --prod`): it counts as a match only when the rule has at least
  one required word beyond the tool and the run's args hold them all. A rule with only a program
  never matches a computed run.
- **On a match:** `scanDeployTasks(dir, {archive: true})`, env refusal plus `judgeTasks` per
  matched env. Refusals → `ask`, naming them and the way out ("do the task and close it with
  evidence, `/cc-smart-dev-kit:tasks`, or drop it yourself in your own terminal"); notes alone
  never ask. No refusal → silent.
- **Broken config:** the frame's config problem is answered by reading `tasks.deployCommands`
  leniently from the raw JSON. If a listed command runs, ask, naming the broken config and the
  matched command. If the raw JSON gives no list, stay silent and print one stderr line (doctor
  already fails on the broken file). It never asks on every `ls`.
- **Failures:** crash → ask (`onCrash`); timeout and a missing bun → `onFailure: "block"` and
  `--missing=ask`.
- **Log:** `logFacts` holds the env and the rule's index, never the command text (a pattern may
  hold a token).

### 5. The CI step (docs only)

The README (task release row and a "Deploy tasks in CI" section) shows, for GitHub Actions,
before the deploy step:

```yaml
- uses: oven-sh/setup-bun@v2
- run: |
    curl -fsSL https://raw.githubusercontent.com/<owner>/cc-smart-dev-kit/<commit>/plugin/dist/cli.js -o "$RUNNER_TEMP/kit.js"
    printf '' > "$RUNNER_TEMP/bunfig.toml"
    bun --no-env-file --config="$RUNNER_TEMP/bunfig.toml" "$RUNNER_TEMP/kit.js" task release prod --check
```

The docs explain each part:

- **The empty bunfig:** it stops the project's own `bunfig.toml` preload, the same as the
  plugin's shim.
- **The pinned commit:** move it when you update the kit. An older kit refuses a config whose
  `requires` is newer.
- **Other CI systems:** the same three commands.
- **A hosting platform that deploys on push** (its own Git integration): put the same commands
  in its build command, where Bun must be present. Otherwise neither rail sees that deploy.

`<owner>` stays a placeholder (neutral). The core phase proves this path in a test: it copies the
built `cli.js` alone to a temp folder and runs it with a temp `HOME`, in a detached, shallow
clone, through the same `bun --no-env-file --config=<empty>` line.

### 6. `project init`, `doctor` and the deploy block

- **`project init` asks** for each environment in `tasks.envs`: "A command that deploys to <env>
  (Enter when done)". It asks again until Enter. On the first question, Enter keeps the current
  list and `-` clears it.
- **With no terminal:** `--deploy-command <env>=<command>` (repeatable; split at the first `=`)
  replaces that env's list, so a re-run with the same flags gives the same file.
  `--deploy-command <env>=` clears it.
- **The deploy-skill block** gains one line after `## Deploy tasks`, true with or without the
  field: "When `tasks.deployCommands` lists this project's deploy commands, the deploy guard asks
  before one runs while a blocking task is open." Doctor then flags every existing block as out
  of date until `project init` runs; the CHANGELOG says so.
- **`doctor`** shows an information line (`·`) when the project has a deploy skill but no
  `tasks.deployCommands`, with the fix: `project init`.

## Files to change

| Phase | Files |
|---|---|
| core | `src/tasks/deploy/release.ts`, `src/tasks/command.ts`, `src/project/config.ts`, `src/project/init.ts` (`requiresFloor` only), `src/jobs/kinds.ts` (export only, if needed), their tests, the `cli.js`-alone CI test |
| guard | `src/shell/tool.ts` (new, moved from `classify.ts`), `src/jobs/classify.ts`, `src/hooks/deploy-guard.ts` (new), `src/entries/deploy-guard.ts` (new), `src/hooks/specs.ts`, `plugin/hooks/hooks.json`, `src/hooks/matrix.test.ts`, guard and per-consumer tests |
| init | `src/cli/project-init.ts`, `src/project/init.ts`, `src/project/deploy-block.ts`, `src/cli/project-checks.ts`, tests |
| docs | `plugin/skills/tasks/SKILL.md` § 5, `README.md` (the field, the hooks list and table, the `ownHooks` row, `release --check`, `project init` flags, the CI section), `docs/design/tasks.md`, the hooks design page, `.claude/rules/cc-smart-dev-kit-json.md`, `CHANGELOG.md` |

No skill or agent description and no `core.md` text changes: both context budgets sit exactly at
their max. `docs/claude-code-contract.md` needs no row (no new Claude Code behaviour).

**`plugin/dist`:** builders build in their own worktree to run tests and never commit
`plugin/dist`; the main session rebuilds and commits it after each merge. Version bump and the
full check stay with the main session.

## Phases and waves

| Phase | Builder | Blocked by |
|---|---|---|
| core: `judgeTasks`, `release --check`, the config field, the hook name | builder, sonnet, high | — |
| guard: the tool reader's one home and `deploy-guard` | builder, sonnet, high | core |
| init: the questions and flags, the doctor line, the block line | builder, sonnet, high | core |
| docs: skill, README, design pages, rule, CHANGELOG | rules-maintainer, sonnet, high | guard, init |

Waves: core → guard + init in parallel (no shared files) → docs. Reviews: senior-engineer, opus
xhigh for core and guard (deploy plumbing, a guard, the shared reader); sonnet high for init and
docs. Final whole-branch review: opus xhigh.

## Edge cases

- **Spellings that must match** (a table test each):
  - runners: `npx vercel --prod`, `bunx`, `pnpm dlx`;
  - prefixes and wrappers: `VERCEL_TOKEN=x vercel --prod`, `cd app && vercel --prod`,
    `bash -c "vercel --prod"`, `sudo`, `timeout 600 …`;
  - script spellings of `npm run deploy:prod`: `pnpm deploy:prod`, `yarn deploy:prod`,
    `bun run deploy:prod`, `npm run-script deploy:prod`, `npm --prefix app run deploy:prod`;
  - script files: `bash scripts/deploy.sh prod`, `bash -o pipefail scripts/deploy.sh prod`,
    `. scripts/deploy.sh` for `./scripts/deploy.sh prod`;
  - PowerShell `vercel.cmd --prod`;
  - a job-queued `<kit> job run -- vercel --prod`.
- **Must not match:** `vercel --production` for `--prod`; a one-word rule against `$X foo`;
  `echo vercel --prod`.
- **Over-match accepted:** `vercel --prod --help`. The guard only speaks while a blocking
  problem exists, and then it asks.
- **Not seen, and the docs say so:**
  - a command not listed, or spelled another way (`--target=production`);
  - `xargs` feeding the words;
  - a deploy through an MCP tool;
  - a platform's deploy on push without the CI step;
  - a branch cut before main gained a blocking task, or `cd ../other`: the guard judges the
    tasks of the hook's `cwd` checkout, with no git;
  - a hand edit of the config or a task file.

  The guard is a rail against a skipped step, not a lock.
- **Config:** `envs` unset means both; a key outside `envs`, an empty list, or a separator inside
  a string is a config error with the entry named, and the guard then follows its broken-config
  rule.
- **Broken task file or repeated id:** a refusal, so the guard asks.
- **No tasks folder:** no tasks, silent. **Away:** the frame parks the ask.
- **Time:** the scan with `archive` reads small files; milliseconds for a large archive.
- **CI:** a detached, shallow checkout needs only `git rev-parse` to find the root. A config
  newer than the pinned kit exits 1 with "update"; the docs say to move the pin.
- **Neutral:** only neutral example commands (`vercel`, `fly`, `./scripts/deploy.sh`) in tests
  and docs; `<owner>` stays a placeholder.

## What could break

- `judgeBefore`'s callers: the new six-kind exact test and the existing tests guard its output.
- The jobs classifier: the moved readers keep their behaviour; `src/jobs` tests stay green. Other
  guards: `invocationOf`/`invocationsOf` unchanged; a test per consumer.
- Config: `config.test.ts`'s hand-written since lists; a bad `deployCommands` refuses the whole
  file, so the message must be exact.
- Bundles: the new hook bundle; `router.js` must not change (check `git diff --stat plugin/dist`).
- Every existing deploy-skill block turns `!` in doctor until `project init` runs (CHANGELOG).

## A simpler approach?

A guard on any command containing "deploy" would over-match every project. Skill text alone
leaves both paths open. The project's own command list, the existing rule grammar and one
task-file check are the smallest set that holds both paths.

## Rollback

Revert the pull request. A project that set `tasks.deployCommands` has `requires` raised, so an
older plugin says "update" instead of failing. `ownHooks: ["deploy-guard"]` turns the guard off
in one project; a CI step is removed from the project's own workflow.

## How we prove it

- **core:** the six-kind exact test (written first, green before and after); `judgeTasks` tests;
  `release --check` exit 0 / 1 / 2 in a detached, shallow clone; `cli.js` copied alone, run with a
  temp `HOME` and the empty bunfig, gives the same answers; config tests (unset `envs`, key outside
  `envs`, empty list, separator, string to rule).
- **guard:** `runHook` table tests for every spelling above, each must-not-match, silent cases
  (clean, no config, no `deployCommands`, `ownHooks`), the broken-config rule, the computed rule;
  `runEntry` through the real bundle; a 64 KB line stays fast; the jobs tests and per-consumer
  tests unchanged; mutation checks on the matcher.
- **init:** questions and flags write the exact field, re-run idempotent; the block line and the
  doctor line with exact text.
- **Full check** once at the end in the main session; both validates.
- **Live, by the person:**
  - In a test project, list `"echo deploy-prod"` as a prod deploy command and add a blocking
    before-task.
  - Ask Claude to run it: the prompt names the task.
  - Close the task: it runs with no prompt.
  - In a test repo's GitHub Actions, add the CI step: the job fails while the task is open and
    passes once it is closed.
