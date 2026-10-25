# GW1 — a Claude fallback at its known plan limit is skipped, even as the last target (D65, 1.2.0)

## Goal, and why

**The owner's decision (D65, 2026-10-25):** when a chain's Claude target is already known to be at
its plan limit, the router skips it, even when it is the last target, so a hiccup of the first
target is retried instead of ending the session on Claude's limit.

**What was seen.** The worker slot's chain is `omniroute:codex/gpt-6-luna → claude-sonnet-5-5`, and
Claude Sonnet was at its weekly limit until Oct 29. The router log, 2026-10-25 02:14:29:

```
WARN omniroute:codex/gpt-6-luna answered 502; trying the next target — … "upstream_empty_response"
POST /v1/messages claude-sonnet-5-5 → claude-sonnet-5-5 429 7503ms fallbacks=1
WARN claude-sonnet-5-5 answered 429; returned as it is — … "rate_limit_error" …
```

One empty answer from Codex became Sonnet's plan-limit 429. Claude Code ended the turn on it, and
the crew sessions paused for four days while Codex answered again within seconds. It happened
again a minute later in the same session.

**The cause.** `chain` (`src/gateway/router.ts` ~1954-2060) skips a resting target unless it is the
last, and "an Anthropic last target is always asked, and its answer is the answer" (~2040-2043).
The router already knows the limit: `observeClaude` (~1304) records each Claude model's plan
limit in `limitState.limits` with its reset time.

## The change

1. **In a chain, a Claude target whose plan limit is current** (`limitState.limits` holds it, with
   a reset in the future) **is skipped like a resting target, the last one included, when a target
   before it in this chain was asked and failed.** The outcome then follows the rules that
   already exist for a chain whose last asked target is a backend: with the slot's breaker on and
   every asked target failed for want of capacity, the breaker holds and answers its retryable
   429 (`x-should-retry: true`, `retry-after` ≤ 60, never an `anthropic-ratelimit-unified-*`
   header); with the breaker off, the last asked target's answer goes back as today.
2. **Unchanged:** a chain whose first (or only) target is that Claude model asks it, and its 429
   passes unchanged, so Claude Code, its auto-continue and the StopFailure alert read the real
   limit. A slot with no chain (Claude) is untouched. A limit with no known reset is not skipped
   (today's cooldown rules apply). The judge never holds (`JUDGE_NEVER_HOLDS`). Server-tool
   requests (`serverToolRoute`) are untouched.
3. **An early reset is still seen.** Find how the router re-asks a Claude model at its limit today
   (the gateway skill says "at most every 10 minutes"); a skipped Claude fallback is re-asked on the
   same rule and the same constant, never a second timer. A 200 from it ends the limit as today.
4. **The log and the history say why:** one line per skip, like the resting skip's `note`, naming
   the limit and its reset. The history row stays metadata only (`.claude/rules/gateway.md` §
   Never change prompt text, D51).

Read first: `.claude/rules/gateway.md` whole, `docs/gateway.md` § The breaker switch and its hold,
§ The breaker, and the cooldown rules (~line 1203).

## Docs (same change)

- `.claude/rules/gateway.md` § Every slot the same way: "Anthropic's own answers always pass
  unchanged" gets this one exception, naming D65.
- `docs/gateway.md`: the cooldown paragraph and § The breaker.
- `CHANGELOG.md` `## 1.2.0`: one bullet in plain words.

## Files (change nothing else)

`src/gateway/router.ts`, `src/gateway/gateway.test.ts` (or the router test file the chain tests
live in), `.claude/rules/gateway.md`, `docs/gateway.md`, `CHANGELOG.md` (the `## 1.2.0` text), and
`plugin/dist/router.js` (it changes, on purpose: say so in the report). `plugin.json` stays 1.2.0.
Another phase (RF2) may add an entry to the router's feature list in `router.ts`; keep your change
to the chain and the limit code.

## Setup in your worktree

Run `bun install` in your own worktree. Never link another checkout's `node_modules`. Never read
or run git in another worktree. Tests never touch the live router's port 20100
(`.claude/rules/testing.md`).

## Done-check

1. Tests, each seen failing first: a backend-first chain with its Claude fallback at a current
   limit (Claude not asked; breaker on: the breaker's 429; breaker off: the backend's answer); the
   same with the limit's reset passed (Claude asked); Claude first in the chain (asked, its 429
   unchanged); the re-ask rule for an early reset; a limit with no reset (asked).
2. `bun run build`, then `bun run check` and both `claude plugin validate … --strict`.
3. Your own review, then one second opinion: the `cc-smart-dev-kit:reviewer` agent on `opus` at
   `xhigh` (the router is a risky change).
4. Commit a checkpoint after each green step. Never send an empty report.
5. Before you report, stop every background check you started.
