# Research for 2.2.0: a smarter, cheaper Claude (2026-11-05)

The plan is `.claude/plans/2026-11-05-smarter-claude-2-2.md`. Five read-only research agents and a
second read produced this; the main session re-checked each load-bearing claim against the source.

## Claude Code docs (checked against 2.1.318)

- **Model resolution for a subagent** (code.claude.com/docs/en/sub-agents): the call's `model`,
  then the definition's frontmatter `model`, then `CLAUDE_CODE_SUBAGENT_MODEL`, then the main
  conversation's model. The Agent call takes only the aliases `sonnet`, `opus`, `haiku`, `fable`.
  Effort: `CLAUDE_CODE_EFFORT_LEVEL` beats the call's `effort`, which beats frontmatter.
  2.1.316 added `CLAUDE_CODE_SUBAGENT_EFFORT`; 2.1.317 made an agent on another model use that
  model's saved effort or its default.
- **Effort defaults** (model-config): `high` on every model that supports effort, except Opus
  5.5, Sonnet 5.5 and Haiku 5.5 (`medium`) and Opus 4.7 (`xhigh`). "Opus 5.5 at `medium`
  matches or exceeds Opus 5 at `high`." `max` "may show diminishing returns and is prone to
  overthinking". Effort applies to every output token, tool calls included (platform effort docs).
- **When to delegate** (sub-agents): main conversation for back-and-forth, shared context, a
  quick targeted change, or latency; a subagent for verbose output, tool limits, or
  self-contained work that returns a summary. Each subagent spends its own tokens; an ordinary
  subagent does not read the parent's cache, and a fork does.
- **Opus 5 prompting guide** (platform.claude.com, prompting-claude-opus-5): do not delegate
  work you can finish in a handful of tool calls; do not use subagents to verify or double-check
  your own work; reviews report everything and filter in a separate pass.
- **Prompt caching** (prompt-caching, hooks): hook `additionalContext` is a system reminder
  inserted where the hook fired, so it does not rewrite the cached prefix. Plugin skills,
  commands, agents, hooks and monitors never invalidate the cache. Root CLAUDE.md is read once a
  session. With tool search, the tool list from the first request is kept. `/model` costs a
  cold read; on Opus, Sonnet and Haiku 5.5 and Fable 5.1 an effort change keeps the cache. A
  gateway that strips `cache_control` loses the cache every turn.
- **Context cost** (features-overview, skills): CLAUDE.md and an active output style go on every
  request; every skill description goes on every turn (1,536-character cap); hooks cost nothing
  unless they return context. Agent descriptions over 15,000 tokens in total warn.
- **Output styles**: a custom style drops the built-in engineering section unless
  `keep-coding-instructions: true` (default false). The kit's style sets it.
- **Hook inputs**: SessionStart may carry `model` (absent after `/clear` or a recovery);
  PostModelSwitch carries `from_model`/`to_model`. No hook input carries plan usage.
- **Status line input**: `model.id`, `effort.level`, `rate_limits.five_hour` and `.seven_day`
  (`used_percentage`, `resets_at`; subscribers only, after the first answer), and a
  `prompt_cache` block with `last_miss_cause` and `miss_causes`.
- **Task tools**: TaskCreate/TodoWrite are off by default on newer models since 2.1.268.
  `Monitor` watches output in the background; background Bash runs up to 2 hours.
- **Advisor** (advisor): an experimental pairing of a main model with a stronger one; the
  advisor must rank at or above the main model, and it runs through the Anthropic API only.
- **`/doctor prompt-audit`** (memory, 2.1.283+): flags outdated and conflicting instructions.

## Opus 5.5 effort benchmarks (the owner's table)

| | low | medium | high | xhigh | max |
|---|---|---|---|---|---|
| Terminal-Bench 4.0 | 38.5% | 57.6% | 64.2% | 66.4% | 64.8% |
| AA Intelligence Index | 42 ($0.55) | 51 ($1.34) | 54 ($1.82) | 56 ($3.46) | 58 ($5.98) |
| AutomationBench | 23.3% | 28.6% | 32.0% | 34.4% | 40.0% |

`high` buys most of the gain; `xhigh` and `max` cost 2–3× more again for a few points, and `max`
is not always best.

## The kit, audited (file:line at 2.1.1)

- Conflicts: `core.md:13` unscoped "all workers are subagents"; `plan-task` sends the pieces of
  a two-file change to subagents; `agent-guard.ts:1125-1126` refuses a launch with no `model`/
  `effort` and never reads frontmatter; `verify-gate.ts:194-198` counts every edit;
  `check:context-budget` over budget and not wired; `review-split.js`/`audit-run.js`/
  `research-sweep.js` `sonnet` agents at `max` and unproven findings dropped.
- Cost: fixed context about 4,900 tokens (core 2,226; skill descriptions 2,009; agent
  descriptions 446; tasks MCP instructions 175). Five Bun starts per Bash call. Session-name
  note on every prompt until named; uncapped stop-hook lists. The router keeps the original
  bytes on the normal Anthropic path. No cache breakage found in code.
- Good, kept: no shouting emphasis; the output style keeps coding instructions; stop hooks block
  once per state and respect `stop_hook_active`; the evidence bar.

## claude-mem (15.5.0 installed, 15.9.0 latest)

- 15.0.0 removed `mem_search`: recall is `search` → `timeline` → `get_observations`.
- 15.7.0 fixed the memory-use budget overflow (#5180, PR #5181).
- claude-mem ships `build`, `do`, `release`, `version-bump`, `build-and-release`; `do` pushes
  each phase, `version-bump` commits everything and pushes a tag, `build-and-release` merges.
- My Work auto-refresh (default on) can run logged-in agents outside the note-taker route.
- 15.8.3 fixed a browser installer that uploaded prompt history without consent.
