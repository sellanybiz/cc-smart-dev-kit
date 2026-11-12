---
paths:
  - "src/hooks/git-guard*"
  - "src/hooks/merge-guard*"
  - "src/hooks/main-folder-guard*"
  - "src/hooks/agent-guard*"
  - "src/hooks/agent-launches*"
  - "src/hooks/job-route*"
  - "src/hooks/bash-judge*"
  - "src/hooks/kit-invocation*"
  - "src/hooks/session-escape-guard*"
  - "src/hooks/user-away*"
  - "src/hooks/prompt-source.ts"
  - "src/hooks/specs.ts"
  - "src/hooks/run.ts"
  - "src/hooks/guards.test.ts"
  - "src/hooks/fail-closed.test.ts"
  - "src/hooks/matrix.test.ts"
  - "src/hooks/ask-log.ts"
  - "src/entries/agent-guard.ts"
  - "src/entries/git-guard.ts"
  - "src/entries/job-route.ts"
  - "src/entries/main-folder-guard.ts"
  - "src/entries/merge-guard.ts"
  - "src/entries/session-escape-guard.ts"
  - "src/entries/user-away.ts"
  - "src/entries/verify-gate.ts"
---

# Guards: What A Guard Answers

The hook frame and shell reader: `hooks.md`. Event contracts and evidence:
`docs/claude-code-contract.md`. Detailed behavior: `docs/design/hooks.md`.

## A machine-wide hook

- Judge model launches and machine actions even outside git or without a project file.
- A guard that limits the session itself is `alwaysOn`: a project cannot silence it through
  `ownHooks`. This includes `job-route`, `session-escape-guard` and `user-away`.
- Other machine-wide hooks can honor `ownHooks` when a project runs its own copy.
- Rewrite a heavy Bash call through the jobs API with PreToolUse `updatedInput`, never run
  the command in the hook. Keep the Bash tool's working folder.
- **The kit's own command is recognised in one place** (`kitArguments`, `namesKit`,
  `src/hooks/kit-invocation.ts`): its name, a path to the launcher, its bundle behind another
  program, a program that runs its arguments. Every guard that asks about a kit command imports
  it; a spelling that gets past it is fixed there, never in one guard.

## While the person is away

- Convert a PreToolUse ask to a deny and park the exact call as an action. Never turn an
  ask into an allow. A failed park still denies and names the manual park step.
- A new guard needs no code for this: it asks as before and the frame's step does the rest.
  Never add an `allow` path that skips the frame.
- An unreadable away state keeps the original ask and logs one stderr line.
- `user-away` refuses question tools and parks permission requests. Its own crash ask is
  not converted. The returning person's availability command keeps its permission prompt:
  a line that is nothing but the kit's `user available`, `user status` or `user list`,
  matched by the program's name, never through `kitArguments` (which leans toward yes, for
  guards that ask or deny; an allow-list needs the opposite lean).
- An automated turn is never the person's prompt (`src/hooks/prompt-source.ts`, the one
  home), and a prompt from the person never switches the state back.
- Keep a parked command byte-for-byte; mask only the guard's reason text.

## The project's own copy: `ownHooks`

- Read `ownHooks` before the full project config. A listed plugin hook exits silently so
  the project's copy runs alone. A project hook on the same event is not enough.
- Validate names against the one plugin hook list (`PLUGIN_HOOK_NAMES`). A hook you retire,
  or make `alwaysOn`, keeps its name in `RETIRED_HOOK_NAMES` or `UNSWITCHABLE_HOOK_NAMES`
  (`src/project/config.ts`): it still parses and silences nothing, and doctor says it can go.
  Dropping a name fails the strict parse, and then every guard asks on every call.
- Keep an `ownHooks` matrix test: listed means silent, unlisted means active.

## Fail closed when `cc-smart-dev-kit.json` cannot be used

- Never treat a broken or too-new project file as no file. A guard asks in its domain;
  an informational hook gives one context or stderr line. A machine-wide rule that does
  not read the broken field still judges the call.
- `ownHooks` still comes first for a switchable hook.

## Fail safe

| Failure | Guard | Informational hook |
|---|---|---|
| Code throws or input is not JSON | Ask in its domain through `onCrash` | One stderr line, exit 0 |
| Bundle or Bun missing or too old | Shim asks with `--missing=ask` | Shim reports quietly |
| Cannot start, timeout or failed exit | PreToolUse `onFailure: block` | Let work continue |

- A guard decides with a PreToolUse answer, never exit code 2. No informational hook uses
  a failure exit to stop work. The CLI uses `--missing=fail` and must not claim success.
- Put `onFailure: block` only on a guard's PreToolUse entry, never Stop or SubagentStop.
- A Stop hook blocks at most once per change, checks `stop_hook_active`, and never returns
  `additionalContext`. `verify-gate` uses its own feedback mark; a failed check cannot trap
  the turn. Test changes after a reminder as well as repeated stops.
- `subagent-background` blocks only for background work found in the agent's own tool
  results, never an id from its brief or a file. A failed read never blocks its stop.
- `agent-usage` only appends its record; failures are stderr lines, never blocks.
- Record every ask through the frame's masked ask log. Failed logging never changes the
  answer. An ask converted while away belongs on the parked list instead.
- Only the merge guard may answer `allow`, for the exact plain merge form after the full
  merge policy passes. Other passing forms stay silent so auto mode still judges them.
  Keep that judgment in the shared workflow merge-check function.
- Ask when a person may mean a dangerous step; deny a mechanical violation with its fix.
  A hook ask cannot be silenced by "don't ask again", so reserve it for real judgment.
- Hooks may start a detached cleanup, never wait for it or remove work themselves. The
  cleanup takes its own machine lock, keeps live or unprovable work and logs its failures.
  Held git locks defer a cleanup round without sleeping or retrying until success.
