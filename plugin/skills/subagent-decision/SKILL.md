---
name: subagent-decision
description: Use when about to read many files, run multi-step research, search or audit the codebase, verify UI, or split work for agents. Picks the agent for each job - Explore, Plan, general-purpose, the cc-smart-dev-kit builder, auditor, reviewer, ui-verifier, rules-maintainer, or yourself - and says how to brief it, especially an affordable model. Trigger phrases - "find where", "search the codebase", "audit", "look into", "split this up", "delegate".
---

# Which Agent, And How To Brief It

**Project add-on:** `.claude/cc-smart-dev-kit/subagent-decision.md` — read it first when it exists.
Where it differs, the add-on wins (`core.md`, top). A project with its own agents lists them
there.

A subagent runs in its own context window; only its final report comes back. Every file it
reads, every search and every dead end stays out of yours. Delegate a job whose reading would
flood your context and that a self-contained brief can carry; a job a handful of tool calls
finish is yours. What stays with you is in the core instructions (§ Drive the work). Which model
and effort each agent gets is in the core instructions' model table and in § Model and effort
below.

## Which agent

| Task | Agent |
|---|---|
| Symbol questions — callers, references, definitions, rename impact — across many files | `Explore` (built-in, read-only), with the exact names and "every hit"; one lookup: `Grep` for the name as a whole word (`\bname\b`) yourself, then `Read` |
| A file's or a module's structure — its functions, exports, outline | yourself: claude-mem's `smart_outline` for one file, `smart_search` across the repo, `smart_unfold` for one symbol's body; when they are not there or do not answer, `Grep` and `Read` |
| Text-shaped searches — strings, comments, TODOs, "every file that mentions X" | `Explore` (built-in, read-only); say how thorough |
| A plan for non-trivial work | `Plan` (built-in, read-only); it returns the text, you write the file |
| A phase with a task brief and done-check | `cc-smart-dev-kit:builder`, or `rules-maintainer` for instruction files; execute through `/cc-smart-dev-kit:build` |
| A piece of a phase, or a job whose scope is still open that both explores and edits | `general-purpose` |
| An area swept for one class of defect, not a diff — "audit the hooks", "find every place where X" | the `audit` skill's run: an `auditor` per track, a second one to refute each finding, one `builder` for the report — `/cc-smart-dev-kit:audit` |
| The second opinion on a change set, or a second read of a big plan | `cc-smart-dev-kit:reviewer` (read-only) — `/cc-smart-dev-kit:review` § Second opinion |
| Driving the running app in a browser | `cc-smart-dev-kit:ui-verifier` (needs the Playwright MCP server) — `/cc-smart-dev-kit:ui-verify`: the facts on `sonnet`, the design verdict on `opus` or `fable` |
| Edits to instruction files: rules, skills, agents, `CLAUDE.md` | `cc-smart-dev-kit:rules-maintainer` |
| Questions about Claude Code, the Agent SDK or the API | `claude-code-guide` (built-in) |

The main session owns review. A builder never reviews its own work or starts a reviewer.

For an approved plan the main session is the orchestrator and all workers are subagents.
The build skill owns the dispatch size and session cap. A fresh reviewer matters because
it has not seen the builder's reasoning; delegation alone does not improve an answer.

## How to brief

A subagent has none of your conversation, and an under-briefed agent costs more than doing the
work yourself. Every brief has four parts: objective; files and boundaries; patterns/tools;
output format (`Report:` task note plus short status for a phase). Put the caller's rulings
first: commit or not, allowed checks, rephrase a refused read-only command once, and decide
small calls with a `Ruling:` note. Treat the agent as a smart colleague who just walked in:

- **The goal and why it matters**, and whether you want research or code.
- **Exact paths, symbols and test cases.**
- **Its files:** a write-capable agent gets the exact list it may change, and "change nothing
  else". Check `git status --short` when it returns.
- **A builder that needs its own checkout gets one:** launch it with `isolation: "worktree"`
  and merge its branch back when it hands over. A session that entered a worktree writes
  only inside it, and its agents inherit that limit, so never brief one with a path in a
  different worktree.
- **It deletes only files it created.** Never let it clean a shared folder (a scratch
  folder, an output folder, a temp folder another agent uses) — one agent that did removed
  the session's own scripts.
- **Its limits:** commit only on its worktree branch if the brief allows it. No push, new
  agents, self-review, peer messages or questions to the person. Give a phase task number:
  `task_get` reads the brief; `task_note` holds the report.
- **Nothing of its own still runs when it reports:** the brief tells it to wait for every
  background command and agent it started, or to stop it, before the final message. One that
  hands back early is blocked once and told to wait or stop it — and Claude Code keeps such an
  agent open until the work lands.
- **When it is blocked, it reports and stops.** It never retries in a loop, never works
  around a guard, a hook or a permission refusal, and never widens its scope.
- **A dense report:** findings with `file:line` evidence and the commands it actually ran. No
  restating the brief, no pasted code you can read yourself.
- `Explore` and `Plan` load no `CLAUDE.md`: restate every constraint they must respect.
- **Parallel by default:** independent research, reviews of different change sets and
  builders run at once. Independent agents start in one message, with several calls. One
  thing runs alone: a browser check (`/cc-smart-dev-kit:ui-verify` § 2).

### Briefing an affordable model

An affordable tier is one the session-start note says a backend answers (a `haiku` or `sonnet`
request goes to a gateway model, not to Claude). It reasons less than Claude, so carry the
judgment for it in the brief; a tier the note says is Claude needs none of this:

- **One job, small scope.** A big phase becomes two or three agents, each with one clear
  outcome — never "figure out the codebase".
- **The decisions, not the question:** the approach, the exact files to read and change, the
  pattern to copy (`file:line`), the names to use, the edge cases to handle.
- **The rules that bite here, quoted** — the ones its files touch, not "follow the repo
  rules".
- **A done-check it can run**, and the evidence to report: what it ran and what it saw.
- **A UI check:** the named key screenshots it saved and the measured value per check —
  never a design verdict.
- **Its limits in words** — an affordable model follows written limits less reliably than Claude.
- A stuck build uses the fix-round limit and escalation in `/cc-smart-dev-kit:build`.

## Model and effort

The core instructions' model table says which model fits which job; this is the rest of it.

- **Every launch names both** — an `Agent` call, and each `agent()` in a Workflow. An agent
  given neither runs on the session's model and effort: on an Opus session, a plain `Explore` is
  an Opus launch. Never put `model:` or `effort:` in an agent's frontmatter: it binds every
  caller, and it goes stale without anyone seeing it.
- **`opus` and `fable` name the tier**, whatever model answers it: with the gateway on, a slot
  may send a family to another model (`/cc-smart-dev-kit:gateway`).
- **Effort by the job:** `medium` for searches and reads; `high` for building, UI/UX design
  included, for reviews and for a UI check; `xhigh` for the hardest judgment — a tangled bug, an
  architecture choice, a high-stakes review, a hard design — which you may pick yourself. `max`:
  a `haiku` or `sonnet` task may take it when it wants it, with no restriction; `opus` at `max`
  asks the person. The session's own effort is the person's choice.
- **Opus builds** architecture and UI/UX, at `high` or `xhigh`; other builds start on
  `sonnet`, with escalation through the build skill.
- **A fork** runs on the session's own model, at the effort you pass, or else the session's.
- **Saying it when you launch** (the core instructions): a fork names the session's model; a
  Workflow names each `agent()`'s; builders never start more agents.

## UI/UX work

Design judgment, layout, components, pages and styling run only on `opus` or `fable`, at `high`
or above — never on an affordable model (the core instructions' model table). The one exception
is checking, which is not design: the `ui-verifier` may run on `sonnet` and brings back measured
facts and screenshots, and you make the design verdict on `opus` or `fable`
(`/cc-smart-dev-kit:ui-verify`).

## Choosing Fable

`fable` is the premium advisor (the core instructions' model table): the hardest long-horizon
work, hard architecture, a rewrite or a complex UI/UX design, a strong second-opinion review,
refining a plan — and a fresh attempt when the person is not satisfied with your answer.

- **Advice runs on a read-only agent** (Plan, a reviewer, Explore, an auditor). It returns a
  design, a plan, a review or a fix for a builder to build.
- **Fable builds only when the person asks for that build** — an agent that can change files,
  and a fork of a Fable session, which runs on Fable too. Any other build goes to `sonnet`, or to
  `opus` for architecture and UI/UX.

**A fresh attempt's brief** carries: the task; your answer, or the files you changed; what the
person disliked, in their words; and what it returns — a design, a plan or a fix for a
builder to implement, never a build of its own.

## While agents run

- **Never switch or remove the folder an agent was launched from while it runs.** An agent's
  shell stays in the session's folder: move the session into another worktree, or remove the
  worktree, and the agent's every command fails ("working directory no longer exists", or a
  guard's refusal) and its work is lost. Wait for every agent you started from a folder before
  you leave it or remove it.
- **Check each hand-back yourself** before you build on it: its diff, its tests, its claims.
  The full check (`/cc-smart-dev-kit:verify-change` § 4) is yours, once, after every agent you
  started has handed back; a brief asks an agent for the checks on its own files only.

## Do not

- Read ten files yourself when one `Explore` call would do it.
- Split a small fix across several builders, or skip a planned phase's task review.
- Write one-sentence briefs — they produce shallow work.
- Delegate a search, then repeat it yourself.
