# SW1 — a research sweep workflow behind `research-first` (D28's third; 1.2.1)

## Goal, and why

Your branch starts from `release-1.2.1` (main after 1.2.0, with 1.1.3, CL2, CL2B, EF2 and WF1
merged). The plan: `.claude/plans/2026-10-21-master-plan.md` § Release 1.2.1, and D28 ("Claude Code
workflows, a few: the audit skill with an `audit-run` workflow; a review split by track after its
proof; a research sweep later. Never for a release check, a worker's loop, or starting workers").

**The owner's choice (2026-10-25):** add the research sweep. A big design question (how the
router should cut a stalled stream; what an affordable provider really offers for crew work)
needs several sources read in parallel and every claim checked against its source, without
filling the asking session's context.

## The change

1. **Read first:** the two shipped workflows (`plugin/workflows/audit-run.js`,
   `plugin/workflows/review-split.js`) and how they are tested (`src/workflows/*.test.ts`);
   `docs/design/instructions.md` § The shipped Workflows; the `research-first` skill
   (`plugin/skills/research-first/SKILL.md`); the Workflow opt-in rules
   (`.claude/research/archive/2026-10-21-master-plan.md` ~392-404); the agent guard's
   `READ_ONLY_WORKFLOWS` (`docs/design/hooks.md` ~442). Copy their shape, never their words
   (`check:duplicates`).
2. **The workflow** (`plugin/workflows/research-sweep.js`, `meta.name` `research-sweep`):
   - takes an object: the question, the angles to research (for example: the current docs, the
     project's own code, the issue trackers, a comparison of alternatives), an optional budget; a
     string or a bad object is refused at the start, as RS1 does for the other two;
   - one read-only researcher per angle, then one refuter per claim that the answer depends on:
     it opens the cited source and confirms or refutes the claim with the quote;
   - returns the verified claims with their sources, the refuted ones with why, the unchecked
     ones past the budget (never dropped), and the open questions;
   - read-only: no edits, no commits, no `isolation: 'worktree'`.
   - Models and efforts as the project's rules give them (`src/models/launch-policy.ts`; the core
     instructions' table: searches and reads on the scout or the worker tier at `medium`; the
     refuter at `high`). Every `agent()` names its `model` and `effort` as literals, so the agent
     guard can read them.
3. **The guard:** `research-sweep` joins `READ_ONLY_WORKFLOWS` (find its home in `src/hooks/`), with
   its test. Nothing else in the guard changes.
4. **The skill:** `research-first` gains when to start the sweep (a question with several sources
   or a decision that rests on facts the session cannot check in a few calls) and the argument
   object, with an example; starting it stays the person's opt-in as Claude Code's rules say
   (a skill whose instructions say to call Workflow counts only when the person invoked it).

## Files (change nothing else)

`plugin/workflows/research-sweep.js`, its test in `src/workflows/`, the guard's read-only list
and its test (`src/hooks/…`), `plugin/skills/research-first/SKILL.md`,
`docs/design/instructions.md` (§ The shipped Workflows), `docs/design/hooks.md` (the read-only
list), `README.md` if it lists the workflows, `plugin/dist/*.js`. **`plugin.json` stays as it
is.** RS1 changes the other two workflow scripts: do not touch them.

## Setup in your worktree

Run `bun install` in your own worktree. Never link another checkout's `node_modules`. Never read
or run git in another worktree. Never start a Workflow run yourself; the tests run the script
with fakes.

## Done-check

1. Tests, each seen failing first: the agents it starts (one per angle, one refuter per claim up
   to the budget, each with a literal model and effort); a refuted claim; claims past the budget
   returned unchecked; a string argument refused; the guard allows the run as read-only.
2. `bun run build`, then `bun run check` (duplicates included) and both
   `claude plugin validate … --strict`.
3. Your own review, then one second opinion: the `cc-smart-dev-kit:reviewer` agent on `sonnet` at
   `high`.
4. Commit a checkpoint after each green step. Never send an empty report.
5. Before you report, stop every background check you started.
