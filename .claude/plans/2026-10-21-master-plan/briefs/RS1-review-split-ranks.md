# RS1 — the two shipped workflows never drop a finding, and their callers pass the right arguments (1.2.1)

## Goal, and why

Your branch starts from `release-1.2.1` (main after 1.2.0, with 1.1.3, CL2, CL2B, EF2 and WF1
merged). The plan: `.claude/plans/2026-10-21-master-plan.md` § Release 1.2.1.

**What was seen (2026-10-25, the 1.2.0 split review):**
- `plugin/workflows/review-split.js` refutes only the first `budget` distinct findings
  (`unique.slice(0, maxFindings)`) and **says nothing of the rest**: they reach neither the
  verified list nor the hunches. The cut is in track order (`pipeline` returns the tracks in
  order), not by severity, so one busy track can take every refuter and a critical finding of the
  last track is lost. `plugin/workflows/audit-run.js` ~76-78 has the same cut.
- The lead passed the arguments as one string (it started the workflow from its own listing,
  whose "Invoke" line passes the text it was given, not from the `review` skill, which already
  shows the object at `plugin/skills/review/SKILL.md` ~109-111); the script reads an object
  (`base`, `head`, `folder`, `tracks`, `risky`, `budget`, `intent`), so it ran one generic track on
  the ordinary tier (`sonnet` at `max`) instead of four risky tracks on `opus` at `xhigh`. Nothing
  said the arguments were ignored. The lead stopped it and relaunched.

## The change

1. **Rank before the cut:** the distinct findings are ordered by severity (the same ranking the
   verified list uses), then by track, before the budget picks which are refuted.
2. **Never drop one:** every finding past the budget is returned as **unchecked**, in its own
   section of the result, with its file, line, severity and title, so the caller sees it and can
   check it or run again. The summary line says how many were refuted and how many were not.
3. **The arguments:** a string, or an object with an unknown key or a wrong type, is refused at
   the start with one line that names the expected object, never run on defaults. (Find whether
   the Workflow tool passes a string through as-is: `args` is "exposed to the script as the global
   `args`, verbatim".) The `review` skill already shows the object; check that the `audit` skill
   (`plugin/skills/audit/SKILL.md`) does too, and add `folder` and `budget` to each example if
   they are missing.
4. **Both scripts the same way, one home where it fits:** a shared piece only if the workflow
   scripts can import one (find whether Claude Code allows imports in a workflow script); if not,
   keep each script self-contained and say why (`check:duplicates` reads workflow scripts too:
   the shared words must not repeat 12-word sentences).

## Files (change nothing else)

`plugin/workflows/review-split.js`, `plugin/workflows/audit-run.js`, their tests
(`src/workflows/*.test.ts`), `plugin/skills/review/SKILL.md`, `plugin/skills/audit/SKILL.md`,
`docs/design/instructions.md` (§ The shipped Workflows). **`plugin.json` stays as it is.** SW1 adds
a third workflow in the same folder: keep your change to these two.

## Setup in your worktree

Run `bun install` in your own worktree. Never link another checkout's `node_modules`. Never read
or run git in another worktree. Never start a Workflow run yourself; the tests run the scripts
with fakes.

## Done-check

1. Tests, each seen failing first: more findings than the budget (the most severe refuted, the
   rest returned unchecked); one track with many findings and a critical one in the last track
   (the critical one refuted); a string argument (refused, with the line); an unknown key
   (refused); the object (runs as today).
2. `bun run build`, then `bun run check` (duplicates included) and both
   `claude plugin validate … --strict`.
3. Your own review, then one second opinion: the `cc-smart-dev-kit:reviewer` agent on `sonnet` at
   `high`.
4. Commit a checkpoint after each green step. Never send an empty report.
5. Before you report, stop every background check you started.
