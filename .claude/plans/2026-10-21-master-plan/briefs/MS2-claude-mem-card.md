# MS2 — the take-over in the portal's claude-mem card (1.2.0, D63; ui; waits for MS1)

## Goal, and why

The owner (2026-10-24): "there is no option to change the model for claude-mem from the kit
portal". The card has the choices, but it refuses each one on a machine where claude-mem's keys
were set outside the kit. MS1 built the take-over, the `claude-mem` command, and the server action
and API fields the card needs. Read D63 in `.claude/plans/2026-10-21-master-plan.md`, MS1's fields
in `src/portal/api/types.ts`, and the card (`portal/src/components/claude-mem-card.tsx`).

## What the card does

- **A choice that is refused because a value was set by hand** says so in place:
  - which value;
  - that the person can let the kit manage it.

  It offers **Let the kit manage these** (or similar words in the card's voice), with its
  confirmation in the portal's `ConfirmDialog`. The confirmation names the keys, says their values
  stay until the person picks another, and says what `restore` brings back. No page reload: the
  result shows in place.
- **After the take-over,** the route's model list, the key and the fallback change in place, as they
  do on a machine whose values the kit set.
- **The fallback says the truth.** An empty fallback shows as Claude (claude-mem's default) with the
  real model it uses, from MS1's field. Picking Claude and a model from the list (Haiku) works.
- Keep the card's place and look. Light and dark both, phone width and desktop.

## Files (change nothing else)

`portal/src/components/claude-mem-card.tsx`; a shared component, only if the card's confirmation
needs one that does not exist; `plugin/portal-ui/**`, rebuilt with `bun run build:portal`;
`README.md` § claude-mem from the portal, the card's sentences only; `CHANGELOG.md`, in MS1's bullet.

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
3. A UI check of the card, with `/cc-smart-dev-kit:ui-verify` against the mock data, in each state:
   - values set by hand;
   - after the take-over;
   - the fallback empty, then set to Claude with a model;
   - a refusal.

   Judge the screenshots yourself.
4. Your review, then your report.
