# B6d — the other pages: Overview, Health, Machine, Settings, Work, Flow

**Goal.** Finish the remaining portal pages so every fact the machine can give is on them and every action works. UI/UX work (D50): opus. This starts after B8 (Settings → Projects) is merged.

## Read first
The master plan: D27 (the Work view: the lead with its crew nested, the person's other sessions, Stop and copy attach), D49, D50, D51 (history ranges and filters), D52, D54 (the crew caps), the 1.1.0 table row for B6d; `.claude/rules/portal.md`; `portal/README.md`; the app's data client and stream (`portal/src/api/`, `stream.ts`, `refresh.ts`, the drift test); the server's `src/portal/api/` and `src/portal/actions.ts`; `src/jobs/status.ts` (the heavy-job queue as data, with J2's CPU and I/O weights); `src/gateway/history-read.ts`; `src/sessions/`; `src/portal/facts.ts`.

B6c's report named what is missing: Machine has no `claudeCode`, `bun` or `mcp` facts, and Health has no socket unit — both show as unknown; the Overview's usage windows are empty; other sessions' model and state show only "open" or "idle"; the flow report has no time buckets; the Overview switches and the Machine actions (run doctor, the companions, OmniRoute) are not drawn. J2 added the heavy jobs' weights (`weights` in `/api/jobs`) that the Machine card should show.

## Build
Each missing fact above from its one home (never invented: where the machine cannot say, the page says so), typed and mirrored; the pages draw them: Overview (usage windows, the switches with their actions, the needs-you count, the heavy-jobs tile), Health (the socket unit, history charts with the seven ranges and filters), Machine (versions, MCP servers, the heavy-jobs card with weights, doctor run, companions, OmniRoute), Settings (the machine's workflow and crew caps; Projects is B8's), Work (the lead with its crew nested, other sessions with model and state, Stop and copy attach), Flow (the report in time buckets, 24 h / 7 days). Each action asks first and shows its result in place.

## Files
`portal/src/views/` (these pages; Settings → Projects stays as B8 left it), `portal/src/api/`, `src/portal/api/`, `src/portal/actions.ts`, `src/portal/facts.ts`, their tests, `README.md` § The portal, `docs/design.md` § The portal. Change nothing else.

## Done-check
Server tests on fixtures; the drift test; `cd portal && bun install --frozen-lockfile && bun run typecheck && bun run test && bun run build`; drive the built export headless against a test server world (never port 20100), light, dark, phone width; 0 CSP violations; screenshots to `/home/adnan/.claude/jobs/0927c5dd/tmp/b6d/`. Root `bun run typecheck`, `lint`, `check:neutral`, `timeout 900 bun test --timeout 60000 src/portal portal`. **Don't commit `plugin/portal-ui` or `plugin/dist`**, don't bump the version, never stage `supabase/`, no names.
