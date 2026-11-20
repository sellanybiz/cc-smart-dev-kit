---
paths:
  - "src/hooks/agent-launches*"
  - "src/hooks/launch-judge*"
  - "src/hooks/job-route*"
  - "src/hooks/bash-judge*"
  - "src/shell/kit-invocation*"
  - "src/hooks/user-away*"
  - "src/hooks/prompt-source.ts"
  - "src/hooks/specs.ts"
  - "src/hooks/run.ts"
  - "src/hooks/fail-closed.test.ts"
  - "src/hooks/matrix.test.ts"
  - "src/hooks/ask-log.ts"
  - "src/entries/job-route.ts"
  - "src/entries/user-away.ts"
  - "src/entries/verify-gate.ts"
---

# The One Guard: What `job-route` Answers

Since 5.7.0 (the owner: "the only guard our kit will support will be the heavy-job guard") the
kit has **one guard, `job-route`**, the heavy-job queue's door. Seven guards were retired
(`docs/design/hooks.md` § Retired in 5.7.0): never add a hook that asks the person, approves a
permission dialog or blocks a call for a policy; a rule for Claude is an instruction in
`plugin/`, not a hook. The hook frame and shell reader: `hooks.md`. Event contracts and
evidence: `docs/claude-code-contract.md`. Detailed behavior: `docs/design/hooks.md`.

## A machine-wide hook

- `job-route` judges launches and heavy commands even outside git or without a project file,
  and is `alwaysOn`: a project cannot silence it through `ownHooks`. `user-away` is `alwaysOn`
  too, because the switch is the person's. Other machine-wide hooks can honor `ownHooks`.
- Rewrite a heavy Bash call through the jobs API with PreToolUse `updatedInput`, never run
  the command in the hook. Keep the Bash tool's working folder.
- **The kit's own command is recognised in one place** (`kitArguments`, `namesKit`,
  `src/shell/kit-invocation.ts`): its name, a path to the launcher, its bundle behind another
  program, a program that runs its arguments. A spelling that gets past it is fixed there.

## While the person is away

- `user-away` refuses `AskUserQuestion` and `ExitPlanMode`, saying: take the recommended option,
  keep working, record it with `user park --kind decision`. It parks nothing and answers no
  permission dialog: a hook never approves for the person.
- The frame has no step that turns another hook's ask into a parked action.
- An unreadable away state keeps the original answer and logs one stderr line. Its own crash
  is not converted.
- An automated turn is never the person's prompt (`src/hooks/prompt-source.ts`, the one
  home), and a prompt from the person never switches the state back.

## The project's own copy: `ownHooks`

- Read `ownHooks` before the full project config. A listed plugin hook exits silently so
  the project's copy runs alone. A project hook on the same event is not enough.
- Validate names against the one plugin hook list (`PLUGIN_HOOK_NAMES`). A hook you retire,
  or make `alwaysOn`, keeps its name in `RETIRED_HOOK_NAMES` or `UNSWITCHABLE_HOOK_NAMES`
  (`src/project/config.ts`): it still parses and silences nothing, and doctor says it can go.
  Dropping a name fails the strict parse, and then every hook fails closed.
- Keep an `ownHooks` matrix test: listed means silent, unlisted means active.

## Fail closed when `cc-smart-dev-kit.json` cannot be used

- Never treat a broken or too-new project file as no file. The guard asks in its domain;
  an informational hook gives one context or stderr line. A machine-wide rule that does
  not read the broken field still judges the call.
- `ownHooks` still comes first for a switchable hook.

## Fail safe

| Failure | Guard (`job-route`) | Informational hook |
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
  answer.
- Ask when a person may mean a dangerous step; deny a mechanical violation with its fix.
  A hook ask cannot be silenced by "don't ask again", so reserve it for real judgment.
- Hooks may start a detached cleanup, never wait for it or remove work themselves. The
  cleanup takes its own machine lock, keeps live or unprovable work and logs its failures.
  Held git locks defer a cleanup round without sleeping or retrying until success.
