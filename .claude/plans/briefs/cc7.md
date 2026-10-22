# CC7 — the lead hears when the person types into a crew session

**Goal.** The person may type into a crew session (`claude attach`, or by mistake). Their word wins, and nothing blocks them. But today the lead never hears it, so it may merge work that no longer matches the brief. The owner chose (2026-10-23): record it, tell the lead, and keep the crew session's report honest.

## How to read
Open only the functions you need, by line range. Don't read whole folders. Give reading beyond the files you edit to a scout subagent in the background, and keep only its conclusion.

## Build
1. **Prove the input first.** Three things reach a crew session as a new turn, and Claude Code may run `UserPromptSubmit` for each of them: the person's typed prompt; a message from another session (the lead's `crew answer`, a lead note, a peer's `crew tell`, all sent with `SendMessage`); a monitor's line (the `crew-self` monitor; seen in a lead: `UserPromptSubmit` ran on each monitor line). Find how the hook input tells them apart on the tested version (`.claude-code-version`): a field, or a fixed wrapper around the text. Prove it live. If a proof needs the owner's terminal, write the exact `!` command in your report (`needsLead`) and build the rest behind what you proved. Add the row to `docs/claude-code-contract.md`. When the hook cannot tell, it records nothing: a false "the person wrote" on every lead note is worse than none.
2. **`crew-role` on `UserPromptSubmit`** (`src/hooks/crew-role.ts`; its header lists its events), only for the person's own prompt in a crew session:
   - record one event in the store (`appendCrewEvent`, `src/crew/store.ts`): the time and the first line, masked and clipped (the same masking the Stop part uses for the last line);
   - give the crew session one short context line: the person wrote to you directly and their word wins over the brief; if it changes your phase's scope or files, say so in your report; if they told you to stop, still file a report (`blocked` or `handoff`).
   Never block, never ask. A failure is one stderr line, and the prompt goes on.
3. **The lead's watch** prints one line for the new event (`src/crew/watch.ts`), and `lead-notes` covers a missed one if it needs a new kind. **The lead skill** § 4: one row (the person wrote to a crew session: read its next report against the brief, before the merge). **The crew skill:** one line where it says the crew session never asks the person: a message the person types is theirs to give, and the report says what changed.
4. Wire it: `src/hooks/specs.ts`, `plugin/hooks/hooks.json`, `src/hooks/matrix.test.ts`, `src/hooks/entries.test.ts`. Docs: `.claude/rules/hooks.md`, `docs/design.md`.

## Files
`src/hooks/crew-role.ts` and its test, `src/hooks/specs.ts`, `plugin/hooks/hooks.json`, `src/hooks/matrix.test.ts`, `src/hooks/entries.test.ts`, `src/hooks/lead-notes.ts` (only for a new kind), `src/crew/store.ts` (the new event kind only), `src/crew/watch.ts` (the new line only), `plugin/skills/lead/SKILL.md`, `plugin/skills/crew/SKILL.md` (one line), `docs/claude-code-contract.md`, `.claude/rules/hooks.md`, `docs/design.md`. CC5 and CC6 change other parts of some of these files at the same time: touch only your parts. Change nothing else.

## Done-check
Tests: the person's prompt in a crew session → one event and one context line; a `SendMessage` delivery, a monitor line, a plain session's prompt → nothing; a secret in the first line is masked; a store that cannot be written → one stderr line, no block. Break each once (restore with `cp`, not git). `bun run typecheck`, `lint`, `check:neutral`, `check:duplicates`, `timeout 900 bun test --timeout 60000 src/hooks src/crew`, `bash scripts/windows-hook-smoke.sh`, then the whole `bun test`. Don't commit `plugin/dist`, don't bump the version, never stage `supabase/`, no names.
