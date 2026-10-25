# RX1 — the release review's crew findings (1.3.0)

Your branch starts from `release-1.2.1`, the 1.3.0 release (version already 1.3.0: the lead owns
`plugin/.claude-plugin/plugin.json`, the installers' version lines and the CHANGELOG's intro; add
your own CHANGELOG lines under `## 1.3.0` only when a fix changes what a user sees). The plan:
`.claude/plans/2026-10-21-master-plan.md` § Release 1.3.0 (planned as 1.2.1), its close.

These are findings of the release's split review (2026-10-25: four tracks on `opus` at `xhigh`, each
finding checked by a second `opus` reviewer that tried to refute it). Each one names the trigger, the
real outcome and the missing guard. **Fix each at its cause, with a test seen failing first.** If,
with the code in hand, you can show a finding is wrong, do not change the code: say why in your
report. The "judge" items are hunches: prove or drop each, and say which.

## The findings

1. **A resumed crew session leaves its earlier sessions behind** (`src/crew/archive.ts:386`,
   `src/crew/remove.ts:579-615`, `src/sessions/finished.ts:261-263`). Since WF1 every crew resume is a
   copy with a new id (`docs/claude-code-contract.md:410`); `sayResumed` (`watch.ts:716`),
   `answerCrewQuestion` (`answer.ts`) and `moveSession` (`model.ts:286`) replace `sessionId`/`shortId`
   on the record. `crew rm` runs `claude rm` only on the current `shortId` and archives only the current
   `sessionId`, so the original and every earlier copy stay in `/resume` and in `claude agents --all`,
   and `sessions --finished --remove` never offers them (their names carry the crew role). That breaks
   AR1's CHANGELOG claim on a normal path. Fix: keep every earlier `{sessionId, shortId}` on the record
   (one place: the store write that changes `sessionId`, e.g. inside `changeCrew`), and have `crew rm`
   (each `claude rm`, "No job matching" = already gone), `archiveConversation`, `sessionsNeverTaken`,
   `readCrewLeftovers` and the sweep go through every id. Test: a record resumed once, then `crew rm`,
   leaves no transcript in the projects folder. Update `docs/design/crew.md` (AR1's section).
2. **A pending model change acts on a pass-old state** (`src/crew/model.ts:188`): the retry under the
   places lock checks only `pendingLaunch.at`, and `stopSession`/`markState` (`end.ts:159-201`) write
   `stopped` with no condition, so a session that reported `done` between the watch's read and
   `applyPendingModels` is stopped, set `working` and resumed on the new model. Fix: the retry returns
   "stale" when `fresh.state !== record.state` and works on `fresh`; and `stopSession`'s mark goes
   through a conditional update (only from a running state), so no stale reader overwrites an ended
   state. Test for both.
3. **The watch's removal rolls back a discard that is still running** (`src/crew/remove.ts:167`): the
   person's `crew rm --discard` changes the worktree's signature, the watch tries again
   (`watch.ts:922-946`), sees `discardPending` and runs `rollbackCrewDiscard` under the person's
   process. No data is lost (the archive ref stays), but the discard fails confusingly. Fix: the watch
   skips a record with `discardPending` (says it once), or one lock per record around `runCrewRm` so a
   second removal waits or refuses — pick the stronger and say why. Test.
4. **The watch waits forever for a continuation that will never merge** (`src/crew/watch.ts:906`): a
   continuation removed before it started, discarded, or failed stays in the `continuations` list
   (`mergedIntoBase` is "unknown" for a gone branch), so the first record is never removed and the lead
   hears a false "waiting for its continuation". `lifecycle.ts:21-28` (`activeContinuationOf`) holds
   the opposite rule ("a failed or removed successor releases it"). Fix: one rule for "this record
   still waits", used by both. Test: a continuation removed before it started.

## Judge

- The watch stops a blocked crew session that idles past `idleStopMinutes` and writes `stopped` itself
  (`watch.ts:1000-1011`); D62 then never removes any `stopped` record by itself, even after a merge,
  because a stop is "the lead's call" (`watch.ts:875-878`). A stop the watch made is not the lead's
  call. Prove or drop; if real, the removal tells the two apart (the record keeps who stopped it).
- `watch.ts:835` reads the whole crew events log on every 20 s pass; the log only grows. Measure the
  cost on a log of realistic size; read only the tail if it matters.
- After a resume copy, is the `crew-self` monitor armed again in the new session
  (`plugin/monitors/monitors.json`, `when: on-skill-invoke:cc-smart-dev-kit:crew`)? If not, every
  `crew answer` to a resumed session falls back to "recorded, not delivered". You cannot run
  `claude --bg` from a crew session: say what you found in the code and what the lead must prove live.

## Files (change nothing else)

`src/crew/**`, `src/sessions/finished.ts` and `src/sessions/command.ts` (the ids only), their tests,
`docs/design/crew.md`, `plugin/dist/*` (through `bun run build` only), `CHANGELOG.md`.

## Done-check

The targeted tests, then `bun run build`, `bun run check`, and both `claude plugin validate …
--strict`. Your own review, then one second opinion: the `cc-smart-dev-kit:reviewer` agent on
`opus` at `xhigh`. Never touch the real `~/.claude`, `~/.config`, `~/.local` or port 20100. Run
`bun install` in your own worktree; never link another checkout's `node_modules`.
