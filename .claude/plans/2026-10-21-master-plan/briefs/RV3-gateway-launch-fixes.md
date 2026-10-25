# RV3 — the gateway and launch fixes (the 1.2.0 split review's findings)

## Goal, and why

Your branch starts from `release-1.2.0`. The plan: `.claude/plans/2026-10-21-master-plan.md` §
Release 1.2.0 (its Close line). The owner chose a split review of all of 1.2.0 (four Opus `xhigh`
tracks, an Opus refuter per finding), because most of 1.2.0 was built by DeepSeek and Codex.
**Read first:** `.claude/research/2026-10-25-release-1.2.0-split-review.md` — each finding has its
trigger, its `file:line`, the outcome, the missing guard and a proposed fix. Verify each against
the code before you change it; the proposed fix is a starting point, not the rule.

## What to fix

- **The verified findings:** 1 (`launch --gateway` on a router that does not answer, `src/cli/launch.ts:232`), 2 (a 1.2.0 config the running 1.1.x router refuses: an alias to a Claude-mode slot, `src/gateway/config.ts:543`; the router has no version, so a feature in `ROUTER_FEATURES`, or the router's last config-load error in its health answer — pick the root fix, say why), 6 (a profile's breaker hint names a key that may not exist, `src/gateway/breaker.ts:126`). Each gets the root fix and a test seen failing first.
- **The hunches of your area** (§ Hunches): every hunch under `src/gateway/`, `src/omniroute/`, `src/cli/launch.ts`, `src/cli/statusline.ts`, and `src/crew/start.ts:219` / `src/crew/usage-guard.ts:45` (the machine's view vs the project's URL), `src/crew/wait.ts:280,375` (a profile's breaker key). For each: prove it (a test that fails, or the
  real code path) and fix it, or say in the report why it does not hold. Never fix a hunch you
  could not prove; never leave one unanswered.
- **GF1 runs beside you** on `commands-project.ts`, `project-state.ts`, `doctor.ts` and restore: do not touch those.

## Files

`src/cli/launch.ts`, `src/gateway/config.ts`, `src/gateway/commands.ts` (the slot change only), `src/gateway/router.ts` (the feature list or the health answer, and a hunch you prove; `router.js` then changes: say so in the report and in `CHANGELOG.md`), `src/gateway/health.ts`, `src/gateway/breaker.ts`, `src/gateway/prices.ts`, `src/gateway/history.ts`, `src/gateway/commands-profile.ts`, `src/cli/statusline.ts`, `src/crew/start.ts`, `src/crew/usage-guard.ts` and `src/crew/wait.ts` (the gateway view only; 1.2.1's WF1 also changes `wait.ts`, so keep it small), `src/portal/actions.ts` (only the slot action's refusal), their tests, the docs that describe what you change (`docs/`, `README.md`), `CHANGELOG.md`
(`## 1.2.0`: one plain bullet per user-visible fix), `plugin/dist/*.js`. Change nothing else;
name each file outside this list in your report, with why. **`plugin.json` stays 1.2.0.** Read the
rules that load for your files (`.claude/CLAUDE.md` § Rules) before you change them.

## Setup in your worktree

Run `bun install` in your own worktree. Never link another checkout's `node_modules`. Never read
or run git in another worktree. Tests never touch the real `~/.claude`, `~/.config` or `~/.local`,
nor port 20100. Never run `gateway` commands that change this machine.

## Done-check

1. Each fix has a test, seen failing first.
2. `bun run build`, then `bun run check` and both `claude plugin validate … --strict`.
3. Your own review, then one second opinion: the `cc-smart-dev-kit:reviewer` agent on `opus` at
   `xhigh` (the owner's choice for 1.2.0's fixes).
4. Fill the report's JSON fields (tests, checks, review), not only the prose summary.
5. Commit a checkpoint after each green fix. Never send an empty report. Stop every background
   check you started.
