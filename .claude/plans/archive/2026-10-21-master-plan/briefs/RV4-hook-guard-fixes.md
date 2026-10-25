# RV4 — the hook and guard fixes (the 1.2.0 split review's findings)

## Goal, and why

Your branch starts from `release-1.2.0`. The plan: `.claude/plans/2026-10-21-master-plan.md` §
Release 1.2.0 (its Close line). The owner chose a split review of all of 1.2.0 (four Opus `xhigh`
tracks, an Opus refuter per finding), because most of 1.2.0 was built by DeepSeek and Codex.
**Read first:** `.claude/research/2026-10-25-release-1.2.0-split-review.md` — each finding has its
trigger, its `file:line`, the outcome, the missing guard and a proposed fix. Verify each against
the code before you change it; the proposed fix is a starting point, not the rule.

## What to fix

- **The verified findings:** 3 (a plan-limit alert in a session that is off by its own project or launch says `gateway on`, `src/hooks/stop-failure.ts:559`; read the machine's state too, `gatewayOnOf`, and name the session's own switch), 7 (the `workflow propose` detector treats any computed program ending in `workflow` as a proposal, `src/hooks/bash-judge.ts:335`). Each gets the root fix and a test seen failing first.
- **The hunches of your area** (§ Hunches): every hunch under `src/hooks/`, `.claude/rules/hooks-guards.md` and `plugin/hooks/hooks.json` (lead-notes' events, `fable-session.ts:119`, `READ_ONLY_BUILT_INS`, the session-escape `KIT_WORD`, an unknown profile URL, the propose question's git calls against the hook's timeout, `crew-role.ts`'s name write and task-list gate). For each: prove it (a test that fails, or the
  real code path) and fix it, or say in the report why it does not hold. Never fix a hunch you
  could not prove; never leave one unanswered.

## Files

`src/hooks/stop-failure.ts`, `src/hooks/bash-judge.ts`, `src/hooks/fable-session.ts`, `src/hooks/agent-guard.ts`, `src/hooks/session-escape-guard.ts`, `src/hooks/crew-role.ts`, `src/hooks/lead-notes.ts`, `src/hooks/specs.ts`, `plugin/hooks/hooks.json`, `.claude/rules/hooks-guards.md` (only the rows a hunch proves wrong), `docs/design/hooks.md`, their tests, the docs that describe what you change (`docs/`, `README.md`), `CHANGELOG.md`
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
