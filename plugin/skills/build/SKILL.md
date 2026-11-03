---
name: build
description: Use when "the plan is approved", "start building", "run the plan", "next wave" or "build it" means execute an approved plan. Drives parallel subagents in worktrees, task reviews, fixes, merges and the final branch review. The kit's task system is the ledger.
---

# Build The Approved Plan

**Project add-on:** `.claude/cc-smart-dev-kit/build.md` — read it first when it exists.
The project's instructions win where they differ from this skill.

The main session coordinates. Fresh builders implement phases; they never start agents or
review themselves. Keep narration to a short line. Do not ask whether to continue between
phases. Speed comes from parallel work, not skipped checks.

## 1. Read the design and ledger

Read the approved plan and its binding spec. Run `task_list` with `scope: "plan"` and
`open_only: false`, then `task_get` for each relevant phase and its notes. If the tree is
missing, create it as `/cc-smart-dev-kit:plan-task` describes: plan, phase tasks, steps.
The phase description is its complete brief; never make a second brief or progress file.
Task fields and the CLI fallback belong to `/cc-smart-dev-kit:memory-routing`.

Work on the plan branch in its worktree. Read `cc-smart-dev-kit workflow show` before git
side effects. Record the plan's starting commit on its task. Check each phase's files,
contracts and blockers. Order phases sharing a file with `blocked_by`; disjoint phases
run together. Batch small same-shape edits into one phase dispatch.
Scale dispatches to the work: one for a small fix, two to four for a few independent parts,
and up to the session cap for a large plan with clearly divided files. The core table
chooses model and effort per job; delegation alone does not improve an answer.

The kit defaults to 10 running subagents per session through Claude Code's own
`CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS`. Setup writes the managed value and preserves a
person's own value; `setup --max-subagents <n>` changes the kit's. This is not a kit queue.
If a launch fails at the cap, wait for a hand-back, then dispatch the next ready task;
never retry the refused launch in a loop. Count reviewers and scouts in the same capacity.

## 2. Start the ready wave in one message

For each ready phase, mark it `in_progress` and record its starting commit as `base`.
Choose a fresh builder (or rules-maintainer for instruction files) and explicit `model`
and `effort` from the core table. Announce the slot, model and effort. Send all independent
`Agent` calls in one message, each with `isolation: "worktree"` and
`run_in_background: true`. Do not start one and wait before starting the others.

Put caller rulings first: commit or not, allowed checks, rephrase a refused read-only
command once, and decide small calls with a `Ruling:` note. The brief has four parts:
objective, files and boundaries, patterns/tools, and output format.
Every launch brief includes the exact line `Your task: #<n>` with the phase number.
The hand-back guard reads that line and refuses a return while blocking steps remain open.
The launch prompt says: read that task with `task_get` first;
its description is the brief. Include only required interfaces or rulings not yet in that
brief. Allow commits on its own worktree branch, never a push. Require a `Report:` task
note and a short return: status, commits, test result and concerns. No nested agents,
self-review, questions to the person or writes outside its named files.

Verify each checkout starts from the intended base. If the worktree tool used a different
base, have the builder incorporate the required plan commits before implementation and
record the actual starting commit. Never pretend `HEAD~1` covers a multi-commit phase.

Never wait on work you do not need. While agents run, prepare reviews, update tasks or do
shared integration work that does not change files a running check reads. Do not poll;
completion notifications bring results back. End a turn while builders run only with a
`Waiting for: <agents>` line. Otherwise close or start phases before ending. The keep-going
Stop guard refuses a turn end when a phase is `in_progress`, no subagent runs, and no
`Waiting for:` line explains the wait; it names the next ready phase. Do not invent a wait
to pass it: dispatch ready work, or record the real blocker.

## 3. Handle each hand-back and review the task

Read its `Report:` note and check its claims against the actual branch. Record `agent`,
`branch`, `worktree` and `base` on the phase task with `task_update`. Check its full
`base..branch` diff and file list; a report is not proof. A blocked builder gets a ruling
or the missing context, not an automatic phase close.

Dispatch a fresh `cc-smart-dev-kit:reviewer` on that checkout with the task number, report note,
base and head commits, owned files and binding constraints. Ask for two verdicts:
**spec compliance** and **task quality**. Use the core review model policy. The builder
never dispatches this review. Keep the reviewed head unchanged until it returns.

Verify findings against the code. Record both verdicts and evidence on the task. Missing
verdicts or unresolved material findings do not pass the gate.

## 4. Fix with the same builder, then escalate

Use `SendMessage` with the recorded builder id to resume its context. Send confirmed
findings, required changes and targeted checks. Have it commit fixes and append a new
`Report:` note. Record the round and resulting commits on the phase task. Request a
scoped reviewer check of the fixes, not another open-ended review of untouched code.

Allow at most three fix rounds with that builder. If it is still stuck, dispatch a fresh
builder on a stronger model, using the same task, current branch, findings and rulings.
Update the task's execution fields. Escalation does not permit Fable building without the
person's request. If no permitted stronger model is available, reassess the approach and
record a ruling; do not repeat the failed loop or silently waive a material defect.

## 5. Merge, close, unblock

Once spec and quality pass, merge the worktree branch into the plan branch. Resolve only
the integration conflicts in your scope and check affected code. Close all blocking steps,
then `task_done` the phase with its commits, checks and verdicts. In that same turn, start
every phase this unblocked; do not wait for unrelated agents or reviews.

After the branch is merged and its work is preserved, remove that builder's worktree and
branch (`/cc-smart-dev-kit:worktree`). Check it is clean and no process uses it first.
Never remove another task's checkout or an unmerged branch. Repeat until all phases close.

## 6. Finish the whole branch once

Start one final `cc-smart-dev-kit:reviewer` on `opus`, effort `xhigh`, over the plan's
complete base-to-head range, including integration work. Review cross-phase behavior,
spec compliance and quality. Do one fix pass for confirmed findings, then run the full
check once in the main session (`/cc-smart-dev-kit:verify-change` § 4). Do not declare
success while a material defect remains; record the blocker and remaining work.

Commit, push and open the PR only as `cc-smart-dev-kit workflow show` and the person's
permissions allow (`/cc-smart-dev-kit:commit`, `/cc-smart-dev-kit:pull-request`). Include
phase verdicts, final review and real checks. Close the plan with evidence and archive its
design as the plan skill describes. Remove only merged, finished worktrees and branches.

## Rulings, not stalls

Decide ordinary ambiguities in the main session. Save each as a `task_note` starting
`Ruling: <decision> — <reason> — <cost if wrong>`, then continue. Stop only for:

- a destructive or irreversible step;
- a security-sensitive step;
- an outside-worktree side effect that needs a yes, such as push, shared merge or publish;
- a plan so broken that every path is a guess.

A stop holds only work that depends on it. If the person is away, park the required yes
with `/cc-smart-dev-kit:user-unavailable`; never bypass a permission refusal.

## After compaction

Run `task_list` with `scope: "plan"`, `open_only: false`, and read `git log`. Use task
fields, `Report:` and `Ruling:` notes to recover the exact branches and review state.
Read the plan for design, not progress. Never rerun a completed phase from memory.
