# Research for the master plan (2026-10-21)

The evidence behind `.claude/plans/2026-10-21-master-plan.md`. Nine read-only research agents (R1–R9) wrote
the reports this file condenses; the lead checked each report's key claims in the code (marked
**lead-checked**). Claude Code installed: 2.1.306; `.claude-code-version`: 2.1.300. Branches:
`release-0.6.0` head `01a808a` (also on origin since 2026-10-21, as a backup), `origin/main`
`1c3c0b2` (0.6.0), merge base `8584167`.

## R1 — The audit release's true state

Merged on `release-0.6.0` (8 merges, lead-checked): A1 `ee4ba20`, A3 `1140301`, A5 `fc2c22b`,
A7 `418bbde`, B4 `2086f1a`, C0 `692f4de`, C3 `30d7852`, C5a `35e8ad4`.

Work in progress, one `wip(<phase>)` commit each on its worktree branch (undo with
`git reset --soft HEAD~1` to continue):

| Phase | Commit | Worktree | Done | Missing |
|---|---|---|---|---|
| A1b | `a9aa190` | agent-abe5379a1a3a47167 | D6 complete in source and tests | the contract row and its live proof |
| A2 | `2c68af8` | agent-a95af6db513a53434 | HK-2…HK-10, CM-9, the two lexers merged, parity test | HK hunch 1 (job-route's `bash -c`), `docs/jobs.md` (CM-9); forked from `8584167` |
| A6 | `a8433b7` | agent-a8dcd5de13c8200ab | CM-2…CM-8, CM-11, `raisedRequires` | `docs/jobs.md`, `docs/windows-jobs.md`, CM-12's workflow overclaim, review-done with a broken config, session-name exit 2, doctor's bare hook line; forked from `8584167` |
| B0 | `4a97a33` | agent-a949faac9b0750aba | `kept`, slot modes, migration, router `seenClaude`/`recent`, portal `slot.mode` | **no tests at all**; `facts.ts` `claudeModels`; every doc, rule and the skill (lead-checked: 0 test files) |
| B1 | `ff6c523` | agent-a23ed6648526bb20e | UX-2, UX-3, UX-17, help from data, `help.ts` + tests | UX-13's other sites |
| B6a | `3bd0a9d` | agent-a955aeac127ca6e4d | client code split, macro, tokens, theme, header | **no tests**; no PX test |
| C2 | `8afd98f` | agent-a269d34247aab264a | IN-14 only (`review/references/axes.md`) | everything else in C2 |
| C3b | `eef8553` | agent-aab6e447479570ea0 | D11 | superseded by main's 0.5.5 (R2): reference only |

Not started: A4, A4b, B2, B3, B5, B6b, B6c, B6d, B6e, B7, B8, C1, C4, C5b, C6.

Owed by the lead and never written (lead-checked: `docs/claude-code-contract.md` and
`.github/workflows/` are unchanged since the merge base): contract rows for GW-4, GW-5,
SubagentStart, the Windows `cmd /c` MCP launch, the PostToolUse launch record; A5's Windows CI
steps; C0's CI tiers; the `readCommittedConfig` line in `.claude/rules/cc-smart-dev-kit-json.md`.

Other worktrees: A1, A3, A5, A7, B4, C0, C3, C5a builders (merged) and three old 0.5.x
builders on main's history (merged on main). `cc-smart-dev-kit worktrees` removes what is merged.

## R2 — Merging main into the release branch

Test merge tree `9df1845`. Conflicts: `.claude/CLAUDE.md`, `README.md`, `docs/design.md`,
`src/cli/setup.ts` (+test), `src/hooks/after-merge.ts` (+test), `src/hooks/agent-guard.ts`
(+test), `src/mcp/mcp.test.ts`, `src/mcp/register.ts`, `src/setup/instructions.ts` (+test),
`src/update/background.ts`, and the bundles (rebuild only).

Resolutions:
- `instructions.ts`, `background.ts`: take **main's** `refreshMayWrite`/`refreshRefusal` (only the
  installed version writes the copy; stricter than A5's ST-2). Keep the release's
  `isStrictlyInside` import (`copiesUnder`, ST-6). Tests: main's four plus the release's ST-6.
- `register.ts`: the release's imports plus main's `RetiredServerName`.
- `setup.ts`: both imports; the MCP plan = release's `liveServers` (ST-5) + `planMcpServers(…)` +
  main's `planRetiredServers` + `plannedRemovals`; no Serena. Outside the conflict, **line 883
  `applied.removed` → `mcp.removed`** (lead-checked: it does not compile otherwise).
- `setup.test.ts`: the release's ST-4/ST-5 block and both of main's blocks; drop
  `"serena locked recorded"`.
- `after-merge.ts`: drop A3's `pluginRemovesWorktrees` (engine code); main's
  `insideClaudeWorktrees` note, without the "deprecated engine" sentence; HK-1 tests 3–4 deleted,
  1–2 rewritten. The fallback line (main's `git worktree remove` vs the release's
  `worktrees --remove`) is the lead's choice: take `worktrees --remove`, it runs the
  finished-worktree check.
- `agent-guard.ts`: **main's D11 (+`2ca364d`, `e67126e`) plus C3's parts** — `medium` allowed,
  `asNamed`/`tierRank`, the punctuation-safe `reasonWord` (Fable), the PostToolUse record. Delete
  `OPUS_REASONS`, `opusDenial`, the `isReview` branch, `REVIEW_EFFORT`, `deeperThanReview`.
  `EFFORT_USE` follows D13. C3b is **not** merged; it is read for its D13 texts and tests.
- `agent-guard.test.ts`: main's tests with `medium` added to the free levels; C3's kept tests
  adjusted (asks only at `max`). Outside the conflict, line 1203 and `matrix.test.ts:112,226`
  expect a `medium` Opus deny → use `low` (lead-checked).
- Docs: the release's rules table; delete the `serena/` row text (`.claude/CLAUDE.md:79`),
  `hooks.md:15` (`src/entries/serena-root.ts` glob) and `hooks.md:362` (lead-checked); README's
  agent-guard row from main's + `medium`; design.md §§ agent guard; `reviews.ts:69,116`;
  `gateway.md:604`.

Overlaps with no textual conflict:
- **Release gate:** C3 records an asked launch only on PostToolUse, which A4 wires. Until A4
  lands, Fable and `max` launches go unrecorded — a regression against main's 0.6.0.
- Main's new readers parse user files with raw `JSON.parse`, not A5's BOM-safe `readUserJson`:
  `src/setup/managed-hook.ts:171`, `src/setup/user-notify-hook.ts:105`, `src/mcp/retired.ts:187`
  (older: `doctor.ts:101`, `project-checks.ts:235,263`).
- Reviews recorded by 0.6.0 (`sha → time`) stop counting under A3's format; the release notes say so.
- `evals/cases/edit-in-worktree/scaffold.sh:9` writes `"prefix"`: an invalid file after the
  engine deletion. C0's baseline (plugin 0.5.0) needs a new baseline after the merge.
- `hook notify` (0.5.3, every machine runs it) must survive the engine deletion.

Version after the merge: `plugin.json` says 0.6.0 (main's). Raise it with `install.sh:78`
`INSTALLER_VERSION` and `install.ps1:81` `$InstallerVersion` (`scripts/install.test.ts` pins
equality). README "What's new"; `docs/roadmap.md` sections are out of order (newest first).
Every bundle except `router.js` bakes the version. The merge itself must not change `router.js`
(main touched no gateway code); the release's A1 did, which the PR states.

WIP continuation: A1b, B0, C2 continue at once after the merge; A6, A2, B1, B6a after the engine
deletion (B6a's client still sends `prefix`/`setup`/`engine`; A6 drops all prefix work; B1's help
lists only `hook notify`; A2 keeps A2's lexer imports and the merged `clearWorktreeNote`).

## R3 — Deleting the worktree engine

Delete, on the merged tree: `src/hooks/worktree-create.ts`, `worktree-remove.ts`,
`create-lock.ts`, `project-wiring.ts` and their tests; the three engine specs, `needsWorktrees`
and `PROJECT_HOOKS` in `specs.ts`; the frame's `wiring: "project"` step in `run.ts`; the engine
parts of `project init` (CLI, plan, portal form, `fake-workflow.ts`), `project-checks.ts`
(deprecation warnings; keep the `.claude/worktrees/` ignore check and the `baseRef` warning),
`live-check.ts` (keep the Claude Code worktree case), `hook-commands.test.ts`,
`entries/cli.ts` (keep `hook notify`), `sessions` prefix matching (keep `.claude/worktrees/`),
`scripts/windows-hook-smoke.sh:85-98`, and the engine text in README, `docs/design.md`,
`docs/roadmap.md`, `docs/claude-code-contract.md`, `docs/windows-hooks.md:68-80`,
`.claude/rules/hooks.md`, `.claude/rules/cc-smart-dev-kit-json.md`, `.claude/CLAUDE.md:74`,
`plugin/instructions/optin/worktrees.md:26-28`.

Keep, and move first: `subagentWorktreeOf` (out of `worktree-remove.ts`; `review-record.ts`
uses it). Shared helpers stay: `git.ts` (prune `hasRef`, `ownCommits`, `noPromptEnv` if unused),
`local-files.ts`, `sessions.ts`, `settings-hooks.ts` (fix its header), `worktree-leftovers.ts`.

Rejecting the old fields:
- The project schema is `z.strictObject` (an unknown key is an error), and its generic message
  ("a newer cc-smart-dev-kit may be needed") is wrong for a retired field. Add one
  `RETIRED_WORKTREE_FIELDS` check in `parseCcSmartDevKitConfig`, after `checkRequires`, naming
  the field and the fix. `src/workflow/write.ts:187` parses the schema directly: route it
  through the same check.
- No precedent: 0.5.2 deprecated the fields, 0.6.0 kept accepting the retired hook name
  `serena-root`, both because a failed parse makes every guard ask on every call. Rejection is
  a new, stricter precedent; the release skill calls a removed field a **major** step.
- Consumers when the file does not load: every guard asks (closed); doctor `✗ project:` (exit 1);
  `workflow set`, `worktrees` error; `workflow show`, `sessions`, `setup`'s auto-mode step,
  the portal and alerts carry on with a note; `project init` parses raw JSON and does not reject.
- Projects written by `project init` before 0.5.2 carry `prefix` (it was required). After the
  deletion, a project that still wires `cc-smart-dev-kit hook worktree-create` fails every
  worktree creation (`Unknown hook`, exit 2). Nothing can strip those lines today.
- Lead-checked on this machine: the one project with a kit config carries only
  `worktrees.base` and `guardMainFolder`, `requires >=0.6.0`, and no engine hook lines.

## R5 — Reviews that count for their fixes; the flow report; auto mode

Today (lead-checked): `hasReview` is an exact lookup of one sha (`src/workflow/reviews.ts:134`);
the merge guard asks it for the PR's head (`src/hooks/merge-guard.ts:544`). Review → fix commits
→ merge always asks. Transcripts show approved `gh pr merge` waits of 716, 474, 411, 389 and 209
minutes carrying the guard's "no recorded review" ask.

Recommended rule (D17): a review of commit R covers PR head H on branch n when
- R's record names branch n (`review-record` stores the branch; a stacked PR or another branch
  never matches), and
- the change since the review, with the base taken out — `T = git merge-tree --write-tree B R`
  where `B = merge-base(H, origin/<base>)`, then `git diff --numstat -M T H` — stays within the
  limits committed on the base: `workflow.fixesAfterReview {lines: 200, files: 10, percent: 20}`
  (covered when lines ≤ max(lines, percent% of reviewed lines) and files ≤ max(files,
  percent% of reviewed files); 0/0/0 = exact head only). Generated files (`linguist-generated`,
  read with `git check-attr --source=origin/<base>`) are listed, not counted; a binary file is not
  covered; anything unreadable asks, with the reason.
- `review-record` records the **start** commit when HEAD moved during the review (the "run the
  review again" line goes).
- Evidence for the defaults: this repo's own fix commits after a review were 10%, 105% and 160%
  of the reviewed change.
- One home: `src/workflow/review-cover.ts`; `reviewsOn(file, branch, agents)`; the per-PR
  judgment moves out of the hook into `src/workflow/merge-check.ts`, used by the hook, a new
  `workflow merge-check [<pr>…]` and the portal.

The flow report: `cc-smart-dev-kit report [--hours|--days] [--project] [--session] [--json]`
over the transcripts — parallel ratio, minutes blocked on prompts (and which guard asked),
waits on background work, compactions, auto-mode blocks by rule, merges that asked. One reader,
`src/sessions/flow.ts`, for the CLI and the portal, with a per-transcript offset cache in the
state folder. The hook frame writes each guard's ask to `guard-asks.jsonl` so the report joins on
`tool_use_id`. The transcript fields it reads are undocumented: contract rows marked "seen".

Auto mode (lead-checked with `claude auto-mode defaults`): the built-in soft rule "Merge Without
Review" blocks merging a PR no human approved — every `autoMerge` merge. Environment entries
cannot lift it. Options: the merge guard answers `allow` when the whole policy passes (whether a
hook's `allow` skips the classifier is undocumented — prove it live), or `setup` writes one
narrow `autoMode.allow` entry the person approves.

## R6 — Gateway on/off and models per project and per session

Claude Code facts (docs): `env` merges per variable; precedence managed > `--settings` > local >
project > user; **a settings file's `env` beats a shell export** (so a launcher cannot work by
environment variables the way `ollama launch claude` does); a settings file cannot remove a key,
only set it; an explicit `ANTHROPIC_BASE_URL=https://api.anthropic.com` keeps the claude.ai login
(docs; live proof owed); a changed value reaches running sessions, a removed one waits for a
restart; a project's `env` waits for workspace trust; the local file is read at the main
checkout's root (worktrees share it) except on Windows; `--settings` lasts one session and
carries over to `/bg`; no request header names the project; a path in the base URL is very
likely kept (live proof owed).

Router (lead-checked): requests are forwarded with `url.pathname` (`router.ts:1444,1515`), so a
project prefix must be stripped before every branch; `gateway.json` is `z.looseObject`;
`restore` counts gateway keys only in the user file (`src/cli/restore.ts:260`).

Recommended design:
- A project points at a **profile** through its URL, `http://127.0.0.1:<port>/p/<profile>`;
  `gateway.json` gains `profiles` (per slot: absent = the machine's chain, `"claude"`, or a chain;
  `kept` per profile; backends, port and `judgeTested` stay machine-wide). An unknown profile
  answers as plain Claude with a WARN and a doctor failure. The health answer gains `features`.
- Three project states: the machine's default (no key) / off (explicit `api.anthropic.com`) / on
  (the router's root; the prefix only once the project has chains of its own). Personal file by
  default (`settings.local.json`, plus a managed `.git/info/exclude` line); the team file for
  off and default only. Refuse when the file holds another gateway's URL or any level sets a
  login token, API key or `apiKeyHelper`.
- `cc-smart-dev-kit launch [--no-gateway | --gateway | --profile <name>] [-- claude args]` passes
  its `env` through `--settings` (a small state file for a Windows `.cmd`).
- Commands: `gateway project status|on|off|default [--team] [--profile] [--folder]`,
  `gateway projects`, `gateway profile <name> slot|fallback …`. One effective-state reader for
  doctor, the portal card and `gateway project status`.
- Thirteen live proofs first (P1 explicit URL keeps the login; P3 `--settings` over project files;
  P4 shell vs settings; P5 the prefix is kept; P6 worktree and subfolder; P7 live switch and
  removal; P8 trust; P9 the status line's environment; P10 background; P11 Windows; P12 headers;
  P13 signals) — each in its own `claude -p` with its own settings and a probe server, never the
  live router or this session's settings.
- The Remote Control line (docs/gateway.md § Known limits, the gateway skill, a contract row in
  § The gateway): since 2.1.196 Claude Code turns Remote Control off when `ANTHROPIC_BASE_URL`
  points at a host other than `api.anthropic.com`.

## R7 — claude-mem, tool by tool; the agents' tools

Measured over 14 days (157 main sessions, 1,035 subagent files):
- `work_state_write` 2,383 calls in 46 sessions, `TaskCreate` 0. Two texts push work_state:
  claude-mem's start note ("canonical to-do list … instead of any built-in to-do tool") and the
  kit's memory-routing skill. Claude Code's task tools are off by default on newer models since
  2.1.233 but on in every background session.
- claude-mem's start context passes Claude Code's 10,000-character hook limit in 36 of 218 starts
  (seen in this session too): its memory-use block is not counted in its own fit.
- Switches (lead-checked in claude-mem 13.40.0's code; not set on this machine):
  `CLAUDE_MEM_WORK_STATE_ENABLED=false` (since 13.36.0) and
  `CLAUDE_MEM_MEMORY_INSTRUCTIONS_ENABLED=false` (since 13.35.0), in `~/.claude-mem/settings.json`.
- `smart_search` 19 calls (all Explore), `smart_unfold` 0; the reviewer never called its
  `smart_*` tools. On Linux and macOS, Claude Code drops Grep and Glob from an agent that also
  lists `Bash` (this session has no Grep or Glob tool either).
- claude-mem's file-context hook runs before every Bash, Read, Grep and Glob: 64,667 runs,
  median 598 ms (about 14 hours in 14 days), useful in 0.19%. Upstream's to change.

Recommended:
- To-do lists → Claude Code's task tools (per session). Durable state → the plan file in git.
  Knowledge (decisions and why, dead ends) → claude-mem memory.
- `setup` sets both claude-mem switches off whenever claude-mem is installed (today
  `claudeMemPlan` only acts when the scout slot is affordable, `src/machine/claude-mem.ts:166-176`);
  the dependency becomes `claude-mem >=13.36.0`; open work_state lists move to plan files once;
  doctor shows both values; memory-routing carries the block's two useful rules.
- Tool use: `smart_search`/`smart_outline`/`smart_unfold` in agents (shape, not callers);
  `mem_search`, `save_memory`, `get_observations` in the main session only; the legacy tools,
  the corpus tools and `session_start_context` never.
- Agents (frontmatter `tools`; no `memory:`, no `Agent`, no `model`/`effort`): auditor and builder
  (new), reviewer (+`LSP`), rules-maintainer (+`smart_*`, `LSP`), ui-verifier (+`smart_*`, `LSP`,
  still no `Bash`). Each body: one line pointing to the impact-analysis skill, preloaded.
  `READ_ONLY_AGENTS` gains `auditor` (`src/hooks/agent-guard.ts:127`).
- Measure: `cc-smart-dev-kit usage --tools` (or the R5 report's reader) before and 14 days after.
- Two upstream issues for claude-mem: the uncounted block; the file-context hook's cost.

## R8 — Follow-ups and Claude Code 2.1.301–2.1.306

- `CLAUDE_CODE_SUBAGENT_MODEL_FORCE` (Claude Code ≥ 2.1.257) makes every subagent ignore the
  call's `model`; agent-guard reads neither it nor `CLAUDE_CODE_SUBAGENT_MODEL`
  (lead-checked). So a `sonnet` call forced onto Opus passes unrecorded, an `opus` call forced onto
  Haiku asks for nothing, and the record names the wrong model. Same for
  `CLAUDE_CODE_WORKFLOW_SUBAGENT_MODEL` (2.1.296), which forces every workflow agent.
- `usage` counts a launch by the text after the record's last `:` (`reasonWord`,
  `src/hooks/agent-launches.ts:136`, lead-checked): on main `opus:xhigh:security` counts as
  `security` (the effort hides); on the release branch the effort is never written. Fix: the record
  carries `effort` and `word` as fields.
- plan-task skill (145 lines, the same on both branches): the planning rules go in § 2 (the
  "play safe / go fully new" choice) and § 5 (the heavy cleanup as the last wave). § 2's
  "backward compatibility … the recommended default is a clean break, never a silent legacy shim"
  must be rewritten to fit. core.md: 189 lines (release), 190 (main); limit 200, warning above 190.
- Changelog 2.1.301–2.1.306, the entries that matter here: tool search on by default behind a
  custom base URL, 400/422 retried without it (2.1.304; fixed in 2.1.305); `context_management`
  resent without the field behind gateways (2.1.304); `CLAUDE_CODE_AUTO_MODE_MODEL` (2.1.302,
  GW hunch 8); at most 12 hooks of one event run at a time (2.1.302); fork subagents on by default
  in `claude -p` (2.1.302); a mod's `tool.check` `decider: "person"` (2.1.304); worktree fixes
  (2.1.302, 2.1.304, 2.1.305).
- The untracked `.serena/` folder was made by Serena itself and is not git-ignored: delete it.

## R4 — Lead and worker sessions

**Proved live by the lead (2026-10-21, Claude Code 2.1.306):** `claude --bg --name "W kit probe"
--model haiku --effort max "<prompt>"` run from the Bash tool returned in 1.1 s with
`backgrounded · <id> · <name>`; `claude agents --json --all` listed it at once
(`kind: background`, `state: working` → `done`, `status`, `waitingFor`). So a session a lead
starts is non-blocking and shows in agent view. Its start ran 9 SessionStart and 5
UserPromptSubmit hooks for several seconds, and claude-mem's start context overflowed again.

Facts (help, docs, local transcripts):
- `claude --bg` takes `--model`, `--effort`, `-n/--name`, `--settings`, `--permission-mode`,
  `-w`, `--session-id`; it refuses `-p`; from a script it fails with `Workspace not trusted`
  instead of showing the dialog. `--settings` and the model and effort survive a process restart.
- `claude agents --json [--all] [--cwd]` gives `id, name, state (working|blocked|done|failed|
  stopped), status (busy|waiting|idle), waitingFor (permission prompt|input needed|…), pid,
  kind, cwd, startedAt, sessionId` without a terminal. `~/.claude/jobs/<id>/` is not a stable
  interface. `claude attach <id|part of the name>`, `logs`, `stop`, `rm`.
- Agent view has no parent link and no grouping by lead: the **name** is the grouping key.
- A background session that edits moves itself into a worktree under `.claude/worktrees/` (not
  when it already is in one, or with `worktree.bgIsolation: "none"`), commits without asking and
  pushes a non-default branch — unless the task or CLAUDE.md says the person handles git.
- The daemon restarts an idle, unattached session's process after about an hour (Ctrl+T pins
  it); spare processes may carry an older version. Never `claude daemon stop` or `respawn --all`.
- SendMessage between sessions (docs + this machine's transcripts on 2.1.278–2.1.306): a busy
  receiver gets it between tool calls; an idle one starts a new turn. Never run a lead or worker
  in bypassPermissions (its inbox holds every message). A session name must never end in `]`
  (the message guard strips a trailing ` [ref]`, `src/hooks/message-guard.ts:34`).
- Subagents: at most 20 at once, nesting 3 deep, a nested launch is synchronous. Agent teams are
  experimental: no worktree isolation, prompts bubble to the lead, no nested teams, no resume.
- Hooks: `additionalContext` reaches the model on the next request (SessionStart, PreToolUse,
  PostToolUse, PostToolBatch, Stop). For a background subagent, PostToolUse on Agent fires at
  launch, not at hand-back. UserPromptSubmit also fires on turns Claude Code starts by itself
  (hunch: hand-back and peer turns — proof). `updatedInput` replaces the whole input and is
  re-checked, including Bash auto-background eligibility; whether an added
  `run_in_background: true` is honoured is unproved. A foreground Bash command that reaches its
  timeout moves to the background. 2.1.306 blocks a foreground `sleep`.
- Plugin monitors (`monitors/monitors.json`, `when: always | on-skill-invoke:<skill>`) run for the
  whole session and their output reaches Claude as notifications (interactive sessions; not on
  Bedrock/Vertex/Foundry or with telemetry off). Whether a line wakes an idle session: proof.
- Lead-checked in the code: `review-record` skips any cwd under `.claude/worktrees/agent-<hex>`
  (`src/hooks/review-record.ts:91-94`), so a worker's worktree must use another prefix (`wk-`).

Design (A: lead + background workers wins over agent teams and over subagents-only):
- **Lead:** plans, starts every wave-1 worker in one message, and on each worker event starts what
  it unblocked, integrates one merge at a time, asks decisions. Never reads whole diffs, never
  builds, never waits, sleeps or polls, never asks a worker "done?".
- **Launcher** `cc-smart-dev-kit worker start|list|status|report|stop|rm|attach|kinds|watch`.
  `start` returns at once with one line (no `--wait`); finds its lead from its parent process;
  refuses inside a worker; model and effort from the kind table; at the cap the phase is
  `queued` (still returns at once); makes the worktree itself
  (`.claude/worktrees/wk-<phase>-<slug>`, branch `wk/<phase>-<slug>`, from the lead's branch, the
  project's setup run); writes the brief to the state folder; runs
  `claude --bg --name … --model … --effort … --permission-mode … --settings '{"env":{"CC_SMART_DEV_KIT_WORKER":"<id>"}}' "<first: EnterWorktree <path>; then read <brief>>"`;
  records it in the store (one JSON file per worker plus `events.jsonl` per repo, schema
  version for older spares).
- **One home for the model and effort table:** `src/models/launch-policy.ts`, shared by
  agent-guard, the launcher and the Bash judge; its premium kinds are the reason words.
- **Raw `claude --bg` and `claude -p`** are judged by one machine-wide Bash rewriter (job-route
  grown into `bash-route`, the one home for `updatedInput`): ask (deny in `-p`) and show the
  launcher's line; deny a worker starting workers; deny polling loops over worker status.
- **Names** (one home `src/workers/names.ts`, used by the launcher and the session-name hook,
  which never renames a worker): `LEAD <tag> <plan>` and `W <tag> <phase> <slug>` — the role and
  phase first so they survive truncation; ASCII, no brackets, never a trailing `]`; `<tag>` = the
  main checkout's folder name or `workers.tag`. State stays out of the name (it is the address).
- **Worker hooks** (silent unless `CC_SMART_DEV_KIT_WORKER` is set): SessionStart (startup,
  resume, compact) gives the role card and brief path back; Stop writes `lastLine` and blocks once
  if the turn ends with no report. `worker report` fills the mechanical facts (branch, sha, diff
  stat, files outside the brief, review record, PR) and appends an event.
- **The hand-back report:** status, phase, branch and base shas, PR, files changed and outside
  the brief, tests (targeted and full), checks, the review (agent, model, effort, sha, each finding
  and its fix), docs, what needs the lead, open items, the question when blocked.
- **The lead hears** through a plugin monitor `worker-events` (`on-skill-invoke` of the lead
  skill) running `cc-smart-dev-kit worker watch`: one line per change, combining the store's
  events with a `claude agents --json` read every 15–30 s (which also catches `blocked`,
  permission waits and crashes). Fallback where monitors do not run: `worker watch --once` with
  `run_in_background: true`, re-armed per event. SendMessage stays for lead → worker answers.
  After a restart or compaction, a `lead-notes` hook lists what changed.
- **Caps:** `workers.max` 4 per machine across leads, plus a free-memory check through
  `src/jobs/memory.ts`; heavy builds and tests still go through `job run`.
- **Git:** by default a worker commits on its branch and does not push (D15 would stall it); the
  lead merges locally. With `autoPush`/`openPr` on, the brief says push and open a draft PR.
- **Reviews across sessions:** the worker's review is recorded in the per-repo store the lead's
  merge guard reads (with the `wk-` prefix); fix commits are covered by R5's rule; the lead's own
  integration commits get one small integration review.
- **Portal "Work" view:** the lead with its workers nested, then the person's other sessions;
  from the store, `claude agents --json` (every 5 s while a stream is open), live and saved
  sessions, the launch record, `gh` for listed PRs (cached 60 s), tokens from transcripts. On the
  page: Stop (confirm + CSRF) and copy the attach command; start, remove, message, merge stay in
  the CLI. `lastLine` masked like keys and URLs.
- **Cleanup:** `worker rm` runs `claude rm <id>`, then the kit's worktree verdict removes the
  worktree and the merged branch.
- **Instructions:** core.md § Lead the work rewritten in about the same lines (placement rule,
  never wait, the hand-back check); new `lead` and `worker` skills; plan-task § 5 (a phase's
  owner can be a worker; a Workers column); subagent-decision one pointer.
- **Costs (estimates):** a worker starts at about 30–40 K tokens, like a subagent; a phase in a
  fresh worker re-reads roughly 4× less context than the same phase inside a 400 K lead.
- Live proofs: P1 launch shape and `--settings` env; P2 visibility and attach (done above);
  P3 worker → lead SendMessage in four cases; P4 a monitor wakes an idle lead; P5 `updatedInput`
  adding `run_in_background`; P6 the reminder events; P7 launcher-made worktree + EnterWorktree +
  review record; P8 names and truncation; P9 nested review cost; P10 `agents --json` timing;
  P11 the gateway with `--model sonnet --effort max`; P12 memory per worker; P13 the lead's identity.

Long-running workers (2–4 hours), the R4 addendum:
- Size: 30–90 minutes of worker time per phase; a bigger phase splits before it starts (contracts
  first, alone; then disjoint file sets in one wave). Inside a worker, its subagents run in the
  background by default (the synchronous limit applies one level down only).
- Progress: `cc-smart-dev-kit worker step <tests-red|tests-green|suite-green|review-started|
  review-done|fixes-done|committed|pr-opened|handoff>` at each milestone (one Bash call; the
  command reads HEAD itself) → one event → one line in the lead's monitor and the portal.
- Quiet (alert only): agent view says working, the transcript file has not been written for
  `workers.quietMinutes` (20). No per-tool heartbeat hook (it would start bun on every tool call
  of every session). Nobody stops a worker automatically.
- Context: the brief is a file; `worker-role` on SessionStart `compact` gives back the role card,
  the last step and commit; the launcher passes `--autocompact` at about 60% of the model's
  window. A `worker-self` monitor reads the worker's own context use and, at
  `workers.handoffPercent` (70), tells it to commit work in progress and run
  `worker report --status handoff`; the lead then runs `worker start <phase> --continue <old>`
  (a new worker from the old head, the brief plus the hand-off report, name suffix ` 2`).
- Checkpoints: a commit on the worker's own branch at each green step. After a machine restart,
  `worker resume <name>` runs `claude respawn <id>` for that one session (never `--all`).
- Usage limits: `worker-role` on StopFailure `rate_limit` marks the worker paused until the reset
  time; the lead goes on with other phases. Affordable-slot workers spend no plan usage.
- Caps that hand off rather than stop: context at 70%; a note to the lead at
  `workers.softHours` (2); a hand-off at `workers.maxHours` (4); no token cap.
- P14: run one real worker for about 2 hours on an affordable slot to tune the thresholds.

## R9 — Claude Code Workflows

Facts (docs, CHANGELOG, the 2.1.306 tool description):
- A plugin ships `.js` scripts in `workflows/` (or the manifest's `workflows` key); `meta.name`
  `x` runs as `/cc-smart-dev-kit:x`. The tool takes `script | name | scriptPath`, `args`,
  `resumeFromRunId`, and returns at once (`async_launched`); a task notification brings the
  script's return value. The calling session stays free.
- Opt-in: Claude may start a workflow only when the person typed `ultracode`, turned it on, asked
  for a workflow in words, **invoked a skill or command whose instructions say to call Workflow**,
  or named a saved workflow. A skill Claude loaded by itself does not count; a yes to an
  `AskUserQuestion` that names the run and its cost does.
- Per `agent()`: `model`, `effort`, `agentType`, `isolation: 'worktree'` (branches from the
  default branch), `schema` (validated object), `label`, `phase`, `stallMs`. Up to 16 agents at
  once; nested `workflow()` one level; the `Workflow` tool is removed from subagents; the script
  has no shell or file access; `Date.now()` and `Math.random()` throw.
- `CLAUDE_CODE_WORKFLOW_SUBAGENT_MODEL` and `CLAUDE_CODE_SUBAGENT_MODEL_FORCE` override a script's
  `model`; `CLAUDE_CODE_EFFORT_LEVEL` overrides effort for subagents (and, very likely, for
  workflow agents).
- In a **background session** a run does not pause at a usage limit: its agents fail. The size
  guideline (small/medium/large/unrestricted) is advice for scripts Claude writes; a shipped
  script must take its budget through `args`.
- Agent view does not list a session's subagents or workflows.

Where workflows win: the audit (D1) — fixed shape, one summary back to a thin lead; the review
split by track (only if SubagentStart/SubagentStop fire for workflow agents, so the review is
recorded — live proof); a research sweep before a plan (at the size limit). Where they lose: the
release check (deterministic: a package script), a worker's build → test → review → fix loop
(judgment between steps, no mid-run input, worktrees from the default branch, agents fail at a
usage limit in a background session), and dispatching workers (no shell; a computed prompt is not
the person's request).

The guard's gaps (lead-checked):
- **G1:** a Workflow call with no inline `script` — run by `name` or `scriptPath` — passes
  silently (`src/hooks/agent-guard.ts:1282`), so every plugin, saved or built-in workflow and
  every resume escapes the model rules and the launch record. Fix: resolve the script from the
  name or path; one it cannot read asks (denied in `-p`).
- **G2:** a nested `workflow(...)` inside a script is not read.
- **G3:** the guard reads none of the override variables (above).
- **G4:** README, design.md and contract row 54 claim more than the guard does.
- **G5:** one `tool_use_id` for all of a run's launches, so only the first is recorded.
- **G6 (later):** the `agent.spawn` mod hook sees every real launch, whatever its route (MD-4).

Recommended: ship the `audit` skill plus a workflow `audit-run` (auditors and checkers on `opus`
xhigh, the writer on `sonnet` max, the budget from `args`, the skill asks before a run the person
did not start); `review-split` after the proof; `research` later. The kit's text says "Claude Code
workflows" (the kit already uses "workflow" for its own project policy). A test folder runs each
shipped script against fake `agent`/`parallel`/`pipeline` and checks the guard allows every
launch. Biome must skip `plugin/workflows` (a top-level `return` with `export`);
`check:duplicates` learns to read the scripts' strings. Live proofs P1–P9 first (what the tool
input holds for a named run; whether SubagentStart/Stop fire for workflow agents; nesting;
whether `plugin validate` checks scripts; context cost; the override order; the mod hook).

## L1a.1 — Worker proofs, run live on 2.1.306 (2026-10-21)

Probe sessions on `--model haiku --effort max`; the person's settings run every session in
`auto` permission mode by default.
- **Launch (P1): proved.** `claude --bg --name … --settings '{"env":{"CC_SMART_DEV_KIT_WORKER":"probe"}}' …`
  returned in 0.9 s; the worker's Bash saw the variable, `CLAUDE_JOB_DIR`, `CLAUDE_CODE_CHILD_SESSION=1`
  and `CLAUDE_CODE_MESSAGING_SOCKET`. `--session-id` with `--bg` is ignored with a warning: the
  launcher reads the id from `backgrounded · <id> · <name>` (the short id is the first 8
  characters of `sessionId`). An `agents --json` row: `pid, id, cwd, kind, startedAt, sessionId,
  name, status, state` (`waitingFor` when waiting).
- **Lead identity (P13): proved.** The nearest ancestor process with a
  `~/.claude/sessions/<pid>.json` is the session; that file holds `sessionId`, `jobId`, `kind`,
  `name`, `messagingSocketPath`, `status`. A lead in a background session is `kind: "bg"`.
- **Worktree (P7): proved with `-p`.** `-w <name>` opens the EXISTING launcher-made worktree
  (`.claude/worktrees/wk-probe`, branch `wk/probe`), a commit needs no prompt, a write into the
  main checkout is refused ("This session is isolated in the worktree …"). EnterWorktree by NAME
  resumes it too (its message names the branch wrongly); a relative path resolves against the
  cwd — use an absolute one. **Claude Code git-locks the worktree and leaves the lock** after a
  clean exit: `worker rm` and the worktree verdict must unlock it. Owed: `--bg -w` in a trusted
  repo — `claude --bg` refuses a git repo the person never opened ("Workspace not trusted"; trust
  is not inherited from a parent folder).
- **Auto mode (P3): proved.** The whole suite and `git commit` ran with no prompt (`--bg` in a
  non-git folder; `-p` in a git repo).
- **Monitors (P4): proved in a `--bg` session**, despite the docs' "interactive sessions only": a
  monitor line arrives as a task notification, is held while a turn is busy, and **wakes an idle
  session** (a new turn 22 s after the line). `on-skill-invoke:<plugin>:<skill>` starts it.
  **`DISABLE_TELEMETRY=1` stops every monitor** — the fallback (`worker watch --once` in the
  background) is for that case.
- **Auto-background (P5): proved.** A PreToolUse `updatedInput` that adds
  `run_in_background: true` moves the command to the background ("Command running in background
  with ID: …"), and its exit starts a new turn; the same command without the hook ran 34 s in the
  foreground.
- **Reminder events (P6): proved.** A hand-back arrives as a turn whose prompt is the
  `<agent-message …>` peer text, and **UserPromptSubmit fires on it** (its `additionalContext`
  reaches the model). SessionStart fires with `compact` after a compaction. The parent gets no
  PostToolBatch on a hand-back turn. SubagentStop also fires for internal agents
  (`agent_type: ""`): filter them. **A Stop hook that returns `additionalContext` keeps the turn
  going and starves hand-backs: no Stop hook gives context.**
- **`--bg -w` in a trusted repo: proved by the lead.** In this repo (trusted), after
  `git worktree add -b wk/probe-trust .claude/worktrees/wk-probe-trust HEAD`,
  `claude --bg -w wk-probe-trust --name "W probe trust" …` ran with `cwd` that worktree and
  branch `wk/probe-trust` (`claude agents --json`, its own `pwd`). `claude rm <id>` then
  refused: "exit that session, or run 'git worktree unlock' on the worktree … then run 'claude
  rm' again" — the worktree was locked "claude session wk-probe-trust (pid … start …)" after a
  `claude stop`. So `worker rm`: stop, unlock, the kit's own verdict and removal, then
  `claude rm`.
