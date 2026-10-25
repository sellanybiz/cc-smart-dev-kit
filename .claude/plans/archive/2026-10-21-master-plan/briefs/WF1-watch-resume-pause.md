# WF1 — one watch per lead, a resume that keeps its session, a pause that waits for the right thing (1.2.1)

## Goal, and why

Your branch starts from `crew/CL2B-hook-boundary` (CL2's cleanup and its hook-boundary fix), not
yet merged anywhere: build on its code as it is. `src/hooks/stop-failure.ts` is being changed in
another phase; do not touch it.

The lead hears its crew and the crew is driven through `crew watch`. Three bugs break that today,
for every lead on the machine. Both were seen live on 2026-10-25. Fix each at its cause, each with
a test seen failing first.

## Bug A — many watches act for one lead, and old ones never end

- **What was seen:** 13 `crew watch` processes whose parent had died (parent pid 1), up to 30 hours
  old, beside the live ones: up to 5 for one lead. Each one runs a full pass every
  `WATCH_POLL_MS` (`src/crew/watch.ts:80`): it starts queued phases (`startQueued`), resumes paused
  ones (`resumePaused`), stops sessions (`stopCrew`), and writes `watch/<lead>.json`.
- **Why it hurts:**
  - The resume wave (one canary, then `RESUME_SPACING_MS` apart) lives in each process's memory
    (`watch.ts:441-466`). Five watches resume five sessions at once after a limit resets.
  - Two watches can resume the same record: `resumeOne` calls `claude --bg --resume` before it
    writes `working` (`watch.ts:487-521`), so both may read `paused` first.
  - Each process writes the same state file from its own memory, so the offset and the `said`
    marks of one overwrite the other's.
- **Why they live forever:** Claude Code ends a monitor by ending its shell; the bun child goes on,
  re-parented to pid 1. Nothing in the watch notices: it never checks its parent, and a write to a
  closed stdout does not end it.
- **Fix:**
  1. **One acting watch per lead: the newest wins.** A lease per lead in the crew store (pid,
     the process start time, the pid namespace). Reuse the holder helpers in `src/setup/lock.ts`
     (`currentHolder`, `holderIsGone`, `processStartTime`); do not write a second copy. A new
     watch takes the lease (a restarted monitor is the lead's intent, task "a lead can restart
     its monitor"). At each pass a watch that no longer holds the lease prints one line and
     exits 0, before it acts. A lease whose holder is gone is free. `--once` follows the same
     rule.
  2. **A watch ends when its parent is gone** (its parent pid changes from the one it started
     with) and **when a write to stdout fails** (EPIPE): one exit path, no empty catch.
  3. The state file is written only by the lease holder.
- **Tests:** two watches for one lead (the second takes over, the first exits before acting);
  a stale lease of a dead pid; a parent that dies; a closed stdout; two leads do not share a
  lease. Every test can fail (`.claude/rules/testing.md`).

## Bug B — a resume opens a new session, and the record keeps the old one

- **What was seen:** a crew record held session `c7186986`. `crew answer` resumed it, and Claude
  Code opened session `d7a54fc8` in the same worktree. The record kept `c7186986`. Ten seconds
  later the watch read the old session's row as stopped and marked the record `stopped`
  (`watch.ts` ~600, `rowOf` in `src/crew/agents.ts:31` matches by `shortId`, then `sessionId`).
  It happened twice in three minutes, and on six other crew sessions. The new session ran on,
  unseen, and asked "the crew record is stopped…".
- **The cause:** `resumeSession` (`src/crew/answer.ts:284-335`) runs `claude --bg --resume <id>`
  and checks only the exit code. It never reads the `backgrounded · <short id> · <name>` line
  that `parseBackgrounded` (`src/crew/claude.ts:457-470`) already reads for a start.
- **Fix:**
  1. **Prove it first:** run `claude --bg --resume <id>` on a test session of your own (in your
     worktree, a throwaway prompt) and record what it prints and whether the id is new. Add the
     row to `docs/claude-code-contract.md`.
  2. `resumeSession` returns the new short id and session id: parse the line, then read agent view
     for its row, as a start does (`src/crew/start.ts:813-856`; extract a shared helper, never a
     copy). One home for the transport stays `resumeSession`.
  3. The record takes the new `sessionId` and `shortId` in the same write that makes it `working`
     (`sayResumed`, `watch.ts:525`), for every caller: `crew answer`, `crew resume`,
     `crew resume --paused` (`src/crew/end.ts`) and the watch.
  4. A resume that printed no such line is said, with the reason; the record does not go back to
     `working` on a guess.
- **Tests:** a resume that prints a new id (the record follows it, and the next watch pass does not
  mark it stopped); the same id; no line.

## Bug C — a crew session on a backend pauses for days on a Claude fallback's limit

- **What was seen:** two crew sessions ran on the worker slot, whose chain is
  `omniroute:codex/gpt-6-luna → claude-sonnet-5-5`. Claude Sonnet was at its weekly limit until
  Oct 29. The router log at 02:14:29: `WARN omniroute:codex/gpt-6-luna answered 502; trying the
  next target — … upstream_empty_response`, then `claude-sonnet-5-5 429 … returned as it is`.
  So one empty answer from Codex became Sonnet's plan-limit 429. The crew sessions were paused
  with `waitingFor: {kind: "claude-limit", model: "claude-sonnet-5-5", resetsAt: Oct 28 20:00Z}`,
  and their lead told the person "the model limit resets Oct 29", while their own model answered
  again within seconds.
- **The cause:** `waitFor` (`src/crew/wait.ts:278-292`) picks `claude-limit` whenever a Claude limit
  of the record's family is current (`limitForStop`), even when that Claude model is only a
  fallback in the slot's chain. `waitOver` (`wait.ts:386-391`) then holds the session until the
  reset.
- **Fix:** when the record's slot is in use with a chain whose first target is not that Claude
  model (`facts.inUse[slot]`), a Claude limit is not what the session waits for: it waits for its
  chain's first target to answer again (resume after the normal backoff, `pauseBackoff`, as a
  slot wait does when its breaker has closed). A slot that is Claude, or a chain with that Claude
  model first, keeps today's `claude-limit` wait. What the lead and `crew list` say follows the
  wait: never a reset date that does not hold the session.
- **Tests:** a backend-first chain with a current Claude limit of its family (no `claude-limit`
  wait; resumed after the backoff); a Claude-first chain (today's wait); a Claude slot.

## Files (change nothing else)

`src/crew/watch.ts`, `src/crew/wait.ts`, `src/crew/answer.ts`, `src/crew/claude.ts`, `src/crew/start.ts` (only the
shared helper), `src/crew/end.ts`, `src/crew/agents.ts`, `src/crew/store.ts` (the lease, if it
belongs there), `src/setup/lock.ts` (only if a holder helper must be exported), their tests,
`docs/design/crew.md`, `docs/claude-code-contract.md`, and `plugin/dist/*.js`.
**`plugin.json` stays as it is:** the release raises the version.

## Setup in your worktree

Run `bun install` in your own worktree. Never link another checkout's `node_modules`. Never read
or run git in another worktree.

## Done-check

1. Each fix has a test, seen failing first.
2. `bun run build`, then `bun run check` and both `claude plugin validate … --strict`.
3. Your own review, then one second opinion: the `cc-smart-dev-kit:reviewer` agent on `opus` at
   `xhigh` (it drives sessions on the person's machine).
4. Commit a checkpoint after each green fix. Never send an empty report.
5. Before you report, stop every background check you started.
