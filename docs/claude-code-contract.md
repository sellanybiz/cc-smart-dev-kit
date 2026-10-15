# The Claude Code Contract

The plugin relies on Claude Code behaviour that can change in any release. This page
lists each behaviour, the Claude Code version it was last proved on, and how it is
proved.

- **The tested version** lives in one file: `.claude-code-version` at the repo root. CI
  installs exactly that version for every pull request.
- **A weekly CI job** installs the newest Claude Code, runs the tests and both
  validates, and opens one issue, labelled `claude-code-upgrade`, when it is newer or a
  check fails. **Only the two validates run Claude Code;** the tests do not. So the job
  proves only the validate row below; every other row needs the skill.
- **The `claude-code-upgrade` skill** (`.claude/skills/`) walks this page row by row
  against a new version.
- **Relying on a new behaviour?** Add its row in the same change.

"Live" means a person ran Claude Code with the plugin and looked: the Phase 0 spike, a
throwaway project with a logging hook. From Phase 3, `anymodel doctor --live` repeats
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
| `CLAUDE_PLUGIN_ROOT` is **not** set in the Bash tool. (So `plugin/bin/anymodel` finds `dist/` from its own location.) | 2.1.300 | live: Phase 0 spike; repeatable with `doctor --live` from Phase 3 |
| `plugins/installed_plugins.json` has the shape `{"version":2,"plugins":{"anymodel@anymodel":[{"scope":"user","installPath":"…","version":"…","gitCommitSha":"…"}]}}`. The launcher and `doctor` read the `scope: "user"` entry. | 2.1.300 | live: Phase 0 spike; unit (our reader): `src/setup/launcher.test.ts` › "finds the user-scope entry and its version", "ignores a project-scope install and uses the user-scope one" |
| `plugins/known_marketplaces.json` has the shape `{"<marketplace>":{"source":{"source":"github","repo":"<owner>/<name>"},"installLocation":"…"}}`. | 2.1.300 | live: Phase 0 spike; unit (our reader): `src/setup/marketplace-access.test.ts` › "github: SSH first, then HTTPS" |

`marketplace-access.ts` also reads the source kinds `git` (`url`), `url` (`url`),
`directory` and `file` (`path`). Only `github` was seen live.

## Install and update

| Behaviour | Last proved on | How it is proved |
|---|---|---|
| After `claude plugin marketplace add` and `claude plugin install`, the user's settings hold `enabledPlugins["anymodel@anymodel"]` and `extraKnownMarketplaces["anymodel"]` (with its source), **without** `autoUpdate`. That is why `setup` sets `autoUpdate: true`. (The spike ran both commands before it looked. The docs say `marketplace add` writes the marketplace entry and `install` the enabled plugin.) | 2.1.300 | live: Phase 0 spike; unit (our handling): `src/cli/cli.test.ts` › "installs the launcher and turns on auto-update, keeping the other settings" |
| An update makes a new version folder. A running session keeps the old one until Claude Code restarts. | 2.1.300 | live: Phase 0 spike; repeatable with `doctor --live` from Phase 3 |
| Installing from a private GitHub repo works over the user's SSH key. | 2.1.300 | live: Phase 0 spike; unit (`doctor`'s access check): `src/cli/cli.test.ts` › "all green after setup, through the launcher; git reads the marketplace over SSH" |
| `claude plugin validate plugin --strict` and `claude plugin validate . --strict` pass. | 2.1.300 | CI: the "Validate the plugin" and "Validate the marketplace" steps, on `.claude-code-version` and weekly on the newest |

## Instructions, skills and agents

| Behaviour | Last proved on | How it is proved |
|---|---|---|
| An `@path` import in the user's `<config dir>/CLAUDE.md` loads the imported file into the **main session**: as `@~/.claude/…` (with `HOME` and `CLAUDE_CONFIG_DIR` set to a throwaway folder), as a path relative to that `CLAUDE.md`, and as an absolute path. The managed block's HTML-comment markers do not stop it. | 2.1.300 | live, 2026-10-15: `claude -p` in a throwaway `HOME` and `CLAUDE_CONFIG_DIR` (no login; requests through the local gateway's scout slot), a marker word in the imported file, asked "what is the code word?" — answered with it in all three forms; the control without the import answered "NONE". unit (what setup writes): `src/setup/instructions.test.ts`, `src/cli/cli.test.ts` › "anymodel setup: the instructions" |
| The same import reaches a **general-purpose subagent**. | 2.1.300 | live, 2026-10-15: the same setup; the main session started one `general-purpose` agent whose whole prompt was the question (its transcript shows no code word in the prompt), and it answered with the marker word |
| A plugin's agents and skills are named `<plugin>:<name>` (`anymodel:reviewer`, `anymodel:review`); a plugin's output style is not switched on by loading the plugin. | 2.1.300 | live, 2026-10-15: `claude -p --plugin-dir plugin --output-format stream-json --verbose` in a throwaway config; the init event listed `anymodel:code-explorer`, `anymodel:reviewer`, `anymodel:rules-maintainer`, `anymodel:ui-verifier` and every `anymodel:` skill, with `output_style: default` |

How to repeat the import check by hand: make a folder with `home/.claude/CLAUDE.md` holding
`@~/.claude/anymodel/instructions/marker.md`, put a code word in that file, and run
`claude -p "What is the code word in your instructions? Reply NONE if there is none."` with
`HOME` and `CLAUDE_CONFIG_DIR` pointed there. Without a login there, point
`ANTHROPIC_BASE_URL` at a running gateway and use its scout slot as the model. Never edit
the real `~/.claude/CLAUDE.md` for it.

## The gateway

The request shapes the router (`src/gateway/`) relies on. They were seen in the requests
Claude Code sends to a local proxy (a program between Claude Code and the model's API).
A "unit" proof tests **our router** on a hand-written copy of the shape; the live row is
what a person saw. When Claude Code changes a shape, the unit test still passes: only a
live check or the router's log shows it.

| Behaviour | Last proved on | How it is proved |
|---|---|---|
| With `ANTHROPIC_BASE_URL` set and no `ANTHROPIC_AUTH_TOKEN`, Claude Code sends the person's own login on every request (`authorization`, or `x-api-key`, `cookie`) and the account id in the body's `metadata`. | 2.1.300 | live: seen at a local proxy; unit (our handling): `src/gateway/gateway.test.ts` › "cheap backends never see the Claude login" (all three tests) |
| Requests go to `POST /v1/messages` (`?beta=true`) and `POST /v1/messages/count_tokens`, with `content-type: application/json` and an `anthropic-version` header. | 2.1.300 | live: seen at a local proxy; unit: `gateway.test.ts` › "local-only guard", "count_tokens" |
| Claude Code strips `[1m]` from a model name before it sends it (the docs say so); the router strips it too, in case. | not proved | unit (our handling): `gateway.test.ts` › "routes by name: [1m] suffix, unknown backend prefix, claude-*" |
| `ANTHROPIC_DEFAULT_HAIKU_MODEL` / `…_SONNET_MODEL` make the `haiku` / `sonnet` names (and background calls such as titles) use those model names. | 2.1.300 | live: seen at a local proxy; unit (what `on` writes): `src/gateway/commands.test.ts` › "on: adds our env keys as owned keys, …" |
| The auto-mode safety check has the system prompt "You are a security monitor for autonomous AI coding agents" and offers no tools. Two forms so far. **Older:** model `claude-sonnet-5`, `thinking: {type: "disabled"}`, `<severity>N` answers. **Newer:** under the session's sonnet name (with the gateway on, `anymodel-worker[1m]`), no `thinking` field, `<block>yes` / `<block>no` answers. | 2.1.300 | live: seen at a local proxy; unit: `gateway.test.ts` › "auto mode's safety check" › "is recognised by its system prompt on a claude-* model or a slot, as a string or a block", "a request that offers tools is never taken for the check, whatever its system prompt"; under an old name in the config's aliases: "aliases" › "an old name in the aliases is a name the check can carry; without the alias it is not" |
| A Claude model answers 400 to the older check form's `thinking: disabled` when another model id is put in its place. (Why the judge slot takes no `claude-…` target.) | 2.1.300 | live: seen at a local proxy; unit: `gateway.test.ts` › "the judge slot takes no claude-… target: the check's body would get a 400" |
| When a safety check fails, Claude Code tries it again on another Claude model, with the same prompt. | 2.1.300 | live: seen at a local proxy |
| With `ENABLE_TOOL_SEARCH=true`, Claude Code marks most tools `defer_loading: true`, and its `ToolSearch` answers with `{"type":"tool_reference","tool_name":"…"}` blocks inside a `tool_result`. | 2.1.300 | live: seen at a local proxy; unit: `gateway.test.ts` › "tool search" › "a backend gets found tools as plain definitions, the rest of the deferred ones dropped" |
| `thinking: {type: "disabled"}` is how Claude Code turns reasoning off for short background calls; `output_config.effort` carries the effort. | 2.1.300 | live: seen at a local proxy; unit: `gateway.test.ts` › "reasoning off" (all three tests) |
| Claude Code retries a request that got a 5xx or a broken stream, and reads `retry-after` as whole seconds. | 2.1.300 | live: seen at a local proxy; unit (our handling): `gateway.test.ts` › "fallback" › "the last target's answer is returned whatever it is; its retry-after made whole seconds" |
| A subagent's requests carry the header `x-claude-code-agent-id`. Every request carries `x-claude-code-session-id` (passed on to a cheap backend). | 2.1.300 | live: seen at a local proxy; unit (what a backend gets): `gateway.test.ts` › "cheap backends never see the Claude login" › "first target: allow-listed headers and its own key only; no metadata" |
| A 404 from `count_tokens` makes Claude Code estimate the tokens itself, with no error for the person. | 2.1.300 | live: seen at a local proxy; unit (our answer): `gateway.test.ts` › "count_tokens" › "a slot whose first target is a backend → 404 in Anthropic's shape, no upstream call" |
| Under a slot name, or an old name in the config's `aliases` that points at a `claude-…` model, Claude Code builds the body for a model it does not know, so it can carry fields that `claude-…` target refuses with a 400. Claude Code sends `thinking: {type: "disabled"}` for short background calls (row above); Claude Sonnet 5.5 refuses it and wants `{type: "between_tools"}`, Claude Opus 5.5 refuses it outright (thinking is always on there; the guide's own replacement is `output_config: {effort: "low"}`, which the router adds when no effort is named). Both also refuse a thinking budget, a forced `tool_choice` and non-default `temperature` / `top_p` / `top_k` (Anthropic's migration guides, platform.claude.com/docs/en/models/sonnet-5-5/migration-guide and …/opus-5-5/migration-guide, read 2026-10-15). `requestForClaudeFallback` changes only those fields, and never for auto mode's safety check, which reaches Claude with only `model` changed. | 2.1.300 | live: on 2026-10-15 at 15:43Z a worker request fell back to `claude-sonnet-5-5` after both cheap targets answered 503, and Anthropic answered 400 (another one 26 s later got 200). Which field it refused is **not known**: the router did not log Anthropic's reason then; it does now. unit: `gateway.test.ts` › "a slot's Claude target: only the fields it refuses change" (all tests); under an alias: "aliases" › "an alias to a claude-… target: a request that is not the check gets the fields that model refuses translated", "an alias to a claude-… target: the safety check under it changes only the model"; the check untouched: "auto mode's safety check" › "a check is never translated for its Claude target: only the model changes, on messages and count_tokens" |
| A running session picks up a change to the `env` of `settings.json` without a restart. Seen once: on 2026-10-15 at about 15:36Z, the old gateway's env keys were replaced by `anymodel-…` ones, and from then on not one request with an old model name reached the router: every running session sent `anymodel-worker` at once. **Observed once, not yet repeated.** Seen for keys whose value changed; a key that is removed was not watched. `restore`'s two stages still assume the opposite (`docs/roadmap.md`). | 2.1.300 | live: the router's log during the switch, observed once; no test |
| A request routed to Anthropic is forwarded byte for byte; a cheap backend gets the system prompt and every message's text unchanged. (Ours, not Claude Code's: the guarantee the rows above must not break.) | 2.1.300 | unit: `gateway.test.ts` › "prompts stay as Claude Code wrote them" (all four tests) |

## Relied on, not proved yet

The design depends on these, but no test or live check here has proved them. "The docs
say so" is not proof: a docs page can be ahead of, or behind, the release. Prove each
one before the phase that needs it ("now": at the first real release), then move it
into a table above.

- **The defer check:** a plugin WorktreeCreate hook that exits 0 and prints nothing,
  while the project's own hook makes the worktree. (Phase 3)
- **The default worktree:** without a WorktreeCreate hook, Claude Code makes
  `.claude/worktrees/<name>` on a new branch `worktree-<name>` from `HEAD`. The Phase 0
  spike copied this shape; it was not compared with Claude Code's own result. (Phase 3)
- **An exec-form hook on Windows** runs with `bun.exe`. (Phase 3)
- **Old version folders are deleted 14 days after an update.** The docs say so
  (code.claude.com/docs/en/plugins/loading). The gateway's router runs from a copy in
  `~/.local/share/anymodel/` either way, so a deletion cannot stop it. (Phase 3, with
  `doctor --live`)
- **Installs and updates are keyed by the plugin version.** A manifest that sets
  `version` keeps every user on the cached copy until the version changes
  (code.claude.com/docs/en/plugins/loading). CI's version-bump check
  (`scripts/check-version-bump.ts`) relies on it. (Now)
- **`autoUpdate: true` on the user's `extraKnownMarketplaces` entry** makes Claude Code
  update installed plugins after a session starts. The docs say so
  (code.claude.com/docs/en/plugins/install); an open bug report
  (anthropics/claude-code#61854) says only the catalog refreshes. `doctor`'s "behind the
  marketplace" check catches a missed update either way. (Now)
- **A project's own entry for the same marketplace wins whole.** When more than one
  settings file declares a marketplace of the same name, Claude Code uses the entry of
  the highest-precedence file whole, and inherits none of the user's fields
  (code.claude.com/docs/en/settings-reference#extraknownmarketplaces, from 2.1.228). So
  in such a project, the `autoUpdate` that `setup` writes into user settings may be
  lost. (Now)
- **`DISABLE_AUTOUPDATER=1` also stops plugin updates** unless
  `FORCE_AUTOUPDATE_PLUGINS=1` is set too. The docs say so, and name `DISABLE_UPDATES=1` and
  `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1` as doing the same
  (code.claude.com/docs/en/plugins/loading). `doctor` checks all three, in the
  environment and in the `env` of `settings.json`, and passes when
  `FORCE_AUTOUPDATE_PLUGINS` is set. (Now)
- **Which values count as "set" for these variables.** `doctor` assumes Claude Code
  treats an empty value, `0`, `false`, `no` or `off` as not set. (Now)
- **`CLAUDE_CODE_PLUGIN_PREFER_HTTPS`** makes Claude Code fetch a `github` marketplace
  over HTTPS. `doctor` tries HTTPS first when it is set; only our reader is tested
  (`src/setup/marketplace-access.test.ts` › "github with CLAUDE_CODE_PLUGIN_PREFER_HTTPS:
  HTTPS first"). (Phase 3)
- **An MCP server served from a plugin gets a new tool-name prefix**, and one
  registered at user scope keeps `mcp__<server>__*`. (Phase 4)
- **An import in a project's `CLAUDE.md` of a file outside the project** (the opt-in
  instructions, `@~/.claude/anymodel/instructions/optin/worktrees.md`) asks the person once,
  then loads. The docs say so; `claude -p` cannot show the question. The user-level import is
  proved (§ Instructions, skills and agents). (Phase 5; prove it in an interactive session.)
- **Auto mode reads its rules only from user settings,** not from a project's. (Phase 6)

The row that was here, "a running session keeps the gateway env keys it started with",
is now the gateway table's row "A running session picks up a change to the `env` of
`settings.json` without a restart": the one live look so far saw the opposite.
`restore`'s two stages (`src/cli/gateway-cli.test.ts` › "anymodel restore: the gateway
in two stages", our side only) were built on the old assumption and stay as they are
until the observation is repeated, for a removed key too (`docs/roadmap.md`).
