# AN1 — `crew answer` reaches a running crew session by itself, and a corrected answer is allowed (1.2.1)

## Goal, and why

Your branch starts from `release-1.2.1` (main after 1.2.0, with 1.1.3, CL2, CL2B, EF2 and WF1
merged). The plan: `.claude/plans/2026-10-21-master-plan.md` § Release 1.2.1.

Today `crew answer` to a **running** crew session only records the answer and prints a
`SendMessage {...}` line (`src/crew/answer.ts`:1-26, ~79-83): the lead must send it by hand with
its own tool. A lead that forgets leaves the crew session blocked, and the answer is marked given.
A second `crew answer` to the same question is refused, so a lead cannot correct a wrong answer.
Both bit the lead on 2026-10-25.

## The change

1. **Research first, then ask the lead before you build.** Find every way a command can get text
   into a running Claude Code session, on the tested version (`.claude-code-version`):
   - Claude Code's own commands (`claude --help`, `claude agents --help`, any send or inbox
     command) and its docs (`docs/claude-code-contract.md` lists what is proved);
   - the kit's own hooks, which already run in every crew session: a hook that fires inside the
     crew session (for example `PostToolUse`, or the hook that fires when it next idles) reads the
     answer from the store and gives it to the session as context, once, and marks it delivered.
     Read `.claude/rules/hooks.md` and the hooks' notes before you pick an event.
   Prove each candidate live in your worktree with a throwaway session of your own (never the
   lead's or another crew session). Then ask the lead with `crew report --question`: the options,
   what each proved, and your recommendation. Build what the lead answers.
2. **The answer is delivered once, and the record says so.** The record tells "recorded" from
   "delivered" (a field, through the store's writers). `crew answer` says which happened. When it
   can only record (the chosen way cannot reach the session), it still prints today's
   `SendMessage` line, so the lead is never left without a way.
3. **A corrected answer.** A second `crew answer` to the same question records a correction: the
   first is kept as superseded (never deleted), the new one is delivered the same way, with words
   that say it replaces the earlier answer. A question already closed by the phase's end
   (`questionClosed`) is still refused.
4. **A stopped crew session** keeps today's path: it is resumed with the answer as its prompt
   (WF1 made that resume follow the session Claude Code opens). Do not change it.

## Files (change nothing else)

`src/crew/answer.ts`, `src/crew/store.ts` (only the delivered and corrected fields and their
writer), the hook you pick (its file under `src/hooks/`, its entry in `src/entries/`,
`src/hooks/specs.ts`, `plugin/hooks/hooks.json`) if the lead picks a hook, their tests,
`plugin/skills/lead/SKILL.md` (§ 5's "Send the answer" line, and the plan's lead instructions it
points to), `docs/design/crew.md`, `docs/claude-code-contract.md` (a row for each fact you proved),
`plugin/dist/*.js`. **`plugin.json` stays as it is.** RG1 changes the question list in
`store.ts`: keep your store change to the answer fields.

## Setup in your worktree

Run `bun install` in your own worktree. Never link another checkout's `node_modules`. Never read
or run git in another worktree. Never send a message to another session: your proofs use a
session you start yourself.

## Done-check

1. Each change has a test, seen failing first: delivered to a running session; recorded only (the
   `SendMessage` line printed); a correction; a closed question refused; a stopped session resumed.
2. `bun run build`, then `bun run check` and both `claude plugin validate … --strict`.
3. Your own review, then one second opinion: the `cc-smart-dev-kit:reviewer` agent on `opus` at
   `xhigh` (it drives sessions on the person's machine).
4. Commit a checkpoint after each green step. Never send an empty report.
5. Before you report, stop every background check and every test session you started.
