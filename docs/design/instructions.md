# Instructions, skills and agents


The plugin carries general working instructions for Claude, skills, 5 agents and three
Workflows, all written for any project (`README.md` § Instructions, skills and agents lists
them).

**The always-on instructions reach Claude through the user's `CLAUDE.md`.** A plugin cannot
add text to every session by itself, but Claude Code loads `<config dir>/CLAUDE.md` in every
session, and an `@path` line there imports another file. So `setup`:

1. copies `plugin/instructions/**.md` to `<stateDir>/instructions/` — each file a whole file
   cc-smart-dev-kit owns, so `restore` removes it; a file a newer plugin no longer ships is taken
   out of the copy (`src/setup/instructions.ts`);
2. then writes one managed block into `<config dir>/CLAUDE.md` that imports `core.md`.

Why a copy: the plugin's own folder has the version in its name and goes away after an
update, so an import cannot point into it. The block names the copy as `~/…` when the config
folder is under `HOME` (so a `CLAUDE.md` shared between machines through a dotfiles repo
stays right on each), else by its absolute path. `--no-instructions` takes the block out
first, then the copy, so nothing ever imports a missing file; a `CLAUDE.md` that setup
created and that holds nothing else is removed.

**The import path is written the way Claude Code's parser reads it, on every platform**
(`claudeImportPath`): every separator is `/`, and a space is `\ `. Claude Code's import is a
run of characters with no space and no backslash, so a Windows path with `\` stops at its
first backslash and imports nothing, and Claude Code reports no error. Up to 1.4.1 setup wrote
`@~\.claude\…\core.md` on Windows, and no session there received the instructions. The
next `setup` rewrites the block, and `doctor` fails until it does.

**Two state files sit beside the copy** (`src/setup/instructions.ts`), in the state folder:

- `no-instructions`: the person's `--no-instructions`. While it is there, a plain `setup`
  keeps the instructions out; `--instructions` removes it; `restore` removes it too (a setup
  after a restore starts fresh). Why stored: a choice that a plain `setup` (run after every
  update) quietly undid would be no choice.
- `instructions-version`: the plugin version that last wrote the copy.
  `instructionsNeedRefresh(paths, version)` is true for an installed copy, not opted out,
  whose stamp names another version. `doctor` compares each file with the plugin's, and only a
  difference fails: a stamp that lags while every file matches passes with a note, because
  `setup` rewrites only the stamp and never prints it. `refreshInstructionsCopy(paths, version)` brings only the copy up to that
  version: no block, no other step, no question, nothing when opted out or never installed.
  `refreshDue` also stops a session of an older version from writing its files back over a
  newer copy (`refreshMayWrite`: the installed version writes, and with no record of it only
  one newer than the stamp); a session that may not refresh says why in one stderr line
  (`refreshInstructionsAtSessionStart`).
  It is the **new** version's first session start that calls it: the update itself runs the
  old version's code, which does not know the new files, so the `update-check` SessionStart
  hook refreshes the copy through `refreshInstructionsAtSessionStart` — the copy only,
  quietly, one stderr line when it fails, and nothing when another session holds the state
  lock (that one is doing it). A plugin update therefore reaches the copy within the first
  session after it, and `setup` still refreshes it as before.

**A project's import of an opt-in file loads nothing where the copy is missing** (a teammate
without cc-smart-dev-kit, or after `--no-instructions`), and Claude Code says nothing. `doctor` reads
the memory files Claude Code would load (`CLAUDE.md`, `.claude/CLAUDE.md`, `CLAUDE.local.md`
in the current folder and every folder above) and names a cc-smart-dev-kit import whose file is
missing.

That an import in the user's `CLAUDE.md` reaches the main session and a subagent was proved
live (`claude-code-contract.md` § Instructions). The built-in `Explore` and `Plan` agents load
no `CLAUDE.md`, so a brief to them restates what they must respect.

**Opt-in instructions** (`optin/`) are copied too, but only a project's own import line loads
them: they are for projects that work the way they describe (one session per worktree).

**One home per rule.** Each rule lives in one place: the always-on instructions state it; one
skill holds its procedure and points back; an agent's file holds only that agent's job. The
precedence is stated once, at the top of `core.md`: where the project's own `CLAUDE.md`,
rules or `.claude/cc-smart-dev-kit/<skill>.md` differ, the project's text wins.
`bun run check:duplicates` (`scripts/check-duplicates.ts`, in `bun run check` and CI) fails
when the same sentence of 12 or more words appears in two files of the plugin's
instructions, skills, agents, output styles or workflow scripts — a script's strings are read
because a rule written into a prompt is a rule an agent follows. A deliberate repeat goes in
`scripts/check-duplicates.allow.json` with its reason. It cannot see the same rule said in
other words; that stays a review job.

**What `core.md` keeps.** Every session on every machine loads it, and every subagent but
`Explore` and `Plan`, so each line costs every turn. It keeps the rules a session needs on
every turn and points to the skill that holds each procedure: the research steps live in
`research-first`, the model and effort detail in `subagent-decision`, the gateway's slots in
`gateway`. `bun run check:core-lines` holds it to a line budget (`scripts/check-core-lines.ts`;
1.1.0 cut it from 190 lines to 128), and `check:context-budget` estimates its tokens. It and
the skills say which model and effort fit which job, never what the agent guard blocks or asks
or which line a launch needs: the guard's own message says that, at the launch it judges (the
owner's D12). The launch lines the skills do teach are the senior engineer's two markers:
`Mode: review` in a review brief (`build`, `review`, `subagent-decision`) and `Mode: plan-review` in a
plan's second read (`plan-task`, `subagent-decision`). They are not the guard's, but the
review-record hook's, which records a review only with the first. They tie no effort to the backend that answers a tier: the backend behind a slot
never changes the choice, and a backend's effort is the person's pin at the router
(`docs/gateway.md` § A backend target's effort pin).

**The model and effort policy: the lead's judgment (owner, 2026-11-05).** For each launch the
lead weighs three things: how hard the job is, what a miss costs, and whether it is the last
check before it is too late (a plan's second read, the final review). It spends effort where
those are high and saves it elsewhere. Why: in Claude Code, Opus, Sonnet and Haiku 5.5 default
to `medium`, and Opus 5.5 at `medium` already matches Opus 5 at `high`
(code.claude.com/docs/en/model-config); on the owner's Opus 5.5 benchmarks `high` gives most of
the gain for about three times `medium`'s cost, while `xhigh` and `max` cost two to three times
more again for a few points, and the docs call `max` "prone to overthinking". So the lead is
recommended on Claude Opus at `high`, and briefs are full for every tier, whatever model answers
it: there is no lighter brief for a backend. `core.md` keeps the short form (§ Subagents);
`subagent-decision` holds the whole policy: the worked examples, delegation and parallel work,
task types, the usage-left rule, how to brief, and the order Claude Code reads `model` and
`effort` in (the call first, then an agent's frontmatter, so frontmatter is only a default; the
kit's own agents carry none).

**Delegate only what pays for its own context.** Anthropic's Opus 5 prompting guide says not to
delegate work a handful of tool calls finish, and Claude Code's sub-agents page keeps a quick,
targeted change in the main conversation: a subagent spends its own tokens and does not read the
lead's prompt cache. So `core.md` gives a subagent work that is independent and big enough (a
phase, a broad search, a fresh-eyes review, a scenario hunt), and the orchestrator-only rule
holds for an approved plan, not for every change; a change small enough to need no plan file
stays with the lead (`plan-task`). One exception to "a subagent starts no agents": the senior
engineer's consult may start research agents, and it still reports to its caller and never asks
the person. In `Mode: review` or `Mode: plan-review` it starts none: a child's completion notice
reaches it as a later prompt without the marker, so `review-record` would record nothing for a
review that happened.

**Plain English in replies: one home.** `core.md` § Ending a turn holds the rule: a question and
each option stand alone, with what is decided, why it matters, what each option does and what it
costs; sentences stay short, the meaning does not. The detail and the before/after examples live
in `explain`'s `references/plain-english.md`; `plan-task` § 2 and the output style point to it.

**Checks: what you changed while building, the full check once (owner, 2026-10-26).** In a big
project a whole type check takes tens of seconds and a whole test run many minutes, and sessions
and agents that queue them slow every other. So `verify-change` is the one home: § 2 lists what a
session runs while it builds (the tests of the changed code, the linter on the changed files, the
type errors Claude Code reports for them, or the project's `checks.fast`), and § 4 defines the
full check (the whole type check, the whole lint with any stricter push-hook rules, all the tests,
the build) and when it runs: once, by the main session before the push. A subagent never runs
it; the session that launched it does, after its agents hand back. `core.md`, `builder`, `build`,
`commit` and `impact-analysis` point to those two sections. Type errors per file: Claude Code's
`LSP` tool reports a language server's type errors and warnings after each edit
(code.claude.com/docs/en/tools-reference § LSP tool behavior, and `/plugins/code-intelligence`,
read 2026-10-26), but only where a code intelligence plugin runs a server for the language,
never in a cloud session, and for the edited file, not its callers. `tsc` on named files ignores
`tsconfig.json`, so no rule uses it. The `verify-gate` Stop hook asks for `checks.fast` once
after the last change of a turn that edited files (`hooks.md` § The plugin's hooks).

**The skill pair for the person's availability.** `user-unavailable` and `user-available` are the
two skills of `cc-smart-dev-kit user …` (the owner's pair of words, 2026-10-25: the person may be
asleep, or just away). `user-unavailable` is the rules while the person cannot answer: never stop
to ask; an easy-to-undo choice with a recommended option is taken and parked as a `decision`; the
person's own choice is parked as a `question` with its options; an action that needs their yes is
parked as an `action` with its exact command and never tried; each stretch ends with a `Summary:`
decision. `user-available` switches the state back, shows what was done, then goes through the
list: decisions to keep or undo, the questions in one call, each action run on the person's yes.
Neither skill duplicates the hooks (`hooks.md` § While the person is away): the hooks deny and
park, the skills say how to work in that state. The pointer to them is in the hooks' notes, not
in `core.md`, which stays inside its line budget. A skill's name and description are carried by
every session, used or not, so both descriptions stay to one short sentence or two
(`check:context-budget`).

**The shipped Workflows.** `plugin/workflows/audit-run.js` is the run the `audit` skill starts:
one read-only `auditor` per track on `sonnet` at `high`, a second auditor on `opus` at `xhigh` to
refute every finding (the judgment, D46), one `builder` on `sonnet` at `medium` to write the
findings file. `plugin/workflows/review-split.js` is the second opinion the `review` skill takes
on a big change set instead of its single reviewer: one `senior-engineer` per track, a second
one to refute every finding, and the verified findings merged and ranked. Its launches follow
D46's tier for the change set the caller names with `risky` — `opus` at `xhigh` for a risky one,
`sonnet` at `high` otherwise — and the refuters run on that same tier, because they make the
review's judgment; the audit's verifier is `opus` because the auditors are only the breadth.
Because a literal cannot depend on the change set, the script writes both fixed launch sets and
the caller picks one: a second script would repeat every prompt, which `check:duplicates` fails.
`high` gives most of the gain of a deeper effort for a fraction of its cost (2.2.0); `max` was
dropped from both scripts, and the writer, whose judgment is already made, runs at `medium`.
The senior engineer has every tool, and the tracks of one run share one checkout, so each
reviewer, auditor and refuter launch passes `disallowedTools: ['Edit', 'Write', 'NotebookEdit']`
(Claude Code merges it with the agent's own deny list, `claude-code-contract.md` § Hooks):
no track edits the code another is reading. Both scripts also deny `Agent`, to review and audit
tracks alike. A child agent is a launch of its own, outside the deny list the script set, so it
could edit the shared checkout; and its completion notice would reach a review track as a later
prompt, so the review record would record nothing. A finding its refuter leaves `unproven`, or that gets no answer, is neither
proved nor refuted: it is listed under **Hunches** with the refuter's reason, its trigger and its
fix (the audit's writer gets the trigger and the missing guard), never only counted; with no
finding confirmed, the headline points to the Hunches. A refuted one is counted and left out.
The reviewers carry `cc-smart-dev-kit:senior-engineer`, the type `reviewAgents` lists by default,
and each track's brief holds the line `Mode: review` alone and asks for the StructuredOutput
call, so the run's return records the review for the merge guard (Claude Code's nudge to make
that call, `[structured-output-enforce] …`, matched as its whole text, is no new prompt:
`src/hooks/transcript.ts`); a
refuter's brief has no marker, because it checks one finding, not the whole change
(`src/workflows/review-split.test.ts` fails when either link breaks). Claude Code loads a
plugin's `workflows/` folder as `<plugin>:<meta.name>`, and the agent guard judges every
`agent(...)` launch in the script before the run starts (§ The agent guard); so every launch
names a literal `model`, `effort` and `agentType`, and `src/workflows/scripts.test.ts` runs each
shipped script against fakes and checks the guard the plugin ships allows every launch. Biome
skips `plugin/workflows`: a script body has a top-level `return`, which the linter's parser
refuses.

*The arguments and the budget (1.3.0).* The Workflow tool hands `args` to the script verbatim,
so a caller that passes the text of an object gets a string. Both scripts refuse that at the
start: a string, `null`, an array, an unknown key or a wrong type throws one line that names the
problem and the expected object, before any agent starts; no `args` at all still runs on the
defaults, for a person starting the workflow by hand. Both scripts rank the distinct findings by
severity (the order of the final list), then by track, and the budget refutes the first
`budget` of them, so a busy track of lesser findings cannot take every refuter and starve a
critical finding of the last one (equal severities still go in track order). A finding past the budget is never dropped: `review-split` returns it in an
**Unchecked** section (severity, title, file and line), `audit-run` hands the same lines to the
writer for an **Unchecked findings** section, and each run's log and summary line say how many
were checked and how many were not. The two scripts carry the same argument check and the same
ranking, each in its own file: Claude Code documents a workflow script as a plain function body
with no filesystem or Node API and no import, and the only reuse it names is `workflow()`, which
runs a whole script as a step and returns its result, not a helper (read from the Workflow
tool's own description, not proved by a live run). A shared piece would be a third script that
runs agents, so the two stay self-contained (the checks are code, which `check:duplicates`,
reading sentences, does not flag).

The third, `plugin/workflows/research-sweep.js`, is the run the `research-first` skill starts for a question
with several sources (D28's third): one read-only `researcher` per angle on `sonnet` at `high`,
then one `researcher` per claim on `opus` at `high` that opens the cited source and confirms or
refutes the claim with the quote. The researchers run at `high`, like the audit's auditors, and
their brief says the schema replaces the researcher's usual report. The refuters are the
judgment, so they take the premium tier, which runs at `high` with no question.
The decisive claims are checked first, taken in turn from each angle so one angle cannot use the
whole `budget` (1 to 40), which cuts the rest, and the cut claims come back
as `unchecked`, never dropped; so do a claim a refuter could not settle (`unproven`) and an angle
that returned no report (an open question). The script needs its argument object (a research
question has no default), so a string, a missing field or an unknown field is refused before any
agent starts.

**Agents pin no model and no effort.** The caller passes both on each launch, so an agent
never runs on a model nobody chose. Plugin agents and skills are named `cc-smart-dev-kit:<name>`.
An agent that works by a skill loads it with `skills:` in its frontmatter: the skill's text is
in its context from the start (proved live: `claude-code-contract.md` § Instructions). Every
agent but the `researcher` loads `cc-smart-dev-kit:impact-analysis`, the one home for finding a
symbol's callers and a file's shape (the researcher only reads the project's versions, types and
docs, and the skill would be about two and a half times its own text on every launch, up to
eight per research sweep); `rules-maintainer` also loads `cc-smart-dev-kit:self-evolve`, and `builder` also
loads `cc-smart-dev-kit:verify-change`, the one home of which checks run when. The
`senior-engineer` does not load the review skill: half of it is the author's (commit, fix, start
the second opinion), which contradicts a reviewer that writes its findings before it touches anything.
It reads the review dimensions, edge-case axes and severity scale from
`skills/review/references/axes.md` instead, found from the base directory Claude Code prints
above each loaded skill (the plugin's folder has the version in its name, so no fixed path
reaches it). `auditor`, `edge-case-hunter` and `ui-verifier` read the same axes file the same
way. No agent has `memory:` (only the main session saves memories). No agent starts agents,
except the senior engineer in a consult, which may start read-only research agents: the
`researcher` for a question outside the repo, `Explore` for a search inside it. Its two review
modes start none (above). A plan's second read carries
`Mode: plan-review`, not `Mode: review`: the hook matches `Mode: review` as the whole line, so a
plan read records nothing, and no plan read can cover code the merge guard later checks.

`researcher` (2.2.0) is the read-only R&D agent: one question, answered from current primary
sources (docs, changelogs, release notes, source code, specs), each claim cited with its URL and
marked confirmed or not. Before it, the research sweep borrowed the auditor, whose job is defects
in code, and only the senior engineer researched the web. Its § How to research is the one home
of the method for agents; the senior engineer points to it, and the lead's own method stays in
`research-first`.

**The tools each agent has: every tool of the session, less a short deny list** (the owner,
2026-10-27). An agent file names no `tools:`, so the agent inherits the session's whole set, its
MCP servers too: a project's database server for a reviewer that checks the dev data, the browser
for a builder. Each file's `disallowedTools` takes out only what its role forbids. A fixed list
(1.1.0 to 1.4.x) cut every project's own servers out of every agent.

| Agent | Denied | Why |
|---|---|---|
| `senior-engineer` | nothing | it reviews, and a consult may fix or build; its text keeps a review's findings ahead of any fix (the owner, 2.2.0) |
| `auditor` | Edit, Write, NotebookEdit, AskUserQuestion | a read-only sweep; only the main session asks the person |
| `edge-case-hunter` | Edit, Write, NotebookEdit, AskUserQuestion | it lists the scenarios; the author designs the fix |
| `researcher` | Edit, Write, NotebookEdit, AskUserQuestion | it reports sources and claims; it changes nothing |
| `ui-verifier` | Edit, Write, NotebookEdit, AskUserQuestion | facts only, no fix |
| `builder` | AskUserQuestion, Agent | builds code; an open question goes back in its hand-back, and it starts no agents |
| `rules-maintainer` | AskUserQuestion | the same as the builder's first reason |

The list names only tools every session has. In a Workflow run, an entry that matches no tool
in the session only logs a warning, and a deny list that took out the structured-output tool
would refuse every `agent()` with a schema; so no list names an MCP tool or that one. A tool an
agent must not use and a deny list cannot name is said in its text.

`smart_search`, `smart_outline` and `smart_unfold` are the companion plugin's own tool names,
for a file's shape without reading all of it; when they are not there or do not answer (on
Windows they can fail without an error, claude-mem #1247), the agent uses Grep and Read.
`LSP` answers only where a code intelligence plugin runs a language server for the file; with
none, each call returns an error and the agent searches as text. The Playwright tools keep
their usual names (`mcp__playwright__*`): the server is registered for the user (§ MCP servers
at user scope).

**The Grep and Glob trade-off (for the owner).** On macOS, Linux and WSL, Claude Code leaves
the Grep and Glob tools out of a session, and out of an agent that also has `Bash`; it gives
them back only to an agent that lists them without `Bash` (code.claude.com/docs/en/tools-reference
§ Glob tool behavior, read 2026-10-22). Every agent inherits the session's set, `Bash` in it, so
there every agent searches with `grep` and `find` through Bash — Claude Code's shell runs fast
built-in versions of both. The cost: each search is a Bash call, so it reaches the Bash hooks
(claude-mem's file-context hook, the plugin's guards) and the Bash permission rules, and its
output is plain text rather than the tools' structured results. On Windows Grep and Glob are in
the default set and the agents use them. The `cc-smart-dev-kit:impact-analysis` skill says what
to use when they are missing.

**The output style** ships but is never switched on: a person picks it with `/output-style`.


## Building a plan in 2.0

`build` runs the subagent-driven workflow. The main session orchestrates one builder per
phase, parallel worktrees for disjoint files, a fresh senior engineer for each phase's review and
a final review on `opus` at `xhigh`. Each review brief carries the line `Mode: review` alone on
its line; the review-record hook records a review only with it, so a consult of the same agent
records nothing. Agents run in the background (Claude Code's default), `Monitor` watches CI and
logs, and the lead waits only for what the next step needs. `blocked_by` marks only a real
dependency or a shared file; noted work is `non-blocking`. The task system holds briefs, reports
and rulings; see [tasks](tasks.md).

The kit's plan, build, review and commit flows govern the work the kit drives. claude-mem
also ships `build`, `do`, `release`, `version-bump` and `build-and-release` skills, and some of
them push, merge or commit everything without asking; so `build` says they run only when the
person asks for one, and the project's workflow settings still decide what is committed, pushed
or merged.

**Plans live in the project, one at a time (4.0).** Setup sets Claude Code's `plansDirectory`
to `.claude/plans` at user scope ([setup](setup.md)), so plan mode writes the plan file into the
project instead of `~/.claude/plans`. `plan-task` commits it with its branch after the yes (in a
worktree, on that worktree's branch) and moves it to `archive/` when the plan finishes. A
session may run several plans one after another: `core.md`'s "One plan at a time" forbids side
work, not a second plan. `plan-task` gives each plan its own plan task, and the session names
the slug with `plan` on `task_list` and on each work-task `task_create`, never on a project
task, which refuses it. Without `plan`, the two tools fall back differently: `task_create`
takes the plan of the caller's latest own task that has one, and `task_list` with `scope: "plan"` shows every plan the
session owns when it owns more than one. `build` also takes over a crashed or handed-over session's plan with
`task_take` ([tasks](tasks.md)): a dead claim moves at once, a live one only with `force` after
the person confirms that session is gone, and each open phase gets a fresh builder on its
recorded branch, because the old session's builders cannot be resumed.

`plan-task` starts two agents in one message for a big or risky plan: the edge-case hunter,
which lists every scenario that can break it, and the senior engineer's second read on `opus`
at `xhigh`, whose brief carries `Mode: plan-review`, so it records no review.
