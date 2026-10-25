# CU1 — move the tested Claude Code from 2.1.308 to 2.1.310

Your branch starts from `release-1.4.1`. Follow the repo's `claude-code-upgrade` skill
(`.claude/skills/claude-code-upgrade/SKILL.md`) step by step; this brief only adds what is
known. The plan: `.claude/plans/2026-10-21-master-plan.md`, § For the owner in the morning, item 10.

## Why

`.claude-code-version` says 2.1.308. This machine runs 2.1.310, the newest on npm (checked
2026-10-25). CI's validates and the weekly job judge the plugin against the version in that
file, so CI is two releases behind what people run.

## What is known

- **Installed here: 2.1.310.** Do not update or reinstall Claude Code on this machine.
- **Some contract rows were already proved on 2.1.309 or 2.1.310** while 1.3.0 and 1.4.0 were
  built (`grep -n "2\.1\.31\?[09]" docs/claude-code-contract.md`). Do not prove those again;
  walk the rest.
- **Open issue #15** ("Claude Code 2.1.303: all checks pass", from the weekly job) is stale: the
  tested version moved past it. The lead closes it from the pull request with `Fixes #15`; you
  do not touch GitHub issues.
- `cc-smart-dev-kit doctor --live` may run: it starts throwaway sessions in a temp folder and
  costs a few cents. A live row it does not reach and that only a person can prove: list it in
  your report's `needsLead` with the exact steps, never claim it.

## What to build

1. The skill's steps 1–4: the changelog for 2.1.309 and 2.1.310 (both), the contract walk, the
   checks, `doctor --live`.
2. **If the changelog or a check shows a change the plugin must follow:** stop and ask the lead
   before you touch `src/` or `plugin/`, with the change, the row, and the fix you propose. A
   plugin fix needs a version bump, and the lead decides which release takes it.
3. **If nothing needs a fix:** step 6's items 1 and 2 — `.claude-code-version` to `2.1.310`, and
   "Last proved on" for each row you proved again. Add one bullet to `CHANGELOG.md`'s `## 1.4.1`
   section: the tested Claude Code is now 2.1.310 (and what changed in the contract, if anything).
4. Your report says, per changelog entry that touches a contract area, which row it touches and
   how you judged it (proved, not affected, needs the person).

## Files

`.claude-code-version`, `docs/claude-code-contract.md`, `CHANGELOG.md` (one bullet in `## 1.4.1`
only). Change nothing else without the lead's answer. The lead owns `plugin/.claude-plugin/plugin.json`,
the installers' version lines and the CHANGELOG's headings.

## Done-check

`bun run check`, both `claude plugin validate … --strict`, `cc-smart-dev-kit doctor --live` (its
real output in the report). Your own review, then one second opinion
(`cc-smart-dev-kit:reviewer`, `sonnet`, `high`). Tests never touch the real `~/.claude`,
`~/.config`, `~/.local`, nor port 20100. Neutral: no names of a company, person or machine.
