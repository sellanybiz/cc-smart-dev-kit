---
paths:
  - "src/hooks/git-guard*"
  - "src/hooks/merge-guard*"
  - "src/hooks/main-folder-guard*"
  - "src/hooks/message-guard*"
  - "src/hooks/agent-guard*"
  - "src/hooks/agent-launches*"
  - "src/hooks/job-route*"
  - "src/hooks/bash-judge*"
  - "src/hooks/session-escape-guard*"
  - "src/hooks/crew-role*"
  - "src/hooks/lead-notes*"
  - "src/hooks/user-away*"
  - "src/hooks/prompt-source.ts"
  - "src/hooks/specs.ts"
  - "src/hooks/run.ts"
  - "src/hooks/guards.test.ts"
  - "src/hooks/fail-closed.test.ts"
  - "src/hooks/matrix.test.ts"
  - "src/hooks/ask-log.ts"
  - "src/entries/agent-guard.ts"
  - "src/entries/crew-role.ts"
  - "src/entries/git-guard.ts"
  - "src/entries/job-route.ts"
  - "src/entries/main-folder-guard.ts"
  - "src/entries/merge-guard.ts"
  - "src/entries/message-guard.ts"
  - "src/entries/session-escape-guard.ts"
  - "src/entries/user-away.ts"
  - "src/entries/verify-gate.ts"
---

# Guards: What A Guard Answers

A guard is a PreToolUse hook that may ask or refuse. This is what it answers when a crew
session runs it, when the project cannot be read, and when the guard itself fails. The frame
every hook runs in, and the shim that starts it: `hooks.md`. A session start's own rules:
`session-start.md`. How the guards fit together: `docs/design/hooks.md` § The hooks.

## A crew session's own limits

D24, D36 and D47 give a crew session refusals that **no project can switch off**. Nobody
watches a crew session, and a hook's `ask` cannot be silenced by "don't ask again" (§ Fail
safe), so every question a guard would put to the person where the step is mechanical is a
**deny that names the step**:

| Guard | What a crew session is denied, and the step it reads |
|---|---|
| `git-guard` | a push (it commits on its branch, and the lead merges); every ask above that destroys work — a discarding `checkout`/`switch -f`/`restore`, `reset --hard`, `reset --merge`, `clean -f`, `worktree remove -f`, `branch -D`, `stash clear`, an unnamed `stash drop`, a bare `git stash` — each with the step doing the same job without a question (`CREW_STEPS`) |
| `merge-guard` | opening a pull request (`CREW_PR_REFUSAL`), and every question before a merge — the policy off, `--admin`, another repository, a check not green, no covering review, a policy or a form it cannot read, its own budget — as the one merge refusal (`CREW_MERGE_REFUSAL`): it commits on its branch and the lead merges locally. A merge the policy would allow is refused too, never `allow` |
| `message-guard` | a message to another crew session without the `crew tell` tag, and a raw message to its own lead (which goes through `crew report`) |
| `agent-guard` | every launch it would ask the person about — Fable, an Opus-family model it cannot read, Opus at `max`, an unreadable Workflow — judged as a session nobody watches, with the step `crew report --question` (`CREW_QUESTION_STEP`) |
| `job-route` | a raw `claude --bg` start and every lead command (`crew start`, `answer`, `stop`, `rm`, `resume`, `watch`, `lead`, `lead tell`), each with the step `crew report --question` (`CREW_QUESTION_STEP`); `cc-smart-dev-kit workflow propose` however the line spells it, because it pushes a branch and opens a pull request in children no guard sees (D24; a subcommand the judge cannot read is refused too, `workflow propose --help` passes); a `claude -p` launch the launch policy questions; and a heavy command whose routing cannot be read because the project's file is broken or too new |
| `session-escape-guard` | a write into the kit's own files (its project file, settings, state, installed plugin), a computed write or computed kit command, and any reach at the portal |

The first four are the **crew part** of the guards that own their detectors — `crewGitAnswer`
(`git-guard.ts`), `crewPullRequestAnswer` (`merge-guard.ts`), `crewAgentAnswer`
(`agent-guard.ts`), `crewMessageAnswer` (`message-guard.ts`) — and the frame runs each before
`ownHooks` and before `cc-smart-dev-kit.json` is read (`HookSpec.crewLimits`). So the refusal
holds in a project that never opted in, in one whose file is broken or too new, and in one
whose `ownHooks` lists its own copy of the guard. Without `CC_SMART_DEV_KIT_CREW` the part is
silent: an ordinary session pays nothing, and the guard's other answers are exactly as they
were.

`job-route`, `session-escape-guard` and `user-away` are `alwaysOn` (§ A machine-wide hook; the
switch of `user-away` is the person's), so a project
cannot switch them off either; their crew answer lives in their own `run` and in
`onConfigProblem`/`outsideGit`, so no call is judged twice. Each guard's detector is shared
with its own `run` — one function, never a copy — so a spelling that gets past one gets past
both. **The kit's own command is recognised once** (`kitArguments`, `namesKit`,
`src/hooks/kit-invocation.ts`) for the two guards that ask about it, `job-route` (a crew
session's lead commands and `workflow propose`) and `session-escape-guard` (a kit command run with
`CLAUDECODE` unset): its name, a path to the launcher, its bundle behind another program, a
program that runs its arguments. A spelling that gets past that one reader is fixed there, never
in one guard.

**The bun shim answers the same way.** With `--missing=ask` and `CC_SMART_DEV_KIT_CREW` set,
the answers a guard gets when it cannot run (no bun, a Bun older than `MIN_BUN`, a missing
bundle) are denies: they say to end the turn and say so in its last message, and to report
with `crew report --question` only while shell commands still run — with no bun, or one too
old, a guard that cannot run refuses every shell call, so the report command could not run
either. Its `--missing=quiet` and `--missing=fail` modes are unchanged.

Two asks can still reach a crew session. A guard's own crash, or input that is not JSON
(`onCrash`), asks as it does for any session: that is a bug path, and the ask is what shows
it. And `main-folder-guard` and `message-guard` ask through `onConfigProblem` on a broken or
too new `cc-smart-dev-kit.json`, where they cannot read the policy they judge with (the other
guards deny or stay silent there, § Fail safe). `"onFailure": "block"` in `hooks.json` stays
for the same reason.

## A machine-wide hook

Some hooks answer about the machine, not a project: `agent-guard` (the model a launch runs
on), `job-route` (the shell judge, on Bash and PowerShell: a raw `--bg` launch, a `-p` run's
model and effort, a crew session's lead commands — `crew start`, `answer`, `model`, `stop`, `rm`,
`resume`, `watch`, `lead`, `lead tell` — and its `workflow propose`, which any other session is
asked about when the gate says the push or the pull request is the person's, a polling loop),
`fable-session` (the model the
session itself runs on),
`crew-role` (a crew session's own card, the person's own prompt, the ask and the report),
`lead-notes` (a lead's missed crew news), `user-away` (whether the person can answer; § While the
person is away) and `notify` (the alerts).
`playwright-output` is machine-wide too — it puts a file the
CALLER names into the browser's own output folder (only while the live `playwright`
registration is the one setup recorded; a server of the person's own is left alone entirely),
and the browser is the machine's —
and, like `notify` and `update-check`, it is a `USER_HOOKS` bundle: no frame, no
`cc-smart-dev-kit.json`, no `ownHooks`. (`update-check`'s own rules are `session-start.md`;
the notifier's are `notify.md`.)

`agent-guard` is a plugin hook (`HOOKS`) that is machine-wide all the same: it runs with or
without `cc-smart-dev-kit.json`, and a folder
that is not in git is judged the same way. The frame hands such a hook the input and the
environment (`HookEnvContext`) where its checkout or config step does not apply, and the
spec's `onConfigProblem` and `outsideGit` judge on. It is still in `PLUGIN_HOOK_NAMES`, so
a project that runs its own Agent guard silences it through `ownHooks`, which is read on its
own, before the file.

**A registered lead's building launch is held by the crew queue** (D59), the one answer of this
guard that reads a project's store **and the one that a broken or too new file does change**: the
caps and `crew.enabled` come from the project's file, so with no readable caps the launch goes.
While a `crew start` from that lead would queue now, a launch
that can change files is denied, naming the cap and the `crew start` step. It reads the lead
record of the input's session and repository, so the paths without a checkout — a broken file, a
folder outside git — judge model and effort alone and let the launch through, and a read-only
subagent is never held.

`session-escape-guard` is machine-wide in the same way, and **`alwaysOn`** (`HookSpec.alwaysOn`):
the frame skips its `ownHooks` step and `PLUGIN_HOOK_NAMES` leaves its name out, because the
project's file is one of the things it guards (a session could list the guard there first).
**`job-route` is `alwaysOn` too**, for the same reason one step out: it limits what the session
itself may launch and run, and a session could otherwise switch the judge off by listing it in
the project's file. **`user-away` is `alwaysOn` too**: the switch is the person's, and a project file must not turn it
off for a session. It was never switchable, so it has no `UNSWITCHABLE_HOOK_NAMES` entry and is
not in `PLUGIN_HOOK_NAMES`. A guard whose answer limits what the session itself may do is
`alwaysOn`; any other machine-wide guard may be silenced by a project that runs its own copy. A name a
project file may already list for an `alwaysOn` hook that used to be switchable
(`UNSWITCHABLE_HOOK_NAMES`, today `job-route`) still parses, it silences nothing, and `doctor`
says it can go. `matrix.test.ts` checks both halves.

```json
{ "hookSpecificOutput": { "hookEventName": "PreToolUse", "permissionDecision": "allow", "updatedInput": { "command": "…" } } }
```

`updatedInput` (PreToolUse only, proved live on 2.1.301) replaces the tool's input for that
call: `job-route` uses it to send a heavy command through `cc-smart-dev-kit job run`, and — in a
lead — to add `run_in_background: true` to a CI watch, a queued job or the full check (proved
honoured on 2.1.308, and in L1a.1 on 2.1.306). The rewritten
command runs in the Bash tool's own shell, so it keeps the folder that shell is in (proved
live: after a `cd`, the rewritten command ran in the new folder, not in the hook's `cwd`).

## While the person is away

`cc-smart-dev-kit user unavailable` sets one state per kit state folder (`src/user-away/state.ts`:
the machine's, unless Claude Code runs on another `CLAUDE_CONFIG_DIR`).
While it is on, nobody reads a question, so no hook may leave one open. The design is
`docs/design/hooks.md` § While the person is away; this is what every hook owes it:

| The answer | While the person is away |
|---|---|
| `AskUserQuestion` or `ExitPlanMode` (PreToolUse) | `user-away` **denies**, with the step that parks the question |
| Claude Code's own permission prompt (`PermissionRequest`) | `user-away` **denies** and parks the call as an `action`; the one exception is a plain session's line that is nothing but the kit's own `user available`, `user status` or `user list` (the program by name, never `kitArguments`), which is left to Claude Code's prompt so the returning person can answer it |
| Any hook's PreToolUse **ask** | the frame's step 6 (`askedWhileAway`) turns it into a **deny**: the hook's own words, "parked as #N", and the call parked as an `action` with its exact command |
| A deny, an allow, silence | unchanged |

- **Never looser: a deny where an ask was, never an allow.** A new guard needs no code for this:
  it asks as before and step 6 does the rest. Never add an `allow` path that skips the frame.
- **A state it cannot read keeps the ask**, with one line on stderr (`AwayStateError`): the
  feature must never make a call looser, and a broken file is not "available". A park that
  fails still denies and says to park by hand: the call never waits for someone who is away.
- **A parked command is kept exactly**, because a later yes has to run it. Only a guard's own
  reason text goes through `maskedLine`.
- **`user-away` itself is never converted**: its one ask is its crash, made because it could not
  read anything.
- **A crew session never asks the person.** `crew-role` refuses the question tools first;
  a crew session's other asks are denied and parked with its name. The person's own prompt is
  never taken from a crew session or an automated turn (`prompt-source.ts`, one home), and
  a prompt from the person does not switch the state back.
- **What it cannot reach:** a project's own copy of a guard (`ownHooks`), which answers in Claude
  Code directly (the `PermissionRequest` answer catches the prompt that follows), and the shim's
  `--missing=ask` with no bun. It stops mistakes, not a session that runs `user available` itself:
  that is the person's command, and no hook can tell their run from a session's.

## The project's own copy: `ownHooks`

A project may still have its own copy of a piece the plugin now ships (a guard, a note).
Where both exist, **the project says which plugin hooks to keep quiet**: `ownHooks` in its
`.claude/cc-smart-dev-kit.json` lists them by name (`["git-guard"]`), and exactly those plugin hooks
**exit 0 and print nothing**, so the project's copy runs alone.

- It is explicit on purpose. A project hook on the same event is *not* enough to silence a
  plugin hook: it may be a logger, a different check, or a copy that does not cover the same
  commands — and a guard that goes quiet for something that does not replace it leaves the
  person unguarded.
- **A listed name silences a guard's project part only.** A crew session's four refusals —
  its push, its work-destroying git commands (each denied with the step), its pull request,
  its peer message without the tag — are the guard's crew part, which the frame has already
  run before this step (§ A crew session's own limits): no `ownHooks` list, and no missing
  file, can switch them off.
- Only `ownHooks` is read there (`ownHooksOf` in `src/project/resolve.ts`, on its own, like
  `requires`), so it works even when the rest of the file is broken or needs a newer plugin.
- The names are validated against the plugin's own (`PLUGIN_HOOK_NAMES` in
  `src/project/config.ts`; a test keeps them equal to `HOOKS`): a typo fails the strict parse.
- **A retired plugin hook keeps its name** (`RETIRED_HOOK_NAMES` in the same file; today
  `serena-root`, 0.6.0): a project file that lists it still parses, the name silences
  nothing, and `doctor` prints one `·` line that it can go. **A hook a project can no longer
  switch off keeps its name the same way** (`UNSWITCHABLE_HOOK_NAMES`; today `job-route`, which
  became `alwaysOn` in 1.0.0): the file still parses, the name silences nothing, and `doctor`
  says it can go. Dropping a name from the schema
  would fail the strict parse, and every guard would then ask on every call. A hook you
  retire, or make `alwaysOn`, goes there.
- `cc-smart-dev-kit doctor`, run in a project, prints one `·` line per listed hook, **warns** (`!`)
  when a listed hook's event has no project hook left to answer, and warns when a project
  hook runs next to a plugin hook the list does not name (both may answer).

**The safe switch** (`docs/design/hooks.md` § The safe switch): the project lists its copies while
it still has them → removes them → empties the list → raises `requires`. Every hook gets an
`ownHooks` test (the matrix does it for all: a plugin hook listed there goes silent; one that
is not listed still speaks).

## Fail closed when `cc-smart-dev-kit.json` cannot be used

When the project's `cc-smart-dev-kit.json` needs a newer plugin (`CcSmartDevKitVersionError`) or
is broken (`CcSmartDevKitConfigError`), the hook cannot do what the project asked for. It
never goes on as if there were no file; it fails closed in the way that suits its event, and
the message (which names the update command, the file and field) reaches someone:

| Kind | Fails closed by |
|---|---|
| A guard (PreToolUse) | **asking** the person before every call in its domain: every command that runs git, every edit in the repo, every message |
| An informational hook | one line of context (`cc-smart-dev-kit: <message>`); `after-merge` only after a merge, `session-name` only on stderr |

For a plugin hook's project part `ownHooks` still comes first: a project that lists its own
copy there keeps it running. A guard's crew part has already run before both (§ A crew
session's own limits), so a broken or too new file never lets a crew session push, merge,
run a work-destroying git command, open a pull request, launch an agent or run a command
nobody could answer for, write into the kit's own files, or send an untagged peer message.
For `git-guard` and `merge-guard` the file cannot change a crew session's answer at all —
their crew rule reads no project value — so their `onConfigProblem` stays silent for a crew
session instead of asking a person who is not there; `agent-guard`, `job-route` and
`session-escape-guard` judge the call anyway and deny where the person would be asked.

## Fail safe

A bug in an informational hook must never stop a user's work. A bug in a **guard** must never
let a call through. Each hook's answer to its own failure, in one table (the same in
`docs/design/hooks.md` § One frame for every hook):

| Failure | A guard: `git-guard`, `merge-guard`, `main-folder-guard`, `message-guard`, `job-route`, `agent-guard`, `session-escape-guard`, `crew-role`, `user-away` (its domain: `AskUserQuestion`, `ExitPlanMode`; on its other two events a crash is one stderr line) | Any other plugin hook | `cc-smart-dev-kit hook notify` |
|---|---|---|---|
| Its own code throws | `onCrash`: **ask** about the call in the guard's domain (a call outside it: silent; on PostToolUse: silent, one stderr line) | one stderr line, exit 0 | one stderr line, exit 0 |
| The input is not JSON | **ask**, in general | one stderr line, exit 0 | one stderr line, exit 0 |
| `cc-smart-dev-kit.json` broken or too new | `onConfigProblem`: **ask** (`agent-guard`, `session-escape-guard`, `crew-role` and `lead-notes` judge the call anyway); in a crew session: silence for `git-guard`/`merge-guard`, a deny for `agent-guard`/`job-route`/`session-escape-guard`, and an ask still for `main-folder-guard`/`message-guard` (§ A crew session's own limits) | one line of context, or on stderr | not read |
| No bun, or one older than `MIN_BUN` | the shim's `--missing=ask`: **ask**; in a crew session: a **deny** naming what the session can do | the shim's `--missing=quiet`: one stderr line, exit 0 | the launcher's line on stderr, exit 1 (Claude Code reads exit 1 as a failure that goes on) |
| The bundle file is gone (an update removed the version folder) | the shim **asks**; in a crew session: a **deny** naming what the session can do | bun's own error, exit 1 | not applicable: the launcher runs the installed version |
| The hook cannot start, times out, or fails (an exit code other than 0 and 2) | `"onFailure": "block"` in `hooks.json`: Claude Code **blocks** the call | Claude Code goes on | Claude Code goes on |

**The portal's start part is inside the `update-check` hook, and its failures never reach that
hook's answer.** A port held by another program, a bundle that is missing, a server that does
not answer: each is one line in `<stateDir>/portal.log` by the detached starter, and the hook
still exits 0 with nothing on stdout. The next session start tries again, and `doctor`'s
portal line says what is wrong (`src/portal/lifecycle.ts`).

`"onFailure": "block"` sits on a guard's **PreToolUse** entry and on nothing else: Claude Code
ignores it on `Stop` and `SubagentStop` (and two other events), and on PostToolUse the call
already ran (`docs/claude-code-contract.md` § Hooks). `plugin/bin/cc-smart-dev-kit`, the command, runs
through the same shim with `--missing=fail`: no bun is one line on stderr and **exit 1**, because
a command must never report success when it did not run.

- A guard's `onCrash` is `guardCrash(what, inDomain)` in `specs.ts`; `entries.test.ts` runs every
  guard on an input that is not JSON and expects an ask, so a guard without one fails a test.
  An `onCrash` that throws is one stderr line, exit 0: never worse than the line.
- No informational plugin hook exits 1 (`crashExitCode`): a bug never stops a person's work.
- **A Stop hook blocks at most once per change, and never gives context.** A turn a block caused
  carries `stop_hook_active: true`, and the hook is silent there; a Stop answer's
  `additionalContext` keeps the turn going. The two Stop hooks that block are `crew-role` (a
  crew session's turn ended on a step with no report) and `verify-gate` (the project's
  `checks.fast` did not run after the last change); `verify-gate` is silent in a crew session,
  which has its own report gate. Its block's own feedback line in the transcript is its mark,
  so no change is reminded about twice, a change made after a reminder earns the next one, and a
  check that fails never traps a turn.
- **`subagent-background` never blocks on a failure.** A broken input, a broken or too new
  `cc-smart-dev-kit.json`, and a transcript it cannot read are no block (one stderr line where
  the frame says one, exit 0): it can only block when it has read the agent's own transcript
  (JSONL, line by line) and found that agent's background task in a **tool result of its own
  Bash or Agent call** (`Command running in background with ID: <id>`, `agentId: <id>`) — never
  an id in its brief or in a file it read, so a subagent can always finish and a parent's task
  is never mistaken for its own.
- **`agent-usage` only appends its record.** An unreadable transcript, and a record that
  cannot be written, are one stderr line and exit 0; it never blocks and never prints on
  stdout, so a bug in it never stops a subagent (`src/hooks/agent-usage.ts`).
- **Every ask is recorded.** The frame appends one JSON line to `guard-asks.jsonl` in the state
  folder (`src/hooks/ask-log.ts`: the time, the hook, the session, the tool, a short reason put
  through `maskedLine`), kept small by the same rule as `update.log`. A write that fails is one
  stderr line and never changes the answer. An ask that became a deny while the person is away
  is on their list instead (§ While the person is away).
- A guard decides with a PreToolUse answer (`ask` or `deny`), never exit code 2.
- **Only the merge guard answers `allow`, and only for D31's exact form:** a command line that
  is nothing but `gh pr merge <n>` with flags gh 2.102.0 has, when the whole policy passed
  (`autoMerge` on, the base plain, the checks green, a review covering the fixes after it). An
  `allow` skips auto mode's own "Merge Without Review" rule for that call (proved live, L1a.5),
  so the guard's checks are what protect it; every other passing form — a wrapper, a second
  command, an alias, an unknown flag, an armed `--auto` merge — stays silent (so auto mode
  still applies), an unknown `gh pr merge` flag asks, and a crew session never gets it.
  The judgment itself is `src/workflow/merge-check.ts`, shared with `workflow merge-check`.
- A guard asks rather than denies when the person may mean it (a force-push, a pull request
  opening outside the project's base); it denies
  only what is never right in that project (an edit in a guarded main checkout, a message
  to another project's session, a crew session's push, work-destroying git command, merge,
  pull request, launch, kit-file write or raw message to its lead — D24, D36, D47: the lead
  merges locally and hears its crew through `crew report`).
  The crew refusals are the guard's crew part: they hold with no file and whatever
  `ownHooks` says (§ A crew session's own limits).
- **A hook's `ask` cannot be silenced by the person.** Claude Code asks on every matching
  call: "Yes, don't ask again" leaves no rule a PreToolUse hook's answer respects (proved
  live, on the main-folder guard's Serena branch, since retired). So a guard
  asks only where the person's judgment is the point. When the fix is mechanical and Claude
  can do it itself, the guard denies and says the step, and the person is not interrupted on
  every call.
- Anything a guard cannot work out (a session record it cannot read, a branch it cannot
  name) lets the call through.
- **A hook may start a background program, and never run it.** D48: `after-merge` (a pull
  request merged into the base) and `worktree-leftovers` (an attended session start, at most
  once an hour per repo) make one call, `startAutoClean` (`src/worktrees/auto-start.ts`), which
  starts `src/entries/worktrees-clean.ts` detached and returns. The hook waits for nothing,
  judges nothing and removes nothing; the clean takes the machine-wide lock, and **its errors
  go to its own log** (`<stateDir>/worktrees-auto-clean.log`), never to the hook's answer. A
  hook test hands in a recorder (`recordingStarter`, `src/testing/hooks.ts`), so no process
  runs there. `worktrees.autoClean: false` starts neither. The clean **backs off when git's
  own lock files are held in the repo** (`index.lock`, `HEAD.lock`, `packed-refs.lock`, a ref
  lock; a project's own after-merge step may hold them): it skips this round with one line in
  its log and writes no hourly mark, so the next trigger runs — no sleep, no retry until
  success (`gitLockHeld`, `src/worktrees/auto-clean.ts`).
