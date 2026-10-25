# SC1 — the router ends a stream that stalls after its first byte (1.2.1)

## Goal, and why

Your branch starts from `release-1.2.1` with all of 1.2.0 merged into it (RV3–RV6, DF1, HO1, UI1)
and these 1.2.1 phases: CL2B, EF2, WF1, AR1, WN1, RG1, MC1, NM1, JW1, RS1, SW1, LT1. The plan: `.claude/plans/2026-10-21-master-plan.md` § Release 1.2.1.

- **What was seen (2026-10-24):** 12 of 4,957 answers from
  `omniroute:openrouter/deepseek/deepseek-v4.1-flash:floor` in 3 hours started (200) and then sent
  nothing. One crew session waited 21 minutes on one, until Claude Code's own timeout retried it.
- **Why:** `timeouts.firstByteMs` (`src/gateway/config.ts` ~184; `src/gateway/router.ts` ~29,
  ~1969-1986) covers only the first byte. After it, nothing bounds a silent stream.

## The change

1. **Prove first what Claude Code does with a stream cut mid-way** (a probe server of your own, a
   `claude -p` against it, never the live router or port 20100): does it retry at once, and what
   must the cut look like (the connection closed, or an error event)? Record it as a row in
   `docs/claude-code-contract.md`. Build the cut on what you proved.
2. **A mid-stream idle limit:** a new `timeouts` field (say `streamIdleMs`; pick the default from
   the history's real gaps between events and say why, `~/.local/state/cc-smart-dev-kit/history.db`
   read only, metadata only). When a streaming answer sends no byte for that long after its first
   byte, the router ends it the way step 1 proved Claude Code retries; the log line names the
   target and the idle time; the target rests like a failure (the existing rest rules, never a
   second timer). A ping event counts as a byte (find whether OmniRoute sends them).
3. **Never change prompt text** and every other rule in `.claude/rules/gateway.md`: read it whole
   first. A Claude target's stream is cut on the same rule (a stall is a stall), but its answers
   are never changed; say in the report if that needs the owner's word, and ask the lead.
4. **Docs:** `docs/gateway.md` (the timeouts), `README.md` if the gateway's config fields are
   listed there, `CHANGELOG.md` (the 1.2.1 entry: one bullet; `router.js` changes, so every
   machine runs `cc-smart-dev-kit gateway setup`).

## Files (change nothing else)

`src/gateway/router.ts`, `src/gateway/config.ts`, their tests (the router tests use a fake
upstream: find the harness the chain tests use), the probe script (commit it beside the R6
probes, `.claude/research/r6-recheck/`, if that folder holds them, or name its home),
`docs/gateway.md`, `docs/claude-code-contract.md`, `README.md`, `CHANGELOG.md`,
`plugin/dist/router.js` (it changes on purpose: say so). **`plugin.json` stays as it is.**

## Setup in your worktree

Run `bun install` in your own worktree. Never link another checkout's `node_modules`. Never read
or run git in another worktree. Tests never touch the live router's port 20100
(`.claude/rules/testing.md`). Never run `gateway` commands that change the machine.

## Done-check

1. Tests, each seen failing first: a stream that stalls after its first byte (cut at the limit,
   the target rests, the log line); a slow but steady stream (never cut); a ping-only gap; a
   non-streaming answer (untouched).
2. `bun run build`, then `bun run check` and both `claude plugin validate … --strict`.
3. Your own review, then one second opinion: the `cc-smart-dev-kit:reviewer` agent on `opus` at
   `xhigh` (the router is a risky change).
4. Commit a checkpoint after each green step. Never send an empty report.
5. Before you report, stop every background check and probe server you started.
