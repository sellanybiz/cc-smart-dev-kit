# B6f — the person acts (D52): Needs you, a page per crew session, the guard log, worktrees, updates

**Goal.** The portal is where the person acts, not only watches (D52). Finish the five pages so each shows the full facts and its actions work. UI/UX work (D50): opus.

## Read first
The master plan (`.claude/plans/2026-10-21-master-plan.md`): D49, D50, D51, D52 (read it whole), the 1.1.0 table row for B6f; `.claude/rules/portal.md`; `portal/README.md`; the app's data client `portal/src/api/` (`client.ts`, `adapt.ts`, `wire.ts`, drift test `src/portal/api/wire-mirror.test.ts`) and the stream (`stream.ts`, `refresh.ts`); the server's `src/portal/api/` (`/api/needs`, `/api/crew/<id>`, `/api/guard-asks`, `/api/worktrees`, `/api/update`), `src/portal/actions.ts` (`crew.answer`, `crew.stop`, `crew.resume`, `crew.rm`, `worktrees.clean`, `update.install`), `src/crew/` (store, diff, memory, the merge check), `src/hooks/ask-log.ts`, `src/worktrees/` (the verdict, the auto-clean log).

B6c's report named what is still missing: the crew page's per-file diff, memory over time and the full merge verdict (only totals and the reason today); the Needs-you breaker's waiting count; worktrees' idle time and what auto-clean removed; guard-log paging on the server (the range is applied in the client today).

## Build
1. Server: each missing fact above, from its one home (never a copy), typed in `src/portal/api/types.ts`, mirrored in `portal/src/api/wire.ts`.
2. Pages: Needs you (each crew question with its options and the recommended one, answered by a click → `crew.answer`; a permission wait shows `claude attach <name>` to copy; an open breaker with its waiting count; doctor failures with their fix; a held major update); the crew page (brief, steps timeline, report, per-file diff, memory over time, review, the full merge verdict, Stop/Resume/Remove); the guard log (paged on the server, filters); worktrees (idle time, verdicts, what auto-clean removed, "Clean finished now"); updates (installed, newest, a held major with "Read What's new" and "Install"). Each action asks first in the design's words and shows its result in place, never a reload.
3. Zero CSP violations; no runtime style injectors (native `<dialog>`).

## Files
`portal/src/views/` (these five pages only), `portal/src/api/` (their types, adapters and calls only), `src/portal/api/` (their routes, types, builders), `src/portal/actions.ts` (their actions only), `src/hooks/ask-log.ts` and `src/worktrees/` only to read what the pages need, their tests, `README.md` § The portal, `docs/design.md` § The portal. Another crew session (B8) works on Settings → Projects at the same time: don't touch it. Change nothing else.

## Done-check
Server tests on fixtures (a crew store with a question, a report and a diff; an ask log; worktrees; an update state); the drift test; `cd portal && bun install --frozen-lockfile && bun run typecheck && bun run test && bun run build`; drive the built export headless against a test server world (temp HOME, never port 20100; see `/home/adnan/.claude/jobs/0927c5dd/tmp/b6c/`): answer a question, stop a crew session (cancel at the dialog), page the guard log; light, dark and phone width; 0 CSP violations; screenshots to `/home/adnan/.claude/jobs/0927c5dd/tmp/b6f/`. Root `bun run typecheck`, `lint`, `check:neutral`, `timeout 900 bun test --timeout 60000 src/portal portal`. **Don't commit `plugin/portal-ui` or `plugin/dist`**, don't bump the version, never stage `supabase/`, no names.
