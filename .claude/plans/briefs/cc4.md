# CC4 — the context gauge reads the real window

**Goal.** A crew session hands off on the context it really has left. Today the gauge assumes 200 000 tokens for every Claude model without the `[1m]` suffix (`src/crew/transcript.ts:26`, `contextWindowOf` at :43), so a crew session hands off far too early. The owner chose: Opus with its 1M window, and hand off at 80% (already set for this repo in `.claude/cc-smart-dev-kit.json`).

## How to read
Open only the functions you need, by line range. Don't read whole folders. Start building once you know the source of the window.

## The facts so far
- Anthropic's model table (the `claude-api` skill, cached 2026-10-06): Opus 5.5, Opus 5, Sonnet 5.5, Sonnet 5, Haiku 5.5, Fable 5/5.1 have a 1M window; Haiku 4.5 has 200k.
- On this machine a crew session on `claude-opus-5-5` reached 185 869 tokens with no compaction: more than a 200k window allows.
- A crew session starts at about 62–69k tokens. With a 200k gauge at 70% it handed off after its research alone.
- The gauge: `src/crew/self-watch.ts:125` takes `contextWindowOf(usage?.model ?? record.model.resolved)`; the usage is the last reply's from the transcript (`contextUseOf`).
- The worker slot here answers from a backend (`omniroute:ollama-cloud/deepseek-v4.1-flash`). OmniRoute reports each model's `context_length`, and the gateway reads it (`src/gateway/backends.ts:43`); `cc-smart-dev-kit gateway models` shows that model at 1 000 000 tokens.
- Measured: the transcripts of the two worker-slot crew sessions record `message.model` as the bare backend name, `deepseek-v4.1-flash` (no backend prefix). So today `contextWindowOf` returns null for them, and they get no context line at all. The gauge must map that bare name back to the slot's target (the slot chain in the gateway config) and take the target's window from the backend's list, read once and kept, never one network call per poll. A name it cannot map stays unknown.

## Build
1. **Find where Claude Code itself says a session's window**, and prove it on the tested version (`.claude-code-version`). Candidates: the status line input's `context_window` (code.claude.com/docs/en/statusline), anything in the transcript, the SessionStart input. Prove what a `--bg` session gives. If a proof needs an interactive terminal, write the exact `!` command for the owner in your report (`needsLead`) and build the rest. Add the proved row to `docs/claude-code-contract.md`.
2. **The window from its one home.** Claude Code's own number when it reports one. Otherwise a model → window table in one place: the current Claude families and `[1m]` → 1M, Haiku 4.5 → 200k, an unknown Claude id → the smaller guess (hand off early, never late — but a current family is never guessed at 200k). A backend target → its window from the gateway's model list, not "unknown".
3. **Which model answered.** Check what the transcript's `message.model` holds when the router answered from a backend (read `src/gateway/` and the router's answer path). The gauge must measure the model that really answered.
4. Docs: the module comment in `transcript.ts`, `docs/design.md` § Lead and the crew (the window sentence near line 3232), `docs/gateway.md` if a sentence says 200k for Claude Code.

## Files
`src/crew/transcript.ts`, `src/crew/self-watch.ts`, a new `src/crew/context-window.ts` if the reader needs its own home, their tests, `docs/claude-code-contract.md`, `docs/design.md`, `docs/gateway.md`. `src/gateway/` is read only: if you need a new export there, ask the lead. Another crew session (CC3) changes the launch line (`src/crew/claude.ts`, `src/crew/start.ts`) at the same time: don't touch those. Change nothing else.

## Done-check
Tests: a current family → 1M; `[1m]` → 1M; Haiku 4.5 → 200k; a backend target → its listed window; an unknown model → the smaller guess; Claude Code's own number wins when present; self-watch's hand-off line at 80% of the real window. Break each once. `bun run typecheck`, `lint`, `check:neutral`, `timeout 900 bun test --timeout 60000 src/crew`, then the whole `bun test`. Don't commit `plugin/dist`, don't bump the version, never stage `supabase/`, no names.
