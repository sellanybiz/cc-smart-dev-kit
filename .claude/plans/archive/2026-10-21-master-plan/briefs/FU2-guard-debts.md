# FU2 — two guard and crew follow-ups from 1.1.0

## Goal, and why

1. **A resume text that starts with `-`.** `resumeArgs` (`src/crew/answer.ts`, around line 250)
   ends the `claude --bg --resume <id> …` argv with the answer text. A text that starts with `-`
   ("-1 is wrong: use 2", "--force is not allowed") is read by `claude` as a flag: the resume fails
   or does something else. Fix it the way `claude` accepts: **prove first, live**, whether
   `claude` takes `--` as the end of its options before a positional prompt (a throwaway `HOME`,
   a fake key, a fake server on a free port, `claude -p -- "-x"`: the fake server's log shows the
   prompt; never the person's settings, never port 20100). If `--` works, put it before the text;
   if it does not, find what does (the docs; `--input-format stream-json`), and write the proof as
   a row in `docs/claude-code-contract.md`. Check `launchArgs` (`src/crew/claude.ts`), which puts a
   first line last too, for the same bug.
2. **The session-escape guard's false alarm.** `src/hooks/session-escape-guard.ts`: in a crew
   session, a **computed** command (a program named at run time: `$X`, `$(…)`) whose PATH or
   argument merely contains the word `cc-smart-dev-kit` (for example a worktree path under a repo
   named `cc-smart-dev-kit`, or `bun "$WT/src/entries/cli.ts"`) is denied as "a computed kit
   command" although it runs no kit command. Narrow it: a computed command is a kit command only
   when its program position could resolve to the kit's launcher or `dist/cli.js` (the words the
   reader already gives: `src/shell/command.ts`), not when a path argument contains the name. Keep
   every real case denied — a computed `cc-smart-dev-kit crew …`, a `$KIT` that names the launcher,
   `bash -c` around one. One test per finding name, as `.claude/rules/hooks.md` asks ("a new
   spelling … is fixed in the reader, with a test named after the finding").

## Files (change nothing else)

`src/crew/answer.ts`, `src/crew/claude.ts` (only for `launchArgs`' same fix), their tests;
`src/hooks/session-escape-guard.ts`, its tests (and `src/shell/command.ts` only if the reader must
expose a word it does not yet); `docs/claude-code-contract.md` (the `--` row);
`docs/design/hooks.md` and `.claude/rules/hooks-guards.md` only if a sentence there becomes untrue;
`plugin/dist/*.js` (rebuilt).

## Done-check

The targeted tests, each new one seen failing first; `bun run build`; `bun run check`; your review;
your report with the live proof's result.
