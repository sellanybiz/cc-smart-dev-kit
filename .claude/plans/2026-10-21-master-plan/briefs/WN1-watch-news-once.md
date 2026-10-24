# WN1 — the lead hears each thing once: quiet, a clash, the leads after a merge (1.2.1)

## Goal, and why

Your branch starts from `release-1.2.1` (main after 1.2.0, with 1.1.3, CL2, CL2B, EF2 and WF1
merged). The plan: `.claude/plans/2026-10-21-master-plan.md` § Release 1.2.1.

Each line the watch prints is a notification to the lead, and each one costs the lead a turn.
Three lines repeat what the lead already knows. Fix each at its cause, each with a test seen
failing first.

## Bug 1 — "quiet" is said every minute

- **What was seen (2026-10-24):** one watch process (no restart) printed "LR1 lean-lead: quiet —
  nothing written for 20/21/22 minutes", one line a minute. Leads now filter it in their own
  monitor command (the handover of 2026-10-25 carries a shell filter for it).
- **Where:** `src/crew/watch.ts` ~313-316: the minutes are part of the line, so the watch's "said
  once" map (by text) never matches.
- **Fix:** say "quiet" once when a quiet stretch starts, and again only at a much longer step
  (pick one, for example at 3× `crew.quietMinutes`, and say why), until the crew session writes
  again; then a new stretch may be said. Keep the state where the watch keeps its other "said"
  marks (WF1 made one watch per lead hold the state file).
- **Tests:** a quiet stretch over many passes (one line, then one at the long step); a write ends
  the stretch; a second stretch is said.

## Bug 2 — a clash pair is said on every start

- **What was seen:** in another repository, the clash line repeated for the same pair of phases
  each time another crew session started: 17 lines in an hour. A broad `--files` glob
  (`docs/claude/**/*.md`) matched almost everything.
- **Where:** `clashLine` (`src/crew/start.ts` ~1024), `src/workflow/clashes.ts` (`clashNote` ~78),
  and the watch's clash lines.
- **Fix:** each pair of crew sessions is said once (per pair, both directions), for its whole life;
  a new pair is said. At `crew start`, a glob that matches far more files than the phase can mean
  (decide the measure: for example a share of the tracked files) gets one warning line that names
  the glob. Never a refusal.
- **Tests:** three starts that clash with one session (one line per pair); a new pair; the broad
  glob warning, and a narrow glob with none.

## Bug 3 — the after-merge note names the merging lead as "the other leads", twice

- **What was seen:** after #23 merged, the after-merge hook listed "LEAD cc-smart-dev master-plan,
  LEAD cc-smart-dev master-plan" as the other leads: the merging session itself, from two lead
  records (before and after its restart).
- **Where:** `src/hooks/after-merge.ts` ~1705-1730 (`leadsOf`, `mergedBy`, `tellSessionsNote`
  ~1520-1540).
- **Fix:** the note leaves out the merging session, and a lead record of the same session before a
  restart (find how a lead's restart is recorded; never by name alone, since two leads may share
  a name in different sessions). Names are said once each.
- **Tests:** a merge by a restarted lead (no self in the list); two real other leads (both named,
  once each); no other lead ("none").

## Files (change nothing else)

`src/crew/watch.ts`, `src/crew/start.ts` (the clash line only), `src/workflow/clashes.ts`,
`src/hooks/after-merge.ts` (the lead list only), their tests, `docs/design/crew.md`,
`plugin/dist/*.js`. **`plugin.json` stays as it is.** Other 1.2.1 phases change `start.ts` (NM1:
the continuation; LH1: the start gate): keep your change to the clash line.

## Setup in your worktree

Run `bun install` in your own worktree. Never link another checkout's `node_modules`. Never read
or run git in another worktree. Read `.claude/rules/hooks.md` before you touch the hook.

## Done-check

1. Each fix has a test, seen failing first.
2. `bun run build`, then `bun run check` and both `claude plugin validate … --strict`.
3. Your own review, then one second opinion: the `cc-smart-dev-kit:reviewer` agent on `sonnet` at
   `high`.
4. Commit a checkpoint after each green fix. Never send an empty report.
5. Before you report, stop every background check you started.

## Also (from WF1's hand-back, 2026-10-25)

`plugin/skills/lead/SKILL.md`, the table of lines a lead without monitors sees: add "a newer watch
of this lead runs: nothing to do, start no other `--once`". WF1 made one acting watch per lead (a
lease, the newest wins), so a second `--once` takes the lease from the first, and the first's exit
would otherwise start another one. Add the skill to your files.

## Also (the owner, 2026-10-25) — a "needs you" that ends is never said

`crewAlert` (`src/crew/watch.ts` ~255-296) says `<name>: needs you — <what it waits on>` once while
a permission prompt lasts, and nothing when the person answers it. So the lead keeps the stale
"needs you" and repeats it to the person, who already answered (seen with RV6: answered, still
named as waiting). When a crew session's wait ends (agent view no longer says `blocked` or
`waiting`, and the record is still at work), say it once: `<name>: going again — the wait is
answered`. The same for the lead skill's table of lines (`plugin/skills/lead/SKILL.md` § 4: the
person answered it; nothing to do). Test, seen failing first: a wait, then its end (said once), then
nothing more while it works.
