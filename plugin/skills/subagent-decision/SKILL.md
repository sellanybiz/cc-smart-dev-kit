---
name: subagent-decision
description: Use when deciding whether to delegate, which agent fits, which model and effort it gets, or how to brief it - a search across many files, research, an audit, a review, a UI check, splitting work. Trigger phrases - "find where", "search the codebase", "look into", "split this up", "delegate", "which model".
---

# Which Agent, Which Model, And How To Brief It

**Project add-on:** `.claude/cc-smart-dev-kit/subagent-decision.md` — read it first when it exists.
Where it differs, the add-on wins (`core.md`, top). A project with its own agents lists them
there.

A subagent runs in its own context window; only its final report comes back. Every file it
reads, every search and every dead end stays out of yours. It also spends its own tokens and
starts with none of your cache, so it pays only for work that would flood your context and that
a self-contained brief can carry. The core instructions hold the short form (§ Subagents); this
is the full policy.

## The lead's judgment

Model and effort come from your judgment of the job, not from a lookup table. For each launch,
weigh three things:

- **How hard is it?** Can a careful person do it straight through, or does it need deep reasoning?
- **What does a miss cost?** Cheap and caught later, or it ships, loses data, opens a hole, or
  wastes a whole build?
- **Is this the last check before it is too late?** A plan's second opinion and the final review
  guard everything after them, so they earn more effort than a step a later review still covers.

Spend effort where those are high and save it everywhere else. `high` gives most of the gain;
`xhigh` and `max` cost two to three times more again for a few points, and `max` can overthink
and score lower. The lead session itself works best on Claude Opus at `high`. The backend behind
a slot never changes the choice: judge the job, name the tier it needs, and brief it fully.

Worked examples — judge new cases the same way:

| Situation | Agent, slot, effort |
|---|---|
| Find files, read a module, a symbol's callers | `Explore`, `haiku`, `medium` |
| A library or API question, or other research with a clear question | researcher, `sonnet`, `high` |
| Ambiguous, hard or high-stakes research (an architecture choice, a security claim) | researcher, `opus`, `high`; `xhigh` when a decision rests on it alone |
| Mechanical edits, a doc update, run the tests | builder, `sonnet`, `medium` |
| Build a normal phase | builder, `sonnet`, `high` |
| UI/UX design, an architecture build | builder, `opus`, `high` (`xhigh` when hard) |
| Ordinary phase review | senior engineer, `sonnet`, `high`; small and low-risk → `medium` |
| **Second opinion on a plan** | senior engineer, `opus`, `xhigh`; risky, or `xhigh` already missed something → `max` (asks) |
| Scenarios for a plan or a change | edge-case hunter, `sonnet`, `high`; risky (security, money, data, concurrency) → `opus`, `xhigh` |
| A release, or a change set that touches security, money, permissions, a schema, deploy or the router | senior engineer, `opus`, `xhigh` |
| Stuck: two failed tries on the same problem | senior engineer, `opus`, `xhigh`; still stuck → `max` with the reason (asks) |
| The person is unhappy with an answer | `fable` advice (asks) |

"Asks" means you ask the person before the launch: `opus` at `max` and any `fable` launch.

## Delegation and parallel work

- **An agent only for work that is independent and big enough to pay for its own context:** a
  phase, a broad search, a fresh-eyes review, a scenario hunt. A handful of tool calls stays with
  you. A fresh reviewer helps because it has not seen the author's reasoning; delegation alone
  does not improve an answer.
- **Parallel by default for those.** Every unblocked agent starts in one message, with several
  calls. Long checks run in the background (`run_in_background`; `Monitor` watches CI and logs),
  and you wait only for a result the next step needs. One thing runs alone: a browser check
  (`/cc-smart-dev-kit:ui-verify` § 2).
- **Task types.** `blocked_by` only for a real dependency or a shared file; `non-blocking` for
  noted work that holds nothing. Follow-ups go to project tasks, never in as blockers.

## Usage left

The kit adds a line when the plan's usage window first passes 50, 75 or 90%. Judge from it:

- **Plenty:** the worked examples above.
- **Low:** `opus` only for the final risky review. UI/UX design runs only on `opus` or
  `fable`, so it waits for usage to come back, or for the person to say go.
- **Near the limit:** finish the step, save state in the task ledger, start no new agents, and
  say so.

Low usage never skips a test or a review: it means cheaper models, or stopping.

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
| The second opinion on a change set | `cc-smart-dev-kit:senior-engineer`, its brief with the line `Mode: review` — `/cc-smart-dev-kit:review` § Second opinion |
| A second read of a big plan | `cc-smart-dev-kit:senior-engineer`, its brief with the line `Mode: plan-review` (it records no review) — `/cc-smart-dev-kit:plan-task` § 4 |
| Stuck on a root cause, a design or a fix after two failed tries | `cc-smart-dev-kit:senior-engineer` as the consult: no `Mode:` line; the brief says whether it advises, fixes or builds |
| Every scenario that can break a plan or a change, before or after the code exists | `cc-smart-dev-kit:edge-case-hunter` (read-only); for a plan, beside the second read, in one message |
| One research question from current sources — a library, an API, a platform, a design choice — answered with a cited source per claim | `cc-smart-dev-kit:researcher` (read-only); a quick lookup stays with you, and a question with several angles goes to the `research-sweep` Workflow (`/cc-smart-dev-kit:research-first`) |
| Driving the running app in a browser | `cc-smart-dev-kit:ui-verifier` (needs the Playwright MCP server) — `/cc-smart-dev-kit:ui-verify`: the facts on `sonnet`, the design verdict on `opus` or `fable` |
| Edits to instruction files: rules, skills, agents, `CLAUDE.md` | `cc-smart-dev-kit:rules-maintainer` |
| Questions about Claude Code, the Agent SDK or the API | `claude-code-guide` (built-in) |

The main session owns review. A builder never reviews its own work or starts the senior
engineer. The build skill owns the dispatch size and session cap.

## How to brief

A subagent has none of your conversation, and an under-briefed agent costs more than doing the
work yourself. Brief every tier fully, whatever model answers it. Every brief has four parts:
objective; files and boundaries; patterns/tools; output format (`Report:` task note plus short
status for a phase). Put the caller's rulings first: commit or not, allowed checks, what to do
on a refusal, and decide small calls with a `Ruling:` note. Treat the agent as a smart colleague
who just walked in:

- **The goal and why it matters**, and whether you want research or code.
- **One job with one clear outcome.** A big phase becomes two or three agents, never "figure
  out the codebase".
- **The decisions, not the question:** the approach, the exact paths and symbols to read and
  change, the pattern to copy (`file:line`), the names to use, the edge cases and test cases.
- **The rules that bite here, quoted** — the ones its files touch, not "follow the repo rules".
- **Its files:** a write-capable agent gets the exact list it may change, and "change nothing
  else". Check `git status --short` when it returns.
- **A builder that needs its own checkout gets one:** launch it with `isolation: "worktree"`
  and merge its branch back when it hands over. A session that entered a worktree writes
  only inside it, and its agents inherit that limit, so never brief one with a path in a
  different worktree.
- **It deletes only files it created.** Never let it clean a shared folder (a scratch
  folder, an output folder, a temp folder another agent uses) — one agent that did removed
  the session's own scripts.
- **Its limits, in words:** commit only on its worktree branch if the brief allows it. No push,
  new agents, self-review, peer messages or questions to the person. Give a phase task number:
  `task_get` reads the brief; `task_note` holds the report.
- **Nothing of its own still runs when it reports:** the brief tells it to wait for every
  background command and agent it started, or to stop it, before the final message. One that
  hands back early is blocked once and told to wait or stop it — and Claude Code keeps such an
  agent open until the work lands.
- **When it is blocked, it reports and stops.** It never retries in a loop, never works
  around a guard, a hook or a permission refusal, and never widens its scope. A command
  Claude Code's worktree check refuses as too complex is no block: the agent splits it into
  plain commands and goes on (`cc-smart-dev-kit:builder`).
- **A done-check it can run, and a dense report:** findings with `file:line` evidence and the
  commands it actually ran. No restating the brief, no pasted code you can read yourself. A UI
  check reports the named key screenshots it saved and the measured value per check — never a
  design verdict.
- `Explore` and `Plan` load no `CLAUDE.md`: restate every constraint they must respect.

Two failed tries at the same job → the senior engineer's consult on `opus` at `xhigh`; never a
third try on the same setup. A stuck build phase uses the fix-round limit and escalation in
`/cc-smart-dev-kit:build` instead.

## Model and effort: the mechanics

- **Every launch names both** — an `Agent` call, and each `agent()` in a Workflow. An agent
  given neither runs on the session's model and effort: on an Opus session, a plain `Explore` is
  an Opus launch.
- **An agent file's `model:` and `effort:` are a default, not a binding.** Claude Code takes the
  call's `model` first, then the agent's frontmatter, then `CLAUDE_CODE_SUBAGENT_MODEL`, then the
  session's model; for effort, `CLAUDE_CODE_EFFORT_LEVEL` beats the call, which beats the
  frontmatter. The kit's own agents carry neither, so every launch names both.
- **`opus` and `fable` name the tier**, whatever model answers it: with the gateway on, a slot
  may send a family to another model (`/cc-smart-dev-kit:gateway`).
- **`max`** only with a reason, such as a check `xhigh` already missed. The session's own effort
  is the person's choice.
- **A fork** runs on the session's own model, at the effort you pass, or else the session's.
- **Saying it when you launch** (the core instructions): a fork names the session's model; a
  Workflow names each `agent()`'s; builders never start more agents.

## UI/UX work

Design judgment, layout, components, pages and styling run only on `opus` or `fable`, at `high`
or above — never on `haiku` or `sonnet` (the core instructions' model table). The one exception
is checking, which is not design: the `ui-verifier` may run on `sonnet` and brings back measured
facts and screenshots, and you make the design verdict on `opus` or `fable`
(`/cc-smart-dev-kit:ui-verify`).

## Choosing Fable

`fable` is the premium advisor (the core instructions' model table): the hardest long-horizon
work, hard architecture, a rewrite or a complex UI/UX design, a strong second opinion, refining
a plan — and a fresh attempt when the person is not satisfied with your answer.

- **Advice runs on a read-only agent** (`Plan`, `Explore`, an auditor, the edge-case hunter, a
  researcher).
  It returns a design, a plan, a review or a fix for a builder to build. The senior engineer can
  edit, so a Fable launch of it is a build.
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
