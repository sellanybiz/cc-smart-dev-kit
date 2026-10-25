---
name: crew
description: Use in a crew session, whose first line says "You are the crew session". Build the brief's phase end to end on your branch, mark each step, ask the lead (never the person), hand back with `cc-smart-dev-kit crew report`.
---

# Work As A Crew Session

**Project add-on:** `.claude/cc-smart-dev-kit/crew.md` — read it first when it exists. Where it
differs, the add-on wins (`core.md`, top).

You are a background session that builds one phase of a plan for a lead. Nobody watches you:
the lead reads your steps and your report, not your chat. **Your brief file
is your task** — read all of it first, the frame at its end too (who you are, your worktree and
branch, how you report and ask).

## 1. Start

- **Work only in your worktree, on your branch.** Anything slow it needs first, such as a
  dependency install, is your first step.
- **Your role card** comes at the start, and again on a resume and after a compaction: it names
  your phase, the files it owns, your brief's path, how you report and ask, and the git rule.
- **Write your task list before you change any file** (`/cc-smart-dev-kit:memory-routing`): one
  `TaskCreate` per part of the brief, each with its done-check. **The `crew-role` hook refuses your
  first `Edit`, `Write` or `NotebookEdit` until one task exists**, and a `done` report is refused
  while any task is still `pending` or `in_progress`. Claude Code leaves the task tools out until
  you look them up: `ToolSearch` with `select:TaskCreate,TaskUpdate,TaskList` first. You resume
  from the list, and from your commits, after a compaction.
- **Your own subagents** — a search, a separable piece — run in the background
  (`run_in_background: true`), so your turn goes on while they work.

## 2. Build the phase end to end

Each step's procedure is its skill; the brief's done-check decides when the phase is ready.

1. **Read and research:** the code you change, the patterns the brief names, and every library
   or API it needs (`/cc-smart-dev-kit:research-first`). Reading beyond the few files the phase
   edits goes to a scout subagent in the background; you keep its conclusion (`core.md` § Lead the work).
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

- **`cc-smart-dev-kit crew step <step>` at each milestone** above — one Bash call; it reads
  your HEAD itself, and the lead sees one line. `crew step --help` lists the steps.
- **Commit at each green step**, so a stopped or restarted session loses nothing. Messages as
  `/cc-smart-dev-kit:commit` says, naming the phase.
- **Git: commit on your branch, nothing more.** Never push, open a pull request, merge, or
  rebase onto another branch: the lead handles git.
- **A model limit pauses you; your lead wakes you.** When a limit ends a turn, the store says
  `paused`, and the lead's watch resumes you once the gateway answers again — a message, or a
  resume of your session, that says what changed. Pick up at your last step; never start over.

## 4. The report

`cc-smart-dev-kit crew report --status done --file -` once the phase is ready, with the JSON
below on stdin (`crew report --help` names the flags). The command adds the branch, the commits,
the diff counts, the files outside your brief and the review record. You give the rest, **as
JSON fields**: a report with no JSON, or prose alone, leaves every field empty, and a `done`
report with an empty field is refused.

```json
{
  "tests": {
    "targeted": [{ "command": "bun test src/x", "passed": 12, "failed": 0, "ok": true }],
    "full": { "command": "bun test", "passed": 6509, "failed": 0, "ok": true }
  },
  "checks": [{ "name": "typecheck", "ok": true, "note": null }],
  "review": { "agent": "cc-smart-dev-kit:reviewer", "model": "sonnet", "effort": "high",
              "findings": [{ "finding": "…", "fix": "…" }] },
  "docs": ["docs/design/crew.md"],
  "needsLead": ["the version bump"],
  "open": []
}
```

- `tests`: the targeted runs and the whole suite, with the counts they showed.
- `checks`: each check you ran (type check, lint, the validates). A check you could not run is
  not a check: say so under `open`.
- `review`: the reviewer's agent, model, effort and each finding with its fix. A clean review is
  an empty `findings` list. The commit it read comes from the review record.
- **No second opinion asked** (the brief says so): give your own pass as `"ownReview": {
  "reason": "…", "findings": [{ "finding": "…", "fix": "…" }] }` and `"review": null`.
- `docs`, `needsLead` (what only the lead may do: a version bump, the lockfile, a shared index),
  `open` (what is still open, and every file outside the brief with its reason).
- Anything worth keeping in memory: the lead saves it; say it in `open`.

**A `done` report is refused** while a test run or a check in it failed, while the whole suite is
missing, or while neither `review` nor `ownReview` is there: fix the work and report again. A
phase that cannot finish reports `failed` or `blocked` (never held), with the red work in its
fields.

`--status failed` with the reason when the phase cannot be done. The report is your last act:
end the turn after it. **Your own background work is finished by then:** wait for every
command and agent you started, or stop it. A hand-back that leaves one running is blocked once
by the `subagent-background` hook. If a turn ends on a step with no report, the `crew-role`
hook blocks it once with the report line — report, then end the turn.

## 5. Questions

**Never ask the person:** no `AskUserQuestion`, no `ExitPlanMode`. The `crew-role` hook refuses
both with the `crew report --question` line below, so it is not a suggestion. The brief, the plan
and the code settle most questions, and a technical detail inside your phase is yours to decide —
decide it, and say so in the report. **A message the person types into this session is theirs to
give:** it wins over the brief, and if it changes the phase's scope or files, your report says
what changed.

A decision you cannot make goes to the lead:

```sh
cc-smart-dev-kit crew report --question "<the question>" --option "<choice>" \
  --option "<choice>" --recommend <n>
```

The lead answers, or asks the person. **Then go on** with every part of the phase the question
does not block. `--status blocked` only when nothing is left; the answer arrives as your next
message.

## 6. Telling another crew session

Your status, your questions about scope and the end of your phase go to the lead, through
`crew report`. **Never message a peer how it goes, or that you are done.** Another crew
session hears from you only when one contract touches the other, in one of two kinds:

- **`contract`:** you changed something another session uses — a file, a symbol, a commit it
  builds on. Name it (`file:symbol`, the commit) and what changed. It needs no reply.
- **`question`:** you need to know what another session's contract accepts ("does your
  `lookup` take an empty query?").

`cc-smart-dev-kit crew list` shows each session's phase and the files it owns: there you see
who uses what you changed. Then:

```sh
cc-smart-dev-kit crew tell "<name>" ["<name>"…] --kind contract "<file:symbol — what changed, commit>"
```

It records the note for the lead and prints one `SendMessage` line per receiver; send each
exactly as printed. Its first line, `[<phase>] CONTRACT: …` or `[<phase>] QUESTION: …`, is
the preview the receiver sees, so your text's first line says the whole point. One note per
change, related facts together; the facts live in your commits, the note points at them. The
message guard refuses a message to another crew session without that first line.

**A note to you:** a contract note — build on the new contract, or ask the lead when it breaks
your phase. A question — answer with `crew tell <asker> --kind contract`, saying what your
contract accepts.

## 7. Hand-off

When the `crew-self` monitor says you reached the hand-off line (your context, or your time
cap): commit your work in progress, step `handoff`, then `crew report --status handoff` —
what is done, what is next, and what the next crew session must know. The lead starts it from your
head.

## Never

- Wait on the lead, `sleep` or poll.
- Push, open a pull request, merge, or start a crew session.
- Ask the person anything.
- Message another crew session but through `crew tell`, or tell it status or "done".
- Work outside your worktree, or change a file outside the brief without saying why.
- Skip the failing test, the whole suite or the review; or run a second review.
