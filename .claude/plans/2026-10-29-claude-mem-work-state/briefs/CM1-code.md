# CM1 — claude-mem's work state back on: the code and its tests

## Goal

Setup stops turning claude-mem's work state (its to-do list) off on every machine (decision D68,
the owner, 2026-10-29). D23 turned off both of claude-mem's start blocks because together they
went over Claude Code's 10,000-character hook output limit. The overflow came from the
memory-use block alone: claude-mem caps the work-state block at 3,000 characters and reserves
its room in the budget (`reserveChars` in its worker). So:

- the **memory-use block stays off**;
- **work state comes back on**: setup takes back the `"false"` it wrote;
- **Claude Code's task tools stay on for every machine**, with or without claude-mem: the lead
  and crew sessions use that list, because the kit's hooks read it.

The plan: `.claude/plans/2026-10-29-claude-mem-work-state.md`
(§ The approach, § Fixed texts, § Edge cases). Its research: `.claude/research/archive/2026-10-29-claude-mem-work-state.md` (same folder
root).

## Your files (change nothing else)

- `src/machine/claude-mem.ts`, `src/machine/claude-mem.test.ts`
- `src/machine/claude-mem-choices.ts` (the `followSetup` line, about :912), `src/machine/claude-mem-choices.test.ts` (only where it asserts start blocks or the plan's shape)
- `src/cli/setup.ts`, `src/cli/setup.test.ts`
- `src/cli/doctor.ts`, `src/cli/doctor.test.ts`
- `src/cli/cli.test.ts`, `src/cli/restore.test.ts`
- `src/hooks/crew-role.ts`, `src/hooks/crew-role.test.ts`
- `src/hooks/lead-notes.ts`, `src/hooks/lead-notes.test.ts`
- `plugin/dist/**` (only by `bun run build`, never by hand)

**Not yours:**
- `README.md`, `docs/**` and `plugin/skills/**` (the docs phase, CM2)
- `CHANGELOG.md`, `plugin/.claude-plugin/plugin.json` and the version (the lead's)
- the plan file

Do not bump the version.

## What to build

1. **`src/machine/claude-mem.ts`**
   - Keep `START_BLOCK_KEYS` and `WORK_STATE_KEY`: doctor reads both blocks. Add
     `MEMORY_USE_KEY = START_BLOCK_KEYS[1]`.
   - `planStartBlocks` plans **only** `MEMORY_USE_KEY` off, with today's rules for that key:
     claude-mem's default may be taken, and the person's value stays, named in the `!` line.
   - `ClaudeMemPlan`:
     - Drop `todoTools`.
     - Add `withdraw: KeyPath[]`: the work-state path, **only when setup holds a record for it**
       (`read.records.find((r) => samePath(r.path, read.at(WORK_STATE_KEY)))`).
     - Why: `applyManagedJson`'s `withdraw` (`src/setup/managed-json.ts:574`) pushes a `skipped`
       entry for any key that is not "ours" — also one with no record at all. Without the
       record check, every setup on a fresh machine would carry that noise.
     - With a record, `withdraw` removes the key while it still holds setup's `"false"`, and
       drops the claim either way. That covers this PC's case: the person's `"true"` stays, and
       the claim goes.
   - `applyClaudeMem` passes `withdraw: plan.withdraw`.
   - Rewrite the doc comments that say D23 turns both blocks off (the module comment around
     :49–:59, the `START_BLOCK_KEYS` comment around :124–:133, `planStartBlocks`, the
     `ClaudeMemPlan` fields, and `TODO_TOOLS_KEY`'s comment). Say:
     - D68: the memory-use block stays off.
     - Work state is claude-mem's default again.
     - Why: work state's room is reserved in claude-mem's 10,000-character budget, and the
       memory-use block's is not.
     - The task tools are the list of a lead and crew sessions (the kit's hooks read it), and
       the to-do home without claude-mem.
     Cite `docs/design/claude-mem.md` by file name only, with no `§` heading: the docs phase
     renames it.
2. **`src/machine/claude-mem-choices.ts`**: `followSetup` runs the plan with
   `{ ...planned.plan, startBlocks: [], withdraw: [] }`. Following the scout is about the
   provider keys only.
3. **`src/cli/setup.ts`**
   - `planTodoTools(paths)` runs on **every** setup, not only when `managed.claudeMem?.todoTools`
     (about :383–:386). The person's own value is still kept and named, as today.
   - Remove `workStateWarning`.
   - In `decideClaudeMem`, when the plan's dry pass (`applyClaudeMem(paths, plan, true).changes`)
     has a change whose path ends in `WORK_STATE_KEY` and whose `after` is `undefined`, push one
     info line (`mark: "info"`, section `companions`). Build it from `WORK_STATE_KEY` and
     `tildify(paths.claudeMemSettingsFile, paths.home)`:
     `claude-mem's work state is back on: its open to-do lists show at the start of each session again. To keep it off, set CLAUDE_MEM_WORK_STATE_ENABLED to "false" in ~/.claude-mem/settings.json; setup leaves a value you set alone.`
   - Check how setup prints a `withdraw` that was skipped (the person's `"true"` under setup's
     record). It should print **no** line for it: the key is theirs and on, so there is nothing
     to say. If the report shows skipped entries, keep that one out and test it.
   - Update the comments that say "work state goes off (D23)".
4. **`src/cli/doctor.ts`**
   - `claudeMemStartBlocksCheck`. Base text as today:
     `claude-mem's start blocks in ~/.claude-mem/settings.json: <work state …>, <memory-use block …>`.
     It is ✗ with `fix: SETUP_FIX` when either reason holds, and both reasons are added in this
     order when both hold:
     - memory-use is on and the person did not set it: `. The memory-use block can push claude-mem's start context past Claude Code's 10,000-character limit`
     - work state is `"false"` and set by setup: `. Work state is off from an older setup, so sessions get no to-do list from claude-mem`
   - Otherwise it is `info: true` (`·`) when a value is the person's and differs from the kit's
     aim (memory-use on, or work state off, by the person), and plain ✓ when not. Example ✓:
     `claude-mem's start blocks in ~/.claude-mem/settings.json: work state is on (claude-mem's default), memory-use block is off (set by cc-smart-dev-kit setup)`.
   - The task-tools check leaves `claudeMemChecks` and goes into the `plugin` group (in
     `doctorGroups`, after `checkInstructions`). It runs on **every** machine, with or without
     claude-mem, so take away the `readings` parameter and the work-state gate.
   - Its three lines keep their start, and each ends with
     `, so a lead, and a session without claude-mem's work state, has no task list` in place of
     today's `, so a session has no to-do list while claude-mem's work state is off`. The `✓`
     line has no such end: it stays as today.
   - Update the D23 comments to D68.
5. **`src/hooks/crew-role.ts`**: `taskListStep()` returns exactly:
   ``Write your task list first, in Claude Code's task tools (not claude-mem's work state): look up the task tools (ToolSearch `select:TaskCreate,TaskUpdate,TaskList`), then one TaskCreate per part of your brief, each with its done-check.``
6. **`src/hooks/lead-notes.ts`** (about :119) returns exactly:
   `You have no to-do list: put the person's asks and your open work on Claude Code's task list (TaskCreate, not claude-mem's work state), and keep it true as they move.`
7. **Tests**
   - Rename the D23 tests about the start blocks to D68, and change them to the new behaviour.
   - Tests for the crew-role gate and the lead reminder keep their D23 names: that decision,
     the task-list gate, still holds.
   - New tests, each seen failing first:
     - `withdraw` takes out setup's `"false"`; a `restore` after it has nothing of that key
       left.
     - The person's `"false"` with no record is kept (no withdraw is planned, and doctor says
       `·` your choice).
     - The person's `"true"` over setup's record: the claim is dropped, the file is not
       written, and no setup line is printed.
     - Memory-use is planned alone.
     - Task tools are planned, and doctor checks them, with claude-mem **not installed**.
     - The new setup `·` line, in a real run and in `--dry-run`, where it writes nothing.
     - A second setup says "Nothing to change".
     - Each doctor state above.
     - `followSetup` leaves the work-state key alone.
   - Fix every transcript in `cli.test.ts` that the new texts change. Expected values are
     written by hand, never computed.
8. **Build**: `bun run build`. Then `git diff --stat plugin/dist` must show no `router.js`
   line; if it does, find out why before you go on.

## Patterns to copy

- Owned keys go through `applyManagedJson` only (`.claude/rules/setup-and-managed-files.md`).
  The retired-key removal is `RETIRED_KEYS` in `claudeMemPlan` (`src/machine/claude-mem.ts`
  around :650).
- doctor: `ok: false` needs `fix`, and its text says only what is wrong; information is
  `info: true` (`.claude/rules/command-output.md`).
- Names and paths come from constants (`WORK_STATE_KEY`, `MEMORY_USE_KEY`, `TODO_TOOLS_KEY`,
  `COMMAND`, `tildify`), never typed (`.claude/rules/dynamic.md`).
- Tests use temp folders only and never touch the real `~/.claude`
  (`.claude/rules/testing.md`).

## Edge cases to cover

- An old nested claude-mem file: the whole file still waits (`isOldNestedForm`), and no
  withdraw is planned.
- An unreadable claude-mem file: the note, as today.
- claude-mem not installed: no claude-mem plan, and the task tools are still planned.
- `--dry-run` writes nothing (no `owned.json` change either).
- `restore` on a machine where the new setup never ran: it removes the old `"false"`, as today.

## Done-check

1. `bun test src/machine/claude-mem.test.ts src/machine/claude-mem-choices.test.ts src/cli/setup.test.ts src/cli/doctor.test.ts src/cli/cli.test.ts src/cli/restore.test.ts src/hooks/crew-role.test.ts src/hooks/lead-notes.test.ts`, all green.
2. `bun run typecheck` and `bun run lint`.
3. Once, before your report: `bun run check` (the whole suite and `build:check`), green. Paste
   its real result into the report.
