# PW1b — the Project page's Workflow card (UI)

## Goal, and why

D57: the person changes one project's workflow from the portal, and the change becomes a pull
request (PW1a built the command, `GET /api/projects/<id>/workflow` and the action
`project.workflow.propose`; read its report and code first — that is your contract, merged before
you start). Today the Project page (`portal/src/views/project.tsx`) shows a project's state and
branches but not its workflow, so the owner could not find where to turn auto-commit, auto-push,
the pull request or auto-merge on for one project; Settings → This machine edits only their own
defaults (`portal/src/views/settings.tsx`, `portal/src/components/settings-rows.tsx`).

## What to build

- A **Workflow** card on a set-up project's page: every setting with its value and a badge for its
  source (This project / Your default / Built-in default), grouped as Settings → This machine
  groups them (reuse `settings-rows.tsx`'s rows and controls — one home, never a second copy).
- Changing a value opens a confirm that says plainly: it opens a pull request into `<base>` that
  changes one line of the project's settings file; it counts once that PR is merged. On confirm,
  the action runs; the result shows in place: the PR's link, or the refusal in words.
- Settings → This machine gets one line pointing to a project's own card ("A project's own value
  wins; change it on the project's page").
- No `gh` login: the card shows the values, the controls are disabled, and one line says what to
  run. A crew session (read-only portal): values only.
- Every state the other cards have: loading, error with retry, empty, reconnecting; light and dark;
  1280, 1024, 768 and 390 px; keyboard and screen-reader labels; no sideways scroll; CSP-clean (the
  export's hashes: `portal/scripts/csp-hashes.ts`).

## Files (change nothing else)

`portal/src/views/project.tsx`, `portal/src/views/settings.tsx`, `portal/src/components/*` (a new
`workflow-card.tsx` if it helps; reuse `settings-rows.tsx`), `portal/src/api/*` only for the client
call if PW1a did not add it; the portal's tests; `plugin/portal-ui/` (rebuilt with
`bun run build:portal`, checked with `bun run check:portal`); `docs/design/portal.md` (the card's
paragraph). No server code: that is PW1a's.

## Done-check

`bun run build:portal` and `bun run check:portal`; the portal app's own tests; drive the page
headless the way B6e did (the test world, every state above, light and dark, the four widths) and
save the key screenshots in your job folder; `bun run check`; your review; your report with the
screenshots' paths.
