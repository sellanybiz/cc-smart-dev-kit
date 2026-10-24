# TV1 — every session knows what each subagent tier runs now, and picks the effort to match (1.2.1)

## Goal, and why

Your branch starts from `release-1.2.1` (main after 1.2.0, with 1.1.3, CL2, CL2B, EF2 and WF1
merged). The plan: `.claude/plans/2026-10-21-master-plan.md` § Release 1.2.1.

**The owner's ask (2026-10-25):** the instructions must let Claude Code know whether the models
behind the worker and scout slots are Claude models right now, so it picks the effort the task
needs.

**Today:** the general instructions say "an affordable gateway slot runs at `max`"
(`plugin/instructions/core.md` ~73-74), and the subagent-decision skill calls `haiku` and
`sonnet` affordable "while the gateway is on" (`plugin/skills/subagent-decision/SKILL.md` ~75-105).
Nothing tells a session which tier is affordable *now*. The owner's slots change: tonight the
worker slot went from Codex to `claude-sonnet-5-5` alone, and the scout slot to `claude-haiku-5-5`
alone. A session that reads "the gateway is on" picks `max` for Claude Sonnet, which wastes the
plan's usage, and the agent guard allows it (`src/hooks/agent-guard.ts` ~42-45: `max` is required
only for a backend-first chain). The guard knows the truth; the session does not.

## The change

1. **A note to Claude at every session start** (startup, resume, clear, compact): one short line
   per tier the Agent tool's `model` names (`haiku`, `sonnet`, `opus`, `fable`): what really runs
   for this session, and the effort rule that follows. For example:
   `Subagent tiers now: haiku → Claude Haiku, sonnet → Claude Sonnet, opus → Claude Opus: pick the
   effort the task needs (medium, high, xhigh). An affordable backend would say: sonnet →
   <backend model> (runs at max).`
   - Read it the agent guard's way, never a second list: `resolveLaunchModel` and the guard's
     reading of a slot chain's first target, through the session's own gateway view
     (`sessionGatewayOf`, RF2: the session's effective URL and profile).
   - Gateway off, or no config: one line that every tier is Claude, or no note (decide; say why).
   - A crew session gets it too (its frame names its own model; this is about its subagents).
2. **Said again when it changes mid-session**, once: the owner may change a slot while sessions
   run. At `UserPromptSubmit` (or the Agent guard's own PreToolUse, if that is cheaper and still
   reaches Claude before it picks), compare a fingerprint of the view with the one said last in
   this session, and say the new view once. Never at every prompt when nothing changed (each line
   costs context in every session on the machine).
3. **One home for the hook:** extend an existing hook that already runs at `SessionStart` and
   `UserPromptSubmit` on every machine where that fits its job, or add one if none does; say which
   and why. Every rule in `.claude/rules/hooks.md` applies (the frame, quiet output, the
   timeout, `specs.ts`, the entry, `hooks.json`).
4. **The words, in place:**
   - `plugin/instructions/core.md` line ~74: rewrite in place so it says the session-start note
     names what each tier runs now; a Claude model takes the effort its task needs; an
     affordable backend runs at `max`. **The file is at 130 lines, its warning line**
     (`bun run check:core-lines`): it must not grow.
   - `plugin/skills/subagent-decision/SKILL.md`: § Briefing an affordable model and the effort
     lines (~75-105) name an affordable tier by the note, never by "while the gateway is on".
   - `bun run check:duplicates` must pass (no 12-word sentence twice across the plugin's
     instructions and skills).
5. **The agent guard stays as it is**, unless you find it gives a reason that contradicts the
   note: then fix the words, not the rule.

## Files (change nothing else)

The hook you extend or add (`src/hooks/…`, its entry in `src/entries/`, `src/hooks/specs.ts`,
`plugin/hooks/hooks.json` if new), a shared reader in `src/gateway/` or `src/models/` only if one
is needed (one home), their tests, `plugin/instructions/core.md` (the one line),
`plugin/skills/subagent-decision/SKILL.md`, `docs/design/hooks.md`, `docs/design/instructions.md`
if it describes the effort rule, `plugin/dist/*.js`. **`plugin.json` stays as it is.**

## Setup in your worktree

Run `bun install` in your own worktree. Never link another checkout's `node_modules`. Never read
or run git in another worktree. Tests never touch the real `~/.claude`, `~/.config` or `~/.local`,
nor port 20100. Read `.claude/rules/hooks.md` before you touch a hook.

## Done-check

1. Tests, each seen failing first: gateway off; on, with every slot Claude alone (tonight's
   setup); a backend-first chain (that tier says `max`); a Claude-first chain with a backend
   fallback (Claude: by the task); a profile's view; a slot changed mid-session (said once, then
   silent); no change (silent at the next prompt); a config that cannot be read (no crash, said
   plainly).
2. `bun run build`, then `bun run check` (core-lines and duplicates included) and both
   `claude plugin validate … --strict`.
3. Your own review, then one second opinion: the `cc-smart-dev-kit:reviewer` agent on `sonnet` at
   `high`.
4. Commit a checkpoint after each green step. Never send an empty report.
5. Before you report, stop every background check you started.
