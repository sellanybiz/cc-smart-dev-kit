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

**The retired engine's fields are refused** (D20, 1.0.0): `worktrees.prefix`,
`worktrees.setup` and `worktrees.engine` (`RETIRED_WORKTREE_FIELDS` in
`src/project/config.ts`) were the plugin's own worktree engine's, and every project uses
Claude Code's own worktrees now. The parse is one function, `checkCcSmartDevKitConfig`, in one
order: `requires` first, then the retired fields, then the strict parse. A retired field gets a
message of its own per field ("`worktrees.prefix` is no longer supported: remove it — Claude
Code's own worktrees need none. `cc-smart-dev-kit project init` removes it"), never the strict
parse's "unknown field (a newer cc-smart-dev-kit may be needed)", which would send the person to
update instead. Its error class, `CcSmartDevKitRetiredFieldError`, is a config error like any
other to every reader — the guards ask, `doctor` fails, the merge guard's committed read names
it — and exists only so the portal's Project card still offers its write, which is the fix.
Every reader goes through it: a file on disk (`loadCcSmartDevKitConfig`), the file as
committed on a branch (`readCommittedConfig`), and the object `workflow set --project` is about
to write (`src/workflow/write.ts`). `ownHooks` is still read on its own, and never throws.
This is a stricter precedent than the retired hook name `serena-root`, which `ownHooks` still
accepts: a project file that sets a retired field fails closed until `project init` cleans it.

- **`requires` is checked before the strict parse.** A project may use a field newer
  than a user's plugin; that user is told to update, not that the field is unknown.
- **Without `cc-smart-dev-kit.json`, the plugin does Claude Code's default** and its guards stay
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
job resource settings. The update does not clean old stores, branches or worktrees.
