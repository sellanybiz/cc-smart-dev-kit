---
paths:
  - "src/jobs/kinds.ts"
  - "src/project/**"
  - "src/workflow/schema.ts"
---

# The `.claude/cc-smart-dev-kit.json` Contract

`cc-smart-dev-kit.json` is how a project opts in to the plugin and gives its own details. Projects
write it by hand and keep it in their repo for years, so it is a public contract:
changing it breaks other people's projects.

## Where it is read from

`resolveProject(cwd, { pluginVersion?, env? })` finds the git checkout `cwd` is in, then
reads (`env` is the environment git runs with, so a test can put a fake git first on
PATH). It is two steps a hook calls apart: `locateCheckout()` (git only; the `ownHooks`
read needs it even when the file is broken), then `loadProjectConfig()`, which reads:

1. `<checkout root>/.claude/cc-smart-dev-kit.json` — a linked worktree's own file wins;
2. else `<main checkout>/.claude/cc-smart-dev-kit.json`;
3. else none: `config` is `null`, and the plugin does Claude Code's default behaviour.

Outside git, or in a bare repo, it returns `null`. It drops the `GIT_*` variables that
point git at another repo (a git hook sets some), so it always resolves from `cwd`.
A worktree whose main checkout was moved or deleted, and git older than 2.31, each give
a clear error that says what is wrong.

## The fields

| Field | Type | Meaning |
|---|---|---|
| `requires` | version range, npm syntax (`">=0.1"`) | The plugin versions this project needs. |
| `worktrees` | object | Turns on the notes and guards that work with worktrees (the after-merge and leftovers notes, the stash question, the main-folder guard). Every project uses Claude Code's own worktrees (`<repo>/.claude/worktrees/<name>`); `project init` writes `base` for every project. |
| `worktrees.base` | string | The branch new worktrees start from and pull requests go into; also the base the after-merge and leftovers hooks compare with. |
| `worktrees.prefix` | **retired in 1.0.0, refused** | The folder-name prefix the plugin's worktree engine gave a worktree beside the repo. Not in the schema; `RETIRED_WORKTREE_FIELDS` refuses it by name, with the fix (`project init` removes it). |
| `worktrees.setup` | **retired in 1.0.0, refused** | A command the engine ran inside a new worktree. Refused the same way. |
| `worktrees.guardMainFolder` | boolean | Refuse edits in the main checkout itself (the main-folder guard). Off when left out. |
| `worktrees.autoClean` | boolean | On when left out: finished worktrees clean themselves after a merge into the base, and at an attended session start (at most once an hour per repo, never in `claude -p`), through the same safe clean as `worktrees --clean` (`src/worktrees/auto-clean.ts`, D48). `false` starts nothing. Came with 1.0.0. |
| `worktrees.bases` | object: a branch-name prefix (ending in `/`) to a base branch | The base that branch family's pull requests go into (`{"hotfix/": "main", "release/": "main"}`), over `worktrees.base`; the longest prefix that matches wins (`baseForBranch` in `src/project/config.ts`). Auto-merge, the merge guard's opening check and the after-merge note read it (`src/workflow/auto-merge.ts`, `src/hooks/merge-guard.ts`, `src/hooks/after-merge.ts`). |
| `worktrees.engine` | **retired in 1.0.0, refused** | Who made this project's worktrees. Refused the same way. |
| `workflow` | object (`src/workflow/schema.ts`) | What cc-smart-dev-kit may do by itself here (commit, push, open a pull request, merge), over the person's own `~/.config/cc-smart-dev-kit/workflow.json`. Each field is optional, and the project's value wins field by field (`src/workflow/resolve.ts`). |
| `workflow.fixesAfterReview` | object: `lines`, `files`, `percent`, each a whole number 0 or more | How much a branch may change after its review and still count as reviewed (D17): the change since the reviewed commit, the base's own changes taken out, is covered while its lines stay within `lines` or `percent`% of the reviewed lines (whichever is more), and its files within `files` or `percent`% of the reviewed files. `0`/`0`/`0`: the exact reviewed commit only. Default `200`/`10`/`20`. A review-gate key (`REVIEW_GATE_KEYS`): read from the base's committed file, and `workflow set` refuses it inside Claude Code. `readCover` (`src/workflow/review-cover.ts`) judges with it; the merge guard does from D17b. |
| `workflow.crew` | object: `enabled` (boolean), `keep` (string array), `idleStopMinutes`, `max`, `maxOpus`, `perLead`, `perLeadOpus`, `quietMinutes`, `archiveDays`, `deleteDays`, `handoffTokens` (whole numbers, 1 or more), `handoffPercent`, `usagePercent` (1–100), `memoryGb`, `loadPerCore`, `softHours`, `maxHours` (numbers above 0), `tag` (string) | Lead and crew sessions (D34, D35, D54): the one switch (`enabled`, off by default), the caps a start waits at (their defaults: `workflowDefaults`, listed in README § The workflow) — one lead's `perLead`/`perLeadOpus`, the machine's `max` ceiling and optional `maxOpus`, and the 5-hour `usagePercent` past which a new opus-tier crew session waits — the tag in their names (D26's rules: `isNameTag` in `src/crew/names.ts`; default: the main checkout's folder name), and `memoryGb` for the free memory a start needs. `keep` is what a crew session keeps beside the plugin: `plugin:<id>` (a plugin enabled on the machine) or `server:<name>` (a server the plugin registers); every other plugin is turned off for the session, except what the kit and a kept plugin depend on (a plugin whose dependency is off does not load: `neededByKept`), and every other MCP server is not loaded (`src/crew/claude.ts` › `leanLaunch`). The person's file holds every project's default; a project's file wins field by field. `crew lead` and `crew start` read `enabled`, `keep`, `perLead`, `perLeadOpus`, `max`, `maxOpus`, `memoryGb`, `loadPerCore`, `usagePercent` and `tag` (`src/crew/`); the watch and `sessions --finished --remove` read `archiveDays` (default 7), the days after session end until its conversation leaves `/resume`, and `deleteDays` (default 30), the days after the same end until its archive is deleted (`src/crew/archive.ts`); `deleteDays` must be at least `archiveDays`; the lead's watch reads `idleStopMinutes` and `quietMinutes` (`src/crew/watch.ts`); a crew session's own monitor reads `handoffTokens`, `handoffPercent`, `softHours` and `maxHours` (`src/crew/self-watch.ts`; the launch passes the hand-off line, `src/crew/claude.ts`). |
| `workflow.issues` | object: `enabled`, `allowPublic`, `watch` (booleans), `watchMinutes` (a whole number 2-1440), `foundLabel`, `fixedLabel`, `readyLabel` (a label name: 1-50 characters, one line, no comma, not starting with `-`; the three differ, compared lower-cased) | GitHub Issues, opt-in (D67, 1.4.0): `cc-smart-dev-kit issue file` files the kit's follow-ups and findings as issues in the project's own repository (`origin`, on github.com). `enabled` (default `false`) is the switch; `allowPublic` (default `false`) is the second yes a public repository needs. Both are read as `autoPush` is — the person's file and the project's file **as committed on `origin/<worktrees.base>`** (`resolveGate`), never a working copy — and `workflow set`/`unset` of them refuse inside Claude Code (`OUTBOUND_KEYS`; `propose` stays open). `watch` (default `false`, even with `enabled` on) lets the lead's watch hear new issues and comments, one conditional look every `watchMinutes` (default 5, floor 2, ceiling 1440). It is read from the committed base like `enabled` (`src/issues/feed.ts`), and `workflow set`/`unset` of it refuse inside Claude Code like `readyLabel` below (`INBOUND_KEYS`; `propose` stays open): it opens the channel that puts outside text into the lead's context. The labels default to `kit:found` (on every issue the kit files, and how it finds a fingerprint's issue), `fixed-unreleased` and `kit:ready` (a phase starts from an issue that carries it, added by someone with write access: `crew start --issue`; none of the kit's commands adds it, the lead only to an issue the person named, after the guard asks; it is read from the committed base like `enabled`, and a session cannot choose which label counts: `workflow set`/`unset` of it refuse inside Claude Code, `INBOUND_KEYS`; the three labels must be three different words: `labelsClash` in the schema, and `issue file` and the fixed mark check the resolved values). A file that sets the object raises `requires` to `>=1.4` (`WORKFLOW_ISSUES_SINCE`). `src/issues/`, `docs/design/issues.md`. |
| `protectedBranches` | string array | The branches the git guard asks about before a push. Default `["main"]`. |
| `checks` | object | The project's check commands (1.1.0). Today one field, `fast`; the object has no other keys. |
| `checks.fast` | string: one command | The fast check a session runs before it stops, as a person would type it (`"bun run typecheck && bun test src/changed"`). The `verify-gate` Stop hook blocks a stop **once per change** when this session changed files and no shell call (Bash or PowerShell) ran the command after the last change (`.claude/rules/hooks.md`). `project init` asks for it and offers a `package.json` script (`typecheck`, `lint`, `check`, `test`) run with its lockfile's package manager; `none` leaves the field out. |
| `sessionNames` | boolean | Each session names itself after its task (the session-name hook). Off when left out. |
| `ownHooks` | array of plugin hook names | The plugin hooks this project still runs as its own copy (`["git-guard"]`): exactly those stay silent here, so two copies never both answer. Emptied once the project removed its copies (`docs/design/hooks.md` § The safe switch). A name that is not a plugin hook is refused by the strict parse (`PLUGIN_HOOK_NAMES` in `src/project/config.ts`); a retired one (`RETIRED_HOOK_NAMES`: `serena-root`, 0.6.0) is still accepted and silences nothing. A hook marked `alwaysOn` (`session-escape-guard`, and `job-route` since 1.0.0) is not in the list on purpose: it limits what the session itself may do. A name a project file may already carry for a hook that became `alwaysOn` (`UNSWITCHABLE_HOOK_NAMES`: `job-route`) is still accepted — the file parses, the name silences nothing, and `doctor` says it can go. |
| `instructions` | boolean | Turns on the opt-in instructions for this project. Not acted on yet: since Phase 5 a project loads them with its own import line (`README.md`). |
| `autoMode` | string array | Auto-mode rules `setup` copies into the user's `autoMode.environment` (`src/setup/auto-mode.ts`). Used now. |
| `jobs.kinds` | object: kind name to kind | The project's heavy-job kinds over the defaults (`src/jobs/kinds.ts`, `docs/jobs.md`). A kind says which commands are heavy (`match`, `printOnly`, `about`) and has no size. `noSlotForFiles` (1.5.0, `JOB_KIND_KEYS_SINCE`: a project that sets it raises `requires` to `>=1.5`) lets a run whose operands are only existing files run at once, with no slot; `skipWords` and `valuedFlags` are read again for it (a subcommand word such as `run`, and the options that take a value). The old size fields (`gb`, `filesGb`, `maxFiles`, `workers`) still parse and are ignored; `doctor` says once that they can go (`project-checks.ts`). `jobs` takes no `maxJobs`: how many jobs run at once is the machine's (`jobs.json`). Used now. |
| `jobs.route` | boolean | `true` or `false`: whether the `job-route` hook sends a heavy Bash command through `cc-smart-dev-kit job run` instead of running it raw (`src/hooks/job-route.ts`, `docs/jobs.md` § The route). When left out, the person's own default decides (`switches.jobRoute` in their `workflow.json`), and without one it is off; the project's value wins over theirs (`jobRouteFrom`, `src/workflow/resolve.ts`). The route rewrites Bash lines only: with the route on, a heavy PowerShell line is refused with the Bash line to run instead (it would not wait for a slot), where the Bash tool can exist; a light PowerShell line, and every PowerShell line with the route off, is left as written. That hook's launch judge (a raw `claude --bg`, `claude -p`, a crew session's lead commands, a polling loop) and a lead's background moves do not read this field or any other: they run machine-wide, on Bash and PowerShell. Used now. |

The schema is `ccSmartDevKitConfigSchema` in `src/project/config.ts` (zod). The README shows an
example; keep it in step.

`worktrees.bases` and `workflow` came with 0.4.0 (and `worktrees.engine`, since retired): a
project that uses one raises `requires` to `>=0.4`. `workflow.crew`,
`workflow.fixesAfterReview` and `worktrees.autoClean` come with 1.0.0 (optional fields: a
minor change to the contract); a project that uses one raises `requires` to `>=1.0`.
`workflow.issues` comes with 1.4.0 (`WORKFLOW_ISSUES_SINCE`): a project that sets it raises
`requires` to `>=1.4`.
A job kind's `noSlotForFiles` comes with 1.5.0 (`JOB_KIND_KEYS_SINCE`): a project whose
`jobs.kinds` sets it raises `requires` to `>=1.5`.
`workflow.crew.perLead`, `perLeadOpus`, `usagePercent` and `keep` come with 1.1.0, and so does
`checks` (one home: `CHECKS_SINCE` in `src/project/config.ts`): a project that sets one raises
`requires` to `>=1.1`, so an older plugin hears "update" rather than refusing the whole file as
an unknown field. `workflow.crew.handoffTokens` came with 1.2.0, and `workflow.crew.loadPerCore`
and `workflow.crew.archiveDays` with 1.3.0 (all three in `WORKFLOW_CREW_KEYS_SINCE`); a project
that sets one raises `requires` to `>=1.2` or `>=1.3`. `workflow.crew.deleteDays` comes with 1.7.0 and raises `requires` to `>=1.7`. An `ownHooks` name that came after
`ownHooks` itself does the same (`OWN_HOOK_NAMES_SINCE`): `subagent-background`, `crew-role` and
`lead-notes` with 1.0.0, `verify-gate` and `agent-usage` with 1.1.0, `tier-view` with 1.3.0.
**A new field or hook name needs its floor in the same change**: a since-table entry, and a line
in the hand-written lists of `src/project/config.test.ts`, which fails until both are there.
`worktrees.guardMainFolder`, `protectedBranches`,
`sessionNames` and `ownHooks` came with the hooks: a project that uses one raises its
`requires` to the release that ships them. `worktrees.prefix` became optional in 0.5.2 with
the engine's deprecation: a file written without it raises `requires` to `>=0.5.2` (one
home: `WORKTREE_PREFIX_OPTIONAL_SINCE` in `src/project/config.ts`), so an older plugin hears
"update", never "unknown file". The three engine fields retired with the engine in 1.0.0 (D20,
the owner's yes to a removed field): a file that sets one does not load, and the error names
each field and `project init`, which removes them. A hook
that cannot read the file (too new, or broken) fails closed (`.claude/rules/hooks.md`) —
except `ownHooks`, which is read on its own (`readOwnHooks`), so a listed hook stays silent
even then.

## `requires` first, then the retired fields, then the strict parse

One function runs them, in this order, for every reader (`checkCcSmartDevKitConfig`: a file on
disk, the file committed on a branch, the object `workflow set --project` writes):

(The file committed on a branch is read by `readCommittedConfig` in `src/project/resolve.ts`: from `origin/<branch>` through git, never a working copy, so a session cannot change the policy a guard judges by editing a file; a ref that is not there is `found: false`, and the caller asks the person.)

1. Read only `requires`. When the running plugin is outside the range, throw
   `CcSmartDevKitVersionError`, whose message names the update command.
2. Then the retired fields (`RETIRED_WORKTREE_FIELDS`): each one present is named, with the
   fix, in one `CcSmartDevKitRetiredFieldError` — never "unknown field (a newer
   cc-smart-dev-kit may be needed)", which would send the person to update.
3. Then parse the whole file strictly: an unknown field (`"worktree"`) is an error,
   never ignored.

The order matters. A project may use a field that is newer than a user's plugin. That
user must hear "update the plugin", not "unknown field". Keep `requires` first in
every change, and keep its test.

- Ranges are checked by `isValidRange()` before `Bun.semver`: Bun treats a range it
  cannot read as "any version", so a typo would pass.
- Every error names the file, and the field when there is one (`CcSmartDevKitConfigError`).

## Changing the contract

- **Adding a field:** an optional field, a **minor** version, the field in the schema
  with a comment, a test, the table above, and the README example. A project that uses
  it raises its `requires` to that minor version.
- **Removing, renaming or narrowing a field** breaks every project that uses it: a
  **major** version, and only with the owner's yes. Prefer adding a new field and
  keeping the old one working.
- **Never a project's value as a default.** A default must make sense for every
  project, or the field stays required.
