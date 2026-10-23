# MS1 — claude-mem through the gateway's memory slot (1.2.0, D63)

## Goal, and why

claude-mem, the memory plugin, sends its summaries straight to OmniRoute. In one day that was
about 53,000 calls, 1.28 billion input tokens and 36 million output tokens, so it bypasses every
chain the person sets on the gateway. The owner decided that claude-mem goes through the gateway
on a chain of its own. Their chain is a free OmniRoute model first, then Claude Haiku. Claude
Haiku needs the person's login, which only the router's existing `/v1/messages` path can carry. So
claude-mem uses its own `claude` provider (the Claude Agent SDK), pointed at the router. Read D63 in
`.claude/plans/2026-10-21-master-plan.md` first.

## Facts already read (claude-mem 13.40.0, installed under `~/.claude/plugins/cache/thedotmack/claude-mem/<version>/`; re-read each one in your own copy)

**The gateway setting.** claude-mem's own docs describe it
(`~/.claude/plugins/marketplaces/thedotmack/docs/public/configuration/litellm-gateway.mdx`):
- `ANTHROPIC_BASE_URL` goes in `~/.claude-mem/.env`;
- with it set, the worker "skips Claude OAuth lookup";
- `CLAUDE_MEM_MODEL` "allows any non-empty model string".

**What the worker removes from the environment.** It strips the inherited `ANTHROPIC_BASE_URL`,
`ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN` and stale `CLAUDE_CODE_OAUTH_TOKEN`. It then adds back
only what `.env` holds. The SDK loads no settings files (`settingSources: []`). So the kit's
`ANTHROPIC_BASE_URL` in `~/.claude/settings.json` never reaches it.

**Which model each call uses.** That is `CLAUDE_MEM_MODEL`, or `CLAUDE_MEM_TIER_SUMMARY_MODEL` for
summaries. There are also `CLAUDE_MEM_TIER_SIMPLE_MODEL`, `_FAST_MODEL` and `_SMART_MODEL`, set to
`haiku` / `sonnet` on this machine. A tier left on `haiku` or `sonnet` would reach the **scout** or
**worker** chain by family, not the memory slot.

**claude-mem's own fallback.** `CLAUDE_MEM_QUOTA_FALLBACK_PROVIDER` left empty means Claude in
13.40.0; `off` means no fallback.

**The router.** It routes a request whose model is a slot's key, and any `cc-smart-dev-kit-<name>` is
a slot of the machine's own, with fallback on by default (`src/gateway/targets.ts`, around lines 55,
165 and 397). So `cc-smart-dev-kit-memory` works on today's router once it has a chain. A slot named
in Claude mode gets a 400.

## Step 1 — the proof, before any code. Stop and report if it fails.

Prove each point with a probe server of your own on a free port: a small Bun server that records,
for each request, the path, the `model`, and **only whether** an `authorization` or `x-api-key`
header came, plus its scheme word. **Never record or print a header's value.**

1. Does the Claude Code process the Agent SDK starts carry the person's stored login to the
   base URL?
   - Run it the way claude-mem runs it: the same environment strip, `ANTHROPIC_BASE_URL` set to
     the probe, no settings sources, and the same config folder claude-mem uses.
   - Read that folder in the worker; `CLAUDE_MEM_OBSERVER_CLAUDE_CONFIG_DIR` exists.
   - Use the Agent SDK's own bundled CLI if you can reach it from the installed plugin. Otherwise use
     `claude -p` with the same flags, and say which you used.
2. Is a slot name accepted as the model?
3. How many tokens does one such call send beyond claude-mem's own prompt? That is Claude Code's
   own system prompt and tools, with the SDK's options as claude-mem sets them. Read the
   `system` and `tools` sizes from the probe's request body, then discard the body.
4. Which of claude-mem's model keys does each kind of call use? Read it in the worker.

**If the login does not arrive,** stop. Report it as `blocked` with the facts. The lead decides the
design again. Never set `ANTHROPIC_AUTH_TOKEN` or `ANTHROPIC_API_KEY` anywhere to make it work.

## Step 2 — build (only after step 1 passes)

1. **The route "through the gateway's memory slot".** It writes, through the managed writers
   (`src/setup/`: backup, atomic write, the lock; `restore` puts back exactly what was there):
   - **`~/.claude-mem/.env`:** the one line
     `ANTHROPIC_BASE_URL=http://127.0.0.1:<the router's port, from gateway.json>`. That is a
     managed line in a file that may hold the person's own lines: keep them, at mode 600.
   - **`~/.claude-mem/settings.json`:**
     - `CLAUDE_MEM_PROVIDER=claude`;
     - `CLAUDE_MEM_MODEL`, and every tier model key step 1 found in use, set to the memory slot's
       key, from the one source of slot names;
     - `CLAUDE_MEM_QUOTA_FALLBACK_PROVIDER=off`.
   - **The OpenAI-compatible keys** (base URL, model, key) stay as they are, so `restore` or a route
     change goes back cleanly. Say why in a comment.
   - **When the route is offered:** only when the memory slot has a chain (the kit picks no model)
     and the gateway is on. Otherwise the refusal says what to do, in words:
     `gateway models`, then `gateway slot memory <targets>`.
2. **The memory slot by name.** Make `memory` a slot the kit knows: the CLI's help, `gateway
   status`, and the Slots page list it, with or without a chain. It is the same machine-own slot the
   router already routes; there is no router change unless step 1 shows one is needed. Say so if
   it is. Its fallback is on by default and its breaker follows the default of a machine's own
   slot. Take the name from the one place that lists slot names.
3. **Take over values set by hand: only when the person asks.** Today all five of claude-mem's
   route keys count as "hand", because the kit's ownership file never recorded them. So the
   portal's card refuses every change (`src/machine/claude-mem-choices.ts:229-237` `sourceOf`,
   `:416-433` `handRefusal`).
   - A new action (CLI and portal) records the current values as the kit's, keeping them in the
     backup.
   - It asks first, and its words name the keys and what `restore` does.
   - It is never part of a plain `setup` run.
4. **`setup`.** When the gateway is on, the memory slot has a chain, and claude-mem's route is the
   kit's or not set, setup asks whether to route claude-mem through the memory slot. Every question
   comes first (`.claude/rules/setup-commands.md`). With no memory chain, one next-step line says
   how to set one, and claude-mem stays as it is.
5. **`doctor`.** One claude-mem line:
   - ✓ when it goes through the memory slot, and the slot has a chain;
   - a warning, with the fix, when it goes straight to a backend past the gateway while a memory
     chain exists;
   - a failure, with the fix, when it points at the memory slot and the slot has no chain;
   - and its fallback.
6. **The portal's server side, for MS2.**
   - The actions: the route with the memory option, the take-over, the fallback. Each one is the
     CLI's own function (`.claude/rules/portal.md`).
   - The claude-mem answer carries:
     - the route and who set it;
     - the memory slot's chain and switches, read through the gateway's own reader;
     - whether the take-over is open;
     - every refusal's words.
   - Mirror the types in `portal/src/api/wire.ts`. **No UI changes.**
7. **Docs.**
   - `README.md`: § claude-mem on the gateway, § claude-mem from the portal, and the `setup` and
     `doctor` rows.
   - `docs/gateway.md`: the memory slot, one section.
   - `docs/design/`: the claude-mem page.
   - `docs/claude-code-contract.md`, or its companion section: a row for each claude-mem behaviour
     you rely on (`.env` honoured, OAuth skipped, any model string, `off`). Give each the version
     and how you proved it.
   - `.claude/rules/gateway.md`: the slot list names the memory slot.
   - `CHANGELOG.md`: one `## 1.2.0` bullet.

## Files (change nothing else)

`src/machine/claude-mem*.ts`, `src/setup/` (only a managed key=value line writer if none fits),
`src/cli/setup*.ts`, `src/cli/doctor*.ts` or wherever doctor's claude-mem line is,
`src/cli/restore.ts` (only if needed), `src/gateway/targets.ts` and `src/gateway/commands.ts` (only to
name the memory slot), `src/portal/actions*.ts`, `src/portal/api/**`, `src/portal/facts*.ts` (only
for the Slots page's list), `portal/src/api/**` (types and the mirror only), their tests, the docs
named above, and `plugin/dist/*.js`. If `router.js` changes, say why.

## Never

- Pick a model or write a chain: the person sets the memory chain.
- Set `ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_API_KEY`, `CLAUDE_CODE_SUBAGENT_MODEL` or
  `CLAUDE_CODE_OAUTH_TOKEN` anywhere.
- Print or log a token.
- Change claude-mem's settings outside `src/setup/`.
- Let a test touch the real `~/.claude-mem`, `~/.claude`, `~/.config` or `~/.local`, or the live
  router's port 20100. The probe uses its own port.

## Setup in your worktree

Run `bun install` in your own worktree. Never link another checkout's `node_modules`.

## Done-check

1. Step 1's facts in your report, each with how you proved it.
2. Tests, each seen failing first:
   - the route writes exactly its keys and the `.env` line, and `restore` puts back the previous
     values;
   - every tier key in use names the memory slot;
   - the route is refused with no memory chain;
   - the take-over asks first and records the old values;
   - setup's question appears only when it should;
   - doctor gives each of its lines;
   - the portal action is the CLI's function;
   - the wire mirror holds.
3. `bun run build`, then `bun run check`. A time-limit failure under load only: run that file alone,
   and say so.
4. Your review, then your report. Name the owner's morning check:
   - `gateway slot memory <targets>`;
   - the route from the portal or setup;
   - then `journalctl --user -u cc-smart-dev-kit-router -f`, which should show
     `cc-smart-dev-kit-memory` requests answered by the chain.
