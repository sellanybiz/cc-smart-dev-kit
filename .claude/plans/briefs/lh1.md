# LH1 — load: a start waits for the CPU, a crew session installs its own dependencies, three tests hold under load (1.2.1)

## Goal, and why

Your branch starts from `release-1.2.1` (main after 1.2.0, with 1.1.3, CL2, CL2B, EF2 and WF1
merged). The plan: `.claude/plans/2026-10-21-master-plan.md` § Release 1.2.1.

Three things go wrong when the machine is busy. Fix each at its cause, each with a test seen
failing first.

## 1. A crew start waits while the CPU is far past its cores

- **What was seen (2026-10-23):** a load of 85 on 16 cores with 24 crew sessions. The start gate
  checks only the free memory (`workflow.crew.memoryGb`).
- **Where:** `src/crew/places.ts` (the gate's parts, ~27, ~183, ~344), `src/crew/start.ts` (~1148,
  ~1301: where the gate is read), `src/workflow/schema.ts` and `src/workflow/resolve.ts` (how
  `crew.memoryGb` is a setting), `src/machine/` (`Machine`, so the reading is faked in tests).
- **Fix:** a new setting, `crew.loadPerCore` (a number above zero; pick the default and say why,
  for example 3): a start and the queue hold while the 1-minute load average is above
  `loadPerCore × cores`, with a `queued` reason that says the load and the limit, like the memory
  hold. Where the platform gives no load average (native Windows), the hold does not apply, and
  `crew list` says so once, as the usage hold does with no reading. One reader of the load, faked
  through `Machine`. The setting in `README.md` (the workflow fields) and `workflow show`.
- **Tests:** a load above the limit (queued, with the reason); below (started); no reading (not
  held, said once); the setting resolved from the project and the personal file.

## 2. A crew session installs its own dependencies

- **What was seen (2026-10-23, twice):** a crew session linked its worktree's `node_modules` to the
  main checkout's, then undid it with `rm node_modules && bun install`, which Claude Code asks the
  person about (the path resolves outside the worktree).
- **Where:** `briefFrame` (`src/crew/brief.ts` ~84), the frame every crew brief gets.
- **Fix:** the frame says, as its setup step: install the project's dependencies in your own
  worktree first; never link another checkout's dependency folder. Name the project's install
  command when the project gives one (find whether `.claude/cc-smart-dev-kit.json` or the jobs config
  names one; never write a tool's name the project did not give). The words stay neutral: the
  frame works for any project.
- **Tests:** the frame holds the step; with a project's install command, it names it.

## 3. Three tests fail only under load

Each passes alone and fails in a full check on a busy machine:

- `src/portal/server.test.ts` › every answer › "a key is never sent to a page" (~725): past 5 s.
- `src/jobs/launch.test.ts` › spawnAndWait: real children › "a job that died of the signal it was
  sent, and left a process behind: both facts" (~395): counted one process more under load ~85.
- `src/crew/end.test.ts` › "D42: crew resume --paused" (~1631, two tests): `git add`/`commit` in the
  setup failed and the test timed out at 5 s.

Find each cause. A limit that fits the work (a test's own timeout, with a comment saying why) is
fine; a wait that dodges a race is not (find the race). The process count must count only the
test's own children. Never skip or weaken a test (`.claude/rules/testing.md`).

## Files (change nothing else)

`src/crew/places.ts`, `src/crew/start.ts` (the start gate only), `src/crew/brief.ts`,
`src/workflow/schema.ts`, `src/workflow/resolve.ts`, `src/machine/` (the load reading only), the
three test files above, their own tests, `README.md` (the new field), `docs/design/crew.md`,
`plugin/dist/*.js`. **`plugin.json` stays as it is.** Other 1.2.1 phases change `start.ts` (NM1:
the continuation; WN1: the clash line): keep your change to the gate.

## Setup in your worktree

Run `bun install` in your own worktree. Never link another checkout's `node_modules`. Never read
or run git in another worktree.

## Done-check

1. Each fix has a test, seen failing first (for the three tests: say how you reproduced each
   failure, for example under a CPU load you made in your worktree, and stop that load after).
2. `bun run build`, then `bun run check` and both `claude plugin validate … --strict`.
3. Your own review, then one second opinion: the `cc-smart-dev-kit:reviewer` agent on `opus` at
   `xhigh`.
4. Commit a checkpoint after each green fix. Never send an empty report.
5. Before you report, stop every background check and every load you started.
