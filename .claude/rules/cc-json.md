---
paths:
  - "src/project/**"
---

# The `.claude/cc.json` Contract

`cc.json` is how a project opts in to the plugin and gives its own details. Projects
write it by hand and keep it in their repo for years, so it is a public contract:
changing it breaks other people's projects.

## Where it is read from

`resolveProject(cwd, { pluginVersion?, env? })` finds the git checkout `cwd` is in, then
reads (`env` is the environment git runs with, so a test can put a fake git first on
PATH):

1. `<checkout root>/.claude/cc.json` — a linked worktree's own file wins;
2. else `<main checkout>/.claude/cc.json`;
3. else none: `config` is `null`, and the plugin does Claude Code's default behaviour.

Outside git, or in a bare repo, it returns `null`. It drops the `GIT_*` variables that
point git at another repo (a git hook sets some), so it always resolves from `cwd`.
A worktree whose main checkout was moved or deleted, and git older than 2.31, each give
a clear error that says what is wrong.

## The fields

| Field | Type | Meaning |
|---|---|---|
| `requires` | version range, npm syntax (`">=0.1"`) | The plugin versions this project needs. |
| `worktrees.base` | string | The branch new worktrees start from. Used from Phase 3. |
| `worktrees.prefix` | string | The folder-name prefix of a worktree beside the repo. Used from Phase 3. |
| `worktrees.setup` | string array (argv) | A command run inside a new worktree, e.g. `["bun", "install"]`. Used from Phase 3. |
| `instructions` | boolean | Turns on the opt-in instructions for this project. Used from Phase 5. |
| `autoMode` | string array | Auto-mode rules `setup` copies into the user's settings. Used from Phase 6. |

The schema is `ccConfigSchema` in `src/project/config.ts` (zod). The README shows an
example; keep it in step.

## `requires` first, then the strict parse

1. Read only `requires`. When the running plugin is outside the range, throw
   `CcVersionError`, whose message names the update command.
2. Then parse the whole file strictly: an unknown field (`"worktree"`) is an error,
   never ignored.

The order matters. A project may use a field that is newer than a user's plugin. That
user must hear "update the plugin", not "unknown field". Keep `requires` first in
every change, and keep its test.

- Ranges are checked by `isValidRange()` before `Bun.semver`: Bun treats a range it
  cannot read as "any version", so a typo would pass.
- Every error names the file, and the field when there is one (`CcConfigError`).

## Changing the contract

- **Adding a field:** an optional field, a **minor** version, the field in the schema
  with a comment, a test, the table above, and the README example. A project that uses
  it raises its `requires` to that minor version.
- **Removing, renaming or narrowing a field** breaks every project that uses it: a
  **major** version, and only with the owner's yes. Prefer adding a new field and
  keeping the old one working.
- **Never a project's value as a default.** A default must make sense for every
  project, or the field stays required.
