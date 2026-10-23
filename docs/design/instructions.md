# Instructions, skills and agents


The plugin carries general working instructions for Claude, 19 skills, 5 agents and two
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

**Two state files sit beside the copy** (`src/setup/instructions.ts`), in the state folder:

- `no-instructions`: the person's `--no-instructions`. While it is there, a plain `setup`
  keeps the instructions out; `--instructions` removes it; `restore` removes it too (a setup
  after a restore starts fresh). Why stored: a choice that a plain `setup` (run after every
  update) quietly undid would be no choice.
- `instructions-version`: the plugin version that last wrote the copy.
  `instructionsNeedRefresh(paths, version)` is true for an installed copy, not opted out,
  whose stamp names another version. `doctor` uses it (and compares each file with the
  plugin's). `refreshInstructionsCopy(paths, version)` brings only the copy up to that
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
owner's D12).

**The shipped Workflows.** `plugin/workflows/audit-run.js` is the run the `audit` skill starts:
one read-only `auditor` per track on `sonnet` at `max`, a second auditor on `opus` at `xhigh` to
refute every finding (the judgment, D46), one `builder` on `sonnet` at `max` to write the
findings file. `plugin/workflows/review-split.js` is the second opinion the `review` skill takes
on a big change set instead of its single reviewer: one read-only `reviewer` per track, a second
one to refute every finding, and the verified findings merged and ranked. Its launches follow
D46's tier for the change set the caller names with `risky` — `opus` at `xhigh` for a risky one,
`sonnet` at `max` otherwise — and the refuters run on that same tier, because they make the
review's judgment; the audit's verifier is `opus` because the auditors are only the breadth.
Because a literal cannot depend on the change set, the script writes both fixed launch sets and
the caller picks one: a second script would repeat every prompt, which `check:duplicates` fails.
`sonnet` at `max` is the one ordinary-tier literal an affordable worker slot also allows (its
effort must be `max`), so on Claude it runs above the `high` the core instructions give a
review. The reviewers carry `cc-smart-dev-kit:reviewer`, the type `reviewAgents`
lists by default, so the run's return records the review for the merge guard
(`src/workflows/review-split.test.ts` fails when that link breaks). Claude Code loads a
plugin's `workflows/` folder as `<plugin>:<meta.name>`, and the agent guard judges every
`agent(...)` launch in the script before the run starts (§ The agent guard); so every launch
names a literal `model`, `effort` and `agentType`, and `src/workflows/scripts.test.ts` runs each
shipped script against fakes and checks the guard the plugin ships allows every launch. Biome
skips `plugin/workflows`: a script body has a top-level `return`, which the linter's parser
refuses.

**Agents pin no model and no effort.** The caller passes both on each launch, so an agent
never runs on a model nobody chose. Plugin agents and skills are named `cc-smart-dev-kit:<name>`.
An agent that works by a skill loads it with `skills:` in its frontmatter: the skill's text is
in its context from the start (proved live: `claude-code-contract.md` § Instructions). All
five load `cc-smart-dev-kit:impact-analysis`, the one home for finding a symbol's callers and a
file's shape; `rules-maintainer` also loads `cc-smart-dev-kit:self-evolve`. The `reviewer` does not
load the review skill: half of it is the author's (commit, fix, start the reviewer), which
contradicts a read-only agent. It reads the review dimensions, edge-case axes and severity
scale from `skills/review/references/axes.md` instead, found from the base directory Claude
Code prints above each loaded skill (the plugin's folder has the version in its name, so no
fixed path reaches it). `auditor` reads the same axes file the same way. No agent has `memory:`
(only the main session saves memories) or `Agent` (an agent starts no agents).

**The tools each agent lists**, and why (research for the 1.1.0 plan, § R7):

| Agent | Tools | Why |
|---|---|---|
| `reviewer` | Read, Grep, Glob, Bash, LSP, WebSearch, WebFetch, claude-mem's `smart_*` | Bash for `git diff` and the unit tests; no edit tools |
| `rules-maintainer` | Read, Edit, Write, Grep, Glob, Bash, LSP, `smart_*` | Bash for `wc -l` and `git status` |
| `ui-verifier` | Read, Grep, Glob, LSP, `smart_*`, the `mcp__playwright__*` tools | no Bash: it runs no command, only the browser |
| `auditor` | Read, Grep, Glob, Bash, LSP, WebSearch, WebFetch, `smart_*` | a read-only sweep: Bash for `git log` and the tests, no edit tools |
| `builder` | Read, Edit, Write, Grep, Glob, Bash, LSP, `smart_*` | builds code: edit tools, and Bash for its done-check |

`smart_search`, `smart_outline` and `smart_unfold` are the companion plugin's own tool names,
for a file's shape without reading all of it; when they are not there or do not answer (on
Windows they can fail without an error, claude-mem #1247), the agent uses Grep and Read.
`LSP` answers only where a code intelligence plugin runs a language server for the file; with
none, each call returns an error and the agent searches as text. The Playwright tools keep
their usual names (`mcp__playwright__*`): the server is registered for the user (§ MCP servers
at user scope).

**The Grep and Glob trade-off (for the owner).** On macOS, Linux and WSL, Claude Code leaves
the Grep and Glob tools out of a session, and out of an agent that also lists `Bash`; it gives
them back to an agent that lists them without `Bash` (code.claude.com/docs/en/tools-reference
§ Glob tool behavior, read 2026-10-22). So `reviewer` and `rules-maintainer` search with
`grep` and `find` through Bash there — Claude Code's shell runs fast built-in versions of both
— and only `ui-verifier` gets the real tools. The cost: each search is a Bash call, so it
reaches the Bash hooks (claude-mem's file-context hook, the plugin's guards) and the Bash
permission rules, and its output is plain text rather than the tools' structured results.
Dropping `Bash` would bring the tools back, but the reviewer could no longer read `git diff`
or run a test, and the rules maintainer could no longer count lines or check `git status`.
Both keep `Bash`; Grep and Glob stay listed, because on Windows they are in the default set
and the agents use them. The `cc-smart-dev-kit:impact-analysis` skill says what to use when they
are missing.

**The output style** ships but is never switched on: a person picks it with `/output-style`.
