# SL1 — the status line always shows the session's context use (1.2.1)

## Goal, and why

Your branch starts from `release-1.2.1` (main after 1.2.0, with 1.1.3, CL2, CL2B, EF2 and WF1
merged). The plan: `.claude/plans/2026-10-21-master-plan.md` § Release 1.2.1.

**The owner's ask (2026-10-25):** the kit's status line always shows the session's context use.
Claude Code shows it only near auto-compact, and has no setting to show it always (the old lead
searched the 2.1.310 binary and found none).

**What exists already:**
- The footer is the kit's own command, `cc-smart-dev-kit statusline` (`src/cli/statusline.ts`;
  the 5h and 7d segments and their warn colour from `alerts.usagePercent`, ~26, ~67-68, ~154;
  `src/cli/usage-window.ts`).
- Claude Code gives it `context_window.total_input_tokens`, `used_percentage` and
  `context_window_size` on every refresh (`docs/claude-code-contract.md`, the row "The status line
  input carries the session's context window", proved on 2.1.308).
- The kit already reads the size (`recordClaudeWindow`, `src/crew/context-window.ts` ~116-138), but
  only for the crew's hand-off. It shows none of it.

## The change

1. **One segment**, for example `ctx 312k · 78% of 400k`.
2. **Measured against the auto-compact window when one is set.** The owner set `/autocompact
   400000`. Claude Code saved it in `~/.claude/settings.json` as
   `modelSettings.<model id>.autoCompactWindow` (here under `claude-opus-5-5`); find whether a
   top-level `autoCompactWindow` is the fallback, and whether project or local settings files may
   set it too (the binary's settings schema on 2.1.310 says "tokens (100000 to 1000000), or
   \"auto\""). With no value, or `"auto"`, measure against `context_window_size`, and find what
   `"auto"` means before you pick. Claude Code's `context_window_size` is the model's full window
   (1M), which is not the point that matters to the owner.
   - Read Claude Code's settings **read-only**, through the kit's existing readers if one fits
     (`src/cli/paths.ts`, `CLAUDE_CONFIG_DIR`); never write them outside `src/setup/`.
   - Match the model by the input's `model.id` the way `context-window.ts` keys it; a `[1m]`
     suffix or an alias must not miss the entry (find how Claude Code itself keys it).
3. **The warn colour** follows `alerts.usagePercent`, as the 5h and 7d segments do.
4. **No segment** when the input has no context data.
5. **Cheap:** the status line runs on every refresh. Read each file once per refresh, and nothing
   more (no git, no network, no second parse of one file).

## Docs

`README.md`'s status line section; `docs/claude-code-contract.md`: extend the context-window row
with `autoCompactWindow` (its keys, the range, `"auto"`), with the version you proved it on and
how.

## Files (change nothing else)

`src/cli/statusline.ts`, `src/cli/usage-window.ts` (only if the segment's colour shares its
helper), `src/crew/context-window.ts` (only if a reader is shared: one home), a reader of Claude
Code's `autoCompactWindow` (one home; name where it lives), their tests, `README.md`,
`docs/claude-code-contract.md`, `plugin/dist/*.js`. **`plugin.json` stays as it is.** LH1 changes
`src/crew/self-watch.ts` (the hand-off's token cap, against the same window): if it should measure
against the auto-compact window too, say so in your report; do not change it.

## Setup in your worktree

Run `bun install` in your own worktree. Never link another checkout's `node_modules`. Never read
or run git in another worktree. Tests never touch the real `~/.claude`, `~/.config` or `~/.local`:
every settings file comes from the test's temporary folder.

## Done-check

1. Tests, each seen failing first: a window with a per-model `autoCompactWindow` (measured
   against it); a top-level one, if that is the fallback; `"auto"` and none (against the model's
   window); a model id with a suffix; past `alerts.usagePercent` (the warn colour); no context data
   (no segment); a settings file that is not valid JSON (no crash, the model's window).
2. `bun run build`, then `bun run check` and both `claude plugin validate … --strict`.
3. Your own review, then one second opinion: the `cc-smart-dev-kit:reviewer` agent on `opus` at
   `xhigh`.
4. Commit a checkpoint after each green step. Never send an empty report.
5. Before you report, stop every background check you started. In the report's `needsLead`, the
   owner's check: the footer in a live session, before and after `/autocompact`.
