# CC6 — a crew session never waits on a git ask

**Goal.** Nobody watches a crew session, so a guard's ask stalls it until the person answers. The person said they don't want to answer the same ask again and again. Measured: one crew session doing "break each once" ended each run with `git checkout -- <file>` and the git guard asked the person 4 times in a minute (`guard-asks.jsonl` in the state folder), and again after that. The hooks rule already says what to do: when the fix is mechanical and Claude can do it itself, the guard denies and says the step (`.claude/rules/hooks.md` § Fail safe, "A hook's `ask` cannot be silenced by the person").

## How to read
Open only the functions you need, by line range. Don't read whole folders. Give reading beyond the files you edit to a scout subagent in the background, and keep only its conclusion.

## Build
1. **In a crew session, the git guard's asks become a deny with the step.** The asks are in `src/hooks/git-guard.ts` (from about line 690: `checkout`/`restore`/`switch` that discard changes, `worktree remove --force`, `branch -D`, `reset --hard`, and any other ask a crew session can reach, the bare `git stash` included). For each, in a crew session (`crewIdOf(env)`), deny with the mechanical step in plain words: commit the work in progress first; to undo a deliberate break, copy the file before and copy it back (`cp`), then check `git diff --quiet -- <file>`; for a stash, the tagged form the guard already names. Decide whether this belongs in the crew part (`crewPushAnswer`, :129, run before `ownHooks` so no project can switch it off) or in the main answer, and say why. A person's own session keeps the ask exactly as today.
2. **Every other guard a crew session can meet:** list each ask the other guards (`merge-guard`, `main-folder-guard`, `agent-guard`, `job-route`, `session-escape-guard`, `crew-role`) can give a crew session, with what it is, and whether it should also become a deny with a step. Put the list in your report for the lead; change only the git guard.
3. **The skill:** `plugin/skills/verify-change/SKILL.md` § 2 ("A new test must be able to fail: break the code once on purpose…"): add how to undo the break without git (keep a copy and copy it back), in one short clause.
4. Docs: `.claude/rules/hooks.md` § A crew session's own limits, `docs/design.md` where the git guard's crew part is described.

## Files
`src/hooks/git-guard.ts`, `src/hooks/git-guard.test.ts`, `src/hooks/specs.ts` (only if the crew part's wiring changes), `plugin/skills/verify-change/SKILL.md`, `.claude/rules/hooks.md`, `docs/design.md`. Change nothing else.

## Done-check
Tests: in a crew session each former ask is a deny naming the step; outside a crew session each is still the same ask; a project whose `ownHooks` lists `git-guard` still gets the crew deny if you put it in the crew part. Break each once (and restore with `cp`, not git). `bun run typecheck`, `lint`, `check:neutral`, `check:duplicates`, `timeout 900 bun test --timeout 60000 src/hooks`, `bash scripts/windows-hook-smoke.sh`, then the whole `bun test`. Don't commit `plugin/dist`, don't bump the version, never stage `supabase/`, no names.
