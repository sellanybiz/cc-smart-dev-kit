# UA1 — `user-unavailable` and `user-available`: work on while the person cannot answer (1.2.1)

## Goal, and why

Your branch starts from `release-1.2.1`. The plan: `.claude/plans/2026-10-21-master-plan.md` §
Release 1.2.1, row UA1.

**The owner's ask (2026-10-25, going to sleep with seven crew sessions running):** "create a skill
so Claude knows which blockers to avoid, because the person will not be able to answer, and
continues the work as much as possible; the questions, and the actions a hook can block, I answer
in the morning." And: "name them user unavailable and user available — maybe I did not go off to
sleep." So the pair is about the person's availability, at any hour, not about the night.

**Today:** nothing tells a session the person is away. A question (`AskUserQuestion`) or a
permission prompt (Claude Code's own, or a kit guard that answers "ask") stops the work until the
person comes back; a lead that waits leaves every ready phase unstarted. The lead did this by hand
the first night: it kept a list in the plan and took the reversible choices itself.

## The change

1. **The state, one home.** A command sets it, for this machine: for example
   `cc-smart-dev-kit user unavailable [--until <time>]`, `cc-smart-dev-kit user available`,
   `cc-smart-dev-kit user status` (pick the words; the skills and `--help` name them). It records
   since when, and the **list for the person**: every item parked while away, each with its kind
   (`question`, `action`, `decision`), the session and crew session that parked it, the time, and for
   an action the exact command; `cc-smart-dev-kit user park --kind <kind> "<text>" [--command
   "<cmd>"]` adds one. Under the kit's state folder, atomic writes and a lock (two sessions park at
   once).
2. **The `user-unavailable` skill** (`plugin/skills/user-unavailable/SKILL.md`), the rules while
   the person cannot answer:
   - never stop to ask, and never end a turn waiting for the person while other work is ready;
   - a choice inside the plan with a recommended option that is easy to undo: take it, and park a
     `decision` (what was chosen, why, how to undo it);
   - a choice that is the person's (scope, a trade-off the plan names as theirs, money, security,
     anything hard to undo): park a `question` with its options and the recommended one, and go on
     with what it does not block;
   - an action that needs the person's yes (a push, a merge into the default branch, a delete, a
     message to another session or service, a change to the gateway, anything a guard or Claude
     Code would ask about): never try it; park an `action` with its exact command;
   - a lead keeps its crew going (`/cc-smart-dev-kit:lead`): it answers the technical questions,
     parks the person's, starts what is unblocked, merges what passed its gate;
   - it writes the night's summary into the list at the end of each stretch of work.
3. **The hooks hold the line while the person is away** (find the cheapest homes; `.claude/rules/
   hooks.md` and `hooks-guards.md` apply):
   - `AskUserQuestion` is denied with the reason "the person is unavailable: park it with … and go
     on", so a session never hangs on a question no one reads;
   - a kit guard that would answer "ask" answers "deny" with the same reason and parks the command
     as an `action` itself, so a later yes can run it. **Never looser:** a deny where an ask was,
     never an allow;
   - Claude Code's own permission prompts: find whether a hook can answer them (a
     `PermissionRequest` event, its version, `docs/claude-code-contract.md`); if one can, deny and
     park the same way; if not, say so, and the skill tells Claude to avoid the tools that prompt;
   - a short note at each prompt while away (`UserPromptSubmit`, said once per change, never at
     every prompt): "the person is unavailable since …: follow `/cc-smart-dev-kit:user-unavailable`;
     N items parked".
   - Crew sessions already never ask the person; a permission wait in one is parked by its lead.
4. **The `user-available` skill** (`plugin/skills/user-available/SKILL.md`): sets the state back;
   shows what was done while away (the commits and merges since, the crew runs — PL1's
   `crew history` when it is there), then the list: the decisions (keep or undo each), the
   questions (one `AskUserQuestion` call, recommended option first), the actions (each run on the
   person's yes, with its command shown), and clears what was answered.
5. **The person's own prompt while unavailable** does not switch it back by itself (the person may
   send one line from a phone and go): the note says it is still on and how many items wait, and
   `/cc-smart-dev-kit:user-available` goes through them.
6. **The words:** the core instructions only if a line must point at the pair (`check:core-lines`:
   it must not grow past its budget); `docs/design/instructions.md` (the skill list),
   `docs/design/hooks.md`, `README.md` (the commands and the skills), `.claude/rules/
   hooks-guards.md` (the deny-while-away row).

## Files

`src/` for the state and the command (a new folder or file: say where and why), the hooks you
extend (`src/hooks/…`, their entries, `specs.ts`, `plugin/hooks/hooks.json`), the two skills,
`docs/design/instructions.md`, `docs/design/hooks.md`, `docs/claude-code-contract.md`, `README.md`,
`.claude/rules/hooks-guards.md`, their tests, `plugin/dist/*.js`. Change nothing else; name each
file outside this list in your report. **`plugin.json` stays as it is.** WN1, TV1 and RG1 change
hooks beside you: keep to your rows.

## Setup in your worktree

Run `bun install` in your own worktree. Never link another checkout's `node_modules`. Never read
or run git in another worktree. Tests never touch the real `~/.claude`, `~/.config` or `~/.local`.

## Done-check

1. Tests, each seen failing first: unavailable then available; a park of each kind, and two at once;
   `AskUserQuestion` denied while away and allowed after; a guard's ask turned deny and parked; the
   note said once, and again only when the state or the count changes; a person's prompt while away
   (still away, the note); the list read and cleared by `user-available`'s command side.
2. `bun run build`, then `bun run check` (core-lines and duplicates included) and both
   `claude plugin validate … --strict`.
3. Your own review, then one second opinion: the `cc-smart-dev-kit:reviewer` agent on `opus` at
   `xhigh` (the guards change what may run).
4. Commit a checkpoint after each green step. Never send an empty report.
5. Before you report, stop every background check you started.
