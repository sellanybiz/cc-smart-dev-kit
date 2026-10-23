---
name: subagent-decision
description: Use when a job means reading across many files, multi-step research, a codebase search or audit, a UI check, or work to split between agents - not one a handful of tool calls finish. Picks the agent for each job - Explore, Plan, general-purpose, the cc-smart-dev-kit builder, auditor, reviewer, ui-verifier, rules-maintainer, or yourself - and says how to brief it, especially an affordable model. Trigger phrases - "find where", "search the codebase", "audit", "look into", "split this up", "delegate".
---

# Which Agent, And How To Brief It

**Project add-on:** `.claude/cc-smart-dev-kit/subagent-decision.md` — read it first when it exists.
Where it differs, the add-on wins (`core.md`, top). A project with its own agents lists them
there.

A subagent runs in its own context window; only its final report comes back. Every file it
reads, every search and every dead end stays out of yours. Delegate a job whose reading would
flood your context and that a self-contained brief can carry; a job a handful of tool calls
finish is yours. What stays with you is in the core instructions (§ Lead the work); which model
and effort each agent gets is their model table, and § Model and effort below.

## Which agent

| Task | Agent |
|---|---|
| Symbol questions — callers, references, definitions, rename impact — across many files | `Explore` (built-in, read-only), with the exact names and "every hit"; one lookup: `Grep` for the name as a whole word (`\bname\b`) yourself, then `Read` |
| A file's or a module's structure — its functions, exports, outline | yourself: claude-mem's `smart_outline` for one file, `smart_search` across the repo, `smart_unfold` for one symbol's body; when they are not there or do not answer, `Grep` and `Read` |
| Text-shaped searches — strings, comments, TODOs, "every file that mentions X" | `Explore` (built-in, read-only); say how thorough |
| A plan for non-trivial work | `Plan` (built-in, read-only); it returns the text, you write the file |
| A whole phase of a plan, where the project has crew sessions on | a crew session, not a subagent — `/cc-smart-dev-kit:lead` |
| A phase the plan already briefed — its files, the pattern to copy and a done-check written down — with crew sessions off | `cc-smart-dev-kit:builder` |
| A piece of a phase, or a job whose scope is still open that both explores and edits | `general-purpose` |
| An area swept for one class of defect, not a diff — "audit the hooks", "find every place where X" | the `audit` skill's run: an `auditor` per track, a second one to refute each finding, one `builder` for the report — `/cc-smart-dev-kit:audit` |
| The second opinion on a change set, or a second read of a big plan | `cc-smart-dev-kit:reviewer` (read-only) — `/cc-smart-dev-kit:review` § Second opinion |
| Driving the running app in a browser | `cc-smart-dev-kit:ui-verifier` (needs the Playwright MCP server) — `/cc-smart-dev-kit:ui-verify`: the facts on `sonnet`, the design verdict on `opus` or `fable` |
| Edits to instruction files: rules, skills, agents, `CLAUDE.md` | `cc-smart-dev-kit:rules-maintainer` |
| Questions about Claude Code, the Agent SDK or the API | `claude-code-guide` (built-in) |

Review is your own job first: an agent is a second reader, never a substitute for your pass.

## How to brief

A subagent has none of your conversation, and an under-briefed agent costs more than doing the
work yourself. Treat it as a smart colleague who just walked in:

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
- **Its limits:** no commit, no push, no new agents, no messages to other sessions, no
  questions to the person — unless the brief says so. "Your final message is your report."
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

An affordable slot (`haiku`, `sonnet` while the gateway is on) reasons less than Claude, so carry
the judgment for it in the brief:

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
- Two failed tries at the same job → hand it to `opus`; never a third affordable try.

## Model and effort

The core instructions' model table says which model fits which job; this is the rest of it.

- **Every launch names both** — an `Agent` call, and each `agent()` in a Workflow. An agent
  given neither runs on the session's model and effort: on an Opus session, a plain `Explore` is
  an Opus launch. Never put `model:` or `effort:` in an agent's frontmatter: it binds every
  caller, and it goes stale without anyone seeing it.
- **`opus` and `fable` name the tier**, whatever model answers it: with the gateway on, a slot
  may send a family to another model (`/cc-smart-dev-kit:gateway`).
- **Effort by the job:** `medium` for searches and reads; `high` for building, UI/UX design
  included, and for reviews; `xhigh` for the hardest judgment — a tangled bug, an architecture
  choice, a high-stakes review, a hard design — which you may pick yourself; `max` only when the
  person asks for it. An affordable gateway slot runs at `max`: its reasoning costs cents.
- **Opus builds** architecture and UI/UX, at `high` or `xhigh`; every other build runs on
  `sonnet`.
- **A fork** runs on the session's own model, at the effort you pass, or else the session's.
- **Saying it when you launch** (the core instructions): a fork names the session's model; a
  Workflow names each `agent()`'s; a subagent that starts agents names them in its report.

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
  design, a plan, a review or a fix for you or a crew session to build.
- **Fable builds only when the person asks for that build** — an agent that can change files,
  and a fork of a Fable session, which runs on Fable too. Any other build goes to `sonnet`, or to
  `opus` for architecture and UI/UX.

**A fresh attempt's brief** carries: the task; your answer, or the files you changed; what the
person disliked, in their words; and what it returns — a design, a plan or a fix for you or a
crew session to build, never a build of its own.

## While agents run

- **Never switch or remove the folder an agent was launched from while it runs.** An agent's
  shell stays in the session's folder: move the session into another worktree, or remove the
  worktree, and the agent's every command fails ("working directory no longer exists", or a
  guard's refusal) and its work is lost. Wait for every agent you started from a folder before
  you leave it or remove it.
- **Check each hand-back yourself** before you build on it: its diff, its tests, its claims.

## Do not

- Read ten files yourself when one `Explore` call would do it.
- Start an agent for a one-line fix, or a reviewer for a small fix.
- Write one-sentence briefs — they produce shallow work.
- Delegate a search, then repeat it yourself.
