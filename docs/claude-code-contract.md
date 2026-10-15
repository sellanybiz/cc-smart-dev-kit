# The Claude Code Contract

The plugin relies on Claude Code behaviour that can change in any release. This page
lists each behaviour, the Claude Code version it was last proved on, and how it is
proved.

- **The tested version** lives in one file: `.claude-code-version` at the repo root. CI
  installs exactly that version for every pull request.
- **A weekly CI job** tests the newest Claude Code (the tests and both validates) and
  opens one issue, labelled `claude-code-upgrade`, when it is newer or a check fails.
- **The `claude-code-upgrade` skill** (`.claude/skills/`) walks this page row by row
  against a new version.
- **Relying on a new behaviour?** Add its row in the same change.

"Live" means a person ran Claude Code with the plugin and looked: the Phase 0 spike, a
throwaway project with a logging hook. From Phase 3, `cc-agentic doctor --live` repeats
those checks. A "unit" proof tests **our reader** on a hand-written copy of Claude
Code's file; it shows we read the shape correctly, not that Claude Code still writes it.

## Hooks

| Behaviour | Last proved on | How it is proved |
|---|---|---|
| An exec-form hook runs: `{"type":"command","command":"bun","args":["${CLAUDE_PLUGIN_ROOT}/dist/<n>.js"]}`. `${CLAUDE_PLUGIN_ROOT}` is filled in inside `args`. | 2.1.300 | live: Phase 0 spike; repeatable with `doctor --live` from Phase 3 |
| SessionStart and PreToolUse hooks fire from a plugin. | 2.1.300 | live: Phase 0 spike; repeatable with `doctor --live` from Phase 3 |
| The hook input's `cwd` follows the session into a worktree. | 2.1.300 | live: Phase 0 spike; repeatable with `doctor --live` from Phase 3 |
| `CLAUDE_PROJECT_DIR` stays at the folder the session started in, also in a worktree. | 2.1.300 | live: Phase 0 spike; repeatable with `doctor --live` from Phase 3 |

## Worktrees

| Behaviour | Last proved on | How it is proved |
|---|---|---|
| WorktreeCreate input has `name`, `cwd` and `session_id`. The hook prints the worktree's folder on stdout. | 2.1.300 | live: Phase 0 spike; repeatable with `doctor --live` from Phase 3 |
| A project's WorktreeCreate and a plugin's both run: two worktrees are made, and the project's path is used. So the plugin's hook must defer. | 2.1.300 | live: Phase 0 spike; repeatable with `doctor --live` from Phase 3 |
| `ExitWorktree` with `remove` needs a WorktreeRemove hook (for a worktree a WorktreeCreate hook made). | 2.1.300 | live: Phase 0 spike; repeatable with `doctor --live` from Phase 3 |

## The plugin on disk

| Behaviour | Last proved on | How it is proved |
|---|---|---|
| Only `plugin/` is copied, to `~/.claude/plugins/cache/<marketplace>/<plugin>/<version>/`. | 2.1.300 | live: Phase 0 spike; repeatable with `doctor --live` from Phase 3 |
| `plugin/bin/` is on the Bash tool's PATH. | 2.1.300 | live: Phase 0 spike; repeatable with `doctor --live` from Phase 3 |
| `CLAUDE_PLUGIN_ROOT` is **not** set in the Bash tool. (So `plugin/bin/cc-agentic` finds `dist/` from its own location.) | 2.1.300 | live: Phase 0 spike; repeatable with `doctor --live` from Phase 3 |
| `plugins/installed_plugins.json` has the shape `{"version":2,"plugins":{"cc@cc-agentic":[{"scope":"user","installPath":"…","version":"…","gitCommitSha":"…"}]}}`. The launcher and `doctor` read the `scope: "user"` entry. | 2.1.300 | live: Phase 0 spike; unit (our reader): `src/setup/launcher.test.ts` › "finds the user-scope entry and its version", "ignores a project-scope install and uses the user-scope one" |
| `plugins/known_marketplaces.json` has the shape `{"<marketplace>":{"source":{"source":"github","repo":"<owner>/<name>"},"installLocation":"…"}}`. | 2.1.300 | live: Phase 0 spike; unit (our reader): `src/setup/marketplace-access.test.ts` › "github: SSH first, then HTTPS" |

`marketplace-access.ts` also reads the source kinds `git` (`url`), `url` (`url`),
`directory` and `file` (`path`). Only `github` was seen live.

## Install and update

| Behaviour | Last proved on | How it is proved |
|---|---|---|
| `claude plugin install` writes `enabledPlugins["cc@cc-agentic"]` and `extraKnownMarketplaces["cc-agentic"]` (with its source) into the user's settings, **without** `autoUpdate`. That is why `setup` sets `autoUpdate: true`. | 2.1.300 | live: Phase 0 spike; unit (our handling): `src/cli/cli.test.ts` › "installs the launcher and turns on auto-update, keeping the other settings" |
| An update makes a new version folder. A running session keeps the old one until Claude Code restarts. | 2.1.300 | live: Phase 0 spike; repeatable with `doctor --live` from Phase 3 |
| Installing from a private GitHub repo works over the user's SSH key. | 2.1.300 | live: Phase 0 spike; unit (`doctor`'s access check): `src/cli/cli.test.ts` › "all green after setup, through the launcher; git reads the marketplace over SSH" |
| `claude plugin validate plugin --strict` and `claude plugin validate . --strict` pass. | 2.1.300 | CI: the "Validate the plugin" and "Validate the marketplace" steps, on `.claude-code-version` and weekly on the newest |

## Auto mode and requests

These were seen in the requests Claude Code sends to a local proxy (a program between
Claude Code and the model's API). From Phase 2, the router logs a request form it does
not know, loudly, so a change shows on the first day.

| Behaviour | Last proved on | How it is proved |
|---|---|---|
| The auto-mode safety check comes in two forms so far. Older: thinking turned off, the answer is `<severity>N`. Newer: the answer is `<block>yes` or `<block>no`, and the request is sent under the session's sonnet model name. | 2.1.300 | live: seen at a local proxy; from Phase 2, the router's log |
| When a safety check fails, Claude Code tries it again on another Claude model. | 2.1.300 | live: seen at a local proxy; from Phase 2, the router's log |
| A subagent's requests carry the header `x-claude-code-agent-id`. Every request carries `x-claude-code-session-id`. | 2.1.300 | live: seen at a local proxy; from Phase 2, the router's log |

## Relied on, not proved yet

The design depends on these, but no test or live check here has proved them. Prove
each one before the phase that needs it, then move it into a table above.

- **The defer check:** a plugin WorktreeCreate hook that exits 0 and prints nothing,
  while the project's own hook makes the worktree. (Phase 3)
- **The default worktree:** without a WorktreeCreate hook, Claude Code makes
  `.claude/worktrees/<name>` on a new branch `worktree-<name>` from `HEAD`. The Phase 0
  spike copied this shape; it was not compared with Claude Code's own result. (Phase 3)
- **An exec-form hook on Windows** runs with `bun.exe`. (Phase 3)
- **Old version folders are deleted 14 days after an update.** (Phase 2, for the copies
  in `~/.local/share/cc/`)
- **`CLAUDE_CODE_PLUGIN_PREFER_HTTPS`** makes Claude Code fetch a `github` marketplace
  over HTTPS. `doctor` tries HTTPS first when it is set; only our reader is tested
  (`src/setup/marketplace-access.test.ts` › "github with CLAUDE_CODE_PLUGIN_PREFER_HTTPS:
  HTTPS first"). (Phase 3)
- **An MCP server served from a plugin gets a new tool-name prefix**, and one
  registered at user scope keeps `mcp__<server>__*`. (Phase 4)
- **An import of `~/.claude/cc/*.md` in `~/.claude/CLAUDE.md`** loads in the main
  session and in subagents; an import in a project's `CLAUDE.md` asks once, then loads.
  (Phase 5)
- **Auto mode reads its rules only from user settings,** not from a project's. (Phase 6)
