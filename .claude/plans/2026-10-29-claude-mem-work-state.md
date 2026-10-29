# claude-mem's to-do list back on every machine (D68)

**Status:** Approved (the owner, 2026-10-29)

**Summary**
- `setup` stops turning claude-mem's work state (its to-do list) off. It takes back the `"false"` it wrote, and the memory-use block stays off.
- Claude Code's task tools stay on for every machine, with or without claude-mem: the lead and crew sessions use that list, because the kit's hooks read it.
- Normal sessions use claude-mem's list, which is kept across sessions. The kit's skills, docs and `doctor` say which list is for what. Release 1.6.0.

## Context

D23 (2026-10-21) turned both of claude-mem's start blocks off: work state and the memory-use block. Together they went over Claude Code's 10,000-character hook output limit in 36 of 218 starts. The owner wants the to-do list back ("it was doing amazing"). On 2026-10-29 the owner chose "every machine", with "claude-mem first" for which list to use.

The overflow came from the memory-use block alone. That makes this a safe change, not a workaround.

## Research (condensed; the full research: [`.claude/research/archive/2026-10-29-claude-mem-work-state.md`](../research/archive/2026-10-29-claude-mem-work-state.md))

Read from claude-mem 15.4.0's `scripts/worker-service.cjs`:
- **The work-state block is capped at 3,000 characters.** `Gle=3e3`, and `Kle` cuts the list with "...N more lines; read them with work_state_read".
- **Its room is reserved in the budget.** `renderContextInjectBody` passes `reserveChars: (u ? u.length+2 : 0) + UW(...)`. The timeline is then cut to `1e4 - reserveChars - placeholders`. claude-mem's CHANGELOG says this has held since 13.29.0, the release that added work state: "memory is fitted into what remains of the 10,000-character limit". The kit already requires `>=13.36.0`.
- **The memory-use block gets no room.** It is 2,466 characters (`Yle`), and the hook puts it into `additionalContext` ahead of the context. `UW` reserves room for it only when TeamBrain is set up (`if(!Hw(t))return 0`). So memory-use plus a full timeline goes over the limit: that was D23's overflow.
- **Measured on this PC:** `GET /api/context/inject?projects=cc-smart-dev-kit` gives 4,824 characters with work state off and 7,053 with it on (memory-use off).
- **Crew sessions keep claude-mem** (`leanLaunch` in `src/crew/claude.ts` keeps the kit's own dependencies). So crew sessions see claude-mem's line "use it instead of any built-in to-do tool" too.
- **The switch is read per call.** The worker reads `CLAUDE_MEM_WORK_STATE_ENABLED` from its own env or settings at each render, and the MCP server reads it on each `tools/list`. So a per-session override cannot turn it off. The kit's own words are the override for crew sessions and the lead.

## Code exploration

- `src/machine/claude-mem.ts`:
  - `START_BLOCK_KEYS` and `WORK_STATE_KEY`.
  - `planStartBlocks` plans both blocks `"false"`.
  - `ClaudeMemPlan.todoTools` is set from "work state planned off".
  - `applyClaudeMem` passes `set` and `remove` to `applyManagedJson`.
  - `readStartBlocks` is doctor's reader.
- `src/setup/managed-json.ts` › `withdraw`: removes a key only while it still holds the value the kit wrote, and drops the claim either way. That is exactly "give the key back for good".
- `src/cli/setup.ts`:
  - `planTodoTools` runs only when `managed.claudeMem?.todoTools`.
  - `workStateWarning` is printed when the plan changes `WORK_STATE_KEY`.
  - `restartStep` names claude-mem when its file changed.
- `src/cli/doctor.ts`:
  - `claudeMemStartBlocksCheck` is ✗ when either block is on and nobody chose it.
  - `claudeMemTodoToolsCheck` runs only while work state is off and claude-mem is installed (`claudeMemChecks`, companions group).
- `src/machine/claude-mem-choices.ts:912`: `followSetup` runs the plan with `startBlocks: []`.
- Texts that name the task list:
  - `src/hooks/crew-role.ts` › `taskListStep` (the deny and the card)
  - `src/hooks/lead-notes.ts:119` (the lead's reminder)
  - `plugin/skills/memory-routing/SKILL.md` (the To-do list row)
  - `plugin/skills/lead/SKILL.md:39`
  - `plugin/skills/crew/SKILL.md:33`
- Docs:
  - `README.md` § The two start blocks, off, and its doctor list
  - `docs/design/claude-mem.md` § claude-mem: the two start blocks, off (D23)
  - `docs/design.md`'s index line
- Tests: `src/machine/claude-mem.test.ts` (D23 describes), `src/cli/doctor.test.ts`, `src/cli/cli.test.ts` (setup and doctor expectations), `src/cli/restore.test.ts`.

## The approach

1. **The plan** (`claudeMemPlan`):
   - `startBlocks` plans only `CLAUDE_MEM_MEMORY_INSTRUCTIONS_ENABLED` off, with the same rules as today (unchosen may be taken; the person's value stays, named in a `!` line).
   - A new `withdraw: KeyPath[]` holds the work-state path whenever claude-mem is installed and the file is readable and flat. `withdraw` takes the key out only while it still holds setup's `"false"`, and drops the claim in every case.
   - `todoTools` leaves `ClaudeMemPlan`.
   - `applyClaudeMem` passes `withdraw`.
   - `followSetup` clears `withdraw` as it clears `startBlocks`: following the scout is about the provider keys only.
2. **Task tools on every machine** (`setup.ts`): `planTodoTools` runs on every setup, with or without claude-mem (the person's own value is still kept and named).
3. **What setup says:**
   - `workStateWarning` goes.
   - When the plan's dry pass removes the work-state key, setup prints one `·` line in the companions section (text below).
   - The restart step stays: it already names claude-mem when its file changed.
4. **doctor:**
   - The start-blocks line is ✗ (`Fix: cc-smart-dev-kit setup`) when the memory-use block is on and nobody chose it, or when work state is off with setup's own value.
   - A value the person set is `·`. Everything else is ✓.
   - The task-tools line moves to the `plugin` group and runs on every machine.
5. **Which list** (D68, the owner's choice): a normal session uses claude-mem's work state; a lead and a crew session use Claude Code's task tools; with neither, the plan file. The rule lives in one place, memory-routing's To-do list row. The lead and crew skills point at it, and the two hook texts name the list.

**Play safe or fully new:** neither applies. No legacy path is kept. The old `"false"` is taken back through the managed writer, so `restore` and the records stay correct. A person who wants work state off sets `"false"` again by hand, and setup leaves it.

### Fixed texts (the contract both phases build on)

- **setup `·`:** `claude-mem's work state is back on: its open to-do lists show at the start of each session again. To keep it off, set CLAUDE_MEM_WORK_STATE_ENABLED to "false" in ~/.claude-mem/settings.json; setup leaves a value you set alone.` (The key and the path come from `WORK_STATE_KEY` and `tildify`.)
- **doctor start blocks, ✓:** `claude-mem's start blocks in ~/.claude-mem/settings.json: work state is on (claude-mem's default), memory-use block is off (set by cc-smart-dev-kit setup)`
- **doctor ✗ reasons** (appended to the line above, joined when both apply):
  - `. The memory-use block can push claude-mem's start context past Claude Code's 10,000-character limit`
  - `. Work state is off from an older setup, so sessions get no to-do list from claude-mem`
- **doctor task tools:** the same three lines as today, with the end changed to `, so a lead, and a session without claude-mem's work state, has no task list`.
- **crew-role `taskListStep`:** `Write your task list first, in Claude Code's task tools (not claude-mem's work state): look up the task tools (ToolSearch \`select:TaskCreate,TaskUpdate,TaskList\`), then one TaskCreate per part of your brief, each with its done-check.`
- **lead-notes:** `You have no to-do list: put the person's asks and your open work on Claude Code's task list (TaskCreate, not claude-mem's work state), and keep it true as they move.`
- **memory-routing To-do list row:** Where: `claude-mem's work state (work_state_write, work_state_read) when its tools are there: kept per project, its open items shown at each session start. A lead and a crew session use Claude Code's task tools instead (TaskCreate, TaskList, TaskUpdate; look them up first), because the kit's hooks read that list. Without claude-mem's tools, Claude Code's; with neither, the plan file`. Audience: `this person, across the project's sessions`.

## Files to change

| Phase | Files |
|---|---|
| CM1 code | `src/machine/claude-mem.ts`, `claude-mem.test.ts`, `claude-mem-choices.ts` (the `followSetup` line), `src/cli/setup.ts`, `src/cli/doctor.ts`, `doctor.test.ts`, `src/cli/cli.test.ts`, `src/cli/restore.test.ts`, `src/hooks/crew-role.ts`, `src/hooks/lead-notes.ts`, and their tests where a text is asserted |
| CM2 docs | `README.md` (§ The two start blocks → "claude-mem's start blocks", and the doctor list), `docs/design/claude-mem.md` (first section: D68, the evidence above, the withdrawal, task tools on every machine; the `followSetup` reason), `docs/design.md` (index line), `docs/design/hooks.md` and `docs/design/crew.md` (only where they quote the card or reminder text), `plugin/skills/memory-routing/SKILL.md`, `plugin/skills/lead/SKILL.md`, `plugin/skills/crew/SKILL.md` |
| Lead (me) | `CHANGELOG.md` (1.6.0 with **What to run**), `plugin/.claude-plugin/plugin.json` (1.6.0), `plugin/dist/` (build), this plan |

## Patterns to follow

- Owned keys go through `applyManagedJson` only, with `unchosen` as today. The removal pattern is `RETIRED_KEYS`; use `withdraw` for a key the kit gives up for good.
- doctor: `ok: false` needs `fix`, and the text says only what is wrong (`.claude/rules/command-output.md`).
- Names and paths come from constants (`WORK_STATE_KEY`, `TODO_TOOLS_KEY`, `COMMAND`, `tildify(paths…)`).
- Skills keep one home per rule (`bun run check:duplicates`). The lead and crew skills point at memory-routing instead of repeating the row.

## Edge cases

| Case | What happens |
|---|---|
| Every current machine (setup's `"false"`, recorded) | `withdraw` removes the key, so claude-mem's default `"true"` applies; `-` line, plus the `·` line |
| The person set `"false"` by hand (no record) | Kept; doctor `·` "your choice" |
| The person set `"true"` over setup's `"false"` (this PC) | `withdraw` drops the claim and leaves `"true"`; no file write; doctor then says "claude-mem's default" |
| Setup's `"false"`, which the person meant to keep | Indistinguishable from setup's own, so it is taken back; CHANGELOG's What to run says how to set it again (then it is theirs) |
| Fresh machine | Only memory-use is written; work state is never touched; task tools `"1"` |
| claude-mem not installed | No claude-mem plan; task tools still planned (new) |
| An old nested file | The whole file waits, as today (`isOldNestedForm`) |
| `--dry-run` | Shows the `-` and the `·` line; writes nothing |
| A second setup | "Nothing to change" |
| `restore` before the new setup ran | Removes the old `"false"` as today, so the default comes back |
| `restore` after | Nothing of the key is left to remove |
| The person turns memory-use on by hand | `·` (their choice), as today |
| TeamBrain set up | claude-mem also reserves room for its brief (`UW`); no change |
| A resumed session | claude-mem sends no context on a resume (its 15.x changelog); no change |
| Crew session or lead | claude-mem's block says to use work state; the card, the deny and the reminder name Claude Code's list; the guard still enforces it |
| Windows, macOS | Same paths through `cliPaths`; nothing depends on the platform |
| Concurrency | Setup's lock and the managed writer's compare, as today |
| claude-mem 13.36–15.3 | The reserve holds since 13.29.0 (its CHANGELOG); I read the code only in 15.4.0 |

## What could break

- The consumers of `ClaudeMemPlan` (`todoTools` removed, `withdraw` added): `setup.ts`, `claude-mem-choices.ts` (`followSetup`) and the tests.
- doctor's output moves a line between groups. The installers read only `--json` (`DoctorReport`), and they match no claude-mem or task-tools text. `DoctorReport` has no check ids (groups, statuses, texts), so the move changes nothing they depend on (checked).
- `cli.test.ts`'s first-setup and doctor transcripts change text.

## A simpler approach?

- **Only stop writing `"false"`:** every existing machine would keep its old `"false"` for ever, which misses the goal.
- **Keep task tools tied to work state:** new machines would lose them, and the lead's list and the crew skill rely on them.

So these steps are the smallest change that reaches the goal.

## Rollback

- A new version whose plan writes `"false"` again (the release skill's rollback).
- On one machine: set `CLAUDE_MEM_WORK_STATE_ENABLED` to `"false"` by hand.

## How we prove it

- **CM1 done-check:** `bun test src/machine/claude-mem.test.ts src/cli/doctor.test.ts src/cli/cli.test.ts src/cli/restore.test.ts src/hooks/crew-role.test.ts src/hooks/lead-notes.test.ts`. New tests, each failing first:
  - `withdraw` takes setup's `"false"`, keeps the person's `"false"`, and drops the claim under the person's `"true"`
  - memory-use is planned alone
  - task tools are planned with claude-mem not installed
  - the `·` line
  - each doctor state
- **CM2 done-check:** `bun run check:docs`, `check:duplicates`, `check:neutral`.
- **Lead:**
  - `bun run build`, then `git diff --stat plugin/dist`: no `router.js` line
  - `bun run check`, and both `claude plugin validate … --strict`
  - one reviewer (`cc-smart-dev-kit:reviewer`, `opus` → Claude Opus, effort xhigh, because the change set is a release)
- **Live on this PC after the update:**
  - `cc-smart-dev-kit setup --dry-run`, then `setup`: the claim is dropped
  - `doctor` shows work state on (claude-mem's default) and memory-use off
  - `/api/context/inject` stays under 10,000 characters
- **You check:** start a new session and see "# Work state" at the top, add a to-do item, then start another session and see it still open.

## Phases and owners (crew is on for this project)

| Wave | Phase | Crew sessions | Files | Waits for |
|---|---|---|---|---|
| 1 | CM1: code and tests | crew `build` (`sonnet`, high) | CM1 row above | the fixed texts (in this plan) |
| 1 | CM2: docs and skills | crew `docs` (`sonnet`, high) | CM2 row above | the fixed texts (in this plan) |
| 2 | Release 1.6.0: CHANGELOG, version, build, full check, review, PR | me | Lead row | CM1 and CM2 merged |
| 3 | Cleanup: worktrees and branches, archive this plan and its folder | me | — | live proof done |

Commits, the push and the pull request follow `cc-smart-dev-kit workflow show`: none happens without your say. The merge waits for your yes.

## Progress

- 2026-10-29: Approved.
  - Branch `claude-mem-work-state`; lead registered.
  - CM1 started (`crew/CM1-code`) and CM2 started (`crew/CM2-docs`), both `sonnet` → `omniroute:cx/gpt-6.1-sol`, effort high.
  - The lead wrote the `CHANGELOG.md` 1.6.0 entry and set `plugin.json` to 1.6.0. `plugin/dist` is rebuilt after the merges.
- Decision while building: withdraw the work-state key only where setup holds a record for it. Why: `withdraw` adds a `skipped` entry for any key that is not ours, so without the check every fresh machine's setup would carry that noise.
- CM2 merged into this branch (`c5444380`), once the owner set the git identity on this PC. CM2's report says "failed" only because two `src/cli/statusline.test.ts` tests failed in its job's environment ("resets 18:00", expected "13:00"). They pass in a plain shell here, and CM2 changed no code.
- **Added scope (the owner, 2026-10-29): save notes as you go.** claude-mem's memory-use block also told sessions to save their own notes with `save_memory`. It stays off, because it is what overflowed.
  - The kit's `plugin/instructions/core.md` gets one short rule in its place: the main session saves a decision, a correction, a preference or a lesson with `save_memory` (after `mem_search`), and a to-do with `work_state_write`. A lead and a crew session keep to-dos in Claude Code's list. A subagent saves nothing.
  - Owner: a `cc-smart-dev-kit:rules-maintainer` subagent (`sonnet`, effort high), in this folder, within core.md's line and token budgets.
  - Upstream: https://github.com/thedotmack/claude-mem/issues/5180 asks claude-mem to count the memory-use block in its budget without TeamBrain. Once a release does, the block can come back.
  - Done by the lead after the subagent's hand-back, which had also shortened five unrelated rules and lost meaning (put back).
    - The rule is in `core.md`, made room for with trims that lose nothing: the opening sentence went into the heading; two table-row phrases the bullet below already states; a few cut words.
    - core.md is ~2399 tokens (budget 2400) and 131 lines (`check:core-lines` warns above 130, fails above 140).
    - The rule is also in the CHANGELOG and in `docs/design/claude-mem.md` (Notes as you go).
- **Neutrality vs the run records.** The kit writes each brief's absolute path into `runs/<crew id>.json` (`brief.path`). On this PC that path names the publisher, so `check:neutral` fails on the two run records.
  - The briefs now use repo-relative paths.
  - The run records are the kit's, never edited by hand. The owner chose (2026-10-29) to ignore them in git: `.gitignore` gets `.claude/plans/**/runs/`. They stay on this machine, `crew history` still reads them, and `check:neutral` passes.
  - A kit fix (store the brief's path relative to the repo) is outside this plan.
- **CM1 after a PC restart (14:27).**
  - The restart stopped CM1 after its review (no findings) and before its report. Claude Code then brought it back as two sessions, and the kit marked one of them failed, for working in the main checkout. The main checkout was unchanged.
  - The lead gated CM1 by hand:
    - its commit `a730deba` is the head its review covered;
    - the worktree was clean except one uncommitted fix from its interrupted full check: `src/hooks/matrix.test.ts` asserts the new crew-role text;
    - every file is in the brief, and the bundles changed only through the two shared hook texts (no `router.js`).
  - The lead merged CM1 and carried the `matrix.test.ts` fix onto this branch. The full check then ran here once, in place of CM1's.
  - The lead stopped the leftover session and removed CM1 with `crew rm`.
- **The full check.** `bun run check` stopped at `check:neutral` on the run records (above). The steps after it ran on their own. Both `claude plugin validate … --strict` passed. `plugin/dist` was rebuilt for 1.6.0, and `router.js` is unchanged.
- **The second opinion:** `cc-smart-dev-kit:reviewer`, `opus` → Claude Opus, effort xhigh (a release), on everything from `82150e1` to the working tree.
- **The first full test run: 8 failures, all now explained.**
  - **2, the lead's miss:** the installers' own copy of the version (`INSTALLER_VERSION` in `install.sh`, `$InstallerVersion` in `install.ps1`) is now 1.6.0.
  - **4, the brief's gap:** `src/cli/setup-output.test.ts` still expected the old work-state lines. Its transcripts were updated by hand to the new output: memory-use only, no warning, 11 changes.
  - **2, not this change:** in `src/cli/statusline.test.ts`, the times are in the machine's zone.
    - Root cause: `bun test` runs in UTC without setting `TZ`. `inUtc` in `src/cli/gateway-cli.test.ts` (about :3816) restores the zone by `delete process.env.TZ`, and from then on the rest of the process runs in the system zone.
    - Proved with a probe test: the zone went from UTC to the local zone after the same save and restore.
    - It is already on `main`, and it shows only where the system zone is not UTC (CI's is UTC).
    - Outside this plan: it is reported to the owner, not fixed here.
  - The last run fixed `TZ=Etc/UTC` for its test step, to show the rest green.
- **The review's findings, fixed on this branch.** No High finding.
  - **The notes rule conflicted** with memory-routing: it sent a lead's to-dos to claude-mem and routed "a correction" (self-evolve's) to memory. `core.md`'s rule now saves a decision and why, a surprise, a dead end or a preference; a lead's to-do goes to `TaskCreate`. The search before a save stays in memory-routing. The CHANGELOG and `docs/design/claude-mem.md` say the same.
  - **An untested guard:** the person's `"true"` over setup's memory-use `"false"`. Two new tests (`claude-mem.test.ts`, and a rewrite of a test in `setup.test.ts` that could not fail); each was seen to fail with the guard broken.
  - **Trims that blurred meaning** in `core.md` were put back (the opus row's "at `high` or above"). `core.md` is 2,399 tokens against 2,400, and 131 lines (the warning is above 130; the limit is 140).
  - **Stale text:** a README line (an older claude-mem), the `followSetup` comment, two test comments. The lead's reminder now says "no Claude Code task list", the list it reads. The task-tools check is now `taskToolsCheck`: it runs without claude-mem.
  - **Left as they are:** the dry-run wording and the `~` mark for a removal (an existing pattern).
