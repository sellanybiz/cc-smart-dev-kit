# Lead and the crew


A person talks to one small **lead** session. It plans, and starts each phase of the plan as a
**crew session**: a background session (`claude --bg`) in its own worktree, on its own branch, that
builds, tests, reviews and commits the phase and hands back a report. The lead never waits on a
crew session — the news arrives by itself — and merges the finished branches locally. Background
sessions win over subagents alone (every hand-back lands in the lead's context, and a long phase
rots it) and over agent teams (no worktree isolation, no resume).

This section holds the contracts every part of it builds on — the switch, the kinds, the names
and the store — and the commands that act on them: `crew lead` and the launcher,
`crew start` (§ The lead and the launch, below), the board and the end of a crew session, `crew
list`, `status`, `kinds`, `attach`, `stop`, `resume` and `rm` (§ The board and the end of a
crew session), what a crew session says: its steps, its report, its question, the lead's
answer, the lead's watch, the hand-off, its own time line, and a note to another crew session
(§ The crew session's steps, its report, and the lead's watch, § The crew talks), and the crew
session's and the lead's hooks (§ The crew session's and the lead's hooks).

### Cleanup continuation (CL2)

The watch reminds its lead once a day about stopped, done or failed unmerged work older than a
day. The item's age starts at the latest transition into its current terminal state, not a later
report or step. It names resume, continuation, and removal; continuation also accepts these
terminal states while preserving the old outcome. An old record with an active continuation no
longer gets the reminder or a Needs removal preview. No reminder discards or removes the work.

`src/crew/lifecycle.ts` is the shared rule for lead absence: an explicitly ended lead, or a
successfully observed unknown session for more than 24 hours. An unreadable agent view proves
nothing, and a returning lead clears its unknown clock. `crew list --all` marks that condition.
`crew lead --end` records an ended plan; recording it again clears that mark. Manual and background
cleans use that shared rule and require ancestry or a no-change merge onto the project base before
calling `runCrewRm` with that immutable base. An old lead-branch proof never stands in for current
project-base proof. Unmerged work stays with removal and continuation steps. Active crew states
stay too. The Work API marks lead absence without writing from a GET request.

When the watch first proves a merge, it stores the crew head, lead ref and immutable lead commit.
`crew rm` can use that proof only while the crew head is unchanged, and uses the recorded lead
commit throughout the verdict and branch deletion. Content-addressed
`refs/crew-merge-proofs/<lead-commit>` keep those commits reachable after reflog expiry and object
pruning; these proof refs have no automatic expiry. A later crew commit requires today's merge check. Older merged records have no proof and retain that check; no override flag is added.

**Explicit recoverable discard:** `crew rm --discard` shows one shared preview (missing commits,
dirty/untracked files and ignored files), asks once or takes `--yes`, and saves work before removal.
`src/crew/discard.ts` owns those facts and the exact CLI/portal confirmation words. Its token hashes
the head, staged and disk changes, file modes and raw contents; the CLI rechecks it after confirmation
and after archiving. A different staged version survives in the archive commit's parent. Ignored
files must be regular UTF-8 text, at most 64 KiB each, 256 files and 1 MiB total; binary files,
symlinks and unreadable files refuse, rather than disappear. The create-only ref
`refs/crew-discarded/<crew-id>` (with an attempt suffix when needed) holds each archive, and
`crew list --discarded` prints its recovery
command and age. Manual and background cleans prune completed archives after the one shared
30-day limit. A person's programs and containers still refuse; the watch never discards. A
worktree whose folder was deleted by hand while its branch stayed is made again on that branch
first, as a released one is (below). Git may still list it: Claude Code's own lock on it is
released, a lock a person took refuses, a branch checked out in another worktree refuses, and git
then forgets the worktrees whose folders are gone. A preview without a yes says the folder stays.
Plain `crew rm` refuses the unmerged branch, so without this the record could not go. With neither a
worktree nor a branch nothing is left to archive: the discard refuses and names plain `crew rm`.

The Needs API reads old stopped work and discard previews through `crew cleanup --json` in a CLI
child, keeping git off the server loop. Removal actions use the CLI child in the record's repo,
require explicit confirmation and pass the displayed token for discard. Work also exposes finished
unowned background sessions and targeted removal. The Needs and Work views need new components,
so this phase stops at API contracts; a separate UI phase must render those controls.

Older merged records recover stopped intent only from a positive stopped-to-merged transition in
the events log. When history is missing, that intent cannot be recovered and the previous
merged-record policy remains. No unproved merge override was added: a legacy record whose current
merge check fails stays with a refusal explaining the missing proof and recoverable discard.

**The instructions** say when a phase goes to a crew session (`core.md` § Lead the work: a phase with
its own worktree, branch and review, or work longer than about 30 minutes), and two skills hold
the procedures: `lead` (register, split, start, hear the news, route the questions, the merge
gate, caps, hand-offs, restarts) and `crew` (build the phase end to end, the steps, the
report, the questions). Each points at the commands it uses and copies none of their tables:
the kinds come from `crew kinds` (or `crew --help`), the caps from `workflow show`.

**The switch** (D34) is `workflow.crew.enabled`, off by default, in the person's
`workflow.json` (every project's default) and in a project's `.claude/cc-smart-dev-kit.json`,
which wins for project choices, but never for the machine's crew limits (D71, § The workflow).
The caps, free-memory threshold and CPU-load threshold come only from the person's file or defaults. Beside it in the same
group sit one lead's caps — how many of its crew sessions run at once and how many of those on
the opus tier (`perLead`, `perLeadOpus`) — the machine's guards (the safety ceiling `max`, an
optional machine-wide `maxOpus`, and the 5-hour `usagePercent` past which a new opus crew
session waits, D54), the free memory a new one needs, when a quiet one is reported, when a long one hands off, when a
blocked one is stopped (D35: a crew session never outlives its work) — and the `tag` of their names.
`workflow show` prints each with its source.

**The kinds** (D46, D50) say what a phase needs, and so the model and effort its crew session runs on:
`CREW_KINDS` in `src/models/launch-policy.ts`, the one home of the launch policy the Agent
guard judges subagents by (§ The Agent guard). Routine work — `build`, `docs`, `tests` — runs on
`sonnet`, the worker slot, at `high` whatever answers the slot (the owner, 2026-10-26: no level
is forced on an affordable backend; until then it ran at `max`, and a person who wants a backend
at one level pins it in the router, D64). Which gateway answers
is the project's: the address its own settings choose over the machine's — its personal file, its
team file, then the user's — and a profile's chains when the address names one (`crewGatewayOf`,
`src/crew/usage-guard.ts`). It reads the settings files at the lead's own folder
(`crewSettingsFolder`): a crew session's worktree is cut from the lead's branch and Claude Code
reads the team file of the folder a session runs in, so a lead in a linked worktree whose branch
changed `.claude/settings.json` gets the answer its crew will meet, not the main checkout's
(proved on 2.1.310, `docs/claude-code-contract.md`). It is the same folder for `crew start`, for the
queue's start, for the Agent guard's question "would a start queue now?" and for `crew list`; the
user's file alone would miss a project turned on or off with `gateway project`. (`crew model`
still asks the record's repository: it has no lead folder to hand.)
It reads no environment: an address exported only in the shell that runs `crew start`, with no
settings file naming one, is not seen. So does code that
touches security, money, permissions, a schema or deploy plumbing: it builds like any other code.
Work that needs judgment — `architecture` — runs on `opus` at `xhigh`, whatever answers the
tier. `ui` is the exception (`UI_POLICY`, D50): it runs on `opus` at `high`, never on an
affordable model — `crewLaunch` names a tier, whatever answers it. A `ui` session's override that
would put it on an affordable model or below `high` is refused by the launcher with one plain
line (`uiRefusal`), before the guard is asked. `crewLaunch(kind, gateway, env)` makes that
choice from the same reading of the gateway the guard makes, so a crew session never starts on a
model or an effort the guard would refuse a subagent; a test runs every kind through the guard.

**The names** (D26, `src/crew/names.ts`) show the role, because agent view has no parent link
and no grouping by lead — the name is how a person, and the portal, groups the sessions:

| Session | Name |
|---|---|
| a lead | `LEAD <tag> <plan>` |
| a crew session | `C <tag> <plan> <phase> <slug>`, and ` 2`, ` 3` for a hand-off's next crew session |

- **The plan is the lead's** (`lead.plan`, the same word `leadName` writes), so a person reading
  agent view, `ListAgents` or the portal sees which lead a crew session belongs to: several
  leads of one repository share the tag, and the name is how they are told apart.
- **Role, tag and plan first**, so a list that cuts a name still shows whose crew session it is:
  `C <tag>` always fits in the first `NAME_VIEW` (24) characters (the width agent view really
  shows is not proved live yet), and usually the plan after it. The whole name fits in
  `MAX_SESSION_NAME` (60): the clean title every session's name goes through
  (`cleanSessionName`, which moved here from the session-name hook). The tag is at most
  `MAX_TAG` (12) characters and the plan `MAX_CREW_PLAN` (16), so the phase (at most `MAX_PHASE`,
  8) is always whole in the name, never cut: it is the crew session's identity. What a long name
  loses is the end of its slug, never the phase or the hand-off number.
- **A record keeps its name.** Crew records written by 1.1.1 and earlier say
  `C <tag> <phase> <slug>`; nothing renames them, and `roleOf` recognises both shapes. Only a
  crew session started after the update gets the plan in its name.
- **ASCII only, no brackets or quotes**, so a name is safe in a title bar, a shell line and a file
  name, and it **never ends in `]`**: the message guard drops the ` [ref]` ListAgents prints after
  a name before it looks the name up (`withoutListRef`, one home), so a name of ours that ended in
  `]` would not match itself there. Every part goes through `namePart`: accents dropped, any other
  character a `-`, no `--`, a letter or a digit at each end. A phase is the crew session's identity, so
  one that is not already clean is refused rather than changed (`isPhase`).
- **The tag** names the repository: the main checkout's folder name, made clean and short, or
  `workflow.crew.tag` (`crewTag`). A folder name that leaves nothing (one of non-Latin
  letters only) is refused with the line to set the tag.
- `roleOf(name)` reads the shape only — `lead`, `crew`, or null for any other name, a ListAgents
  ` [ref]` read past. **No crew command calls it**: it is the shape check the tests hold the names
  to, here for a caller that must tell our names from a person's with no store to read. A person
  may name a session in that shape by hand, so **the store, never the name, is what anything that
  stops or removes a session goes by.** The commands, the board, the message guard and the portal
  look a crew session up by its record, never by splitting its name, so both shapes work there.

**The store** (`src/crew/store.ts`) is what the kit knows of each lead and crew session, per
repository, under the state folder:

```
<stateDir>/crew/<repo key>/crew/<crew id>.json   one record per crew session
<stateDir>/crew/<repo key>/leads/<session id>.json    one record per lead
<stateDir>/crew/<repo key>/reports/<crew id>.json   a crew session's hand-back report
<stateDir>/crew/<repo key>/files/<crew id>/         its brief.md and its settings.json
<stateDir>/crew/<repo key>/events.jsonl               every change, one line each, append-only
<stateDir>/crew/<repo key>/watch/<lead id>.json       where that lead's watch is in the log
<stateDir>/crew/<repo key>/notes/<lead id>.json       where that lead's notes hook is in the log
<stateDir>/crew/<repo key>/stop/<crew id>.json        where that crew session's Stop hook is in the log
<stateDir>/crew/<repo key>/self/<crew id>.json      what that crew session's own watch last said
<stateDir>/crew/lock                                  the machine-wide lock of a start decision
```

- **The key is the review record's** (`repoKey`, a hash of the main checkout's folder), so every
  worktree of a repository shares one store, as it shares one review record. It is the kit's own
  state: folders 0700, files 0600, each record written whole through the kit's atomic write.
- **Every write holds the store's own lock** (`withLock` on the repository's folder, 3 s at most),
  not the state folder's shared one: two leads, or a lead and a crew reporting at once, both
  land. A state change and its `state` event are written under one hold, so the log never misses
  a change; a new crew session is one `created` event, a step, a report or a question one line each.
  Every change of a crew record goes through one read-modify-write (`changeCrew`).
- **A crew record** holds who it is (its id — a plain file name, known before any session
  exists: `<phase>-<slug>-<6 hex>`, so a second try of a phase never meets the first's record —,
  its name, its session's id and short id, the sessions it had before (`earlierSessions`, RX1:
  set by the store when a write replaces the session id), its lead), what it does (the repository, the plan, the
  phase and slug, the kind, the model as named with the slot and the model that answer it
  (`answeringSlot`), the effort, the permission mode, the worktree, the branch, the ref it starts
  from, the base and its commit once it starts, the phases it waits for, the files of its brief)
  and where it is: its state, its last line, its report, its pull request, its memory, its
  questions, what it waits for while `paused` (`waitingFor`: a gateway slot whose breaker is
  open — the slot's key, or `<profile>/<slot>` for a crew session in a project on a profile, whose
  breaker is the profile's —, Claude's own plan limit, or `unknown` when the router's state explains nothing (it keeps
  the same key, so the watch asks that session's own breaker before it resumes it); with the
  pause before it, `lastPause`: when it began and the hold-off a re-pause doubles —
  § Waiting out a limit; and, while a resume of it runs, `resumeClaim`: the token and the time of
  that resume, optional, dropped by the write that changes the record's state — § The watch),
  when its session started (`startedAt`, optional: the crew session's own time caps count
  from it, not from when it was recorded), the crew session it continues (`continues`, optional: the id
  of the old crew session, set by a hand-off and by nothing else), whether the lead had merged its
  work before its removal (`mergedBeforeRemoval`, optional: set by the store when the state becomes
  `removed`, from the state the record was in — the fact a phase that waits for it starts on),
  whether it was merged while it was `stopped` (`mergedWhileStopped`, optional: set by the store
  when the state goes from `stopped` to `merged` — the watch never removes such a record, D62;
  false when the watch's own idle stop made it `stopped`), whether the watch itself stopped it
  for idling (`stoppedByWatch`, RX1, optional: kept only while it is `stopped`), and when it was
  recorded and changed. The states are `queued`, `starting`,
  `working`, `blocked`, `paused`, `quiet`, `done`, `failed`, `stopped`, `handoff`, `merged` and
  `removed` (`CREW_STATES`, each one's meaning in the file). **A lead record** holds its session
  id, name, repository, plan, the tag its crew sessions' names carry, and folder, and may hold
  `pausedAgents`: the ids of its own subagents that stopped on an API error and wait to be woken.
  Both new fields are optional (`waitingFor` and `pausedAgents`), and a record an older kit wrote
  reads as it was.
- **A crew session's questions** (D36): a crew session never asks the person. A question to its lead — the
  question, two or more options, the one it recommends (counted from 1), when it was asked — goes
  at the end of its `questions` with a `question` event (`addCrewQuestion`), and the crew session goes
  on with what the question does not block; the lead's answer is recorded once, with its time
  (`answerCrewQuestion`). A recommendation that is not one of the options, or an answer without
  its time, is refused. **A question of a crew session whose phase is over is closed**
  (`openQuestionIndex`, one rule every reader shares): `done`, `failed`, `handoff`, `merged` and
  `removed` need no answer, so the Needs page, `crew list`, `crew status` and `crew answer` agree.
  A `stopped` crew session's question stays open — D35's answer resumes it with the question still
  waiting. **Each question stays open until answered.** Its number is its place in the list,
  counted from 1. Old records with `supersededBy` still count as closed. With several open
  questions, `crew answer` refuses an unnumbered answer and lists their numbers and ages.
  `--question <n>` chooses one, including an answered one to correct. The crew session stays
  blocked while another question is open. Status and the portal list every open question;
  the portal's original `question` field keeps the oldest for old clients. A watch replay of
  an answered question says when it was answered, never asks for another answer.
- **The hand-back report** is what a crew session gives the lead when its phase ends: its status (`done`,
  `blocked`, `failed`, `handoff`), the phase, the branch and base commits, the pull request, the
  diff counted, the files it changed outside its brief, the targeted tests and the whole suite,
  the other checks, the one review (agent, model, effort, the commit it read, each finding and its
  fix) or the crew session's own review where its brief asked for no second opinion (`ownReview`:
  the reason and each finding with its fix), the docs it changed, what only the lead may do, what
  is still open — and, when blocked, the question it waits on (a blocked report without one is
  refused).
- **The events log is read from an offset**, whole lines only: a line a writer has not finished
  is left for the next read, a line that cannot be read is counted and skipped, and a log shorter
  than the offset (replaced) is read from its start.
- **Older and newer kits share the store.** A daemon's spare process, or a session started before
  an update, runs older code. Every record, event and report carries the schema `version` it was
  written with; a reader keeps every field it does not know and reads a state, kind, event type
  or report status it does not know as itself; an update by an older kit keeps what a newer one
  wrote, and the newer version number. A record that lacks a field this kit needs is broken: a
  single read throws, naming the file and the field, and a list names it under `broken` and
  goes on.

### The lead and the launch

**A forked lead adopts its crew.** Moving a session to the background gives it a new id,
with its name and folder but no parent id. Run `crew lead` in the new session. Without
`--plan`, it first matches a lead that is not running and has this session's name. Only when
no name matches does it look for one in this folder, and folder matches that span more than one
plan refuse, listing each with its plan, because dead leads pile up in one checkout and an
adoption cannot be undone. Then it falls back to the branch.
A session is running when a process-identity-checked session record, a live agent-view row,
or a live watch lease names it. All three must prove absence; unreadable presence refuses
with a retry line. **Absence needs proof:** a running pid whose record has no `procStart`, or
whose `/proc` start cannot be read, counts as running ("identity unproved"); only a start
that differs from the record's (a reused pid) does not. A row agent view lists as stopped is not
running, so a lead whose session stopped is gone for adoption and for cleanup alike. A
same-plan live lead refuses registration, never splits the crew.

`adoptLead` holds one store lock and rechecks the old lead. It writes the new lead with
`earlierSessions` and an increased `generation`, transfers every non-removed crew record
with an `adopted` event and run record, then ends the old lead with `adoptedBy` last.
Watch and notes cursors merge at the lowest offset; watch `said` and missing-session
clocks are joined. Leases and issue-mark queues stay in place. The new watch settles
marks for every earlier id; an adopted old watch ends without settling. Each pass reloads
its cursor and id set when the generation changes. Adoption summarizes crew state and
replays questions and unread reports instead of old progress lines, **once per adoption**:
the watch state keeps the generation it summarized, so a watch re-armed every 30 minutes does
not say it again, and the time of the adoption (`adoptedAt`, on the new lead record) bounds the
replay, never the record's `updatedAt`, which a later `crew lead` moves. Ended, empty lead
groups disappear from the portal, and ended leads do not receive merge news or tell messages.
The board shows lead short ids and a resume command for missing crew after the shared
one-minute grace. A prompt in an unregistered fork hints at adoption without calling agent view.
A crew session never hears the hint, and session records that cannot be read are one stderr
line, never a line in the session's context.

**`crew lead [--plan <slug>] [--plan-file <path>] [--tag <tag>]`** (`src/crew/lead.ts`) records the session
that runs it as a lead of this repository. **Which session** is first the one Claude Code names in
the Bash tool's environment: `CLAUDE_PID` and `CLAUDE_CODE_SESSION_ID`, when both are set and agree
with the record `<config folder>/sessions/<pid>.json` (`sessionNamedByEnv`). Else it is found the way
L1a.1 proved it: the nearest ancestor process with such a record (`callingSession`,
`src/crew/session.ts`; parents from `/proc` on Linux, one process listing elsewhere). On native
Windows the walk alone never reaches the session: the launcher is a `sh` script that `exec`s bun,
and after Git Bash's fork and exec bun's recorded parent is a process that has already exited, so
the chain ends two shells up. Its name, `LEAD <tag> <plan>`, is written into the lead record as data, and the
`lead-notes` hook sets it at the lead's next prompt by itself (§ The lead's name below); the
command never renames the session, and prints one line saying so. The tag is
`--tag`, else `workflow.crew.tag`, else the main checkout's folder name; the plan is `--plan`,
else the plan this session already leads, else the branch. `--plan-file` records the plan's file
(§ A plan's own folder, and the record of each crew run).

**The lead's name** (LD1) is that record's data, applied by `lead-notes` at the lead's next
prompt: one `UserPromptSubmit` answer carries `sessionTitle` beside the note (Claude Code's own
output schema has both fields on that event, `docs/claude-code-contract.md`), so the command
prints no `/rename` line for the person to type. `titleToSet` (`src/hooks/session-name.ts`) is
the one rule behind both writers — a session naming itself after its task (`sessionNames`), and
a lead taking its role name: a title is set only when the session is not already called that and
the kit did not set it. So the first prompt after `crew lead` replaces whatever name the
session had, and a person's own `/rename` made after that stays: the kit takes the name back
only when the lead registers again with another plan. Two names never compete: one title has
one owner, so `session-name` is silent in a recorded lead, and in a crew session (whose launch
name is its address; the command refuses there). **The crew record owns the title**: `crew-role`
puts `record.name` back on the title when the title says something else, through the same
`titleToSet` (so a `/rename` the person makes after the kit set it stays, as with a lead's name).
It is the fix for a session 1.1.1 renamed after its task and 1.1.2 left renamed, which lost the
address its lead, `crew answer` and the message guard reach it by. A session id no naming record
can be made for (not a UUID) gets the `/rename` line as the fallback, from `crew lead` itself.
**A name whose record cannot be written is not set, and the turn goes on.** `titleToSet` writes
its record into the temp folder before it answers, and that write can fail (a `TMPDIR` that is
not a folder, a full disk). `titleToSetOrProblem` then sets no title — setting a name the kit
cannot remember setting would set it again every turn and override a `/rename` — and returns the
reason, which `crew-role` and `lead-notes` say as one stderr line beside the rest of their
answer: the person's `person` event and prompt context, a lead's news. The throw it replaces
crashed `crew-role` before the event was written (its `onCrash` is silent on a prompt) and
lost a lead's news after the cursor had passed it.

**The lead's role** (D61): a lead plans, writes the briefs, starts the phases, answers the
questions, merges each branch with one full check after it, keeps the plan file true and talks to
the person. The building — code, tests, research across many files, long debugging — goes to a
crew session, and the reading a brief needs to a scout subagent. The rule is **words only**: the
lead skill's "Your crew builds" section, and one line in the lead's start note from this hook at
a start, a resume and a compaction — never at a prompt, never on an edit, and no block.
Why: the lead's context is re-read on the premium model every turn, so every file it reads or
writes costs on every later turn, while the crew session that does the same work ends.

**`crew start <phase> --slug <slug> --kind <kind> [--brief <file|->] …`** (`src/crew/start.ts`)
**returns at once** (D25) with one line — `started …`, `queued …` or `failed …` — and never waits,
polls or retries. An opus-tier start with no 5-hour window reading adds one note line after it
(D54); a brief taken from the plan's folder (§ A plan's own folder, and the record of each crew
run) adds `brief: <path> (the plan's folder)` before it. In order:

1. **The refusals** (exit 1, a line and its `Fix:`), shared with `crew lead` (`caller.ts`): the
   caller is a crew session (`CC_SMART_DEV_KIT_CREW` set); the folder is not in a git project, or its
   kit config does not read; crew sessions are off here (D34, resolved as `workflow show` resolves it);
   no Claude Code session runs the command; that session is in bypass mode — its command line
   (`--dangerously-skip-permissions`, `--permission-mode bypassPermissions`) where the machine
   shows it, else `permissions.defaultMode` in the checkout's `settings.local.json`, its
   `settings.json`, then the person's (`bypass.ts`): a lead there would act on every crew session's
   message with no question. Then: no lead recorded for this session here (`crew lead` first);
   a brief that cannot be read, or is empty; no `claude` (PATH, then `~/.local/bin`); a base that
   is no commit. A wrong command line is exit 2: no phase, slug or kind, an unknown kind, an effort
   a crew session never runs at, a phase that waits for itself.
2. **The model and effort**: the kind's (`crewLaunch`, D46). An override (`--model`, `--effort`;
   a model alone runs at the kind's effort, whatever answers it) is
   judged by the Agent guard's own `judgeLaunch`: one it refuses is refused with its words, and
   one it would **ask** the person about (`opus` at `max`, an unreadable name) is refused too,
   because `crew start` never asks — the person starts such a session themselves. Fable is
   refused: no crew session carries the person's `Fable reason: build` line.
   A `--continue` start takes `--model` and `--effort` too (`changedLaunch`): without them the next
   crew session runs on the old one's model and effort, judged again like any launch. **The lead
   picks the effort by the phase's task** (the owner, 2026-10-25): the kind's effort is the
   default, and `--effort` is allowed without the person asking — `crew start` and the Agent
   guard refuse only what they always refused (a `ui` session below `high`, a value the guard
   asks about). `--model` still changes only when the person asks (`plugin/skills/lead/SKILL.md`
   § 2).
3. **Start now, or queued** (`places.ts`). Starts, queued starts, continuations and every
   resume share one gate (`placeFor`, D72), decided under one machine-wide lock
   (`<stateDir>/crew/lock`) so two starts never both take the last place, and recorded
   (`starting` or `queued`) under the same hold. First the name must be free: no crew session of this
   repository holds the branch (`holdsName`: every record but a `removed` one, and a `failed` one
   that never got a session and left no worktree), and neither the branch nor the folder exists. Then, in order: **its phases** (`--waits-for`) — each phase's newest crew session here must be
   `merged`, or `removed` after that merge (`mergedBeforeRemoval`, kept by the store): a
   `removed` crew session whose work the lead never merged releases nothing, because `crew rm`
   removes a queued or failed phase too, and a dependent that started from it would build on
   work that is not on the lead's branch; **a crew session that finished its phase (`done`) is not enough**, because
   the lead has not merged it yet, and a dependent phase that branched before the merge would
   miss the work it waits for; **its lead's caps** (D54) — the crew sessions of one lead (the
   session that started them, `leadSessionId`), in every repository on this machine, in
   `starting`, `working`, `blocked`, `paused` or `quiet`, stay below `workflow.crew.perLead`
   (4), and, for a new opus-tier crew session, its opus-tier ones below
   `workflow.crew.perLeadOpus` (2): the tier the model's name stands for, recorded at launch
   (`model.tier`), so the opus kinds (`architecture`, `ui`) and an override onto opus both
   count — so one lead can never take every place and starve the others (the owner runs about
   a dozen leads at once); **the machine's guards** — `workflow.crew.max` (12) is a safety
   ceiling no lead reaches alone, and `workflow.crew.maxOpus` an optional machine-wide opus
   ceiling, unset by default (a person who sets one keeps it); **the 5-hour usage window**
   (D54) — past `workflow.crew.usagePercent` (85) a new opus-tier crew session waits, unless
   the project's gateway has an opus slot with a chain in use and its fallback on
   (`src/crew/usage-guard.ts`, the same `crewGatewayOf`);
   the window is the one Claude Code's status line reads, recorded by
   `cc-smart-dev-kit statusline` in `<stateDir>/usage-window.json` (the reader's one home,
   `src/cli/usage-window.ts`), and with no reading — or one whose window has reset — the guard
   does not hold, and `crew start` and `crew list` say so once; **the memory** — the memory free
   now (the job queue's own reading of the machine, cgroup ceilings included; heavy jobs reserve
   nothing, so what they use is already gone from it) is at least
   `workflow.crew.memoryGb` (no check where free memory cannot be read: macOS); **the CPU** — a
   start waits while the 1-minute load average is above `workflow.crew.loadPerCore` (1.5) times the
   cores (the memory check alone let 24 crew sessions drive a 16-core machine to a load of 85).
   The one reader is `src/machine/load.ts`, handed to the commands as `CrewContext.load`; native
   Windows has no load average, so no hold applies there and `crew list` says so once. The load is
   read, like the memory, only when nothing else holds. **A hand-off's next crew session is not
   held by the load** (D70, `PlaceInput.continuation`): it takes the place the session that
   handed off left, so it adds no session. Every other hold still applies to it. Before D70 a
   machine kept at a load of 72–88 by full test suites held every successor for hours, and the
   half-done work never reached its lead. The queued line
   names what holds it. **The start gap** (D72) also holds continuations: launches wait until
   the last machine-wide launch is `crew.startGapSeconds` old (default 60 seconds in
   `workflowDefaults`). This machine-only setting comes from the person's workflow file.
   `placeInputOf` reads `launchedAt` (or an older record's `startedAt`) across every repository.
   Admission and the launch timestamp share the lock; the external launch runs after it.
   A launch that starts nothing restores its previous timestamp; an uncertain launch keeps it.
   A resume leaves its own record out of the counts, so a paused session never counts twice.
   A model replacement is the exception described below in the model-change rules.
   The store alone
   decides, so a start never waits on agent view; the watch keeps the states true. A start that
   finds a free place takes it, also while older crew sessions wait: each lead's watch starts its own
   waiting work in this order: queued continuations, waiting resumes by their wait time,
   then other queued starts by creation time. Pending model changes and paused-limit recovery
   follow that drain. Only its lead's watch starts its waiting work, so no lead starves another. The start itself is a compare-and-set
   under the places lock (`startQueued`): it re-reads the record there and goes on only while the
   store still says `queued`, so two starters of one record after a watch takeover (the lease, WF1)
   start it once, and it starts on the model, effort and start commit the store holds at that
   moment (a `crew model` that landed while it waited for the lock is used). A queued crew session has no worktree
   yet and its `base` is null: it is cut from its
   `baseRef` when it starts, so a phase that waited for another starts from the merged result.
   **The same decision is what a lead's Agent guard asks** (D59): `placeForLeadStart` builds that
   input for the lead a session id names, with no phases waited for and the memory read only when
   nothing else holds. It ignores the start gap: a pause between launches does not mean the
   machine is full. For the other holds, the guard refuses a subagent that can change files exactly while a
   `crew start` would queue, and keeps no second copy of a cap. A project with crew sessions off
   has no queue to hold a phase: the reader answers nothing there.
   **A file clash is said, and never blocks** (D55): once the record exists, the phase's `--files`
   are compared with those of every running or queued crew session of **another lead** in this
   repository (`fileClashSessions`). The tracked files (`git ls-files`) decide; for a pattern
   that names no tracked file yet, a glob is asked whether it would name the other side's path,
   a path the other side names as a folder takes the glob's own fixed prefix, and two globs or
   two paths count as shared when one fixed prefix holds the other — a guess the person can
   ignore. Each clash is one line after the `started`/`queued` line, naming
   the other lead, its crew session and the files they share, and one `clash` event on that crew
   session, so the other lead's watch says the same line. Two leads may mean to share a file, so
   nothing is refused, delayed or queued. **A phase that already has a live crew session of the
   same lead**, under another slug, adds one line too (`phaseLine`): it names that crew session and
   says to remove it first — two crew sessions on one phase is a mistake (the bug of 2026-10-23).
   The record this start continues (`--continue`) is not named: a hand-off is the same phase on
   purpose.
4. **Its files** (`files/<id>/`): `brief.md` — the brief as given, then a fixed frame (`brief.ts`):
   who it is and for whom, its worktree and branch, the files it owns, the git rule (D24: commit on
   its branch, never push, never open a pull request, never merge), how it hands back
   (`crew report --status done|failed`), and D36's rule: never ask the person or call
   AskUserQuestion; a question goes to the lead with `crew report --question … --option …
   --recommend <n>`, the crew session goes on with what it does not block, and `--status blocked` only
   when nothing is left — and `settings.json`, `{"env":{"CC_SMART_DEV_KIT_CREW":"<id>",
   "CLAUDE_CODE_RETRY_WATCHDOG":"1","CLAUDE_CODE_RETRY_WATCHDOG_USAGE_LIMIT_RECHECK_MS":"300000"}}`:
   the two watchdog keys are CC1's (`src/setup/retry-watchdog.ts`), and the file writes **no
   wait limit** (D42: keep waiting), so no `…_MAX_WAIT_MS` and no `…_MAX_USAGE_LIMIT_WAIT_MS`.
   Claude Code merges `env` one variable at a time across settings sources, so a crew session
   also gets what the person's own settings set and this file does not: the gateway's base URL,
   and — where `setup` wrote it (D56) — the 24-hour usage-limit cap. With the cap, a limit that
   resets more than 24 hours away ends the crew session's turn, and § Waiting out a limit's
   pause and resume take over: the phase goes on after the reset. A crew session is unattended,
   which is what the watchdog is for.
   **The same file keeps Remote Control off** (`remoteControlAtStartup: false`, the owner's
   rule): nobody attaches to a crew session from a phone, and `setup` turns auto-connect on for
   the person's own sessions (D66). The key is security-sensitive — Claude Code takes a `true`
   only from the user's, a `--settings` or managed settings, but a `false` from any — so this
   file turns it off for the crew session alone (read from the 2.1.310 binary; a session that
   shows no Remote Control is still owed, `docs/claude-code-contract.md`). A crew session started
   before the key keeps its old file until its next start.
   **The same file keeps the session's name** (`NO_AI_TITLE_ENV`, `start.ts`):
   `CLAUDE_CODE_DISABLE_TERMINAL_TITLE=1`, which Claude Code's docs (env vars) say skips the
   background small-model request that writes a session title. That `ai-title` replaced the
   `--name` a crew session starts with in agent view — 40 of 248 crew sessions of one project,
   read on 2026-10-31, often with the words of a hook's error — so neither the lead nor the person
   could tell its phase. A crew session started before 1.7.2 keeps its old file on a resume, as
   above; a live proof is owed (`docs/claude-code-contract.md`).
   **The same file makes the session lean**: `enabledPlugins` turns off every plugin the machine
   enabled except this one, what `workflow.crew.keep` names, and every plugin those depend on,
   `disableClaudeAiConnectors: true`
   stops the claude.ai connectors, and `mcp.json` beside it is the `--mcp-config` file — the kit's
   own tasks server (every kind, `alwaysLoad`), Tavily (every kind) and the browser (`ui`),
   with no key in it (`Bearer ${TAVILY_API_KEY}` is Claude Code's placeholder). The settings
   allow `mcp__cc-smart-dev-kit-tasks__*`; resume keeps the server in the rewritten MCP file. A `claude plugin list --json` read decides
   what to turn off; one that fails turns nothing off, because a lean start never fails a start.
   Entries merge key by key across settings sources, so a plugin the file does not name keeps its
   own state (`docs/claude-code-contract.md`). **A plugin whose dependency is off does not load**,
   this one included: 1.1.0 turned claude-mem off, and its crew sessions ran with no kit — no hook,
   no guard, no crew skill (proved live on 2.1.309, `docs/claude-code-contract.md` § A lean crew
   session). So the off list never holds a plugin this one depends on (`DEPENDENCIES`, from
   `plugin.json`: claude-mem, frontend-design) or one a kept plugin depends on, at any depth, read
   from each kept plugin's installed `.claude-plugin/plugin.json` (`neededByKept` in
   `src/crew/claude.ts`; a manifest it cannot read names none). A dependency declared only in a
   marketplace entry (`marketplace.json`, with no `dependencies` in the plugin's own manifest)
   is not read: a kept plugin that does that may still not load in a crew session.
5. **The launch**, for a crew session that starts: `git worktree add -b crew/<phase>-<slug>
   .claude/worktrees/crew-<phase>-<slug> <base commit>` in the main checkout (fast; anything slow,
   a dependency install, is the crew session's own first step: the brief's frame says to install
   in its own worktree and never to link another checkout's dependency folder, because undoing
   such a link is a path outside the worktree, which Claude Code asks the person about), the `.worktreeinclude` files copied
   (`src/worktrees/include.ts`, as Claude Code does for its own worktrees), then from the main
   checkout `claude --bg -w crew-<phase>-<slug> --name "C <tag> <plan> <phase> <slug>" --model <m> --effort
   <e> --permission-mode auto --autocompact auto --strict-mcp-config --mcp-config <mcp.json>
   --settings <settings.json> -- "/cc-smart-dev-kit:crew <first line>"`. The
   prompt starts with **the crew command** (`CREW_COMMAND`, built from the plugin's name): Claude
   Code arms a plugin monitor only when its skill is dispatched under the full name, by the
   `Skill` tool or by a slash command, so a prompt that said "work by /cc-smart-dev-kit:crew" in
   the middle of a sentence armed nothing, and a crew session whose model never called the `Skill`
   tool ran with no `crew-self` monitor (the paragraph on the monitors, further down this page).
   The first line comes after the command as its arguments, which Claude Code puts under
   `ARGUMENTS:` at the end of the skill. It names the crew session, its lead and the brief's path;
   it holds no `"` or `%`, which a
   `.cmd`'s `cmd.exe` line could not carry. `--autocompact auto`: Claude Code's own window for
   the model stands, and none of the person's `autoCompactWindow` settings applies to the crew
   session (`auto` skips them; `CLAUDE_CODE_AUTO_COMPACT_WINDOW` still does). Its compaction comes
   after the crew's own hand-off line (`workflow.crew.handoffTokens` and `handoffPercent`, and a
   margin below the compaction point; the window the gauge measures is `context-window.ts`).
   `--mcp-config` comes **before** `--settings`, never last: it takes any number of files, so the
   prompt after it would read as another config (proved live on 2.1.309). The settings are a
   **file** on every platform. On Windows a `claude.cmd` runs through `cmd /d /s /v:off /c` with
   one quoted line (`windowsRun`, the hooks' own quoting); a `claude.exe` runs as it is.
6. **The session id, and never the folder**: the short id is read from `backgrounded · <id> ·
   <name>` (`--session-id` is ignored with `--bg`), then `claude agents --json --all` is read once
   for the session's id. The crew session is recorded with it and `startedAt`, and stays
   **`starting`**; a row that is missing, or a list that does not read, is failed with no retry.
   **Its `cwd` is not judged there**: agent view reports the launch folder until a `--bg -w`
   session has entered its worktree (proved live on 2.1.308, `docs/claude-code-contract.md`), so the one
   immediate read raced the move and failed and stopped every crew session of the first live use
   (H101). **The session judges its own folder** at its `SessionStart` (`crew-role`): its input's
   `cwd` against the record's worktree. Inside it, the role card, and a `starting` record becomes
   `working` (one state event, "started in its worktree"). Outside it, an open record is `failed`
   with where it started (a phase that already ended keeps its state: `merged` is what a
   dependent phase waits for), and the card tells it to do nothing and end its turn — so the
   lead's watch stops the session (D35). **The hook does not stop it itself**: a SessionStart
   answer's `{"continue": false}` is not acted on in 2.1.308 (`docs/claude-code-contract.md`).
   A `starting` crew session whose session died before its `SessionStart`
   is the watch's own store-truth rule: agent view says `failed` or `stopped`, and the record says
   so too. When nothing started — `claude` refused (`Workspace not trusted`: open the repo once
   with `claude` and accept the trust prompt), or `claude --bg` failed — the worktree and its
   branch are taken back (the branch only while it still points at its base), so a second try
   finds the name free. When a session may have started — no `backgrounded` line, or no answer in
   time — the worktree stays.

### A plan's own folder, and the record of each crew run (PL1)

The owner's two asks (2026-10-25): a plan's briefs live in a folder per plan, kit-wide; and
what ran a phase must last after `crew rm`. D62 cleans finished work up and AR1 archives only the
conversation, so before PL1 nothing said, a month later, which session built a phase, on which
model, and how long it took. `src/crew/runs.ts` holds the layout and the record,
`src/crew/runs-history.ts` `crew history`.

```
<plans dir>/<plan stem>.md                           the plan
<plans dir>/<plan stem>/briefs/<PHASE>-<slug>.md     a phase's brief, named as the crew branch
<plans dir>/<plan stem>/runs/<crew id>.json          the record of one crew run
<plans dir>/archive/<plan stem>/…                    the folder after the plan is archived
```

**One folder per plan, never per lead.** One plan outlives its leads (one plan has had
three), and a folder per lead would split its briefs and its history. The file name is the crew
branch without `crew/`, so a plan row, its brief and its branch line up.

**Where the plan is: the lead record's `planFile`** (decided with the lead, 2026-10-25).
`crew lead --plan-file <path>` records it (absolute; the file must exist and end in `.md`). Without
the flag, `crew lead` takes the file this session recorded before, else the one an earlier lead
of the same plan recorded (a hand-over: the new lead repeats nothing), else the one file
`<plans dir>/*-<plan slug>.md` (or `<slug>.md`) in the repository's `.claude/plans` and the
person's plans folder (`<CLAUDE_CONFIG_DIR>/plans`, from `cliPaths()`) with the `archive/` of each.
None or several: off, and the first line `crew lead` prints says so; a plan written later is picked
up at the next `crew lead` or `crew start`, never guessed. Why a field and not a setting or only a
lookup: it is explicit, it works for a plan inside the repository and for one in the person's own
folder, and a slug alone cannot tell two plans of one slug apart. `crew start` copies it onto the
crew record (`planFile`), so the run record of a run is written where the run began even after
the lead changes or the plan is archived: `livePlanFolder` looks beside the old place, in
`archive/`, when the file has moved.

**Briefs.** `crew start` with no `--brief` takes `<plan folder>/briefs/<PHASE>-<slug>.md` and
prints `brief: <path> (the plan's folder)` first. A missing file is refused with that path;
no plan file at all is refused with `crew lead --plan-file` as the fix. `--brief <file|->` is
unchanged. The crew record keeps `briefSource` (the path, or null for stdin, and the sha-256 of the
brief's text), which the run record copies.

**The run record: one JSON file per run, written by the store.** One file per run, so two leads
never write the same file and a merge conflict stays impossible; JSON because the store's own
records are JSON, the files are read by `crew history` and by tools, and pretty-printed JSON
diffs well in git. It is written by the store's own writers in the same hold of the store's
lock as the change and its event (`recordRunOf` in `store.ts`: `createCrew`, `changeCrew` —
which `updateCrew`, `updateCrewIfState` and `answerCrewQuestion` use — and `recordCrewReport`),
so there is no second log and no second code path deciding what happened; a change that makes no
milestone writes nothing. It is an atomic write, 0644 (a plan file's mode, not the store's 0600:
the lead commits it). A write that fails never undoes the change: one line on stderr says so, and
the events log still holds the change. A crew session with no plan file is not recorded, and
neither is a first record once the plans folder that held its plan is gone (`plansFolderGone`,
which `crew history --backfill` asks too): a lead that kept its plan in its own worktree loses
that folder with the worktree, and a later change (a `crew rm`) would make the removed worktree's
path again.

What it holds: the facts of the start (id, name, phase, slug, kind, model and effort, base ref
and commit, branch, brief path and hash, the lead's session id and name); `sessions`, every Claude
Code session id with its time (the start, and each resume that brought a new id); `continues` and
`continuedBy`, a hand-off linked both ways; and `events`, the milestones — `created`, `state`
(a pause carries `waitingFor`), `session`, `question`, `answer`, `report` (status, tests,
checks, review), `merged` (the lead commit from the merge proof), `removed`, and `note`. Each
event has `by`: the lead session that made it, so a plan with three leads says who answered,
merged and removed: `by` is set on `answer`, `merged`, `removed` and a discard, and is null on the
crew session's own changes (its report, its session, its pause). A correction of an answer (AN1)
is a second `answer` event with `detail.correction`, so the history keeps both answers in order.
`crew model` writes a `note` when the model or effort a crew session runs on changes (`detail`:
`from` and `to`, each with the model and the effort), and a second one when the change is put
back because the session could not be stopped; a change an opus cap holds writes none until the
watch applies it (`noteCrewRun`). The acting lead comes from the
session above the command (`actorOfCaller`, `runs-actor.ts`, used by `crew answer`, `crew model` and by
`markState`, which `stop`, `resume` and `rm` share); where no recorded lead is above it (the
watch's merge, the portal's click, a script) the event names the lead the crew session belongs to,
which after a hand-over is the lead that started it, not necessarily the one that acted.
`times` are derived from the events and written beside them: `wallMs` (recorded to the end of the
work), `workingMs` (started to the end, without the pauses; a wait for the lead, a question or a stop is
still counted, and the end is the last report, so a run answered and finished again counts to its
second end), `queuedMs`, `pausedMs` and each pause.

**It is never deleted.** `crew rm` and the clean-up of finished work leave it. When the plan
is archived, its folder moves with the plan file to `<plans dir>/archive/`, the same move
`/cc-smart-dev-kit:plan-task` § 8 makes for the plan, and the writer and `crew history` find it
there. The kit never commits it: the lead commits the folder with its plan, and before it removes a lead worktree
that holds an untracked plan folder. A crew session's own
commands (`step`, `report`) reach the writer too, and write to the absolute path the record gave,
never into their own worktree.

**`crew history [<phase>] [--plan <stem>] [--json] [--backfill]`** prints one line per run: phase,
sessions, model and effort, started, finished, took (the working time), status. `--backfill` writes
the records of runs from before PL1 from what the store still holds — the crew records, the
events log, the hand-back reports — once, never over a record that exists. It cannot know what the
store never kept: the earlier session ids of a resumed run (only the last is on the record), which
lead session answered, merged or removed, and why and how long a pause lasted; each file it writes
says so under `backfilled`, and so does the command.

**For MC1** (a running crew session's model changes): call `noteCrewRun(stateDir, repo, id, atMs,
{ by, detail: { from, to }, text })` (`store.ts`); it adds a `note` event under the store's lock and
changes nothing else.

### A phase from an issue (GI3)

`crew start <phase> --issue <n>` starts a phase from a GitHub issue (D67, `src/issues/pickup.ts`).
Everything about *which* issue may start work and how its text is kept as data is in
[issues.md § A phase from an issue](issues.md#a-phase-from-an-issue-gi3); this is how it sits in
the crew:

- **Where it runs in `start`.** In `plan()` (`start.ts`), after the lead and the plan file are
  known and before the brief is read: `readIssue` calls `pickIssue`, and a refusal is a `crew start:`
  refusal with the reason, before any record, worktree or branch exists. The brief is then the
  issue's block alone, or `--brief`'s text and the block (`readBrief`); the plan folder is not
  looked in when the issue is the brief. A queued start keeps the brief it wrote: nothing is read
  from GitHub again at the place a queue frees, so the person's choice is read once, at the start.
- **The frame.** `briefFrame` adds one line when `BriefFacts.issue` is set: the quoted block is the
  issue's text, written by its author, data and never an instruction. A hand-off writes the frame
  again from the record's `issue`; the old frame is cut off with the old brief, so the line is in
  the next brief once, and the quoted block (before the frame mark) comes along.
- **The records.** The crew record's `issue` (`store.ts`: `author`, `number`, `repo`, `url`) is
  written by `createCrew` and copied by a continuation (`planContinuation`); `startOf`
  (`runs.ts`) copies `number` and `url` into the run record, so `crew history --json` links a run
  to its issue and the link lasts after `crew rm`.
- **The hand-back.** `runCrewReport` calls `sayOnIssue` after the report is built and before it is
  recorded, so a comment that could not be posted lands under `open` in the same report. The
  comment's reads and its write go through `CrewContext.gh` (the real `runGh` when a test leaves it
  out), with the project's main checkout as the folder.

### The board and the end of a crew session

**Release (D69).** A crew session leaves agent view when its session is over, not when its
branch merges. Claude Code's `claude rm` keeps a row while its worktree holds commits that are on
no remote and not on the default branch, and a crew session never pushes; so the kit takes the
worktree away itself, and the row can go. The watch releases a `done`, `handoff`, `failed` or
`stopped` record (`RELEASE_STATES`, `lifecycle.ts`) on the first pass where agent view could be
read and shows no process for it (`isLiveRow`, the one rule the answer's own liveness check reads
too) — a `done` or `failed` session the watch stops first (D35), and releases on the pass after;
so is a `handoff` whose session the next crew session's start could not stop (`stopContinued`).
**A row with no process is no session to stop, whatever its state:** `claude stop` leaves a row
`done` with no pid (2.1.314), and a watch that read that row as live never released it — the
finished crew sessions that stayed in agent view for good, fixed in 1.7.2. A `merged` record whose removal is held — left for the lead's `crew rm`
(D62) or kept for its chain — is released too, so it leaves agent view while it waits: its work is
merged, so a session of it that still runs is stopped by the release itself, and the removal it
waits for still deletes its branch. A record whose worktree went before its `claude rm` is
released while agent view still lists a row of it. `blocked` is never released: its question is
live until its idle stop makes it `stopped`. The release (`release.ts`) is `crew rm`'s own steps (`runCrewRm` with
`release`: its lock, its dirty-work check, the machine verdict, the leftovers it may stop, the D62
move-aside), judged against the record's own branch, so no merge is needed: the worktree goes, and
`claude rm` runs on every session id of the record, earlier ones too (RX1). **The branch, the
record, its state and the conversation stay**; the record carries `released.at` from the moment
the worktree is gone — before `claude rm`, so a `claude rm` that fails leaves a record a resume can
still make the worktree again for, and the watch runs `claude rm` again while agent view lists a
row of it — and `sessionEndedAt`, the first end, which a later removal keeps, once `claude rm` let
the sessions go; it starts the conversation's timeline (§ A removed crew session's conversation).
Uncommitted work, a local file git does not keep, a person's lock, program or container, a resume
that holds its claim (`resumeClaimHeld`, under `RESUME_CLAIM_MS`), or machine facts nobody could
read keep the worktree and the row: one line says why, with the removal's own fix, and the watch
tries again when the branch or the folder changes, or after `PARKED_PASS_MS`.

A released record stays on the board (`released — branch … kept`), its reminder still comes once
a day, and the lead merges from its branch; after the merge the watch's removal (or `crew rm`)
deletes the branch as for any record. `crew resume` and an answer that resumes a record make the
worktree again first (`restoreReleasedWorktree`): at its own path, on its kept branch, with its
`.worktreeinclude` files, under the record's removal lock and from the record read again inside
it, so a resume and a release never cross. All or nothing: a copy or store write that fails takes
the new folder back, and a folder already at that path is never replaced. The resumed session is
told its folder is new and to install dependencies first. `crew rm --discard` of a released
record makes the worktree again the same way, under the lock the removal already holds and
without the `.worktreeinclude` copies, then discards as for any record: plain `crew rm` still
refuses the unmerged branch, and a released record keeps its name (`holdsName`) while its branch
is kept. A lead that is gone runs no watch, so
`sessions --finished` lists the finished records of a lead seen gone for a day first, and
`--remove` releases them after its own question; an unreadable agent view or a lead not yet seen
gone releases nothing.

`crew list`, `status`, `log`, `kinds` and `attach` read; `stop`, `resume` and `rm` act (`board.ts`,
`end.ts`, `remove.ts`; their help is one table, `usage.ts`, which the help table's rows
(`src/cli/help.ts`) and `crew --help` read too). All of them look a crew session up **in this
repository's store only**, by its name (also the ` [ref]` form ListAgents prints), its id, its
session's short id or its session id. A name that matches two **live** crew sessions is refused and
both are named; a name whose other matches are `removed` means the live one — a lead that reused a
name after a removal acts on the session it has, never on its history, so the store, never a guess,
decides which session is meant (D35; the bug of 2026-10-23: `crew rm <name>` stopped at "name one by
its id" and the old queued record stayed, so two crew sessions started for one phase). One finder,
`findNamed` (`board.ts`), answers for crew sessions and for leads (`crew lead tell`). A crew session's own
session (`CC_SMART_DEV_KIT_CREW` set) never runs `stop`, `rm` or `resume`.

- **`log <name>`** (`src/crew/log.ts`) prints `git log --oneline <pinned-base>..<branch>`
  and the diff stat against their merge base. It reads shared refs from the current checkout,
  never the crew worktree, and never writes the store. A queued session without a base, or a
  deleted branch, gives an error rather than an empty history.
- **`list`** shows the repository's crew sessions (`--all`: every repository), newest first, one block
  each. Removals older than 6 hours are hidden by their removal state event, not their last write.
  A footer counts them and names `crew list --removed`, which includes them. `--json` keeps
  every stored record without that filter. The state's age is the newest `state` or `created` event about the crew session, not
  `updatedAt`: the watch writes a line or a memory reading every few seconds, and that changes
  the record without changing what the crew session does. Its last step or line is its newest event
  with a line, else `lastLine` — **never an event another session wrote about it**: a `clash` names
  the crew session whose files are wanted, but the words are the starting lead's, and a `lead-tell`
  or a `merge` is another lead's news too. **The files its brief gives it** (`--files`) are one line of the
  block when it names any, so the board is the ownership map too: two crew sessions that list one
  file collide. A queued crew session says what holds it, recomputed from the store the
  way `crew start` decides (`placeFor`: the phases it waits for, then the cap of all crew sessions,
  the opus cap, the memory), or that a place is free and only its lead's watch is left to start
  it. `--json` prints the records as stored. A record that cannot be read is named on stderr and
  the rest still prints.
- **`stop`** runs `claude stop <short id>`: the conversation stays on disk. A crew session that was
  running becomes `stopped`; one that ended with an outcome (`done`, `failed`, `handoff`,
  `merged`) keeps it, because a phase that waits for it (`--waits-for`) reads only a merge,
  and stopping its process changes nothing about that. A stop Claude Code refuses for a session
  that agent view does not list counts as stopped (the goal is met); one it refuses for a listed
  session is an error and changes nothing.
- **`resume`** brings that one session back with `claude --bg --resume <session id>` **in the crew
  session's own worktree**, with what `crew start` gave it: its own `--settings` and
  `--strict-mcp-config --mcp-config` files, and the model, effort, permission mode and autocompact
  the record names (`resumeSession`, `answer.ts`). Never `claude respawn`, which does not re-apply
  `-w` (read from the 2.1.309 binary) and brings a `--bg -w` session back in the folder it was
  launched from — the main checkout — where its own start check marks it failed (the bug of
  2026-10-23); and never `--all`, which restarts every background session on the machine. A
  session that still has a process is not resumed — `--bg --resume` would start a copy beside it —
  and the line says it runs already. An agent view that cannot be read is a refusal, never read as
  dead — it could be either, and a copy is worse than a second try. The crew session is `working`
  again, **with the session the resume brought back** (§ The session a resume brings back). It
  is refused for one that is `removed` or `merged`, has no session yet, or has no worktree or
  settings file any more (one line each). It does not check the caps: the person or the lead
  asked for exactly this session.
- **`rm`** ends a finished crew session, and refuses at the first step that would lose something. A
  crew session commits on its branch and never pushes (D24), so **only the branch the crew session
  was cut from decides** whether its work is kept: `workOnRef` (`src/worktrees/scan.ts`, the one
  answer `crew rm` and the lead's watch share) asks it of the crew session's branch against the
  commit the branch it was cut from (`record.baseRef`) is on, else the commit checked out in the
  lead's own folder (its lead record's `cwd`). The work is there when the branch is an ancestor (a merge commit, a fast-forward), or
  when merging it into that commit changes nothing (`git merge-tree --write-tree`, the replay
  `worktrees --clean` uses: it sees a squash merge). A conflict, an error or a git older than 2.38
  is not certain, and the crew session is kept. A branch with no commit of its own has nothing to
  lose, so the removal goes on. Then: uncommitted work in the worktree refuses it (before any
  side effect), and so does a lock a person took on it (`git worktree lock`; Claude Code's own
  lock — its reason starts `claude session` — is released, and **locked again with the same
  reason if a later step refuses**, because the lock protects the worktree); first the session is
  stopped, then its Claude lock is released; **the programs its own finished turn
  left running are stopped too** — SIGTERM, a 3 s grace, then SIGKILL, one line said — when the
  session is gone or stopped and every program there is the session's own (`findOwnLeftovers`
  discovers them, `stopOwnLeftovers` stops them after the verdict; both removal callers share them). A program is its own when it
  has a readable environment carrying the session's crew id — everything its Bash started
  inherits `CC_SMART_DEV_KIT_CREW`, and keeps it when init adopts it after the session ends
  (`/proc/<pid>/environ`, Linux). An unreadable environment is never proof, including on macOS.
  The verdict first ignores those owned programs; only a finished verdict permits stopping them. A program that is not — a shell or a dev
  server the person started there, however long it has run, another crew session's program, a
  container — keeps the worktree, as before, and one such program keeps them all; the kit's
  own finished-worktree verdict (`src/worktrees/scan.ts`, the one `worktrees --clean` uses) judges
  the worktree **against the branch the crew session was cut from rather than `origin/<base>`** (`ScanOptions.against`)
  and removes it, then its branch by the same rule (`deleteBranchOnRef`); and only then
  `claude rm <short id>`, which refuses a worktree that is still there (proved live, L1a.1). A
  `claude rm` that fails leaves the crew session `stopped` with a `step` event saying what is left, and
  a second `crew rm` goes straight to it. Nothing is ever forced: `claude rm` has two force
  flags (`--discard-unpushed`, `--force-remove-worktree`), and neither is used.
  A squash-merged crew branch is removed like any other; a squash that missed a later commit
  of the crew session is refused, with the count. **A queued crew session is removed at once**,
  and so is one whose launch left nothing behind: the removal records whether the lead had merged
  first (`mergedBeforeRemoval`), so the phases that wait for it start on that fact alone.
  **A removal that stopped halfway is finished** (D62, `src/worktrees/scan-parked.ts`). The kit
  moves a worktree it judged finished to `<path>-removing-<time>` before asking git to remove it;
  when git then fails, the folder stays in one of two states, and both were seen on a real
  machine (3 of the 8 left there were the first, 5 the second):
  - **git still lists it.** It is judged again by the same verdict as any worktree — nothing runs
    from it, no session or container uses it, nothing in it is uncommitted beyond tracked files
    the removal itself deleted — and, because its branch holds the commits and the move was the
    removal's own touch, it asks for neither the commits on the base nor the idle hour
    (`WorktreeFacts.parked`; a detached folder, whose commits no branch holds, keeps the commit
    rule). It is removed where it stands, never moved aside a second time.
  - **git no longer lists it.** `git worktree remove` deleted the registration and the `.git`
    file, then failed on a file it could not delete: half a folder nobody tracks. Git cannot judge
    it, so the folder's name does: it carries the time of the move, the verdict that allowed the
    move said everything in the folder was disposable, and a file written after that time is not.
    So it is removed (`rmSync`, links as links, nothing outside it) only when nothing runs from
    it, it is no repository and has no registration of its own, it crosses no mount, and no file
    in it is newer than its move (a directory's own time is not read: it moves when git deletes an
    entry). Anything else stays, with the reason. Such a folder is finished only where the kit
    can read the mount points, which today means Linux (`mountPoints`,
    `src/worktrees/machine-facts.ts`). On Windows and macOS it stays, and the clean's log says why
    ("its mount points could not be read"); remove it by hand.

  An unreadable scan retains every requested parked path with its error; a busy clean lock refuses
  the pass before any removal. `crew rm` finishes both kinds in the repository — its own record's first, and it refuses while
  its own stays — `worktrees --clean` and the background clean finish any, and the watch looks
  every five minutes (`PARKED_PASS_MS`): a folder that stays costs a scan of the whole repository.

#### The session a resume brings back

**Every crew resume is a copy with a new id** (WF1, 2.1.310). `claude --bg --resume <id>` on a
session whose saved options differ from the flags it is given starts a copy, and says so on
stderr — "background session `<old>` keeps its own saved options, so the flags you passed started
a copy as `<new>`" — and every crew resume passes the record's own flags (`resumeArgs`: the
settings and MCP files, the model, the effort, the permission mode), because the crew frame
depends on them; a resume without them is not proven to keep the crew env. Seen live on
2026-10-25: record `c7186986` was resumed by the lead at 21:07:28, Claude Code opened `d7a54fc8`
in the same worktree, the record kept `c7186986`, and at 21:07:38 the watch read the old
session's row as stopped and marked the record `stopped` — while the new session ran on, unseen.

So **one home reads which session runs now** (`resumeSession`, `answer.ts`): the
`backgrounded · <short id>` line on stdout (2.1.310 drops ` · <name>` when there is none), checked
against the copy note on stderr (`parseCopyNote`, every note the binary prints). The same short
id and no note is the record's own session, going on; any other id is read from agent view, as a
start reads its own (`startedRow`, `claude.ts`). **The record takes the new `sessionId` and
`shortId` in the same write that makes it `working`** — `crew answer`, `crew resume`, `crew
resume --paused` and the watch alike — so it never names a session that is gone, and the line
says it: `resumed C kit B6b portal-live as session d7a54fc8 (a copy of c7186986)`. The old session
is a stopped row with no process. The record keeps it (`earlierSessions`, RX1), so `crew rm`
removes it with the rest (§ A removed crew session's conversation); `sessions --finished` never
offers it, because it is the crew's own.

**An earlier copy that comes back stands down.** Seen live on 2026-11-02 (2.1.316): after a
Claude Code restart, the lead's `crew resume` made copy `361009ed` of `955c446a`. Eight seconds
later, Claude Code restored `955c446a` itself. Its SessionStart hook was given the main checkout
as `cwd`, while its transcript at the same moment names the worktree. So the wrong-folder rule
failed a record that now belonged to the copy, the watch stopped the copy that was right, and
the lead built the phase a second time. Its reviewer's findings went to the old copy, which
could not send them on.

Now a session whose id is in the record's `earlierSessions`, and is not its `sessionId`, is an
earlier copy:
- its role card says it is an earlier copy, names the current session, and says to do nothing
  and end its turn;
- `startCard` checks this before the folder, and changes nothing in the store;
- every other answer of `crew-role` writes nothing for it either. A prompt gets the same
  stand-down line as context, with no `person` event and no title change. Its Stop and
  StopFailure are silent: no `lastLine`, no pause, and no "hand it back with `crew report`"
  block, which would tell it to finish the phase. An edit tool is denied with the same line;
- its own commands (`crew step`, `crew report`, the self-watch) are refused in `readCrewSelf`,
  the one home for a crew session's own record;
- the watch stops every live agent-view row of that earlier session once, with one line each.
  It never stops the record's current session.

One predicate decides all of this (`isEarlierCopy`, `src/crew/store.ts`), because one session
id can be in both lists: after A → B → A, the current session A is also an earlier one.

A session id the record does not know is judged as before, because a fresh copy may start
before its resume is recorded. **Not proved:** whether Claude Code also gives a restored
session that is the record's current one the main checkout as `cwd`. If it does, that session is
still failed, and the lead's `crew resume` brings it back as a copy in its worktree.

A resume that printed **no such line**, a note that names another id than the line, or a copy
agent view cannot show is said with the reason, and the record keeps its state and its session —
never `working` on a guess. Such a resume may have started a session nobody can name, so the
watch **does not try it again by itself**: it says so once, and the lead's own `crew resume`
brings it back (the hold goes when the record is no longer `paused`).

#### Changing a crew session's model or effort (MC1)

`crew model <name> [--model <m>] [--effort <e>]` (`model.ts`) is the one way to change what a
running crew session runs on; before it, only the person could (`claude attach`, then `/model`),
and the record kept naming the old model, so the caps and `crew list` were wrong.

- **The same checks as a start.** The values go through `chooseLaunch` (`changedLaunch` says what
  a model alone, an effort alone, or both ask for): a `ui` session never runs on an affordable
  model or below `high` (D50), and anything the Agent guard refuses or would ask about is
  refused (exit 2, the guard's words).
- **By state.** A **running** crew session (`working`, `blocked`, `quiet`) is stopped when its
  process lives (`stopSession`) and resumed with the new flags through `resumeSession` — the one
  resume path, so the session Claude Code opens is followed — with a prompt that says what
  changed and to go on from where it stopped. A **stopped** or **paused** one keeps its state
  and its wait: the record holds the values, and its next resume reads them (`resumeArgs`, from
  the record) — the opus caps are judged when the values are stored; a later `crew resume`
  still passes the launch gate (§ The lead and the launch). A **queued** one starts on them (`startQueued` re-reads the record under the places lock, so a
  change made after the watch listed it, or while it waited for the lock, is used). A session that ended its phase, a removed or
  discarded one, one still `starting` and a `blocked` one (it waits for the lead's answer, and a
  resume that says "go on" would tell it to continue without it) take no change.
- **The record is the truth.** The model, the tier and the effort are written under the places
  lock *before* the session is touched, so the caps and `crew list` count the new tier at once
  and a resume that fails leaves the values stored for the next one. The resumed session's id
  comes in the write that makes it `working`, as everywhere (§ The session a resume brings
  back).
- **The replacement.** After `crew model` stops the old process, `resumeSession` uses
  `replacesItself` under the places lock. It bypasses admission holds, including the gap: it
  replaces a running session and adds none. Otherwise a hold would strand the stopped process.
- **The caps.** A move onto the opus tier is judged as a new opus session by `placeFor` (the
  per-lead and machine opus caps, the usage window), with the session itself left out of the
  counts and the total caps, the memory and the CPU load (`crew.loadPerCore`) left out too, since
  a change adds no place. When one holds, the
  change waits on the record (`pendingLaunch`: the model, the effort, the reason, when): the
  session runs on as it is, the line says `queued (<reason>)`, and the lead's watch applies it on
  a pass where the caps allow (`applyPendingModels`, under the lease like a start). A later
  `crew model` that lands on a value replaces or drops it.
- **A crew session never runs it** (`CREW_NEVER_DOES.model`, the Bash judge): its model is its
  lead's call.
- **Proved on 2.1.310** (`docs/claude-code-contract.md`): `--resume --model --effort` runs the
  next turn on the new model and effort, and a crew-shaped `--settings` file pins neither. The
  live `--bg --resume` form is owed (a crew session's guard refuses `claude --bg`).

### A removed crew session's conversation (AR1)

`claude rm` deletes a background session's job and its worktree, never its conversation:
`~/.claude/projects/<project folder>/<session id>.jsonl` and the `<session id>/` folder beside it
(its subagents' transcripts, its tool results) stay, so Claude Code's `/resume` lists every crew
session the kit ever removed (on one machine, 58 of 62 removed crew sessions' conversations were
still there, in 224 crew-worktree project folders and 10 GB). Claude Code's own `cleanupPeriodDays`
cannot help: it deletes every conversation older than its days, the person's own included.

So the conversation follows a **timeline (D69)**, counted from when the crew session's session
ended — its release, or its removal when no release came first: `sessionEndedAt` on the record,
which a removal after a release keeps, and which a record that works again clears, so its next
end starts a new timeline. For `crew.archiveDays` (7) after that end the conversation stays in
`/resume`; then it moves to the kit's archive; `crew.deleteDays` (30, never below
`archiveDays`) after the same end the archive is deleted. One sweep does both
(`sweepCrewConversations`, `archive.ts`): the lead's watch runs it at most once an hour, and
`sessions --finished --remove` runs it too; `sessions --finished` lists what is due, the date
each waiting conversation moves and the date each archive goes. `runCrewRm` itself moves,
prunes and waits on nothing of the archive. Each move reads its record again under the archive
lock, and keeps a conversation whose record a resume holds a claim on or that works again. **A
resume puts the conversation back first** (`restoreConversation`, once it holds its claim and
before the worktree is made again — so a sweep never takes back what it just restored): under the
archive lock, only the
files of the record's own sessions, never through a link, refusing a file of other bytes at a
target before it writes anything, staging each file and linking it into place (a link never
replaces a file that appeared meanwhile), and taking back every file and folder it made when one
step fails. A record from before the field counts from the event that removed it.

- **Every session the crew session had (RX1).** A resume is a copy with a new id (WF1), and the
  record's `sessionId` and `shortId` move to it. The write that changes the `sessionId` (`changeCrew`,
  the one store write) keeps the session it replaces on the record, oldest first
  (`earlierSessions`; `crewSessions` lists them with the current one first). So `crew rm` runs
  `claude rm` on each short id (a session agent view no longer lists is gone already), the archive
  moves each session's conversation into the same folder, and `sessionsNeverTaken`, the finished
  list and the sweep (`readCrewLeftovers`) all count every one of them: none stays in `/resume`
  past its date or in `claude agents --all`. A record from before the field has only its current session. When one
  session's conversation stays (a running Claude holds it) beside one that moved, the outcome says
  so (`stayed`).
- **Where it goes.** `<state>/crew-archive/<repo key>/<crew id>/` (the repo key is the crew store's
  own, `repoKey`): `archive.json` (who it was, the project folder, when), `report.json` (a copy of the
  hand-back report) and `projects/<project folder>/…` in **Claude Code's own layout, each file
  gzipped on its own** (`.jsonl.gz`) and keeping its last-write time. The project folder's name comes
  from `transcriptFile` (`transcript.ts`, over `projectFolderName`: the one home, with
  `CLAUDE_CONFIG_DIR` honoured through `cliPaths`), never a second copy of the naming. That naming
  includes Claude Code's cut for a long path: a name over 200 characters is cut there and ends with
  `-` and a hash of the whole path (seen live, 2.1.310, § Lead and the crew of the contract); a
  worktree path past 200 characters would otherwise find nothing. Why not delete
  at once: the conversation is the only record of why a crew session did what it did; the router's
  history is metadata only.
- **How it moves.** Every move and every prune holds one lock on the archive folder
  (`withArchiveLock`), and a move reads the conversation again once it holds it: two removals of one
  crew session (the watch's and a `crew rm`, the background clean and a sweep) take turns, and the
  second finds nothing left. Each file is written to a temporary name, synced and renamed into
  place, and only then is the original deleted; the original is stat-ed before and after, and a file
  that grew while it was archived stays where it is and its copy goes. A source that is *gone* after
  its copy was made keeps the copy (`sourceAfterCopy`): a copy is deleted only when its source is
  still there and changed. A move that stops halfway leaves every file in one place or the other
  (or, for a moment, both: the readers count it once) and the next removal or sweep finishes it.
  **An archived copy is never overwritten**: when any file's archived copy has other bytes (a job
  that kept running after its files moved was seen to write a new one) nothing of that conversation
  moves, it stays where it is, and the line says why (`kept`, not a failure: there is nothing the
  person can clear); the same bytes are the earlier move's leftover, and finish it. The archive's
  `archivedAt` is written once, by the first try. A session folder that is itself a link is not
  followed, and nothing under its target moves. Empty folders go with
  it, the project folder too once it holds nothing — Claude Code leaves an empty `memory/` folder in
  a project folder (seen live, 2.1.310), which counts as nothing; a note in it, a file, a link or
  another session's files keep the folder.
- **What is never taken** (`.claude/rules/setup-and-managed-files.md`: never take what is not
  ours). A **lead's** session (every lead record's, and every crew record's lead), the session of a
  crew record that is **not ended** (a terminal record with `sessionEndedAt` qualifies even while
  its branch waits for the lead), a session a running Claude process holds
  (`liveSessions`), and every file the store does not name. Only regular files move. A crew or lead
  record the store cannot read stops the move (`sessionsNeverTaken` throws): nobody can then say
  whose a session is.
- **A move that cannot happen never fails the removal.** The line says why
  (`note: the conversation of session <id> stays in /resume: …`) and names the way on:
  `sessions --finished --remove` moves it later.
- **D69 timeline:** the conversation stays in `/resume` until `workflow.crew.archiveDays` (7)
  after `sessionEndedAt`, then moves to the gzipped archive. The archive is deleted
  `workflow.crew.deleteDays` (30) after the same end. Deletion cannot precede archiving.
  Old records fall back to the removal event, then `updatedAt`. The watch runs the sweep at most
  once an hour per running watch; `sessions --finished --remove` runs it explicitly. No session-start
  run, timer or service is added. A resume restores the archived files first and clears the end time
  when the record becomes working, so its next end starts a new timeline. A
  repository whose folder is gone (moved or deleted) has no project file to read, so its archives
  expire by the person's own days like any other; only a settings file that is there and cannot be
  read keeps an archive (and is said). A prune that finds another run holding the archive fails
  loudly in the sweep and with a `note:` after a removal, and never fails the removal.
- **The sweep for what is already there** is `sessions --finished [--remove]` (`finished.ts`,
  `readCrewLeftovers`): it lists the conversations of removed crew records still in the projects
  folder, their worktrees' empty project folders and the archives past their days, and `--remove`
  asks once more (or `--yes`), reads them again, then moves, removes and deletes. A conversation
  written after its record was removed was resumed by the person since and stays, with the
  reason; the time of the removal is the `removed` / `discarded` state event's, not the record's
  `updatedAt`, which moves on whenever the record is touched again (the 30-day prune of a discard
  archive does). A conversation whose archived copy differs is listed as staying, with that
  reason. Listing moves nothing, and `--id` (finished background sessions only) leaves
  this part out.
- **Who reads the archive.** One reader walks both folders (`archive-read.ts`, `transcriptTree`):
  - `cc-smart-dev-kit usage` counts an archived session's replies and says so on its line (a past
    cost report that lost them at the move would be wrong);
  - the flow report (`flow.ts`) reads the archived copy once (an unzipped read from offset 0 under
    the same cache) and counts it the same as before the move;
  - `crew/transcript.ts` (the self-watch's context gauge, the watch's quiet alert) reads sessions
    that still run: an archived session has no context left to measure, so it never looks there;
  - the hooks read the transcript of the session that fires them (`transcript_path`), and the
    portal's live stream reads the store, the router and the job queue, no transcript: neither is
    affected;
  - the resume list (`savedSessions`) and the folders `setup` looks in for retired parts leave an
    archived session on purpose: that is what the move is for.
- **Bringing one back:** `resumeSession` restores the archived files to their original project
  folder before starting Claude. It refuses links, non-regular entries and differing target files
  before writing. Files are staged beside their targets, then renamed; a failed restore removes
  the files and folders it created. The archive is deleted only after every file is restored;
  failure to delete that extra copy is a successful restore with a note.

### The crew session's steps, its report, and the lead's watch

The lead never waits on a crew session (D25). Everything a crew session says arrives by itself: **the
events log** for what the crew session did, **the watch** for what the lead reads, and **the answer**
for what the lead says back.

**A step** — `cc-smart-dev-kit crew step <step> [--note <text>]` (`src/crew/step.ts`) — is
one milestone of a crew session's phase: a failing test, a passing one, the whole suite, the review
that starts and ends, the fixes, the commit, the pull request, the hand-off
(`CREW_STEPS`, one list). **Only a crew records steps**: the crew session is the one
`CC_SMART_DEV_KIT_CREW` names (its Bash tool carries it, L1a.1), and a session that names none
is refused. The command reads HEAD's sha itself, so the crew session never has to name its own commit,
and appends **one** event (`type: "step"`, the step's name, the sha, the note, the time). A step
the crew session does not know is refused, with the list of the ones it does.

**The hand-back report** — `cc-smart-dev-kit crew report --status done|blocked|failed|handoff
[--file <file|->]` (`src/crew/report.ts`) — is what the crew session gives its lead. **The command
fills the mechanical facts**, so the crew session never looks them up: the branch and its head, the
base it started from, the diff counted against that base (`git diff --numstat -z --no-renames`,
`diff.ts`), the files it changed that its brief did not name (the brief's `--files` globs; a brief
that names none names no boundary), the review the record holds for its branch, and its pull
request. A diff git cannot give — the base is gone, the folder is no worktree — is a refusal,
never "no file changed". The crew session gives the rest, and the command checks it against the store's
report shape before it writes anything: the targeted tests and the whole suite, the other
checks, the review's findings, the docs, what only the lead may do, and what is still open. The
file holds that part as JSON, or as prose, which is kept as the report's `summary`; with no file
the part is empty and the facts are still filled. A report that claims a review **the review
record does not hold** is refused — so the lead's gate (D22) never has to doubt it. The report
ends the crew session's phase: its state becomes the status, and the report file, the record and the
`report` event are written under one hold. **Only a `blocked` report carries a question** — the
one it waits on, or else the newest the crew session asked that nobody answered; a `done` report with
an old open question in it would tell the lead the crew session is blocked. **A `done` report waits
for the task list** (D75): open phase subtasks refuse it, with each task named. Finish them
with the kit's `task_done`, or drop them with a note; delete is only for a mistake. The one
`src/tasks/guard-view.ts` also reads Claude Code's list for one release, until setup denies
its tools (`docs/design/tasks.md`). A
`handoff`, `blocked` or `failed` report is never held: those exist because the phase could not be
finished. No list at all — a session that never got the tools, or one whose folder cannot be read —
lets the report through with one `note:` line on stdout, so the lead can tell the two apart.

**A `done` report is held for red or missing work too** (RG1, `doneReportRefusal`), the line the
lead's gate draws (`plugin/skills/lead/SKILL.md` § 6), read from the report's own fields and never
from its prose. It is refused, with one line that says what is wrong and a `Fix:` line that names
the step, when: a test run or the whole suite it lists failed (`ok` false or `failed` above 0); a
check it lists failed; the whole suite is missing (`tests.full` null); or neither a `review` nor an
`ownReview` is there. A `review` with an empty `findings` list is a clean review, and an `ownReview`
stands for the reviewer only with its `reason` (the brief asked for no second opinion). The suite
that never ran is refused as well as the one that failed: a report that makes no green claim is not
a green one, and a phase that truly cannot run the suite reports `failed` or `blocked`, which carry
red work on purpose and are never held (`handoff` too). The empty fields of 2026-10-25 had one cause:
the crew skill told a crew session what to give but never to pass it as JSON with `--file -`, so a
`done` report came with prose and every field empty; the skill now shows the JSON, and the gate
refuses the empty one with the step. **Nothing the crew session wrote is silently dropped:** a `summary` in the JSON part is the report's
`summary` (as a prose report is), and a field the shape does not know — a `measurements` list, a
misspelt `tests` — is kept as written under the report's `extra`, never over a fact the command
fills; a refused `done` report names such fields in its own line. **Limits, on purpose:** the gate reads fields, so a claim that was
never run (`tests.full` with `ok: true`), or an `ownReview` where the brief asked for a second
opinion, passes it; the lead's own check of the branch is what catches that. An `ownReview` is
not in the review record, but the watch prints `review ✓` for it and the portal's crew page shows
it as the review (with its reason): the lead still judges it from the report. The role card, the
brief's frame, the Stop-hook line and the message guard's refusals (`brief.ts`, `crew-role.ts`,
`message-guard.ts`) give `crew report --status done --file -` with the JSON part
(`REPORT_DONE_COMMAND`), as the refusal's `Fix:` line does.

**A question** — `crew report --question "<the question>" --option "<choice>" --option
"<choice>" [--recommend <n>]` — goes to the lead (D36). It is recorded at the end of the
crew session's `questions`, with a `question` event, and **the crew session's state does not move**: it goes
on with every part of the phase the question does not block. `--status blocked` says the crew session
has nothing left to do. A question needs two options at least, and a recommendation that is one
of them; `--option` and `--recommend` without a `--question`, and a `--file` with one, are
mistakes (exit 2).

**The answer** — `cc-smart-dev-kit crew answer <crew session> [--question <n>] [--file <path|->] [<text>]` (`src/crew/answer.ts`)
— comes back from the lead (an answer that starts with `--` is given after a bare `--`). A
**running** crew session gets it **from its own monitor** (AN1): the CLI cannot send a message
itself (Claude Code has no command that sends text into a running session, and `SendMessage` is a
tool only a session holds), so the command records the answer, and `crew self-watch` — the monitor
every crew session runs — looks for it every 3 s (`ANSWER_WATCH_POLL_MS`; it stats the crew
record's file and reads the record only when the file changed) and prints it into the session as
one line. A monitor line is a notification: it reaches a busy session between its steps and **wakes
an idle one**, a blocked crew session included (`docs/claude-code-contract.md`). The record tells
*recorded* from *delivered*: each question carries `deliveredAt` (null until delivered), and the
monitor claims the answer under the store's lock **before** it prints (`markAnswerDelivered`, which
gives back the claimed question), so two monitors of one crew session — the original and a copy a
resume started — never both print it. The claim covers *every* waiting answer, oldest first (a
crew session may have several questions open, and the lead answers the newest first), and an answer
is printed at most once: the claim comes before the print, so a line that fails to print is not
tried again. A record from before the field has no `deliveredAt` at all: its answers were sent by
hand and are not printed again. The monitor writes a heartbeat every 15 s (a one-shot `--once` run
writes none) (`<store>/answer-watch/<id>.json`); `crew answer` reads it, waits up to 10 s for the delivery, and
says which happened — `delivered`, or `recorded, not delivered` (no heartbeat, one older than 60 s,
or a monitor that did not pass it on in time) with the lines the lead sends it with by hand
(the person's click in the portal gets words instead — they cannot send it; and an answer sent by
hand while the monitor lives arrives twice) — first a line that says to load the tool
(`SendMessage` is **deferred**: Claude Code leaves it out until a session looks it up, and the
router drops a deferred tool a backend model has not loaded, so such a model must run `ToolSearch`
with `select:SendMessage` before it can call it), then
`SendMessage {"to":"<name>","message":"<text>"}`, the tool's arguments as JSON, so a quote or a
line break in the answer is escaped and never changed. The lead is never left without a way. **A
second answer to the same question is a correction**: the first is kept in the question's
`superseded` list (never deleted), the new one is delivered the same way, and its words say it
replaces the earlier answer — the last one the session *heard* (`lastHeardAnswer`): a correction
that lands before the first answer was printed claims to replace nothing. A question already closed
by the phase's end takes no correction
(`questionClosed`). A **stopped** crew session (D35: the watch stops a blocked crew session that
idles past `workflow.crew.idleStopMinutes`) is resumed with the answer as its next prompt
(that prompt is the delivery, and the same write records it as delivered; a correction's prompt
carries the replace words too):
`claude --bg --resume <session id> -- "/cc-smart-dev-kit:crew <text>"`, run in the crew session's
own worktree — which starts a copy with a new id (§ The session a resume brings back). **Every
resume prompt starts with the crew command** (`resumeArgs`, the one place that adds it: `crew
answer`, `crew resume` with the bare command, `crew model`, and the watch's wake of a paused
session): `--resume` does not arm a plugin monitor, so a resumed process ran with no `crew-self`
monitor until the command dispatched the skill again. A message to a process that still runs
(`SendMessage`) keeps the bare text: its monitor runs already. **A crew session the answer
reaches or resumes is `working` again, in the same hold that records the answer, with the session
the resume brought back**: a record that kept saying `blocked` would let the watch stop a crew
session that is busy, and one that kept the old id would read that session's stopped row as its
own. A stopped crew session that ended its phase (a `done`, `failed` or `handoff`
report) is not resumed by an answer, and a crew session the store does not know is never answered: the
store, not the name, says what is a crew session.

**The watch** — `cc-smart-dev-kit crew watch [--lead <session>] [--once] [--timeout
<seconds>]` (`src/crew/watch.ts`) — is the lead's window. It prints **one line per change and
nothing else**, from two readers:

- **the store's events log** (`events.jsonl`), read from the byte after the last whole line the
  last pass read (the store's own reader, `readCrewEvents`; a line a writer has not finished is
  left for the next read). A step, a report, a question and a state change are each one line, and
  **a change of state is said from its event and from nowhere else**: the watch's own acts write
  events too, and the pass reads the log a second time at its end, so a change it makes is said
  once, in the same pass. A report's line names the review the record holds, the phases that wait
  for this one and the report's file: `C kit B6b portal-live: done · review ✓ · unblocks B6c, B6d
  · report <path>`; a `blocked` one says what it waits on, a `failed` one why. Where the watch
  goes on is **per lead** (`<store>/watch/<lead session id>.json`), so two leads watch their own
  crew sessions and neither loses the other's lines; the mark is written when the lead records itself
  (`crew lead`), so the lines before it are history the lead already saw.
- **agent view** (`claude agents --json --all`), read on every pass. It raises five alerts, each
  said once while it lasts and none of them an action: a crew session that **needs the person** (a
  permission prompt or an input; when the wait ends and the record is still at work, one more
  line, `<name>: going again — the wait is answered`, so the lead stops naming it as waiting;
  agent view shows a turn that ended on a model limit as `blocked` too, and on a record the pause
  marked `paused` the line says so — `(paused: the watch resumes it once a model answers; do not
  attach)` — because that is no wait for the person), one
  whose transcript has not moved for `workflow.crew.quietMinutes` (**quiet**: one line when the
  stretch starts, one more at three times the quiet minutes, then nothing until the crew session
  writes again — the line carries the minutes, so the watch remembers the alert's key, not its
  text; WN1), one whose turn **ended with no report**, and one that
  **never confirmed its worktree** — its session is listed and alive, but its own start hook has
  not turned the `starting` record `working` within `WORKTREE_CONFIRM_MS` (3 minutes: the hook
  may have crashed, been silenced by `ownHooks`, or run outside git) — and the fifth, one **with no
  monitor of its own**: a session at work for more than `SELF_WATCH_GRACE_MS` (5 minutes) whose
  `crew self-watch` wrote no heartbeat in the last 60 seconds (`ANSWER_BEAT_STALE_MS`, the age `crew
  answer` calls "not running"). One line, once: `<name>: no self-watch — answers will not reach it by
  themselves; crew answer prints the SendMessage line to send`. A monitor is armed once for each
  Claude process, so a monitor that ended — or a session resumed into a new process whose crew skill
  nobody ran again — stays gone (the monitors paragraph below). The mark is dropped while the heartbeat is fresh,
  so a monitor that comes back and goes is said again. It
  also keeps the store true, because the caps count the crew that hold a place
  (`RUNNING_STATES`): a session that **failed** is recorded `failed` — unless a backend refused its
  turn (§ Waiting out a limit, "A backend's refusal is no crash") — and one the person
  **stopped by hand** is recorded `stopped`; neither then holds a place and keeps a queued crew session
  waiting for ever. A permission wait does **not** make a crew session `blocked`: the idle stop below
  would kill a crew session that only waits for the person to approve a call.

The watch **acts** as well, because a crew session never outlives its work (D35), and only on crew sessions
the store records — a session the kit does not know is the person's own:

- it **starts the queued crew sessions** of this lead when a place frees — through the launcher's own
  path (`startQueued`, in `start.ts`: the same `launch` that `crew start` runs, never a second
  launcher). **The workflow is read again at each pass** (`readCaller`, the reader `crew start`
  itself uses), so a cap, a threshold or the `crew.enabled` switch the person changes while a
  lead's watch runs reaches it within one pass; reading it once, before the loop, meant the
  owner's `crew.max 16` on 2026-10-23 never reached a running watch, which went on starting
  queued phases up to the old 24. A pass that **cannot** read it — a broken or too new file, and
  equally the person's own switch (`crew.enabled` off, a session in bypass mode, which
  `readCaller` refuses the same way) — **starts nothing**, keeps the last good caps for that
  pass's read-only decisions (the quiet and idle thresholds) and says why, once: a cap nobody
  could read is no licence to start a session. A queued crew session is cut from its `baseRef` when it starts, so a phase that waited for
  another starts from the merged result, and the folder `claude -w` opens is the record's own
  worktree, so a hand-off's numbered folder is the right one. A queued crew session held by a
  phase that was **removed before its work was merged** never starts by itself, and the watch
  says so **once**, with the way to drop the wait (`crew rm` the queued crew session, then start
  its phase again): the work it waits for is not on the lead's branch, so pretending it is
  merged would build the next phase on nothing;
- it **resumes the paused crew sessions** of this lead once the gateway answers again (D42): one
  first (the canary), the others `RESUME_SPACING_MS` (30 s) apart and only after the router
  answered a request since, and never while a slot's breaker is open or a Claude limit is
  current (§ Waiting out a limit);
- it **ends** a crew session whose turn ended with a `done` or a `failed` report (`claude stop <id>`;
  the conversation stays; a session that crashed has nothing to stop), and a `blocked` one that
  has idled past `workflow.crew.idleStopMinutes` (an answer brings it back). A `done` record and a
  `failed` one **keep their outcome** — the board must show how it ended, and `stopped` means
  something else (D62: a phase something stopped before it was over) — and each line says so.
  A stop that fails is said once, not on every pass. A session that still holds a process
  `STOP_SETTLE_MS` (a minute) after its stop is stopped again, saying nothing new: its process
  came back or the stop did not take, and a session with a process is never released. The stop's
  mark stays while the record keeps `done`, `handoff` or `failed` (`STOP_MARK_STATES`), so a
  process that comes back after a pass that saw none is not announced again. A `blocked` session
  stopped from outside keeps its row with no process: it is recorded `stopped` at its idle stop
  all the same, with nothing to stop;
- it **releases** a crew session whose session is over and holds no process (D69): the worktree
  and the agent-view rows go, the branch and the record stay (§ The board and the end of a crew
  session);
- it **marks a crew session `merged`** when its branch is merged into the branch it was cut from,
  and then **removes it with `crew rm`'s own steps** (D62, `runCrewRm`, never a second copy; its
  conversation leaves `/resume` on the timeline, § A removed crew session's conversation). A
  continuation holds the removal back until its work and every later continuation's work are
  merged into the first record's base — a continuation that failed, was removed or was discarded
  releases it (`holdsItsPredecessor`, `lifecycle.ts`: the one rule the stopped-session reminder
  uses too, since a successor removed before it started has no branch to merge, RX1). The line says so once; a refusal — a program runs from its worktree, or work
  nobody committed — is said once and left for the lead. A **`stopped`** record is marked merged
  too, because what waits for its phase starts on the merge, but **never removed by the watch**:
  stopping it was the lead's call, and so is its removal (the store keeps the fact from the state
  the record was in, `mergedWhileStopped`, so a later pass cannot forget it). **The watch's own idle
  stop is not the lead's call** (RX1): it marks the record `stoppedByWatch`, kept only while the
  record is `stopped`, and a merge of such a record removes it like any other. One removal of a
  record runs at a time (a lock in the record's files folder, `crewRemovalLockDir`): a second one —
  the watch's after the person's `crew rm --discard` changed the worktree — refuses at once and
  rolls nothing back. A pass reads the events log (it only grows) only when a record needs it, a
  stopped-session reminder (a `done`, `stopped` or `failed` record of this lead not reminded yet) or
  a legacy merge: on a log of 3 000 events (1.3 MB) the read takes about 23 ms, on 30 000 about 190 ms. The branch must hold a commit of its own (its tip is not
  the base it was cut from — a crew session that failed before it committed is an ancestor of the
  base for that reason alone), and its work must be on the commit **the branch it was cut from**
  (`record.baseRef`) is on, else the commit **the lead's own folder** is on (the lead's record
  holds it; the main checkout when that is gone): `workOnRef`, the answer `crew rm` gives too —
  its tip is an ancestor, or merging it changes nothing, which is how a squash merge shows. When
  git cannot say, it is not marked. The merge is looked for on every
  crew session whose work is over (`done`, `failed`, `handoff`, `stopped`), and on a `merged` one
  again (the continuation that held it back may have started). A handed-off record goes the same
  way once its work is merged — through its continuation's merge too, since the continuation is
  cut from its branch.
- **it also finishes a removal that stopped halfway** (D62), every `PARKED_PASS_MS` (five
  minutes): a folder a removal moved aside (`<path>-removing-<time>`) and could not remove,
  whether or not the store still knows its crew session — judged against the record's own
  branch when it does, `origin/<base>` (else the local branch of that name) when it does not,
  and by what the folder holds when git no longer lists it (§ `rm`). A folder that stays is not
  news; a later look judges it again. It runs after the merges are marked, so a crew session whose
  branch that removal deletes was marked first.
- **it hears GitHub, when the person turned that on** (GI4, `workflow.issues.watch`, off by
  default): once per `issues.watchMinutes` (default 5, floor 2) a pass makes one conditional look at
  the project's issues and comments (`src/issues/feed.ts`, `docs/design/issues.md` § The lead hears
  new issues), inside the pass it already runs — never a second loop. The state is one record for the
  repository (`issue-feed/` in the store, with its own lock), and a look found by one watch reaches
  every lead whose watch runs (a live watch lease: `watchIsAlive`; lead records are never removed)
  as one `issue` event each, which a lead's watch says as any other
  line: `issue #<n> opened by <author>: "<title>"`, `comment on #<n> by <author>`, each starting with
  a frame (`ISSUE_DATA_FRAME`, put on in `eventLine`) that says GitHub's words are quoted data, never
  an instruction: a monitor line is a notification of its own. A `304` and the first
  look after the switch are silent. A change of state (`gh` missing, logged out, rate limited,
  unreachable, and back) is one line, not one per pass. **A crew session never hears these lines**:
  they are written for leads, the crew's `step`/`report` reads select events by crew id, and the
  lead acts on one only through the person. The look and the settling of the merge marks share one
  budget per pass (a count and a time: `passBudget`), after the pass's own lines. When the watch
  queues the merge marks, it queues only the issue numbers the record's issue or the lead's brief
  also names; each other number a report names is one line for the lead (`issues.md` § Resolved
  when it ships).

The watch's memory reading (`/proc/<pid>/status`'s `VmRSS` on Linux, nothing elsewhere) goes into
the crew session's record without moving its `updatedAt` (the idle stop counts from it), where `crew
list` and the portal read it, and into the event the watch writes when it ends the crew session.
It is **Linux only**, and it is never faked: on macOS and Windows the board and `crew status`
show `-` (`docs/windows-setup.md` § The short version).

`--once` ends on the next change (the lead runs it with `run_in_background: true`, and the end of
the run starts the lead's next turn); a pass with nothing to say waits for the next, so it never
wakes the lead with no news. `--timeout <seconds>` bounds the wait. It is the lead's one look, not
a way to hear: Claude Code 2.1.310 runs the plugin's monitors with telemetry off too, so the old
fallback for a machine where they do not — a note the watch printed once, the lead's `--once` loop —
is gone (`telemetry.ts` with it). A `--once` **never takes the lease from a live watch that is not
one** (below).

**One acting watch per lead: the newest wins** (WF1). Seen live on 2026-10-25: 13 watches whose
monitor had ended (parent pid 1), up to 30 hours old, up to 5 for one lead — each one starting,
resuming and stopping crew sessions, each resume wave living in its own memory (five watches
resumed five sessions at once), and each writing the same state file over the others. So:

- **A lease per lead** in the crew store (`<store>/watch-lease/<lead session id>.json`) names
  the watch that acts: its process, as the store's lock records a holder (`currentHolder`,
  `holderIsGone`, `src/setup/lock.ts`: pid, start time, host, pid namespace), and a token of its
  own. A watch takes it when it starts, whoever holds it — a monitor the lead restarts is its
  intent — and before it reads the state, so it goes on from where the last one wrote. Two leads
  never share one. **A `--once` is no restart**: its lease carries `once: true`, and it takes the
  lease from nobody who is alive and not a `--once` itself (`takeWatchLeaseUnlessLive`, under the
  store's lock). It says `crew watch: a watch already runs for this lead (pid <pid>) and its lines
  reach the lead; this --once ends without taking the lease` and ends with 0, before it reads
  anything: that watch's lines reach the lead already, and a `--once` that took the lease would end
  it at its next look — the lead would lose its monitor to its own look. A `--once` still replaces
  another `--once`, and takes a lease whose holder is gone.
- **Before each pass**, again right before it starts queued crew sessions and before it resumes
  one (each launches a Claude session), and before it writes its state, a watch checks it still
  holds the lease (under the store's lock). A watch that lost it says one line — `crew watch: a
  newer watch of this lead runs (pid <pid>); this one ends` — and ends with 0, before it acts. That
  line carries no restart step: the newer watch's lines reach the lead, and a lead that restarted
  on it would end that one too. A lease whose holder is gone (its pid dead or reused) is free, and
  the watch takes it back, with the time of now as its `at` (never its start time, which an
  age-only host would read as gone at once). **A watch that is no `--once` takes the lease back
  from a `--once`** instead of ending: on an age-only host, after a sleep or a store busy for
  minutes, a `--once` may take a lease whose holder only looked gone, and it ends at its first
  news, so nobody would watch. So only the lease holder writes
  `<store>/watch/<lead session id>.json`.
- **A watch ends when nobody started or reads it**: when its parent pid changes (Claude Code ends
  a monitor by ending its shell, and the watch is re-parented), and when a line to stdout found
  nobody reading (EPIPE). Bun's `console.log` drops such a write without a word, and
  `process.stdout.write` reports it to its callback and as an `error` event — one nobody listens
  to ends the process at once, with a stack trace. So the CLI's crew printer writes through
  `process.stdout.write`, listens for that event, and keeps the failure (`stdoutPrinter`,
  `context.ts`; proved on Bun 1.4.3 with a real closed pipe). One exit path: the checks throw
  `WatchEnd`, and `runCrewWatch` catches it once, says why, and ends with 0. **On Windows the
  parent check never fires** — a process there is not re-parented, so its parent pid never
  changes — and the lease and the closed output are what end a watch.
- **A lease is renewed.** Where a process's start time cannot be read (Windows, a `ps` that does not
  say), a lease is judged by its age (`holderIsGone`, ten minutes), so a live watch would read as gone.
  `keepWatchLease` writes the lease's `at` again when it is older than `WATCH_LEASE_REFRESH_MS` (two
  minutes): `watchIsAlive`, the lead's notes and the `--once` rule above read a live watch as alive
  everywhere.
- **A store too busy to answer** (its lock held past its wait) is no reason to end a watch: a
  monitor that ended is not started again. The watch acts on nothing that time — no pass, no
  start, no resume, no state write — and asks again at its next look.
- **A watch never dies silently.** Claude Code arms a plugin's monitor once for each Claude
  process (a set of the monitors it armed, never cleared when a monitor's command exits;
  read from the 2.1.310 binary), so a watch that ended is not started again by running the lead
  skill again, and a monitor shows the lead its **stdout** lines only. So: a pass that throws
  — a store write that waited its three seconds (`LockBusyError`), a disk, a broken file — is
  **logged and the watch goes on** with the next pass, as the folders-left-half-done look already
  did. A failed pass keeps what it had done (`PassFailed` carries its state: the lines it said and
  the byte of the log it read to), so a failure late in a pass never says the lines of its early
  part twice. Each failure is a line on stderr; the **first of a run** is also a line on stdout —
  `crew watch: a pass failed (<why>); the watch goes on and tries again in 20 s` — and a pass
  that works ends the run, so a later failure is said again. Only `WATCH_FAILED_PASSES_MAX` (60
  passes, about twenty minutes) in a row end the watch, with exit 1 and one line on stdout:
  `crew watch ended: <n> passes in a row failed, the last with: <why> — start the watch again with
  Claude Code's Monitor tool (timeout_ms: 1800000; re-arm at once on expiry), command: "$HOME/.local/bin/cc-smart-dev-kit" crew
  watch`. Every other end that can still write says why on stdout too: a lease lost to a newer
  watch (its own line, above), a start that cannot name its lead or find crew sessions on, a
  lease it cannot take, and **a newer plugin installed under a running watch** — each as
  `crew watch ended: <why> — <the same restart>`. Each pass of a watch that still holds its lease
  compares the watch's own version with the one Claude Code records as installed
  (`installedVersion` in `CrewContext`). A watch that lost its lease ends with its own line, and
  `--once` never compares: it is one look, and a session started before an update runs the old
  version folder's command on its PATH. When the
  installed one is newer, the watch ends with both versions in its line, so the lead's next
  watch runs the new code. An installed version that cannot be read, or is equal or older, goes
  on. Seen on 2026-11-02: a lead session that never restarts keeps its watch, and six lead
  watches on one machine had run for two and a half days on 1.7.1 while 1.8.1 was installed. They
  missed every later fix and held their leads' leases. A watch started before 1.9.0 has no
  such check, so after the update each lead starts its watch again once by hand. The ends that
  cannot write (the output closed, the parent gone) stay on stderr. The command in the line is
  the plugin's own `crew-events` monitor command (`WATCH_MONITOR_COMMAND`; a test keeps the two
  equal). The presence mark every pass writes for every lead (`setLeadPresence`) reads the
  record first and takes the lock only when the answer changed, so the pass that costs most
  does not wait for a lock it does not need.
- **One resume of a record at a time**: before `claude` runs, every resume claims the record in
  the store, in the state its caller judged it in (`claimResume`, a `resumeClaim` on the
  record). A second resume — the person's `crew resume --paused` beside the watch, or a watch
  that took the lease from one resuming now — is refused with one line, so two copies never
  start. A resume that started nothing gives the claim back; the write that changes the record's
  state ends it; and one older than `RESUME_CLAIM_MS` (two minutes: a resume's two Claude calls
  are bounded by 30 s each) is over.

#### Waiting out a limit

A resume held by the launch gate stays on the record as `resumeWaits` (D72): the wait
time and an optional question index. `crew resume` prints the reason and exits 0; it has
queued the resume, not failed it. `crew answer` to a dead session saves the answer and its
index there, still undelivered. The watch delivers it as the resume prompt when admission
allows. An unreadable agent view leaves the wait alone; a session already live clears it
without starting a copy. The drain reads agent view once a pass, not once a waiting resume.
A record that reaches `merged`, `removed` or `discarded` drops its wait (`NO_RESUME_STATES`,
the states `crew resume` refuses), and the drain never resumes one. Asked again, a wait keeps
its first time, its place in line, and its answer unless a new one comes (`resumeWaitOf`). A
`crew stop` someone runs ends the wait too, so the watch never brings back a session it was
told to stop. A waiting resume, and a paused-limit recovery, that meets a hold skips that pass
and says why once for each kind of hold (`PlaceHold`: the phases, a cap, the memory, the load,
the usage window), not again while only its numbers move (the load, a count, the seconds
left): each line wakes the lead's model. The spacing between launches lifts within a minute
and is never said. A resume that went through forgets the wait, so a later one is said again.
The launch gate and drain order live in § The lead and the launch.

**A session gone from agent view frees its place** (D73). Each lead's watch checks running
records across the machine. Two readable passes at least a minute apart with no matching row
mark a record `stopped`, keeping its prior state in `sweptFrom`. The stop is the watch's own
(`stoppedByWatch`), not the lead's (D62). Unreadable view changes nothing. The sweep skips a
live resume claim, records without a session id (including a start not yet named), and
non-running records; its write (`sweepCrew`) checks the state and the claim again under the
store's lock. The missing mark is kept per session, so a resume's new session starts its own
minute, and marks of records or sessions gone are dropped. A matching row clears the missing
mark; a live row that returns for a swept, still-stopped record restores its prior state.
`sweptFrom` is kept only while the record is `stopped`, and the lead's `crew stop` of a swept
record drops it: the stop is the lead's then, and a row that returns does not undo it.

A model limit ends a turn the retry watchdog did not outlast — the plan's usage limit, an
overloaded model, a server error. The kit waits it out, with no time limit (D42: the owner chose
"keep waiting"; no `limitWaitHours`, no `…_MAX_WAIT_MS`), in three parts (`src/crew/wait.ts`):

- **Each crew session's own settings turn the watchdog on** (the keys CC1 writes for a machine,
  `src/setup/retry-watchdog.ts`), so most limits are waited out inside the turn.
- **The pause** (`crew-role`, StopFailure): a stop with `rate_limit`, `overloaded` or
  `server_error` marks the record `paused` and takes `waitingFor` from the router's limit state,
  in this order: `slot` — the slot the crew session's model reaches has a current breaker record,
  with the time it opened; `claude-limit` — a current plan limit, the session's own model first,
  else the freshest of a model whose family has a slot, with its reset time, **but only when that
  Claude model answers the session first** (`claudeLimitHolds`: a session on Claude itself, or a
  slot whose chain in use, read from the gateway's config, starts with that model); `unknown` —
  nothing the state file explains. On a slot whose chain starts with a backend, the Claude model
  is only a fallback, and its limit holds nothing: the session waits for its slot (a `slot` wait
  from now, resumed after the hold-off below, as a slot wait is once its breaker closed), and
  neither the lead nor `crew list` names a reset date. Seen live on 2026-10-25: the worker slot
  ran `omniroute:codex/gpt-6-luna → claude-sonnet-5-5`, one empty answer from Codex fell through
  to Sonnet's weekly 429, and two crew sessions waited for Sonnet's reset days away while their
  own model answered again within seconds. One `state` event carries the line the watch shows
  (`C kit B6b portal-live: paused — worker slot limited since 21:05; goes on by itself when it
  answers`), and `lastPause` records when the wait began and the hold-off it carries: 0 on a
  first pause, then 5, 10 and 20 minutes while pauses come within 15 minutes of each other.
  A crew session that ended its phase, was stopped, or still waits in the queue pauses nothing.
  **The error is kept and shown.** The hook writes it on the record for every class
  (`lastApiError`: Claude Code's class, the text it showed — `error_details` when it sends them, else
  `last_assistant_message` — masked, one line, 400 characters, and the time), and the pause line
  ends with it, `· server_error: API Error: 500 …`, so the lead can tell a provider that failed from
  a plan that ran out. A change of state to `working` drops it, and so does a turn that ended
  normally (the Stop hook): an error the record still held would otherwise turn a later crash
  into a backend's refusal.
- **A backend's refusal is no crash** (`BACKEND_REFUSAL_ERRORS`). Agent view gives a turn that
  ended on an API error a state by its class (read from the 2.1.310 binary): `blocked` with the
  words it needs for `authentication_failed`, `oauth_org_not_allowed`, `account_on_hold`,
  `cloud_credential_error`, `verification_required`, `billing_error`, `rate_limit`, `overloaded`,
  `server_error` and `invalid_request`, and **`failed` with "API error" for every other class** —
  `unknown`, which is what a router's 424 (a backend's refusal, `src/gateway/refusal.ts`) is
  called, and `model_not_found`. The watch used to record that `failed` as the end of the crew
  session, and stopped its session. It now reads `lastApiError`: for `unknown` or
  `model_not_found`, on a `failed` row whose words are "API error", the record **does not fail**.
  The lead is told once, with the router's reason, in two lines: a **question** — `<name>:
  question · its backend refused its turn (unknown: <reason>) · answer it: crew answer …` — and the
  state change `<name>: stopped — its backend refused the turn; your answer to its question
  resumes it`. The state is `stopped` with `stoppedByWatch`: the end a `blocked` crew session that
  waits on its lead reaches after the idle stop, reached at once because the session has no process
  — and the only state `crew answer` resumes (a `blocked` record is sent a message, and nothing
  hears it). It holds no place, a plain `crew resume` brings it back too, and the watch's daily
  reminder for a stopped, unmerged session applies. **Nothing retries it by itself** — unlike a pause, there is no
  breaker or limit to wait out, and the same request would be refused again. A session that
  already has a question open on its lead is not given another (it would close the real one): the
  stop's line carries the reason. The question is asked once for each refusal; the watch's mark of
  it goes once the record left `stopped`. Any other class,
  or no recorded error, or a `failed` row that says something else, stays a real failure.
- **The resume** (the lead's watch): never while the slot's breaker is open (its first target in
  use is not one the record says rests) or the model's limit is current. A slot wait is over when
  the breaker record closed (the router recorded an answer — only an answer closes it) or the
  chain's first target changed; a Claude limit's when the reset time passed, plus
  `LIMIT_RESET_JITTER_MS` (90 s), and the router dropped the record — a `claude-limit` wait an
  older kit recorded on a slot whose chain starts elsewhere is judged as that slot's wait; an
  `unknown` wait's after
  its hold-off, with no breaker or limit that would explain it now. One crew session goes first
  (the canary); the next no sooner than 30 s after it, and only once the router answered a
  request since — its health page's count grew, and the state file's closed breaker or dropped
  limit is that answer when the page is not there. The transport is `crew answer`'s, one home for
  every resume (`resumeSession`): a message for a session whose process lives (the watch prints the
  `SendMessage` line, after the line that says to load that deferred tool, because only a session
  holds it), `claude --bg --resume <id> -- "/<plugin>:crew <text>"`
  **in its worktree, with the record's own `--settings` and `--strict-mcp-config --mcp-config`
  files** for one whose session has no process; the text names what changed and the phase. The
  record is `working` with its wait cleared, in the same act, with the session the resume brought
  back (§ The session a resume brings back) — only while it is still `paused`, so a state the
  woken session wrote at once (a report) is never overwritten. **A resume the store could not
  record is held**: the record stays `paused` and names the session it had, so a second try after
  the claim (`RESUME_CLAIM_MS`) would wake or copy it again. The watch leaves it, as it leaves a
  resume that started a session it could not name, says so in the line, and the lead's `crew
  resume` brings it back. `crew resume --paused` is the
  person's way at once — after `/login` on another account — for every paused crew session of a
  lead: the same `resumeOne`, so a session whose process lives is woken with a message and one
  that has none is resumed, never copied.
- **The safety-checks pause** (owner, 2026-10-27). When auto mode's safety checks get no verdict
  (Claude at its limit and nothing standing in for the judge), Claude Code denies every tool call
  that needs a check, `crew report` included (`docs/claude-code-contract.md` § The gateway). Such a
  turn ends with no report, and the report block (§ The crew session's and the lead's hooks) could only start
  a turn that fails again. So at **Stop**, a crew session on the gateway whose own scope has a
  current failing-checks record (the router's `checksDown`, keyed `cc-smart-dev-kit-judge` or
  `<profile>/cc-smart-dev-kit-judge`; the scope is the profile its `ANTHROPIC_BASE_URL` names,
  read like the StopFailure pause's) and whose turn ended with no report is **not blocked**: it is
  marked `paused` with `waitingFor: { kind: "safety-checks", scope: <that key>, since }` and the
  same `lastPause` hold-off, and one `state` event in the checks' own words
  (`checksDownText`, `src/gateway/checks-down.ts`): `<name>: paused — auto mode's safety checks
  are failing since 09:40: Claude is at its plan limit (five_hour) until 13:00, and no worker
  target has passed the judge test; goes on by itself when they answer again`. It holds on the
  stop that answers a block too (`stop_hook_active`: a pause is no second block). A report
  counts as this turn's only while the record is out of `starting`, `working` and `quiet`: a
  session that reported `blocked`, was answered and works again has that old report as its newest
  event, and it pauses like any other. A turn that reported, a `blocked` session (its question
  stays open, and a resume would tell it to go on), a session off the gateway, another scope's
  record, a stale one, a state file that cannot be read, and a phase that ended keep the answer
  the Stop gave before; a pause the store cannot write is one stderr line beside that answer. The watch resumes it when the record for
  its scope is gone (a check got a verdict) or no longer current (15 minutes after the last
  failure, `currentChecksDown`), with the spacing and the "the router answered since" rule above,
  and the text `The wait is over: auto mode's safety checks answer again. Go on with phase <p>, then
  hand it back as usual.` A check that still fails pauses it again, with the doubled hold-off.

**The hand-off** — `crew start <phase> --continue <old crew session>` — starts the next crew session of a
phase that ran out of room: the same phase and slug, cut from the **old crew session's head** (not
the lead's branch), with the old brief and what the old crew session left behind as its brief — its
report: the branch and the counts, the docs, the files outside the brief, what only the lead may
do, what is open, and its own words (`summary`) — and the next number in its name (`C <tag>
<plan> <phase> <slug> 2`, and ` 3` after that). Its branch and its worktree folder carry the same number
as a suffix (`crew/<phase>-<slug>-2`), so the next crew session never takes the branch or the folder of
the one before it; its id keeps the one scheme (`<phase>-<slug>-<6 hex>`). It is a new launch, so
it goes through the same launch policy a fresh start does (`chooseLaunch`): the old crew session's model
and effort are asked for again, and the Agent guard judges them now. **The old crew session's Claude session
is stopped; its record stays `handoff`** — the store's word for "handed off to a next crew session, and
ended" — and so does its branch, so the lead can read what it did and `crew rm` can clean it up;
its worktree and its agent-view row go at the watch's next pass (D69, § The board and the end of a
crew session). Only a crew session that handed off can be continued, **once**: a second `--continue`
of the same crew session is refused while its next crew session is not failed or removed, and a report that
cannot be read is a refusal (a hand-off without it would lose what the next crew session must know).
**The chain is recorded, never worked out**: the next crew session's record holds the old crew session's id
(`continues`), because a number at the end of a branch or a slug proves nothing — a phase whose
slug is `step-2` has a branch that ends in `-2` too.

**What a hand-off names, and counts (NM1).** The next crew session's record holds the old head's
**commit** as `baseCommit`, next to `baseRef` (the old branch's name, which the board and the portal
show). A queued continuation is cut when it starts, and `crew rm` of the old record deletes that
branch (a branch reset would move it too), so it starts from `baseCommit` first and from `baseRef` only
when the record has none — a record an older kit wrote. `--continue <name>` finds the old record by the
one finder every crew command uses (`findCrew`): a name shared with removed records means the live
one — a handed-off record is live — and two live records of one name ask for an id. The number counts
the phase's records that **started** (a record removed before it began never ran, and takes no
number), plus one.

**The crew session's own line** — `cc-smart-dev-kit crew self-watch [--once]`
(`src/crew/self-watch.ts`) — runs in the crew session's own monitor, and **keeps running**: it looks
at the context and the clock every minute and prints a line only when the crew session should act, so
a crew session that is fine sees nothing. Every 3 s it also looks for the lead's answer and writes
its heartbeat (`crew answer`, above in this section, reaches a running crew session through this
loop). It reads the crew session's own transcript tail: the last reply's `usage` (its input, its cache
written and its cache read) against the window of the model that wrote that reply
(`context-window.ts`, the window's one home). **The window comes from three places, in order.**
**Claude Code's own number**, when the status line recorded one for that model
(`context_window.context_window_size` in its input, kept per model in
`<stateDir>/context-window.json`, one entry per id exactly as reported, `[1m]` included, because
one id can have two windows); a crew session is a `--bg` run with no footer, so the number is
whichever session on the machine ran a status line for that model. Otherwise **the kit's table**,
keyed by family and the version its 1M window starts at: Fable 5 and later, Opus 4.6 and later,
Sonnet 4.6 and later and Haiku 5.5 have 1 000 000; Haiku 4.5 and the older models have 200 000;
a family name alone (`opus`) names that family's current model, so it is 1 000 000 too;
`[1m]` on any id is 1 000 000; and an id the table cannot place is guessed at 200 000, so a crew
session hands off early, never late. For **a backend's bare model name** (the router answered from
it), the window is that backend's own `/v1/models` `context_length` for the target the gateway
config's slot chain names — a catalog id names it by its last segment too, because the answer
leaves the provider out (`ollama-cloud/deepseek-v4.1-flash` is answered as
`deepseek-v4.1-flash`). The list is read once, and only the models a chain names are kept in
`<stateDir>/backend-windows.json` — never one network call per poll. A model whose window none of
the three gives has no window and so no percent line; the token cap still applies. **The hand-off
line** is the smallest of three numbers (`handoffTokensOf`): `workflow.crew.handoffTokens`
(400 000), `workflow.crew.handoffPercent` (70 %) of the window when it is known, and
`HANDOFF_MARGIN_TOKENS` (13 000) below the point Claude Code compacts the session at, when the
kit can tell where that is (it does for every Claude model; for a model it cannot size and with no
variable set, the cap and the share stand alone, and a guard that leaves no room — a window under
about 46k — is dropped). So a 1M
window hands off at 400k, a 200k window at 140k, and a window held lower by the environment
earlier still. At that line the crew session is told to **hand off**: commit the work in
progress and run `crew report --status handoff`. **The compaction point** (`compactPointOf`) is
what Claude Code does with `--autocompact auto`: the window is the model's, held down by
`CLAUDE_CODE_AUTO_COMPACT_WINDOW` when that is set, and Claude Code compacts 33 000 below it
(`COMPACT_OUTPUT_RESERVE_TOKENS`, 20 000 for the reply, and `COMPACT_SUMMARY_BUFFER_TOKENS`, 13 000),
or at the `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE` share of the window less the 20 000 when that is lower.
The window is the one of the model the session **started on** (`record.model.resolved`), never a
backend's that answered: Claude Code compacts by its own model's window, and the answering model's
window measures the share only. The person's `autoCompactWindow` keys do not count: `auto` skips
them. One read-only reader holds the two variables (`src/machine/claude-settings.ts`), in Claude
Code's own order — the main checkout's `.claude/settings.local.json`, the session folder's
`settings.local.json`, its `.claude/settings.json`, the user's `settings.json`, then the
environment: the first that sets a variable decides it. It is re-read at every poll. At `workflow.crew.softHours` (2) it gets a
**note** (the phase is long); at `workflow.crew.maxHours` (4) it is told to hand off again —
the hours count from when its session **started** (`startedAt` in the record), not from when it
was recorded, because a crew session that waited in the queue has not run for the hours it waited. The
same line is not said again before 15 minutes have passed, so a crew session that ignored it sees it
again and a crew session that acted does not; the loop ends when the crew session's phase is over. A monitor
is a process of the host, whose environment may not carry the settings' `env`, so this one command
finds its crew session by its worktree when `CC_SMART_DEV_KIT_CREW` is not set; `--once` checks once
and exits (for a hook).

**The monitors** (`plugin/monitors/monitors.json`) arm the two of them: `crew-events` on the
lead's skill (`on-skill-invoke:cc-smart-dev-kit:lead`) runs the watch, and `crew-self` on the
crew session's (`on-skill-invoke:cc-smart-dev-kit:crew`) runs the self-watch. The file is an array of
monitors with exactly the four fields Claude Code's loader reads (`name`, `command`,
`description`, `when`); `when` for a plugin's own skill is the namespaced
`on-skill-invoke:<plugin>:<skill>` (the loader compares it with the name the skill is invoked by,
`<plugin>:<skill>`). **What arms one** (read from the 2.1.310 binary, the live proof owed): the
skill is dispatched — by the `Skill` tool, or by a slash command — under that exact full name; a
bare `crew` loads the skill and arms nothing. It arms once for each process, and a `--resume` does
not emit it. So every prompt the kit gives a crew session's process starts with the slash command
(`/cc-smart-dev-kit:crew`: the launch and every resume, described above), and the crew skill and the
brief's frame tell a model that started without it to call the `Skill` tool with the full name.
Each stdout line reaches the model as a task notification — **at most ten at
once and then one every two seconds**; the host drops the rest with a notice — which is why the
watch says only what is news. **They are session-scoped**: the host arms them as persistent tasks
of the session, and they end with it, so the long-lived-parts rule of `bundles-and-releases.md` (a
part that outlives a session must run from a copy in `~/.local/share/`) does not apply to them.
**They run with telemetry off too** (Claude Code 2.1.310's changelog; the kit's earlier
`telemetry.ts`, which read `DISABLE_TELEMETRY` and told the lead to run `crew watch --once` in a
loop instead, is gone). **A monitor is armed once for each Claude process**: Claude Code keeps a
set of the monitors it armed (`plugin:name`) and skips one already in it, and the set is never
cleared when the monitor's command exits (read from the 2.1.310 binary). So **a monitor whose
command ended never comes back in that process**, and running the skill again does not start it;
only a new Claude process (a restart) does. The lead's way back is Claude Code's own `Monitor`
tool, with the same command line as the `crew-events` monitor. Both ways the lead learns of it
are written into the kit: the watch's end line ("A watch never dies silently", above), and the `lead-notes` hook's line
(§ The crew session's and the lead's hooks). On native Windows each command is a
`$HOME` shell line naming the launcher, so it needs Git Bash; that Claude Code starts a monitor
through Git Bash there is the one live check owed (`docs/windows-setup.md` § The owner's
checklist, step 5). **`claude plugin validate` does not read
this file** (it checks a monitors path or an inline list in the manifest, not the default
location), so `monitors.test.ts` is what keeps it to the loader's shape; one wrong key would stop
the whole plugin from loading.

### The crew talks

**Hub and spoke** (D47, `.claude/research/archive/2026-10-22-crew-design.md` § 3). Status flows
through the lead: a crew session tells it what it did and what it needs with `crew report`, and
the lead answers with `crew answer`; both are recorded in the store, so the watch's line wakes
the lead and a restart loses nothing. Two crew sessions talk **directly only when one's contract
touches the other's**, and then in one of two kinds and no other.

**`crew tell <name…> --kind contract|question "<text>"`** (`src/crew/tell.ts`) is the one way.
Each `<name>` must be **a live crew session of the same lead in the store** — the name or id the
board shows, its record in a `RUNNING_STATES` state with a session id. A name the store does not
know, the lead itself, a crew session of another lead, one that is not running, and the sender's
own name are each refused with one line, and **nothing is recorded or printed: all or none**. A
third kind is a usage mistake (exit 2). So the store, never a name, decides who a crew session may
tell, as it decides everything else about a crew session.

- **The words are one home** (`src/crew/tell-format.ts`): `crew tell` writes them and the
  message guard checks them, so the two can never disagree about what a tagged message is.
- **The first line is the tag and the point**, because it is the preview the receiver sees (and
  the summary a `SendMessage` line carries): `[<phase>] CONTRACT: <what changed: file:symbol,
  commit>` — a contract note ends with `No reply needed.` — or `[<phase>] QUESTION: <the ask>`.
  The phase is the sender's own. The facts live in the files and commits; the note points at them,
  and one note carries the related facts together.
- **The command records a `tell` event** — the kind, from, to, and the first line — so the lead's
  watch shows it as one line (`<name>: told <names> · <kind> · <first line>`), and then prints
  **one `SendMessage` line per receiver**, the JSON form `crew answer` prints, after the one line
  that says to load the deferred tool first (`sendMessageHint`): only a session holds the tool, so
  the crew session sends it.
- **Never status.** "How it goes" and "done" are the lead's, through `crew report`: the crew
  skill says so, and the guard below refuses the alternative.

**`crew lead tell <lead…> --kind contract|question "<text>"`** (`src/crew/lead-tell.ts`, D55) is
the same talk between **leads**. Several plans often run in one repository at once, each led by
its own session; a note one lead's plan changes that another's work may use crosses in the same
two kinds, tagged with the sender's lead name (`[LEAD <tag> <plan>] CONTRACT: …`, the same
`tell-format.ts`), and a crew session never sees it. Each `<lead>` must be **a lead the store
records for this repository** (`listLeads`) — its name, its session id or the first 8 characters
of it; a name this repository does not know (another repository's lead included), the sender
itself, and a session that never ran `crew lead` are each refused with one line, and **nothing is
recorded or printed: all or none**. A crew session never runs it at all: `readCaller` refuses it,
because a crew session talks to its own lead. The command records **one `lead-tell` event per
receiver**, with that lead's session id in `lead` — so its watch prints one line and its
`lead-notes` hook covers a missed one — and then prints one `SendMessage` line per receiver, after
the one line that says to load that deferred tool first (`sendMessageHint`). The
event's text is the note's first line without the tag: the watch line already names the sender.

**A merge into the base reaches the other leads** (D55, `after-merge.ts`). The note after a pull
request merged into `worktrees.base` names **the other leads of the repo and the person's own
sessions, never a crew session**: a crew session follows its own lead's branch, cut from that
lead's work, and merging the base into it would be wrong. Each other lead also gets one `merge`
event, so its watch says the line (who merged, what number and title, and to merge
`origin/<base>` at its next stop) without waiting for the message the merging session sends. The
lead that merged is never told to message itself, nor is its record from before a restart: a
restart runs `crew lead` in a new session, which writes a second record, so the hook drops a
record that agrees with the merging lead's own in repository, plan, name and folder (the name
alone would drop another lead of the same name in another folder). A name is listed once, though
another lead that restarted has two records (WN1).

**A file clash reaches the other lead** (D55, `src/crew/start.ts`): a new phase's `--files`
compared with a running or queued crew session of another lead — see § The lead and the launch,
step 3 — prints one line at the start and records one `clash` event, which that lead's watch says.
**Each pair is said once, for its whole life** (WN1): the event carries the pair's key
(`clashPairKey`: the two leads' session ids and phases, sorted, so it is the same from either
side), and a start that meets a pair already in the events log says nothing. The key names the
phase, not the crew session, so a phase started again under a new slug is the same pair (and a
second session of that phase with other files is silent too). The key holds the lead's session
id, so a lead that restarts in a new session starts its pairs over. A
`--files` pattern that matches more than a quarter of the tracked files (in a repository of at
least 20) gets one `warning:` line at the start, naming the glob; it never refuses, because a
glob that wide makes every other lead's session clash with it.

**The message guard** (`src/hooks/message-guard.ts`, PreToolUse on `SendMessage`) is the
enforcement. Its other-repo rule runs first (§ The hooks): a message to a session that works
outside this repo **asks the person** (owner, 2026-10-27: a cross-repo message goes with their
yes), and a crew session's such message is **denied** in the guard's crew part with
`CREW_QUESTION_STEP` — so it holds with no file, a broken or too new one, and whatever `ownHooks`
says. Then, when the sender is a crew session (its environment
names a crew id, `CREW_ENV`) whose record this repo's store holds, and the target is the name of
**another crew session of the same repo**, the message's first line must carry the tag
`[<its phase>] CONTRACT:` or `[<its phase>] QUESTION:`; an untagged one is **denied**, and the
refusal names `crew tell`, its two kinds, and `crew report --status done --file -` for a hand-back. A
message to the session's **own lead** is denied too, with the `crew report` route — the lead is
matched by name, as `crew tell` matches it (`src/crew/tell.ts`), because the lead hears its crew
through the recorded report and never a raw message. A message **from the lead**, and one to a
session the store does not record (a person's own session, a subagent, a session on another
machine), is not judged. That crew rule is the guard's **crew part** (`crewMessageAnswer`): the
frame runs it **before `ownHooks` and before the project's file**, so it holds in a project with
no `cc-smart-dev-kit.json` and in one whose `ownHooks` names `message-guard` (D24, D47; the same
for the crew parts of `git-guard` and `merge-guard`, § The hooks). A store the guard cannot read
says nothing about the two sessions, so the message goes through, as every check a guard cannot
make does.

**The lead's loop** (the procedure is the `lead` skill, which copies no table). At plan approval
the lead **starts the whole plan at once**, each later phase with `--waits-for` the phases it
builds on: the queue and the watch start each phase when what it waits for is merged and a place
is free, so the lead never keeps a list of what is ready. On each watch line it acts in that
turn — a hand-back is checked and merged (the watch starts the dependants), a technical question
is answered with `crew answer`, the person's question goes to `AskUserQuestion`, "needs you" is
`claude attach <name>` — and between lines it does the integration work that is its own and stays
free for the person. **It never polls, waits or sleeps**, and a turn that ends with a ready phase
not started is a fault (an eval case, `evals/cases/lead-starts-the-whole-plan`).

### The crew session's and the lead's hooks

Two hooks make the store and the sessions meet. Both are **machine-wide** (`MACHINE_WIDE_HOOKS`):
each is silent unless its own session is the one it is about, and neither reads
`.claude/cc-smart-dev-kit.json` for its answer.

- **`crew-role`** (`src/hooks/crew-role.ts`) is silent unless `CC_SMART_DEV_KIT_CREW` names a crew
  session in its environment (the settings file `crew start` launches the session with, L1a.1). At
  **SessionStart** (startup, resume, compact) it adds the **role card**: the name
  (`C <tag> <plan> <phase> <slug>`), the phase and plan, the files the phase owns, the brief's path, the
  report line, the `crew tell` line, and the git rule (commit on its branch, never push). A
  resumed or compacted crew session gets it again, because its first prompt is gone from its
  context. **The input's `cwd` is checked against the record's worktree** (H101): inside it, a
  `starting` record becomes `working`; outside it, an open record is `failed` with where it
  started (the lead's watch stops the session) and the card tells it to do nothing and end its
  turn.
  At **PreToolUse** on `AskUserQuestion` and `ExitPlanMode` it **denies** the call with the
  `crew report --question …` step (D36): a crew session never asks the person. The deny reads no
  store and no project file, so it is the same with no `cc-smart-dev-kit.json`, a broken or too new
  one, and outside git.
  At **PreToolUse** on `Edit`, `Write` and `NotebookEdit` it **denies a crew session's first
  edit until its phase task has a subtask** (D75). Use the kit's `task_create` per part of the
  brief, with its done-check, or the `cc-smart-dev-kit task add` fallback. The role card names
  the same step and includes the phase's subtasks. The gate uses `src/tasks/guard-view.ts`,
  joining the kit's list with Claude Code's for one release. A crew made before phase tasks
  existed is let through; a read that cannot answer fails open. The store and ownership rules
  live in [the task design](tasks.md), not in a second task reader here.
  At **UserPromptSubmit** it hears the person (D55): a prompt typed into the crew session is one
  `person` event (its first line, masked and clipped) and one line of context — their word wins
  over the brief, a change of scope or files is said in the report, and a word to stop still gets
  a report (`blocked` or `handoff`) before the turn ends. Claude Code runs this hook for every
  turn a session gets and its input carries no field that says where a turn came from
  (`docs/claude-code-contract.md`), so the prompt's own shape decides: a `SendMessage` delivery
  (`<cross-session-message …>`), a monitor's line (`<task-notification>`), a subagent's hand-back
  the session itself launched (`<agent-message from=…>`, seen live on 2.1.309) and a Stop hook's
  own continuation (`Stop hook feedback:`, the kit's block line included) are its lead's or its
  own subagent's, and so are the prompts a transport gives a crew session, **every one behind the
  crew command** (`afterCrewCommand`: the typed `/cc-smart-dev-kit:crew …`, or the
  `<command-name>`/`<command-args>` form Claude Code writes for it) — `crew start`'s launch line
  (its own name, lead and brief file, from `launchLine`; a hand-off's next crew session gets its
  own), `crew answer`'s resume of a stopped session (a question still open, or the answer the
  store recorded), its resume with a **correction** (the head `deliveryHead` writes, naming one of
  the question's answers — the current one before the store records the correction, a superseded
  one after; a correction of an answer the session never heard has no head, so while the record
  is stopped and an answer is unheard, the command and any text are that resume), `crew model`'s
  resume (`modelChangeText`, read back by `isModelChangeText` with the model and effort the
  record now holds — `crew model` writes them before it resumes), the watch's `resumeText` of a
  paused one, and the bare command of a resume with nothing to add (`crew resume`). Each is read
  back from the function that writes it (`src/crew/brief.ts`), never a copy of its words. The
  same words without the command are the person's. A prompt
  none of those explain is recorded as the person's: nothing else in the kit gives a crew session
  a prompt, and a stopped crew session the person reopens by hand (`claude attach`) has no other
  way to be heard. One the hook cannot read at all records nothing. It never blocks and
  never asks. **Whatever the turn is, the record's name goes back on the title when the title says
  something else** (`titleAnswer`, through `titleToSet`): a crew session its lead drives gets no
  person prompt at all, so the address is put right on those turns too, and `session-name` stays
  silent here (one title, one owner).
  At **Stop** it records the session's last line on its record (`lastLine`,
  masked and clipped) and **gives no context** — a Stop hook's `additionalContext` keeps the turn
  going and starves hand-backs (L1a.1). When the newest `step` or `report` event of the crew
  session is a `step`, the turn ended mid-phase with no report: it **blocks once**
  (`{"decision":"block","reason":…}`), and never again while `stop_hook_active` is true. The
  reason depends on the phase's kit subtasks, with Claude Code's list beside them for one
  release (the same `src/tasks/guard-view.ts` as the edit gate). While a task is still open — the first one `in_progress`, else the first
  `pending` — it names that task and says to go on with it, and to hand back only when every
  task is done. Some models end a turn after each step and only say the next one; a report line
  there made them hand back half a phase. With no open task, or a list it cannot read, the reason
  is the report line, as before. The events log is read from a **per-crew cursor** (`<store>/stop/<crew id>.json`: the
  byte after the last line it read, and the newest `step` or `report` it saw), through the store's
  one `readCrewEvents`, so a Stop costs the same on day 30 as on day 1: the log only grows.
  Claude Code shows each block as a `stop-hook-error` notification and caps consecutive
  blocks at 9; this hook blocks at most once per turn. Nothing runs while `background_tasks` holds
  work other than the session's own monitor: that turn is not over, and Claude Code wakes the
  session when the work lands. **The `crew-self` monitor is in that list for the whole session**
  (read from the 2.1.310 binary: a plugin monitor is a shell task, so its entry is `{id, type:
  "shell", status, description, command}` with no field that says "monitor"), so counting it
  switched this gate off for every session whose monitor worked. The hook knows the entry by its
  command — the launcher as one word (quoted or not, with or without its folder), then
  `crew self-watch`, and nothing else (`isSelfWatchTask`, `src/crew/brief.ts`) — and a task that
  only names those words still counts. Its sibling `isLeadWatchTask` knows the lead's
  `crew-events` monitor the same way, for `verify-gate`, which would otherwise be silent in every
  lead. At
  **StopFailure** it keeps the error on the record (`lastApiError`, every class), and on
  `rate_limit`, `overloaded` or `server_error` it also marks the crew session
  **paused**, with what it waits for taken from the router's state file (D42, § Waiting out a
  limit), and answers nothing: Claude Code ignores that hook's output, so the pause is the
  record and its event, and the lead's watch is what resumes it. A store that
  cannot be read is one line on stderr and no block.
- **`lead-notes`** (`src/hooks/lead-notes.ts`) is silent unless the input's `session_id` is a lead
  recorded in this repository. Each turn a lead starts — `UserPromptSubmit` (which also fires on a
  hand-back turn, L1a.1) and SessionStart — it reads the events log from a per-lead cursor
  (`<store>/notes/<lead id>.json`, seeded at the log's end the first time), keeps this lead's
  events, and adds **one line**: the newest news, rendered by the watch's own `eventLine`, plus
  `(and N more…)` when there is older news in the same turn. The cursor moves past every event
  read, whether or not a line came of it, so a restart never says the same thing twice. The review
  mark on a report line uses the built-in review agents: this hook reads no project file, and the
  watch's own line is the one that resolves a project's list. At a prompt it also sets the lead's
  name (`sessionTitle`, beside the note in the same answer), through `titleToSet`, the one rule and
  record `session-name` keeps (§ The lead and the launch › The lead's name). **At a prompt it also
  reminds a lead with no task of its own** (D75): one line before the news says to put its
  own work on the kit's list and keep it current. `leadSessions` carries those tasks across
  adoption; plan and phase tasks are not the lead's own work. The joined view includes
  Claude Code's list for one release. A start also names stale project tasks in one line. **At a SessionStart it adds one line first**
  (D61): the lead's crew sessions build the work, because the lead's context is re-read on every
  turn — at a start, a resume and a compaction, never at a prompt and never on an edit.
  **A lead whose watch is gone is told, at every turn it lasts**: when the lead's plan is not
  ended, it has a crew session that is not yet merged or removed, and no live watch holds its lease
  (`watchIsAlive`), one line says how to start it, after the reminder and before the news. A lease
  that was never taken means the lead skill never ran in this session — the line says to run it.
  A lease whose watch is gone means its monitor ended, which the skill cannot undo (§ The
  monitors) — the line gives the `Monitor` tool's command, the same as `crew-events`
  (`WATCH_RESTART`). A lease or a store it cannot read says nothing: a wrong line is worse than
  none. Those lines are reminders, never a block.
  **At Stop it holds a lead once that ended a turn on a promise.** Some models end a turn after
  each step and only say what they will do next, so a lead sat idle for hours with its work in
  progress. When the lead's own joined task view (`leadTaskView`) holds a task `in_progress`, and no line
  of the turn's `last_assistant_message` starts with `Waiting for:` (after list marks and bold),
  it blocks once: the reason names the task (and how many more are in progress) and says to go on
  with it, or to end the turn on `Waiting for: <what>` when it really waits — a crew session's
  hand-back, the person, CI. A `pending` task does not count: a lead plans more than it runs at
  once. It is silent while `stop_hook_active` is true, in a crew session, with no message to read,
  and when the list cannot be read, or background work other than its watch remains. The
  notifier waits for this gate (`leadStopWouldBlockAt`); a failure is one stderr line, no block.

### Additional lead notes and file input

`crew note <name> [--file <path|->] [--as-person] [<text>]` records a decision without
inventing a question. Only that crew session's lead can send it, or the person's portal child.
A queued phase reads `lead-notes.md` beside its brief; its launch prompt names that file.
A running phase hears the note through self-watch, claimed once under the store lock like an
answer. The command confirms delivery or prints the not-delivered fallback. A stopped phase
receives it in its resume prompt. A resume waiting for room carries every undelivered answer
and note, not just the newest. Run files keep notes with the existing `note` event kind.

For an answer or note, give exactly one of text and `--file`. The shared report reader reads a
path or `-` for stdin. Write long text with the Write tool and pass its path, so the shell's
worktree guard never sees the text as a command. The portal passes an optional question number
through the same CLI answer path; without it, several open questions refuse.
