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
terminal states while preserving the old outcome. No reminder discards or removes the work.

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
`refs/crew-discarded/<branch>` holds the archive, and `crew list --discarded` prints its recovery
command and age. Manual and background cleans prune completed archives after the one shared
30-day limit. A person's programs and containers still refuse; the watch never discards.

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
which wins field by field like every workflow setting (§ The workflow). Beside it in the same
group sit one lead's caps — how many of its crew sessions run at once and how many of those on
the opus tier (`perLead`, `perLeadOpus`) — the machine's guards (the safety ceiling `max`, an
optional machine-wide `maxOpus`, and the 5-hour `usagePercent` past which a new opus crew
session waits, D54), the free memory a new one needs, when a quiet one is reported, when a long one hands off, when a
blocked one is stopped (D35: a crew session never outlives its work) — and the `tag` of their names.
`workflow show` prints each with its source.

**The kinds** (D46, D50) say what a phase needs, and so the model and effort its crew session runs on:
`CREW_KINDS` in `src/models/launch-policy.ts`, the one home of the launch policy the Agent
guard judges subagents by (§ The Agent guard). Routine work — `build`, `docs`, `tests` — runs on
`sonnet`, the worker slot: at `max` when an affordable gateway slot answers it, at `high` when
Claude Sonnet does (`isAffordable`, the guard's own reading of "affordable"). So does code that
touches security, money, permissions, a schema or deploy plumbing: it builds like any other code.
Work that needs judgment — `architecture` — runs on `opus` at `xhigh`, whatever answers the
tier. `ui` is the exception (`UI_POLICY`, D50): it runs on `opus` at `high`, never on an
affordable model — `crewLaunch` names a tier, so `isAffordable` is false whatever answers it,
and `crew kinds` prints `never` in its affordable-slot column. A `ui` session's override that
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
  its name, its session's id and short id, its lead), what it does (the repository, the plan, the
  phase and slug, the kind, the model as named with the slot and the model that answer it
  (`answeringSlot`), the effort, the permission mode, the worktree, the branch, the ref it starts
  from, the base and its commit once it starts, the phases it waits for, the files of its brief)
  and where it is: its state, its last line, its report, its pull request, its memory, its
  questions, what it waits for while `paused` (`waitingFor`: a gateway slot whose breaker is
  open, Claude's own plan limit, or `unknown` when the router's state explains nothing; with the
  pause before it, `lastPause`: when it began and the hold-off a re-pause doubles —
  § Waiting out a limit), when its session started (`startedAt`, optional: the crew session's own time caps count
  from it, not from when it was recorded), the crew session it continues (`continues`, optional: the id
  of the old crew session, set by a hand-off and by nothing else), whether the lead had merged its
  work before its removal (`mergedBeforeRemoval`, optional: set by the store when the state becomes
  `removed`, from the state the record was in — the fact a phase that waits for it starts on),
  whether it was merged while it was `stopped` (`mergedWhileStopped`, optional: set by the store
  when the state goes from `stopped` to `merged` — the watch never removes such a record, D62),
  and when it was recorded and changed. The states are `queued`, `starting`,
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
  waiting.
- **The hand-back report** is what a crew session gives the lead when its phase ends: its status (`done`,
  `blocked`, `failed`, `handoff`), the phase, the branch and base commits, the pull request, the
  diff counted, the files it changed outside its brief, the targeted tests and the whole suite,
  the other checks, the one review (agent, model, effort, the commit it read, each finding and its
  fix), the docs it changed, what only the lead may do, what is still open — and, when blocked,
  the question it waits on (a blocked report without one is refused).
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

**`crew lead [--plan <slug>] [--tag <tag>]`** (`src/crew/lead.ts`) records the session
that runs it as a lead of this repository. **Which session** is found the way L1a.1 proved it:
the nearest ancestor process with a Claude Code session record, `<config folder>/sessions/<pid>.json`
(`callingSession`, `src/crew/session.ts`; parents from `/proc` on Linux, one process listing
elsewhere). Its name, `LEAD <tag> <plan>`, is written into the lead record as data, and the
`lead-notes` hook sets it at the lead's next prompt by itself (§ The lead's name below); the
command never renames the session, and prints one line saying so. The tag is
`--tag`, else `workflow.crew.tag`, else the main checkout's folder name; the plan is `--plan`,
else the plan this session already leads, else the branch.

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

**The lead's role** (D61): a lead plans, writes the briefs, starts the phases, answers the
questions, merges each branch with one full check after it, keeps the plan file true and talks to
the person. The building — code, tests, research across many files, long debugging — goes to a
crew session, and the reading a brief needs to a scout subagent. The rule is **words only**: the
lead skill's "Your crew builds" section, and one line in the lead's start note from this hook at
a start, a resume, a clear and a compaction — never at a prompt, never on an edit, and no block.
Why: the lead's context is re-read on the premium model every turn, so every file it reads or
writes costs on every later turn, while the crew session that does the same work ends.

**`crew start <phase> --slug <slug> --kind <kind> --brief <file|-> …`** (`src/crew/start.ts`)
**returns at once** (D25) with one line — `started …`, `queued …` or `failed …` — and never waits,
polls or retries. An opus-tier start with no 5-hour window reading adds one note line after it
(D54). In order:

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
   a model alone runs at the kind's effort, or `max` when an affordable model answers it) is
   judged by the Agent guard's own `judgeLaunch`: one it refuses is refused with its words, and
   one it would **ask** the person about (`opus` at `max`, an unreadable name) is refused too,
   because `crew start` never asks — the person starts such a session themselves. Fable is
   refused: no crew session carries the person's `Fable reason: build` line.
3. **Start now, or queued** (`places.ts`), decided under one machine-wide lock
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
   a dozen leads at once); **the machine's guards** — `workflow.crew.max` (24) is a safety
   ceiling no lead reaches alone, and `workflow.crew.maxOpus` an optional machine-wide opus
   ceiling, unset by default (a person who sets one keeps it); **the 5-hour usage window**
   (D54) — past `workflow.crew.usagePercent` (85) a new opus-tier crew session waits, unless
   the gateway's opus slot has a chain in use with its fallback on (`src/crew/usage-guard.ts`);
   the window is the one Claude Code's status line reads, recorded by
   `cc-smart-dev-kit statusline` in `<stateDir>/usage-window.json` (the reader's one home,
   `src/cli/usage-window.ts`), and with no reading — or one whose window has reset — the guard
   does not hold, and `crew start` and `crew list` say so once; **the memory** — the memory free
   now less what heavy
   jobs reserved and have not used yet (the job queue's own reading) is at least
   `workflow.crew.memoryGb` (no check where free memory cannot be read: macOS). The queued line
   names what holds it. The store alone
   decides, so a start never waits on agent view; the watch keeps the states true. A start that
   finds a free place takes it, also while older crew sessions wait: each lead's watch starts its own
   queued ones, oldest first, so no lead starves another. A queued crew session has no worktree
   yet and its `base` is null: it is cut from its
   `baseRef` when it starts, so a phase that waited for another starts from the merged result.
   **The same decision is what a lead's Agent guard asks** (D59): `placeForLeadStart` builds that
   input for the lead a session id names, with no phases waited for and the memory read only when
   nothing else holds, so the guard refuses a subagent that can change files exactly while a
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
   **The same file makes the session lean**: `enabledPlugins` turns off every plugin the machine
   enabled except this one, what `workflow.crew.keep` names, and every plugin those depend on,
   `disableClaudeAiConnectors: true`
   stops the claude.ai connectors, and `mcp.json` beside it is the `--mcp-config` file — the kit's
   own registrations for Tavily (every kind) and the browser (`ui`), with no key in it (`Bearer
   ${TAVILY_API_KEY}` is Claude Code's placeholder). A `claude plugin list --json` read decides
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
   a dependency install, is the crew session's own first step), the `.worktreeinclude` files copied
   (`src/worktrees/include.ts`, as Claude Code does for its own worktrees), then from the main
   checkout `claude --bg -w crew-<phase>-<slug> --name "C <tag> <plan> <phase> <slug>" --model <m> --effort
   <e> --permission-mode auto --autocompact auto --strict-mcp-config --mcp-config <mcp.json>
   --settings <settings.json> "<first line>"`. The
   first line names the crew session, its lead and the brief's path; it holds no `"` or `%`, which a
   `.cmd`'s `cmd.exe` line could not carry. `--autocompact auto`: Claude Code's own window for
   the model stands, and its compaction comes after the crew's own hand-off share of it
   (`workflow.crew.handoffPercent`; the window the gauge measures is `context-window.ts`).
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

### The board and the end of a crew session

`crew list`, `status`, `kinds` and `attach` read; `stop`, `resume` and `rm` act (`board.ts`,
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

- **`list`** shows the repository's crew sessions (`--all`: every repository), newest first, one block
  each. The state's age is the newest `state` or `created` event about the crew session, not
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
  again. It is refused for one that is `removed` or `merged`, has no session yet, or has no
  worktree or settings file any more (one line each). It does not check the caps: the person or
  the lead asked for exactly this session.
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
    entry). Anything else stays, with the reason.

  An unreadable scan retains every requested parked path with its error; a busy clean lock refuses
  the pass before any removal. `crew rm` finishes both kinds in the repository — its own record's first, and it refuses while
  its own stays — `worktrees --clean` and the background clean finish any, and the watch looks
  every five minutes (`PARKED_PASS_MS`): a folder that stays costs a scan of the whole repository.

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
for the task list** (D23): while any task on the session's own list is `pending` or `in_progress`
the report is refused, with each open task named (`#3 "Part 3" (pending)`), and the fix is to finish
it with `TaskUpdate status completed`, or to delete it (`status deleted`) and say why under `open` in the report — a deleted task's file is gone, so a reason written in the task would vanish with it (proved live, `docs/claude-code-contract.md` § The to-do list). A
`handoff`, `blocked` or `failed` report is never held: those exist because the phase could not be
finished. No list at all — a session that never got the tools, or one whose folder cannot be read —
lets the report through with one `note:` line on stdout, so the lead can tell the two apart.

**A question** — `crew report --question "<the question>" --option "<choice>" --option
"<choice>" [--recommend <n>]` — goes to the lead (D36). It is recorded at the end of the
crew session's `questions`, with a `question` event, and **the crew session's state does not move**: it goes
on with every part of the phase the question does not block. `--status blocked` says the crew session
has nothing left to do. A question needs two options at least, and a recommendation that is one
of them; `--option` and `--recommend` without a `--question`, and a `--file` with one, are
mistakes (exit 2).

**The answer** — `cc-smart-dev-kit crew answer <crew session> "<the answer>"` (`src/crew/answer.ts`)
— comes back from the lead (an answer that starts with `--` is given after a bare `--`). A
**running** crew session gets it as a message: the CLI cannot send one itself (Claude Code's
`SendMessage` is a tool only a session holds), so the command prints the one line the lead sends
it with — `SendMessage {"to":"<name>","message":"<text>"}`, the tool's arguments as JSON, so a
quote or a line break in the answer is escaped and never changed — and records the answer, so the
question is answered once. A **stopped** crew session (D35: the watch stops a blocked crew session that
idles past `workflow.crew.idleStopMinutes`) is resumed with the answer as its next prompt:
`claude --bg --resume <session id> "<text>"`, the form `claude --help` gives in 2.1.306 ("With
--resume <session-id>, continues that session in the background under the same ID"), run in the
crew session's own worktree. **A crew session the answer reaches or resumes is `working` again, in the same
hold that records the answer**: a record that kept saying `blocked` would let the watch stop a
crew session that is busy. A stopped crew session that ended its phase (a `done`, `failed` or `handoff`
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
- **agent view** (`claude agents --json --all`), read on every pass. It raises four alerts, each
  said once while it lasts and none of them an action: a crew session that **needs the person** (a
  permission prompt or an input), one whose transcript has not moved for
  `workflow.crew.quietMinutes` (**quiet**), one whose turn **ended with no report**, and one that
  **never confirmed its worktree** — its session is listed and alive, but its own start hook has
  not turned the `starting` record `working` within `WORKTREE_CONFIRM_MS` (3 minutes: the hook
  may have crashed, been silenced by `ownHooks`, or run outside git). It
  also keeps the store true, because the caps count the crew that hold a place
  (`RUNNING_STATES`): a session that **failed** is recorded `failed`, and one the person
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
  A stop that fails is said once, not on every pass;
- it **marks a crew session `merged`** when its branch is merged into the branch it was cut from,
  and then **removes it with `crew rm`'s own steps** (D62, `runCrewRm`, never a second copy). A
  continuation holds the removal back until its work and every later continuation's work are
  merged into the first record's base. The line says so once; a refusal — a program runs from its worktree, or work
  nobody committed — is said once and left for the lead. A **`stopped`** record is marked merged
  too, because what waits for its phase starts on the merge, but **never removed by the watch**:
  stopping it was the lead's call, and so is its removal (the store keeps the fact from the state
  the record was in, `mergedWhileStopped`, so a later pass cannot forget it). The branch must hold a commit of its own (its tip is not
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

The watch's memory reading (`/proc/<pid>/status`'s `VmRSS` on Linux, nothing elsewhere) goes into
the crew session's record without moving its `updatedAt` (the idle stop counts from it), where `crew
list` and the portal read it, and into the event the watch writes when it ends the crew session.
It is **Linux only**, and it is never faked: on macOS and Windows the board and `crew status`
show `-` (`docs/windows-setup.md` § The short version).

`--once` ends on the next change: the fallback where monitors do not run (the lead runs it with
`run_in_background: true`, re-armed per event, and the end of the run starts the lead's next
turn); a pass with nothing to say waits for the next, so it never wakes the lead with no news.
`--timeout <seconds>` bounds the wait.

#### Waiting out a limit

A model limit ends a turn the retry watchdog did not outlast — the plan's usage limit, an
overloaded model, a server error. The kit waits it out, with no time limit (D42: the owner chose
"keep waiting"; no `limitWaitHours`, no `…_MAX_WAIT_MS`), in three parts (`src/crew/wait.ts`):

- **Each crew session's own settings turn the watchdog on** (the keys CC1 writes for a machine,
  `src/setup/retry-watchdog.ts`), so most limits are waited out inside the turn.
- **The pause** (`crew-role`, StopFailure): a stop with `rate_limit`, `overloaded` or
  `server_error` marks the record `paused` and takes `waitingFor` from the router's limit state,
  in this order: `slot` — the slot the crew session's model reaches has a current breaker record,
  with the time it opened; `claude-limit` — a current plan limit, the session's own model first,
  else the freshest of a model whose family has a slot, with its reset time; `unknown` —
  nothing the state file explains. One `state` event carries the line the watch shows
  (`C kit B6b portal-live: paused — worker slot limited since 21:05; goes on by itself when it
  answers`), and `lastPause` records when the wait began and the hold-off it carries: 0 on a
  first pause, then 5, 10 and 20 minutes while pauses come within 15 minutes of each other.
  A crew session that ended its phase, was stopped, or still waits in the queue pauses nothing.
- **The resume** (the lead's watch): never while the slot's breaker is open (its first target in
  use is not one the record says rests) or the model's limit is current. A slot wait is over when
  the breaker record closed (the router recorded an answer — only an answer closes it) or the
  chain's first target changed; a Claude limit's when the reset time passed, plus
  `LIMIT_RESET_JITTER_MS` (90 s), and the router dropped the record; an `unknown` wait's after
  its hold-off, with no breaker or limit that would explain it now. One crew session goes first
  (the canary); the next no sooner than 30 s after it, and only once the router answered a
  request since — its health page's count grew, and the state file's closed breaker or dropped
  limit is that answer when the page is not there. The transport is `crew answer`'s, one home for
  every resume (`resumeSession`): a message for a session whose process lives (the watch prints the
  `SendMessage` line, because only a session holds that tool), `claude --bg --resume <id> "<text>"`
  **in its worktree, with the record's own `--settings` and `--strict-mcp-config --mcp-config`
  files** for one whose session has no process; the text names what changed and the phase. The
  record is `working` with its wait cleared, in the same act. `crew resume --paused` is the
  person's way at once — after `/login` on another account — for every paused crew session of a
  lead: the same `resumeOne`, so a session whose process lives is woken with a message and one
  that has none is resumed, never copied.

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
ended" — and so do its branch and its worktree, so the lead can read what it did and `crew rm`
can clean it up. Only a crew session that handed off can be continued, **once**: a second `--continue`
of the same crew session is refused while its next crew session is not failed or removed, and a report that
cannot be read is a refusal (a hand-off without it would lose what the next crew session must know).
**The chain is recorded, never worked out**: the next crew session's record holds the old crew session's id
(`continues`), because a number at the end of a branch or a slug proves nothing — a phase whose
slug is `step-2` has a branch that ends in `-2` too.

**The crew session's own line** — `cc-smart-dev-kit crew self-watch [--once]`
(`src/crew/self-watch.ts`) — runs in the crew session's own monitor, and **keeps running**: it looks
every minute and prints a line only when the crew session should act, so a crew session that is fine sees
nothing. It reads the crew session's own transcript tail: the last reply's `usage` (its input, its cache
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
the three gives has no window and so no context line. At
`workflow.crew.handoffPercent` (70 %) the crew session is told to **hand off**: commit the work in
progress and run `crew report --status handoff`. At `workflow.crew.softHours` (2) it gets a
**note** (the phase is long); at `workflow.crew.maxHours` (4) it is told to hand off again —
the hours count from when its session **started** (`startedAt` in the record), not from when it
was recorded, because a crew session that waited in the queue has not run for the hours it waited. The
same line is not said again before 15 minutes have passed, so a crew session that ignored it sees it
again and a crew session that acted does not; the loop ends when the crew session's phase is over. A monitor
is a process of the host, whose environment may not carry the settings' `env`, so this one command
finds its crew session by its worktree when `CC_SMART_DEV_KIT_CREW` is not set; `--once` checks once
and exits (for a hook, and for a host where monitors do not run).

**The monitors** (`plugin/monitors/monitors.json`) arm the two of them: `crew-events` on the
lead's skill (`on-skill-invoke:cc-smart-dev-kit:lead`) runs the watch, and `crew-self` on the
crew session's (`on-skill-invoke:cc-smart-dev-kit:crew`) runs the self-watch. The file is an array of
monitors with exactly the four fields Claude Code's loader reads (`name`, `command`,
`description`, `when`); `when` for a plugin's own skill is the namespaced
`on-skill-invoke:<plugin>:<skill>` (the loader compares it with the name the skill is invoked by,
`<plugin>:<skill>`). Each stdout line reaches the model as a task notification — **at most ten at
once and then one every two seconds**; the host drops the rest with a notice — which is why the
watch says only what is news. **They are session-scoped**: the host arms them as persistent tasks
of the session, and they end with it, so the long-lived-parts rule of `bundles-and-releases.md` (a
part that outlives a session must run from a copy in `~/.local/share/`) does not apply to them.
**They do not run where telemetry is off** (`DISABLE_TELEMETRY`, or
`CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC`), and there the lead uses `crew watch --once` in the
background instead — the fallback the lead skill names. On native Windows each command is a
`$HOME` shell line naming the launcher, so it needs Git Bash; that Claude Code starts a monitor
through Git Bash there is the one live check owed (`docs/windows-setup.md` § The owner's
checklist, step 5). The watch knows which case it is in (the
environment and the user's settings' `env`, `telemetry.ts`) and says so once, so the lead knows to
re-arm it; the watch's own help names the fallback too. **`claude plugin validate` does not read
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
  **one `SendMessage` line per receiver**, the JSON form `crew answer` prints: only a session holds
  the tool, so the crew session sends it.
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
`lead-notes` hook covers a missed one — and then prints one `SendMessage` line per receiver. The
event's text is the note's first line without the tag: the watch line already names the sender.

**A merge into the base reaches the other leads** (D55, `after-merge.ts`). The note after a pull
request merged into `worktrees.base` names **the other leads of the repo and the person's own
sessions, never a crew session**: a crew session follows its own lead's branch, cut from that
lead's work, and merging the base into it would be wrong. Each other lead also gets one `merge`
event, so its watch says the line (who merged, what number and title, and to merge
`origin/<base>` at its next stop) without waiting for the message the merging session sends. The
lead that merged is never told to message itself.

**A file clash reaches the other lead** (D55, `src/crew/start.ts`): a new phase's `--files`
compared with a running or queued crew session of another lead — see § The lead and the launch,
step 3 — prints one line at the start and records one `clash` event, which that lead's watch says.

**The message guard** (`src/hooks/message-guard.ts`, PreToolUse on `SendMessage`) is the
enforcement. Its other-repo rule is unchanged and runs first (§ The hooks): a message to a session
that works outside this repo is denied. Then, when the sender is a crew session (its environment
names a crew id, `CREW_ENV`) whose record this repo's store holds, and the target is the name of
**another crew session of the same repo**, the message's first line must carry the tag
`[<its phase>] CONTRACT:` or `[<its phase>] QUESTION:`; an untagged one is **denied**, and the
refusal names `crew tell`, its two kinds, and `crew report --status done` for a hand-back. A
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
  edit until its task list exists** (D23): while the session's task folder holds no task file, the
  call is refused with the step — look the task tools up (`ToolSearch
  select:TaskCreate,TaskUpdate,TaskList`), then one `TaskCreate` per part of the brief, each with
  its done-check — and the card names the same step at the start. The list is Claude Code's own
  (`src/crew/tasks.ts`: `<config dir>/tasks/<CLAUDE_CODE_TASK_LIST_ID or the input's session id>/`,
  proved live in `docs/claude-code-contract.md` § The to-do list), a subagent's edit is judged
  against the same folder, and the first answer that sees a task file is cached in the crew
  session's store folder (`files/<crew id>/task-gate.json`), so an edit costs one small file read
  and never lists the folder again for that list. Every answer that cannot be made lets the edit
  through: no session id names no folder, a folder or a record the hook cannot read is one line on
  stderr, and a gate it cannot write is only a slower next call. The step also says what to do when
  `ToolSearch` finds no task tools (the legacy `TodoWrite`, a deny rule): tell the lead, who tells
  the person — otherwise a refusal nobody can satisfy would hold every edit for good.
  At **UserPromptSubmit** it hears the person (D55): a prompt typed into the crew session is one
  `person` event (its first line, masked and clipped) and one line of context — their word wins
  over the brief, a change of scope or files is said in the report, and a word to stop still gets
  a report (`blocked` or `handoff`) before the turn ends. Claude Code runs this hook for every
  turn a session gets and its input carries no field that says where a turn came from
  (`docs/claude-code-contract.md`), so the prompt's own shape decides: a `SendMessage` delivery
  (`<cross-session-message …>`), a monitor's line (`<task-notification>`), a subagent's hand-back
  the session itself launched (`<agent-message from=…>`, seen live on 2.1.309) and a Stop hook's
  own continuation (`Stop hook feedback:`, the kit's block line included) are its lead's or its
  own subagent's, and so are the three prompts a transport gives a crew session **bare** —
  `crew start`'s launch line (its own name, lead and brief file, from `firstPrompt`; a hand-off's
  next crew session gets its own), `crew answer`'s resume of a stopped session (a question still
  open, or the answer the store recorded) and the watch's `resumeText` of a paused one. A bare
  prompt none of those explain is recorded as the person's: nothing else in the kit gives a crew
  session a prompt, and a stopped crew session the person reopens by hand (`claude attach`) has
  no other way to be heard. One the hook cannot read at all records nothing. It never blocks and
  never asks. **Whatever the turn is, the record's name goes back on the title when the title says
  something else** (`titleAnswer`, through `titleToSet`): a crew session its lead drives gets no
  person prompt at all, so the address is put right on those turns too, and `session-name` stays
  silent here (one title, one owner).
  At **Stop** it records the session's last line on its record (`lastLine`,
  masked and clipped) and **gives no context** — a Stop hook's `additionalContext` keeps the turn
  going and starves hand-backs (L1a.1). When the newest `step` or `report` event of the crew
  session is a `step`, the turn ended mid-phase with no report: it **blocks once** with the report
  line as its reason (`{"decision":"block","reason":…}`), and never again while `stop_hook_active`
  is true. The events log is read from a **per-crew cursor** (`<store>/stop/<crew id>.json`: the
  byte after the last line it read, and the newest `step` or `report` it saw), through the store's
  one `readCrewEvents`, so a Stop costs the same on day 30 as on day 1: the log only grows.
  Claude Code shows each block as a `stop-hook-error` notification and caps consecutive
  blocks at 9; this hook blocks at most once per turn. Nothing runs while `background_tasks` is not
  empty: that turn is not over, and Claude Code wakes the session when the work lands. At
  **StopFailure** on `rate_limit`, `overloaded` or `server_error` it marks the crew session
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
  reminds a lead with no to-do list** (D23): while the lead's own task folder (`taskListId`, the
  same reader the crew session's gate uses) holds no task file, one more line of context — put the
  person's asks and the lead's open work on the list, and keep it true as they move — said before
  the news, and gone the moment a task exists. **At a SessionStart it adds one line first**
  (D61): the lead's crew sessions build the work, because the lead's context is re-read on every
  turn — at a start, a resume, a clear and a compaction, never at a prompt and never on an edit.
  **Never a block**: a lead is reminded, never held.
