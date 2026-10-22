# CC3 — crew sessions start lean

**Goal.** A crew session starts with only what its work uses, so its context goes to the phase, not to the machine's other plugins. Today a crew session carries about 62–69k tokens before it reads its brief (measured on this machine). The owner chose lean crew sessions.

## How to read
Open only the functions you need, by line range. Don't read whole folders. Measure first, then build.

## The facts so far
- The launch line is built in `src/crew/claude.ts:176` (`claude --bg -w <worktree> --name … --model … --effort … --permission-mode auto --autocompact auto --settings <file> "<first line>"`); `src/crew/start.ts` calls it. The kinds and their models live in `src/models/launch-policy.ts`.
- What a session on this machine loads at start (see any crew session's first reply): many plugins' skills (animations, payments, memory tools, design), many MCP servers (deferred tool names alone are a long list), the kit's own instructions and the project's CLAUDE.md and rules, a memory plugin's start context, then the crew frame and the brief.

## Build
1. **Measure.** From a crew session's transcript (`src/crew/transcript.ts`'s reader: the first reply's `usage`), how many tokens the start carries. Split it by part where Claude Code shows that (`/context`, or the first request). If a measure needs an interactive terminal, write the exact `!` command for the owner in your report (`needsLead`) and build the rest.
2. **Research Claude Code's own launch options** for this, on the tested version (`.claude-code-version`, `claude --help`, code.claude.com docs, at least two sources): for example `--strict-mcp-config` with `--mcp-config`, settings in the `--settings` file that turn a plugin or a skill off for one session, a plugin's documented environment switch. Never guess a flag: prove each one. Add each proved row to `docs/claude-code-contract.md`.
3. **Launch lean.** Keep what every kind needs: the kit itself (its hooks, skills, agents, monitors), the project's own CLAUDE.md and rules, Tavily for research, Playwright for `ui` kinds. Drop the rest. Never change prompt text: no edited system prompt, no `--append-system-prompt` (`.claude/rules/gateway.md`). A project can keep more: pick the simplest setting shape (a list in `workflow.crew`, say), say why, with its schema, `requires` and README row (`.claude/rules/cc-smart-dev-kit-json.md`).
4. **Measure again**, and put the before and after in your report.

## Files
`src/crew/claude.ts` (the launch line), `src/crew/start.ts` (only where it passes the launch options), `src/workflow/schema.ts` and `src/workflow/resolve.ts` (only the new setting), their tests, `README.md`, `docs/design.md` § Lead and the crew, `docs/claude-code-contract.md`, `.claude/rules/cc-smart-dev-kit-json.md`. Another crew session (CC4) changes the context gauge (`src/crew/transcript.ts`, `src/crew/self-watch.ts`) at the same time: don't touch those. Change nothing else.

## Done-check
Tests: the launch line for each kind (what it keeps, what it drops), the project setting that keeps more, an unknown entry refused with a plain message. Break each once. `bun run typecheck`, `lint`, `check:neutral`, `check:duplicates`, `timeout 900 bun test --timeout 60000 src/crew src/workflow`, then the whole `bun test`. Don't commit `plugin/dist`, don't bump the version, never stage `supabase/`, no names.
