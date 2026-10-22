---
name: lead
description: Use when a plan's phases go to crew sessions, in a project with crew sessions on. Register the lead, start each phase with `cc-smart-dev-kit crew start`, hear the news without waiting, route the questions, merge the branches. Trigger phrases - "start the crew", "run the plan", "next wave".
---

# Lead The Crew

**Project add-on:** `.claude/cc-smart-dev-kit/lead.md` — read it first when it exists. Where it
differs, the add-on wins (`core.md`, top).

You lead; crew sessions build. A **crew session** is a background Claude Code session in its own worktree,
on its own branch: it builds one phase end to end, runs its own review, commits, and hands back
a report (`/cc-smart-dev-kit:crew`). You plan, start, answer and merge. Where a piece of work
belongs — inline, a subagent or a crew session — is in the core instructions (§ Lead the work).

## 1. The crew on, and this session registered

- **`cc-smart-dev-kit workflow show`** prints `crew.enabled` and where it came from. Off:
  this skill does not apply. The phases go to subagents (`/cc-smart-dev-kit:plan-task` § 5).
  Turning crew sessions on is the person's choice, never yours.
- **Register once per leading session:** `cc-smart-dev-kit crew lead --plan <plan slug>`. It
  names the session `LEAD <tag> <plan>` and prints a `/rename` line: give it to the person, who
  types it once so agent view shows the name. `crew start` refuses until this session is a
  lead.

## 2. Split the plan into phases

The phases, their waves and what stays with you follow `/cc-smart-dev-kit:plan-task` § 5:
30 to 90 minutes each, contracts first and alone, then disjoint file sets. For crew sessions, also:

- **A phase far under 30 minutes** joins a neighbour, or goes to a subagent: a crew session's start
  and review cost more than it saves.
- **The contracts phase is merged** before the wave that uses it starts.
- **Each brief says the crew session never touches the shared files** that stay yours.
- **Each phase gets a kind**, and the kind picks the model and the effort:
  `cc-smart-dev-kit crew kinds` (or `crew --help`) lists each kind with its model. Pick
  the kind of the phase's riskiest part; a kind that runs on opus is for design judgment, never
  a way to get a stronger builder. `ui` is opus at `high` — never an affordable model, because
  UI/UX design is not affordable work — and `crew start` refuses an override that would put it
  there. Override `--model` or `--effort` only when the person asks.

## 3. Start each phase

```sh
cc-smart-dev-kit crew start <phase> --slug <slug> --kind <kind> --brief <file> \
  --files <glob,...> [--waits-for <phase,...>] [--base <ref>]
```

- **At plan approval, start the whole plan at once**, in one message: every phase of every
  wave, each later one with `--waits-for` the phases it builds on. You never keep a list of what
  is ready: the queue and the watch start each phase when what it waits for is merged and a
  place is free. Each call returns at once with one line: `started`, `queued` or `failed`, with
  the reason. Your reply names each crew session with the model and effort its line shows (the
  core instructions' "say it when you launch").
- **`queued` is not an error.** A cap, the free memory or `--waits-for` holds it, and it starts
  by itself when its place frees. Never start it a second time.
- **`--waits-for <phase,...>`** holds a phase until each of those is merged (or removed). The
  watch marks a merged branch and starts the waiting session by itself, cut from your branch
  with the merge in it. A phase the plan adds later is started the moment it is written.
- **`failed`:** read the reason and fix that. `Workspace not trusted`: the person opens the
  repository once with `claude` and accepts the trust prompt.

**The brief** is a file (`--brief <file>`, or `-` for stdin). `crew start` adds a frame after
it — who the crew session is, its worktree and branch, the git rule, how it reports and asks — so the
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

Running this skill starts the `crew-events` monitor. It prints one line per change of your
crew sessions — a start, a step, a question, a permission wait, a quiet crew session, a report, a crash, a
queued crew session that started, a note one crew session told another — and each line reaches you as a notification, also when you are
idle. So after the starts, **go on**.

**On each line, act in that turn:**

| The line | You |
|---|---|
| a hand-back (`<name>: done`) | check and merge it (§ 6); the watch starts the phases that waited for it |
| `question`, a technical one | answer it (§ 5) |
| `question`, one that is the person's | `AskUserQuestion` (§ 5) |
| `needs you` (a permission wait) | give the person `claude attach <name>` |
| `told` (one crew session told another a contract change or question) | nothing, unless it changes the plan or the two cannot settle it: then `crew answer` both |
| `failed`, `blocked`, `quiet`, a turn ended with no report | § 6 |
| `paused` (a model limit) | nothing: the watch resumes it once the gateway answers again, one first and the others 30 s apart; after `/login` on another account, `cc-smart-dev-kit crew resume --paused` |

**Between lines:** the integration work that is yours — the merges, the full check after each,
the shared files, the plan file — and stay free for the person. **Never poll, wait or sleep.**
A turn that ends with a ready phase not started is a fault: before you end the turn, every
phase whose waits are met runs or is queued.

**Where monitors do not run** (telemetry off: `DISABLE_TELEMETRY` in the environment or in a
settings file's `env`), run `cc-smart-dev-kit crew watch --once` with
`run_in_background: true`. It ends on the next change, and its end starts your next turn. Act
on the line, then start the next `--once` in the same turn. **On native Windows** the plugin's
monitors need Git Bash, and whether Claude Code starts one through it there is not yet proved:
until it is, treat `--once` as the way you hear, and the `lead-notes` hook as the safety net
(`docs/windows-setup.md`).

**A line the monitor could not deliver reaches you at your next turn**: the `lead-notes` hook
adds the newest news since your last turn, plus how many more there were. It never repeats one,
so take it as news, not as a summary of everything.

One `cc-smart-dev-kit crew list` or `crew status <name>` when you need a look is fine; a
repeat of it is a poll.

**Several lines at once** are handled in one turn: first start what they unblocked, then the
questions (all of the person's in one `AskUserQuestion`), then the merges in the plan's order.

## 5. A crew session's question

A crew session never asks the person. Its question reaches you with its options and the one it
recommends, and the crew session goes on with what the question does not block.

- **The plan settles it, or it is a technical detail inside the phase:** answer it yourself.
- **It is the person's** — architecture, scope, UX, a trade-off, anything the plan names as an
  owner decision: ask with `AskUserQuestion`, with the crew session's options, its recommendation
  first, and which crew session asks. Several crew sessions' questions go in one call. Never answer one of
  these for the person.
- **Send the answer:** `cc-smart-dev-kit crew answer <name> "<answer>"`. A running crew session
  gets it as a message; a stopped one is resumed with it.
- **A permission prompt in a crew session** only the person answers. Name the crew session and give the
  line `claude attach <name>`.

## 6. A hand-back: check, merge, start

A `done` report is the crew session's word that its phase is ready. Your gate is mechanical:

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
   to a new crew session.
5. **In the same turn,** check that the watch started the phases that waited for this merge,
   and start any phase it unblocked that was never started (§ 3).

**Read the diff only when something does not add up** — a red line in the report, a file
outside the brief, a failed check after the merge, a report that contradicts itself — and then
only the part that does not.

**`failed` or `blocked`:** read why. Blocked on a question: § 5. Failed: a corrected brief and
a new crew session (`crew start` with a new slug), or the phase back into the plan.

**The end of a crew session.** A crew session never outlives its work: each one holds hundreds of MB.
Once you merged its branch, the watch marks it `merged` and ends its session;
`cc-smart-dev-kit crew rm <name>` removes its worktree, branch and record.

## 7. Caps and the queue

`workflow show` prints the caps: `crew.max` (every crew session on the machine, across leads) and
`crew.maxOpus` (those on the opus tier). Routine phases on the worker slot run wide; the opus
phases — the kinds that run on opus — queue, so put those that unblock the most first. Your own
Opus subagents share the same usage window: at most 3 at once.

## 8. Hand-offs

A crew session near its context line or its time cap commits its work in progress and reports
`handoff`. Start the next one from where it stopped:
`cc-smart-dev-kit crew start <phase> --continue <name>` — a new crew session from the old head, with
the brief and the hand-off report, its name ending in ` 2`. A phase that hands off again and
again is too big: split what is left.

## 9. Restart and compaction

The plan file and the crew store hold the state, not your context. After a compaction: read
the plan, then one `crew list`. After this session restarts: the same, and run this skill
again so its monitor runs. After the machine restarts: `cc-smart-dev-kit crew resume <name>`
for each stopped crew session — never `claude respawn --all`, never `claude daemon stop`.

## 10. The integration review, and the end

Each crew session's phase carries its own review. Your own integration commits get one small review
before the push (`/cc-smart-dev-kit:review` § Second opinion). Then the push, the pull request
and the merge go as the workflow says (`/cc-smart-dev-kit:commit`). The plan's last wave, the
heavy cleanup, starts only once everything is verified live (`/cc-smart-dev-kit:plan-task` § 5).

## Never

- Wait, `sleep` or poll; ask a crew session whether it is done.
- End a turn with a ready phase not started, or start the plan one wave at a time.
- Build a phase yourself, or read a crew session's whole diff to check it.
- Start a crew session from a crew session, or a raw `claude --bg` in place of `crew start`.
- Answer the person's decision for them, or a crew session's permission prompt.
- Leave a merged crew session running.
