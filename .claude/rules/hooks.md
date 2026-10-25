---
paths:
  - "src/hooks/**"
  - "src/entries/after-merge.ts"
  - "src/entries/agent-usage.ts"
  - "src/entries/crew-role.ts"
  - "src/entries/fable-session.ts"
  - "src/entries/lead-notes.ts"
  - "src/entries/notify.ts"
  - "src/entries/playwright-output.ts"
  - "src/entries/review-record.ts"
  - "src/entries/session-name.ts"
  - "src/entries/stop-failure.ts"
  - "src/entries/subagent-background.ts"
  - "src/entries/update-check.ts"
  - "src/entries/user-away.ts"
  - "src/entries/verify-gate.ts"
  - "src/entries/worktree-leftovers.ts"
  - "src/entries/worktrees-clean.ts"
  - "plugin/hooks/**"
  - "plugin/bin/**"
---

# Hooks: The Contract

A hook is a program Claude Code runs at a fixed moment (a session starts, a tool is
about to run, a worktree is made). This is the contract every hook follows; how they fit
together is `docs/design/hooks.md` § The hooks. The Claude Code behaviour behind each point, and
the version it was proved on: `docs/claude-code-contract.md`. The `paths:` list names the
hook entries only: `cli.ts`, `router.ts` and `portal.ts` are other bundles.

What a **guard** answers — its crew refusals, its fail-safe table, `ownHooks`, and what a
broken project file does — is `hooks-guards.md`. The notifier and its two wirings are
`notify.md`. What a session start may do, the self-update included, is `session-start.md`.

## Who wires it

Every spec in `src/hooks/specs.ts` is a **plugin** hook (`HOOKS`): in
`plugin/hooks/hooks.json`, so it runs in every project. It stays silent in a project without
`cc-smart-dev-kit.json`, and in one whose `ownHooks` names it (`hooks-guards.md` § The project's
own copy).

**Every project uses Claude Code's own worktrees** (`<repo>/.claude/worktrees/<name>` on
`worktree-<name>`), and they need no hook. The plugin's old worktree engine is retired
(1.0.0): its three hook names only print the fix, and `project init` takes their lines out.

**Never wire WorktreeCreate or WorktreeRemove in `hooks.json`.** A WorktreeCreate hook
replaces Claude Code's own creation in every project where it is wired, for sessions and
subagents, and one that prints no folder makes the creation fail (proved live). So a plugin
WorktreeCreate cannot step aside for a project that did not opt in, and a hook-made worktree
loses Claude Code's lock, its cleanup marker, `-w "#123"` and its Git LFS handling.

**A plugin SubagentStop hook that touches no worktree is fine.** Three are wired, all on the
subagent's stop alone: `review-record` (which also runs on SubagentStart to note the commit
and branch a review agent starts on, and records the review of that start commit, on that
branch, at the stop — commits made while it read count as change after the review,
`src/workflow/review-cover.ts`), `subagent-background` (one block when a subagent ends its
turn with background work it started still running, `src/hooks/subagent-background.ts`) and
`agent-usage` (each subagent's cost on record, `src/hooks/agent-usage.ts`: **machine-wide**,
the person's spend, so it records with no `cc-smart-dev-kit.json` and outside git). The two
project-scoped ones can be silent for a project that never opted in, none removes anything,
and no two answer the same thing: `review-record` writes the review,
`subagent-background` may continue the agent, and `agent-usage` only appends a line.
`entries.test.ts` fails when `hooks.json` wires
WorktreeCreate, WorktreeRemove, or a SubagentStart or SubagentStop entry outside the exact
list it names (`review-record` on SubagentStart; `review-record`, `subagent-background` and
`agent-usage` on SubagentStop), so a new entry is checked before it is wired. The review gate `review-record`
feeds stops mistakes, not a same-user process set on getting past it
(`docs/design/workflow.md` § The review record).

## The plugin's hooks: shell form, through the bun shim

Every entry in `plugin/hooks/hooks.json` uses the shell form, never the exec form:

```json
{ "type": "command", "command": "\"${CLAUDE_PLUGIN_ROOT}/bin/cc-smart-dev-kit-bun.sh\" --missing=ask \"${CLAUDE_PLUGIN_ROOT}/dist/<name>.js\"", "timeout": 10 }
```

- **Why not exec form:** on Windows exec form needs a `command` that is a real executable,
  and a shell script is not one — such a hook never starts there, and a guard that cannot
  start lets the call through. In shell form Claude Code gives the string to a shell: `sh -c`
  on macOS and Linux, Git Bash on Windows, where a first token ending in `.sh` is run as
  `bash <command>`, so the shim needs no execute bit. `docs/windows-hooks.md`, and
  `docs/claude-code-contract.md` § Windows for what that rests on and what is still owed a
  real Windows run.
- **The quotes are load-bearing:** in shell form Claude Code exports `${CLAUDE_PLUGIN_ROOT}`
  rather than substituting it, so the shell expands it — only the quotes keep a plugin folder
  with a space in it one word.
- **Never `"command": "bun"`.** Claude Code started from a desktop launcher or a service
  may have no bun on PATH, and then the hook never runs (seen live). `plugin/bin/cc-smart-dev-kit-bun.sh`
  finds bun where the launcher does (the bun baked into `~/.local/bin/cc-smart-dev-kit`,
  `$BUN_INSTALL/bin/bun`, `~/.bun/bin/bun`, then PATH — each also as `bun.exe`, which is
  what Windows has); it uses only shell built-ins, so it works with an empty PATH too.
  **It starts bun with `--no-env-file` and a `--config=` flag
  pointing at the plugin's own empty `bunfig.toml`** (`plugin/bunfig.toml`), like the launcher and
  `bin/cc-smart-dev-kit`: bun would otherwise add the working folder's `.env` files to the
  hook and run its `bunfig.toml`, and a hook must see the environment Claude Code gave it.
  `src/hooks/bun-shim.test.ts` and `src/setup/bun-shim.test.ts`
  check the order, both names, both flags and both modes. **A Bun older than `MIN_BUN` fails closed
  here**, the same way as a missing one, with its own message: an older Bun drops
  `--no-env-file` without a word, so the hook would run on guarantees the plugin does not
  have. The shim asks `bun --version` only when the bun is not the one setup baked into the
  launcher — that one setup already proved, so an ordinary hook pays nothing for the check.
  On Windows the same checks read the `bun.exe` it found, through the same MSYS path rules.
- **The shim's first argument says what to do when no bun is found**, and is never passed
  to bun: `--missing=ask` prints one PreToolUse answer on stdout, asking the person, and
  exits 0; `--missing=quiet` writes one line on stderr and exits 0; `--missing=fail` writes
  one line on stderr and **exits 1**, for the command (`plugin/bin/cc-smart-dev-kit`), which must
  never report success when it did not run. A hook never stops a session on its own.
- **A guard also asks when its bundle file is gone** (`--missing=ask` checks the file): Claude
  Code deletes an old plugin version folder some time after an update, and bun told to run a
  file that is not there only prints its error and exits 1, which Claude Code reads as a failure
  that goes on. Every guard's `hooks.json` entry also says **`"onFailure": "block"`**, the
  second belt for a hook that cannot start at all (the shim is gone too).
- **A PreToolUse guard passes `--missing=ask`** — with no bun it asks instead of letting
  the tool run: a guard fails closed. **Every other hook passes `--missing=quiet`**, so a
  missing bun is one stderr line and the session goes on.
- `<name>` is a bundle built from `src/entries/<name>.ts` (`bundles-and-releases.md`).
  The hook's logic lives in `src/hooks/`, where it can be tested; the entry is two lines:
  `runHookEntry(<its spec>)` from `src/hooks/run.ts`, with the spec from `specs.ts`.
- The command string is fixed: the quoted shim, the mode, the quoted bundle, nothing else.
  `entries.test.ts` asserts the whole string, so a stray quote or a bare path fails a test
  rather than a person's session.
- A new plugin hook: its logic in `src/hooks/`, its spec in `specs.ts` (and in `HOOKS`), its
  entry, its `hooks.json` entry, and a row in `src/hooks/matrix.test.ts`. `entries.test.ts`
  fails when the four do not match.

## The frame: every hook runs through `run.ts`

`handleHook` runs each hook in this order; never skip a step in a new hook.

1. **Read the input**; not JSON, another event, or a `cwd` outside git: nothing to do.
2. **A guard's crew part** (`HookSpec.crewLimits`), before `ownHooks` and before the file (§ A
   crew session's own limits, `hooks-guards.md`).
3. **`ownHooks`** (`hooks-guards.md` § The project's own copy).
4. **Read `cc-smart-dev-kit.json`**; broken or too new: fail closed (`hooks-guards.md` § Fail closed).
5. **Run.** A guard's crash answers through `onCrash` (`hooks-guards.md` § Fail safe).
6. **While the person is away**: an answer that asks them becomes a deny, with the call
   parked on their list (`hooks-guards.md` § While the person is away). One step for every
   hook; never an allow.
7. **Record an ask**: an answer that asks the person is appended to `guard-asks.jsonl`
   (`hooks-guards.md` § Fail safe).

The frame stays general: later hooks (notifications, the routing of heavy jobs) are new
specs in it.

## Find the project from the input's `cwd`

The hook reads its input as JSON on stdin. **Use the input's `cwd`** (`locateCheckout()`,
then `loadProjectConfig()`, from `src/project/`). It follows the session into a worktree.

- Never `CLAUDE_PROJECT_DIR`: it stays at the folder the session started in.
- Never `process.cwd()`.
- Without a `.claude/cc-smart-dev-kit.json`, every plugin hook stays silent. A project that never
  opted in must not notice the plugin.

## Quiet output

Claude Code reads a hook's stdout: a PreToolUse decision is JSON, and SessionStart's text
goes into the session's context.

- **stdout carries the contract's answer and nothing else.** No banners, no progress,
  no "ok". A setup command's output goes to stderr.
- Diagnostics go to stderr, one short line.
- A hook that has nothing to do prints nothing.
- `CC_SMART_DEV_KIT_HOOK_LOG`, when set, gets one JSON line per run (`run.ts`: the hook, the event,
  the input's `cwd`, the exit code, stdout, and the spec's `logFacts`): what `doctor --live`
  reads. `logFacts` is for facts about what the hook's own parser read (the git guard logs
  the programs of the command line), so a live check proves a guard **answered**, not only
  that it ran. It never changes the answer, and never goes on stdout.

## Reading a shell line: one reader

Every hook that asks what a Bash or PowerShell line runs reads it with `src/shell/command.ts`
(the git guard, the merge reader in `after-merge.ts`, job-route, the classifier). Never write a
second lexer or a split on `;` beside it: a guard and the queue must see the same commands.

- **The dialect comes from the input's `tool_name`** (`dialectOfTool`): Bash and PowerShell
  quote differently (`"C:\repo\"` ends at its last quote only in PowerShell). Not told the
  tool, a guard reads both (`readingsOf`); PowerShell runs nothing of a line with a bare `<`,
  so a bash here-doc read that way adds no question.
- **A guard reads every way a line may run**: both dialects when unknown, joined at a
  trailing escape and not, and blind when a quote never closes. A check for something
  that RAN (the after-merge note) reads the open quote as text.
- **The reader steps over every wrapper it knows** (`isWrapper`: `env`, `sudo`, `timeout`,
  `setsid`, `flock`, `script -c`, `busybox`, …) and reads the command inside, and a program
  named at run time (`$GIT`, `$(which git)`) comes back `computed`. **A guard whose domain
  words are in a computed command asks** rather than stay silent; in a crew session, whose
  words name a push or a pull request opening or merge, it denies instead (D24). A new
  wrapper or spelling
  goes in this one reader, never in a guard.
- **The reader also reads what a runner runs**: `find -exec`/`-execdir`/`-ok`/`-okdir`, `watch`,
  `su -c`/`--command` and `parallel` (`nestedCommand`, beside `bash -c`; `xargs` is a wrapper).
  They stay the program of their step — the merge reader's rule for what a runner does to a merge
  keys on that — and the command they run is a nested line every guard walks, so `watch git push`
  and `find . -exec git push \;` are the git guard's business. A new runner goes there, with a
  reader test and a test in each guard that matters, never as a list inside one guard.
- **A new spelling that gets past a guard is fixed in the reader**, with a test named after
  the finding, never with a special case in one guard.
- A 64 KB line stays well inside the guard's time (`git-guard.test.ts`): no step may cost
  more than linear time, and git is asked once a folder per run.

## Timeouts

- Set `timeout` (seconds) on every hook in `hooks.json`. Do not rely on Claude Code's default.
- Every child process and network call inside a hook has its own timeout, shorter than
  the hook's (a `git fetch` 5 or 30 s, `gh` 10 s).
- PreToolUse runs before every matching tool call: keep it fast. No network, except where
  the guard's question *is* about the network — the merge guard's read-only `gh` calls (10 s
  each, and only for a command that really asks for a merge). **The merge guard also gives
  itself one deadline** (`GUARD_BUDGET_MS`, 25 s of its 30 s): each call gets the smaller of
  its own limit and the time left, and when too little is left for the next call the guard
  asks instead of overrunning — a PreToolUse hook Claude Code has to kill blocks nothing, so
  an overrun would be fail-open. Every git call in a guard takes `GUARD_GIT_TIMEOUT_MS` (5 s)
  or less, against the hook's own 10 s. The merge guard's review check adds a few git calls
  (`merge-tree`, `diff --numstat`, `check-attr`, `rev-parse` in `review-cover.ts`), each with
  the same limit and from the same budget: when the measurement does not fit, the guard asks
  with that reason instead of overrunning. **`after-merge` shares one budget the same way**
  (`src/hooks/budget.ts`, 25 s of its 30 s), so its children (the alias list, the worktree
  list, `gh pr view`, the origin) cannot add up past the hook; a note that would not fit is
  skipped whole. **`job-route`'s question about `workflow propose` does the same with the
  short budget** (`SHORT_GUARD_BUDGET_MS`, 8 s of its 10 s, counted from the hook's start): the
  project lookup and the committed-file read pass `timeFor` to `src/project/resolve.ts`, and a
  call that timed out or was never made makes the question say that git did not answer in time. A hook that starts a child with the time left gives it no call at
  zero or less (`Bun.spawnSync` reads a timeout of 0 as no limit at all).
- A guard gets a short timeout; a hook that waits gets a long one.

## Tests

Each hook is tested by running it with a JSON input (`runHook` in `src/testing/hooks.ts`,
the same frame the entry uses), in a temp git repo (`testing.md`): with and without
`cc-smart-dev-kit.json`, in a worktree, with `ownHooks` listing it and with a project hook on the
same event that is not listed, with `requires` not met, and with a broken `cc-smart-dev-kit.json`.
Assert stdout exactly. Each plugin entry also runs once as a subprocess with stdin
(`entries.test.ts`); the user's notify hook through `cc-smart-dev-kit hook`
(`src/cli/hook-commands.test.ts`), once through the exact line setup writes. The shim has its
own tests (`src/hooks/bun-shim.test.ts`).
