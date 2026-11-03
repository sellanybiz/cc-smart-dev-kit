# Research: subagent-driven parallel development (2026-11-03)

## Sources

1. **Claude Code docs, "Run agents in parallel"** (code.claude.com/docs/en/agents).
   - Subagents report back to the conversation that started them.
   - When tasks touch the same files, give each its own worktree.
   - `/batch` splits one large change across 5 to 30 worktree-isolated subagents.
   - Agent teams do not isolate teammates in worktrees.
2. **Claude Code docs, "Create custom subagents"** (code.claude.com/docs/en/sub-agents).
   - Agent frontmatter: `model`, `effort`, `isolation`, `background`, `skills`, `memory`,
     `maxTurns`, `omitClaudeMd`, `tools`, `disallowedTools`.
   - `SendMessage` with the agent's id or name resumes a finished subagent with its context.
3. **Claude Code docs, Agent SDK subagents, "Cap subagent depth, concurrency, and spend"**, and
   the claude-code issue tracker (#78105, #80082).
   - `CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS` (since v2.1.217) caps the subagents running at once.
     The default is 20. A launch past the cap fails, and Claude is told not to retry.
   - `CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH` caps nesting (default 3 since v2.1.219).
   - The per-session total cap was removed in v2.1.224.
   - Tested version here: 2.1.310, so both exist.
4. **Claude Code docs, "Best practices".** Subagents pay off for:
   - independent pieces of work at the same time;
   - keeping long output (a full test run, a wide search) out of the main context;
   - an independent review: a fresh reviewer helps because it has not seen your reasoning.

   Handing the same task to a subagent does not by itself make the answer better. Subagents run
   in the background by default.
5. **Anthropic, "How we built our multi-agent research system".**
   - It is an orchestrator-worker design: a lead agent splits the work and starts subagents in
     parallel.
   - Each subagent needs an objective, an output format, guidance on tools and sources, and
     clear task boundaries. Vague briefs cause duplicated work and gaps.
   - Scale effort to the task: 1 agent for a simple fact, 2 to 4 for a comparison, 10 or more
     with clearly divided responsibilities for complex work.
6. **obra/superpowers, `subagent-driven-development`.**
   - A fresh implementer per task, then a task review (spec and quality).
   - Fix rounds: resume the same implementer up to 3 times, then a fresh one on a stronger model.
   - One final whole-branch review on the strongest model.
   - A ledger that survives compaction.
   - "Rulings, not stalls", with four stop reasons.
   - The model is named explicitly on every launch.
   - Small same-shape edits are batched into one dispatch.
   - The implementer never starts agents and never reviews itself.
   - It runs implementers one at a time; we run disjoint phases in parallel, in worktrees.

## What the kit takes

- **The main session is the orchestrator.** One builder per phase, phases with disjoint files at
  once, each in its own worktree, all started in one message.
- **A brief with four parts** (Anthropic): objective, files and boundaries, the patterns and
  tools, and the output format (the `Report:` note, a short status).
- **A task review per phase, by a fresh reviewer.** One final review on `opus`.
- **The kit's task system is the ledger.**
- **At most 10 subagents running at once per session**, by default. `setup` writes
  `CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS=10` as a managed key in the user's settings. A person's
  own value is never touched, and `setup --max-subagents <n>` changes the kit's. This uses
  Claude Code's own cap, not a counter of ours.
- **Lessons from this build:** a literal backend model stops at every guard refusal and at every
  judgment call. Briefs must carry the caller's rulings up front (no commit, the checks allowed,
  rephrase a refused read, decide small calls), and the builder agent's own text must say the
  same.
