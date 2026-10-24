# LT1 — three tests that fail only under load (1.2.1)

## Goal, and why

Your branch starts from `release-1.2.1` (main after 1.2.0, with 1.1.3, CL2, CL2B, EF2 and WF1
merged). The plan: `.claude/plans/2026-10-21-master-plan.md` § Release 1.2.1.

A full check on a busy machine (many crew sessions at once) fails on tests that pass alone. Each
false red costs a lead a re-run, and teaches everyone to distrust a red suite. Each passes alone
and fails in a full check under load:

- `src/portal/server.test.ts` › every answer › "a key is never sent to a page" (~725): past 5 s,
  in two full checks under load.
- `src/jobs/launch.test.ts` › spawnAndWait: real children › "a job that died of the signal it was
  sent, and left a process behind: both facts" (~395): counted one process more under a load of
  about 85.
- `src/crew/end.test.ts` › "D42: crew resume --paused" (~1631, two tests): `git add`/`commit` in the
  setup failed and the test timed out at 5 s (1.2.0 after EF1, 2026-10-25).

## The change

Find each cause first, and say it in the report. A limit that fits the work (the test's own
timeout, with a comment saying why) is fine. A wait that dodges a race is not: find the race. The
process count must count only the test's own children, never another process on the machine. A
git setup that fails must fail with git's own message, not a timeout. Never skip or weaken a test
(`.claude/rules/testing.md`: every test can fail). If a cause is in the code under test, not in
the test, fix the code and say so.

## Files (change nothing else)

The three test files above, the code under test only where the cause is there (name it in your
report), `src/testing/` (only a shared helper the fix needs: one home).
**`plugin.json` stays as it is.**

## Setup in your worktree

Run `bun install` in your own worktree. Never link another checkout's `node_modules`. Never read
or run git in another worktree. Tests never touch the real `~/.claude`, `~/.config` or `~/.local`,
nor port 20100.

## Done-check

1. Reproduce each failure first, under a CPU load you make in your worktree (say how), and stop
   that load after. Then each fix, seen green under the same load.
2. `bun run build` (if code changed), then `bun run check` and both
   `claude plugin validate … --strict`.
3. Your own review, then one second opinion: the `cc-smart-dev-kit:reviewer` agent on `opus` at
   `xhigh`.
4. Commit a checkpoint after each green fix. Never send an empty report.
5. Before you report, stop every background check and every load you started.
