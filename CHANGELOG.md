# Changelog

What each release changed, newest first. A release's **What to run** steps are the ones to do
in your own terminal after the update; the user guide is [README.md](README.md).

## 1.1.3

**Every crew session keeps a to-do list, and a lead is reminded to keep one.** Measured before
this release: 17 of 24 live crew sessions used `TaskCreate`, and the rest skipped it, because
Claude Code leaves the task tools out until a session looks them up and the crew skill only
asked. The list is what a crew session resumes from after a compaction, and what you read when
you open it.

- **A crew session's first edit waits for its list.** Until the session's task folder holds one
  task, the `crew-role` hook refuses its `Edit`, `Write` and `NotebookEdit` with the step: look
  the task tools up, then one `TaskCreate` per part of the brief, each with its done-check. The
  role card names the same first step. Once a task exists the hook answers from its own cache
  and reads nothing more, so an edit costs one small file.
- **A `done` report waits for the list to be finished.** `crew report --status done` refuses
  while any task is still open, and names each one: finish it, or delete it and say why in the
  report. A `handoff`, `blocked` or `failed` report is never held, and a session with no list at
  all reports with one `note:` line saying nothing was checked.
- **A lead is reminded, never blocked.** While your session has no to-do list, each prompt
  carries one line: put the person's asks and your open work on it. It goes silent the moment a
  task exists.
- **The kit's builder and rules-maintainer agents get the task tools**, and one line each to
  keep a list for a multi-step brief. The read-only reviewer, auditor and ui-verifier stay as
  they are.
- **A lead sends the building to its crew.** The lead skill gains "Your crew builds": the code,
  the tests, research across many files and long debugging go to a crew session, and the lead
  keeps the plan, the briefs, the starts, the questions, the merges, the plan file and the
  person. The `lead-notes` hook adds the same rule in one line when a lead's context is built
  again — a start, a resume, a clear, a compaction — and never at a prompt or on an edit. Words
  only (D61): the lead's context is re-read on the premium model every turn, so every file it
  reads or writes costs on every later turn.
- **A lead never routes a phase around the crew queue.** The queue exists for the machine and for
  each lead's share of it, and a builder subagent runs outside every one of those counts — with
  none of a crew phase's worktree, review, report gate or to-do list. So in a session registered
  as a lead, the agent guard refuses a launch that can change files while a `crew start` from it
  would queue right now, and names the cap that holds and the `crew start` step. Read-only work
  is never held: the kit's own reviewer, auditor and ui-verifier, the built-in Explore, Plan,
  claude-code-guide and statusline-setup, and the kit's read-only Workflows — a project's own
  read-only agent is exempt only when its `cc-smart-dev-kit.json` lists it. An ordinary session
  or a crew session is judged exactly as before.
- **A heavy job that waited says when it started and how it ended.** A job whose output went
  down a pipe (`bun run tsc --noEmit | tail -20`) reported the pipe's own status, so a session
  that queued one saw the waiting lines, then nothing: a passing type check prints nothing of
  its own, and a failed test run read as exit 0. A job that waited now says `Heavy job starts
  after 18 min: tsgo --noEmit (8 GB)` as it starts, and `Heavy job ended: tsgo --noEmit, exit 0
  after 3 min` when it ends — with the signal that stopped it, `(sent on by job run)` when
  `job run` sent that one on, and its leftover processes when they had to be stopped. The first
  waiting line carries one hint about the pipe, once per job. A job that never waited prints
  neither line: no noise on a free machine.

**Three more fixes, found by 1.1.2's own review.**

- **Two crew sessions can no longer take one name.** A long tag, plan and phase leave only
  17–19 characters of the slug, so two slugs of one phase that share a longer prefix made the
  **same** name on two different branches — and the name is how `crew answer`, `crew tell` and
  the message guard reach a session. `crew start` now refuses the second one and says to pick a
  shorter `--slug`.
- **A crew session renamed in 1.1.1 gets its name back.** 1.1.2 stopped new renames but nothing
  set the title back, so such a session kept a task name while its lead, `crew answer` and the
  message guard went on addressing it by its record's name. Its next turn puts the record's name
  back — on the lead's turns too, not only the person's.
- **A cap you change now reaches a running lead's watch.** `crew watch` read the workflow once
  and kept that value for its whole run: `crew.max 16` set while it ran never reached it, and a
  lead's watch went on starting queued phases up to the old 24 (seen live on 2026-10-23, with
  the machine five times overloaded). Each pass reads the workflow again, and a pass that cannot
  read it — a broken file, or crew sessions turned off — starts nothing and says so once.

**What to run:** nothing. The hooks come with the plugin update. A session that is already
running keeps the old hooks until Claude Code restarts it, so only the crew sessions and leads
started after the update are held to the list or reminded.

**The portal's usage and cost numbers now say the truth.** You reported that the portal does
not report usage and cost correctly. Every number was then measured against the router's
history database, its log and its state files on a live machine, and each finding was fixed at
its cause. Where a number cannot be given, the page now says so instead of showing a number
that is not one.

- **A request with no price is counted, never added as $0.** In one measured day 62 % of the
  rows — every affordable-backend request: 17,373 of them, with real tokens and no cost — were
  added as $0, so the Usage page's cost card, "Where the cost goes" and "Top sessions by cost",
  and the Overview's cost chart and its "$X in the last day" line, all read low and said
  nothing. A sum now says what it leaves out — "$12.40 + 1,234 requests with no price" — and a
  sum made only of unpriced requests reads "no price", never "$0", the words
  `cc-smart-dev-kit usage` already used. A chart whose rows exist but carry no price says that,
  never "nothing matches".
- **A backend's price list in OmniRoute's shape was read 1,000,000× too high.** OmniRoute's
  `/v1/models` gives `pricing` in **dollars per million tokens**, as numbers
  (`{"input":5,"cached":0.5,"output":25}` for a $5 / $25 model); the reader took those for
  per-token prices and multiplied by a million, and never read `cached`, the cache-read price.
  Both real shapes are now read, each in its own unit: OpenRouter's per-token `prompt`,
  `completion`, `input_cache_read` and `input_cache_write`, and OmniRoute's per-million
  `input`, `output`, `cached` and `cache_creation`. **A row already logged keeps the cost it
  was written with**, so an affordable-backend row written before this fix stays at the price
  that was wrong at the time — `cc-smart-dev-kit gateway history` shows those totals until the
  retention drops them (90 days by default).
- **Claude Sonnet 5.5's cache read was half its list price.** The table held $0.10 a million
  where Anthropic charges $0.20 — a tenth of its $2 input rate, as Sonnet 5's own row has. A
  test now holds every row's cache read to its family's published share (Opus 5.5's a
  twentieth, Fable 5.1's a fortieth, the rest a tenth). **A row already in the history keeps
  the estimate it was written with**; only new rows use the corrected price.
- **About a nine-hundredth of a translated stream's input tokens were recorded.** A backend
  that translates an OpenAI stream (OmniRoute) knows the prompt's usage only at the end: it
  sends zeros in `message_start` and the real counts in the last `message_delta`. The reader
  took input and cache from `message_start` alone, so 1,040 calls that had spent 242M input and
  235M cache-read tokens were logged as about 270K. Each usage field is now taken from the last
  event that reports it, and the two are never added together. Anthropic's own streams keep
  their counts, except where its `message_delta` carries the cumulative input count its docs
  describe. **A row already logged keeps the count it was written with.**
- **The Overview's "Requests a minute" could never pass 40.0**, because it was read off the
  router's capped list of the last 200 routed requests — 85 of them, in one measured hour,
  Claude Code's own health pings. It is now the history's **model** requests over the last five
  minutes, one query against the database. The router's own counter is still shown, labelled
  for what it holds, and the Health page's "N requests since start" gets the same label.
- **The Usage page left out auto mode's safety checks without saying so.** They are kept out of
  the history on purpose, so they were in none of its numbers and nothing said so. The page now
  says they are counted apart, and shows the file's own count for the local days the range
  covers — read through the reader `cc-smart-dev-kit usage` prints, so the two can never
  disagree.
- **Two smaller wrong claims.** The "Cache share" card said a cache read costs a tenth of a new
  token, which is wrong for Opus 5.5 (a twentieth) and Fable 5.1 (a fortieth), and it no longer
  names a number. And the Requests table ignored the range switch: it showed rows from outside
  the window the charts drew, and its rows are now bounded by the range, as the dev mock
  already was.

**What to run:** `cc-smart-dev-kit gateway setup`. The reader and the price table live in the
router bundle, so a machine updates the copy it runs; setup says what the restart costs and
asks first.

## 1.1.2

- **A crew session's name says whose it is.** With several leads in one project, every crew
  session's name started with the same tag, so you could not tell which lead it belonged to. A
  crew session is now named `C <tag> <plan> <phase> <slug>` — for example `C my-app master-plan W1a
  launcher` — lined up with its lead, `LEAD <tag> <plan>`. Crew sessions started before keep
  their names.
- **Starting a crew session no longer looks like you typed to it.** `crew start` gives every crew
  session a first line (who it is, its lead, and its brief), and the kit read that line as your
  own words: your lead was told "the person wrote" for every crew session it started, the portal
  showed it, and the session was told your word wins over its brief. The launcher's own line is
  now recognised, so only words you type are reported.
- **A crew session keeps the name its lead gave it.** With `sessionNames` on, a crew session could
  rename itself after its task, and its lead, `crew answer` and the message guard, which find it
  by that name, lost it. A crew session is no longer asked to name itself, a name recorded for it
  is never set, and `cc-smart-dev-kit session-name` refuses inside one.
- **A subagent's report is not your words either.** When a crew session's own reviewer or
  builder hands back, that report arrives as a turn of its own, and it too was taken for something
  you typed. It is now recognised as the agent's.
- **`crew rm` finishes when the session is already gone.** A crew session whose Claude Code job
  was removed by hand could never leave the board: `crew rm` asked for `claude rm`, which answered
  that there is no such job. When agent view no longer lists the session, `crew rm` now says it was
  gone already and removes the record.

## 1.1.1

**A fix for every crew session, and Claude Code's retry watchdog on by default.**

- **A crew session loads the kit again.** 1.1.0 started each crew session lean, with your other
  plugins turned off for it, claude-mem among them. The kit lists claude-mem as a dependency,
  and Claude Code does not load a plugin whose dependency is off, so those crew sessions ran
  with no kit at all: no guard, no crew skill, no report check. A crew session now keeps on
  every plugin the kit, or a plugin `crew.keep` names, depends on.
- **The retry watchdog is on by default.** `setup` now turns on Claude Code's retry watchdog
  without asking: a session that meets a usage limit or an overloaded model waits and retries
  instead of failing. A limit that resets more than 24 hours away ends the wait, so a
  `claude -p` script never waits for days. A "no" you gave before, or a value you set
  yourself, is kept; `setup --no-retry-watchdog` turns it off.
- **The main checkout's notes respect a guarded main folder.** With
  `worktrees.guardMainFolder` on, the session-start lines about a main checkout that is on
  another branch, behind its base, or in the middle of a merge now ask the session to give you
  the command, instead of telling it to switch or merge there itself. The fast-forward is
  `git merge --ff-only`, so no merge commit lands in the main checkout. The "behind" count is
  now the base branch's own, and a merge in progress is named first.

**What to run:** `cc-smart-dev-kit setup` (it turns the watchdog on), then restart your Claude
Code sessions. Stop any crew session started by 1.1.0 and start it again: it ran without the kit.

## 1.1.0

**Most of this release is the portal and the crew.** The portal is now the page the kit runs
on: it starts with every Claude Code session and stays up, its pages draw real facts and
real actions, and each change is made in place, with a confirmation first. A lead's crew gained
its own caps, leaner starts, and a way for two leads to talk.

### The portal

- **It starts with Claude Code and stays up.** A new session starts it when it is not running,
  and a plugin update hands it to the new version at the next session start, never back to an
  older one. `cc-smart-dev-kit portal` opens it; `status` and `stop` are there too.
- **Its pages draw every fact the machine gives**: Overview, Needs you, Usage, Work (every
  lead and its crew, with Stop, Resume and Remove), a crew session's own page, Flow, Slots,
  Health, the guard log, Machine and Settings. Their facts come from read-only `/api/…`
  answers and one live stream, so a routed request, a crew step, a plan limit or a change in
  the heavy-job queue appears as it lands.
- **Every action runs the CLI's own command**, in a child process, so a long one never freezes
  a page. It asks first, names the exact change, and shows the command's own words — `✓` with
  what changed, or `✗ Not done:` with **Details** and **Try again**. The page is never
  reloaded to show it.
- **The crew and worktree actions refuse without a confirmation** (`crew.stop`, `crew.rm`,
  `worktrees.clean`), and a crew session's question is answered from the page **as the person**,
  through `crew answer --as-person`, which refuses a command a Claude session runs.
- **The Settings page writes one value at a time**, through the same functions `workflow set`
  uses, and says where each value comes from. The Project card previews `project init`'s own
  plan and writes the two files with the hash of what it showed.
- **Machine**: `doctor` with each failure's fix and **Run doctor**, the heavy-job queue, the
  updates and a held major version, the companion plugins, the MCP servers, the Browser card,
  OmniRoute, **the claude-mem card** (its route and model, its key, and its quota fallback,
  each with who set it), the project's auto-mode trust rules, Warp, and the worktrees.
- **The gateway's key from the portal**: the Machine page can paste the router's OmniRoute key
  into a masked field, or make one from your OmniRoute dashboard password. It is tested before
  it is saved; a refused key changes nothing and keeps the text you pasted.
- **There is no sign-in.** The page binds `127.0.0.1` and nothing else, refuses another
  website and DNS rebinding, and every change needs the CSRF token that came with the page.
  Any program or account on this machine can open it: that is the deliberate trade-off
  ([README](README.md#the-portal)).

### The crew

- **Caps per lead**: at most 4 crew sessions for one lead at once (`crew.perLead`), 2 of them
  on the opus tier (`crew.perLeadOpus`), under the machine's own ceiling (`crew.max`, 24; no
  opus ceiling unless you set `crew.maxOpus`). The caps are your settings, in
  `~/.config/cc-smart-dev-kit/workflow.json` or a project's file.
- **A new opus crew session waits past 85 % of the plan's 5-hour window**
  (`crew.usagePercent`), unless the gateway's opus slot has a fallback chain that answers past
  it. The window is the one Claude Code's status line last recorded, so the guard needs
  `cc-smart-dev-kit setup --statusline` (or the status line's own reading) to hold; with none
  stored, `crew start` and `crew list` say so once.
- **A crew session never asks you**: the git, merge, agent, job-route and session-escape
  guards' questions are denies that name the step, and a guard that cannot run (no bun, a
  missing bundle) denies too. A person's own session keeps every question.
- **A crew session starts lean**: the kit, the project's own instructions, Tavily, and the
  browser for a `ui` kind; every other plugin and MCP server is off for it. `crew.keep` keeps
  more.
- **A crew session resumes into its own worktree**, with its own settings and its lean flags,
  so it is still the same crew session and still lean. A session that is live is messaged,
  never copied.
- **The lead hears the person's own prompt** typed into a crew session, so it can read the
  next report against the brief.
- **Leads of one repository reach each other**: `crew lead tell` sends a contract note or a
  contract question, `crew start` warns when two leads' phases share files, and a merge into
  the base tells every other lead.
- **A lead names itself**: a session that ran `crew lead` takes its `LEAD <tag> <plan>` name at
  its next prompt. A name you give it later with `/rename` stays.
- **The self-watch gauge reads the right window per model**, from Claude Code's own status-line
  report, so a 1M-context model is not handed off at the 200k mark.

### Every session

- **The verification gate**: a project can set `checks.fast` (one command), and a session that
  changed files and never ran it gets one reminder when its turn ends — once per change, never
  a block that traps the turn, and never in a crew session, which has its own report gate.
- **`core.md` is 130 lines, down from 190**: the general instructions were trimmed with the
  owner's approval, and the two rules that were chosen back are one line each.
- **The browser after a restart**: a session the Claude daemon starts has no `DISPLAY`, so the
  Playwright MCP's own detached Chrome start died and its call failed at the 30-second
  deadline. The launcher now starts Chrome itself with the desktop's display, waits for
  Chrome's own lock, or ends at once with one plain line. `browser check` has a whole-run limit
  and never hangs.
- **The gateway's setup questions and its output** print through the one output module, so a
  pipe, a file and a terminal get the same words.

**What to run:** `cc-smart-dev-kit update`, then `cc-smart-dev-kit setup` (it refreshes the
instructions' copy, and the portal's export), then — on a machine with the gateway —
`cc-smart-dev-kit gateway setup` yourself, because the router changed in this release; it asks
before it restarts. Then restart every open Claude Code session: an update makes a new version
folder, and a running session keeps the old one.

## 1.0.1

A hotfix for **crew sessions**: `crew start` failed and stopped every crew session it started.
It read `claude agents --json` once, right after `claude --bg -w …`, and that read reports the
folder the session was launched in until the session has entered its worktree — so every new
crew session looked like it worked in the main checkout. `crew start` now records the session's
id and leaves it `starting`; the session's own start hook checks its real folder, and a session
in any other folder is marked failed and stopped.

**What to run:** `cc-smart-dev-kit update` — a patch version also installs by itself within the
hour. No `gateway setup`: the router did not change.

## 1.0.0

**1.0.0 is a major version, and the first one the hold covers.** It refuses three retired
fields in a project's `.claude/cc-smart-dev-kit.json` — `worktrees.prefix`, `worktrees.setup`
and `worktrees.engine` — and the worktree engine they configured is gone. A patch or a minor
version still installs by itself; this one waits until you run `cc-smart-dev-kit update`
([The background update](README.md#the-background-update)). Run these steps in your own terminal, in
this order:

1. **`cc-smart-dev-kit update`** — installs 1.0.0. It lists every repository your saved
   sessions worked in that still carries a retired field or an engine hook line, one `!` line
   each with its fix.
2. **`cc-smart-dev-kit setup`** — refreshes the instructions' copy for this version and turns
   claude-mem's two start blocks off ([claude-mem](README.md#claude-mem)).
3. **`cc-smart-dev-kit gateway setup`** — **run this one yourself**: a Claude Code session must
   never restart its own router. The router changed in this release (the breaker, Anthropic's
   server tools, the judge), so this puts the new copy in place. It asks before it restarts
   the router. A restart lets the answers in flight finish (up to 120 s; an answer still
   running then is cut, and Claude Code retries it), and new requests wait in the socket
   meanwhile.
4. **`cc-smart-dev-kit project init`** in each project — takes the retired fields and the
   engine hook lines out ([`project init`](README.md#project-init)); commit the two files it writes.
5. **`cc-smart-dev-kit doctor`** — every line ✓.

Then restart every open Claude Code session: an update makes a new version folder, and a
running session keeps the old one.

The changes, one line each:

- **Crew sessions** ([The workflow](README.md#the-workflow)): a small lead session starts background
  crew sessions for a plan's phases, each in its own worktree, never waits, and merges their
  branches. Off by default: turn it on with `cc-smart-dev-kit workflow set crew.enabled true`,
  or with [`crew.enabled`](README.md#the-workflow) in your own file or a project's.
- **Less Opus** ([Instructions, skills and agents](README.md#instructions-skills-and-agents)): Opus
  builds architecture and UI/UX work only, and the other kinds build on the worker slot; a
  review runs on Opus only for a risky change set. UI/UX design runs only on `opus` or
  `fable`, at `high` or above, and the agent guard refuses it anywhere else.
- **One updater** ([The background update](README.md#the-background-update)): `setup` writes
  `autoUpdate: false`, so Claude Code's own plugin update cannot install a major version past
  the hold.
- **`cc-smart-dev-kit search` is gone**: use Claude Code's own WebSearch and WebFetch, or
  the Tavily MCP server ([MCP servers](README.md#mcp-servers)).
- **Server tools go to Anthropic** ([The AI gateway](README.md#the-ai-gateway-optional)): a request that
  carries Anthropic's own web search tool goes to Anthropic as it came, whatever the slot, so
  the search really runs; at a Claude limit it gets a short note naming Tavily.
- **The breaker** ([The AI gateway](README.md#the-ai-gateway-optional)): when every target of a slot is
  limited or down, the router holds the request (up to 240 s) and then answers a 429 Claude
  Code retries; the status line and the alert name it.
- **The judge** ([First setup](README.md#first-setup)): Claude judges auto mode's checks first; while
  Claude is limited or down, the targets of your worker slot that passed the judge test judge
  in its place.
- **Finished worktrees clean themselves** ([Worktrees](README.md#worktrees)): after a merge into the
  base, and at an attended session start at most once an hour, the kit removes the ones the
  verdict proves finished; [`worktrees.autoClean`](README.md#a-projects-claudecc-smart-dev-kitjson)
  turns it off.
- **New guards** ([The hooks](README.md#the-hooks)): `session-escape-guard` stops a session loosening
  its own limits; the shell judge (`job-route`) judges a raw `claude --bg`, `claude -p` and a
  crew session's launches, and refuses polling; `workflow merge-check` prints the merge
  guard's verdict without merging.
- **A subagent never hands back with its own background work running**
  ([The hooks](README.md#the-hooks)): `subagent-background` blocks the stop once, with one plain reason
  (BG1).
- **Native Windows** ([Windows](README.md#windows), [docs/windows-setup.md](docs/windows-setup.md)): the
  installer, the launcher, the hooks, the gateway, the job queue and the crew work there; the
  doc holds the checklist for a real PC.
- **`medium` effort is allowed**; a review recorded before 1.0.0 no longer counts, because a
  record now names the agent that wrote it, and the merge guard asks until one does
  ([The workflow](README.md#the-workflow)).
- **claude-mem's two start blocks are off** ([claude-mem](README.md#claude-mem)): `setup` turns both
  off and turns Claude Code's own task tools on; set one back to `"true"` in
  `~/.claude-mem/settings.json` to turn it on.

## 0.7.0

**A major version now waits for your `cc-smart-dev-kit update`.** A patch or a minor version
still installs by itself, within the hour. A major version (the first number grows) does
not: each interactive session start shows one line until you run `cc-smart-dev-kit update`
([The background update](README.md#the-background-update)).

1.0.0 is such a version. It refuses the old worktree fields in a project's
`.claude/cc-smart-dev-kit.json`; its `cc-smart-dev-kit project init`, run in each project,
fixes them. Read the 1.0.0 notes above before you run `cc-smart-dev-kit update`.

**Claude Code's own plugin auto-update is now off for this marketplace.** It knows nothing of
the hold, so it would install a major version by itself. The kit's own background update is
the one updater now. `setup` writes `autoUpdate: false` (an explicit `false`: a removed key
leaves Claude Code's own record at `true`). On a machine that got 0.7.0 by itself, the next
background check turns an older setup's `true` to `false` (a `true` you set stays yours:
`doctor` says what to do).

**After this update, restart your running Claude sessions.** Until then, a session that
loaded 0.6.0 may run 0.6.0's hook again on a `/clear` or a compaction, and that older check
would install a newer major version by itself.

## 0.6.0: Serena is removed

The plugin no longer registers the Serena MCP server, and its `serena-root` hook and its
`code-explorer` agent are gone. One Serena server ran for each Claude session, at about 3 GB of
memory each in a large project; sessions seldom used it, and Grep, Glob and Read do most code
search. For a file's shape — its functions and exports — claude-mem's `smart_outline`,
`smart_search` and `smart_unfold` do the job (claude-mem is a [companion
plugin](README.md#companion-plugins) setup installs).

**After you update, run `cc-smart-dev-kit setup` once.** It takes back what an older setup made
for Serena, and nothing else:

- the `serena` MCP server, with Claude Code's own `claude mcp remove serena --scope user` —
  only while setup's record says setup registered it, and it still holds exactly what setup
  registered (or, after a pin update an older setup left half done, it still has setup's own
  shape: `uvx`, Serena's repository, and setup's own context file);
- Serena's context file, `~/.local/share/cc-smart-dev-kit/serena/contexts/worktree.yml`
  (a backup goes to the state folder first), and its folder once it is empty;
- the `serena-root` hook's records, `~/.claude/cc-smart-dev-kit/serena-root/`.

`--dry-run` shows each of these first. Until setup has run, `doctor` prints one ✗ line that
says so; after it, nothing.

**A Serena of your own stays.** A `serena` server that setup did not register (or one you
changed since) is never touched: `doctor` shows it as a `·` line. Its context file stays too,
while a registration still starts Serena with it. The main-folder guard no longer looks at
Serena's edit tools, so a Serena you keep can edit a guarded main checkout without a refusal.
To remove a Serena of your own by hand:
`claude mcp remove serena -s user`. A project's own `.serena/` folder (Serena's project
settings and memories) is the project's: delete it when nothing uses it any more.

A project whose `.claude/cc-smart-dev-kit.json` lists `serena-root` in `ownHooks` keeps working:
the name is still accepted, silences nothing, and `doctor` says it can go.

## 0.5.0

**After you update, run these in your own terminal, in this order:**

1. `cc-smart-dev-kit gateway setup` — updates the router copy on this machine (a plugin update
   alone never does: until this step the older router keeps answering). It also takes out the
   model keys 0.4.3 wrote (`ANTHROPIC_DEFAULT_HAIKU_MODEL` / `…_SONNET_MODEL`, only where
   cc-smart-dev-kit set them), and drops the hidden `claude-sonnet-5-5` from a scout or worker
   chain that is still 0.4.x's default. A slot is reached by the model's family now, so those
   keys are no longer needed.
2. **Restart every open Claude session right after.** A session that is still running may keep
   sending `haiku` / `sonnet` work by the slot's old name; when that slot has no chain, the
   router refuses it with a 400 that says what to do.
3. `cc-smart-dev-kit gateway on` — only if the gateway is not on yet.

Check your scout and worker chains (`cc-smart-dev-kit gateway status`): a Claude model answers
there only if you put it in the chain. Setup took out the `claude-sonnet-5-5` 0.4.x added at
the end of its default chains; a chain you changed is left as it is.

An opus or fable chain set before 0.5.0 starts with its fallback **off**: it moved on only at
the plan's usage limit, and "on" now moves on at any rate limit or server error. Turn it on
with `cc-smart-dev-kit gateway fallback <slot> on` when you want that. An opus or fable chain now
also takes every Opus or Fable id, not only the one 0.4.x keyed it by, and a `claude-…` first
target answers for all of them.

A judge set before 0.5.0 is ignored until it is tested and set again
(`cc-smart-dev-kit gateway slot judge <target>[,…]`), because the judge's job changed: it judged
only when Claude could not, and then judged every check in Claude's place. Now Claude
judges first again, and your worker slot's tested targets judge while Claude is limited or down.

The gateway:

- **Every slot works the same way** ([The AI gateway](README.md#the-ai-gateway-optional)). Opus and Fable
  take any chain, a backend first included (`gateway slot opus omniroute:<model>`), and the scout
  and the worker keep theirs. Every slot is **Claude or Custom**: a slot with no chain in use is
  Claude — that model is plain Claude, on your own login. `gateway slot <slot> claude` switches it
  to Claude and **saves its chain** (`kept` in the config, never used), `gateway slot <slot>
  custom` uses it again with its fallback switch, and `gateway slot <slot> clear` deletes it
  (`off` still means `claude`). A fresh setup writes no chain, so the plugin picks no model for
  you; and there is no hidden Claude step — a chain whose targets are used up returns its error.
  The old portal's saved chains move into `kept` on `gateway setup`.
- **Each slot has a fallback switch** ([The AI gateway](README.md#the-ai-gateway-optional)):
  `cc-smart-dev-kit gateway fallback <slot> on|off`. On: the next target answers when the one
  before it fails or rests. Off: only the first answers, and the rest stay saved. On by default
  for scout, worker and judge, off for opus and fable.
- **A request reaches its slot by the model's family**, so `gateway on` no longer pins `haiku`
  and `sonnet`. A newer version of a family (`claude-opus-6-0`) reaches its slot with no change.
- **Claude judges auto mode's checks first** ([First setup](README.md#first-setup)). While Claude is limited
  or down, the targets of your worker slot that passed the judge test (`gateway setup` and
  `gateway slot worker` run it) judge in its place; `gateway fallback judge off` keeps Claude
  alone. A judge chain you set wins, and may hold a `claude-…` target.
- **WebSearch goes to Anthropic** ([The AI gateway](README.md#the-ai-gateway-optional)): a request that
  carries Anthropic's web search tool is sent to Anthropic as it came, whatever the slot of the
  model. When Claude is at its limit or down, the search result is a short note from the router
  that points at the Tavily MCP server's search tool.
- **An affordable model's thinking stays visible** ([The AI gateway](README.md#the-ai-gateway-optional)): the
  router keeps it, marked as its own with the backend's signature inside. It removes it only on a
  request to Claude (no "Invalid `signature`" 400), and gives a backend its own signature back.
- **The usage-limit alert names no model of its own** ([The usage
  limit](README.md#the-usage-limit-the-alert-the-status-line-and-usage)): it offers your model first, then
  targets from your own chains, and its action also turns that slot's fallback on. It covers
  every family that has a slot.
- **`agent-guard` reads affordability from `gateway.json`** ([The hooks](README.md#the-hooks)): a `haiku`
  or `sonnet` launch is affordable while the gateway is on and that family's slot has a chain
  whose first target is a backend — no longer from the model keys 0.4.3 wrote.
- **claude-mem follows the scout slot only** ([claude-mem on the
  gateway](README.md#claude-mem-on-the-gateway)): setup points it at the scout chain's first target when
  that is a backend, writes no quota fallback model any more, and takes out the fixed Claude
  Haiku fallback 0.4.3 wrote there.

Worktrees:

- **`worktrees --remove <path>` no longer finds itself** ([Worktrees](README.md#worktrees)). The command's
  own line (`… worktrees --remove /path/wt`) and the shell that ran it name the folder being
  removed, so on Linux and macOS every removal answered "kept …: programs run from its files:
  bash, bun". Each process's parent is read now (`ps -ww -o pid=,ppid=,args=`, `ParentProcessId`
  on Windows), and the command's own process and those that started it are left out of the
  command-line match; a process whose working folder is inside the worktree still counts, so a
  session or a shell really sitting there keeps it.

The merge guard:

- **`--admin` always asks** ([The hooks](README.md#the-hooks)). The merge guard asks you about every
  `gh pr merge … --admin` (or `--admin=<anything>`), even when `autoMerge` would let the merge
  through: `--admin` merges past the repository's required reviews, required checks and merge
  queue. It asks, never refuses, so a release flow can still use it after your yes.
- **An exact allowed merge is `allow`** ([The hooks](README.md#the-hooks)). For `gh pr merge <n>` with
  flags gh has, when `autoMerge` is on, the checks are green and a review covers the head under
  `fixesAfterReview`, the guard answers `allow`: no question, and no auto-mode "Merge Without
  Review" block for that call. Every other merge form keeps the policy's silence, so auto mode's
  rule still applies to it, and a crew session never gets `allow`.

The installer:

- **The marketplace is added over HTTPS when SSH to GitHub is refused** ([Install](README.md#install)).
  Claude Code adds a marketplace over ssh by default, so a machine with no GitHub SSH key (or a
  port-22 block) failed with nothing added. The installer retries that one source once as
  `https://github.com/<owner>/cc-smart-dev-kit.git`, says so in one line, and goes on — the
  marketplace's name comes from the repository's own marketplace file, so it lands under the
  same name.
- **An account that cannot read the repository is named** ([Install](README.md#install)). With `gh`
  installed and logged in, the installer asks `gh repo view <owner>/cc-smart-dev-kit --json name`
  before it adds anything: the run stops (exit 1) with the account, the line to ask the
  repository's owner for read access, and the invitation page. `doctor`'s marketplace check
  names the same two causes with the same fix lines.

## 0.4.3

Every change here comes from the installer's FIRST real run, on 2026-10-17, and from what it
left behind on that machine.

- **The marketplace is refreshed before any version is compared** ([Install](README.md#install)). The
  live run had the marketplace added hours earlier at 0.4.1: the installer compared the
  installed 0.4.1 with that stale clone's 0.4.1, saw them equal, updated nothing — and then
  called an option the installed 0.4.1 CLI did not have, so the run died at the Tavily step.
  The installer now runs `claude plugin marketplace update` first (the same order
  `cc-smart-dev-kit update` uses), and then reads the installed CLI's own version: older than the
  release the installer ships with means it stops, with the two exact commands and exit 1,
  instead of calling an option that CLI may not have.
- **A backend key is tested before it is saved** ([The AI gateway](README.md#the-ai-gateway-optional)).
  A person pasted their Ollama Cloud key where the router's OmniRoute key was asked for; it was
  saved unchecked, OmniRoute answered 401 to every request after that, and every affordable
  subagent fell back to Claude until the key was read back out of OmniRoute's own database. Now
  `gateway setup --backend-key-stdin` makes one cheap authenticated request first
  (`GET /v1/models`): a 401 or 403 refuses the key, keeps the one in the file and exits 1, saying
  which key the backend wants. A backend that cannot be asked (unreachable, or a 5xx) saves
  nothing either — unless `--save-unchecked` says you know. And the file is backed up before a
  key that is really changing replaces one.
- **No key yet? setup can make one.** ([First setup](README.md#first-setup))
  `cc-smart-dev-kit gateway setup --omniroute-password` (or `--omniroute-password-stdin`) takes
  your OmniRoute **dashboard** password — asked with no echo, never stored — logs in to the local
  OmniRoute, makes the router's key named `cc-smart-dev-kit-router-<machine>`, tests it and saves
  it. No dashboard trip, no copy-paste.
- **The installer asks before it touches an MCP server of yours** ([MCP
  servers](README.md#mcp-servers)). A project's own script had registered `playwright`, `serena`,
  `sequential-thinking` and `tavily-websearch` at user scope first; setup left them alone (the
  rule) and printed one `!` line nobody saw, so the old browser kept starting and the plugin's
  own never took over. The installer now runs `cc-smart-dev-kit mcp status --json`, shows what
  runs instead, and asks per server: "Replace it with cc-smart-dev-kit's?" — a yes removes it and
  runs setup again (so the plugin registers its own **with its record**), a no lists it under
  "What is left" with the exact command. `doctor` gained a `!` line for the same case.
- **The gateway is asked about only when it is not working** ([First
  setup](README.md#first-setup)). A new read-only `cc-smart-dev-kit gateway check` answers one question
  with an exit code: 0 the key works, 1 no key yet and OmniRoute answers (setup can make one),
  3 it could not be judged, 4 the key in the file is one OmniRoute refuses. The installer asks
  for a key only on 1 and 4 — showing what runs instead and never a key — and asks again **once**
  after a refusal, keeping the old key.
- **A pasted secret no longer arrives broken.** Warp and other terminals wrap a paste in the
  bracketed-paste markers `ESC[200~` … `ESC[201~`, and a read that echoes nothing keeps every
  character: a token a person pasted was refused as "55 characters" and never saved. Every
  secret read now strips those markers and any other control character — in the plugin (one
  home: `src/cli/secret-line.ts`), and in both installers. The token step is also ONE question
  now (paste it, or Enter to skip): a paste can no longer land in a yes/no answer, and every
  path of `browser token` that saves nothing exits non-zero.
- **The `claude-code` profile is named in BOTH of Chrome's files**
  ([The browser](README.md#the-browser)). Chrome reads the display name from `Local State` and falls back
  to the profile's own `Preferences` (`profile.name`); only the first was written, and the person
  saw the profile unnamed. Both are written now, still only while Chrome is closed — while it
  runs, the page says "close Chrome, then run `cc-smart-dev-kit browser setup` again".
- **`doctor` no longer invents extensions.** It judged the profile by the folders on disk, and
  named Chrome's own `Temp` folder and Chrome Web Store Payments — neither of which a person can
  find in `chrome://extensions`. It reads Chrome's own record now: a folder with a manifest, and
  a location that is not a component or an install Chrome made for itself. A real extra
  extension is named by its manifest name (a `__MSG_…__` name resolved from its own locales).
- **Tavily is never asked for twice** ([MCP servers](README.md#mcp-servers)). The person had
  `TAVILY_API_KEY` in their environment and a project already running a Tavily MCP server; the
  installer asked anyway. It says one line instead — "Tavily: using TAVILY_API_KEY from your
  environment" — and asks only when neither the environment, the key file, nor your settings
  have one.
- **The Fable warning is at the switch, or right after Fable's first answer — never after a
  switch away** ([The hooks](README.md#the-hooks)). `fable-session` read the transcript's last answer at
  every prompt, which is the PREVIOUS turn's model: it missed the switch to Fable, and then
  warned while the person was back on Opus. It runs on `PostModelSwitch` (the model the session
  moved TO), on `Stop` (the answer that just finished) and on `SessionStart`, and no longer on
  `UserPromptSubmit`.
- **The portal's log is newest first** ([The portal](README.md#the-portal)): the Health page's Log and the
  Overview's "Latest warnings" both show the newest line at the top, with the times as they are.
- **`gateway setup --omniroute-password` works on a real terminal** ([First
  setup](README.md#first-setup)): the flag asks for the dashboard password with no echo, and the context it
  reads from never carried the reader — every run answered "this terminal cannot hide what you
  type", even on a terminal. It reads the line now, and a key it makes but does not save (a key
  the backend refuses, an unchecked save without `--save-unchecked`) is **deleted again** in
  OmniRoute, so the dashboard keeps no unused key; a delete that fails names the key and its id.
- **Nothing that names a server can print a key** ([MCP servers](README.md#mcp-servers)): a URL's query,
  fragment and userinfo are hidden, an argument after a key-like flag (`--api-key X`) and a
  `name=value` whose name looks like a key (`--token=X`) show `•••`, and the command is shown by
  its own name — in `mcp status`, its `--json`, the installer's question and `doctor`'s line.
- **A Tavily key that lives only in your `settings.json` is a key setup uses** ([MCP
  servers](README.md#mcp-servers)): Claude Code fills `Bearer ${TAVILY_API_KEY}` from the settings' `env`
  as well as from your environment, so setup now reads that copy too — it registers the server
  instead of saying there is no key, while the installer had already stopped asking for one.
- **`tavily-websearch` is offered for replacement like the other three** ([MCP
  servers](README.md#mcp-servers)): the check used to leave it out when the machine had no Tavily key, so
  a server a project's own script had registered under that name was never mentioned. And the
  installer asks again after the Tavily step, when the key has arrived.
- **`doctor` names a same-name server that wins over the plugin's**
  ([MCP servers](README.md#mcp-servers)): a copy at the local scope (`~/.claude.json`,
  `projects[<folder>].mcpServers`) or in a project's `.mcp.json` takes precedence over the
  user-scope one, so that copy is the one Claude Code starts.

## 0.4.2

- **One command installs the plugin** ([Install](README.md#install)): `install.sh` for macOS and
  Linux, `install.ps1` for native Windows, the same steps, the same words and the same exit
  codes. Each step prints one line and is skipped when it is already done, so a second run
  only fixes what is missing. It asks before it installs or upgrades Bun, asks for the
  browser's token, the gateway's key and the Tavily key (each skippable, never echoed, never
  printed), and ends with `doctor` and — when something is left — the list of what is left,
  each item with the exact line that finishes it. `--dry-run` prints the plan for this
  machine and changes nothing. A step that fails stops with the command that retries it;
  running the installer again goes on from there. It refuses inside a Claude Code session,
  and it never writes a secret file or passes a secret on a command line: each key reaches
  the plugin's own command on stdin. Exit codes: 0 done, 3 installed with items left, 1 a
  step failed, 2 refused.
- **The move runs on every machine, and `setup` always follows it** ([Moving from
  anymodel](README.md#moving-from-anymodel)): `migrate` decides by itself what to move and says
  "Nothing to move." on a machine without the old names, so the installer no longer guesses
  for it — and the old `anymodel` plugin, when it is still installed, is asked about
  afterwards. `setup` then installs the instructions and the launcher, which the move alone
  does not.
- **`cc-smart-dev-kit setup --tavily-key-stdin`** ([MCP servers](README.md#mcp-servers)): the Tavily
  key on stdin, never an argument. setup writes it to the key file it reads a key from
  (`~/.claude/cc-smart-dev-kit/tavily.key`, mode 600, through the same atomic writer as the
  browser's token) and then treats it as a key from that file, so a later setup keeps it.
- **Adding the new marketplace does not reuse the old one** ([Moving from
  anymodel](README.md#moving-from-anymodel)): proved live on a machine that still had the `anymodel`
  marketplace — adding this repo's source made a SECOND marketplace, named
  `cc-smart-dev-kit`. The installer and the move both rely on it, so "already added" is a
  marketplace's own name, never its source.

## 0.4.1

- **Fable may be a fresh attempt** ([Instructions, skills and agents](README.md#instructions-skills-and-agents)):
  when you are not satisfied with Claude's own answer — a UI/UX design, an engineering problem, a
  fix — the session may launch a read-only Fable advisor for a fresh attempt, with the reason
  `Fable reason: unsatisfied - <what you disliked>`. It proposes a design, a plan or a fix; you
  or a crew session build it, and you approve each launch.
- **Fable may build, and a session may run on Fable** ([The hooks](README.md#the-hooks), and the model
  table in [Instructions, skills and agents](README.md#instructions-skills-and-agents)): an agent that can
  change files — a builder, or a fork — runs on Fable with `Fable reason: build - <what you asked
  for>`, which you approve each time; anything else there keeps being refused. Nothing objects to
  a session whose own model is Fable: it is your choice. For a hard or high-stakes change —
  security, money, permissions, a big architecture change — the session may also run the
  second-opinion review on Fable by its own judgment, with the reason
  `Fable reason: review - <why>`, and the guard asks you.
- **A note when the session itself runs on Fable** ([The hooks](README.md#the-hooks)): the new
  `fable-session` hook shows you one line, once a session, when the session's own model is the
  `fable` tier — it uses your plan's limits faster than Opus, so switch with `/model` if you did
  not mean to. Nothing goes to Claude, it never blocks anything, and a `/model` switch to Fable
  is caught once Fable has answered, at the prompt after that. That the line reaches you at all
  is **not yet proved live** (see the owed check in
  [docs/claude-code-contract.md](docs/claude-code-contract.md) § Relied on, not proved yet).
- **A review at effort `max` asks instead of being refused** ([The hooks](README.md#the-hooks)):
  `agent-guard` now asks you to approve a review at `max` — reviews run at `xhigh` unless you asked
  for a deeper one — and records it, so `cc-smart-dev-kit usage` lists it. In `claude -p`, where
  nobody can answer, it is still refused.
- **`opus` and `fable` mean the tier, whatever model answers** ([The hooks](README.md#the-hooks)): an
  `ANTHROPIC_DEFAULT_OPUS_MODEL` / `…_FABLE_MODEL` override (or a model slot) that points one at
  another vendor's model keeps the tier's rules — the reason line, your approval, the review
  rules, and never a forced `max` — and the guard's question names both, like
  `` `opus` (answered by openai:gpt-5.5) ``.

## 0.4.0

- **`cc-smart-dev-kit project init`** sets a project up: its `.claude/cc-smart-dev-kit.json`
  and, unless the project runs an engine of its own, the worktree engine's three hook lines
  ([`project init`](README.md#project-init)).
- **The workflow, and `cc-smart-dev-kit workflow`**: what cc-smart-dev-kit may do by itself
  here — commit, push, open a pull request, merge. The project's committed file wins over
  your own defaults, and `show` prints each value with where it came from
  ([The workflow](README.md#the-workflow)).
- **A base per branch prefix** (`worktrees.bases`): a `hotfix/…` or `release/…` worktree
  starts from the base that prefix names, not from the integration base
  ([Worktrees](README.md#worktrees)).
- **`worktrees.engine: "own"`**: a project that runs its own worktree engine says so, and
  `doctor` expects no cc-smart-dev-kit hook lines there ([A project's
  `.claude/cc-smart-dev-kit.json`](README.md#a-projects-claudecc-smart-dev-kitjson)).
- **Windows**: native Windows, with Git Bash for the parts that are `sh` scripts — the
  hooks, setup, the launcher, the gateway as a Scheduled Task, the job queue, the toasts
  ([Windows](README.md#windows)).
- **`cc-smart-dev-kit usage`** also shows auto mode's safety checks, which the gateway's
  router counted, by day, with the tokens each answer reported
  ([The usage limit: the alert, the status line, and `usage`](README.md#the-usage-limit-the-alert-the-status-line-and-usage)).
- **The browser drives your own Chrome**, through the Playwright extension, in a profile of its
  own named `claude-code`: `cc-smart-dev-kit browser setup` makes it and prints the steps,
  `browser token` saves the token its status page shows — and `browser mcp` refuses to start
  without that token, so nothing ever waits for an approval click ([The
  browser](README.md#the-browser)). The plugin's own shared Chrome, its profile and the tab filter are
  gone; the profile folder 0.3.0 left stays on disk, `doctor` names it and the command that
  deletes it, and nothing here deletes it for you.
- **The instructions work in parallel**: the plugin's general instructions tell Claude to
  start every independent phase at once, and never to wait for a merge, a release, a review
  or an answer it does not need ([Instructions, skills and agents](README.md#instructions-skills-and-agents)).
- **The merge guard, and the review record** ([The workflow](README.md#the-workflow)): the `merge-guard`
  hook asks you before a `gh pr merge` your policy does not allow, and tells auto mode nothing
  for an exact `gh pr merge <n>` whose whole policy — `autoMerge`, the checks, a review covering
  the fixes after it — passed; `workflow show` says whether the commit here has a recorded
  review, and `workflow merge-check` prints the same verdict without merging.
- **The effort rule** ([The hooks](README.md#the-hooks)): `agent-guard` allows a subagent only at
  `high`, `xhigh` or `max` — `low`, `medium` or a level it does not know is refused, as
  before a launch with no model or no effort. An affordable slot still runs at `max`; a
  review runs at `xhigh`, unless you asked for a deeper one — `max` then asks you (0.4.1).
- **The alert settings** ([Notifications](README.md#notifications)): `alerts.events` says which moments
  alert, `alerts.sound` adds the platform's sound, and `alerts.usagePercent` is the plan share
  the status line warns from.
- **The Linux desktop extras of the alerts** ([Notifications](README.md#notifications)): a click
  raises the session's window, the alert moves to the notification centre after a minute, one
  alert per session is on screen, and XFCE's Do Not Disturb keeps an ordinary alert quiet —
  each only where its tool is installed.
- **The portal's Settings page, its Project card and its Browser card** ([The
  portal](README.md#the-portal)): the workflow settings with where each value comes from, the project's
  two files planned and written from the form, and the browser's state with the button that
  runs `browser setup`.
- **"Dynamic, not hard-coded"** ([Instructions, skills and agents](README.md#instructions-skills-and-agents)):
  the instructions tell Claude to read every value — a name, a path, a port, a URL, a version,
  a branch, a list — from the one place that owns it, never from a copy in the text.

**After you update, run `cc-smart-dev-kit gateway setup` on every machine with the gateway.**
The router changed in this release (it counts auto mode's safety checks, which `usage` reads),
and that command puts the new copy in place. It asks before it restarts the router, because a
restart cuts the answers in flight.

**The browser needs its two steps too** ([The browser](README.md#the-browser)): the `playwright` server
refuses to start until `cc-smart-dev-kit browser setup` has made the `claude-code` profile and
`cc-smart-dev-kit browser token` has saved the token from the extension's status page. A machine
that ran 0.3.0 also still has its old shared profile at
`~/.local/share/cc-smart-dev-kit/playwright`, and possibly the Chrome 0.3.0 started: nothing uses
either now, and `doctor` names both — where the folder is, the command that deletes it, and the
pid of that Chrome, whose debug port any program on your machine can drive. Neither is deleted
for you: the folder may hold sign-ins, so that call is yours.
