---
name: lead
description: Use when an approved plan's phases are ready to build, in a project with crew sessions on (`.claude/cc-smart-dev-kit.json` sets `workflow.crew.enabled`). Register the lead, write each phase's brief, start every phase with `cc-smart-dev-kit crew start` at once (later phases with `--waits-for`), hear the news without waiting, route the questions, merge the branches. Trigger phrases - "the plan is approved", "start building the plan", "start building it", "start the crew", "run the plan", "next wave".
---

# Lead The Crew

**Project add-on:** `.claude/cc-smart-dev-kit/lead.md` — read it first when it exists. Where it
differs, the add-on wins (`core.md`, top).

You lead; crew sessions build. A **crew session** is a background Claude Code session in its own worktree,
on its own branch: it builds one phase end to end, runs its own review, commits, and hands back
a report (`/cc-smart-dev-kit:crew`). You plan, start, answer and merge.

## Your crew builds

**The code, the tests, research across many files and long debugging go to your crew** — a crew
session (`crew start`), or a scout subagent (`haiku`) for the reading a brief needs. A fix far
under 30 minutes may go to a subagent while a place is free, but a building phase never goes
around the crew queue.

You keep what only you can do: the plan and its briefs, the starts, the questions, the merges
with one full check after each, the plan file, and the person.

Why: this session's context is re-read on the premium model at every turn, so every file it
reads or writes costs on every later turn. A crew session does the same work on the worker slot
and ends.

The core instructions' "inline, yourself: what a handful of tool calls finish" (`core.md` § Lead
the work) is an ordinary session's rule. A lead follows this section instead.

## 1. The crew on, and this session registered

- **`cc-smart-dev-kit workflow show`** prints `crew.enabled` and where it came from. When the shell cannot run,
  read `workflow.crew.enabled` in the project's `.claude/cc-smart-dev-kit.json` (it may also come
  from your own workflow file).
  Off: this skill does not apply. The phases go to subagents (`/cc-smart-dev-kit:plan-task` § 5).
  Turning crew sessions on is the person's choice, never yours.
- **Keep your own task list** (`TaskCreate`, after a `ToolSearch` for the task tools):
  the person's asks and your open work — each phase to start, each question to answer, each
  branch to merge. The `lead-notes` hook adds one line at every prompt while the list is empty,
  so it never goes stale unseen; you are never held back by it.
- **Register once per leading session:** `cc-smart-dev-kit crew lead --plan <plan slug> --plan-file <plan file>`.
  The plan file is the one the plan-task skill wrote; its folder, beside it, holds the briefs and the
  record of each crew run (§ 3). Leave the flag out only when the plan is the one file
  `<plans dir>/*-<plan slug>.md`: the first line it prints says which file it took, or that it found
  none. It
  names the session `LEAD <tag> <plan>`; the session takes that name at its next prompt by
  itself (no setting; it replaces the name the session had, and a name the person gives it
  with `/rename` after that stays), so there is nothing for the person to type. Only a session
  id no name record can be made for, or a project running its own `lead-notes` hook, gets a
  `/rename` line, which the person types once. `crew start` refuses until this session is a
  lead.

## 2. Split the plan into phases

The phases, their waves and what stays with you follow `/cc-smart-dev-kit:plan-task` § 5:
30 to 90 minutes each, contracts first and alone, then disjoint file sets. For crew sessions, also:

- **A phase far under 30 minutes** joins a neighbour, or goes to a subagent: a crew session's start
  and review cost more than it saves. A whole phase is a crew session's job: § 7 says what the
  guard does when the queue is full.
- **The contracts phase is merged** before the wave that uses it starts.
- **Each brief says the crew session never touches the shared files** that stay yours.
- **Each phase gets a kind**, and the kind picks the model and the effort:
  `cc-smart-dev-kit crew kinds` (or `crew --help`) lists each kind with its model. Pick
  the kind of the phase's riskiest part; a kind that runs on opus is for design judgment, never
  a way to get a stronger builder. `ui` is opus at `high` — never an affordable model, because
  UI/UX design is not affordable work — and `crew start` refuses an override that would put it
  there.
- **You pick each phase's effort by its task.** On a Claude model the kind's effort is the
  default, not a rule: set `--effort` per phase from its brief — `medium` for mechanical work,
  `high` by default, `xhigh` or `max` for a hard or risky phase — and write the reason in the
  plan's row. On an affordable backend the effort stays `max` (the launch policy). **`--model`
  changes only when the person asks.** A `ui` phase keeps its floor (`high` or above, on
  `opus` or `fable`). A running crew session is changed with `crew model` (§ 3).

## 3. Start each phase

```sh
cc-smart-dev-kit crew start <phase> --slug <slug> --kind <kind> \
  --files <glob,...> [--effort <effort>] [--waits-for <phase,...>] [--base <ref>]
```

- **At plan approval, start the whole plan at once**, in one message: every phase of every
  wave, each later one with `--waits-for` the phases it builds on. You never keep a list of what
  is ready: the queue and the watch start each phase when what it waits for is merged and a
  place is free. Each call returns at once with one line: `started`, `queued` or `failed`, with
  the reason (an opus start with no usage-window reading adds one note line). Your reply names
  each crew session with the model and effort its line shows (the core instructions' "say it
  when you launch").
- **`queued` is not an error.** A cap, the free memory, the CPU load, the 5-hour usage window or `--waits-for`
  holds it, and it starts by itself when its place frees. Never start it a second time.
- **A `clash:` line after the start is a warning, not a failure.** Another lead's crew session in
  this repository lists some of the same files: the line names that lead, its crew session and the
  files they share, and both starts go on. Two leads may mean to share a file. If they must not,
  tell the other lead: `cc-smart-dev-kit crew lead tell "<that lead>" --kind contract "<what the
  phase changes there>"`.
- **`--waits-for <phase,...>`** holds a phase until each of those is merged. The
  watch marks a merged branch and starts the waiting session by itself, cut from your branch
  with the merge in it. A phase the plan adds later is started the moment it is written.
  **A phase whose crew session you removed before merging its work releases nothing**: the
  watch tells you once, and the dependent stays queued. Start that phase again and merge it, or
  drop the wait: `cc-smart-dev-kit crew rm "<waiting crew session>"` (a queued one goes at
  once), then start the waiting phase again without `--waits-for` it.
- **Change a crew session's model or effort later** with
  `cc-smart-dev-kit crew model "<crew session>" [--model <model>] [--effort <effort>]` — when the
  person asks for another model, when a phase turns out harder or easier than its brief said, or
  when the model a session was started on is available again. The same checks as `crew start`
  judge the values (a `ui` session never goes onto an affordable model). A running session is
  stopped and resumed with the new flags and a prompt that says what changed; a stopped or paused
  one keeps its state and takes them at its next resume. A move onto opus that a cap holds
  (`perLeadOpus`, `maxOpus`, the usage window) is queued with its reason: the session runs on, and
  your watch applies the change once the caps allow. One line says which: `resumed`, `stored for
  the next resume`, or `queued`. A `--continue` start takes `--model` and `--effort` the same way.
- **`failed`:** read the reason and fix that. `Workspace not trusted`: the person opens the
  repository once with `claude` and accepts the trust prompt.

**The brief** is a file in the plan's own folder: `<plans dir>/<plan stem>/briefs/<PHASE>-<slug>.md`,
beside the plan file `<plans dir>/<plan stem>.md` and named as the crew branch `crew/<PHASE>-<slug>`.
Write it there before the start; `crew start` with no `--brief` takes it and its first line says
which file (none there: refused, with the path). `--brief <file>`, or `-` for stdin, still names
another. The folder is the plan's, never one per lead: the plan outlives its leads. `crew start` adds
a frame after
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
queued crew session that started, a note one crew session told another, the person writing to one — and each line reaches you as a notification, also when you are
idle. A lead of another plan in this repository reaches you the same way: a note it tells you, a
merge it made into the base, and a file clash of its phase with yours. So after the starts, **go on**.

**On each line, act in that turn:**

| The line | You |
|---|---|
| a hand-back (`<name>: done`) | check and merge it (§ 6); the watch starts the phases that waited for it |
| `question`, a technical one | answer it (§ 5) |
| `question`, one that is the person's | `AskUserQuestion` (§ 5) |
| `needs you` (a permission wait) | give the person `claude attach <name>` |
| `going again — the wait is answered` | the person answered that wait: nothing to do, and stop naming it as waiting |
| `told` (one crew session told another a contract change or question) | nothing, unless it changes the plan or the two cannot settle it: then `crew answer` both |
| the person wrote to a crew session | read its next report against the brief before you merge it. Their word wins over the brief, so the phase it hands back may no longer be the phase it started (§ 6) |
| `contract from another lead` (a note from another lead of this repository) | read it; a contract note needs no reply. If it changes your plan, act in this turn |
| `question from another lead` | answer it: `cc-smart-dev-kit crew lead tell "<that lead>" --kind contract "<your answer>"` |
| `merged #<n> … into <base>` (another lead merged into the base) | at your next stop, merge `origin/<base>` into the branch your folder is on, and run your install if a lock file changed. A crew session's branch never takes the base in: its lead's branch already has it |
| `clash: …` (a crew session of yours and another lead's phase may change the same files) | nothing: both starts go on. If the two phases must not share, tell that lead with `crew lead tell` (§ 3). Each pair of phases is said once. |
| `warning: --files "<glob>" matches …` (at your `crew start`) | the glob names far more files than one phase owns, so other leads' sessions will clash with it: narrow it for the next start |
| `failed`, `blocked`, `quiet`, a turn ended with no report | § 6. A `quiet` line comes once when a stretch starts and once more at three times `crew.quietMinutes`; it does not repeat each minute |
| `paused` (a model limit) | nothing: the watch resumes it once the gateway answers again, one first and the others 30 s apart; after `/login` on another account, `cc-smart-dev-kit crew resume --paused` |

**Between lines:** the integration work that is yours — the merges, the full check after each,
the shared files, the plan file — and stay free for the person. **Never poll, wait or sleep.**
A turn that ends with a ready phase not started is a fault: before you end the turn, every
phase whose waits are met runs or is queued.

**Where monitors do not run** (telemetry off: `DISABLE_TELEMETRY` in the environment or in a
settings file's `env`), run `cc-smart-dev-kit crew watch --once` with
`run_in_background: true`. It ends on the next change, and its end starts your next turn. Act
on the line, then start the next `--once` in the same turn — except after `crew watch: a newer
watch of this lead runs (pid …); this one ends`: nothing to do, and start no other `--once`. One
watch acts for a lead, the newest: a second `--once` takes the lease from the first, and the
first's exit would otherwise start yet another. **On native Windows** the plugin's
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
  gets it by itself, through its monitor, even when it sits blocked; the command says
  `delivered`, or `recorded, not delivered` and prints the one `SendMessage` line you then send
  yourself. A stopped one is resumed with it. **A wrong answer is corrected by answering the same
  question again**: the crew session hears that it replaces the first. A finished crew session takes
  neither.
- **A permission prompt in a crew session** only the person answers. Name the crew session and give the
  line `claude attach <name>`.

## 6. A hand-back: check, merge, start

A `done` report is the crew session's word that its phase is ready. Your gate is mechanical:

1. **The report:** status `done`; the whole suite and the checks green; the review recorded
   (a reviewer's `review`, or an `ownReview` with its reason where the brief asked for no second
   opinion; the watch and the portal show either as a review), each finding with its fix; no file outside the brief without a reason; nothing left open
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

**The kit records the run itself**: the merge (its commit, and the lead session that made it) and the
removal go into `<plan folder>/runs/<crew id>.json` with the sessions, pauses and times. Never write or
edit a run file by hand, and never delete one; `cc-smart-dev-kit crew history` reads them.

**Read the diff only when something does not add up** — a red line in the report, a file
outside the brief, a failed check after the merge, a report that contradicts itself — and then
only the part that does not.

**`failed` or `blocked`:** read why. Blocked on a question: § 5. Failed: a corrected brief and
a new crew session (`crew start` with a new slug), or the phase back into the plan.

**The end of a crew session.** A crew session never outlives its work: each one holds hundreds of MB.
Once you merged its branch, the watch marks it `merged` and **removes it by itself**, with
`crew rm`'s own steps (worktree, branch, session, record); a handed-off one goes the same way once
its work is merged. Nothing is left for you but two cases, and the watch names both: a removal it
refused (a program of someone else's still runs there, or work nobody committed) — it says that
once, in one line; clear it and run `cc-smart-dev-kit crew rm <name>` — and a **stopped** crew
session, which it marks merged but never removes (stopping one was your call, and so is its
removal). The clean also uses `crew rm` when a lead is proved gone and its crew work reached the
project base; it never discards unmerged work.

A crew worktree is removed only by `crew rm` or the watch, and anything else the kit keeps is named with its step by `worktrees --clean`; never give the person a removal loop.

## 7. Caps and the queue

`workflow show` prints the caps. **Yours:** `crew.perLead` crew sessions at once (4 by default)
and `crew.perLeadOpus` of them on the opus tier (2), counted in every repository of this machine.
**The machine's guards:** `crew.max` is a safety ceiling (24) no lead reaches alone, `crew.maxOpus`
an optional machine-wide opus count (unset by default), and a new **opus-tier** phase waits while
the plan's 5-hour usage window is past `crew.usagePercent` (85) — unless the gateway's opus slot
has a fallback chain on, which answers past it. The window comes from Claude Code's status line,
and with no reading the guard does not hold (`crew start` and `crew list` say so once). Any start
also waits while the 1-minute CPU load is past `crew.loadPerCore` (3) for each core, and while too
little memory is free.

Routine phases on the worker slot run wide; the opus phases — the kinds that run on opus — queue,
so put those that unblock the most first. A queued crew session says what holds it on `crew list`.
Your own Opus subagents share the same usage window: at most 3 at once.

**The guard holds a builder subagent while a `crew start` from you would queue.** Its line names which
cap above is full and the `crew start` step, and it is a refusal rather than a question, because
the step needs no person. Read-only subagents — a search, a review, an audit, a UI check — are
never held, so nothing stops you asking one a question while the queue is full.

## 8. Hand-offs

A crew session near its context line or its time cap commits its work in progress and reports
`handoff`. Its context line is `crew.handoffTokens` (400 000) or `crew.handoffPercent` (70 % of its
window), whichever comes first, and before the point Claude Code would auto-compact it at.
Start the next one from where it stopped:
`cc-smart-dev-kit crew start <phase> --continue <name>` — a new crew session from the old head, with
the brief and the hand-off report, its name ending in ` 2`. A phase that hands off again and
again is too big: split what is left.

## 9. Restart and compaction

The plan file and the crew store hold the state, not your context. **The record of each run
survives a restart, a new lead and `crew rm`**: `<plan folder>/runs/<crew id>.json` keeps the
session ids, the times and who answered, merged and removed; `cc-smart-dev-kit crew history`
reads it. Commit the plan's folder with the plan. After a compaction: read
the plan, then one `crew list`. After this session restarts: the same, and run this skill
again so its monitor runs. After the machine restarts: `cc-smart-dev-kit crew resume <name>`
for each stopped crew session — never `claude respawn --all`, never `claude daemon stop`.

## 10. The integration review, and the end

Each crew session's phase carries its own review. Your own integration commits get one small review
before the push (`/cc-smart-dev-kit:review` § Second opinion). Then the push, the pull request
and the merge go as the workflow says (`/cc-smart-dev-kit:commit`). The plan's last wave, the
heavy cleanup, starts only once everything is verified live (`/cc-smart-dev-kit:plan-task` § 5).
After the pull request merges and no work remains here, mark the plan ended with `crew lead --end`, then leave and remove your own lead worktree with `ExitWorktree` (action `remove`).

## Never

- Wait, `sleep` or poll; ask a crew session whether it is done.
- End a turn with a ready phase not started, or start the plan one wave at a time.
- Build a phase yourself, read a crew session's whole diff to check it, or hand a phase to a
  builder subagent while the queue holds it (§ 7).
- Start a crew session from a crew session, or a raw `claude --bg` in place of `crew start`.
- Answer the person's decision for them, or a crew session's permission prompt.
- Leave a merged crew session running.
