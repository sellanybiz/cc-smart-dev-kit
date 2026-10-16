---
paths:
  - "src/project/**"
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
| `worktrees` | object | Turns on the plugin hooks that work with worktrees, and is what the worktree engine needs. The engine also needs the project to wire `cc-smart-dev-kit hook <name>` in its own settings (README § Worktrees); wired without `worktrees`, each engine hook fails closed (`needsWorktrees` in `src/hooks/specs.ts`), never falls back to another shape. |
| `worktrees.base` | string | The branch new worktrees start from (`origin/<base>`, freshly fetched); also the base the after-merge and leftovers hooks compare with. |
| `worktrees.prefix` | string | The folder-name prefix of a worktree beside the repo. No `/` or `\` (the hook refuses one). |
| `worktrees.setup` | string array (argv) | A command run inside a new worktree, e.g. `["bun", "install"]`. |
| `worktrees.guardMainFolder` | boolean | Refuse edits in the main checkout itself (the main-folder guard). Off when left out. |
| `worktrees.bases` | object: a branch-name prefix (ending in `/`) to a base branch | The base a new worktree for such a branch starts from (`{"hotfix/": "main", "release/": "main"}`), over `worktrees.base`; the longest prefix that matches wins. The after-merge note names those prefixes (`src/hooks/after-merge.ts`). |
| `worktrees.engine` | `"plugin"` (the default) or `"own"` | Who makes this project's worktrees. `"own"`: the project runs an engine of its own, so `doctor` does not expect the plugin's hooks (a `·` line, never ✗) and warns when they are wired anyway (`src/cli/project-checks.ts`). |
| `workflow` | object (`src/workflow/schema.ts`) | What cc-smart-dev-kit may do by itself here (commit, push, open a pull request, merge), over the person's own `~/.config/cc-smart-dev-kit/workflow.json`. Each field is optional, and the project's value wins field by field (`src/workflow/resolve.ts`). |
| `protectedBranches` | string array | The branches the git guard asks about before a push. Default `["main"]`. |
| `sessionNames` | boolean | Each session names itself after its task (the session-name hook). Off when left out. |
| `ownHooks` | array of plugin hook names | The plugin hooks this project still runs as its own copy (`["git-guard"]`): exactly those stay silent here, so two copies never both answer. Emptied once the project removed its copies (`docs/design.md` § The safe switch). A name that is not a plugin hook is refused by the strict parse (`PLUGIN_HOOK_NAMES` in `src/project/config.ts`). |
| `instructions` | boolean | Turns on the opt-in instructions for this project. Not acted on yet: since Phase 5 a project loads them with its own import line (`README.md`). |
| `autoMode` | string array | Auto-mode rules `setup` copies into the user's `autoMode.environment` (`src/setup/auto-mode.ts`). Used now. |
| `jobs.kinds` | object: kind name to kind | The project's heavy-job kinds over the defaults (`src/jobs/kinds.ts`, `docs/jobs.md`). Used now. |
| `jobs.route` | boolean | `true`: the `job-route` hook sends a heavy Bash command through `cc-smart-dev-kit job run` instead of running it raw (`src/hooks/job-route.ts`, `docs/jobs.md` § The route). Off when left out. Used now. |

The schema is `ccSmartDevKitConfigSchema` in `src/project/config.ts` (zod). The README shows an
example; keep it in step.

`worktrees.bases`, `worktrees.engine` and `workflow` came with 0.4.0: a project that uses one
raises `requires` to `>=0.4`. `worktrees.guardMainFolder`, `protectedBranches`,
`sessionNames` and `ownHooks` came with the hooks: a project that uses one raises its
`requires` to the release that ships them. A hook
that cannot read the file (too new, or broken) fails closed (`.claude/rules/hooks.md`) —
except `ownHooks`, which is read on its own (`readOwnHooks`), so a listed hook stays silent
even then.

## `requires` first, then the strict parse

1. Read only `requires`. When the running plugin is outside the range, throw
   `CcSmartDevKitVersionError`, whose message names the update command.
2. Then parse the whole file strictly: an unknown field (`"worktree"`) is an error,
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
