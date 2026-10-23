# C6b — the verification gate (MD-3)

**Goal.** A session that changed files and stops without running the project's fast check gets one reminder. The project names its fast check once, and `project init` asks for it. (C6's other parts, MD-7 and MD-13, already landed as C6a.)

## Read first
The audit plan `.claude/plans/archive/2026-10-17-audit-fixes.md` § C6 (MD-3) and its research notes (`.claude/research/archive/2026-10-17-audit-fixes.findings.md`, search MD-3); the master plan's D7; `.claude/rules/hooks.md` (the frame, `ownHooks`, a Stop hook that blocks once through `stop_hook_active`, fail-safe: an informational hook never stops a person's work); `.claude/rules/cc-smart-dev-kit-json.md` (a new field: schema, `requires`, README); `src/project/config.ts`, `src/project/init.ts`, `src/cli/project-init.ts` (B3 made its questions numbered through `src/cli/ui/prompt.ts`; `QUESTIONS` is the list); `src/hooks/specs.ts`, `src/hooks/crew-role.ts` (an existing Stop hook that blocks once), `src/hooks/subagent-background.ts` (reads a transcript as JSONL).

## Build
1. A `checks` field in `.claude/cc-smart-dev-kit.json` (for example `{ "fast": "bun run typecheck && bun test src/changed" }` — pick the simplest shape that lets a project name its fast check; say why), validated by the schema, with its `requires`.
2. `project init` asks for it (one question, a default read from `package.json` scripts when one is obvious, `none` to skip) and writes it.
3. A new opt-in Stop hook (`verify-gate`, project-scoped): only when the project sets `checks.fast`; when files changed in this session since its last run of that check (read the session's own transcript: an Edit/Write/NotebookEdit after the last Bash call that ran the check), block once with a plain reason naming the command; silent on the stop a block caused (`stop_hook_active`), in a crew session (it has its own report gate), with no file, and on any failure (fail open, one stderr line).
4. Wire it: `src/entries/verify-gate.ts`, `plugin/hooks/hooks.json`, `specs.ts`/`HOOKS`, `PLUGIN_HOOK_NAMES`, a `matrix.test.ts` row, `entries.test.ts`.
5. Docs: README (the field and the hook row), `docs/design.md`, `.claude/rules/hooks.md`, `.claude/rules/cc-smart-dev-kit-json.md`.

## Files
`src/project/config.ts`, `src/project/init.ts`, `src/cli/project-init.ts` (its questions only), new `src/hooks/verify-gate.ts` and its entry and tests, `src/hooks/specs.ts`, `src/hooks/matrix.test.ts`, `src/hooks/entries.test.ts`, `plugin/hooks/hooks.json`, `README.md`, `docs/design.md`, `.claude/rules/hooks.md`, `.claude/rules/cc-smart-dev-kit-json.md`. Change nothing else.

## Done-check
Tests: the field's schema and messages; project init's question (default, `none`); the hook: changed and not checked → one block; checked after the last edit → silent; `stop_hook_active` → silent; crew session → silent; no field → silent; unreadable transcript → silent. Break each once. `bun run typecheck`, `lint`, `check:neutral`, `check:duplicates`, `check:core-lines`, `timeout 900 bun test --timeout 60000 src/hooks src/project src/cli`, `bash scripts/windows-hook-smoke.sh`, then the whole `bun test`. Don't commit `plugin/dist` or `plugin/portal-ui`, don't bump the version, never stage `supabase/`, no names.
