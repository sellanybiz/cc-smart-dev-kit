# MS2 — claude-mem on the gateway's memory slot (1.2.0, D63; waits for MS1)

## Goal, and why

MS1 built the memory slot and the router's `POST /v1/chat/completions` for it (merged before you
start: read `docs/gateway.md` § The memory slot and its tests). This phase points claude-mem at it
from `setup` and from the portal's server side. MS3 then builds the card's UI on the actions and
API types you add here. Read D63 in `.claude/plans/2026-10-21-master-plan.md` first.

## What is wrong today (measured on a live machine, 1.1.2)

- **The portal's claude-mem card cannot change anything.** claude-mem's five route keys
  (provider, preset, base URL, model, API key) were set outside the kit. The kit's ownership
  file records only its two start-block keys, so `sourceOf` calls the route keys "hand"
  (`src/machine/claude-mem-choices.ts:229-237`). `handRefusal` then refuses every route or key
  write: "Nothing was saved: … set by hand" (`:416-433`; called in `chooseRoute` around `:551`
  and in `chooseKey`). "Let setup decide again" is greyed out. Only the fallback can change.
- **A chain change never moves claude-mem.** Only `setup` or "Let setup decide again" re-point it
  (`src/machine/claude-mem.ts:445`), and `setup` leaves a "hand" value alone (`:491-504`).
- **claude-mem's own Claude fallback is on and has fired.** In 13.40.0 an empty
  `CLAUDE_MEM_QUOTA_FALLBACK_PROVIDER` means Claude. Its log shows "memory runs on the Anthropic
  plan (Claude)" 96 times on one day.

## What to build

1. **A new route, "the gateway's memory slot".** It writes:
   - `CLAUDE_MEM_PROVIDER=openai-compatible`;
   - `CLAUDE_MEM_OPENAI_COMPAT_BASE_URL=http://127.0.0.1:<the router's port, from gateway.json>/v1`;
   - `CLAUDE_MEM_OPENAI_COMPAT_MODEL=<the memory slot's key>`, from the one source of slot names;
   - claude-mem's key for that provider set to empty, since the router needs none. Find the exact
     key name in claude-mem's settings list;
   - `CLAUDE_MEM_QUOTA_FALLBACK_PROVIDER=off`, which claude-mem 13.40.0 reads as no fallback.
     Confirm it in the installed `scripts/worker-service.cjs`.

   Every write goes through the managed writers (`src/setup/`: backup, atomic write, the lock),
   and `restore` puts back exactly what was there. **The route is offered only when** the memory
   slot has a chain (the kit picks no model) and the running router serves the path. Use the
   health answer's feature list if it has one, or MS1's addition; never a version-string guess.
   Otherwise the refusal says, in words, what to do: `gateway models`, then
   `gateway slot memory <targets>`, or `gateway setup` for an older router.
2. **Take over values set by hand: only when the person asks.** A new action (CLI and portal)
   records the current hand-set route keys as the kit's, keeping their values in the backup, so
   the route can change and `restore` brings them back. It asks first, and its words say exactly
   which keys and what restore does. Never silent, never part of a plain `setup` run.
3. **`setup`.** When the gateway is set up, the memory slot has a chain, and claude-mem's route is
   the kit's (or not yet set), setup asks whether to route claude-mem through the memory slot.
   Every question comes first (`.claude/rules/setup-commands.md`). With no memory chain, one
   next-step line says how to set one, and claude-mem stays as it is.
4. **`doctor`.** One line for claude-mem's route:
   - through the memory slot, which has a chain and is served: ✓;
   - straight to a backend, past the gateway, while a memory chain exists: a warning with the fix;
   - pointed at the memory slot while it has no chain, or while the router does not serve the
     path: a failure with the fix;
   - and its fallback: `off`, or what it is.
5. **The portal's server side, for MS3:**
   - `src/portal/` actions: the route choice with the memory option, the take-over, and the
     fallback off. Each action is the CLI's own function, never a second copy
     (`.claude/rules/portal.md`).
   - The claude-mem answer in `src/portal/api/` carries what the card needs: the route and who
     set it; the memory slot's chain, fallback and breaker, read from `gateway.json` through the
     gateway's own reader; whether the take-over is open; and every refusal's words.
   - Mirror every type in `portal/src/api/wire.ts` (`src/portal/api/wire-mirror.test.ts`).
   - **No UI changes:** MS3 does those.

## Files (change nothing else)

- `src/machine/claude-mem*.ts`, `src/cli/setup*.ts` (the question and the report only),
  `src/cli/doctor*` or wherever `doctor`'s claude-mem line lives, `src/cli/restore.ts` only if
  restore needs the taken-over values.
- `src/portal/actions*.ts`, `src/portal/api/**`, `portal/src/api/**` (types and the mirror only).
- Their tests.
- `README.md` (§ claude-mem on the gateway, § claude-mem from the portal, the `setup` and `doctor`
  rows), `docs/design/` (the claude-mem page, from `docs/design.md`'s index) and `CHANGELOG.md`
  (one `## 1.2.0` bullet).
- `plugin/dist/*.js`. `router.js` must not change in this phase.

## Never

- Pick a model, or write a chain: the person sets the memory chain.
- Change a value the person set, unless they took it over through the asked action.
- Write claude-mem's settings any way but through `src/setup/`. Tests never touch the real
  `~/.claude-mem`, `~/.claude` or `~/.config`.

## Setup in your worktree

Run `bun install` in your own worktree (and in `portal/` if you run the portal's checks). Never
link another checkout's `node_modules`.

## Done-check

1. Tests, each seen failing first:
   - the route writes exactly the five keys, and `restore` puts back the previous values;
   - the route is refused with no memory chain, and with an older router;
   - the take-over asks first, and records the old values;
   - setup's question appears only when it should;
   - doctor's lines, one test for each state;
   - the portal action calls the CLI's function;
   - the wire mirror matches.
2. `bun run build`, then `bun run check`. A time-limit failure under load only: run that file
   alone, and say so.
3. Your review, then your report. Name the live check the owner runs in the morning: set a
   memory chain, route claude-mem, then watch `journalctl --user -u cc-smart-dev-kit-router -f` for
   `slot memory` lines.
