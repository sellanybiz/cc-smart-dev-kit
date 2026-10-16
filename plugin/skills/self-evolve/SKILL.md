---
name: self-evolve
description: Use when the person gives a correction, sets a new convention, or a mistake repeats. Decides whether it becomes a rule, a skill, a hook, a doc or a memory, keeps the instruction set small, and holds the size budgets. Trigger phrases - "always", "never again", "make this a rule", "from now on", "stop doing".
---

# Keep The Instructions Sharp And Small

**Project add-on:** `.claude/cc-smart-dev-kit/self-evolve.md` — read it first when it exists. Where
it differs, the add-on wins (`core.md`, top). It names the project's own budgets and where
its instruction files live.

The instruction set is a product: every subagent inherits it, every turn pays for it. Improve
it without letting it grow. **The default move is deletion** — most sessions should leave it
the same size or smaller.

## The bar for adding anything

Write a rule the **second** time a mistake happens, not the first. Then four questions, in
order:

1. **Would removing it change what Claude does?** No → do not write it.
2. **Can Claude work it out from the code?** Yes → do not write it. Folder trees, dependency
   lists and architecture overviews can be read; pitfalls, reasons and conventions that
   differ from a tool's defaults cannot.
3. **Is it an instruction to follow next time?** No → it is not a rule; route it
   (`/cc-smart-dev-kit:memory-routing`).
4. **Does it follow Anthropic's current guidance for Claude Code, and leave Claude at least
   as capable as without it?** A rule that bans a useful tool, forces a ritual, filters what a
   reviewer reports, or steers thinking the model does well on its own makes the work worse:
   do not add it, and propose removing one you find. Safety rules and owner decisions are
   the limits the work runs inside, not lost capability; where the guidance and an owner
   decision differ, keep the decision and write down why.

Machine-written instruction files tend to do worse than none. Never bulk-generate rules:
propose the change, show the exact diff, and let the person approve it.

## Size budgets

Lines, not words.

| File | Target | Hard cap | Why |
|---|---|---|---|
| A project's `CLAUDE.md` | 190 | 200 | Loads every turn, and again in every subagent that loads it. |
| All rules with no `paths:`, together | 200 | 200 | Same cost as `CLAUDE.md`. |
| A rule with `paths:` | 120 | 200 | Loads only on a matching file. |
| A skill's `SKILL.md` body | 300 | 500 | Loads in full when the skill runs. |

Not budgeted: agent files (their own context), a skill's `references/` files (read on
demand) and docs. That is where detail goes. Before an edit, `wc -l` the file. Over the
target: cut or move something. Over the cap: nothing goes in until as much comes out.

## Where content goes

| Kind | Home |
|---|---|
| Cross-cutting safety, needed on every task | a rule with no `paths:` — the exception, it needs a real reason |
| A convention tied to certain files | a rule with `paths:` |
| A procedure or workflow | a skill; its long detail in `references/` |
| How something works today, and why | a doc page — never a rule |
| What must happen every time, with no judgment | a hook |
| A past decision, a dead end, a personal preference | memory |
| Current data (columns, rows, lists of things) | the live system — never frozen in markdown |

`CLAUDE.md` is the index: something every task needs, a pointer to where a rule lives, a
one-line consequence worth knowing first. A section longer than a short paragraph is a rule
in the wrong place: move it and leave a pointer.

## Never add these

- **Bloat** — a long always-on file makes Claude ignore the instructions that matter.
- **Contradictions** — two rules pointing different ways cost reasoning before work starts.
- **Emphasis inflation** — when many lines are bold or "IMPORTANT", none stands out.
- **Ritual checklists** — steps done because a list says so.
- **Redundant constraints** — restating what the model already does well pulls attention
  from the task.
- **State instead of behaviour** — dated decisions, rollout status, "what X does now".
- **Anything the code already says.**
- **Vague virtue** — "write clean code". Make it specific and testable, or drop it.
- **Prose where a hook belongs** — instructions are advice; hooks are certain.

## Editing safely

One small edit: do it yourself. A phase or an edit across several instruction files: the
`cc-smart-dev-kit:rules-maintainer` agent owns it, conflict check included.

1. Read the file. Make the smallest change that works. Check the budget.
2. **One home per rule.** Search every instruction file for the topic's key words. The rule
   lives in one place; the others point to it. Fix any sentence that now says the opposite.
3. Added, renamed or removed a rule, skill or agent? Update the index that lists it.
4. **Sync the agents:** list them live (`Glob`), never from a copied roster, and `Grep` them
   for the old name. A stale agent enforces yesterday's rule with today's authority.
5. Deleting a rule? `Grep` for every pointer to it first.

## End of a significant session

Ask what changed, and route it. Then the harder question: **what can now be deleted?** A
convention a hook now enforces, a rule nobody follows, a section the code made obsolete.
