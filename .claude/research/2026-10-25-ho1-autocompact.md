# HO1: what decides a crew session's auto-compact point

Date: 2026-10-25
Status: input to the 1.2.0 hand-off change (HO1). The facts are carried as rows in
`docs/claude-code-contract.md` § Lead and the crew; the code is `src/machine/claude-settings.ts`,
`compactPointOf` in `src/crew/context-window.ts` and `handoffTokensOf` in `src/crew/self-watch.ts`.

**The question.** The owner has `modelSettings.claude-opus-5-5.autoCompactWindow: 400000` in the
user settings. A crew session starts with `--autocompact auto`. Does the setting still apply, so
that Claude Code compacts the session at about 400k, where the hand-off would also fire?

**Version.** Claude Code 2.1.310 on Linux (`claude --version`); the 2.1.308 binary, the tested
version, was read too.

## The answer: no. `auto` skips the settings; only two variables still move the point

How it was proved: `claude -p "/context"` is a local command (no model call, no cost) and prints
the window (`Tokens: used / window`) and the `Autocompact buffer` row. `probe.ts` runs it once
per case with the owner's real settings in place (read through Claude Code, never written):

```
A no flag                                     Tokens: 18k / 400k   buffer 33k   ← the owner's setting
B --autocompact auto                          Tokens: 18k / 1m     buffer 33k   ← the setting is skipped
C --autocompact 250k                          Tokens: 18k / 250k   buffer 33k   ← the flag
D auto + CLAUDE_CODE_AUTO_COMPACT_WINDOW=300k Tokens: 18k / 300k   buffer 33k   ← the variable still applies
E D + CLAUDE_AUTOCOMPACT_PCT_OVERRIDE=50      Tokens: 18k / 300k   buffer 33k   ← no visible change (see below)
F auto + --settings file env = D's variable   Tokens: 18k / 300k   buffer 33k   ← a settings file's env applies
```

Read from the binaries (identical in 2.1.308 and 2.1.310; minified names, so no names here):

- The flag's value is parsed by one function: no flag → the settings table (`modelSettings`
  keyed by the model's canonical name, then the top-level key); `auto` → no value at all.
- The resolver takes `CLAUDE_CODE_AUTO_COMPACT_WINDOW` first, then that value (a value of
  `"auto"` in a file means the same as no value), then the model's default. It clamps the result
  to the model's window. The variable takes a number or a number with `k` or `M`, held to
  100k–1M.
- The compaction point is the window less the output reserve (`min(max output tokens, 20 000)`)
  less 13 000. That is the 33 000 of `/context`'s `Autocompact buffer` row, which is the same in
  all six cases. `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE` puts the point at that share of the window when
  that is lower; `/context` does not show it (case E), so it is **read from the binary, not
  proved live**.

**Not covered.** An experiment-gated pre-compute in the binary can start a background summary
earlier than the point; it was off on this machine. A `--bg` session's own `/context` (cases A–F
on a `--bg` run) is for the lead to run, if wanted: `bun .claude/research/ho1-autocompact/probe.ts`
runs the same cases with `claude -p`.

## What the code does with it

- A crew session hands off at the smallest of: `crew.handoffTokens` (400 000), `crew.handoffPercent`
  of the window (70 %, when the window is known) and one more 33 000 below the compaction point
  (when known). The compaction point reads the two variables from the process environment and the
  `env` block of the user, project and local settings; the smallest value wins.
- The person's `autoCompactWindow` keys are not read for a crew session, because they do not
  apply to it. The status line (SL1, 1.2.1) is a normal session, where they do apply: it adds its
  reader of those keys beside `src/machine/claude-settings.ts`, the one home of this reading.
