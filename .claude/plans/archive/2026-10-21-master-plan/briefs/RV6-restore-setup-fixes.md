# RV6 — the restore and setup fixes (the 1.2.0 split review's findings)

## Goal, and why

Your branch starts from `release-1.2.0`. The plan: `.claude/plans/2026-10-21-master-plan.md` §
Release 1.2.0 (its Close line). The owner chose a split review of all of 1.2.0 (four Opus `xhigh`
tracks, an Opus refuter per finding), because most of 1.2.0 was built by DeepSeek and Codex.
**Read first:** `.claude/research/2026-10-25-release-1.2.0-split-review.md` — each finding has its
trigger, its `file:line`, the outcome, the missing guard and a proposed fix. Verify each against
the code before you change it; the proposed fix is a starting point, not the rule.

## What to fix

- **The verified findings:** 8 (restore reports a taken-over value it writes back as a "written instead" key, so the file stays tracked and the line says `set X to …`, `src/setup/restore.ts:134`). Each gets the root fix and a test seen failing first.
- **The hunches of your area** (§ Hunches): every hunch under `src/cli/restore.ts`, `src/setup/` and `src/machine/claude-mem-choices.ts` (`stageOneDone` with `fileUsesRouter`'s null URL, stage 1 over every json-keys file, a taken-over secret replaced through the portal, `managed-json.ts:576`'s `remove` with `was`). For each: prove it (a test that fails, or the
  real code path) and fix it, or say in the report why it does not hold. Never fix a hunch you
  could not prove; never leave one unanswered.
- **You start after GF1 is merged** (it changes restore for P6 and P7): build on its code. Read `.claude/rules/setup-and-managed-files.md` whole first: every change to a person's file goes through `src/setup/`, and never take what is not ours.

## Files

`src/setup/restore.ts`, `src/setup/managed-json.ts`, `src/cli/restore.ts`, `src/machine/claude-mem-choices.ts`, their tests, the docs that describe what you change (`docs/`, `README.md`), `CHANGELOG.md`
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
