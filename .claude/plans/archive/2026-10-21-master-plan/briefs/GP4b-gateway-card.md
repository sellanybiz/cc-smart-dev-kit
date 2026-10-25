# GP4b — the Project page's Gateway card (UI)

## Goal, and why

After GP2 a project can be on, off or default on the gateway, with a profile of its own. The
portal's Project page (`portal/src/views/project.tsx`) should show and change that, the way the
Slots page shows the machine's chains. Read GP2's and GP4a's merged code first: the one
effective-state reader, the `gateway project …` and `gateway profile …` commands. The card calls
those commands through portal actions (`src/portal/actions.ts`, `runCliChild` in
`src/portal/cli-child.ts`), never their functions in the server.

## What to build

- **Server:** `GET /api/projects/<id>/gateway` (the state, its source, the profile and its chains
  over the machine's) from the one reader; actions `project.gateway.set` (on / off / default,
  personal or team as GP2 allows) and `project.gateway.profile` (a slot's chain, its fallback), each
  asking first and showing its result in place, as every portal action does. Types in
  `src/portal/api/types.ts` and `portal/src/api/wire.ts` (+ mock).
- **The card:** the state with its source; a control for on / off / default (team only for off and
  default, as GP2 refuses otherwise); when on, an optional profile with its chains shown slot by
  slot over the machine's (reuse the Slots page's chain components — one home); what reaches
  running sessions and what waits for a restart (GP0's P7), in one line; every state the other
  cards have (loading, error, empty, reconnecting), light and dark, 1280/1024/768/390, keyboard and
  screen reader, CSP-clean.
- A crew session (read-only portal): the state only.

## Files (change nothing else)

`src/portal/actions.ts`, `src/portal/api/*`, their tests; `portal/src/views/project.tsx`,
`portal/src/components/*`, `portal/src/api/*`; `plugin/portal-ui/` (`bun run build:portal`,
`bun run check:portal`); `docs/design/portal.md`; `plugin/dist/*.js`.

## Done-check

The portal app's tests; headless drive of every state (the B6e way) with key screenshots in your
job folder; `bun run check`; your review; your report.
