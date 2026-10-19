---
name: subagent-decision
description: Use when about to read more than three files, run multi-step research, search or audit the codebase, verify UI, or split work for agents. Picks the agent for each job - Explore, Plan, general-purpose, the cc-smart-dev-kit reviewer, ui-verifier, rules-maintainer, or yourself - and says how to brief it, especially an affordable model. Trigger phrases - "find where", "search the codebase", "audit", "look into", "split this up", "delegate".
---

# Which Agent, And How To Brief It

**Project add-on:** `.claude/cc-smart-dev-kit/subagent-decision.md` — read it first when it exists.
Where it differs, the add-on wins (`core.md`, top). A project with its own agents lists them
there.

A subagent runs in its own context window; only its final report comes back. Every file it
reads, every search and every dead end stays out of yours. If the task can be written as a
self-contained brief, delegate it. What stays with you, and which model and effort each agent
gets, are in the core instructions (§ Subagents).

## Which agent

| Task | Agent |
|---|---|
| Symbol questions — callers, references, definitions, rename impact — across many files | `Explore` (built-in, read-only), with the exact names and "every hit"; one lookup: `Grep` for the name as a whole word (`\bname\b`) yourself, then `Read` |
| A file's or a module's structure — its functions, exports, outline | yourself: claude-mem's `smart_outline` for one file, `smart_search` across the repo, `smart_unfold` for one symbol's body |
| Text-shaped searches — strings, comments, TODOs, "every file that mentions X" | `Explore` (built-in, read-only); say how thorough |
| A plan for non-trivial work | `Plan` (built-in, read-only); it returns the text, you write the file |
| A phase of a plan; any job that both explores and edits | `general-purpose` |
| The second opinion on a change set, or a second read of a big plan | `cc-smart-dev-kit:reviewer` (read-only) — `/cc-smart-dev-kit:review` § Second opinion |
| Driving the running app in a browser | `cc-smart-dev-kit:ui-verifier` (needs the Playwright MCP server) — `/cc-smart-dev-kit:ui-verify` |
| Edits to instruction files: rules, skills, agents, `CLAUDE.md` | `cc-smart-dev-kit:rules-maintainer` |
| Questions about Claude Code, the Agent SDK or the API | `claude-code-guide` (built-in) |

Review is your own job first: an agent is a second reader, never a substitute for your pass.

## How to brief

A subagent has none of your conversation. Treat it as a smart colleague who just walked in:

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

## Choosing Fable

`fable` is the premium advisor (the core instructions' model table): the hardest long-horizon
work, hard architecture, a rewrite or a complex UI/UX design, a strong second-opinion review,
refining a plan — and a fresh attempt when the person is not satisfied with your answer. The
guard asks the person about every Fable launch.

- **Read-only agents** (Plan, Reviewer, Explore) take an advisory word:
  `Fable reason: <hard|rewrite|ui-design|architecture|review|plan|unsatisfied> - <why>`.
  `unsatisfied` is the fresh attempt: something you answered did not land.
- **An agent that can change files** — a builder, or a fork — needs the one word `build`, which
  only the person can mean: `Fable reason: build - <what the person asked>`. `build` on a
  read-only agent is refused, like every other word on a builder.
- **A fork of a Fable session** runs on the session's own model, so it is a builder: name the
  word `build`, and the person approves that one.

**A fresh attempt's brief** (`unsatisfied`) carries: the task; your answer, or the files you
changed; what the person disliked, in their words; and what it returns — a design, a plan or a
fix for you or a worker to build, never a build of its own.

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
