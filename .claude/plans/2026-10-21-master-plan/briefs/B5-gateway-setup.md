# B5 — an interactive `gateway setup`, and the gateway's output on the output module

**Goal.** `gateway setup` asks its questions in the terminal and the gateway's commands print through B2's output module, like `doctor`, `setup` and `project init` already do. Terminal output design is UX (owner decision D50): this phase runs on opus.

## Read first
The audit plan `.claude/plans/archive/2026-10-17-audit-fixes.md` § B5 (finding UX-10) and the findings it cites (`.claude/research/archive/2026-10-17-audit-fixes.findings.md`); the master plan's 1.1.0 table row; `.claude/rules/gateway.md` (never change prompt text; secrets never on a command line or in output; a router restart is asked first); `.claude/rules/setup-and-managed-files.md` § Command output; B2's module `src/cli/ui/out.ts`, `terminal.ts`, `src/cli/check.ts`; B3's prompts `src/cli/ui/prompt.ts` (`confirm`, `ask` with a check, `secret`) and how `setup` and `project init` use them; `src/gateway/commands.ts` and `src/gateway/context.ts`.

## Build
1. `gateway setup` on a terminal: one numbered question at a time (the backend address, the key — read with the secret prompt, never echoed, never in a log — whether to turn the gateway on), each with its default; no terminal: today's flags only, nothing asked. Every question first, then the changes, then the restart question (asked before the restart, as today).
2. **Ctrl+C at any question exits 130** (B3 left `--omniroute-password` at exit 1); fix it in the prompt module if the cause is there.
3. The gateway's commands print through `Out`: sections, marked lines, `Fix:` lines, a verdict, next steps; `gateway status` and `gateway history` included. Same words where they already say the right thing; the plain text is what the tests assert.
4. README § The AI gateway and `plugin/skills/gateway/SKILL.md` where they show this output.

## Edge cases
A backend that refuses the key (keep the saved one, say which key it wants); a backend that is down (`--save-unchecked`); a port another program holds (stop, write nothing); a dry run; an old Windows console (ASCII); a pipe (plain).

## Files
`src/gateway/commands.ts`, `src/gateway/context.ts`, any new `src/gateway/setup-*.ts`, `src/cli/ui/prompt.ts` only for the Ctrl+C fix, their tests (`src/cli/gateway-cli.test.ts`, `src/gateway/*.test.ts`), `README.md`, `plugin/skills/gateway/SKILL.md`, `docs/design.md`. **`plugin/dist/router.js` must not change**: nothing the router imports may change (`src/build-info/manifest.test.ts` › "the router bundle"). Change nothing else.

## Done-check
A scripted terminal test (answers fed to the prompts, a fake OmniRoute), the secrets test (`gateway-cli.test.ts` › "secrets") covering the new flow, exact plain output for setup and status; break each new check once. `bun run typecheck`, `lint`, `check:neutral`, `check:duplicates`, `timeout 900 bun test --timeout 60000 src/gateway src/cli src/build-info`, then the whole `bun test`. Tests never reach port 20100. Don't commit `plugin/dist` or `plugin/portal-ui`, don't bump the version, never stage `supabase/`, no names.
