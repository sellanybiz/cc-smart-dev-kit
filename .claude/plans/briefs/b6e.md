# B6e — verify and judge the whole portal

**Goal.** Before 1.1.0 ships, every portal page is checked the way a person uses it, and its design judged. This starts after B6d and B6f are merged (B8 too). UI/UX judgment (D50): opus decides; measuring may run on any model.

## Read first
`/cc-smart-dev-kit:ui-verify` (the skill: the matrix, the measured checks, the named screenshots, then your own design verdict), `.claude/rules/portal.md`, the master plan's D49–D52 and the 1.1.0 table row for B6e, `portal/README.md`, the earlier screenshots (UI-1 `/home/adnan/.claude/jobs/0927c5dd/tmp/ui1/`, B6c `/home/adnan/.claude/jobs/0927c5dd/tmp/b6c/`) and how they ran the app (`/home/adnan/.claude/jobs/0927c5dd/tmp/ui1-tools/`, the B6c `serve.ts`): the portal refuses to start inside a Claude Code session, so drive the built export through a test server world (temp HOME, fake gateway and backend, never port 20100), never the real portal.

## Do
1. Build the export (`cd portal && bun install --frozen-lockfile && bun run build`) and serve it in a test world with realistic fixtures: a gateway with chains and a held breaker, history rows over 7 days, a crew store with a question and a report, an ask log, worktrees, a held major update, the heavy-job queue with a held and a waiting job.
2. Run `/cc-smart-dev-kit:ui-verify` across every page: desktop, tablet and phone widths, light and dark, the empty, loading, error, no-gateway and reconnecting states, keyboard reach, focus order, contrast, long names and numbers (the break-ui worst cases), and 0 CSP violations.
3. Judge the design yourself from the key screenshots (the verdict is yours, not the measuring agent's), fix what fails, at the root, in the files below.
4. List what only the owner can judge (their real data, their eyes on the flow), with the exact steps to see each.

## Files
`portal/src/` (fixes only), `src/portal/` (fixes only), their tests. Change nothing else.

## Done-check
Every finding fixed or listed with its reason; portal typecheck, tests and build; root `bun run typecheck`, `lint`, `check:neutral`, `timeout 900 bun test --timeout 60000 src/portal portal`; screenshots to `/home/adnan/.claude/jobs/0927c5dd/tmp/b6e/`. **Don't commit `plugin/portal-ui` or `plugin/dist`**, don't bump the version, never stage `supabase/`, no names.
