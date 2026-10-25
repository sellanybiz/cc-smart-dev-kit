# RX3 — the release review's setup, project and portal findings (1.3.0)

Your branch starts from `release-1.2.1`, the 1.3.0 release (version already 1.3.0: the lead owns
`plugin/.claude-plugin/plugin.json`, the installers' version lines and the CHANGELOG's intro; add
your own CHANGELOG lines under `## 1.3.0` only when a fix changes what a user sees). The plan:
`.claude/plans/2026-10-21-master-plan.md` § Release 1.3.0 (planned as 1.2.1), its close.

These are findings of the release's split review (2026-10-25: four tracks on `opus` at `xhigh`, each
finding checked by a second `opus` reviewer that tried to refute it). Each one names the trigger, the
real outcome and the missing guard. **Fix each at its cause, with a test seen failing first.** If,
with the code in hand, you can show a finding is wrong, do not change the code: say why in your
report. The "judge" items are hunches: prove or drop each, and say which.

Read `.claude/rules/setup-and-managed-files.md`, `.claude/rules/setup-commands.md`,
`.claude/rules/portal.md` and `.claude/rules/cc-smart-dev-kit-json.md` first.

## The findings

1. **Setup puts back a `remoteControlAtStartup` the person deleted** (`src/setup/remote-control.ts:45`):
   run 1 writes `true`; the person removes the key (by hand, or `/config` → default, which removes it:
   `docs/claude-code-contract.md:374`); run 2 drops setup's record ("left alone"); run 3 sees no key
   and no record and writes `true` again, against README § Remote Control and `docs/design/setup.md`.
   Fix: a lasting record that setup released it (the way setup remembers the status line's "no",
   `statuslineDeclinedFile`), so `planRemoteControl` leaves an absent key alone after that; `restore`
   keeps working. Extend the test "a key the person deleted is not put back" to a third run.
2. **`workflow set` leaves a `requires` that 1.2.0 wrote too low** (`src/workflow/write.ts:181`): it
   compares `requiresFloor(new fields)` with `requiresFloor(old fields)`, never with the file's real
   `requires`, so a file 1.2.0 wrote with `crew.handoffTokens` and `requires: ">=1.0"` stays too low,
   and an older teammate's plugin refuses the whole file. Fix: raise when the needed version is above
   the lowest version the file's own `requires` allows (`lowestAllowed`, `src/project/init.ts`);
   `raisedRequires` never lowers it. Also a `doctor` project check (`src/cli/project-checks.ts`): a
   `requires` below `requiresFloor(file)` warns and names `workflow set` / `project init` as the fix
   (`.claude/rules/command-output.md`). Tests for both.
3. **The portal starts heavy child processes on every live refresh** (`src/portal/api/work.ts:599`,
   `:249`, `:441`): each `/api/needs` read runs `readCleanupOffLoop` (a `crew cleanup --json` child that
   builds discard facts: about 10 git children per stopped record, a whole-worktree `git diff
   --binary`), and each `/api/work` and crew-detail read starts `claude agents --json --all`; the
   header reads `needs` on every `crew`/`state`/`update`/`doctor` event (300 ms debounce), and reads
   overlap on a busy machine. The "no cache" comment is right for a removal, not for a page read. Fix:
   keep the removal paths uncached (`src/portal/actions.ts:2107-2154`, `removeFinishedSession` re-read);
   for the GET answers, a short cache with one in-flight promise each (the way
   `PROJECT_BRANCHES_CACHE_MS` works), or give `/api/needs` only the count and build the discard facts
   on the Needs page. Test: two reads inside the window start one child.
4. **Design docs behind the code:**
   - `docs/design/portal.md:665` lists every portal action but not EF2's `slot.effort` (the Slots page's
     effort pin: asks first, runs `gateway effort <slot> <target> <level>|off`, shows the test request
     and a refusal in place, only while the slot is Custom); add it, and one line in `docs/gateway.md` §
     A backend target's effort pin that the portal's Slots page sets it the same way.
   - `docs/design/workflow.md:94` says the other `crew.*` keys are read by nothing; `crew.archiveDays`
     is read (`archiveDaysOf`, `src/crew/archive.ts:589`: `crew rm`, the watch's removal, `sessions
     --finished`). Add its row, and check which keys the "nothing yet" row still covers.

## Judge

- `src/jobs/windows.ts:153` (CL2) treats only `ESRCH` as "gone"; nothing proves which code Bun throws
  for `process.kill(deadPid, 0)` on native Windows (`docs/windows-jobs.md:47` says only "throws"). If it
  is another code, the Windows job wait and the worktree scan never see a dead process as gone. The
  Windows CI job runs `scripts/windows-hook-smoke.sh`: add a small proof there, or keep the old
  any-error rule on Windows until it is proved — say which.
- `planRemoteControl` (`src/setup/remote-control.ts:41`) reads `settings.json` outside
  `applyManagedJson`'s retry. Check whether a concurrent write can make it plan from a stale file.

## Files (change nothing else)

`src/setup/remote-control.ts`, `src/setup/` state helpers it needs, `src/cli/setup.ts` (only where it
calls the plan), `src/workflow/write.ts`, `src/project/init.ts`, `src/cli/project-checks.ts`,
`src/portal/api/**`, `src/portal/actions.ts` (read only, unless the cache needs a hook there),
`src/jobs/windows.ts` and `scripts/windows-hook-smoke.sh` (the judge item only), their tests,
`docs/design/setup.md`, `docs/design/portal.md`, `docs/design/workflow.md`, `docs/gateway.md`,
`docs/windows-jobs.md`, `README.md` (the Remote Control and `requires` notes only),
`plugin/dist/*` (through `bun run build` only), `CHANGELOG.md`. If a portal view changes,
`bun run build:portal` and `plugin/portal-ui/**`.

## Done-check

The targeted tests, then `bun run build`, `bun run check`, and both `claude plugin validate …
--strict`, and `bun run check:portal` with `cd portal && bun run test` if the portal changed. Your own review, then one second opinion: the `cc-smart-dev-kit:reviewer` agent on
`opus` at `xhigh`. Never touch the real `~/.claude`, `~/.config`, `~/.local` or port 20100. Run
`bun install` in your own worktree; never link another checkout's `node_modules`.
