# UI1 — the portal's sidebar items overlap on hover (1.2.0)

## Goal, and why

Your branch starts from `release-1.2.0`, with RV5 (the portal fixes) merged. The plan:
`.claude/plans/2026-10-21-master-plan.md` § Release 1.2.0, row UI1.

**The owner's report (2026-10-25):** "in the portal UI, in the sidebar, when you hover on a tab they
overlap with each other, so space there." Hovering one sidebar item makes it overlap its
neighbours: the items need room between them.

## The change

1. **See it first.** Build the portal (`bun install` in `portal/` too; `bun run build:portal`), run
   it from your worktree on a free port (never the machine's running portal, never port 20100), and
   use the `cc-smart-dev-kit:ui-verifier` agent (`/cc-smart-dev-kit:ui-verify`) to hover each
   sidebar item: the expanded and the collapsed (icon) sidebar, the mobile sheet, desktop and phone
   widths, light and dark. Name what overlaps (the hover background, the active item's ring, the
   badge, the tooltip, the machine group in `nav-machine.tsx`), with the measured boxes.
2. **The root fix**, in the place that owns it: the sidebar's menu spacing
   (`portal/src/components/nav-main.tsx`, `nav-machine.tsx`, `app-sidebar.tsx`), or the shared
   primitive (`portal/src/components/ui/sidebar.tsx`) only when the fault is there; say which and
   why. Keep the look the portal has (its tokens, its radius); this is a fix, not a new design.
   Check every hover, focus-visible and active state, and the keyboard focus ring, the same way.
3. **See it again** after the fix with the same matrix, and keep the key screenshots (before and
   after) for the lead.

## Files (change nothing else)

`portal/src/components/nav-main.tsx`, `nav-machine.tsx`, `app-sidebar.tsx`,
`portal/src/components/ui/sidebar.tsx` (only if the fault is there), their tests,
`plugin/portal-ui/**` (rebuilt by `bun run build:portal`, never by hand), `CHANGELOG.md`
(`## 1.2.0`, one bullet). **`plugin.json` stays 1.2.0.** Read `.claude/rules/portal.md` first.

## Setup in your worktree

Run `bun install` in your own worktree and in its `portal/`. Never link another checkout's
`node_modules`. Never read or run git in another worktree. Never stop or restart the machine's
own portal.

## Done-check

1. The before and after measurements across the matrix; a test where the portal has one for this
   part (a component test or the export check).
2. `bun run build`, `bun run build:portal`, then `bun run check`, `bun run check:portal` and both
   `claude plugin validate … --strict`.
3. Your own review, then one second opinion: the `cc-smart-dev-kit:reviewer` agent on `opus` at
   `xhigh` (1.2.0's fixes, the owner's choice).
4. Fill the report's JSON fields (tests, checks, review), not only the prose summary; name the
   screenshots' paths.
5. Commit a checkpoint after each green step. Never send an empty report. Stop the portal you
   started and every background check.
