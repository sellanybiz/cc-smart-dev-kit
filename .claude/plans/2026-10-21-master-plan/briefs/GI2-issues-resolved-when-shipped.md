# GI2 — GitHub Issues: marked fixed at the merge, closed by the release (1.3.0)

## Goal, and why

Your branch starts from `release-1.3.0` with GI1 merged (the switch, `issue file`, the labels, the
one `gh` runner, the redaction) and `release-1.2.1` merged at `15eb3e4` (IN1, RC1, UA1, SL1). The plan: `.claude/plans/2026-10-21-master-plan.md` § Release
1.3.0, row GI2, and decision D67. GI3 runs beside you; keep to your files.

**The owner's decision (D67):** "comments 'fixed on `<branch>` at `<commit>`' and labels
`fixed-unreleased` at a crew merge, and closes them with the release (its pull request lists
`Fixes #n`; GitHub closes an issue only when such a pull request merges into the default branch)."

**Today:** a crew merge is a local `git merge --no-ff` by the lead (`/cc-smart-dev-kit:lead` § 6),
seen by the watch (`src/crew/watch.ts`), or a `gh pr merge` the after-merge hook sees
(`src/hooks/after-merge.ts`). A fix merged into a release branch is not on the default branch, so
GitHub does not close its issue until the release's pull request merges.

## Research first

GitHub's closing keywords: which words, in a pull request's body or its commits, close which issue,
and only when the pull request merges into the **default** branch; whether a keyword in a commit
merged into a non-default branch closes anything (it must not, for this design). `gh issue comment`,
`gh issue edit --add-label`. Into `.claude/research/<date>-gi2-closing.md`, with links and the date.

## The change

1. **Which issues a phase fixes.** The crew report gains an `issues` field (the numbers the phase
   fixes; `src/crew/report.ts`, the schema and `crew report --issue <n>`), and the crew skill says when
   to fill it. GI3's `crew start --issue <n>` fills it by itself from the record: agree the field
   with GI3 (`cc-smart-dev-kit crew` tells, through the lead).
2. **At the merge**, once per issue, with the switch on: one comment through GI1's command side
   ("fixed on `<branch>` at `<short commit>`, merged into `<base>`; it closes when `<base>` ships") and
   the `fixed-unreleased` label. Find the one place a merge is known (the watch marking a crew session
   merged, the after-merge hook for a pull request) and put it there once, never twice for the same
   merge; a failure to reach GitHub is one line to the lead, never a failed merge, and it is tried
   again at the next watch pass (say how you remember what was done).
3. **The release closes them.** The `release` and `pull-request` skills
   (`plugin/skills/pull-request/SKILL.md`; the project's own `.claude/skills/release` is this repo's,
   not the plugin's: change only the plugin's, and name in your report the line this repo's release
   skill needs) list one `Fixes #<n>` line per open `fixed-unreleased` issue whose fix is in the pull
   request's commits. A command prints that list so a skill never builds it by hand:
   `cc-smart-dev-kit issue fixed --base <default> --head <branch>` (or your name for it).
4. **The lead files what it would lose.** `/cc-smart-dev-kit:lead` and the core instructions'
   "one line in your summary" for a bug outside the plan (`plugin/instructions/core.md` § Your role):
   with the switch on, the lead files it with `issue file` instead. `check:core-lines` must not grow
   past its budget: change the line, do not add one.
5. **The words:** `docs/design/issues.md` (the merge and the release), `README.md`, the skills above.

## Files (change nothing else)

`src/crew/report.ts`, `src/crew/watch.ts` (the merged mark only), `src/hooks/after-merge.ts` (only if
the merge is known there), `src/issues/**`, `src/entries/cli.ts`, `src/cli/help.ts`,
`plugin/skills/crew/SKILL.md`, `plugin/skills/lead/SKILL.md`, `plugin/skills/pull-request/SKILL.md`,
`plugin/instructions/core.md` (one line changed, none added), `docs/design/issues.md`, `README.md`,
`.claude/research/*`, their tests, `plugin/dist/*.js`, `CHANGELOG.md` (`## 1.3.0`). **`plugin.json`
stays as it is.**

## Setup in your worktree

Run `bun install` in your own worktree. Never link another checkout's `node_modules`. Never read or
run git in another worktree. Tests never touch the real `~/.claude`, `~/.config` or `~/.local`, and
never reach GitHub: GI1's fake `gh`.

## Done-check

1. Tests, each seen failing first: a merge with two issues (two comments, two labels), the same merge
   seen twice (once), the switch off (nothing), GitHub unreachable (one line, tried again, done once);
   `issue fixed` lists only the issues whose fix is in the range and that are still open; the report's
   `issues` field read and refused when not a number.
2. `bun run build`, then `bun run check` (core-lines and duplicates included) and both
   `claude plugin validate … --strict`.
3. Your own review, then one second opinion: the `cc-smart-dev-kit:reviewer` agent on `sonnet` at
   `high`.
4. Commit a checkpoint after each green step. Fill the report's JSON fields. Never send an empty
   report.
5. Before you report, stop every background check you started.
