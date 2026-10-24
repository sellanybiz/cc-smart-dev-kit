# RV5 — the portal fixes (the 1.2.0 split review's findings)

## Goal, and why

Your branch starts from `release-1.2.0`. The plan: `.claude/plans/2026-10-21-master-plan.md` §
Release 1.2.0 (its Close line). The owner chose a split review of all of 1.2.0 (four Opus `xhigh`
tracks, an Opus refuter per finding), because most of 1.2.0 was built by DeepSeek and Codex.
**Read first:** `.claude/research/2026-10-25-release-1.2.0-split-review.md` — each finding has its
trigger, its `file:line`, the outcome, the missing guard and a proposed fix. Verify each against
the code before you change it; the proposed fix is a starting point, not the rule.

## What to fix

- **The verified findings:** 4 (`project.workflow.propose` falls back to the portal's own folder when the POST names no project, `src/portal/actions.ts:922`), 5 (the new read `/api/projects/<id>/workflow` is missing from the "a key is never sent to a page" test, `src/portal/server.test.ts:902`). Each gets the root fix and a test seen failing first.
- **The hunches of your area** (§ Hunches): every hunch under `src/portal/` and `portal/` (the action button and the Gateway card's Apply, the refresh on every crew event, `workflowValueText` against the CLI's `showValue`, `ghLoginOf`'s 60 s cache). For each: prove it (a test that fails, or the
  real code path) and fix it, or say in the report why it does not hold. Never fix a hunch you
  could not prove; never leave one unanswered.
- Read `.claude/rules/portal.md` (the door) first. A UI change that is more than words or a bug fix (a new layout or component) is not yours: say so in the report.

## Files

`src/portal/actions.ts`, `src/portal/server.test.ts`, `src/portal/api/*.ts`, `portal/src/**` (not `portal/src/lib/gateway.ts`: GF1 changes it), `plugin/portal-ui/**` (rebuilt by `bun run build:portal`, never by hand; run `bun install` in `portal/` too, then `bun run check:portal`), their tests, the docs that describe what you change (`docs/`, `README.md`), `CHANGELOG.md`
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
