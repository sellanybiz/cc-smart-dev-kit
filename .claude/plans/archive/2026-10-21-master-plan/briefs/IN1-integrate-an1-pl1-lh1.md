# IN1 — join AN1, PL1 and LH1 onto release-1.2.1 (1.2.1)

## Goal, and why

Your branch starts from `release-1.2.1` with these merged: WN1, RG1, MC1, NM1, JW1, RS1, SW1,
LT1 (and before them CL2B, EF2, WF1, AR1). The plan: `.claude/plans/2026-10-21-master-plan.md`
§ Release 1.2.1.

Three finished phases could not be merged by the lead, because they change the same crew code
as phases merged before them, and a text merge would lose meaning. Each was built and reviewed
on its own; your job is to bring all three into one branch so that **every phase's behaviour
holds together**, then prove it.

Merge each branch into yours, in this order, and resolve each conflict by the intent of both
sides (never by taking one side whole):

1. `crew/AN1-answer-delivers` (conflicts: `src/crew/answer.ts`, `src/crew/store.ts`). RG1 added
   `supersededBy` on a question (a newer question replaced it while it had no answer: an answer to
   it is refused and names the newest). AN1 added `deliveredAt` and `superseded` (a second answer
   to the newest answered question is a correction; the first is kept) and the self-watch
   delivery. Both must hold: an answer to a superseded question is refused (RG1); a correction to
   the newest answered question works (AN1); self-watch never delivers an answer to a superseded
   question, and delivers a correction once.
2. `crew/PL1-plan-folder-runs` (conflicts: `src/crew/start.ts`, `src/crew/store.ts`). PL1 adds the
   lead record's `planFile`, the plan folder's default brief, and the run record written through
   the store's one writer. NM1 changed `start.ts` (a continuation keeps its start commit) and RG1
   and AN1 changed the store. Then do what PL1's report asks of MC1: when MC1 changes a running
   crew session's model or effort, it calls `noteCrewRun(stateDir, repo, crewId, atMs, { by,
   detail: { from, to }, text })` (PL1's `src/crew/store.ts`), with a test.
3. `crew/LH1-load-and-install` (conflicts: `src/crew/places.ts`, `src/crew/start.ts`,
   `src/crew/start.test.ts`). LH1 adds the load hold (`crew.loadPerCore`, `src/machine/load.ts`,
   `CrewContext.load`) beside the caps; MC1's cap check for a model change and NM1's start changes
   must keep working with it.

Read each phase's report before you resolve its conflict (its decisions and open items):
`~/.claude/cc-smart-dev-kit/crew/575f8abaf00a19c7/reports/` — `AN1-answer-delivers-09e79d.json`,
`PL1-plan-folder-runs-0c9782.json`, `LH1-load-and-install-d37a36.json`, `RG1-report-gate-d47ed4.json`,
`MC1-crew-model-change-e6fc97.json`, `NM1-names-and-bases-3adb3f.json`. A report's `summary` holds
its prose.

## Files

Only what the three merges and their conflicts touch, and MC1's one `noteCrewRun` call with its
test. **Change no behaviour beyond what the six phases built**; a defect you find in one of them
is one line in your report, not a fix, unless the merge itself causes it. `CHANGELOG.md` and
`plugin.json` stay as they are (the lead writes the changelog). Rebuild `plugin/dist` after each
merge (`bun run build`), never by hand.

## Setup in your worktree

Run `bun install` in your own worktree. Never link another checkout's `node_modules`. Never read
or run git in another worktree (merging the three crew branches by name into yours is fine). Tests
never touch the real `~/.claude`, `~/.config` or `~/.local`.

## Done-check

1. After each merge: `bun run typecheck`, then the tests of the files it touched
   (`src/crew/answer*`, `store*`, `self-watch*`, `start*`, `places*`, `runs*`, `model*`, …), all
   green. One commit per merge.
2. New tests, each seen failing first, for each place both sides meet: a superseded question's
   answer refused while a correction to the newest works; self-watch skipping a superseded
   question; a run record of a continuation that kept its start commit; the run record's line for
   a model change; a model change held by the load (or not, with the reason).
3. `bun run build`, then `bun run check` and both `claude plugin validate … --strict`. The machine
   may be loaded: a test that times out once is run alone before you judge it.
4. Your own review of the three merge commits' resolutions, then one second opinion: the
   `cc-smart-dev-kit:reviewer` agent on `sonnet` at `high`, on the merge resolutions only
   (`git diff` of each merge against both its parents).
5. Fill the report's fields (tests, checks, review). Never send an empty report. Stop every
   background check you started.
