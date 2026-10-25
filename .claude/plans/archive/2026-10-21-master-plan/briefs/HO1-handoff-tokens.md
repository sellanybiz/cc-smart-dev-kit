# HO1 — a crew session hands off at 400k tokens or 70 %, first wins, always before auto-compact (1.2.0)

## Goal, and why

Your branch starts from `release-1.2.0`. The plan: `.claude/plans/2026-10-21-master-plan.md` §
Release 1.2.0, row HO1.

**The owner's question (2026-10-25):** "if auto-compact is set to 400k, will a crew session not
hand back at about 150k?" What the lead found:
- The hand-off share is measured against the model's **full** window (`src/crew/context-window.ts`:
  Claude Code's own `context_window_size`, 1M for Opus 5.5, else the kit's table), not against the
  auto-compact window. So 40 % of a 1M window is about 400k, not 150k.
- **Bug 1:** the hand-off never looks at the auto-compact point. The owner has
  `modelSettings.claude-opus-5-5.autoCompactWindow: 400000` in `~/.claude/settings.json`. If a crew
  session compacts at about 400k, a 40 % hand-off fires at the same point, so compaction can come
  first; with auto-compact at 300k the hand-off never fires. A crew session starts with
  `--autocompact auto` (`CREW_AUTOCOMPACT`, `src/crew/claude.ts` ~33-37), but whether that wins over
  the person's `autoCompactWindow` was never proved.
- **Bug 2:** a percent alone is wrong for small windows: 40 % of a 200k window is 80k.

**The owner's choice:** a crew session hands off at **400k tokens or 70 % of its window, whichever
comes first, and always before the session's real auto-compact point.** A 1M model hands off at
400k, a 200k model at 140k. This takes LH1's `crew.handoffTokens` (1.2.1, `briefs/LH1-load-and-install.md` § 3) into
1.2.0, with 400000 as its default.

## The change

1. **Prove first** what decides a crew session's auto-compact point on the tested Claude Code
   version (`.claude-code-version`): does `--autocompact auto` win over
   `modelSettings.<model id>.autoCompactWindow` (and a top-level `autoCompactWindow`, if one exists;
   and the project and local settings files)? What does `"auto"` mean? At what share of that window
   does Claude Code compact (its reserve)? Read Claude Code's docs and its binary's settings
   schema. A live proof needs `claude --bg`, which a crew session may not run: write the probe (a
   script in `.claude/research/`, its expected output) and ask the lead to run it; go on with the
   rest meanwhile. Record each fact as a row in `docs/claude-code-contract.md`.
2. **`crew.handoffTokens`**: a whole number above zero, default `400000` (`src/workflow/schema.ts`,
   `resolve.ts`, `workflow show`, `workflow set`). `crew.handoffPercent` keeps its default, `70`. A
   crew session hands off at whichever comes first. Both are measured where the share is measured
   today (`src/crew/self-watch.ts`, `transcript.ts`'s `contextUseOf`), never by a second reader of
   the context. The token cap needs no window, so a model whose window the kit cannot know still
   hands off at the cap.
3. **Never at or past auto-compact:** when the proof says a person's `autoCompactWindow` applies to a
   crew session, the hand-off comes a margin before Claude Code would compact (the margin from
   step 1's reserve, named once). When `--autocompact auto` wins, say so, and the guard is the
   model's own compaction point. Read Claude Code's settings **read-only**, through one reader
   (`src/cli/paths.ts` gives the folder; `CLAUDE_CONFIG_DIR`); 1.2.1's SL1 (the status line against
   `autoCompactWindow`, `briefs/SL1-statusline-context.md`) will reuse that reader, so name its home in your report.
   Match the model the way `context-window.ts` keys it (`[1m]`, an alias).
4. **The words:** where the crew frame (`src/crew/brief.ts`), the crew skill
   (`plugin/skills/crew/SKILL.md`) or the lead skill (§ 8) tells when a crew session hands off,
   name both numbers and the auto-compact guard. `README.md` (the `crew.*` rows, ~2443),
   `docs/design/crew.md` (~316, ~632), `CHANGELOG.md` (`## 1.2.0`).
5. The owner's own workflow file sets `crew.handoffPercent` 40; leave it (it is theirs), and say in
   the report what it now means beside the 400k cap.

## Files

`src/crew/self-watch.ts`, `src/crew/context-window.ts`, `src/crew/transcript.ts` (only if the use
needs a token read), `src/crew/claude.ts` (`CREW_AUTOCOMPACT` and its doc only), `src/crew/brief.ts`
(the hand-off words only), `src/workflow/schema.ts`, `src/workflow/resolve.ts`,
`src/testing/fake-workflow.ts`, one read-only reader of Claude Code's auto-compact setting (name its
home; `src/machine/` or `src/cli/`), `plugin/skills/crew/SKILL.md`, `plugin/skills/lead/SKILL.md`
(§ 8 only), `README.md`, `docs/design/crew.md`, `docs/claude-code-contract.md`, `CHANGELOG.md`, a
probe under `.claude/research/`, their tests, `plugin/dist/*.js`. Change nothing else; name each file
outside this list in your report, with why. **`plugin.json` stays 1.2.0.** RV3 changes
`src/crew/start.ts`, `usage-guard.ts` and `wait.ts` beside you; DF1 changes `README.md` and
`CHANGELOG.md` (other rows).

Read first: `.claude/rules/cc-smart-dev-kit-json.md`, `.claude/rules/dynamic.md`, `.claude/rules/testing.md`.

## Setup in your worktree

Run `bun install` in your own worktree. Never link another checkout's `node_modules`. Never read
or run git in another worktree. Tests never touch the real `~/.claude`, `~/.config` or `~/.local`.
Never run `claude --bg`.

## Done-check

1. Tests, each seen failing first: the token cap first (a 1M window, 400k); the percent first (a 200k
   window, 140k); an auto-compact point below both (before it); no auto-compact setting; `"auto"`;
   an unknown window (the cap still applies); the person's own `handoffPercent` kept; a set
   `handoffTokens`; a bad value refused.
2. `bun run build`, then `bun run check` and both `claude plugin validate … --strict`.
3. Your own review, then one second opinion: the `cc-smart-dev-kit:reviewer` agent on `opus` at
   `xhigh` (1.2.0's fixes, the owner's choice).
4. Fill the report's JSON fields (tests, checks, review), not only the prose summary.
5. Commit a checkpoint after each green step. Never send an empty report. Stop every background
   check you started.
