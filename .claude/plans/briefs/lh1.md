# LH1 — a start waits for the CPU, a hand-off at a token cap, a crew session installs its own dependencies (1.2.1)

## Goal, and why

Your branch starts from `release-1.2.1` (main after 1.2.0, with 1.1.3, CL2, CL2B, EF2 and WF1
merged). The plan: `.claude/plans/2026-10-21-master-plan.md` § Release 1.2.1.

Three changes to how a crew session starts and hands off. Fix each at its cause, each with a test
seen failing first.

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

## 3. A hand-off at a token cap, beside the percent

- **The owner's concern (2026-10-25):** the owner set `crew.handoffPercent` to 40 in the personal
  file, so a crew session on Opus's 1M window hands off near 400k tokens (it matches the owner's
  own `/autocompact 400000`). But the hand-off is a percent of the window: 40 % of a 200k-window
  model is 80k, barely past a crew session's start-up reading.
- **Where:** `src/crew/self-watch.ts` computes `contextPercent` against the window that
  `context-window.ts` gives (find it); `crew.handoffPercent` in `src/workflow/schema.ts` and
  `resolve.ts`.
- **Fix:** an optional `crew.handoffTokens` (a whole number above zero, unset by default): a crew
  session hands off at whichever comes first, the percent or the token count. Measured where the
  percent is measured, never a second reader of the context. Where the frame or the crew skill
  tells a crew session when to hand off, it names both (find each place). `README.md` (the
  workflow fields) and `workflow show`.
- **Tests:** the cap reached before the percent (hand-off), the percent before the cap, the cap
  unset (today's behaviour), a 200k and a 1M window.

## Files (change nothing else)

`src/crew/places.ts`, `src/crew/start.ts` (the start gate only), `src/crew/brief.ts`,
`src/crew/self-watch.ts`, `src/workflow/schema.ts`, `src/workflow/resolve.ts`, `src/machine/` (the
load reading only), the crew skill's hand-off line if it names the percent
(`plugin/skills/crew/SKILL.md`), their tests, `README.md` (the new fields), `docs/design/crew.md`,
`plugin/dist/*.js`. **`plugin.json` stays as it is.** Other 1.2.1 phases change `start.ts` (NM1:
the continuation; WN1: the clash line): keep your change to the gate.

## Setup in your worktree

Run `bun install` in your own worktree. Never link another checkout's `node_modules`. Never read
or run git in another worktree.

## Done-check

1. Each fix has a test, seen failing first.
2. `bun run build`, then `bun run check` and both `claude plugin validate … --strict`.
3. Your own review, then one second opinion: the `cc-smart-dev-kit:reviewer` agent on `sonnet` at
   `high`.
4. Commit a checkpoint after each green fix. Never send an empty report.
5. Before you report, stop every background check and every load you started.
