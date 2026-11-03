# The hooks


The hooks live in `src/hooks/`. Every one of them is wired by the plugin:

The contract they follow: `.claude/rules/hooks.md`. The Claude Code behaviour they rely on,
each row proved: `claude-code-contract.md` § Hooks and § Worktrees.

### One frame for every hook

Every hook runs in the same frame (`src/hooks/run.ts`), in this order:

1. **Read the input.** Not JSON, another event, or a `cwd` outside git: nothing to do.
3. **The project's own copy.** When the project's `cc-smart-dev-kit.json`
   lists the hook in `ownHooks` (`["git-guard"]`), the plugin's hook exits 0 and prints
   nothing, so the project's copy runs alone (§ The safe switch). Only that field is read
   (`ownHooksOf`), on its own, so it works even when the rest of the `cc-smart-dev-kit.json` is
   broken or needs a newer plugin. It is explicit on purpose: a project hook on the same
   event is not enough to silence a plugin hook, because it may be a logger, a different
   check, or a copy that does not cover the same commands — and a guard that went quiet for
   that would leave the person unguarded (owner). `cc-smart-dev-kit doctor`, run in a
   project, prints one `·` line per listed hook, and warns (`!`) when a listed hook has no
   project hook left to answer, or when a project hook runs next to a plugin hook the list
   does not name. A hook the project wires itself skips this step: that wiring is its
   opt-in. **Three hooks skip the step themselves:** `session-escape-guard`, `job-route` and
   `user-away` are `alwaysOn` (`HookSpec.alwaysOn`), so the frame never reads `ownHooks` for
   them — the project's file is one of the things the first guards, the second limits what the
   session itself may launch, and the switch of the third is the person's (§ The session-escape
   guard, § The Bash judge and the job route, § While the person is away).
   `ownHooks` does not accept `session-escape-guard`'s or `user-away`'s name; it still accepts
   `job-route`'s,
   because a project file written before 1.0.0 may carry it, and the name silences nothing
   (`UNSWITCHABLE_HOOK_NAMES`).
4. **Read `cc-smart-dev-kit.json`.** When it is broken or needs a newer plugin, the hook
   **fails closed**, each in the way that suits its event: a guard asks the person (it cannot
   know whether the project turned it on), an informational hook says one line. "Closed"
   never means silent: a person must hear why.
5. **Run.** An informational hook's error is one line on stderr and exit 0: its bug never
   stops work. A **guard's** error answers through its `onCrash` (`guardCrash` in
   `specs.ts`): it asks about the call in its own domain, so a crash never lets a call
   through.
6. **While the person cannot answer** (`cc-smart-dev-kit user unavailable`), an answer that
   asks them becomes a deny (`askedWhileAway`, § While the person is away). It keeps the
   hook's own words, adds "parked as #N", and puts the call on the person's list as an
   `action` with its exact command. One step for every hook, so a new guard needs nothing
   here. It only ever makes an answer stricter: a deny, an allow and silence pass through
   unchanged, and a state it cannot read keeps the ask.
7. **Record an ask.** An answer that asks the person is appended to `guard-asks.jsonl` in the
   state folder (`src/hooks/ask-log.ts`): the time, the hook, the session, the tool and a
   short reason, put through `maskedLine` so no secret reaches it. The file stays small by
   the rule of `update.log` (past `LOG_MAX_BYTES` the newer half is kept). A write that fails
   is one line on stderr and never changes the answer. An ask that step 6 turned into a deny
   is no ask: it is on the person's list instead.

Each hook's answer when it fails (the same table is in `.claude/rules/hooks-guards.md` § Fail safe):

|---|---|---|---|
| Its own code throws | `onCrash`: **ask** about the call (none outside its domain; silent on PostToolUse) | one stderr line, exit 0 | one stderr line, exit 0 |
| The input is not JSON | **ask**, in general | one stderr line, exit 0 | one stderr line, exit 0 |
| Cannot start, times out, fails (exit code other than 0 and 2) | `"onFailure": "block"`: the call is **blocked** | Claude Code goes on | Claude Code goes on |

The command `plugin/bin/cc-smart-dev-kit` runs through the same shim with `--missing=fail`: no
bun is one stderr line and exit 1, because a command must never report success when it did not run.

The agent guard is also wired on **PostToolUse** for the same tools (`Agent|Task|Workflow`).
Claude Code fires it **at the launch**, with the tool response `status: "async_launched"`,
`agentId`, `resolvedModel` and `outputFile`; the order is PreToolUse, PostToolUse,
SubagentStart, SubagentStop. A launch the guard asked about, and the person allowed, is recorded
there with that `resolvedModel` rather than a rebuilt one (§ The Agent guard).

The frame is general on purpose: later hooks (notifications, the routing of heavy jobs)
are new specs in it.

### Worktrees: Claude Code's own

Every project uses Claude Code's own worktrees (owner). A new task starts from
the main checkout with `claude -w <task-name>`, and Claude Code makes
`<repo>/.claude/worktrees/<task-name>` on the branch `worktree-<task-name>` (a `/` in the
name becomes `+`). It keeps its own lock on the worktree, its cleanup marker, the reset of a
reused clean worktree, `-w "#123"` and its Git LFS handling — none of which a hook could
rebuild. Entering an existing worktree is `claude -w <name>`, or `EnterWorktree` with its
`name` (which resumes it as it was left); `EnterWorktree` with a `path` only switches between
worktrees for a session already inside one, and fails from the main checkout. An unrelated
task from inside a worktree goes back to the main checkout first. A subagent with its own
worktree never calls either tool: Claude Code refuses both, and it uses `cd` to move inside
its own checkout.

- **The base comes from `origin`'s default branch** under `worktree.baseRef: "fresh"` (the
  default; it fetches that branch only when the repo was not fetched for 24 hours). A project
  whose base branch is another one sets `"worktree": {"baseRef": "head"}` in its committed
  `.claude/settings.json`: a worktree, and a subagent's worktree, start from the current
  branch. `project init` writes that line, and `doctor` warns with the line to add when a
  non-default base has no `baseRef: "head"`. `baseRef` takes `"fresh"` or `"head"`, never a
  branch name (`docs/claude-code-contract.md` § Worktrees).
- **`.worktreeinclude`** names the git-ignored files a worktree needs; Claude Code copies
  them in. There is no setup step: the session runs the project's install first.
- **`.claude/worktrees/` is git-ignored by the project**; `doctor` warns when it is not.
- **Cleanup:** Claude Code removes a clean worktree of an unnamed session on exit and asks
  first for a named one or one with work left; a subagent's worktree is removed when it made
  no changes. `cc-smart-dev-kit worktrees` finds the repo's
  finished ones, and `cc-smart-dev-kit sessions` lists a project's sessions in its nested
  worktrees (the project folder is the path with every `/` and `.` turned into `-`).

`project init` writes no worktree hook, and takes out what the retired engine left: its fields,
and its hook lines in both project settings files. `doctor` fails (`✗`) on either: the parse
line names a retired field, and one line per settings file names a leftover hook line, both
with `cc-smart-dev-kit project init` as the fix.

### Finished worktrees clean themselves (D48)

Worktrees pile up: one project had 73. Claude Code removes a subagent's worktree by itself
only when it holds no change at all, and `cc-smart-dev-kit worktrees --clean` removes only
what it can prove finished — but only when someone runs it. Since 1.0.0 that safe clean also
runs by itself (owner's decision D48, 2026-10-22).

- **One home for the clean.** `cleanFinished` (`src/worktrees/clean.ts`) removes what the scan
  judged finished, with its branch, forgets a worktree whose folder is gone, and reports what
  it removed and kept. `worktrees --clean` and the background clean both call it, so the two
  cannot judge differently. Nothing forces: the verdict (`verdict.ts`), the replay of a branch
  onto the base (`workOnRef`), and the fresh verdict `removeWorktree` takes right before it
  moves a folder decide, so a session, a program, a Docker container, uncommitted changes, a
  local file, a commit not on the base or a replay that cannot answer all keep the worktree.
- **The background clean** (`src/worktrees/auto-clean.ts`, run by the bundle
  `src/entries/worktrees-clean.ts`) takes the machine-wide lock (`LOCK_PORTS.worktreesClean`)
  and does nothing when it is busy, re-reads `worktrees.autoClean`, fetches `origin/<base>`,
  scans, cleans, and records the result for the hooks in the state folder
  (`src/worktrees/auto-state.ts`: one `worktrees-auto-clean/<key>.json` per repo, one
  `<key>.told.json` for what a session start already showed, and one line per run in
  `worktrees-auto-clean.log`, kept small by the update log's rule). Its own errors are that
  log line too: the process never throws at a person.
- **When it runs.** `after-merge` starts it once per pull request merged into the base, and
  `worktree-leftovers` at an attended session start — at most once an hour per repo (decided
  in the hook for speed, and again under the lock, so sessions that start together clean
  once), never in `claude -p`. Both make ONE call (`startAutoClean`, `src/worktrees/auto-start.ts`):
  it starts the bundle detached (`startDetached`, as the self-update starts its check) with the
  main checkout, the trigger and the session's own folder, so the worktree that session works
  in stays even when Claude Code has not written its record yet. A hook never waits for it.
- **What the person is told.** The next attended session start of that repo shows one
  `systemMessage`, once: `cc-smart-dev-kit removed 2 finished worktrees: app-wt-a, app-wt-b
  (work on main)`, then marks it told (`markTold`, keyed on the removal's number, so a clean
  that finished in between is not marked). The leftovers note still names the worktrees the clean
  did not remove, with the reason — including the reason the last clean itself gave.
- **The off switch** is `worktrees.autoClean` (1.0.0, optional, on when left out): `false`
  starts neither, and the background clean says so in its log.
- **It backs off while git is writing in the repo** (WA1): a project may run its own
  after-merge step in the main checkout (a fetch, a fast-forward, an install) at the moment
  the clean runs git there. When git's own lock files are held (`index.lock`, `HEAD.lock`,
  `packed-refs.lock`, or a ref lock under `refs/`), the run skips this round with one line in
  its log and writes no hourly mark, so the next trigger runs; there is no sleep and no retry
  until success (`gitLockHeld`, `src/worktrees/auto-clean.ts`).

### The worktree engine (retired in 1.0.0)

The engine retired in 1.0.0 (D20; owner, 2026-10-21) and its code is gone: the fields it
read are refused, its three hook names print the fix and exit 1 (a non-blocking error: exit 2
would block every subagent's stop), and `project init` takes both out (§ Per-project opt-in).

What it was, and why it went: a WorktreeCreate hook **replaced** Claude Code's own creation,
for sessions and subagents, in every project where it was wired, and a hook that prints no
folder makes the creation fail (proved live). A hook-made worktree loses the lock Claude
Code puts on a worktree while a session uses it, the marker its periodic sweep looks for, the
reset of a reused clean worktree, `--worktree "#123"` (a pull request) and the neutralised
filter drivers (Git LFS). Claude Code makes the same worktree shape on its own, with all of
that, so the plugin ships no worktree hook at all.

### The plugin's hooks

| Hook | Event (matcher) | On when | What it does |
|---|---|---|---|
| `main-folder-guard` | PreToolUse (Edit, Write, NotebookEdit) | `worktrees.guardMainFolder` | Denies an edit of a file in the main checkout itself, with the way into a worktree. (Until 0.6.0 it also placed Serena's edits, with the `serena-root` hook's record; both went with Serena.) |
| `playwright-output` | PreToolUse (`mcp__playwright__.*`) | always (a `USER_HOOKS` bundle: it reads no cc-smart-dev-kit.json) | Rewrites a relative `filename` to an absolute path in the browser's output folder, with `updatedInput` and no permission decision; a relative name with a `..` segment is DENIED (the launcher's `--allow-unrestricted-file-access` means the server takes that path as it is). Answers only while the live `playwright` registration is the one setup recorded — a server of the person's own is left alone entirely. |
| `fable-session` | SessionStart, PostModelSwitch, Stop | **machine-wide** | One `systemMessage` to the person, once a session, when the session's own model is the **`fable` tier**; nothing to Claude, never an error and never a block — the line itself was seen live (2026-10-17), but not on `PostModelSwitch` or `Stop` yet. The model: at a start, the `model` the input names (no fallback); at a switch, `to_model` — the model the session moved TO; at a stop, the one that answered in the transcript, then `ANTHROPIC_MODEL` — the guard's own reading of the tier. Not `UserPromptSubmit`: it judged the PREVIOUS answer's model, so it missed the switch and warned after a switch back (the live bug of 2026-10-17). § The Fable-session note. |
| `tier-view` | SessionStart (every source), UserPromptSubmit | **machine-wide** | One note to Claude (`additionalContext`) of what each subagent tier (`haiku`, `sonnet`, `opus`, `fable`) runs now and the effort rule that follows, read the Agent guard's way through the session's own gateway view. While auto mode's safety checks fail for the session's scope, one more line says so, with what the person can do. Said at every start, and at a prompt only when it differs from the note said last in this session. § The tier note. |
| `review-record` | SubagentStart, SubagentStop | `cc-smart-dev-kit.json` exists | When a review agent (`workflow.reviewAgents`) starts, notes the commit the working folder is on and its branch; when it stops, records that start commit on that branch — the record the merge guard reads. Commits made during the review count as change after it. Nothing for an agent that stopped inside its own worktree. § The review record. |
| `subagent-background` | SubagentStop | `cc-smart-dev-kit.json` exists | A subagent that ends its turn with background work **it started** still running (a Bash command, or a subagent it launched) is blocked **once**, with one plain reason: wait for the work or stop it, then report. The input's `background_tasks` is the session's list, so the hook reads the agent's own transcript (`agent_transcript_path`) as JSONL, line by line, and keeps only an id named in a **tool result of the agent's own call** — a Bash background launch (`Command running in background with ID: …`) or an Agent launch (`agentId: …`) — never one in its brief or in a file it read; the ending agent's own entry is dropped (a background subagent appears in its own list). No `additionalContext`, never a second block (`stop_hook_active`), and nothing when the transcript cannot be read. § One frame for every hook. |
| `builder-finish` | SubagentStop | **machine-wide** | A builder (an `agent_type` ending in `builder`) whose brief holds the line `Your task: #<n>` is blocked **once** while task #n still has open blocking steps, each named with the `task_done` call that closes or drops it. Silent for any other agent, without the line, and when the task or the task list is not there. § A builder's hand-back. |
| `keep-going` | Stop | **machine-wide**: it needs no cc-smart-dev-kit.json; `ownHooks` silences it | The main session's turn end is blocked **once** when a phase of a plan this Claude process works on is `in_progress`, no background work runs and the last answer has no `Waiting for:` line; the reason names the phase and the next ready phase to start. Silent on any read it cannot make. § The keep-going guard. |
| `agent-usage` | SubagentStop | **machine-wide** | One line per subagent in `<stateDir>/agent-usage.jsonl`: the time, the session, the agent's id and type, and per model the replies, the four token sums and an estimated USD cost — from the agent's own transcript, never a word of its content. A second stop of one agent supersedes its first line when read; the record is kept small like the ask log. One stderr line when the transcript cannot be read or the record cannot be written. § Each subagent's usage on record. |
| `user-away` | PreToolUse (AskUserQuestion, ExitPlanMode), PermissionRequest, UserPromptSubmit | **machine-wide**, and `ownHooks` cannot switch it off; silent unless the person is marked unavailable | While the person cannot answer: denies the two tools that ask them, with the step that parks the question; denies Claude Code's own permission prompt and parks the call as an `action`; one note per change at the prompt. The frame's step 6 turns every other hook's ask into a deny the same way (§ While the person is away). |

### The Agent guard

`agent-guard` (PreToolUse on `Agent`, the older name `Task`, and `Workflow`) is **machine-wide**, like
`update-check`: it runs with or without `.claude/cc-smart-dev-kit.json`, and a broken or too new file
does not change its answer (the frame hands it the input and the environment instead, and its
`outsideGit` and `onConfigProblem` judge on) — with one exception, D59's queue rule, which reads
the project's caps and this repository's store, so the frame's own `run` gets the checkout and
the paths without one let the launch through. A project may still silence it through
`ownHooks`, which is read on its own: the list works even when the rest of the file is broken.
It is wired `--missing=ask`: a guard fails closed.

Why the owner asked for it (2026-10-16): an Agent call that names no model runs on the
session's model — on an Opus session, every plain `Explore` is an Opus spawn — an Opus or
Fable agent spends the person's own plan usage, and a subagent at `low` does work nobody chose
to cheapen. So the guard holds the effort rule first — `medium`, `high`, `xhigh` or `max` only,
`ALLOWED_EFFORTS` in the code, `low` refused on every model (D5, D13: `medium` for searches and
reads, `high` for building and reviews, `xhigh` for the hardest judgment, `max` on `haiku` or
`sonnet` when the task wants it, whatever model answers them; the `opus` tier asks at `max`).
**An affordable backend is held to no level** (the owner's decision, 2026-10-26): until then the
guard required `max` of a `haiku` or `sonnet` a backend answered, refused any other
`CLAUDE_CODE_EFFORT_LEVEL` there, and the tier note said "runs at max". Claude picks the effort
by the task on every tier, as it does for Claude `haiku` and `sonnet`; a person who wants a
backend at a fixed effort pins it in the router (D64, `gateway effort`), which overrides what
the request carries — so Claude needs to know nothing about backends and effort. Then the guard
reads the launch's
`model`, `effort`, `subagent_type` and prompt, and resolves the model the launch will really
run on:

1. a family name (`haiku|sonnet|opus|fable`) goes through Claude Code's own override, when
   the person set one (`ANTHROPIC_DEFAULT_<FAMILY>_MODEL`; all four exist on 2.1.301, Fable
   included; `gateway on` writes none since 0.5.0), then — with the gateway on for **this
   session** — the family's slot, the way the router
   picks it (`FAMILY_SLOTS`: haiku → scout, sonnet → worker, opus → opus, fable → fable): its
   chain's first target answers, read from `gateway.json` through the gateway's own
   `loadConfigFile`. A slot with no chain answers as Claude, and the Claude model answers. So `sonnet` is
   an affordable slot exactly when the session is on the gateway and the
   worker's chain starts with a `<backend>:<model>`. **The session's gateway is its own
   effective `ANTHROPIC_BASE_URL`, read from the hook's environment** (`sessionGatewayOf`;
   RF1-2): Claude Code hands a hook the value the session runs with — the project's personal
   file over its team file over the user file, a `--settings` file over all of them
   (`docs/claude-code-contract.md` § Hooks) — so `gateway project off`, a project turned on
   while the machine is off, and `launch --settings` are each judged as the session runs. No
   URL or Anthropic's own address is off; `…/p/<name>` reads that profile's chains
   (`profileView`), and a name the config lacks reads as plain Claude (`plainClaudeView`), as
   the router answers it. The StopFailure alert reads the same facts, but only to say a plain
   fact about the slot that answers the session (a session off the gateway gets the plain line,
   and no alert offers a command: `docs/gateway.md` § The alert);
2. a full Claude id goes through its family's slot the same way; a slot key or
   `<backend>:<model>` is resolved as itself (a slot's first target answers); **any other name** (`best`, `opusplan`,
   `default`, `inherit`, a name no rule knows) is resolved the strictest way — the rule for a
   Claude id with no family to read — because only what the guard can prove affordable is
   affordable;
3. a `fork` always inherits: its model is the session's own, read from the tail of the hook
   input's `transcript_path` (`lastClaudeModel`, shared with the StopFailure alert; a
   sidechain line is a subagent's, not the session's), else from `ANTHROPIC_MODEL`; an
   unknown one counts as Claude Opus.

**Before those steps, Claude Code's own overrides decide which name and which effort the launch
really gets** (`effectiveLaunch` in the launch policy; the order proved live on 2.1.306, and in
Claude Code's own docs and code):

| Override | What the launch runs on |
|---|---|
| `CLAUDE_CODE_SUBAGENT_MODEL_FORCE` on (`1`, `true`, `yes` or `on`, the values Claude Code reads as on) | `CLAUDE_CODE_SUBAGENT_MODEL`; unset or `inherit`: the session's own model (step 3's reading; unknown → the `opus` tier). The call's `model` does not count. |
| `CLAUDE_CODE_WORKFLOW_SUBAGENT_MODEL` (not empty, not `inherit`) | its model, for a Workflow `agent()` only; FORCE comes first; an Agent call is not touched |
| neither | the call's own `model`. A plain `CLAUDE_CODE_SUBAGENT_MODEL` is only a default for a call that names none, after the agent's own definition, which no hook can read — so such a call is still refused for naming no model |
| `CLAUDE_CODE_EFFORT_LEVEL` (not empty) | that effort for every launch, whatever the call names |

The guard reads them from its own environment. **A settings file's `env` reaches a hook's
environment** (proved live on 2.1.306, for `--settings` and for a project's
`.claude/settings.json`), so that is all it reads — no settings file of its own. **Under FORCE
Claude Code takes `model` off the Agent tool, and under `CLAUDE_CODE_EFFORT_LEVEL` it takes
`effort` off** (proved live: the PreToolUse `tool_input` carries neither). So before 1.0.0
the guard refused every Agent launch there ("names no `model`"); now such a launch is judged on
what the variable sets. Every ask and refusal says which override applied ("This launch runs on
`haiku` because `CLAUDE_CODE_SUBAGENT_MODEL_FORCE` is set …"), and the record names the model
the launch really runs on. One refusal rests on the variable alone, and only the person can
change it, so the message says where it is set: a `CLAUDE_CODE_EFFORT_LEVEL` no subagent may run
at (`low`, or a level no rule knows). (Until 2026-10-26 a second held: anything but `max` while
an affordable slot answered. The owner dropped it.)
`auto` (`EFFORT_AUTO`: the model picks its own default) is the person's own choice, like a
fork's inherited effort: it is never refused for itself, and since no model's default is `max`,
the `opus` tier runs it with no question (recorded as `opus:auto`); Sonnet, Haiku and an
affordable slot run it, and the `fable` tier keeps its reason-line rules. Refusing it would lock
out every launch, the same way the missing `effort` once did. A fork keeps its rule: the session's model, and the effort it names,
else the session's own. Two readings are the stricter one on purpose: under FORCE alone the
built-in Explore agent runs on its own listed model (Opus where the session runs Fable), but a
person's own agent named `Explore` runs on the session's, and a hook cannot tell them apart, so
both read as the session's model. One case is not covered: Claude Code's code (2.1.306) still
reads `CLAUDE_CODE_WORKFLOW_SUBAGENT_MODEL` under FORCE when an admin's managed settings set it,
and the guard reads no managed settings, so it judges FORCE's model there.

A **Workflow** tool call is judged too: its `agent(...)` launches run inside the tool and pass
no hook of their own (proved live on 2.1.301 — a project hook with the matcher
`Agent|Task|Workflow` saw the `Workflow` call and nothing else), so the guard reads the
script's text: the `model`, `effort` and `agentType` of each call, and its prompt when that
is a fixed string literal (`readWorkflowScript` — a template that builds its text, `` `${…}` ``,
is not one, and neither is a literal an operator changes, `effort: "high" && "max"` or
`"a" + b`). An option counts only as a key of the call's own options object, quoted or not
— never the same words in the prompt or in a nested object (`schema: { effort: … }`). A
`model` held in a variable is refused rather than guessed, and a prompt built at run time is
refused for a Fable launch (its reason line cannot be read). Two things are refused for the
whole call (`workflowRefusal`), because no rule can hold for a launch the guard cannot follow:
`agent` or `workflow` mentioned without a direct call (`const run = agent; run(…)`,
`agent?.(…)`, either passed around), and a call whose options are built at run time (a
`...spread`, a computed `[…]` key, the same key twice). The strictest launch of the call
answers for the whole call. A launch with no readable `model` is judged, not refused, when
FORCE or `CLAUDE_CODE_WORKFLOW_SUBAGENT_MODEL` names the model it runs on.

**Which script a Workflow call runs** (G2; `judgeWorkflowCall`, the files in
`src/hooks/agent-guard-workflows.ts`). Proved live on 2.1.306, the call's PreToolUse input holds
one of four shapes — `{"script": …}` inline, `{"name":"probe"}` for a saved workflow,
`{"scriptPath":"<path>"}` for a path run, `{"name":"<plugin>:<meta.name>"}` for a plugin's —
and the guard finds the script the way Claude Code's own code (2.1.306) does:

| The call names | The script the guard reads |
|---|---|
| `script` | that text — it runs whatever else the call names |
| `scriptPath` | that file, relative to the input's `cwd`; one over 524288 bytes is refused, as Claude Code refuses it |
| a bare `name` | the `.js` file whose `meta.name` is that name — the file's own name plays no part — in `.claude/workflows/`, from the `cwd` up to the repo root (never the home folder itself), then in the user's `<config>/workflows/`; the nearest folder wins, the project's over the user's |
| `<plugin>:<name>` | the file whose `meta.name` is `<name>` in that plugin's `workflows/` folder, or in the paths its manifest's `workflows` lists instead; the plugin's folder is `CLAUDE_PLUGIN_ROOT` for this plugin, else its install in Claude Code's `installed_plugins.json` (a `project` or `local` install whose folder holds the `cwd`, the deepest first, before the `user` one) |

`meta` is read the way Claude Code reads it: `export const meta = { … }` as the first statement,
a pure literal (no variable, no `${…}`, no spread, no computed key, no method), with a non-empty
`name` and `description`; a file without one is no workflow. Each nested `workflow("<name>")`
or `workflow({ scriptPath: "…" })` in the script is found the same way and judged with it, one
level deep as Claude Code runs them; a nested workflow named at run time, or a nested script
that nests again, refuses the whole call. **Two files in one folder that claim one
`meta.name`** with different texts: Claude Code keeps the one its folder listing gives last,
an order the guard cannot know, so the guard treats the name as unreadable (two copies of one
text are one script). A run the guard cannot read — a built-in workflow (`deep-research`: its
script is inside Claude Code), a missing file, those two files, a `resumeFromRunId` (the run
goes on from a script the guard does not see), a call that names none of the three — **asks**,
naming why, and is **denied in `claude -p`**, where nobody can answer. Known limits: a script
that changes between the guard's read and the run is judged as it was read; an override that
does not parse (Claude Code then keeps the farther copy) is judged as written; and a launch in
a loop is one launch to the record.

**The `opus` tier** (the owner's decision D11, 2026-10-17) is judged by its effort alone: at
`high` or `xhigh` it runs with no question, for any agent type and any purpose — a review or a
build, with or without a reason line — and at `max` (`OPUS_ASK_EFFORT`) it asks the person,
naming the model and the effort. An `Opus reason: <word>` line is optional: when a prompt has
one, its first word goes into the record, and nothing else reads it. A fork names no effort —
it runs at the session's own, which the person chose — so an `opus`-tier fork is allowed; a
fork that names `max` itself is held to the same rule. **The free path is for a reading the
guard can prove is the Opus family**: the `opus` name, a Claude Opus id (a cloud provider's
`us.anthropic.claude-opus-…` too), the opus slot, or an id the person's own
`ANTHROPIC_DEFAULT_<FAMILY>_MODEL` names for it. A reading with no family — a name no rule
knows (`best`, `inherit`, an id the guard cannot read) — may stand for a higher tier, so it
asks at any effort, is refused in `claude -p`, and is recorded as `opus:unreadable`. (Before D11 the tier needed a review
agent type or a listed reason word, and refused every launch but a review at `high`; that
reason list, the review-agent list and its variable are gone.)

**Tiers, not vendors** (the owner). `LaunchModel.tier` is what the rules go by:
`opus` and `fable` mean the tier whatever answers behind them — a family name keeps its tier
through `ANTHROPIC_DEFAULT_<FAMILY>_MODEL` and through its family's slot, a Claude id has its
family's, and a name the guard cannot read is the `opus` tier, the strict reading. So an
override that points `opus` at a backend never becomes an affordable slot, and still asks at
`max`; the messages name both, `` `opus` (answered by
openai:gpt-5.5) ``.

The Fable rules are the owner's of 2026-10-16, and each is the person's call:

- **A read-only agent** (Plan, Reviewer, Explore, auditor) takes any word of
  `FABLE_REASONS` — `hard`, `rewrite`, `ui-design`, `architecture`, `review`, `plan`,
  `unsatisfied` — where `unsatisfied` is a fresh attempt after the person did not like the main
  session's answer (`subagent-decision` § Choosing Fable has the brief it gets) and `review` is
  a second opinion on a hard or high-stakes change the session may run on Fable by its own
  judgment (`review` § Second opinion has the conditions).
- **An agent that can change files** — any other type, a fork included — takes the one word
  `build`: the person asked for Fable to build it, and approves that launch. Every other word,
  and no line at all, is denied with the line it needs (`FABLE_BUILD_REASON`, which is not one
  of the read-only words). A fork of a session whose own model is the `fable` tier is judged the
  same way, so such a session can fork with `Fable reason: build - …` and is not refused
  outright.

### Each subagent's usage on record

`agent-usage` (SubagentStop) is **machine-wide**, like the Agent guard's launch record and for
the same reason: what a subagent's replies cost is the person's own spend, not a project's
policy. At every subagent's stop it reads the agent's own transcript
(`agent_transcript_path`) and appends one line to `<stateDir>/agent-usage.jsonl`
(`src/hooks/agent-usage.ts`). The line holds the time, the session, the agent's id and type,
and per model the replies, the four token sums (`input_tokens`, `output_tokens`,
`cache_read_input_tokens`, `cache_creation_input_tokens`) and an estimated USD cost from the
one price home (`src/gateway/prices.ts`, Claude's list price; a model with no row — an
affordable backend's — is recorded with its tokens and no price, and `unpriced` counts those
replies). **Never content**: a transcript's text, tool input and tool result are skipped. A
reply is counted once by `message.id`, though Claude Code writes one `assistant` line per
content block, each carrying the reply's whole usage. A second stop for one agent (a block
made it continue) appends a newer line with the whole transcript, and `readAgentUsage` keeps
the newest per session and agent, so a cost is never a sum of two halves. The record is kept
small like the ask log (`src/hooks/jsonl-log.ts`: `LOG_MAX_BYTES`, the newer half kept). An
unreadable transcript, and a record that cannot be written, are one stderr line and exit 0. A
project that runs its own copy lists the name in `ownHooks`. `cc-smart-dev-kit usage` shows
each session's agents by type and model, their tokens and their cost (`README.md` § The usage
limit), and `usage --json` is the same facts as one object a portal can read.

The **subagent status line** (MD-13) is the same fact on screen: `plugin/settings.json` sets
Claude Code's `subagentStatusLine` to `cc-smart-dev-kit subagent-statusline`
(`src/cli/subagent-statusline.ts`), and the agent panel's row body for each subagent becomes
`<label> · <slot> → <model> → <effort> · <context>`, the slot taken from the model's Claude
family with the router's own mapping (`familySlotFor`). The context is the subagent's use,
`~45k/200k ctx (23%)`, from the task's `tokenCount` (the last request's input plus the output
so far: the current context, a little too high) and `contextWindowSize`; it is left out when
either is missing or the count is zero. On a narrow row the label shrinks first so the route and
the context stay whole, and when even those do not fit the context moves in front of the route.
It is a plugin setting, not a hook: Claude Code
runs the command on each refresh tick with `columns` and one entry per visible subagent on
stdin, and the command answers one `{"id","content"}` line per row (proved offline on
2.1.308, `docs/claude-code-contract.md`). The command names the launcher, never
`${CLAUDE_PLUGIN_ROOT}`: a plugin's settings file does not expand that variable (proved: the
literal string ran, exit 127), and the launcher is the one path an update cannot break.

### The keep-going guard

`keep-going` (Stop, `src/hooks/keep-going.ts`) keeps the main session from stalling in
subagent-driven work. The main session dispatches each phase's builder and hears it hand back.
A turn that ends while a phase is `in_progress`, with no builder running and no word on what it
waits for, leaves the plan stalled until the person notices. Subagents fire SubagentStop, not
Stop, so the hook is about the main session only.

It blocks the stop **once** when all of these hold, cheapest first:

1. The stop is not the one its own block caused (`stop_hook_active` is not `true`).
2. No background work runs: `background_tasks` is absent or empty. A subagent or a background
   command wakes the session when it lands (`docs/claude-code-contract.md` § Hooks).
3. No line of the turn's last answer starts with `Waiting for:` (any case, after a Markdown
   mark such as `**`, `>` or `-`). The answer is the input's own `last_assistant_message`, else
   the transcript's last answer (`lastAssistantText`). With neither, the hook cannot tell, and
   lets the turn end.
4. A phase of a plan this Claude process works on is `in_progress`. A plan is the process's own
   when it holds a task the process has claimed (`openPhasesOf`, `src/tasks/work/phases.ts`): the
   store's claim is the Claude process from `callerOf`, never the session id, so a `/clear`
   keeps the plan. A phase in progress in another session's plan does not count.

The reason is one short paragraph. It names each phase in progress as `#n subject`, then the
next ready phase of the same plan — the lowest-numbered phase that is `pending` with no open
blocker: "Start #m subject now (dispatch its builder), close #n with `task_done`, or end the
turn with a `Waiting for: <what>` line". With no ready phase it says to close the phase with
`task_done`, or to record its blocker with `task_note` and end the turn with a `Waiting for:`
line. The build skill says the same (`plugin/skills/build/SKILL.md`).

**Fail open everywhere.** The task store is the person's own, so the hook needs no
cc-smart-dev-kit.json and runs in a project with none; a project that runs its own copy lists
`keep-going` in `ownHooks`. It is silent outside git, with no task store, with no caller (no
live session record and so no Claude process to hold a claim), and on any read it cannot make.
A store it cannot read and a broken or too new project file are one stderr line; a crash is the
frame's one line. `keepGoingWouldBlockAt` gives the same decision to a sibling Stop hook, the
way `verifyGateWouldBlockAt` does, so the notifier can wait for the stop that really ends the
turn.

### A builder's hand-back

`builder-finish` (SubagentStop, `src/hooks/builder-finish.ts`) keeps a builder from handing
back unfinished work. The build skill launches each builder with the exact line
`Your task: #<n>` in its brief, where #n is the phase's task in the kit's task list
(`docs/design/tasks.md`), and the builder keeps its steps as tasks under it. At the builder's
stop the hook:

1. judges only an `agent_type` that ends in `builder` (`cc-smart-dev-kit:builder`);
2. reads the brief: the first `user` entry of the agent's own transcript
   (`agent_transcript_path`), from the file's first 1 MiB — never a later line, so a task
   number the agent wrote or read later does not count;
3. takes the first line that is exactly `Your task: #<n>`;
4. reads task #n under the main checkout's project key, the key the task server uses for
   every worktree of the repository, so a builder in its own worktree
   (`.claude/worktrees/<name>`) finds the tasks its caller made;
5. lists the steps that hold the task's done (`holdingUnder`, the same set `task_done`
   refuses on): open blocking tasks at any depth under it, reached through blocking tasks
   only. A non-blocking step holds nothing.

With any step open it answers `decision: "block"` once. The reason names each step as
`#id subject` and says how to close it: finish it and close it with `task_done` (with
evidence), or drop it with `task_done` outcome `"dropped"` and a note saying why, then hand
back. There is no `additionalContext`. The stop that block caused carries
`stop_hook_active: true`, and the hook is silent there: a step that truly cannot close never
traps the agent, and the caller sees it open in the task list.

It fails open: another agent type, no transcript, no `Your task:` line, no task list yet, or a
task that is not there is silence; a task list that cannot be read is one stderr line. It is
**machine-wide**, like `keep-going`: it reads only the person's own task list, never a project
setting, so it judges the same with no `cc-smart-dev-kit.json` and with a broken or too new
one. Outside git it is silent. A project that runs its own copy lists the name in `ownHooks`
(2.0.0 and later).

It never answers what `subagent-background` answers: that hook blocks for background work the
agent left running, this one for open steps. Both judge the same first stop, and both may
block it. The next stop carries `stop_hook_active`, so both pass it: a step still open after
the agent dealt with its background work is not named a second time.

### The session-escape guard

`session-escape-guard` (PreToolUse on `Bash`, `PowerShell`, `Edit`, `Write` and `NotebookEdit`)
stops a session from loosening the limits the person set for it. `src/hooks/session-escape-guard.ts`
is the whole of it. It is **machine-wide** like `agent-guard` (it runs with or without
`.claude/cc-smart-dev-kit.json`, in a folder outside git, and when the file is broken or too new)
and **`alwaysOn`**: `ownHooks` cannot silence it and does not accept its name, because the
project's file is one of the things it guards — a session could otherwise list the guard there
first. It is wired `--missing=ask` with `"onFailure": "block"`, and a crash of its own asks about
the calls in its domain (§ One frame for every hook).

| The call | The answer | Why |
|---|---|---|
| A line that runs `cc-smart-dev-kit workflow review-done` | **deny** | A review is recorded by the review-record hook when a review agent returns. A session never records its own. |
| A line that runs a kit command (the launcher, or `bun …/dist/cli.js` / `portal.js`) with `CLAUDECODE` removed | **deny** | The kit's commands that change this machine's settings (the workflow gate, the portal, updates) refuse to run while Claude Code's `CLAUDECODE` is set — a courtesy a command can drop. This is the lock. |
| A line that reaches the portal's port (20150) on this machine | **ask** | The portal has no sign-in of its own (D9): its pages change the gateway, the judge, updates and the review gate. |
| An Edit, Write or NotebookEdit of a `.claude/cc-smart-dev-kit.json`, the kit's settings folder (`workflow.json`, `gateway.json`), its state folder (the review record, the ask log) or its installed plugin folder (`plugins/cache/<marketplace>/<plugin>`) | **ask** | They hold the limits the guards enforce: the project's gate and `ownHooks`, the person's own policy, the record of what was reviewed, and the guard bundles Claude Code runs. |

**How `CLAUDECODE` counts as removed.** The shell reader (`src/shell/command.ts`) gives each
command of the line, its wrappers (`setsid env …`, `flock <file> env …`, `script -c …`,
`busybox sh -c …`), and the lines it runs (`bash -c`, `eval`, a here-string,
`cc-smart-dev-kit job run --`, `ssh host '…'`) — and the commands its **runners** run: `find`'s
`-exec`/`-execdir`/`-ok`/`-okdir` (every action, up to its `;` or a `+` right after `{}`; the
value of a test such as `-name` starts none), `watch`'s command (`-x` or through `sh -c`; `-d`
takes its value only attached), `su -c`/`--command`/`--session-command` (wherever the user
stands, also after `--`) and `parallel`'s command (after its options, an unknown option read
both ways; its `:::` arguments are added to the command, quoted, or put at its `{}`, and with no
command they are the commands), read in `nestedCommand` beside `bash -c` so every guard that
walks the nesting — the git guard, the merge guard, the issue-write reader, `job-route`, the
session-escape guard — sees the inner program (`xargs` is a wrapper). A `{}` as the program is
a computed one. The runners are `RUNNER_PROGRAM_NAMES`, and the merge reader's own table keys
on the same names (a test keeps the two equal). On one command: `CLAUDECODE=…` before it, `env -u
CLAUDECODE`, `env --unset`, `env -i` (and `env -`), `sudo`/`doas`/`su`/`runuser`/`ssh`/`systemd-run`
(a fresh environment). For the commands after it in the same line: `unset CLAUDECODE`, `export
CLAUDECODE=…`, `export -n`, `declare +x`, a step that is only `CLAUDECODE=`, and in PowerShell any
write to `$env:CLAUDECODE` (`Remove-Item Env:CLAUDECODE`, `SetEnvironmentVariable`; the whole
line counts, because PowerShell's lexer cuts at braces). A kit command is also found as an
argument of a runner (`find -exec`, `watch`, `parallel`), **and the words before the kit word
inside that runner's arguments count too** — `find … -exec env -u CLAUDECODE <kit> …`, `flock
<file> env -u CLAUDECODE <kit> …` — except after programs that only read their arguments (`ls`,
`grep`, `git`, `echo`…), so `env -u CLAUDECODE claude -p` and `env -u
CLAUDECODE bun test` — the usual way to start a nested session — are not touched. PowerShell's
`Start-Process` is read by its `-FilePath`/`-ArgumentList` (or the positional words), and
`-UseNewEnvironment` starts the command with a fresh environment, the same as `sudo`. Claude Code's
Bash tool keeps no `export` or `unset` from one call to the next (seen live 2026-10-22: an
`unset CLAUDECODE` in one call, `CLAUDECODE=1` again in the next), so a line is the unit. A
program the line works out when it runs (`$(which <kit>)`, `$KIT`) cannot be named: when the
line names the kit command, the guard **asks** instead of staying silent. **A path that only
passes through a folder of that name (`…/cc-smart-dev-kit/src/x.test.ts`) names no command**;
a launcher the line names by its path (`/…/bin/cc-smart-dev-kit`, `cc-smart-dev-kit.cmd`), an
assignment that binds it to a variable, a substitution that runs it, and a bundle among the
computed program's own words each still ask.

**How an edit is matched.** The path the call names is taken as written and as a real path (an
Edit follows a link, so `notes.txt` linking to `workflow.json` changes `workflow.json`);
either one that is a `.claude/cc-smart-dev-kit.json` (any folder: the main checkout, a worktree
inside `.claude/worktrees/`, a folder outside git), or inside the settings or state folder
(`cliPaths()`, so `CLAUDE_CONFIG_DIR` moves the state folder with it) or the installed plugin
folder, asks. **Each folder is compared as written and by its real path**, so a home folder whose
`~/.config` is a link cannot hide the file. Names compare without case.

**How a shell write is matched.** A Bash or PowerShell line that writes those same files asks,
with the Edit's reason: a redirect (`>`, `>>`, `>|`, `&>`; `2>&1` and `>&2` name no file; the
reader's `redirectionTargets` gives the targets), `tee` (and `Tee-Object`), `sed -i` / `perl -i`,
`cp` / `mv` / `install` / `ln` (`-t` and `--target-directory` included) and PowerShell's
`Copy-Item` / `Move-Item` (`-Destination`, or the last word), `dd of=`, `Set-Content`,
`Add-Content`, `Out-File` (`sc`, `ac`, `si`, `ni`, … — PowerShell takes any prefix of a
parameter name). Every target goes through the same `kitFileKind` as an Edit, as written (the
`~`, a relative path against the input's `cwd` and against each `cd` / `Set-Location` /
`Push-Location` the line ran before it) and as a real path, with each folder compared as written
and by its real path. **On Windows the Bash tool is Git Bash**, so a line may name a native file
in MSYS2's own form (`/c/Users/…` for `C:/Users/…`): the target is read as the drive it names
before the comparison (`shellTargetPath`, on Windows and for a Bash line only; PowerShell runs
natively), beside the Win32 forms Git Bash also accepts (`C:/…`, and a quoted `"C:\…"`, where
Bash keeps the backslashes). A write into the installed plugin folder asks too (never a deny: a
person may mean it before an update), and Claude Code's own `claude plugin …` commands are not
touched.
A target the line works out when it
runs (`> $FILE`, `$(mktemp)`, a glob) cannot be resolved: it asks only when the line also names
a protected file or folder by text (`cc-smart-dev-kit.json`, `.config/cc-smart-dev-kit`, the
state folder, the plugin cache folder), and passes otherwise. `cat`, `grep`, `sed` without `-i`,
`cp` *from* the file and a message that names it all pass.

**What it does not read.** The limit is the one the review gate has: it stops mistakes and the
easy shortcut, not a same-user process set on getting past it. A script file's content (`env -u
CLAUDECODE sh run.sh`), a program or port named at run time (`curl localhost:$PORT`), a portal
started with another `--port`, a hostname that resolves to this machine, and a file written by a
program the guard does not know (`python -c "open(…,'w')"`, `rsync`, `truncate`) are not read.
The portal check reads the text of the whole command, so a script in a here-doc that connects
counts — and so does a commit message that only mentions the address: one extra question, not a
miss.

### While the person is away

`cc-smart-dev-kit user unavailable` marks the person as unable to answer — asleep, in a meeting,
on a phone; the owner's pair of words, 2026-10-25 — and `user available` ends it. A session that
stops to ask, or waits on a permission prompt, only stops: nobody reads the question for hours,
and waiting leaves ready phases unstarted. So while the person is away the hooks
hold the line, and the sessions **park** what needs the person on a list instead
(`/cc-smart-dev-kit:user-unavailable`); `/cc-smart-dev-kit:user-available` goes through it when
they are back.

**Whose an item is** (`src/user-away/whose.ts`, 1.11.1). The list is the machine's, but the
person brings each session back on its own, and two sessions that each went through every item
asked the person each other's questions. So `user list --json` gives each item `whose`, judged
for the session that runs it (`CLAUDE_CODE_SESSION_ID`), and `/cc-smart-dev-kit:user-available`
goes through its own items only:

- `another session`: a running session owns it (Claude Code's session records, `liveSessions`),
  and `waitsIn` names it and its folder. The skill names it in one line and never asks about it,
  runs it or clears it.
- `no session`: no running session owns it, and it was parked in another project. The skill asks
  once whether to take those here.

**Four answers, one hook (`src/hooks/user-away.ts`), never looser than before.** Each is a deny
where there was a question, never an allow.

- **PreToolUse on `AskUserQuestion` and `ExitPlanMode`:** denied, with the step that parks the
  question. Nothing is parked by the hook: the session parks it in its own words, or takes the
  choice and parks a `decision`. A plan waiting for approval is the same wait as a question.
- **A kit guard that would ask** — the frame's step 6, for every hook, so a new guard needs
  nothing: the ask becomes a deny that keeps the guard's own words and adds "parked as #N", and
  the call is parked as an `action`. A deny, an allow and silence pass through unchanged. A park
  that fails (a full list, a lock held too long) still denies, and the deny says to park by hand:
  the person is away, so the call must not wait. **The park fits inside the hook's time:** it
  waits at most `PARK_WAIT_MS` (1 s) for the lock, half of `BUDGET_MARGIN_MS`, the time a guard
  keeps back for its answer. For a guard that runs on a budget (the merge guard 25 s of its 30 s,
  `job-route`'s `workflow propose` question and `after-merge`, `src/hooks/budget.ts`) the last
  child ends by 6 s of 10 s, or 23 s of 30 s, so the park ends well inside the hook's `timeout`.
  A guard with no budget (`git-guard`, `main-folder-guard`, `message-guard`, and the frame's own
  project lookup, each with 5 s git calls) was never held to a shared deadline: the short wait
  does not fix that, it only stops the park from adding 5 s. The command `user park` still waits
  5 s (`AWAY_LOCK_WAIT_MS`). A hook the host kills answers nothing, and `onFailure: block` then
  blocks the call with no word to the session. `user-away`'s own crash-ask is not converted.

**Machine-wide and `alwaysOn`.** The person is one for the whole machine, so the hook reads the
state file and never the project's: a broken or too new `cc-smart-dev-kit.json`, and a folder
outside git, are judged the same way. `ownHooks` cannot switch it off — the switch is the
person's, and a project must not turn it off for a session — so it is not in `PLUGIN_HOOK_NAMES`
and `.claude/cc-smart-dev-kit.json` needs no new field. A crash asks about the two question
tools like any guard; on the other events it says one line on stderr and the session goes on.

**A state it cannot read changes nothing.** The hook says one line on stderr and the answer is
what it would have been without this feature: the question or the ask goes to the person as it
always did.

**The notifier stays quiet for a denied question.** `notify` raises "Claude asks you" on
`AskUserQuestion` and `ExitPlanMode`; while the person is away those calls are denied and nothing
waits for them, so it raises no alert (a state it cannot read keeps the alert).

**What it cannot reach.** A project's own copy of a guard (`ownHooks`) answers in Claude Code
directly: only the prompt Claude Code then raises is caught, by the `PermissionRequest` answer.
**An MCP server's elicitation dialog** (a server asking the person for input mid-call) is
reached by neither event: Claude Code has its own `Elicitation` hook event for it, apart from
`PermissionRequest` (read from the 2.1.310 binary: "Fired when an MCP server requests user input.
Hooks can auto-respond (accept/decline) instead of showing the dialog" — read only, not proved
live), and `user-away` wires neither. While the person is away, such a dialog waits for them like
any other; the notifier still raises its alert. **A call two guards judge differently** (one
denies, one asks — a polling loop job-route denies, with a force-push git-guard asks about,
in one line) is parked by the asking guard's own process, which cannot see the other's deny: the
list may hold a line a guard refuses. A yes to it runs the line again, through the same
hooks, so the deny holds and nothing gets through; the item shows the exact line.
The shim's `--missing=ask` (no bun at all) cannot read any state, so there the ask goes to the
person. A session that started before the update carries an older plugin version with none of this
(no step 6, no `PermissionRequest` entry), and `user unavailable` still succeeds for it: restart it.
In Claude Code's default permission mode a session's own `user park` call is a command that asks, so
it is denied and parked like any other; the person allows `Bash(cc-smart-dev-kit user park:*)`
once (the hook cannot allow it: it answers only with a deny). `PermissionRequest` is proved live on `claude -p` only — an interactive and a `--bg`
session are owed — and `AskUserQuestion` does not exist in `claude -p`, so its PreToolUse deny is
proved by the hook's tests alone. **It stops mistakes, not a session set on getting past it:**
`user available` is the person's command, run through `/cc-smart-dev-kit:user-available`, and
a session that runs it itself lifts the line. No hook can tell the two apart, so the skill says
never, the way the review gate does (§ The review record in `workflow.md`).

### The Fable-session note

`fable-session` (SessionStart, PostModelSwitch, Stop) is machine-wide like `agent-guard`: the
model the main session runs on is the person's choice, and Claude never cares — no
`additionalContext`, no error, no block. The person may not have meant the `fable` tier, though
(it spends the plan's limits faster than Opus), so they get one `systemMessage` — a line Claude
Code shows the person, never Claude — once in a session (`fable-session.ts`). **The line was
seen live on a real session (2026-10-17)** — through `UserPromptSubmit`, the event this hook has
since left — and that it shows on `PostModelSwitch` and `Stop` is still not proved
(`docs/claude-code-contract.md` has the rows and the owed run).

Which model, per event:
- a **start**: only the `model` the input names — no fallback there (the schema Claude Code
  2.1.300 carries has `source` and an optional `model`);
- a **switch** (`PostModelSwitch`): `to_model` — "the resolved model id the session runs after
  the switch", from Claude Code's own input schema (2.1.302, read from the shipped binary). So
  the line appears AT the switch;
- a **finished answer** (`Stop`): the model that answered, from the transcript's last assistant
  message, then `ANTHROPIC_MODEL` (`sessionModelOf`, one home with the guard's fork rule). This
  is the catch-all for a Claude Code that fires no `PostModelSwitch`, and it cannot fire for a
  model the session has already left.

**`UserPromptSubmit` was the bug** (seen live): the model read there is the transcript's
last answer — the PREVIOUS turn's — so the hook ran one turn behind. It missed the switch to
Fable, and then warned while the person was back on Opus. Stop judges the answer that just
ended, and a switch back is a different answer.

The tier is read the guard's way too (`resolveLaunchModel`, `ANTHROPIC_DEFAULT_FABLE_MODEL` and
the fable slot's chain while the gateway is on included), so there is no second list of what
counts as Fable, and a tier a backend answers warns the same, naming the model (`the
\`fable\` model, openai:gpt-5.5`).

What it costs: a session that was told stops at the mark; a session on anything else pays one
`existsSync`, and — at a stop — the transcript's tail; the gateway config and Claude Code's
settings (is the gateway on?) are read only when the model text could be Fable at all
(`couldBeFable`). A session nobody
watches (`claude -p`) is told nothing and keeps no mark. The mark that keeps it to once a session
is `<TMPDIR>/cc-smart-dev-kit-session-names/<session id>.fable`, beside the session's own name
files (`namesDir`, one home), so the OS clears it; it is made with `wx`, so two runs that race
cannot both speak, and a mark that cannot be made means the line is not said at all — never
twice.

### The tier note

`tier-view` (SessionStart, UserPromptSubmit) tells **Claude** what each subagent tier runs now,
so it picks the effort the task needs (the owner, 2026-10-25). Claude models are not cheap
models: a Claude `haiku` or `sonnet` does well at `high` and `xhigh` by the task and may take
`max` when the task wants it, with no restriction; so does a backend that answers the tier (the
owner, 2026-10-26: no level is forced on a backend; a person who wants one pins it in the router,
D64); the `opus` tier keeps the guard's rule (`max` asks the person). Before the note, a session
read "the gateway is on" and picked `max` for Claude Sonnet, which the guard allowed and the plan
paid for.

- **What it says** (`tierNote`, `src/models/tier-view.ts`): a header and one line per tier the
  Agent tool's `model` names — `- sonnet → Claude Sonnet: the effort the task needs, medium to
  max.`, or `- sonnet → omniroute:glm-x (a backend): the effort the task needs, medium to max.` The model is the guard's own
  reading (`resolveLaunchModel`: the person's `ANTHROPIC_DEFAULT_<FAMILY>_MODEL`, then the
  family's slot while it has a chain, its **first** target answering) through the session's own
  gateway view (`sessionGatewayOf`: the effective `ANTHROPIC_BASE_URL`, a profile's chains). The
  levels come from the guard's constants (`ALLOWED_EFFORTS`, `OPUS_FREE_EFFORTS`,
  `OPUS_ASK_EFFORT`), never a second list. A Claude-first chain with a
  backend fallback is Claude, as the guard reads it. A name a slot answers with a stricter
  premium Claude model reads as that tier (`sonnet` → Claude Opus).
- **The gateway off** says the same four lines, all Claude: the instructions' effort rule reads
  the note, and a session without a gateway needs it as much as one with.
- **A config that cannot be read** (`gateway.json` is there and unusable, while the session's
  address is a gateway's) is one plain line that the view is not known. An address with no
  `gateway.json` is another program's proxy, and reads as Claude, the guard's way.
- **When.** At every `SessionStart` — a start, a resume, a clear, a compaction each build Claude's
  context again, so its `hooks.json` entry has no matcher. At `UserPromptSubmit` only when the
  note differs from the one said last in this session (the owner may change a slot while sessions
  run; a line costs context in every session on the machine). The last note is the mark
  `<TMPDIR>/cc-smart-dev-kit-session-names/<session id>.tiers`; a prompt in a session whose start
  the hook never saw says it once, and a mark that cannot be kept makes a prompt silent rather
  than repeat itself. It was chosen over the Agent guard's `PreToolUse`: that answer comes after
  Claude chose its effort.

### The notifier

`notify` is a `USER_HOOKS` bundle: it never enters the frame, because it is about the machine
(`src/hooks/notify.ts`, its header is the full contract). Its own opt-in needs no
`cc-smart-dev-kit.json`; the one thing it reads from a project's file is the `workflow.alerts`
settings, when a project has them (§ The workflow › The alert settings).

**Which events, one alert each** (`plugin/hooks/hooks.json`): `Notification` (a session's own
"needs you" types, `worker_permission_prompt` included — `PLUGIN_NOTIFY_TYPES`; the idle
wait is left out — the `Stop` alert
already announced that turn); `Stop` (the turn's last answer as the body, from the
transcript's tail, 300 ms after the event because Claude Code writes it just then);
`PreToolUse` on `AskUserQuestion|ExitPlanMode` (Claude Code raises no Notification at the
moment Claude asks, so this covers it); `PostToolUse`, `PostToolUseFailure` on the same two
tools and `UserPromptSubmit` (that wait is over: the mark goes, nothing is shown); and
`StopFailure` (the turn died). A `rate_limit` stop belongs to the `stop-failure` hook only
where that hook will show its alert — a desktop to show it on, the gateway set up, and a
plan limit (`stopFailureWillAlert`) — so one stop never gives two alerts; where it has no
alert to give (no desktop, no gateway, a short rate limit, which is no plan limit), the
notifier announces the stopped turn on its own routes.

**Agent view and background sessions.** Claude Code raises `Notification` hooks in the
list's own process while `claude agents` is open: `agent_needs_input` while a session waits,
and `agent_completed` with "<label> finished" or "<label> failed". **That process runs only
the hooks in settings files, never a plugin's `hooks.json`** (proved live on 2.1.302,
`docs/claude-code-contract.md`), so `cc-smart-dev-kit setup` manages one user-level entry in
`~/.claude/settings.json` (`src/setup/user-notify-hook.ts`): matcher
`agent_needs_input|agent_completed`, the command
`"$HOME/.local/bin/cc-smart-dev-kit" hook notify`, timeout 10. It runs the same function the
bundle's entry runs (`src/hooks/notify-entry.ts`) through the launcher, so a plugin update
that deletes the old version folder cannot break it. The plugin's `hooks.json` leaves these
two types out (`NOTIFY_MATCHER`), so a normal session never runs the alert twice. The entry's
record is `owned-hooks.json`, never a `changed.json` kind: an older running cc-smart-dev-kit
(a portal copy, a session that has not restarted) refuses a changed.json kind it does not
know. An entry the person edited (another timeout, a redirection) is theirs — setup leaves
it, claims nothing and adds no second one, and `doctor` shows it as information, never a
failure. A hand-written entry setup replaced (it ran the plugin's own `dist/notify.js`, from a
version folder) does not come back on restore: the managed entry goes, and the file's backup
has the old one. A background update never runs setup, so when the entry is missing its
notification says `cc-smart-dev-kit setup` writes it (`NOTIFY_HOOK_SETUP_HINT`). The hook input is the
list's session and folder, so those alerts carry no session name (`titled(kind, null)`), and
the per-session question mark says nothing about them. `agent_needs_input` also comes from a
session's own process (a teammate's setup question, auto mode's classifier notice), and the
input carries no sign of which: both get the agent-view handling, so that one alert loses its
`· <session>` and its mark — a cost taken knowingly, since guessing from the message's words
would be wrong for one of them. On a Linux desktop the one-alert-per-session key adds the
session the message names (`agentViewKey`): one background session's alert never closes
another's. The list never writes a hook's `terminalSequence` out, so these types take the
devices first (`device-then-field`), and the field only when no device is found. A background session has
`CLAUDE_JOB_DIR` set (Claude Code's environment-variables page) and inherits the daemon's
`DISPLAY` and terminal variables, so an alert of its own would go to the wrong place: the
notifier and the usage-limit alert stay silent there, and agent view is the one place its
alerts come from while the list is open (`background-session.ts`). The owner accepted the
trade-off (2026-10-18): with no list open, a background session does not alert. The alert's
moment is its own field (`Alert.moment`), set with its words in `alertFor`: the
finished/failed split of `agent_completed` is what `alerts.events` filters on, like every
other moment.

**The waits that stay quiet**, all from the team's older notification script, which this
replaces: the permission prompt about six seconds after a question (the same wait — a mark
file per session, `/run/user/<uid>/cc-smart-dev-kit-notify-asked-<session>`, holds until anything
ends it, and only for ten minutes so a wait that ended unrecorded never hides a later alert);
a turn another session started (`startedByPeer`: `turnOrigin: "peer"` without a
`senderTaskId`, a human prompt into the turn or a helper agent's launch alerting as before);
the same error twice in a row (a per-session file remembers the last error, cleared by a turn
that ends well); a stop `verify-gate` will block (the turn goes on, so the finished alert
waits for the stop that ends it — a per-session file remembers the alert already shown for
the turn, cleared at the next prompt). One alert per
session per event, never two.

**The Linux desktop gives the alert more, where its tools are there**
(`src/hooks/desktop-alert.ts`): a click raises the session's terminal window, the alert
leaves the screen for the notification centre after a minute (`ALERT_SCREEN_MS`), only one
alert per session is on screen at a time, and XFCE's Do Not Disturb keeps an ordinary
alert's sound off (an urgent one sounds anyway, as XFCE shows those under Do Not Disturb
too). These are the desktop behaviours of the older notification script this replaces,
ported so a machine that moves to the plugin loses nothing.

Everything that waits runs in a detached worker — the notifier's `alert-worker`, through the
launcher, never in the hook (the usage-limit alert has no button and starts no worker: it says
which limit was hit and, when that limit holds the session, when it resets — a limit that does
not hold it gets no reset date, `docs/gateway.md` — and offers nothing) — and each extra runs only where its
tool is on PATH: `xdotool` to raise a window (the terminal's `WINDOWID`, or a VS Code or
Warp window found by its class and title); `gdbus`, the notification server itself, for the
notification's id — the minute and the one-per-session rule need it, and `notify-send`
never says which id it got — or a `notify-send` whose `--help` lists `--action` and
`--wait`, where the server has actions; `xfconf-query` for XFCE's Do Not Disturb setting.
Without them the hook keeps today's plain `notify-send`, and `doctor` names a missing tool
as information. One thing the older script did is **not** ported: picking the session's tab
inside XFCE Terminal (its accessibility service, AT-SPI, reached through Python bindings
this plugin does not carry) — the window is raised, and the tab stays where it is. macOS,
Windows and the SSH terminal are unchanged.

**The title** is `<kind> · <session>`: the session's newest `customTitle` from the
transcript's tail (`cleanSessionName`), else the folder of the hook's `cwd`; agent view's
alerts carry no session name, because their input is the list's. **The settings**
are `~/.claude/cc-smart-dev-kit/notify.json`: `desktopSound` (default on), `sshBell` (default off,
one BEL after an SSH alert) and `sshWarp` (default off: the fallback that says the far end of
an SSH session is Warp). The notifier starts detached, so a slow one never holds the
hook. `setup` does not touch anyone's own notification hooks: a person with those removes
them by hand when they switch to this one.

**tmux** (`src/setup/tmux.ts`): a sequence written inside a pane is parsed by tmux and
dropped, so it reaches the outer terminal only inside tmux's passthrough wrapper, and only
while `allow-passthrough` allows it. `cc-smart-dev-kit setup` adds one managed line (`set -g
allow-passthrough all`) to `~/.tmux.conf` when tmux is installed — `all`, so an alert from a
window the person is not looking at arrives too (owner) — prints `tmux set -g
allow-passthrough all` when a server is running (it never changes a running server itself),
and `restore` takes the line out through the same `file-line` record (`managed-line.ts`) that
keeps every line the person wrote. `doctor` reports, as information, a missing line and a
running server that does not pass alerts through.

### The Bash judge and the job route

`job-route` (PreToolUse on Bash and PowerShell) is the kit's one shell judge, and it keeps its
public name: `hooks.json`, project files and `ownHooks` values stay valid. It is **machine-wide**
and **`alwaysOn`** — the frame skips the `ownHooks` step and `ownHooks` cannot switch it off — and
it runs outside git, and with a broken or too new `cc-smart-dev-kit.json`: a session must not be
able to switch off the limits on its own launches by editing a file it owns (the reason
`session-escape-guard` is always on too). A project file that still lists `"job-route"` keeps
parsing (`UNSWITCHABLE_HOOK_NAMES`), it silences nothing, and `doctor` prints one `·` line that
it can go. Two parts sit in it, and only one reads the project.

**Both shell tools.** Claude Code has a PowerShell tool beside Bash on native Windows, so the
judge is wired on both and reads each line in its tool's dialect (`dialectOfTool`): a limit a
session steps around by choosing the other shell tool is not a limit. The route and the session's
background move stay **Bash only**: their rewritten line names the `sh` launcher and, for
anything but one plain command, `sh -c`, which the PowerShell tool cannot run — a wrong rewrite
is worse than none, so a PowerShell line is never rewritten. With the route on, a heavy
PowerShell line is refused instead, with the exact Bash line to run (only where the Bash tool
can exist: on Windows, where Git Bash is found), because left raw it would not wait for a slot;
a light or print-only line is left as it was written.

**The judge** (`src/hooks/bash-judge.ts`, the rules; `job-route.ts`, the answer) reads the line
with the one shell reader and answers five things:

- **a print run**, `claude -p` / `--print`: the launch policy every Agent launch meets
  (`judgeLaunch`, § The Agent guard) on its `--model` and `--effort`, after Claude Code's own
  overrides; the prompt is read for a `Fable reason:` line. No model or no effort is refused, the
  `fable` tier asks, the `opus` tier at `max` asks — and in an outer `claude -p`, every ask is a
  refusal. A `claude` subcommand (`claude agents`, `claude stop`, …) is not a launch and is left
  alone. The reader steps over the wrappers around a launch (`setsid claude --bg`, `flock <file>
  claude --bg`), and reads `npx` / `bunx` / `pnpm dlx` of `@anthropic-ai/claude-code` as `claude`.
  A program the line works out when it runs (`$(which claude) --bg`) is judged by the same
  words: `--bg` is a background launch, and `-p` counts as one only when a word names Claude
  Code (`cp -p` is no launch).
- **`workflow propose` in any other session** (RF1-4): **asks** the person first whenever the
  gate the git and merge guards read has `autoPush` off or `openPr` short of `ready`, because the
  command pushes a branch and opens a pull request ready for review in children those guards
  never see. The gate is read the way `push-policy.ts` reads it (`resolveGate`: the default, the
  person's own file, the project's file as committed on `origin/<worktrees.base>`, never a
  checkout's working copy), for the project the line proposes into: its `--folder`, resolved
  from the input's `cwd`, or that `cwd`. The question names the push, the pull request and each
  switch that says no, with its source. A gate that cannot be read (no `origin/<base>`, a broken
  file), a project it cannot name (a computed program, subcommand or `--folder`, or a `cd`
  before a folder that is not absolute) is a question with its reason, never silence. Where
  nobody answers (`claude -p`) the question is a denial, as for a raw `--bg`. The portal's
  Workflow card asks on its page and runs the CLI in a child no hook sees, so it is unchanged.
  **Its git calls share one budget** (`SHORT_GUARD_BUDGET_MS`, 8 s of `job-route`'s 10 s;
  `src/hooks/budget.ts`): finding the project takes up to two calls and reading the committed
  file three, each up to 5 s, so on a git that hangs they would add up past the hook, and a hook
  Claude Code kills answers nothing. Each call gets the smaller of its own limit and the time
  left, a call with none left is not made, and the question then says that git did not answer
  in time (`GIT_TIMED_OUT`, `src/project/resolve.ts`: a call that was stopped or never made is
  no answer about the repository, so it is never read as "not in git" or "the ref is not
  known"). Every proposal on a line draws on the same budget, and it counts from the hook's
  start (the frame's `nowMs`), so the frame's own project lookup, which runs first, is already
  spent from it.

**What the judge cannot read**, and so does not judge: a script file's own content
(`sh run.sh`), a command another program runs from a string of its own that the reader does not
open (`watch -n 5 'cc-smart-dev-kit workflow propose …'`, `ssh host '…'`, `su -c '…'`), and a
shell nested more than three deep (`bash -c "bash -c \"bash -c '…'\""` — the walk stops at
`MAX_NESTING`). A chain of `eval`s is read at any depth: each step's own arguments carry the
line. Every guard that reads a shell line shares these limits; the reader
(`src/shell/command.ts`, and `MAX_NESTING` in each guard's own walk) is where one is closed,
never a single guard.
A line the judge reads is judged in the dialect of the tool that runs it — the PowerShell tool
beside Bash on native Windows reads a launch, a command and a poll the same.

**The route** is the heavy-job queue's door, and an opt-in with two homes (the
`switches.jobRoute` switch): the project's `"jobs": { "route": true }` (or `false`) in its
`.claude/cc-smart-dev-kit.json`, and under it the person's machine-wide default,
`switches.jobRoute` in their own `workflow.json`. The project's value wins, field by field, as
every workflow setting does; with neither it is off. The hook asks the one resolver
(`resolveJobRoute`, `src/workflow/resolve.ts`), never a reader of its own, and it asks it with
or without a project file: this hook runs machine-wide. A personal file the resolver cannot read
leaves the project's value and the default standing, so the hook never fails on it. Outside git
there is no project, and a heavy command runs raw. With the route on, a command its kinds
classify as heavy is sent through the queue instead of running raw (`docs/jobs.md` § The
route). It answers with Claude Code's `updatedInput` — the same tool input,
its `command` replaced by `"$HOME/.local/bin/cc-smart-dev-kit" job run --kind <kind> --
<command>` — proved live on 2.1.301 (`claude-code-contract.md`). It gives no
`permissionDecision`: the rewrite replaces the input and the permission system still decides
about the new command, so a person's own rule for Bash keeps working. **Only a line whose every
command is heavy, a `cd` or an assignment is queued** (`classifyRoutableLine`), and so is one
heavy command piped into read-only filters (`READ_ONLY_FILTERS`, `routableLine`): only the heavy
step goes into the wrapper, and the filters stay outside it as written, so the person's own rules
still see them; a `tee` to a file, a `sed -i` or a filter before the heavy step is no filter.
Any other line runs raw. Why: Claude Code matches a person's `Bash(…)` rules against the command it is about
to run and does not look inside `bash -c '…'`, so a rewritten `tsc && rm -f x` would hide its
`rm` from a `Bash(rm:*)` rule (proved on 2.1.308, `claude-code-contract.md`).
`REWRITE_SUPPORTED` in the hook is the one switch, and with it false the same command line is
denied instead, never silently left raw. A command already inside `cc-smart-dev-kit job run` is
left alone. A name the project's `package.json` defines as a script is matched only by a
`script` kind, never by a tool of the same name: a `tsc` script that already wraps the job is
not wrapped again (`docs/jobs.md` § The classifier). It is the one guard that changes the call
rather than asking about it.

**Left in the project that had them** (project values or project tools, not general): a ban
on one package manager, the local database wipe guard, the heavy-job guard, a pull request
into a release branch, the main checkout following the base branch after each merge
(installs and migrations), the notes about one project's dev notes, migrations and env
files, and the claude-mem start-folder note. **Ported in Phase 4, with the MCP servers the
plugin registers:** the Serena root record (Serena's edits in the main-folder guard — the
`serena-root` hook, retired with Serena in 0.6.0) and the Playwright output folder (the
`playwright-output` hook, above).
**Not ported:** the Windows helper that
removes a worktree after the session lets go of it — the plugin removes one when its session
asks (the WorktreeRemove hook) or by `cc-smart-dev-kit worktrees --clean`, and it moves the
folder before it deletes it, so a program still using it makes the removal fail and touch
nothing (`docs/windows-setup.md`);
and, from the older notification script, the tab pick inside XFCE Terminal (AT-SPI reached
through Python bindings, which this plugin does not carry — the window raise itself came
over, § The notifier). The alerts, the waits they skip, the titles, the sounds, the click
that raises the window, the minute on screen, the one-alert-per-session rule and the XFCE
Do-Not-Disturb check are the same as that script's — they are the `notify` hook's contract
(§ The notifier, `src/hooks/desktop-alert.ts`).

### `doctor --live`

`cc-smart-dev-kit doctor --live` (opt-in; it uses the person's login and costs a few cents) makes one
throwaway repo in a temp folder, without `cc-smart-dev-kit.json` (Claude Code's own worktrees,
what every project uses), and runs one `claude -p` session in it with
this plugin (`--plugin-dir`), only the EnterWorktree, ExitWorktree and Bash tools,
`--allowedTools` for exactly the calls it makes (never a mode that skips the permission
checks), and a three-step prompt: enter a worktree, `git status` there, leave with
"remove". Every hook run is logged (`CC_SMART_DEV_KIT_HOOK_LOG`, with each run's `cwd` and the spec's
`logFacts`), and it checks: the plugin's hooks fired (SessionStart,
the git guard), the git guard **read the command line** (its log names the programs it
parsed: a hook that fired is not a guard that answered), no WorktreeCreate hook ran, Claude
Code made its own worktree and the session worked in it, and ExitWorktree removed it. No
repo wires a worktree hook: the retired engine's is gone with the engine. When all pass it
records the Claude Code version in the state folder (`live-check.json`); plain `doctor` shows
that line, and says to run it again when the installed Claude Code is another version.

## The safe switch


A project may already have its own copy of a piece the plugin now ships (a guard, a note).
Moving it to the plugin must never run it twice or leave a gap:

The project names its own copies, and the plugin steps aside for exactly those:

1. **The project lists each plugin hook it still runs itself**: `ownHooks: ["git-guard"]`
   in its `cc-smart-dev-kit.json`. The plugin's copy of that hook then stays silent there
   (§ The hooks › One frame for every hook). A plugin hook the list does not name still
   speaks, so a gap is never silent, and a project hook on the same event alone silences
   nothing.
2. Every machine gets the plugin, and `cc-smart-dev-kit doctor` is green on each.
3. **Then the project removes its copy**, one at a time, and takes that name out of
   `ownHooks`; with the list empty it raises `requires` in its `cc-smart-dev-kit.json`.
4. **A small fail-closed check in the project** covers a machine without the plugin: it
   stops risky work instead of going on unguarded.

Rollback is a new release with the old behaviour. A version number never goes down.

`cc-smart-dev-kit doctor` follows the switch at both ends: a name in `ownHooks` whose event has no
project hook left to answer is a warning (the project is unguarded while it is listed), and
a project hook running next to a plugin hook that is not listed is a warning too (both may
answer the same command). The second warning leaves the machine-wide hooks out
(`MACHINE_WIDE_HOOKS` in `src/hooks/specs.ts`: `stop-failure`, `update-check`, `notify` and
`agent-guard`): they answer about the machine, not the project, so a project hook on their
event is not a second copy of a plugin piece.

**A plugin hook the plugin retires** keeps its name in the schema as a retired name
(`RETIRED_HOOK_NAMES` in `src/project/config.ts`; today `serena-root`, 0.6.0): a project file
that still lists it parses, and the name silences nothing, because no hook of that name runs.
Refusing it would fail the strict parse, and every guard would then ask about every call.
`doctor` prints one `·` line that the name can go.

The retired worktree engine is not part of the switch: a project that still has its lines or
its fields fixes both with one run of `cc-smart-dev-kit project init` (README § Worktrees), in
one commit. `cc-smart-dev-kit doctor` names what is left.
