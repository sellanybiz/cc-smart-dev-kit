# NM1 — a continuation keeps its branch, and a name means the record that is live (1.2.1)

## Goal, and why

Your branch starts from `release-1.2.1` (main after 1.2.0, with 1.1.3, CL2, CL2B, EF2 and WF1
merged). The plan: `.claude/plans/2026-10-21-master-plan.md` § Release 1.2.1.

`crew start <phase> --continue <name>` starts a new crew session from a handed-off one's head
(`plugin/skills/lead/SKILL.md` § 8). Two bugs make it fail or name itself wrong. Fix each at its
cause, each with a test seen failing first.

## Bug 1 — `crew rm` deletes the branch a queued continuation starts from

- **What was seen (2026-10-23):** PW1a handed off. The lead merged it and ran `crew rm` on the old
  record. The queued `PW1a 2` (from `crew start --continue`) had `baseRef
  crew/PW1a-workflow-propose`, which `crew rm` had deleted, so it would have failed at its start.
  The lead recreated the branch by hand.
- **Where:** `src/crew/remove.ts` (what `crew rm` takes away), `src/crew/start.ts` (~500-530, the
  continuation: how it stores its base).
- **Fix:** the root fix, not both: either the continuation stores the commit it starts from (a
  sha that never moves), so its base cannot be deleted from under it; or `crew rm` keeps a
  branch while a queued or running record names it as its base, and says so. Pick one, with the
  reason in your report; the sha is the likely root fix (it also survives a branch reset). A
  record already in the store with only a branch name must still start.
- **Tests:** rm of a handed-off record while its continuation is queued, then the continuation
  starts; a record from before the change.

## Bug 2 — a name shared with removed records, and the continuation's number

- **What was seen (2026-10-24):** CL1 was removed and started again four times before it began
  (to change its brief). Then `crew start CL1 --continue "C … CL1 crew-cleanup"` picked a removed
  record ("is removed, and only a crew session that handed off can be continued") while the live
  record had handed off; its id worked. The continuation was named "… CL1 crew-cleanup 6",
  counting the removed records that never started.
- **Where:** `findNamed` (`src/crew/board.ts` ~140-172) already prefers the one live record over
  removed ones. Find why the continuation's lookup did not reach it (another finder, or the
  live test), and how the continuation's number is counted (`src/crew/start.ts`).
- **Fix:** every lookup by name goes through `findNamed` (one finder); a handed-off record counts
  as live. The continuation's number counts the phase's real hand-offs only (records that
  started and handed off), never a record removed before it started.
- **Tests:** the case above (four removed, one handed off: the name means the handed-off one, the
  continuation is " 2"); two live records of one name still ask for an id.

## Files (change nothing else)

`src/crew/remove.ts`, `src/crew/start.ts` (the continuation only), `src/crew/board.ts`,
`src/crew/store.ts` (only if the base sha needs a field), their tests, `docs/design/crew.md`,
`plugin/dist/*.js`. **`plugin.json` stays as it is.** Another 1.2.1 phase (LH1) changes the start
gate in `start.ts`: keep your change to the continuation.

## Setup in your worktree

Run `bun install` in your own worktree. Never link another checkout's `node_modules`. Never read
or run git in another worktree.

## Done-check

1. Each fix has a test, seen failing first.
2. `bun run build`, then `bun run check` and both `claude plugin validate … --strict`.
3. Your own review, then one second opinion: the `cc-smart-dev-kit:reviewer` agent on `opus` at
   `xhigh`.
4. Commit a checkpoint after each green fix. Never send an empty report.
5. Before you report, stop every background check you started.
