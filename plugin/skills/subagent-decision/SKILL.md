---
name: subagent-decision
description: Use when about to read more than three files, run multi-step research, search or audit the codebase, verify UI, or split work for agents. Picks the agent for each job - Explore, Plan, general-purpose, the anymodel reviewer, code-explorer, ui-verifier, rules-maintainer, or yourself - and says how to brief it, especially a cheap model. Trigger phrases - "find where", "search the codebase", "audit", "look into", "split this up", "delegate".
---

# Which Agent, And How To Brief It

**Project add-on:** `.claude/anymodel/subagent-decision.md` — read it first when it exists.
Where it differs, the add-on wins (`core.md`, top). A project with its own agents lists them
there.

A subagent runs in its own context window; only its final report comes back. Every file it
reads, every search and every dead end stays out of yours. If the task can be written as a
self-contained brief, delegate it. What stays with you, and which model and effort each agent
gets, are in the core instructions (§ Subagents).

## Which agent

| Task | Agent |
|---|---|
| Symbol questions — callers, references, definitions, rename impact — across many files | `anymodel:code-explorer` (needs the Serena MCP server); one lookup: the language-server tool yourself |
| Text-shaped searches — strings, comments, TODOs, "every file that mentions X" | `Explore` (built-in, read-only); say how thorough |
| A plan for non-trivial work | `Plan` (built-in, read-only); it returns the text, you write the file |
| A phase of a plan; any job that both explores and edits | `general-purpose` |
| The second opinion on a change set, or a second read of a big plan | `anymodel:reviewer` (read-only) — `/anymodel:review` § Second opinion |
| Driving the running app in a browser | `anymodel:ui-verifier` (needs the Playwright MCP server) — `/anymodel:ui-verify` |
| Edits to instruction files: rules, skills, agents, `CLAUDE.md` | `anymodel:rules-maintainer` |
| Questions about Claude Code, the Agent SDK or the API | `claude-code-guide` (built-in) |

Review is your own job first: an agent is a second reader, never a substitute for your pass.

## How to brief

A subagent has none of your conversation. Treat it as a smart colleague who just walked in:

- **The goal and why it matters**, and whether you want research or code.
- **Exact paths, symbols and test cases.**
- **Its files:** a write-capable agent gets the exact list it may change, and "change nothing
  else". Check `git status --short` when it returns.
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
- Independent agents start in one message, with several calls.

### Briefing a cheap model

A cheap slot (`haiku`, `sonnet` while the gateway is on) reasons less than Claude, so carry
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
- **Its limits in words** — a cheap model follows written limits less reliably than Claude.
- Two failed tries at the same job → hand it to `opus`; never a third cheap try.

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
