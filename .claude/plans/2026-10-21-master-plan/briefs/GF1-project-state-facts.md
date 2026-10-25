# GF1 — the gateway's project state follows what Claude Code really reads (P6, P7; 1.2.0)

## Goal, and why

Your branch starts from `release-1.2.0` with GP0R merged. The plan:
`.claude/plans/2026-10-21-master-plan.md` § Release 1.2.0.

GP0R proved R6 again on Claude Code 2.1.310, with committed probes, and two facts differ from what
the 1.2.0 code was built on. **Read first, whole:** `.claude/research/2026-10-25-r6-recheck.md`
(the verdict table, and § What changed: every place that relies on a changed fact, with what
breaks), and the corrected P6 and P7 rows in `docs/claude-code-contract.md` § The gateway. The
probes are in `.claude/research/r6-recheck/` (one script per proof).

- **P6:** Claude Code also reads the starting folder's own `.claude/settings.local.json` (a
  subfolder, a linked worktree, a folder outside git). Key by key the main checkout root's local
  file wins; the starting folder's own file comes next, before its shared file and the user file.
- **P7:** a removed key falls through to the next settings file that still sets it (a removed file,
  a removed `env`, a URL removed with another key kept), measured about 1 s later; a running
  session keeps its old value only when no file sets the key. GP5's design (write Anthropic's
  address rather than remove the key) stays right.

## The change

Fix every place § What changed lists, at the cause:

1. **P6, one reader:** `stateFrom` in `src/gateway/project-state.ts` takes the starting folder's own
   local file into `files`, in Claude Code's order, so every reader that uses the view
   (`gateway project status` is the sure trigger; the login-override refusal in
   `src/gateway/commands-project.ts` ~227-245; doctor's model-key and subagent warnings,
   `src/gateway/doctor.ts` ~438, ~454) sees what a session there really runs. No second reader.
2. **P6, restore and `gateway project default`:** a worktree's own copy of the local file (a
   project's `.worktreeinclude` copies it) that holds the router's address must not send that
   worktree's sessions to a stopped router after the main root's key goes. Pick the fix from the
   research (GP5's explicit Anthropic address in the main root wins key by key; or the copies are
   found and handled the same way), say why, and keep every write through `src/setup/`
   (`.claude/rules/setup-and-managed-files.md`: never take what is not ours; a copy the kit did
   not write is reported, not changed, unless the research shows the kit wrote it).
3. **P7, the words:** where the CLI, the portal or the docs tell a person to restart a session for
   a change that already reaches it (`commands-project.ts`'s header, `savedStateLines`'s
   `default` line, `PROJECT_HELP`; `portal/src/lib/gateway.ts` ~95-105 `runningWords` and the Apply
   text; the comments in `src/setup/restore.ts`, `src/gateway/settings.ts`), say what really
   happens, from the proof. `src/cli/restore.ts` `fileUsesRouter` is over-careful, not unsafe:
   change it only if the fix in step 2 needs it.
4. **Tests that pinned the old facts** (`src/gateway/project-state.test.ts` ~6-8, 167, 249-258;
   `commands-project.test.ts` ~391-404; `portal/src/lib/gateway.test.ts` ~157-166) change with the
   fact, each with a new test seen failing first.

## Docs (same change)

`docs/gateway.md`, `docs/design/gateway.md`, `docs/design/portal.md` (~629-630), `docs/roadmap.md`
(~326-329), `README.md` (the places the research names), the gateway skill
(`plugin/skills/gateway/SKILL.md`), `.claude/rules/setup-and-managed-files.md` (only the sentence
the research names), `CHANGELOG.md` `## 1.2.0` (one plain bullet).

## Files (change nothing else)

`src/gateway/project-state.ts`, `src/gateway/commands-project.ts`, `src/gateway/doctor.ts`,
`src/gateway/settings.ts`, `src/setup/restore.ts`, `src/cli/restore.ts` (only if step 2 needs it),
`portal/src/lib/gateway.ts`, their tests, the docs above, `plugin/dist/*.js`, `plugin/portal-ui/**`
(rebuilt by `bun run build:portal`, never by hand). **`plugin.json` stays 1.2.0.**

## Setup in your worktree

Run `bun install` in your own worktree, and `bun install` in `portal/` (for `build:portal`). Never
link another checkout's `node_modules`. Never read or run git in another worktree. Tests never
touch the real `~/.claude`, `~/.config` or `~/.local`, nor port 20100. Never run `gateway`
commands that change this machine.

## Done-check

1. Each fix has a test, seen failing first: a session started in a linked worktree whose own
   local file sets the URL (status, the refusal and doctor see it); the main root's file wins key
   by key; restore and `project default` with a worktree copy; the corrected words.
2. `bun run build`, `bun run build:portal`, then `bun run check`, `bun run check:portal` and both
   `claude plugin validate … --strict`.
3. Your own review, then one second opinion: the `cc-smart-dev-kit:reviewer` agent on `opus` at
   `xhigh` (it changes how the kit writes a person's settings).
4. Commit a checkpoint after each green fix. Never send an empty report.
5. Before you report, stop every background check you started.
