# Finished crew sessions leave agent view; hand-offs reach the lead (D69, D70)

**Status:** approved by the owner, 2026-10-30. Building.

## The owner's ask

"Stopped crew sessions are still there [in agent view] … due to this I am not able to find lead
sessions." And: "when hand-off done or work done, those sessions [are] removed from the agent
window, after 7 days they [are] archived and after 30 days they [are] deleted." Asked before on
2026-10-24 (AR1 built only the `/resume` half, and only at removal). Also: "find out why they were
not merged — what was the lead doing?"

## What this machine showed (2026-10-30, Claude Code 2.1.314, kit 1.6.0)

Agent view had 72 rows, 57 with no process. Matched to the crew store:

| Rows | Record state | Why it stayed |
|---|---|---|
| 18 | `merged` | Every commit is on the lead's branch. The watch's removal refused each one: `local files git does not keep: logs/` — the app's git-ignored debug logs (`logs/omniroute/…`). `REBUILDABLE` in `src/hooks/local-files.ts` says it covers logs, but matches only `npm-debug.log` and the like. |
| 22 | `handoff` | `claude rm` refuses a Claude-made (`-w`) worktree whose commits are only local, and crew commits always are. The kit removes the worktree only after a merge. |
| 9 | `done`, `failed` | Same: no merge yet, so the row stays. |
| 6 | an earlier session of a resumed record | Kept until the record is removed (RX1). |
| 2 | `stopped` | Same. |

**Why the work did not reach the leads:** about 15 hand-offs queued their successor, and not one
started. 23 queued records said `held: the load is 88.1 on 16 cores, past 48`. The 1-minute load
stayed between 72 and 88 because up to three heavy jobs (full test suites, each using every core)
ran at once. A successor waited in the same line as a brand-new phase, so the half-done work never
came back to the lead.

## Decisions

| # | Decision | By |
|---|---|---|
| D69 | **A crew session leaves agent view when its session is over, not when it merges.** Once a record is `done`, `handoff`, `failed` or `stopped` and its session has no process, the watch *releases* it: everything in the worktree must be committed and nothing may hold it (the same checks `crew rm` runs, without the merge check), then the worktree goes (`git worktree remove`), **the branch stays** (the commits are safe on it), and `claude rm` runs on every session id of the record (earlier ones too). The record stays on the board with its state and branch; the lead merges from the branch; `crew answer` / `crew resume` re-make the worktree from the branch before they resume. Uncommitted work keeps its worktree and row, and the lead is told once. **The conversation stays in `/resume` for `crew.archiveDays` (7) after the session ended, then moves to the kit's archive; the archive is deleted `crew.deleteDays` (30) after the session ended.** A resume of an archived conversation puts it back first. | Owner, 2026-10-30 |
| D70 | **A hand-off's successor goes first, and does not wait for the load.** It replaces a session that just ended, so it skips the load rule (memory and the session counts still apply), and it starts before any queued new phase. New phases still wait for the load. | Owner, 2026-10-30 |
| — | An ignored `logs/` folder and ignored `*.log` files are safe to lose (`REBUILDABLE`). | Owner, 2026-10-30 |
| — | Today's 18 merged rows were cleaned at once by hand: each one's ignored `logs/` deleted, then the kit's own `crew rm`. | Owner, 2026-10-30 |

## Phases

| Phase | Owner | Files | Done when |
|---|---|---|---|
| A — the queue and the logs rule | builder (`sonnet`, high) | `src/crew/places.ts`, the queued-start order (wherever the watch or `start.ts` picks the next queued record), `src/hooks/local-files.ts`, their tests, `docs/design/crew.md` § the places part | A successor of a `handoff` record starts past a high load and before an older queued new phase; `logs/` and `*.log` are not local files; tests fail before and pass after. |
| B — release the session | builder (`sonnet`, high) | a new `src/crew/release.ts` (one home for the release steps, sharing `remove.ts`'s checks rather than copying them), `src/crew/watch.ts` (one call site), `src/crew/store.ts` (the release fact and when the session ended), `src/crew/answer.ts` / `src/crew/end.ts` (re-make the worktree on resume), every reader of `record.worktree` that must cope with a missing folder, `src/crew/board.ts`, tests, `docs/design/crew.md`, `docs/claude-code-contract.md` (live proofs) | A finished, committed record's row leaves `claude agents --json --all` on the next pass with its branch kept; a resume re-makes the worktree and continues; uncommitted work is kept and said once; `crew rm` of a released record still works after the merge. |
| C — the timeline | builder (`sonnet`, high) | `src/crew/archive.ts`, `src/crew/remove.ts` (no archive at once), `src/sessions/finished.ts`, `src/sessions/command.ts`, `src/workflow/schema.ts`, `src/workflow/resolve.ts`, `src/cli/help.ts`, `src/crew/usage.ts`, `README.md`, `docs/design/crew.md` § A removed crew session's conversation, `.claude/rules/cc-smart-dev-kit-json.md` | A conversation moves to the archive `archiveDays` after its session ended and the archive goes `deleteDays` after; a resume puts an archived conversation back; `workflow show` lists `crew.deleteDays`. |
| Integrate | lead (this session) | merge A, B, C; `CHANGELOG.md`; version bump; `bun run check`; both validates; one second opinion (`opus`, xhigh: it removes worktrees); the pull request | CI green, the owner's yes. Then on this machine: update, and the sweep of today's leftovers. |

## Log

- 2026-10-30: investigated live; the owner approved D69, D70 and the logs rule; the cleanup of the 18 merged rows started.
- 2026-10-30: with `logs/` gone, the leads' own watches took over the 18 removals (one machine-wide clean at a time). Deleting each `node_modules` under a load of ~88 times out, so several folders wait as `<path>-removing-<time>` for the watch's five-minute finisher (D62). The S3D hand-off was marked merged by its lead at 11:41 UTC, so its removal is the watch's normal step. Builders A, B and C started in their own worktrees.
