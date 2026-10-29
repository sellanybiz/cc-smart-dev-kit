# claude-mem's work state and Claude Code's 10,000-character limit (2026-10-29)

The research behind D68 (plan: `.claude/plans/2026-10-29-claude-mem-work-state.md`). Read from
claude-mem 15.4.0 as installed (`~/.claude/plugins/cache/thedotmack/claude-mem/15.4.0/`), its
marketplace's `CHANGELOG.md`, and live on one Linux PC.

## The question

D23 (2026-10-21) turned off both blocks claude-mem puts at the start of a session, because
together they passed Claude Code's 10,000-character hook output limit in 36 of 218 starts. Can
work state (the to-do list) come back without the overflow?

## What claude-mem does

All from `scripts/worker-service.cjs` (minified; the names are the bundle's own).

- **The work-state block has a cap.** `j7e(entries, now, r = Gle)` builds it, and `Gle = 3e3`.
  `Kle` adds lines until the next would pass the cap, then ends with
  `- ...N more lines; read them with work_state_read`. The rule text alone (`PW`) is about
  1,470 characters; claude-mem's CHANGELOG gives 806 when nothing is open.
- **Its room comes out of the budget.** In `renderContextInjectBody`, `u` is the block (empty
  when the switch is off), and the timeline is rendered with
  `reserveChars: (u ? u.length + 2 : 0) + UW({...})`. The timeline renderer cuts at
  `1e4 - (reserveChars ?? 0) - placeholders`. The body is `u + "\n\n" + timeline`.
- **The memory-use block has no room kept for it.** `Yle` (`# claude-mem memory use …`) is
  2,466 characters. The claude-code context hook sets
  `additionalContext = CLAUDE_MEM_MEMORY_INSTRUCTIONS_ENABLED === "false" ? "" : H7e(...)` and
  the context comes after it. `UW(t)` returns 0 unless TeamBrain is set up (`Hw(t)` reads
  `CLAUDE_MEM_TEAMBRAIN_URL`). With TeamBrain, it reserves the brief and the memory-use block.
- **Since when.** The CHANGELOG entry that brought work state, under `[13.29.0]`, says: "Context
  opens with the rule and every open item, … capped at 3,000 characters (806 when nothing is
  open); memory is fitted into what remains of the 10,000-character limit." The kit requires
  claude-mem `>=13.36.0` (`plugin.json`).
- **How the switch is read.** `CLAUDE_MEM_WORK_STATE_ENABLED`'s default is `"true"`. The worker
  reads `process.env.CLAUDE_MEM_WORK_STATE_ENABLED ?? settings` at each render, so it reads the
  worker's environment, not a session's. The MCP server filters the `work_state_*` tools on each
  `tools/list`, and a call while the switch is off answers
  `Work state is turned off (CLAUDE_MEM_WORK_STATE_ENABLED=false).` (`mcp-server.cjs`).
- **What the block tells a session.** "Use claude-mem's work_state_write tool to track all to-do
  lists and multi-step work. It is your canonical to-do list: use it instead of any built-in
  to-do tool." The kit cannot change that text.

## So

Every overflow D23 measured came from the memory-use block. Work state plus the timeline fits
the limit by claude-mem's own budget. Work state may come back while the memory-use block
stays off.

## Measured (this PC, claude-mem 15.4.0, 2026-10-29)

`curl http://127.0.0.1:<worker port>/api/context/inject?projects=cc-smart-dev-kit | wc -c`:

| Work state | Memory-use block | Characters |
|---|---|---|
| off | off | 4,824 |
| on | off | 7,053 |

After the switch was set to `"true"` in `~/.claude-mem/settings.json`, the worker served the
block without a restart. `cc-smart-dev-kit doctor` 1.5.0 then said "work state is on (your
choice)".

## Who sees the block

- **Every session that loads claude-mem**, at startup, clear and compact. On a resume claude-mem
  sends no context (its 15.x CHANGELOG: "returns an empty context block for resume").
- **Crew sessions too.** `leanLaunch` (`src/crew/claude.ts`) turns off every enabled plugin
  except this one, its dependencies (claude-mem is one) and what `workflow.crew.keep` names.
- **No per-session off switch.** The worker reads the switch from its own environment, so a
  crew session's environment or `--settings` cannot hide the block.

So in crew sessions and the lead, claude-mem's "use it instead of any built-in to-do tool"
conflicts with the kit, whose hooks read Claude Code's own task folder (`src/crew/tasks.ts`:
the crew-role edit gate, the done-report check, the lead-notes reminder). The kit's own texts
must name the list there.

## Options weighed for "which list" (the owner chose the first, 2026-10-29)

1. **claude-mem first.** Normal sessions use claude-mem's list, as its text says, so there is
   no conflict there. The lead and crew sessions use Claude Code's, which the kit's hooks read.
2. **Both, split jobs.** claude-mem's list for what outlives the session, Claude Code's for this
   session's steps. Two lists to keep in step, and the conflict in every session.
3. **claude-mem everywhere.** Rewrite the gate, the done check and the reminder against
   claude-mem's worker. The biggest change, and the kit's core would depend on another plugin's
   internals.
