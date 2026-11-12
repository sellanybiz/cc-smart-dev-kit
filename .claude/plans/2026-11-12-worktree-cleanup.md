# Worktree cleanup: builders' and sessions' worktrees go after their merge

## Summary

Finished worktrees pile up for days (46 on one server, disk 91% full): five plugin bugs, a
default that leaves a session's own worktree, and Claude Code's deliberate lock on resumable
builders. This plan fixes the bugs and lets the **owner** — the lead for its builders, a
session for its own worktree — remove its finished worktree right after the merge, with every
safety check kept. Its own branch from `main`, its own patch release; separate from Herdr 4.3.1.

## Context

Reported by seven sessions on two machines (2026-11-12), checked in the code and Claude Code
2.1.322's binary, then by the senior engineer's plan read (`opus`, high):

| # | Cause | Proof |
|---|---|---|
| 1 | Idle time reads the **file time** of `.git/worktrees/<n>/logs/HEAD`. `git gc` runs `git reflog expire --all`, which rewrites every worktree's log with nothing changed: every worktree reads "git used it 7 min ago". | Scratch repo: `logs/HEAD` jumped Nov 8 → now; `index`, `HEAD` unchanged. `src/hooks/worktree-leftovers.ts:68` |
| 2 | `staleClaudeLock` / `lockLine` (`src/worktrees/scan.ts:439`, `:555`) read only `claude session …`. Claude Code also writes `claude agent agent-<id> (pid N start S)`, and `(pid N)` with no start when reading its start time takes over 1 s. | Binary: `TN=/^claude (?:agent\|session) .{1,255} \(pid (\d{1,10})(?: start (.{1,255}))?\)$/`. Start = `/proc/<pid>/stat` field 22, as `processStartTime` reads (`docs/claude-code-contract.md:62`). |
| 3 | Claude Code **deliberately** keeps a builder's lock while its task is unfinished or still in the parent's task list, so the agent can be resumed. Every builder stays locked while its lead lives. After a removal Claude Code refuses a resume ("Start a new agent instead"); no work is lost. | Binary (review). Live: on session resume the locks went and the auto-clean removed 4. |
| 4 | `removeWorktree` runs `git worktree remove` under `runGit`'s 15 s default. A Next.js worktree takes longer: git is killed mid-delete, leaving `<name>-removing-<time>`. | `scan.ts:741`; server: `mcp-tool-trust-removing-…`, 17,715 entries, no `.git`. |
| 5 | A builder merged into its session's branch (not yet in the base) is "N commits not on dev". | `judgeOne` compares with `look.ref` only (`scan.ts:456`). |
| 6 | `worktrees --remove` runs only in the main checkout (`command.ts:301-304`); the lead works in its plan worktree, so the build skill's removal step (`plugin/skills/build/SKILL.md:137`) can never run. | Code. |
| 7 | An ignored `.env.local` copy keeps a worktree once the main checkout's copy changes, though nobody touched the worktree's copy. | `sameAsMain`, `src/hooks/local-files.ts`. |
| 8 | **A finished session never clears its own worktree.** `clearWorktreeAfterMerge` defaults to `false` (`src/workflow/schema.ts:256`). Tried anyway: ExitWorktree `remove` is refused once the branch merged the base; after `keep`, the session's own MCP servers work in the folder and `programsUsing` (`src/worktrees/machine-facts.ts:265`) holds it. | Screenshot, second machine: 20 folders, sessions marked done. |

Not in scope: `.archify/` is the project's cache — it adds `"worktrees": {"rebuildable":
[".archify/"]}` to its `cc-smart-dev-kit.json`. ExitWorktree's refusal is Claude Code's. The git
guard refusing `git -C ../agent-…` stays: cleanup goes through our command.

## Decisions

- **The owner removes; nobody else touches a live owner's lock.** `--clean` and the
  after-merge auto-clean never release the lock of a live session or its builders. What an
  owner missed goes when that session ends, through the stale rule. This respects Claude
  Code's resume hold (cause 3).
- **Owner proof, `--remove` only.** The command walks its own parent chain
  (`/proc/<pid>/stat`); a parent with the lock's pid **and** its start time makes the caller
  the owner, for `claude agent` and `claude session` locks alike (Claude Code's own rule: a
  lock with its own pid is its own). A lock with no start time gives no proof. Linux, initial
  pid namespace only, as the stale rule. `--clean` and the auto-clean never run the walk (the
  auto-clean starts from a hook whose chain still reaches claude). The target must not
  contain the caller's folder (a builder cannot remove itself).
- **"Builder finished" proof = Claude Code's own `subagents/agent-<id>.meta.json`**:
  `"finished": true`, its `worktreePath` is the target, and it is not older than the agent's
  transcript; our SubagentStop record (`agent-usage.jsonl`, by agent id, which lacks the
  `agent-` prefix) is a second witness. Found from the lock's agent id under
  `<config>/projects/*/*/subagents/`. The builder proves, as a contract row, what a SendMessage
  resume does to `meta.json` (clears `finished` or the transcript turns newer). No proof → kept.
- **Stale `claude agent` lock** = its pid gone (or another start time) **and** the finished
  proof; pid gone alone is not enough (a background handoff leaves the old foreground pid).
- **Work held by another live branch (cause 5) lets the folder go, never the branch.** A head
  that is an ancestor of a branch checked out in another listed, present worktree counts as
  held, so the folder may be removed. Its branch is deleted only when the base holds it, as
  today: a reset of the plan branch must not strand the commits. A branch costs no disk.
- **The session's own MCP servers do not hold its worktree (cause 8).** After ExitWorktree
  `keep`, the program check skips a process that is a **direct, non-shell child** of the owner
  session's claude process, and its descendants, when its only tie is its working folder.
  Anything whose chain to claude passes a shell (`sh`, `bash`, `zsh`, `dash`, `fish`, `pwsh` —
  every Bash-tool job, dev server and Monitor) still holds it; so does claude itself, any
  program started from a file inside, and every other session's. Linux only.
- **`clearWorktreeAfterMerge` defaults to `true`** (the person's choice, 2026-11-12). A
  project or machine can still set `false`. The session's flow: its PR merged → stop its dev
  servers and Monitors → ExitWorktree `keep` → `cc-smart-dev-kit worktrees --remove <its
  worktree>` from the main checkout, in the background. Not finished → it says why and stops.
- **Removal time:** one named constant `REMOVAL_TIMEOUT_MS` (10 min) for `git worktree remove`.
  The skills run `--remove` with `run_in_background` (the Bash tool's 2-minute default would
  kill it). A run killed anyway leaves a parked folder, which the sweep (D62) finishes.
- **A busy clean lock no longer reads as success:** `--remove` waits for the machine-wide
  clean lock up to `REMOVAL_TIMEOUT_MS`, then exits 1 with "busy"; never "Nothing done" and 0.
- **Strays:** `--clean` reads the stray folders before its removals (as `finishStrays` needs)
  and again after, and finishes both lists in the same run.
- **Untouched include copies (cause 7):** an ignored file present at the same path in the main
  checkout, not changed since the worktree was set up, is safe. The builder proves whether
  Claude Code's copy keeps the source's file time; the "set up" time is the worktree's first
  reflog entry plus a small named slack (`commondir`'s time as the floor: git writes it once
  at `add`, never on `move`). Edited in the worktree, or absent from the main checkout → kept.
- **Idle (cause 1):** the newest of the last reflog entry's epoch (parsed before the tab, the
  file's tail only), `index` and `HEAD` times; never the log's file time.
- **Play safe vs clean break:** nothing stored changes shape; the default flip is the only
  behaviour change a person sees, and the setting turns it back.

## Files to change

| Phase | Files |
|---|---|
| P1 idle | `src/hooks/worktree-leftovers.ts` (`idleMinutesOrNull`), tests |
| P2 locks and owner | new `src/worktrees/agent-lock.ts` (parse both kinds; owner walk; finished proof from `meta.json` + record), `src/worktrees/scan.ts` (`staleClaudeLock`, `lockLine`, the lock branches of `scanWorktrees`/`removeWorktree`, `ScanOptions` owner flag and fakes), `src/worktrees/command.ts` (`--remove` from a linked worktree, owner mode, lock wait), tests |
| P3 held work, removal, strays | `src/worktrees/scan.ts` (`judgeOne` held-by-branch, `REMOVAL_TIMEOUT_MS`), `src/worktrees/verdict.ts` (the held note), `src/worktrees/command.ts` (strays before and after), tests |
| P4 include copies | `src/hooks/local-files.ts` (`safeEntry`), tests |
| P6 session's own worktree | `src/worktrees/machine-facts.ts` (owner-child skip), `src/worktrees/scan.ts` / `scan-parked.ts` (pass owner facts), `src/workflow/schema.ts` (default `true`), tests |
| P5 skills and docs | `plugin/skills/build/SKILL.md` § 5, `plugin/skills/worktree/SKILL.md`, the workflow and worktrees design pages under `docs/design/`, `docs/claude-code-contract.md` (agent lock forms; the resume hold and refusal; `meta.json` `finished`; ExitWorktree `keep` lock release; the session record's `cwd` after `keep`), `README.md` (`--remove`, the default), `CHANGELOG.md` |
| Main session | version bump, `bun run build`, `plugin/dist`, the full check |

## Patterns to follow

- Machine facts through `ScanOptions.facts` / `MachineLook`, faked in tests
  (`processStartTime`, `processIsGone`, `pidNamespace` already are); add `parentOf(pid)`, the
  process name, and the finished-proof reader the same way.
- `processStartTime` (`src/setup/lock.ts:105`); `readAgentUsage` (`src/hooks/agent-usage.ts:254`);
  the transcript layout read in `src/sessions/transcripts.ts`; `lineage` in `machine-facts.ts`.
- `workOnRef` stays the one "is it merged" answer; the removal re-judges right before the move;
  the unlock keeps its re-check and re-lock dance.
- Tests in temp repos with real `git worktree lock --reason` (`.claude/rules/testing.md`).

## Edge cases

| Case | Handling and test |
|---|---|
| Dev server / Monitor from Bash in the session's worktree | Chain passes a shell → holds. Test: background `zsh -c "sleep 999"` with cwd inside holds it. |
| Transcript written ms after the stop | `meta.json` is the proof. Test: transcript 50 ms newer than the record, `finished:true` → proof. |
| Builder resumed after its stop | `meta.json` / transcript newer → kept. Test with a rewritten fixture. |
| Builder stopped waiting for a ruling, 0 commits, person away | No non-owner release → kept. Test: `--clean` keeps it. |
| Second `--remove` while a removal runs | Waits, then exits 1 "busy". Test with the lock held. |
| Auto-clean started from a hook | Never owner. Test: auto-clean keeps a live owner's builder. |
| Lock with no start time | No owner proof, not stale by start. Test. |
| Pid reused | Start time differs → no owner, stale only with the finished proof. |
| Builder targets itself / a lead targets its current folder | Target holds cwd → refused. |
| Plan branch reset after the folder went | Branch kept until the base holds it. Test. |
| Squash into the plan branch | Not an ancestor → kept. |
| Session record `cwd` after `keep` | Proved live in P6; a contract row. Still inside → kept with its reason. |
| ExitWorktree `keep` leaves a lock (worktree entered, hook-made, other pid) | `--remove` owner proof still applies when the pid is the session's; otherwise kept. |
| Reflog empty, huge, malformed, `GIT_COMMITTER_DATE` set | Tail only; fall back to `index`/`HEAD`. |
| Include copy edited / absent in main | Kept. |
| Stray over `MAX_ENTRIES` | Unchanged (a hunch, not seen); noted as a follow-up if seen. |
| macOS / Windows / sandbox pid namespace | Owner, finished-driven stale and the skip are off; same as today. |

## What could break

`idleMinutesOrNull` feeds the scan, the leftovers note and `/api/worktrees`;
`scanWorktrees`/`removeWorktree` feed `--clean`, `--remove`, the auto-clean and
`finishParked`; `programsUsing` feeds the verdict and `strayKeptWhy`; `safeEntry` feeds removal
and archival; the default flip changes every session's after-merge step. Signatures stay; new
facts are optional with machine defaults.

## Rollback

Revert the pull request and release a new patch; nothing stored changes. A person who wants
the old after-merge behaviour sets `clearWorktreeAfterMerge` to `false`.

## How we prove it

- Failing tests first, one per cause and per row above.
- `bun run check`, `bun run build:check`, both validates.
- Live with the person after release, on one machine: a lead builds and merges a phase, its
  background `--remove` removes the builder folder (branch kept until the base has it); a
  session whose PR merged leaves and removes its own worktree; `--clean` in the main checkout
  clears the builders of sessions that have ended.

## Phases and waves

| Phase | Owner | Blocked by |
|---|---|---|
| P1 idle from reflog entries | builder, `sonnet`, high | — |
| P2 agent locks, owner proof, finished proof, `--remove` from a worktree | builder, `sonnet`, high | — |
| P4 untouched include copies | builder, `sonnet`, high | — |
| P3 held work, removal timeout, strays | builder, `sonnet`, high | P2 (`scan.ts`, `command.ts`) |
| P6 owner-child skip, default flip, live proofs of `keep` | builder, `sonnet`, high | P3 (`scan.ts`) |
| P5 skills and docs | builder, `sonnet`, medium | P1–P4, P6 |

Wave 1: P1, P2, P4. Wave 2: P3. Wave 3: P6. Wave 4: P5. Task reviews: P2, P3, P6 by the
senior engineer on `opus` at high (they decide what gets deleted); P1, P4, P5 on `sonnet`.
Final whole-branch review on `opus` at `xhigh`. Then the release skill.
