# CR1 — `crew resume` brings a crew session back in its worktree; `crew rm` finds the live one

**Goal.** Two crew command bugs found live on 2026-10-23, both on 1.0.1 and Claude Code 2.1.308.

1. **`crew resume` lands in the main checkout.** The lead stopped a crew session (`crew stop`) and ran `crew resume <name>`. The session came back in the main checkout, not its worktree; `crew-role`'s SessionStart check marked it failed and the watch stopped it (the safety net worked, nothing was written). `runCrewResume` (`src/crew/end.ts:204`, the call at :231) runs `claude respawn <id>` with the folder `record.repo`. The `crew answer` path for a stopped session (`resumeSession`, `src/crew/answer.ts:193`, :209) runs `claude --bg --resume <id> <text>` from the worktree instead — not yet proved either. `crew resume --paused` and the watch's `resumePaused`/`resumeOne` (`src/crew/watch.ts:417`, :451) restart sessions too. The lead skill § 9 tells the lead to `crew resume` every stopped crew session after a machine restart, so today that whole path fails.
2. **`crew rm <name>` stops at "name one by its id"** when a removed record shares the name of a live one. The lead missed that line once, the old queued record stayed, and two crew sessions started for one phase.

## How to read
Open only the functions you need, by line range. Give reading beyond the files you edit to a scout subagent in the background, and keep only its conclusion.

## Build
1. **Prove how Claude Code brings a `--bg -w` session back in its worktree** on the tested version (`.claude-code-version`): `claude respawn <id>` from the worktree, `claude --bg --resume <id>` from the worktree, `-w <name>` with `--resume`. You cannot start a `claude --bg` session from a crew session, so write the exact probe the owner runs with `!` (a throwaway worktree, a throwaway session, what each command prints and where `claude agents --json` puts it), put it in your report under `needsLead`, and build behind the documented behaviour and the code's own tests. Record what is proved in `docs/claude-code-contract.md` (rows owed a live proof say so).
2. **One way to bring a crew session back**, used by `crew resume`, `crew resume --paused`, `crew answer` to a stopped session and the watch's resumes: from its worktree, the form step 1 settles. Never `--all`, never `claude daemon` anything.
3. **Names:** a name that matches one live record (any state but `removed`) and only removed others means the live one — in `crew rm`, `crew status`, `crew stop`, `crew resume` and `crew answer` (their one name lookup, `src/crew/names.ts` or where it lives). Two live records of one name still ask for the id. And `crew start` says one line when the phase already has a live record (another slug), naming it, so the lead removes the old one first.
4. Docs: `plugin/skills/lead/SKILL.md` § 9 if the resume step changes, `docs/design.md` § Lead and the crew, `README.md` if a command's output changes.

## Files
`src/crew/end.ts`, `src/crew/answer.ts`, `src/crew/watch.ts` (the resumes only), `src/crew/names.ts` (or the name lookup's home), `src/crew/remove.ts`, `src/crew/start.ts` (the one warning line only), their tests, `plugin/skills/lead/SKILL.md`, `docs/design.md`, `README.md`, `docs/claude-code-contract.md`. Change nothing else.

## Done-check
Tests: each resume path runs its command from the worktree; a resume of a record with no worktree is refused with one line; a name with one live and one removed record resolves to the live one; two live records still ask for the id; `crew start` warns about a live record of the same phase. Break each once (restore with `cp`, not git). `bun run typecheck`, `lint`, `check:neutral`, `check:duplicates`, `timeout 900 bun test --timeout 60000 src/crew`, then the whole `bun test`. Don't commit `plugin/dist`, don't bump the version, never stage `supabase/`, no names.
