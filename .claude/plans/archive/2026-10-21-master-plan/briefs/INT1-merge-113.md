# INT1 — bring 1.1.2 and 1.1.3 into release-1.2.0 (the merge)

## Goal, and why

`release-1.2.0` was cut before 1.1.2 and 1.1.3. Both patch releases changed parts that 1.2.0 also
changed:
- **1.1.2:** FU3 (the launch line and agent-message hand-backs are never "the person wrote") and FU4
  (crew names carry the lead's plan).
- **1.1.3:** TL1 (to-do lists), QB1 (no building subagent around the queue), LR1 (the lean lead),
  RV2 (the 1.1.2 review's fixes, and the watch reads the caps every pass), JQ1 (a heavy job's start
  and end lines), and PC1 (the portal's usage and cost numbers).

1.2.0 must carry all of it before it ships. Your branch is cut from `release-1.2.0`. In it, run
`git merge --no-ff release-1.1.3` (that branch already holds `main`'s 1.1.2), resolve every conflict,
and hand back a branch the lead merges without conflicts.

A trial merge on 2026-10-24 conflicted in 63 files:
- 49 built files under `plugin/dist/` and `plugin/portal-ui/`;
- 14 sources and docs: `CHANGELOG.md`, `README.md`, `docs/claude-code-contract.md`,
  `docs/design/crew.md`, `docs/design/hooks.md`, `src/cli/hook-commands.test.ts`,
  `src/crew/end.test.ts`, `src/crew/names.ts`, `src/crew/start.test.ts`,
  `src/gateway/history.test.ts`, `src/hooks/agent-guard.ts`, `src/hooks/crew-role.ts`,
  `src/hooks/session-name.ts`, `src/portal/api/data.test.ts`.

## How to resolve

1. **Keep both sides' intent, every time.** Each side's change was reviewed on its own. Read both
   commits behind each hunk (`git log --merge -p -- <file>`), and write the code that does both.
   Never pick one side just to make a conflict go away.
2. **Known moves on the 1.2.0 side:**
   - GP4a moved `familyEnv()` out of `src/models/launch-policy.ts`. A 1.1.3 call site follows it to
     its new home.
   - MS1 added the claude-mem take-over to `restore`, and GP5 made `restore` write Anthropic's own
     address. Both are already combined on 1.2.0.
   - PW1a's crew-session deny for `workflow propose` lives in `bash-judge.ts`.
3. **Known moves on the 1.1.3 side:**
   - FU4's `crewName(tag, plan, phase, slug)`, and RV2's name-collision check in `start.ts`.
   - FU3's `isPersonPrompt`.
   - TL1's task gate in `crew-role.ts`.
   - QB1's D59 rule in `agent-guard.ts`.
   - RV2's crew-session title, set back in `crew-role.ts` or `session-name.ts`.
4. **`CHANGELOG.md`:** keep 1.2.0's section on top, then `## 1.1.3`, then `## 1.1.2`, each with its own
   bullets, newest first. Drop a duplicate bullet only when both say the same thing.
5. **Built files:** never resolve them by hand. Take either side, then `bun run build` and
   `bun run build:portal` rebuild them. Run `bun install` at the worktree root and in `portal/`, in
   your own worktree. Never link another checkout's `node_modules`.
6. **After the merge:** `bun run check`, `bun run check:portal`, and `git diff --stat
   release-1.2.0 -- plugin/dist/router.js`. `router.js` changes, from PC1's price and usage fixes;
   say so in your report.

## Files

Any file the merge conflicts in, and only what a resolution needs. Add no new behaviour. If a
resolution needs a real design choice (the two sides want different things), ask the lead. Never
choose alone.

## Done-check

1. The merge commit, with no conflict markers anywhere (`git grep -nE '^(<<<<<<<|>>>>>>>)'`).
2. `bun run check` green. Under load, a test with a time limit may fail only because of the load:
   run that file alone with `--timeout 60000`, and say so.
3. `bun run check:portal` green.
4. Your review of the merge: each conflicted hunk, and both sides' intent kept. Then your report.
