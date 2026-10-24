# CC2 — crew caps per lead (owner decision D54)

**Goal.** The owner runs about 11 leads at once in one project. Today one machine-wide pool (`crew.max`, `crew.maxOpus`) is shared first come, first served, so one lead can take every place and the others starve. D54 (read it in `.claude/plans/2026-10-21-master-plan.md`, the 2026-10-23 Progress lines): **caps per lead** — default 4 crew sessions, 2 on the opus tier — and **machine-wide only guards**: the free-memory gate (`crew.memoryGb`, exists), a safety ceiling (default 24), and new opus-tier phases wait while the plan's 5-hour usage window is past 85% unless the gateway's opus slot has a fallback chain. All configurable.

## Read first
`src/crew/places.ts` (the caps and the queue, `FINISHED_STATES`, `unmetWaits`), `src/crew/start.ts`, `src/crew/watch.ts` (`startQueued`), `src/crew/store.ts` (`listAllCrew`; records carry their lead), `src/workflow/schema.ts` (the `crew.*` fields and their messages), `.claude/rules/cc-smart-dev-kit-json.md`, `docs/design.md` § Lead and the crew, README § The workflow, `plugin/skills/lead/SKILL.md` § 7.

## Build
1. New fields `crew.perLead` (default 4) and `crew.perLeadOpus` (default 2), counted per lead across every repository's store (a lead is the session that started the crew session).
2. `crew.max` becomes the machine's safety ceiling: default 24 (was 6). `crew.maxOpus` keeps working as an **optional** machine-wide opus ceiling with **no default** (unset = no machine count), so a person who set it (this machine's own file sets 4) keeps their limit; say so in the docs.
3. The usage guard: an opus-tier phase waits while the 5-hour window is past 85%. Read the window from the one place the kit already reads it (find how `cc-smart-dev-kit statusline` gets the 5-hour usage and reuse that reader; one home). When the gateway's opus slot has a chain with its fallback on, the guard does not hold. When the window cannot be read, the guard does not hold, and `crew start`/the board say so once (never an invented number).
4. A queued phase's line says which cap holds it (its lead's cap, the opus cap, the ceiling, memory, the usage window); the watch starts queued phases oldest first per lead, so one lead never starves another.
5. `workflow show`, `crew list`, the lead skill § 7, README and `docs/design.md` say the new rule.

## Edge cases
Two leads starting at the same moment (the places lock); a lead whose session ended (its queued phases wait for it, as today); a crew record from before this change with no lead field (count it toward the machine ceiling only); a `crew.maxOpus` set lower than `perLeadOpus`.

## Files
`src/crew/places.ts`, `src/crew/start.ts`, `src/crew/watch.ts`, `src/crew/board.ts`, `src/workflow/schema.ts`, `src/workflow/resolve.ts` if it lists defaults, their tests, `plugin/skills/lead/SKILL.md`, `README.md`, `docs/design.md`, `.claude/rules/cc-smart-dev-kit-json.md`. Change nothing else.

## Done-check
Tests for each cap and the guard (break each once, watch it go red); `bun run typecheck`, `bun run lint`, `bun run check:neutral`, `bun run check:duplicates`, `bun run check:core-lines`, `timeout 900 bun test --timeout 60000 src/crew src/workflow src/hooks`, then the whole `bun test`. Don't commit `plugin/dist` or `plugin/portal-ui`, don't bump the version, never stage `supabase/`, no company/project/person names (`.claude/rules/neutrality.md`). The lead owns the plan file, `plugin/dist`, `plugin/portal-ui` and the version.
