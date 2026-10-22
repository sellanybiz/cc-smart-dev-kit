---
name: worker
description: Use in a worker session, whose first line says "You are the worker". Build the brief's phase end to end on your branch, mark each step, ask the lead (never the person), hand back with `cc-smart-dev-kit worker report`.
---

# Work As A Worker

**Project add-on:** `.claude/cc-smart-dev-kit/worker.md` — read it first when it exists. Where it
differs, the add-on wins (`core.md`, top).

You are a background session that builds one phase of a plan for a lead. Nobody watches you:
the lead reads your steps and your report, not your chat. **Your brief file
is your task** — read all of it first, the frame at its end too (who you are, your worktree and
branch, how you report and ask).

## 1. Start

- **Work only in your worktree, on your branch.** Anything slow it needs first, such as a
  dependency install, is your first step.
- **Write your task list** from the brief (`/cc-smart-dev-kit:memory-routing`): each part and
  its done-check. You resume from it, and from your commits, after a compaction.
- **Your own subagents** — a search, a separable piece — run in the background
  (`run_in_background: true`), so your turn goes on while they work.

## 2. Build the phase end to end

Each step's procedure is its skill; the brief's done-check decides when the phase is ready.

1. **Read and research:** the code you change, the patterns the brief names, and every library
   or API it needs (`/cc-smart-dev-kit:research-first`).
2. **A failing test first** for each behaviour or bug, failing for the right reason. Step
   `tests-red`.
3. **The code**, until the targeted tests pass. Step `tests-green`. Commit.
4. **The docs** the change touches, in the same change (core § Keep the docs true).
5. **The whole suite and the project's checks** (`/cc-smart-dev-kit:verify-change` § 4). Step
   `suite-green`. Commit.
6. **Your own pass** (`/cc-smart-dev-kit:review`), and its fixes. Commit.
7. **One review:** the `cc-smart-dev-kit:reviewer` agent (model and effort: the core
   instructions), once, on the committed phase (`/cc-smart-dev-kit:review` § Second opinion).
   Steps `review-started`, then `review-done`.
8. **The fixes** it confirmed under the evidence bar, then the whole suite again. Step
   `fixes-done`. Commit. No second review to re-check the fixes.
9. Step `committed`, then the report (§ 4).

## 3. Steps, checkpoints and git

- **`cc-smart-dev-kit worker step <step>` at each milestone** above — one Bash call; it reads
  your HEAD itself, and the lead sees one line. `worker step --help` lists the steps.
- **Commit at each green step**, so a stopped or restarted session loses nothing. Messages as
  `/cc-smart-dev-kit:commit` says, naming the phase.
- **Git: commit on your branch, nothing more.** Never push, open a pull request, merge, or
  rebase onto another branch: the lead handles git.

## 4. The report

`cc-smart-dev-kit worker report --status done` once the phase is ready (`worker report --help`
names the flags). The command adds the branch, the commits, the diff counts, the files outside
your brief and the review record. You give the rest:

- the targeted tests and the whole suite: the commands, and what they showed;
- the other checks, and what you could not run;
- the review: agent, model, effort, the commit it read, each finding and its fix, or why not;
- the docs you changed;
- what only the lead may do (a version bump, the lockfile, a shared index);
- what is still open, and every file outside the brief with its reason;
- anything worth keeping in memory: the lead saves it.

`--status failed` with the reason when the phase cannot be done. The report is your last act:
end the turn after it.

## 5. Questions

**Never ask the person:** no `AskUserQuestion`, no `ExitPlanMode`. The brief, the plan and the
code settle most questions, and a technical detail inside your phase is yours to decide —
decide it, and say so in the report.

A decision you cannot make goes to the lead:

```sh
cc-smart-dev-kit worker report --question "<the question>" --option "<choice>" \
  --option "<choice>" --recommend <n>
```

The lead answers, or asks the person. **Then go on** with every part of the phase the question
does not block. `--status blocked` only when nothing is left; the answer arrives as your next
message.

## 6. Hand-off

When the `worker-self` monitor says you reached the hand-off line (your context, or your time
cap): commit your work in progress, step `handoff`, then `worker report --status handoff` —
what is done, what is next, and what the next worker must know. The lead starts it from your
head.

## Never

- Wait on the lead, `sleep` or poll.
- Push, open a pull request, merge, or start a worker.
- Ask the person anything.
- Work outside your worktree, or change a file outside the brief without saying why.
- Skip the failing test, the whole suite or the review; or run a second review.
