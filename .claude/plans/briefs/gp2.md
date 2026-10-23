# GP2 — the gateway on, off or default per project

## Goal, and why

Today the gateway is all or nothing: `gateway on` points every Claude Code session on the machine
at the router (`ANTHROPIC_BASE_URL` in the user's `~/.claude/settings.json`, `turnOn` in
`src/gateway/settings.ts`). D29 (`.claude/plans/2026-10-21-master-plan.md` § Decisions) and R6
(`.claude/research/archive/2026-10-21-master-plan.md` § R6) let one project choose: **on** (the
router; with `…/p/<profile>` when the project has chains of its own — GP1 built the router side),
**off** (an explicit `ANTHROPIC_BASE_URL=https://api.anthropic.com`, which keeps the claude.ai
login), or **default** (no key: the machine's choice).

**Read GP0's results first** (`.claude/research/2026-10-23-r6-proofs.md` and its contract rows,
merged before you start). Each design point below that rests on a proof says which; a refuted proof
changes the design — stop and report rather than build on it.

## What to build

- **Commands** (`src/gateway/commands.ts`, its usage text, `README.md`):
  - `gateway project status [--folder <dir>]` — this project's effective state and where it comes
    from (the personal file, the team file, the machine, a `--settings` launch is not visible here);
  - `gateway project on|off|default [--team] [--profile <name>] [--folder <dir>]`;
  - `gateway projects` — every project the kit knows (the portal's projects list) with its state;
  - `gateway profile <name> slot <slot> <chain>|off`, `gateway profile <name> fallback <slot> on|off`,
    `gateway profile <name> remove` — the profile's chains in `gateway.json` (`profiles`,
    `src/gateway/config.ts`; GP1's schema and `profileView`), validated like the machine's `slot`
    command (targets from the live list).
- **Where a project's value lives** (R6): the **personal** file by default —
  `<project>/.claude/settings.local.json` (`env.ANTHROPIC_BASE_URL`), with a managed
  `.git/info/exclude` line so it is never committed — and the **team** file
  `<project>/.claude/settings.json` with `--team`, **for `off` and `default` only** (a team file
  never points teammates at one person's local router). Which file wins from a worktree or a
  subfolder: GP0's P6.
- **Every write goes through `src/setup/`** (owned keys, backup, atomic write, lock; the exclude
  line through `applyManagedLine`); `restore` can take each back.
- **Refusals** (one line each, with the fix): a project file that already holds another gateway's
  URL (not ours, not `api.anthropic.com`); any level that sets a login token, `ANTHROPIC_API_KEY`
  or `apiKeyHelper` (the gateway must never replace the person's login); `--team` with `on`; a
  profile name `isProfileName` refuses, or one `gateway.json` does not have.
- **One effective-state reader** (`src/gateway/project-state.ts` or similar): for a folder, the
  resolved state and its source — the one function `gateway project status`, `gateway projects`,
  GP4's doctor lines and GP4's portal card all call. Never a second reader.
- **A running session:** say in the command's output what reaches running sessions and what waits
  for a restart, from GP0's P7.
- Never change this session's own model path: the person runs the command (the gateway skill's
  rule); a test never touches the live router's port 20100 or the real `~/.claude`.

## Files (change nothing else)

`src/gateway/commands.ts`, `src/gateway/settings.ts`, a new `src/gateway/project-state.ts`,
`src/gateway/config.ts` only for the profile commands' writes, their tests; `src/setup/` only if a
writer lacks a capability (say so in the report); `README.md`, `docs/gateway.md` (§ Profiles and a
new § Per project), `docs/design/gateway.md`, `plugin/skills/gateway/SKILL.md` (the commands, in its
style; `bun run check:duplicates`); `plugin/dist/*.js`. The router bundle must not change.

## Done-check

Tests for every command and refusal, in temp projects and a temp `HOME`; `bun run build`;
`bun run check`; your review; your report.
