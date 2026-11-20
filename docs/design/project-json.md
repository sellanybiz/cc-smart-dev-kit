# Per-project opt-in: `.claude/cc-smart-dev-kit.json`


The plugin is installed for the user, so it runs in every project. A project opts in,
and gives its own details, with `.claude/cc-smart-dev-kit.json`:

```json
{
  "requires": ">=0.1",
  "worktrees": { "base": "main", "bases": { "release/": "main" } },
  "instructions": true,
  "autoMode": ["In my-app: never touch production."]
}
```

The hooks use `worktrees`, `protectedBranches`, `sessionNames` and `checks` (§ The hooks). The plugin
accepts `instructions` and `autoMode` now: `setup` uses `autoMode` (§ Auto mode reads only
user settings), and the opt-in instructions load through the project's own import line
(§ Instructions, skills and agents), so `instructions` does not load them yet. `workflow`
holds the project's policy for what cc-smart-dev-kit may do by itself (§ The workflow).

Two fields came with 0.4.0: `worktrees.bases` (a branch-name prefix to the base a worktree
of such a branch starts from, § Worktrees) and `workflow` (§ The workflow). Both are optional
and nothing else about the file changed, so a project that writes one raises its `requires`
to the release that brought it — which is what `project init` writes.

`checks` came with 1.1.0, the same way: `checks.fast` is the project's fast check, one command,
which `project init` asks for (it offers a `package.json` script with its lockfile's package
manager, and `none` skips the field). The `verify-gate` Stop hook reads it (§ The hooks).

`worktrees.rebuildable` came with 1.9.0 (`WORKTREE_REBUILDABLE_SINCE`): an optional
string array of the project's own ignored paths that come back by themselves. For example,
`"rebuildable": [".tool-cache/", "*.cache"]` allows worktree removal to lose those entries.
Patterns use `/` and match at any depth, not only at the checkout root: `.tool-cache/`
matches both `.tool-cache/` and `pkg/.tool-cache/`, as the built-in `REBUILDABLE` rule does.
Git names a folder with a trailing `/`. Empty or absolute paths, backslashes, `.` or `..`
segments, and patterns with only glob characters and dots (`*`, `.*`) are refused; name a
folder or file.
Never list a file that holds settings or secrets, such as `.env.local`. `localFiles` reads the main checkout's project file through
the project loader. A missing, broken or too-new file adds no exemptions. A folder is safe
when every entry inside is safe. This only widens the "comes back by itself" rule for the
project's own ignored paths: it does not exempt tracked changes or bypass other removal
checks. A project that sets it raises `requires` to `>=1.9`.

**The floor covers every field and hook name that came after 0.5.2.** An older plugin reads
the file strictly: a field it does not know, or an `ownHooks` name outside its list, makes it
refuse the whole file, and every hook in that project fails closed. `requiresFloor`
(`src/project/init.ts`) picks the lowest plugin version that reads everything the file holds,
and `project init` and `workflow set --project` write it as `requires`. Each version has one
home in `src/project/config.ts`: `WORKTREE_PREFIX_OPTIONAL_SINCE` (0.5.2, the floor of every
file), `WORKFLOW_FIXES_SINCE` and `WORKTREE_AUTO_CLEAN_SINCE` (1.0.0), `CHECKS_SINCE` (1.1.0),
`WORKFLOW_ISSUES_SINCE` (1.4.0), `WORKTREE_REBUILDABLE_SINCE` (1.9.0), `TASKS_SINCE` (1.10.0),
`DEPLOY_TASKS_SINCE` (5.0.0, `tasks.envs`) and `DEPLOY_GUARD_SINCE` (5.3.0, `tasks.deployCommands` and the `deploy-guard` name, retired in 5.7.0 but kept as a floor),
`JOB_KIND_KEYS_SINCE` (a kind's `noSlotForFiles` in 1.5.0; `light`, ignored since 2.0 like the
old size fields and `workflow.crew`, raises no floor, and `doctor` says it can go) and
`OWN_HOOK_NAMES_SINCE` (the `ownHooks` names: `subagent-background` in 1.0.0, `verify-gate` and
`agent-usage` in 1.1.0, `tier-view` in 1.3.0, `task-start` in 1.10.0, `keep-going` and
`builder-finish` in 2.0.0, `deploy-guard` in 5.3.0 (retired in 5.7.0: it still parses); the retired `crew-role` and `lead-notes` keep their 1.0.0). The
older retired and unswitchable names (`serena-root`, `message-guard`, `job-route`) are older than 0.5.2, so they
raise nothing. A drift guard, `src/project/config.test.ts`, holds a hand-written list of what
the 0.5.2 plugin accepted and of each later key and name with its release; it fails when the
schema or `PLUGIN_HOOK_NAMES` gains one that is in neither, and when a since-table does not
give the floor the list says.

**The retired engine's fields are refused** (D20, 1.0.0): `worktrees.prefix`,
`worktrees.setup` and `worktrees.engine` (`RETIRED_WORKTREE_FIELDS` in
`src/project/config.ts`) were the plugin's own worktree engine's, and every project uses
Claude Code's own worktrees now. The parse is one function, `checkCcSmartDevKitConfig`, in one
order: `requires` first, then the retired fields, then the strict parse. A retired field gets a
message of its own per field ("`worktrees.prefix` is no longer supported: remove it — Claude
Code's own worktrees need none. `cc-smart-dev-kit project init` removes it"), never the strict
parse's "unknown field (a newer cc-smart-dev-kit may be needed)", which would send the person to
update instead. Its error class, `CcSmartDevKitRetiredFieldError`, is a config error like any
other to every reader — `job-route` asks, `doctor` fails, the committed read of `merge-check` names
it — and exists only so the portal's Project card still offers its write, which is the fix.
Every reader goes through it: a file on disk (`loadCcSmartDevKitConfig`), the file as
committed on a branch (`readCommittedConfig`), and the object `workflow set --project` is about
to write (`src/workflow/write.ts`). `ownHooks` is still read on its own, and never throws.
This is a stricter precedent than the retired hook name `serena-root`, which `ownHooks` still
accepts: a project file that sets a retired field fails closed until `project init` cleans it.

- A hook finds the project from its input's `cwd`, which follows the session into a
  worktree. A worktree's own `cc-smart-dev-kit.json` wins; else the main checkout's is used. A moved
  or deleted main checkout, and git older than 2.31, each give a clear error. **So does a git
  that does not answer** (5 s a call): `GitTimedOutError`, never "outside git", because a hung
  git says nothing about the folder. Its message is one plain line with its fix ("git did not
  answer in time: run `git status` in this folder; …"). Every command that finds the checkout
  prints it that way and no stack (`project init`, `workflow`, `worktrees`); `doctor`
  says the reason alone and prints the fix on its own line; a hook's question names the
  reason alone (`checkoutFailure`, `src/project/resolve.ts`).
- **`requires` is checked before the strict parse.** A project may use a field newer
  than a user's plugin; that user is told to update, not that the field is unknown. A plugin
  past the top of a range (`^1.4` or `>=1.4 <2` under 2.0.0) is told to widen `requires`
  instead, since an update cannot help: `checkRequires` tells the two apart with
  `allowsNewer` (`src/project/version-range.ts`): when some version newer than the plugin is in
  the range (`^1.4 || ^2.1` on 2.0.0), an update helps; else only a wider range does.
- **Without `cc-smart-dev-kit.json`, the plugin does Claude Code's default** and its hooks stay
  silent. A project that never opted in does not notice the plugin.
- **The retired engine's hook lines fail, and `project init` takes them out:** a line in the
  project's `.claude/settings.json` or `.claude/settings.local.json` that still runs
  `cc-smart-dev-kit hook worktree-create|worktree-remove|subagent-stop` gets the fix on stderr
  and exit 1 — never exit 2, which on `SubagentStop` blocks the stop, and the line reads no
  `stop_hook_active`, so every subagent would loop for ever. Exit 1 is a non-blocking error
  there and on `WorktreeRemove` (the session goes on), and any non-zero exit still fails
  `WorktreeCreate` and shows the line. `project init` removes exactly those handlers (found by their command text,
  `retiredEngineHookOf` in `src/hooks/settings-hooks.ts`), shown as `-` lines first, through the
  same backup and atomic write as the rest of its plan; `doctor` names each file that still has
  one (§ The worktree engine).

### How a project adds its own part to a general skill

A general skill reads the project's own additions when they exist. For example,
`/cc-smart-dev-kit:review` also follows the project's `.claude/cc-smart-dev-kit/review.md`, and where they disagree,
the project's text wins. The plugin stays general; each project keeps its own rules in
its own repo.


## Compatibility in 2.0

Crew was removed in 2.0. Old `workflow.crew` values still load and are ignored, as are old
job resource settings (`IGNORED_KIND_FIELDS`, `src/jobs/kinds.ts`, which `doctor` names as
fields that can go). `workflow.issues.watch` and `workflow.issues.watchMinutes` are accepted and
ignored since 2.0: nothing reads them, so an older file still loads. The update does not clean
old stores, branches or worktrees.
