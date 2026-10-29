# CM2 — claude-mem's work state back on: the docs and the skills

## Goal

Setup stops turning claude-mem's work state (its to-do list) off on every machine (decision D68,
the owner, 2026-10-29). The docs and the skills must say what the code does after CM1 (built in
parallel, on its own branch), and which to-do list a session uses.

The plan: `.claude/plans/2026-10-29-claude-mem-work-state.md`
(§ The approach, § Fixed texts, § Edge cases). The evidence: `.claude/research/archive/2026-10-29-claude-mem-work-state.md` (same folder
root). Cite it in the design page.

## What the code does after CM1 (write the docs from this)

- **The memory-use block** (`CLAUDE_MEM_MEMORY_INSTRUCTIONS_ENABLED`) stays off: setup writes
  `"false"`, with today's rules (claude-mem's default may be taken; the person's value stays).
- **Work state** (`CLAUDE_MEM_WORK_STATE_ENABLED`) is claude-mem's default again (`"true"`):
  - Setup no longer writes it.
  - Where setup holds a record for it, setup **withdraws** it (`applyManagedJson`'s
    `withdraw`): it takes the key out while it still holds setup's `"false"`, and drops the
    claim either way.
  - A `"false"` the person set by hand stays theirs.
  - When the key is taken out, setup prints one `·` line:
    `claude-mem's work state is back on: its open to-do lists show at the start of each session again. To keep it off, set CLAUDE_MEM_WORK_STATE_ENABLED to "false" in ~/.claude-mem/settings.json; setup leaves a value you set alone.`
- **Why that is safe:**
  - claude-mem caps the work-state block at 3,000 characters and reserves its room in its
    10,000-character budget (`reserveChars` in its worker, since 13.29.0 by its CHANGELOG; the
    kit asks for `>=13.36.0`).
  - The 2,466-character memory-use block gets no room kept (only with TeamBrain), so it was
    D23's overflow.
  - Measured on one PC: 4,824 characters with work state off, 7,053 with it on.
- **Claude Code's task tools** (`env.CLAUDE_CODE_ENABLE_TODO_TOOLS: "1"`) are set by setup on
  **every** machine, with or without claude-mem. They are the list of the lead and of crew
  sessions, which the kit's hooks read.
- **doctor:**
  - The start-blocks line is ✗ (`Fix: cc-smart-dev-kit setup`) when the memory-use block is on
    and the person did not set it ("can push claude-mem's start context past Claude Code's
    10,000-character limit"). It is ✗ too when work state is `"false"` from setup ("off from an
    older setup, so sessions get no to-do list from claude-mem").
  - A value the person set is `·`; else ✓.
  - The task-tools line moves to the **The plugin** group and runs on every machine:
    - ✗ when not set;
    - ✓ for `"1"`;
    - `·` for the person's value;
    - its words end "so a lead, and a session without claude-mem's work state, has no task
      list".
- **The hooks' words:**
  - The crew-role step: "Write your task list first, in Claude Code's task tools (not
    claude-mem's work state): …".
  - The lead-notes reminder: "… on Claude Code's task list (TaskCreate, not claude-mem's work
    state) …".
- **The portal's "Let setup decide again"** (`followSetup`) still leaves the start blocks and
  this withdrawal to setup.
- **`restore`** removes what setup still owns. After the new setup, nothing of the work-state
  key is left to remove.

## Your files (change nothing else)

- `README.md`:
  - § "The two start blocks, off" becomes `### claude-mem's start blocks`.
  - Rewrite that section: the memory-use block off, work state on, how to turn work state off
    (set `"false"`; setup leaves it), the task tools on every machine, restore, restart.
  - Rewrite the doctor list's claude-mem bullet (around :675–:681).
  - Fix every link or `§` reference to the old heading.
- `docs/design/claude-mem.md`:
  - The first heading becomes `# claude-mem: the memory-use block off, work state on (D68)`.
  - Rewrite that section from the facts above, with D68's reason and the evidence.
  - Say what D23 was, in one line: its overflow was the memory-use block.
  - Change the PM1 section's `followSetup` sentence: its reason "turning them off also turns
    Claude Code's task tools on" is no longer true. Following the scout is about the provider
    keys only.
- `docs/design.md`: the claude-mem row of the index (:64).
- `docs/design/hooks.md` and `docs/design/crew.md`: only where they quote or describe the
  crew-role step's or the lead-notes reminder's words (they keep their D23 tags: that gate is
  unchanged).
- The skills:
  - `plugin/skills/memory-routing/SKILL.md`: the **To-do list** row is the one home of the
    rule; replace its Where and Audience cells with the plan's text (§ Fixed texts).
  - `plugin/skills/lead/SKILL.md` (:39) and `plugin/skills/crew/SKILL.md` (:33): make clear
    their list is Claude Code's task list, not claude-mem's work state, with a pointer to
    memory-routing. Do not repeat the row's sentence.

**Not yours:**
- `src/**` and `plugin/dist/**` (CM1)
- `CHANGELOG.md`, `plugin/.claude-plugin/plugin.json` and the version (the lead's)
- the plan file
- `docs/roadmap.md` (its 1.0.0 line is history)

## Rules that bite

- Write plainly: short sentences, plain words, active voice. Explain a technical word the first
  time.
- Neutral: no company, person, project or machine name anywhere (`.claude/rules/neutrality.md`).
- Skills follow the plugin's rules: neutral, one home per rule, and a 12-word sentence never
  repeats across the plugin's text (`bun run check:duplicates`).
- Docs show a path once per section, and lists come from the code's own names
  (`.claude/rules/dynamic.md`).

## Done-check

`bun run check:docs`, `bun run check:duplicates`, `bun run check:neutral`,
`bun run check:core-lines`, `bun run check:context-budget` and `bun run lint` (a skill is
Markdown: lint only formats code, so its run proves nothing broke), all green. Then, once before
your report, `bun run check`, with its real result in the report. Its tests run the code as it is
on your branch, so that is expected to pass unchanged.
