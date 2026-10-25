# BR1 — the browser works again after a machine restart

**Goal.** After the machine restarts, the Playwright MCP server fails until the person fixes it by hand. The owner says it happened after the last restart too. Measured on 2026-10-23, after a restart: a subagent's `browser_navigate` failed with `Playwright extension did not connect within 30s after opening the connect page. Make sure the extension is installed in the Chrome profile "claude-code" and PLAYWRIGHT_MCP_EXTENSION_TOKEN matches its token.`; no Chrome process was running; and `cc-smart-dev-kit browser check` did not finish within 60 s.

## How to read
Read `.claude/rules/browser.md` whole first (the rules that break something when they move, and what the tests must keep true). Then open only the functions you need, by line range. Give reading beyond the files you edit to a scout subagent in the background, and keep only its conclusion.

## Build
1. **Find the root cause, with proof.** The launcher (`src/browser/launcher.ts`, `browser mcp`, extension mode), the Chrome finder (`chrome.ts`), the token (`token.ts`), the check (`check.ts`). Answer: what does the connect step need that a restart takes away (Chrome not running, the profile not open, the extension not loaded yet, the token file, a lock or a socket left from before the restart)? Prove it on this machine without touching the person's real Chrome profile's files (the rule: read-only Preferences). If a proof needs the person at the desktop, write the exact steps in your report (`needsLead`) and build the rest.
2. **The fix at the root**, so the first browser call after a restart works with nobody at the desktop, or fails at once with one plain line that says the one step to take. Never a 30 s wait that ends in a generic error. No sleep, no retry loop.
3. **`browser check` never hangs.** Find why it ran past 60 s. Every child process and wait in it gets its own limit, from one named constant, shorter than the whole check's.
4. `doctor`'s browser lines (`src/browser/doctor.ts`) say the same thing the check finds. Docs: `.claude/rules/browser.md` if a rule changes, `docs/design.md` § the browser, `README.md` if a command's output changes, `docs/claude-code-contract.md` for any Claude Code or Playwright behaviour you prove.

## Files
`src/browser/**` and its tests, `src/mcp/servers.ts` only if the registration must change, `.claude/rules/browser.md`, `docs/design.md`, `README.md`, `docs/claude-code-contract.md`. Change nothing else.

## Done-check
Tests: the state a restart leaves gives the fixed result (works, or one plain line at once); `browser check` with a child that never answers ends within its limit. Break each once (restore with `cp`, not git). `bun run typecheck`, `lint`, `check:neutral`, `timeout 900 bun test --timeout 60000 src/browser src/mcp`, then the whole `bun test`. Tests never touch the real `~/.claude`, `~/.config`, `~/.local` or the person's Chrome profile. Don't commit `plugin/dist`, don't bump the version, never stage `supabase/`, no names.
