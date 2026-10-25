# FU3 — a crew session's own first prompt is not the person's (1.1.2)

## Goal, and why

1.1.0's CC7 (D55) tells the lead when the person types into a crew session: the `crew-role`
hook's UserPromptSubmit part (`src/hooks/crew-role.ts`, `isPersonPrompt` around line 143,
`personPromptAnswer` around line 399) records one `person` event, the lead's watch prints
"<name>: the person wrote · … · read its next report against the brief before the merge", and the
crew session itself gets the line that the person's word wins over its brief.

**Bug, seen live on 1.1.1:** every crew session's FIRST prompt — the launch line `crew start` gives
it, `firstPrompt` in `src/crew/brief.ts` (around line 111): "You are the crew session <name> for
the lead <lead>. Work by /<crew skill>. Read <brief file> first: …" — is taken for the person's
words, because `isPersonPrompt` knows the lead's other prompts (the wrappers, the Stop block, an
answer resume, a wait-over resume) but not this one. So every start makes a false "the person
wrote" line for the lead, a false `person` event in the store (the portal shows it), and a false
"the person's word wins" note in the crew session. It never showed in 1.1.0 because those crew
sessions ran without the kit (LS1, fixed in 1.1.1).

## The fix

- `isPersonPrompt` returns false for the launch line of THIS record: compare with what
  `firstPrompt` builds for the record's own name, lead name and brief file (export what is needed
  from `src/crew/brief.ts`; one home for the text — never a copy of the sentence in the hook).
  Compare with one trailing line end dropped, as `isAnswerResume` does.
- The same for a hand-off continuation's first prompt (`crew start --continue`, its ` 2` name) if
  it starts differently: find every prompt `crew start` and `crew resume` give (`src/crew/start.ts`,
  `src/crew/answer.ts`, `src/crew/brief.ts`) and make sure each is the lead's, never the person's.
- The person's real words still count: a prompt that only CONTAINS the launch sentence, or another
  crew session's launch line, is still the person's.

## Files (change nothing else)

`src/hooks/crew-role.ts`, `src/crew/brief.ts` (only to export the builder or its parts), their tests
(`src/hooks/crew-role.test.ts` and the matrix if it pins prompts); `docs/design/crew.md` only if a
sentence there lists the lead's prompts; `CHANGELOG.md` (a `## 1.1.2` section at the top: one
bullet, in users' words); `plugin/dist/*.js` (rebuilt). Not `plugin.json` (the lead bumps).

## Done-check

Tests: the launch line of this record is not the person's; the same text with another record's
name is; a prompt that quotes the launch line inside other words is; a hand-off's first prompt is
not; each new test seen failing first. `bun run build`; `bun run check`; your review; your report.
