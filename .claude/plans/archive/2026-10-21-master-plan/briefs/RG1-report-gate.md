# RG1 — a red "done" report is refused, and a new question replaces the old one (1.2.1)

## Goal, and why

Your branch starts from `release-1.2.1` (main after 1.2.0, with 1.1.3, CL2, CL2B, EF2 and WF1
merged). The plan: `.claude/plans/2026-10-21-master-plan.md` § Release 1.2.1.

A lead's gate on a hand-back is mechanical (`plugin/skills/lead/SKILL.md` § 6): status `done`, the
whole suite and the checks green, the review recorded. The report command should hold the same
line, so a crew session cannot hand back `done` with red work. Two bugs, both seen live.

## Bug 1 — a "done" report with a failed suite or an empty review is recorded

- **What was seen (2026-10-25):** CL2B reported `done` while its own report said the full suite
  failed, and its review was empty. The lead ran the full check by hand on its branch (it was in
  fact green). Nothing in `crew report` stopped it.
- **Where:** `cc-smart-dev-kit crew report` (`src/crew/report.ts`): `doneReportGate` (~232) holds a
  done report only for open tasks (D23); `buildReport` and `reportFacts` build the report from
  the crew session's JSON part and the facts the store reads.
- **Fix:** a `done` report is refused, with one line that names what to do, when:
  1. a test run or a check it lists failed (the report's own words: find the fields in the report
     schema; never parse prose);
  2. the review is missing or empty: no reviewer recorded, or no finding list at all (an empty
     list of findings with a reviewer recorded is fine: a clean review);
  3. Decide, with a reason in your report, whether "the full suite never ran" is refused too.
- **Seen the other way too (2026-10-25):** RF2's `done` report had empty structured fields
  (`tests: {targeted: [], full: null}`, `checks: []`, `review: null`) while its prose summary said
  6,509 pass, 0 fail, both validates green, and an own review (its brief asked for no second
  opinion). Find why the fields were empty (the report's JSON part, its schema, the crew skill's
  words, `plugin/skills/crew/SKILL.md`) and fix that cause, so a green phase fills them and the
  gate above refuses only red or missing work. An own review counts as the review when the brief
  says no second opinion is needed; find how the report can say so.
  The refusal follows the existing `refusal(…)` shape: what is wrong, then the step. `blocked`,
  `failed` and `handoff` are never held (they carry red work on purpose).
- **Tests:** each refusal (failed suite, failed check, no review), a green done report passes,
  and `failed`/`handoff` with a red suite pass.

## Bug 2 — a crew session's new question leaves its own old one open

- **What was seen (2026-10-24):** a crew session asked a question, then asked a corrected question
  twice within 7 seconds. All stayed open on its record; the portal's Needs page showed two, and
  the lead had to pick.
- **Where:** `askQuestion` (`src/crew/report.ts`), the store's question list (`src/crew/store.ts`
  ~239-264, ~871, ~908; `openQuestionIndex`, `questionClosed`).
- **Fix:** a new question from a crew session while an older question of its own is still
  unanswered closes the older one as **superseded**: closed, with a pointer to the new one, never
  deleted. The lead and every reader (the watch's line, `crew list`, the portal's Needs) see only
  the newest open one. `crew answer` names the open question it answers; an answer to a
  superseded one is refused with the line that names the newest. Find every reader of the question
  list and keep one home for "is it open".
- **Tests:** two questions in a row (the first superseded, one open); an answer after the
  supersede goes to the newest; a question after an answered one stays a new question.

## Files (change nothing else)

`src/crew/report.ts`, `plugin/skills/crew/SKILL.md` (the report's words, if that is the cause), `src/crew/store.ts` (the question fields and their readers), `src/crew/answer.ts`
(only the superseded refusal), the readers of the question list you find (name each in your
report), their tests, `docs/design/crew.md`, `plugin/dist/*.js`. **`plugin.json` stays as it is.**
Other 1.2.1 phases change `answer.ts` (AN1) and `watch.ts` (WN1): keep your change in `answer.ts`
to the refusal.

## Setup in your worktree

Run `bun install` in your own worktree. Never link another checkout's `node_modules`. Never read
or run git in another worktree.

## Done-check

1. Each fix has a test, seen failing first.
2. `bun run build`, then `bun run check` and both `claude plugin validate … --strict`.
3. Your own review, then one second opinion: the `cc-smart-dev-kit:reviewer` agent on `sonnet` at
   `high`.
4. Commit a checkpoint after each green fix. Never send an empty report.
5. Before you report, stop every background check you started.
