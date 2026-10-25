# B8 — projects in the portal (D14), with each branch's merge verdict

**Goal.** The portal's Settings → Projects shows every project the person works in, from Claude Code's own session records: set-up ones with their settings, others with a "Set up" button that runs `project init` on the page, plus "Add a folder". Each project shows its open pull requests' and crew branches' merge-guard verdict (`workflow merge-check`). UI/UX work (D50): opus.

## Read first
The master plan (`.claude/plans/2026-10-21-master-plan.md`): D14, D49 (the Next.js static export, the strict policy, no Next API routes), D50, D52, the 1.1.0 table row for B8; the audit plan `.claude/plans/archive/2026-10-17-audit-fixes.md` § B8 and § Portal design; `.claude/rules/portal.md` (the door is never relaxed; actions run the CLI's own code; a page asks before it changes anything; never a number the machine cannot give); `portal/README.md`; the app's data client `portal/src/api/` (`client.ts` live client, `adapt.ts`, `wire.ts` — the mirror of `src/portal/api/types.ts`, with the drift test `src/portal/api/wire-mirror.test.ts`); the server's `src/portal/api/` (routes, types, data/work), `src/portal/actions.ts` (`project.preview`, `project.write`), `src/sessions/` (the session records), `src/workflow/merge-check.ts`.

B6c's report named what this page still lacks: project rows' last use, worktree count and "not committed yet"; only the current project is listed today.

## Build
1. The server: `/api/projects` lists every project from the session records (worktrees folded into their main checkout), each with last use, worktree count, whether its project files are committed, its settings; per project, the open pull requests (`gh`, within a time budget, failing soft) and crew branches with their merge verdict from `merge-check` (one home, never a copy).
2. The page: the list, each project's card (settings, verdicts), "Set up" (a preview of the two files, then write, through the existing actions), "Add a folder". Live updates where an event fits.
3. Mirror every new server type in `portal/src/api/wire.ts` (the drift test must pass). Zero CSP violations; no runtime style injectors (no Sonner, Radix Dialog/Select/ScrollArea — use the native `<dialog>` B6c used).

## Files
`portal/src/views/` (the Settings → Projects part only), `portal/src/api/` (the projects types, adapter and client calls only), `src/portal/api/` (the projects route, types, builder), `src/portal/actions.ts` (projects actions only), their tests, `README.md` § The portal, `docs/design.md` § The portal. Another crew session (B6f) works on the Needs-you, crew, guard-log, worktrees and updates pages at the same time: don't touch those views. Change nothing else.

## Done-check
Server tests on fixtures (a temp HOME with session records for two repos, one set up, one not); the drift test; `cd portal && bun install --frozen-lockfile && bun run typecheck && bun run test && bun run build`; drive the built export headless against a test server world (temp HOME, fake gateway, never port 20100; start the server in-process from `src/portal/server.test.ts`'s world helpers and drive it with Playwright headless, with your own small script in your worktree's tmp folder (not committed)), light and dark, phone width too; 0 CSP violations; screenshots in your worktree's tmp folder (name it in your report). Root `bun run typecheck`, `lint`, `check:neutral`, `timeout 900 bun test --timeout 60000 src/portal portal`. **Don't commit `plugin/portal-ui` or `plugin/dist`** (the lead rebuilds them at merge), don't bump the version, never stage `supabase/`, no names (mock data uses `my-app`-style names).
