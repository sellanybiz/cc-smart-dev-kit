# EF2 — the effort pin on the portal's Slots page (1.2.0, D64; ui; waits for EF1)

## Goal, and why

EF1 built the effort pin. It is one fixed reasoning effort per slot and backend target, set by
`gateway effort <slot> <target> <level>|off`, and it travels in the Slots data. This phase lets the
person see and set it on the portal's Slots page. Read D64 in
`.claude/plans/2026-10-21-master-plan.md`, EF1's fields in `src/portal/api/types.ts`, and the Slots
page.

## What the page does

- **Each backend target in a chain shows its pin,** or "follows Claude Code" when it has none. A
  `claude-…` target shows no control, with one line saying why.
- **Setting the pin:** pick a level, or off. The page asks first, and runs the CLI's own `gateway
  effort` through the portal's action path, never a second copy. The action's test request and
  its result show in place, and so does a backend that refuses the level.
- **The words:** the pin wins over whatever effort Claude Code sends, and a higher effort is slower
  and uses more of the subscription's limit.
- Keep the page's look. Light and dark both, phone width and desktop.

## Files (change nothing else)

The Slots page's components under `portal/src/`; `src/portal/actions*.ts` (the one action, if EF1
did not add it); `plugin/portal-ui/**`, rebuilt with `bun run build:portal`; `README.md` § the Slots
page, the sentences only; `CHANGELOG.md`, inside EF1's bullet.

## Never

- Inline script, a `style` attribute, or anything from the internet (`.claude/rules/portal.md`).
- Pick a level for the person.

## Setup in your worktree

Run `bun install` at the worktree root and in `portal/`, in your own worktree. Never link another
checkout's `node_modules`.

## Done-check

1. `bun run build:portal`, then `bun run check:portal`.
2. `bun run check`.
3. A UI check of each state with `/cc-smart-dev-kit:ui-verify`, against the mock data:
   - no pin;
   - a pin set;
   - a refused level;
   - a `claude-…` target.

   Judge the screenshots yourself.
4. Your review, then your report.
