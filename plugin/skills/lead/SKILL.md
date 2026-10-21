---
name: lead
description: Use when a plan's phases go to worker sessions, in a project with workers on. Register the lead, start each phase with `cc-smart-dev-kit worker start`, hear the news without waiting, route the questions, merge the branches. Trigger phrases - "start the workers", "run the plan", "next wave".
---

# Lead Worker Sessions

**Project add-on:** `.claude/cc-smart-dev-kit/lead.md` — read it first when it exists. Where it
differs, the add-on wins (`core.md`, top).

You lead; workers build. A **worker** is a background Claude Code session in its own worktree,
on its own branch: it builds one phase end to end, runs its own review, commits, and hands back
a report (`/cc-smart-dev-kit:worker`). You plan, start, answer and merge. Where a piece of work
belongs — inline, a subagent or a worker — is in the core instructions (§ Lead the work).

## 1. Workers on, and this session registered

- **`cc-smart-dev-kit workflow show`** prints `workers.enabled` and where it came from. Off:
  this skill does not apply. The phases go to subagents (`/cc-smart-dev-kit:plan-task` § 5).
  Turning workers on is the person's choice, never yours.
- **Register once per leading session:** `cc-smart-dev-kit worker lead --plan <plan slug>`. It
  names the session `LEAD <tag> <plan>` and prints a `/rename` line: give it to the person, who
  types it once so agent view shows the name. `worker start` refuses until this session is a
  lead.

## 2. Split the plan into phases

The phases, their waves and what stays with you follow `/cc-smart-dev-kit:plan-task` § 5:
30 to 90 minutes each, contracts first and alone, then disjoint file sets. For workers, also:

- **A phase far under 30 minutes** joins a neighbour, or goes to a subagent: a worker's start
  and review cost more than it saves.
- **The contracts phase is merged** before the wave that uses it starts.
- **Each brief says the worker never touches the shared files** that stay yours.
- **Each phase gets a kind**, and the kind picks the model and the effort:
  `cc-smart-dev-kit worker kinds` (or `worker --help`) lists each kind with its model. Pick
  the kind of the phase's riskiest part. Override `--model` or `--effort` only when the person
  asks.

## 3. Start each phase

```sh
cc-smart-dev-kit worker start <phase> --slug <slug> --kind <kind> --brief <file> \
  --files <glob,...> [--waits-for <phase,...>] [--base <ref>]
```

- **Start every phase of a wave in one message.** Each call returns at once with one line:
  `started`, `queued` or `failed`, with the reason. Your reply names each worker with the model
  and effort its line shows (the core instructions' "say it when you launch").
- **`queued` is not an error.** A cap, the free memory or `--waits-for` holds it, and it starts
  by itself when its place frees. Never start it a second time.
- **A phase that builds on another phase's code starts after you merged that phase**, in the
  same turn as the merge. `--waits-for` only orders phases: it counts a phase finished once it
  is `done`, before you merge it, and the waiting phase is cut from your branch as it is then.
- **`failed`:** read the reason and fix that. `Workspace not trusted`: the person opens the
  repository once with `claude` and accepts the trust prompt.

**The brief** is a file (`--brief <file>`, or `-` for stdin). `worker start` adds a frame after
it — who the worker is, its worktree and branch, the git rule, how it reports and asks — so the
brief carries only the phase:

- the goal and why it matters, the plan file and the phase's section;
- its files (also in `--files`), and "change nothing else";
- the decisions already made that bite here, quoted from the plan; the patterns to copy
  (`file:line`); the contracts it builds on, already merged;
- the edge cases it must handle, and the docs it updates;
- its done-check: the targeted tests, then the whole suite and the project's checks;
- what only you do: the shared files.

How to brief well, and how to brief an affordable model: `/cc-smart-dev-kit:subagent-decision`
§ How to brief.

## 4. Hear the news — never wait

Running this skill starts the `worker-events` monitor. It prints one line per change of your
workers — a start, a step, a question, a permission wait, a quiet worker, a report, a crash, a
queued worker that started — and each line reaches you as a notification, also when you are
idle. So after the starts, **go on**: answer, merge, plan the next wave, or end the turn.

**Where monitors do not run** (telemetry off: `DISABLE_TELEMETRY` in the environment or in a
settings file's `env`), run `cc-smart-dev-kit worker watch --once` with
`run_in_background: true`. It ends on the next change, and its end starts your next turn. Act
on the line, then start the next `--once` in the same turn.

One `cc-smart-dev-kit worker list` or `worker status <name>` when you need a look is fine; a
repeat of it is a poll.

**Several lines at once** are handled in one turn: first start what they unblocked, then the
questions (all of the person's in one `AskUserQuestion`), then the merges in the plan's order.

## 5. A worker's question

A worker never asks the person. Its question reaches you with its options and the one it
recommends, and the worker goes on with what the question does not block.

- **The plan settles it, or it is a technical detail inside the phase:** answer it yourself.
- **It is the person's** — architecture, scope, UX, a trade-off, anything the plan names as an
  owner decision: ask with `AskUserQuestion`, with the worker's options, its recommendation
  first, and which worker asks. Several workers' questions go in one call. Never answer one of
  these for the person.
- **Send the answer:** `cc-smart-dev-kit worker answer <name> "<answer>"`. A running worker
  gets it as a message; a stopped one is resumed with it.
- **A permission prompt in a worker** only the person answers. Name the worker and give the
  line `claude attach <name>`.

## 6. A hand-back: check, merge, start

A `done` report is the worker's word that its phase is ready. Your gate is mechanical:

1. **The report:** status `done`; the whole suite and the checks green; the review recorded,
   each finding with its fix; no file outside the brief without a reason; nothing left open
   that the phase needed.
2. **The merge check:** `cc-smart-dev-kit workflow merge-check --branch <branch> --base <your
   branch>` says whether the recorded review covers the branch head. Where the installed kit has
   no such command yet, check that the report's review commit is the head, or that the fixes
   after it are small.
3. **Merge locally, one at a time, in the plan's order:** contracts first, then a branch that
   others build on. `git merge --no-ff <branch>` on your branch. A conflict is yours to resolve.
4. **One full check after each merge, in the background** (`run_in_background: true`); go on
   while it runs. A failure belongs to the merge it followed: fix it on your branch, or give it
   to a new worker.
5. **In the same turn,** start every phase the merge unblocked (§ 3).

**Read the diff only when something does not add up** — a red line in the report, a file
outside the brief, a failed check after the merge, a report that contradicts itself — and then
only the part that does not.

**`failed` or `blocked`:** read why. Blocked on a question: § 5. Failed: a corrected brief and
a new worker (`worker start` with a new slug), or the phase back into the plan.

**The end of a worker.** A worker never outlives its work: each one holds hundreds of MB.
Once you merged its branch, the watch removes it; if `worker list` still shows it, run
`cc-smart-dev-kit worker rm <name>`.

## 7. Caps and the queue

`workflow show` prints the caps: `workers.max` (every worker on the machine, across leads) and
`workers.maxOpus` (those on the opus tier). Routine phases on the worker slot run wide; opus
phases queue, so put the opus phases that unblock the most first. Your own Opus subagents share
the same usage window: at most 3 at once.

## 8. Hand-offs

A worker near its context line or its time cap commits its work in progress and reports
`handoff`. Start the next one from where it stopped:
`cc-smart-dev-kit worker start <phase> --continue <name>` — a new worker from the old head, with
the brief and the hand-off report, its name ending in ` 2`. A phase that hands off again and
again is too big: split what is left.

## 9. Restart and compaction

The plan file and the worker store hold the state, not your context. After a compaction: read
the plan, then one `worker list`. After this session restarts: the same, and run this skill
again so its monitor runs. After the machine restarts: `cc-smart-dev-kit worker resume <name>`
for each stopped worker — never `claude respawn --all`, never `claude daemon stop`.

## 10. The integration review, and the end

Each worker's phase carries its own review. Your own integration commits get one small review
before the push (`/cc-smart-dev-kit:review` § Second opinion). Then the push, the pull request
and the merge go as the workflow says (`/cc-smart-dev-kit:commit`). The plan's last wave, the
heavy cleanup, starts only once everything is verified live (`/cc-smart-dev-kit:plan-task` § 5).

## Never

- Wait, `sleep` or poll; ask a worker whether it is done.
- Build a phase yourself, or read a worker's whole diff to check it.
- Start a worker from a worker, or a raw `claude --bg` in place of `worker start`.
- Answer the person's decision for them, or a worker's permission prompt.
- Leave a merged worker running.
