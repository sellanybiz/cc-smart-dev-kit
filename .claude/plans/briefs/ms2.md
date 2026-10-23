# MS2 — the portal's claude-mem card for the memory slot (1.2.0, D63; ui; waits for MS1)

## Goal, and why

The owner (2026-10-24): "there is no option to change the model for claude-mem from the kit
portal". MS1 built the route to the gateway's memory slot, the take-over of
values set by hand, and the portal's server actions and API types. This phase is the card the
person uses. Read D63 in `.claude/plans/2026-10-21-master-plan.md`, MS1's answer type in
`src/portal/api/types.ts`, and the card today (`portal/src/components/claude-mem-card.tsx`).

## What the card does

- **Where claude-mem's summaries go:** the gateway's memory slot, recommended once it has a
  chain; a backend directly; or Claude. Each option names who set the current one (the kit,
  the person by hand, or claude-mem's default).
- **The memory slot's chain:** its targets in order, its fallback and breaker switches, and a
  way to change it.
  - Reuse the Slots page's own chain editor and switches as one component, never a copy.
  - Or, if that component cannot be shared, link to the memory slot on the Slots page.
  - With no chain, the card says the kit picks no model, and shows where to set one.
- **Values set by hand:** the take-over button, with its confirmation in its own words: which
  keys, what changes, and what `restore` brings back. It uses the portal's `ConfirmDialog`,
  never a page reload.
- **claude-mem's own fallback:** shown as off when the route is the memory slot (the chain
  decides). Keep today's fallback controls for the other routes only.
- **Every refusal MS1's actions return** shows in place, in words.
- Keep the card's place on the Machine page, and the page's look. Light and dark both,
  phone width and desktop.

## Files (change nothing else)

`portal/src/components/claude-mem-card.tsx`; the Slots page's chain component, only to share it;
their tests if the portal has them; `plugin/portal-ui/**`, rebuilt with `bun run build:portal`;
`README.md` § claude-mem from the portal, the card's sentences only; `CHANGELOG.md`, one line in
MS1's bullet or its own.

## Never

- Inline script, a `style` attribute, or anything from the internet (`.claude/rules/portal.md`
  § The policy stays strict).
- A number or a model the machine cannot give.
- Pick a model for the person.

## Setup in your worktree

Run `bun install` at the worktree root and in `portal/`, in your own worktree. Never link another
checkout's `node_modules`.

## Done-check

1. `bun run build:portal`, then `bun run check:portal`.
2. `bun run check`.
3. A UI check of the card in each state, with `/cc-smart-dev-kit:ui-verify` against the mock data:
   - no memory chain;
   - a chain, with the route not yet on it;
   - routed through the memory slot;
   - values set by hand;
   - a refusal.

   Judge the screenshots yourself.
4. Your review, then your report.
