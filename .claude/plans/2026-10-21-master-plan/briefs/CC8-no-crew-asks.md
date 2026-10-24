# CC8 — no guard asks a crew session where the fix is mechanical

**Goal.** Nobody watches a crew session, so an ask stalls it until the person answers, and the person does not want to answer the same ask again and again. CC6 (merged, `e9b9ec1`) made the git guard's asks a deny with the step in a crew session (`crewGitAnswer`, `src/hooks/git-guard.ts`). Its report listed every other ask a crew session can still meet. Build its recommendations.

## How to read
Read `.claude/rules/hooks.md` § A crew session's own limits and § Fail safe first. Open only the functions you need, by line range. Give reading beyond the files you edit to a scout subagent in the background, and keep only its conclusion.

## Build
In a crew session (`CC_SMART_DEV_KIT_CREW` set), each ask below becomes a deny that names the step, in plain words. A person's own session keeps every ask exactly as today. Put each in the guard's crew part where a project must not switch it off (the frame runs it before `ownHooks` and before the file), and say why for each.
1. **merge-guard:** every question a crew session can reach before a readable `gh pr merge` (admin merge, `autoMerge` off, another repository, a check not green, no covering review, a policy it cannot read, a form it cannot judge, its budget ask). Step: a crew session never merges; it commits on its branch and the lead merges locally.
2. **agent-guard:** a crew session is a `--bg` session, so it is judged as attended today, and its asks (an unreadable Workflow launch, a Fable launch, an Opus-family model it cannot read, Opus at `max`) reach nobody. Judge it as unattended (the guard already denies those there), with the step: ask the lead with `crew report --question`.
3. **job-route:** the ask before a `claude -p` launch whose model or effort the policy questions, and the `onConfigProblem` ask beside a heavy command. Step: report the question to the lead.
4. **session-escape-guard:** the asks before writing into the kit's own file, settings, state or plugin-cache folder, and the computed-write and computed-kit-command asks: a crew session may not change the kit's own limits; step: ask the lead with `crew report --question`. The portal-reach ask: the same deny (a crew session has no business with the portal).
5. **The bun shim** (`plugin/bin/cc-smart-dev-kit-bun.sh`): with `--missing=ask` and `CC_SMART_DEV_KIT_CREW` set, answer a deny that names the fix instead of an ask. Shell built-ins only; both shim tests (`src/hooks/bun-shim.test.ts`, `src/setup/bun-shim.test.ts`) cover it.
6. **CC6's open items:** the matrix's crew rows (`src/hooks/matrix.test.ts`: no file, `ownHooks` listing the guard, `requires` too new) prove the git deny too; `git reset --merge` and `--keep` (prove what each can lose, and ask a person's session where work can be lost); the crew part reads both shell dialects when the tool is unknown, like the guard's own `run` (`.claude/rules/hooks.md` § Reading a shell line).
7. **Keep:** a guard's own crash and input that is not JSON still ask (the bug path), and `onFailure: block` in `hooks.json` stays.
8. Docs: `.claude/rules/hooks.md` (§ A crew session's own limits: the list of crew refusals), `docs/design.md` where the guards' crew parts are described.

## Files
`src/hooks/merge-guard.ts`, `src/hooks/agent-guard.ts`, `src/hooks/job-route.ts`, `src/hooks/session-escape-guard.ts`, `src/hooks/git-guard.ts` (item 6 only), their tests, `src/hooks/matrix.test.ts`, `src/hooks/specs.ts` (crew-part wiring only), `plugin/bin/cc-smart-dev-kit-bun.sh`, `src/hooks/bun-shim.test.ts`, `src/setup/bun-shim.test.ts`, `.claude/rules/hooks.md`, `docs/design.md`. CC7 changes `crew-role` and adds rows to `specs.ts` and `matrix.test.ts` at the same time: touch only your parts. Change nothing else.

## Done-check
Tests: each former ask in a crew session → a deny naming its step; the same input outside a crew session → the same ask as today; the crew deny with no file, with `ownHooks` listing the guard, and with `requires` too new; the shim's crew deny with no bun. Break each once (restore with `cp`, not git). `bun run typecheck`, `lint`, `check:neutral`, `check:duplicates`, `timeout 900 bun test --timeout 60000 src/hooks src/setup`, `bash scripts/windows-hook-smoke.sh`, then the whole `bun test`. Don't commit `plugin/dist`, don't bump the version, never stage `supabase/`, no names.
