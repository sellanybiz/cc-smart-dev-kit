# Plan 1 of 3 — 2.2.0: a smarter, cheaper Claude

**Summary.** Make the kit teach Claude to work like a smart team lead: fast, parallel and
careful with cost. Each agent's model and effort are picked by judgment of the job, never by the
backend behind a slot. The plan fixes the rules and guards that fight Claude Code's own guidance,
cuts the context and extra turns the kit costs, and turns the reviewer into a senior engineer. It
adds an edge-case hunter, catches up with claude-mem 15.9, and lets Claude see the plan usage
left. Plans 2 and 3 follow (end of this file).

## Context

The owner asked for this after reading a Codex-written roadmap (`~/Desktop/cc-smart-dev-kit-next-session-prompt.md`).
Its Task 1 already shipped (2.1.0, 2.1.1). On 2026-11-05, five research agents checked the rest
against the current docs and the code, and a second read checked this plan. Every claim below was
checked in the source or the docs.

- **Effort.** In Claude Code, Opus/Sonnet/Haiku 5.5 default to `medium`. Opus 5.5 at medium
  matches Opus 5 at high (code.claude.com/docs/en/model-config). The owner's Opus 5.5 benchmark
  table agrees: `high` gives most of the gain for about 3× medium's cost, and `xhigh`/`max` cost
  2–3× more again for a few points. `max` sometimes scores lower, and the docs call it "prone to
  overthinking". Effort also changes how many tool calls Claude makes (platform effort docs).
- **Over-delegation.** Anthropic's Opus 5 prompting guide says not to delegate work you can
  finish in a handful of tool calls, and not to use subagents to double-check your own work. The
  sub-agents doc keeps quick, targeted changes in the main conversation. Yet `core.md:13` says
  "all workers are subagents", with no scope. `plan-task` also sends the pieces of a two-file
  change to subagents.
- **Agent guard.** `agent-guard.ts:1125-1126` refuses a launch that names no `model` or no
  `effort`, and never reads the agent's frontmatter. So a project agent that pins both is always
  refused. `subagent-decision/SKILL.md:103-105` wrongly says frontmatter "binds every caller".
- **Verify gate.** `verify-gate.ts:194-198` counts every successful Edit or Write, a plan file
  or a README included, then blocks the stop until the fast check runs.
- **Context.** `scripts/check-context-budget.ts` reports the always-on text is over its own
  3,300-token budget (about 3,515), and nothing runs it. The kit's fixed context is about 4,900
  tokens per session. Skill descriptions alone are about 2,000 (`gateway` 223).
- **Prompt cache: no breakage found.** Hook `additionalContext` lands where the hook fires,
  never in the system prompt (hooks doc). Plugin skills, agents and hooks never invalidate the
  cache (prompt-caching doc). The router passes the original body through on the normal path
  (`router.ts:1929-1939`). Not measured live yet, so this plan adds the measurement.
- **Extra turns and tokens.** The session-name note repeats on every prompt until a name is set
  (`session-name.ts:119-138`). Several stop-hook lists have no cap (`builder-finish.ts:133-140`,
  `keep-going.ts:98-120`, `worktree-leftovers.ts:145-165`). The review, audit and research
  workflows run their `sonnet` agents at `max` (`review-split.js:133,186`, `audit-run.js:89`,
  `research-sweep.js:103`) and the report writer at `max` (`audit-run.js:160`). They also drop
  the findings a refuter could not prove (`review-split.js:195,235-237`).
- **claude-mem.** This machine has 15.5.0; 15.9.0 is the latest. `memory-routing/SKILL.md:84`
  calls `mem_search`, which was removed in 15.0.0. `doctor.ts:919-922` and the docs still
  describe the memory-use overflow (#5180), which was fixed in 15.7.0. claude-mem now ships
  `build`, `do`, `release` and `version-bump` skills; some push, merge or "commit everything"
  without asking. Its My Work view can run background agents outside our note-taker route.
- **Plan usage.** The status line input carries `rate_limits.five_hour/seven_day` (subscribers
  only, after the first answer). No hook input does. `src/cli/usage-window.ts` (D54) already
  records the 5-hour window from the status line, and the portal reads it.
- **Lead model.** SessionStart may carry `model`. `fable-session.ts` reads it, and
  PostModelSwitch and Stop too, and tells the person once through `systemMessage` (zero model tokens).
- **Advisor** (`/advisor`, experimental): rejected. With the lead on Opus the only stronger
  advisor is Fable, and it works only on the Anthropic API path.

## Decisions (owner, 2026-11-05)

- Three plans in order: this one, then the bug hunt and guards, then the web-app cleanup.
- The kit **recommends** the lead on Claude Opus at `high`. It never switches by itself, and it
  still works fully on a backend lead (memory `backend-models-subagents-only`).
- The model and effort are chosen by **the lead's judgment of the job** (§ The policy). The
  backend behind a slot never changes the choice, and briefs are full for every tier.
- `reviewer` → `senior-engineer`, a **clean break**: the old id stops working, and doctor names it.
- The senior engineer gets **all tools, always**. *Trade-off, written down because the owner chose
  it over the recommendation:* during a review it could change the code it judges. Mitigation: its
  text says to report the review findings before any fix, and to fix only what the brief asks.
  The review and audit workflows still pass `disallowedTools: [Edit, Write, NotebookEdit]` per
  launch, so their parallel tracks never edit one checkout at once. Core.md gets the one
  exception this needs: the senior engineer may start research agents. It still reports to its
  caller and never asks the person.
- Escalation: the senior engineer runs on `opus` at `high`/`xhigh` without asking. `opus` at `max`
  and any `fable` launch ask the person (today's rule, `launch-policy.ts:71-74`).
- A new agent, **`edge-case-hunter`**. Given a plan or a change, it lists every scenario that can
  break it: inputs, state, timing and concurrency, environment, the people and processes it meets,
  failures, restarts, upgrades (checklist: `review/references/axes.md`). For each one it gives
  the trigger, what should happen, what the plan or code does, the gap, and the test that catches
  it. It is read-only and fixes nothing. The senior engineer judges and finds bugs; the hunter
  generates scenarios, and it works before code exists. It runs in parallel with a plan's
  second read, and feeds the edge-case section and the tests.

## The policy (home: `subagent-decision`; core.md keeps the short form)

**The lead's judgment, not a lookup table.** For each launch the lead weighs:

- **How hard is it?** Can a careful person do it straight through, or does it need deep reasoning?
- **What does a miss cost?** Cheap and caught later, or it ships, loses data, opens a hole, or wastes a whole build?
- **Is this the last check before it is too late?** A plan's second opinion and the final review
  guard everything after them, so they earn more effort than a step a later review still covers.

Spend effort where those are high and save it everywhere else: `high` gives most of the gain.
The lead session runs on Opus at `high`. Worked examples (in the skill; the lead judges new cases the same way):

| Situation | Agent, slot, effort |
|---|---|
| Find files, read a module, a symbol's callers | `Explore`, `haiku`, `medium` |
| Mechanical edits, a doc update, run the tests | builder, `sonnet`, `medium` |
| Build a normal phase | builder, `sonnet`, `high` |
| UI/UX design, an architecture build | builder, `opus`, `high` (`xhigh` when hard) |
| Ordinary phase review | senior engineer, `sonnet`, `high`; small and low-risk → `medium` |
| **Second opinion on a plan** | senior engineer, `opus`, `xhigh`; risky, or `xhigh` already missed something → `max` (asks) |
| Scenarios for a plan or a change | edge-case hunter, `sonnet`, `high`; risky (security, money, data, concurrency) → `opus`, `xhigh` |
| A release, or a change set that touches security, money, permissions, a schema or deploy | senior engineer, `opus`, `xhigh` |
| Stuck: two failed tries on the same problem | senior engineer, `opus`, `xhigh`; still stuck → `max` with the reason (asks) |
| The person is unhappy with an answer | `fable` advice (asks) |

**Delegation.** An agent only for work that is independent and big enough to pay for its own
context: a phase, a broad search, a fresh-eyes review, a scenario hunt. A handful of tool calls
stays with the lead. **Parallel by default for those:** every unblocked agent starts in one
message, long checks run in the background (`run_in_background`, `Monitor` for CI and logs),
and the lead waits only for a result the next step needs. **Task types:** `blocked_by` only for a
real dependency or a shared file; `non-blocking` for noted work that holds nothing; follow-ups
go to project tasks, never as blockers.

**Usage left** (from phase B2's line). Plenty: the normal table. Low: `opus` only for the final
risky review. Near the limit: finish the step, save state in the task ledger, start no new
agents, and say so. Low usage never skips a test or a review: it means cheaper models, or stopping.

## Phases

Builders work in their own worktrees. Each checks only its own files; the main session runs the
full check once at the end. A phase that changes how a part works updates that part's doc
section; where two phases touch one doc page, each edits only its own section and the main
session settles the merge. **Contract:** a review brief carries the exact line `Mode: review`
alone on its line (phase A's hook reads it; C and D1 write it into the skills).

**Wave 1 (start together):** A, B1, C, D1, E1, E2. **Wave 2:** B2 (`blocked_by` B1 for
`specs.ts` and `agent-guard`, and A for `src/workflow/schema.ts`, where `switches.leadHint`
goes), D2 (`blocked_by` C for `docs/design/instructions.md`).

### A — The rename and the review marker (code)
Builder, `sonnet`, `high`. It touches the merge gate, so its review runs on `opus` at `xhigh`.
- The id `cc-smart-dev-kit:senior-engineer`: the `reviewAgents` default and its message
  (`src/workflow/schema.ts:250,491`), `src/testing/fake-workflow.ts:52`,
  `portal/src/api/mock-projects.ts:109`, and `.claude/skills/release/SKILL.md:59`. A test ties
  `review-split.js`'s literal `agentType` to the schema default (the guard reads the script's literal).
  **Do not touch** `after-merge.ts:755` (`--reviewer` is `gh`'s own flag), or comments that say
  "reviewer" as a plain word (`prompt-source.ts`, `subagent-worktree.ts`, `gateway/settings.ts`, `merge-check.ts`).
- `review-record.ts`: record a review only when the agent's brief has the exact `Mode: review`
  line. Read it the way `builder-finish.ts:62` reads `Your task:`. No line: nothing recorded.
  Tests: a review brief, a consult brief, no transcript.
- The schema still **parses** the old id, so no guard fails closed. Doctor fails with the fix
  when `.claude/cc-smart-dev-kit.json` or the person's `workflow.json` names it
  (`project-checks.ts` and one machine check in `doctor.ts`). The fix line says: change the
  list, then merge that change by hand or run `workflow review-done`, because the merge guard
  judges with the base's list. A doctor `!` note names `.claude/cc-smart-dev-kit/*.md`,
  `.claude/agents` and `.claude/skills` files that mention the old id.
- Docs: `docs/design/workflow.md` (the review record, the marker), README's `reviewAgents` rows
  (about 2609 and 2725), `CHANGELOG` notes for the clean break go to the main session.
- Done-check: touched tests, `bun run typecheck`.

### B1 — Agent guard and launch policy (code)
Builder, `sonnet`, `high`. Review on `opus`, `xhigh` (a guard).
- **First, prove the order live and write two contract rows:** which wins for a call with no
  `model`, the agent's frontmatter or `CLAUDE_CODE_SUBAGENT_MODEL`; and the built-in agents' own
  models (`claude-code-guide`, `statusline-setup`, `web-fetch`…) on 2.1.318.
- `src/models/launch-policy.ts` `effectiveLaunch`: a new source label, frontmatter, for **both
  `model` and `effort`**, with the file lookup passed in (it stays pure). The lookup follows
  Claude Code's own order: project `.claude/agents`, user `~/.claude/agents`, then plugin agents
  (from `installed_plugins.json` and a plugin's custom `agents` path). It matches by the
  frontmatter `name`, and a lower-priority file never stands in for a higher one. `--agents`/SDK
  agents cannot be seen, so they are refused as today. `judgeWorkflow`'s `agent()` uses the same
  resolution. Fix `NO_MODEL`/`NO_EFFORT` (`agent-guard.ts:949-952`).
- `READ_ONLY_AGENTS` (`agent-guard.ts:194`): the senior engineer is no longer read-only, so a
  Fable launch of it needs the build word. Rename the reviewer cases in `agent-guard.test.ts`.
- Tier note (`src/models/tier-view.ts`): keep the slot → backend map. Replace the per-tier effort
  ranges with: "Choose tier and effort by the job (`/cc-smart-dev-kit:subagent-decision`); `opus`
  at `max` and `fable` ask the person."
- Docs: `docs/design/hooks.md` (agent guard section), contract rows.
- Done-check: tests for each resolution source, `--agents` refusal, workflow `agent()`, the note text.

### B2 — Lead hint, usage line, cache visibility (code), after B1
Builder, `sonnet`, `high`.
- **Lead hint** inside `fable-session.ts`, keeping its name. It uses the same events and
  `systemMessage` to the person (zero model tokens), with **one mark per message** plus a "judged,
  nothing to say" mark per model, so an Opus session stops reading the transcript at every Stop.
  The line: "This session runs on X. The kit works best with the lead on Claude Opus at high
  effort. Switch with /model." It shows when the lead is not the Claude Opus family, or when the
  opus tier is answered by a backend. The Fable line is unchanged and still shows after a lead
  hint. A new `switches.leadHint` (default on) lets a person who leads on a backend on purpose
  turn it off. `claude -p` sessions are told nothing.
- **Usage line:** extend `usage-window.ts` with `sevenDay`, and keep reading the old file shape
  (`src/portal/facts.ts`, `src/portal/api/data.test.ts`). `tier-view`'s UserPromptSubmit adds
  **one** `additionalContext` line when a window first crosses 50, 75 or 90%, keyed by
  `resetsAt`, so each crossing is told once a window. A window past `resetsAt`, or a missing
  file, gives no line. Freshness comes from `resetsAt` only: the file is written only when the
  numbers change, so its age says nothing.
- **Cache visibility:** the status line shows `cache miss: <cause>` once per new
  `prompt_cache.last_miss_cause`. `live-check.ts` reports it.
- Docs: `docs/design/hooks.md` (its own sections), README status line and `switches`, contract
  rows (SessionStart `model`, `rate_limits.seven_day`, `prompt_cache`).
- Done-check: hand-written tests for each threshold, no file, past reset, old file shape, the
  hint for Opus, Sonnet, Fable, an opus slot on a backend, and lead hint then Fable.

### C — Core, the policy, build, plan-task, plain English (instructions)
`rules-maintainer`, `opus`, `high`: this text steers every session on every machine.
- `plugin/instructions/core.md`:
  - "All workers are subagents" scoped to approved plans; "a handful of tool calls is yours".
  - The policy's short form, including the lead on Opus at `high`.
  - "Think one step ahead" becomes: deliver what was asked, complete; name a next-month risk in
    one line and build it only if asked.
  - "Research first, never give up" scoped to external libraries and APIs.
  - A new ask outside the plan: say so in one line, then do it or file it, as the person prefers.
  - Memory: "`/cc-smart-dev-kit:memory-routing` picks the tool".
  - Plain English: a question or option stands alone, with enough context to choose. Drop
    "Detail belongs in the plan" where it hides what the person needs.
  - The senior engineer exception (Decisions). The reviewer → senior engineer references.
  - Stays within 140 lines.
- `subagent-decision`: the policy, the worked examples, the usage-left rule. Briefs are full for
  every tier (fold "Briefing an affordable model" into "How to brief"). The frontmatter fact
  corrected. Rows for the senior engineer and the edge-case hunter.
- `build`: parallel and non-blocking work and task types. The kit's flows govern kit-driven
  work, and claude-mem's `build`/`do`/`release`/`version-bump` run only when the person asks,
  under the project's workflow settings. Review briefs carry `Mode: review`. The rename.
- `plan-task`: § 3 drops "separable pieces still go to subagents" for small changes. § 4 starts
  the hunter and the senior engineer's second read in one message for a big or risky plan.
  Line 99 rename. The question guidance follows the plain-English rule.
- `explain` + `references/plain-english.md`: the one detailed home for plain English, with
  before/after examples. The output style points to it.
- `docs/design/instructions.md`: core and these skills' sections.
- Trim these skills' descriptions.
- Done-check: `check:core-lines`, `check:duplicates`, `check:docs`, `check:neutral`; the
  after-edit conflict search across `plugin/`.

### D1 — Senior engineer, edge-case hunter, review (instructions)
`rules-maintainer`, `opus`, `high`.
- `plugin/agents/reviewer.md` → `plugin/agents/senior-engineer.md`. Two duties: the second
  opinion (`Mode: review` brief: the review limits stay, and findings come before any fix) and
  the consult when stuck (root cause, design, a fix or a build as the brief says). No
  `disallowedTools`. R&D through `WebSearch`/`WebFetch` and Tavily (search, then extract to
  confirm), with sources cited. No company names.
- New `plugin/agents/edge-case-hunter.md` (Decisions). Read-only, with no model in its frontmatter.
- `review` skill: second-opinion effort by risk, `Mode: review` in the brief, the hunter for
  risky change sets, and the rename. `review/references/axes.md:4`.
- `src/models/agent-tools.test.ts` (it fails on an unknown agent file).
- Rename references and trim descriptions in `research-first`, `audit`, `ui-verify` and the
  agents `builder`, `auditor`, `rules-maintainer`, `ui-verifier`.
- Contract rows 83 and 286 (they name the old id).
- Done-check: `agent-tools.test.ts`, `check:duplicates`, `check:docs`.

### D2 — Workflow scripts, after C
Builder, `sonnet`, `medium`: small, well-specified edits with tests.
- `review-split.js:133,186`, `audit-run.js:89`, `research-sweep.js:103` → `high`;
  `audit-run.js:160` → `medium`. The `opus`/`xhigh` risky branches stay.
- Unproven findings are listed under "Hunches", not counted away.
- The review and audit tracks pass `disallowedTools: [Edit, Write, NotebookEdit]` per launch.
- Their tests in `src/workflows/`. `docs/design/instructions.md` D46 paragraph.

### E1 — Cost hooks (code)
Builder, `sonnet`, `high`.
- `verify-gate.ts`: read `file_path`/`notebook_path`. Count an edit only when it is inside the
  session's current checkout, is not a Markdown file, and is outside `plansDirectory` and
  `.claude/plans/`. A symlink is resolved before the compare.
- `session-name.ts`: remind once per context, not on every prompt.
- `builder-finish.ts`, `keep-going.ts`, `worktree-leftovers.ts`: at most 8 items, then
  "+N more" and the command that lists the rest (the `task-start` pattern).
- `docs/design/hooks.md`: these hooks' sections.
- Done-check: the hook tests, with a case for each skip and each cap.

### E2 — claude-mem and the remaining descriptions
Builder, `sonnet`, `high`.
- `memory-routing/SKILL.md:84`: `search` → `timeline` → `get_observations` through
  `/claude-mem:mem-search`, then `save_memory`.
- `doctor.ts:919-922`, README (about 1621-1635), `docs/design/claude-mem.md`: #5180 was fixed
  in 15.7.0, and the block stays off for instruction ownership. Clean the stale comments in
  `src/machine/claude-mem.ts`. Doctor names My Work auto-refresh as model work outside the
  note-taker route.
- `worktree/SKILL.md:36`: the `EnterWorktree` `path` claim is stale (the tool takes `path` on
  first entry from the launch folder). Fix it.
- Trim line 3 only of the descriptions of: `gateway`, `verify-change`, `performance-budget`,
  `memory-routing`, `self-evolve`, `impact-analysis`, `extract-or-duplicate`, `pull-request`,
  `commit`, `worktree`, `user-available`, `user-unavailable`. Keep the main trigger words.
- Done-check: doctor tests, `check:docs`.

### Main session (shared writes, after the merges)
Merge each phase after its task review. Then:
- Bump `plugin.json` to 2.2.0 and raise the claude-mem dependency to `>=15.9.0`.
- Wire `check:context-budget` into `bun run check` and CI, and lower its budgets to the new totals.
- `CHANGELOG.md` (with the clean-break steps) and the `docs/design.md` index.
- `bun run build`, `bun run build:portal` (the mock rename), then the full `bun run check` and
  both validates.
- The rename grep across `src/`, `plugin/`, `portal/src`, `docs/`, `README.md` and `.claude/skills`.
- The final whole-branch review (senior engineer, `opus`, `xhigh`), the PR, and the owner's yes.

## Edge cases

- **Rename:** a review started on 2.1 and stopped after the update records nothing, or an id the
  list no longer trusts, so the merge guard asks. A project whose committed list names the old id
  can merge its own list change only by hand or with `workflow review-done`. Both are in the
  release notes and doctor's fix line.
- **Review marker:** a consult launch records nothing. A review brief written without the line
  records nothing either, and the guard asks: the safe side.
- **Frontmatter:** `inherit`, a missing file, a fork, or an `--agents`/SDK agent → refused as
  today. Two files with the same name → the higher-priority one.
- **Lead hint:** `model` absent after `/clear` or a recovery → Stop's transcript model. A profile
  session uses the profile's chains. Gateway off and opus on Claude → nothing to say.
- **Usage:** no `rate_limits` (API key, a third-party provider) → no line. Each window can be
  missing on its own. Two sessions writing → atomic write, last one wins.
- **Verify gate:** a session that entered a worktree mid-way judges edits by the checkout they
  are in. A new file in the repo still counts.
- **Senior engineer edits in a review:** the accepted risk (Decisions), limited by the workflows'
  per-launch deny list.

## What could break

The merge gate (review record and marker), every skill, add-on and doc that names the old id,
the tier note's tests, the workflow tests, `agent-tools.test.ts`, the portal export, and
`check:duplicates` when C, D1 and E2 word the same idea. The after-edit conflict search in C and
D1 and the main session's grep and full check catch these.

## Rollback

Each phase is its own merge commit on the release branch: revert one, or ship 2.2.1 with the old
behaviour (never a lower version, `bundles-and-releases.md`).

## How we prove it

- Each phase's done-check, with hand-written expected values.
- The full `bun run check`, `build:check`, `check:portal`, `check:context-budget`, both validates.
- **Live, with the owner:** a Sonnet lead shows the hint once, an Opus lead shows nothing.
  Launch a project agent that pins model and effort: not refused. Watch the cache segment over a
  working session: no miss from kit hooks. Measure fixed context before and after with
  `/context`. Run `/doctor prompt-audit` (2.1.283+) before and after.

## Plan 2 (2.3.0) — its own session, after this ships

The Codex prompt's Task 2 items 1–3 and 5–7: the bug hunt, crew leftovers (`T-5c62j6`), the
1.x → 2.x upgrade path in doctor, the heavy-job queue gaps, the tasks and stop-guard research, and
the expert-agents proposal (shown to the owner before building). Plus: the after-merge broadcast
to every session, one hook dispatcher per matcher (five Bun starts per Bash call today), the status
line launcher's two Bun runs per tick, and the 25 leftover agent worktrees under `.claude/worktrees/`.

## Plan 3 — the web-app cleanup, after 2.2.0 is on the machine

In the web-app repo, on its own branch and PR from a **fresh `origin/dev`**, in a new worktree.
Its main checkout is 267 commits behind, `guardMainFolder` is on, and one agent worktree has
uncommitted work, so no existing worktree is touched. The inventory (2026-11-05; re-check it
against fresh `dev` first) found 77 instruction files and 408 always-loaded lines. Three
always-loaded rules total 227 lines, over the project's own 200-line cap. Target: about 230 (−44%).

- **Security wording first:** `.claude/cc-smart-dev-kit/review.md:17` says "RLS is off", but
  the database rule says RLS is enabled with zero policies. Use the database rule's words.
- Move off claude-mem `work_state_*` and onto kit tasks: `.claude/CLAUDE.md:177-179`, the
  `memory-routing.md` add-on, the `mcp-setup` skill, and the `worktree-leftovers.ts` hook plus
  `scripts/lib/{claude-mem-settings,worktrees}.ts`, which inject the old text again.
- Retire the orphaned `crew.md`/`lead.md` and `workflow.crew`. Rewrite the crew and wave wording.
- Delete the copied model and effort policy and agent rosters (`CLAUDE.md:56-93`,
  `review.md:3-11`, `subagent-decision.md`, the `ai-gateway` skill's mandatory `max`).
- Remove the generic blocks that repeat core.md. Move project anchors into the matching add-ons.
- `reviewAgents` → the new id (merged by hand, per the clean break). Raise `requires` to
  `>=2.2`, and the SessionStart hook's floor with it.
- Keep the real project knowledge: 30 path rules, `database.md`, `deploy`, `hotfix`,
  `db-migration` and the others. Keep the SSR/cookie rule as a stated exception to the plugin's
  hydration advice. Keep the three note ledgers until `/deploy` moves with them. Make
  `AGENTS.md`'s release safeguards reachable, since it does not load when `.claude/CLAUDE.md` exists.
- Prove it: `/doctor prompt-audit` and `/context` before and after.
