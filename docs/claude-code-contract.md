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
throwaway project with a logging hook; in Phase 3, throwaway `claude -p` sessions with
`--plugin-dir` and a hook log. The Phase 3 rework's sessions ran with a throwaway Claude
config folder (no login in it) on a cheap model through the local gateway, and with
`--allowedTools`, never a mode that skips permission checks. `anymodel doctor --live`
repeats the rows that name it: the hooks fire, and the worktree contract holds on the
installed Claude Code. A "unit" proof tests **our reader** on a hand-written copy of Claude
Code's file; it shows we read the shape correctly, not that Claude Code still writes it.

## Hooks

| Behaviour | Last proved on | How it is proved |
|---|---|---|
| An exec-form hook runs: `{"type":"command","command":"${CLAUDE_PLUGIN_ROOT}/bin/anymodel-bun","args":["${CLAUDE_PLUGIN_ROOT}/dist/<n>.js"]}`. `${CLAUDE_PLUGIN_ROOT}` is filled in inside `command` and inside `args`, and the `command` (a `sh` script with execute permission) runs with no shell and no PATH lookup. | 2.1.300 | live: Phase 0 spike (`"command":"bun"`); Phase 3 rework (this form: every hook of `hooks.json` ran from `--plugin-dir`, with `PATH=/usr/bin:/bin`, which holds no bun); `doctor --live` |
| A hook command that is not found does not run, and Claude Code goes on without it: with `"command":"bun"` and no bun on PATH, no plugin hook ran and the Bash call went through unguarded. (Why the plugin's hooks run through `bin/anymodel-bun`, which finds bun without PATH.) | 2.1.300 | live: Phase 3 rework, a copy of the plugin with the old form, `PATH=/usr/bin:/bin`: the hook log stayed empty, the session finished; unit (the shim): `src/hooks/bun-shim.test.ts` |
| SessionStart, UserPromptSubmit, PreToolUse and PostToolUse hooks fire from a plugin (also in `claude -p`). | 2.1.300 | live: Phase 0 spike; Phase 3 (the hook log: `worktree-leftovers` and `session-name` at SessionStart, `session-name` at UserPromptSubmit, `git-guard` and `after-merge` around a Bash call); SessionStart and the git guard's PreToolUse repeated by `doctor --live` |
| A plugin loaded with `--plugin-dir` runs its hooks even when a plugin of the same name is installed and enabled (the installed `anymodel` 0.2.1, with no hooks, was there). | 2.1.300 | live: Phase 3; every `doctor --live` relies on it |
| The hook input's `cwd` follows the session into a worktree. WorktreeRemove's input `cwd`, and its process folder, are the worktree being removed. | 2.1.300 | live: Phase 0 spike; Phase 3 (a logging hook); `doctor --live` (the git guard's `cwd` is the worktree; WorktreeRemove finds the repo from its `cwd`) |
| A `command` without `args`, in a project's `.claude/settings.json`, runs through `sh -c`: `"$HOME/.local/bin/anymodel" hook worktree-create` gets `$HOME` filled in, the hook input on stdin, and its stdout read as the hook's answer; Claude Code's PATH is not needed to find it. | 2.1.300 | live: Phase 3 rework (`claude -p -w feat/x` and EnterWorktree, with `PATH=/usr/bin:/bin`, which holds neither bun nor `~/.local/bin`); `doctor --live` (the engine's repo is wired this way); unit (the same string through `/bin/sh` and a real launcher): `src/cli/hook-commands.test.ts` › "the exact command a project wires" |
| `CLAUDE_PROJECT_DIR` stays at the folder the session started in, also in a worktree. | 2.1.300 | live: Phase 0 spike |
| The `hooks` of a settings file have the shape `{"<event>":[{"matcher":"…","hooks":[{"type":"command",…}]}]}`; a matcher is "*" / "" / missing (all), a list of exact names (only letters, digits, `_`, `-`, space, `,`, `\|`), or else an unanchored JavaScript regular expression. (What the defer check reads.) | 2.1.300 | docs (code.claude.com/docs/en/hooks § matcher, read 2026-10-15); unit (our reader): `src/hooks/defer.test.ts` › "matcherSelects: Claude Code's matcher rules"; the live defer row below used a project hook of this shape |
| Claude Code's records of the running sessions, `<config folder>/sessions/<pid>.json`, carry `pid`, `sessionId`, `cwd` (it follows the session into a worktree) and `name` (the one ListAgents shows). Not a documented format. (Read by the message guard, the worktree reuse check and the leftovers note.) | 2.1.300 | live: the keys seen on this machine's records, 2026-10-15; unit (our reader): `src/hooks/guards.test.ts` › "the message guard", `worktree-create.test.ts` › "another running session works in the worktree: refused" |

## Worktrees

| Behaviour | Last proved on | How it is proved |
|---|---|---|
| WorktreeCreate input has `name`, `cwd` and `session_id`. `name` is the name as asked, a `/` included (`feat/y`). The hook prints the worktree's folder on stdout. | 2.1.300 | live: Phase 0 spike; Phase 3 (a logging hook); Phase 3 rework (`claude -p -w feat/x` through the project wiring: the session ran in `<prefix>feat-x`); `doctor --live` |
| **Claude Code's default worktree** (no WorktreeCreate hook): `<repo>/.claude/worktrees/<name>` on a new branch `worktree-<name>`, a `/` in the name becoming `+` in both (`feat/x` → `feat+x`, `worktree-feat+x`); from the remote's default branch (`origin/HEAD`), **not** the local HEAD, unless `worktree.baseRef` is `"head"`; locked (`claude session <name> (pid …)`) while the session runs. `ExitWorktree` with `remove` deletes the folder and the branch. (What a project without the engine gets, and what the engine copies for a subagent's worktree.) | 2.1.300 | live: Phase 3, a throwaway repo with a local "origin" one commit behind the local `main`: the worktree started at `origin/main`; Phase 3 rework (EnterWorktree, then `remove`: folder and branch gone); `doctor --live` (no WorktreeCreate hook ran, the session's git guard ran in `.claude/worktrees/<name>`, then folder and branch gone). The docs (code.claude.com/docs/en/worktrees) say the rest: `worktree.baseRef`, the 24-hour fetch, `.worktreeinclude`. unit (our copy, subagents): `src/hooks/worktree-create.test.ts` › "a subagent's worktree: Claude Code's shape, no setup" |
| A WorktreeCreate hook **replaces** Claude Code's own creation, for sessions and subagents: one that exits 0 and prints nothing, **alone**, makes the creation fail: "The WorktreeCreate hook ran without an error but didn't output a worktree path". There is no fallback to the default. **Why the plugin ships no WorktreeCreate:** it cannot step aside for a project that did not opt in, and a hook-made worktree loses Claude Code's lock, its cleanup marker, `-w "#123"` and its Git LFS handling (`design.md` § The worktree engine). So the engine is opt-in per project. | 2.1.300 | live: Phase 3, EnterWorktree in a throwaway repo with only a silent plugin hook |
| A failing project WorktreeCreate stops the creation and shows its stderr. `claude -p -w <name>`: "Error creating worktree: WorktreeCreate hook failed: `<command>`: `<stderr>`", and the session does not start; EnterWorktree: the tool fails with "WorktreeCreate hook failed: `<command>`: `<stderr>`", and no worktree is made. Seen for the launcher missing (`/bin/sh: 1: …/anymodel: not found`) and for the plugin not installed (the launcher's "anymodel: the anymodel plugin is not installed. Run: claude plugin install anymodel@anymodel"). | 2.1.300 | live: Phase 3 rework, both cases, `-w` and EnterWorktree (the missing launcher simulated by wiring `anymodel-missing`) |
| A project's WorktreeCreate and a plugin's both run: two worktrees are made, and the project's path is used. (Why `anymodel doctor` fails on a second WorktreeCreate next to the engine's.) | 2.1.300 | live: Phase 0 spike |
| **The defer check** silences a plugin hook while the project wires its own for the same event: proved with a plugin WorktreeCreate that exits 0 and prints nothing next to the project's own (in its `.claude/settings.json`): exactly one worktree, at the project's path, for `claude -w <name>` and for EnterWorktree alike. (The plugin no longer ships that hook; the check works the same for the hooks it ships.) | 2.1.300 | live: Phase 3, twice with a silent probe plugin and once with this plugin (its hook log: `worktree-create` exit 0, empty stdout; one new worktree, the project hook's, where the session ran `pwd`); unit: `src/hooks/matrix.test.ts` › "another hook for the same event in the project's settings.json: a plugin hook stays silent, a project-wired one runs" (every hook) |
| A subagent's worktree (`isolation: "worktree"`) is asked for with the name `agent-<17 hex>`. Its SubagentStop input has `cwd` (inside that worktree), `agent_id` (the same hex) and `agent_type`. Claude Code keeps a worktree a hook made for a subagent and runs no WorktreeRemove for it (the docs). | 2.1.300 | live: Phase 3 (a logging hook; then this plugin's `subagent-stop` removed an unchanged subagent worktree and its branch); Phase 3 rework (through the project wiring: the engine made `.claude/worktrees/agent-<hex>`, the subagent's Bash ran there, `anymodel hook subagent-stop` removed it and its branch); unit: `src/hooks/worktree-remove.test.ts` › "SubagentStop" |
| WorktreeRemove input has `worktree_path`, `cwd` and `session_id`, and **no** field that says to discard changes, also when ExitWorktree passed `discard_changes: true`. Exit 0 counts as removed; exit 1 keeps it: "Exited worktree but could not remove it — kept at <path>". | 2.1.300 | live: Phase 3 (a logging hook; then this plugin's `worktree-remove` exited 1 on a worktree with an untracked file, and Claude Code kept it); `doctor --live` (exit 0, removed) |
| `ExitWorktree` with `remove` on a hook-made worktree **outside** the repo is refused unless the call passes `discard_changes: true` (Claude Code "couldn't check the worktree for uncommitted changes"); inside `.claude/worktrees/` it is not. With `discard_changes`, the WorktreeRemove hook is the only check. | 2.1.300 | live: Phase 0 spike; Phase 3 (the first `doctor --live` run, without `discard_changes`: refused for the configured shape, removed for the default one); `doctor --live` passes `discard_changes: true` |

## The plugin on disk

| Behaviour | Last proved on | How it is proved |
|---|---|---|
| Only `plugin/` is copied, to `~/.claude/plugins/cache/<marketplace>/<plugin>/<version>/`. | 2.1.300 | live: Phase 0 spike |
| `plugin/bin/` is on the Bash tool's PATH. | 2.1.300 | live: Phase 0 spike |
| `CLAUDE_PLUGIN_ROOT` is **not** set in the Bash tool. (So `plugin/bin/anymodel` finds `dist/` from its own location.) | 2.1.300 | live: Phase 0 spike |
| `plugins/installed_plugins.json` has the shape `{"version":2,"plugins":{"anymodel@anymodel":[{"scope":"user","installPath":"…","version":"…","gitCommitSha":"…"}]}}`. The launcher and `doctor` read the `scope: "user"` entry. | 2.1.300 | live: Phase 0 spike; unit (our reader): `src/setup/launcher.test.ts` › "finds the user-scope entry and its version", "ignores a project-scope install and uses the user-scope one" |
| `plugins/known_marketplaces.json` has the shape `{"<marketplace>":{"source":{"source":"github","repo":"<owner>/<name>"},"installLocation":"…"}}`. | 2.1.300 | live: Phase 0 spike; unit (our reader): `src/setup/marketplace-access.test.ts` › "github: SSH first, then HTTPS" |

`marketplace-access.ts` also reads the source kinds `git` (`url`), `url` (`url`),
`directory` and `file` (`path`). Only `github` was seen live.

## Install and update

| Behaviour | Last proved on | How it is proved |
|---|---|---|
| After `claude plugin marketplace add` and `claude plugin install`, the user's settings hold `enabledPlugins["anymodel@anymodel"]` and `extraKnownMarketplaces["anymodel"]` (with its source), **without** `autoUpdate`. That is why `setup` sets `autoUpdate: true`. (The spike ran both commands before it looked. The docs say `marketplace add` writes the marketplace entry and `install` the enabled plugin.) | 2.1.300 | live: Phase 0 spike; unit (our handling): `src/cli/cli.test.ts` › "installs the launcher and turns on auto-update, keeping the other settings" |
| An update makes a new version folder. A running session keeps the old one until Claude Code restarts. | 2.1.300 | live: Phase 0 spike |
| Installing from a private GitHub repo works over the user's SSH key. | 2.1.300 | live: Phase 0 spike; unit (`doctor`'s access check): `src/cli/cli.test.ts` › "all green after setup, through the launcher; git reads the marketplace over SSH" |
| `claude plugin validate plugin --strict` and `claude plugin validate . --strict` pass. | 2.1.300 | CI: the "Validate the plugin" and "Validate the marketplace" steps, on `.claude-code-version` and weekly on the newest |

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

- **An exec-form hook on Windows** runs with `bun.exe`. (Phase 10, on a Windows machine)
- **A PreToolUse `ask` from a plugin hook puts the question to the person**, labelled
  `[plugin:anymodel]`, also in auto mode; in `claude -p` nobody can answer, so the call is
  denied and Claude reads the reason. The docs say so (code.claude.com/docs/en/hooks §
  PreToolUse decision control). The git guard relies on it. (Before the first release with
  the guards: one interactive session.)
- **`sessionTitle` in a UserPromptSubmit answer renames the session**, the name ListAgents
  shows included. The docs list the field; the hook this one was ported from saw it work
  on an older Claude Code. (Before the first release with `sessionNames`.)
- **Old version folders are deleted 14 days after an update.** The docs say so
  (code.claude.com/docs/en/plugins/loading). The gateway's router runs from a copy in
  `~/.local/share/anymodel/` either way, so a deletion cannot stop it. (`doctor --live`
  does not prove it: it loads the plugin with `--plugin-dir`, from no version folder.)
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
- **An import of `~/.claude/anymodel/instructions/*.md` in `~/.claude/CLAUDE.md`** loads in the main
  session and in subagents; an import in a project's `CLAUDE.md` asks once, then loads.
  (Phase 5)
- **Auto mode reads its rules only from user settings,** not from a project's. (Phase 6)

The row that was here, "a running session keeps the gateway env keys it started with",
is now the gateway table's row "A running session picks up a change to the `env` of
`settings.json` without a restart": the one live look so far saw the opposite.
`restore`'s two stages (`src/cli/gateway-cli.test.ts` › "anymodel restore: the gateway
in two stages", our side only) were built on the old assumption and stay as they are
until the observation is repeated, for a removed key too (`docs/roadmap.md`).

The two rows that were here for Phase 3 are now in the Worktrees table, both proved live.
"The default worktree" was **wrong** as written: Claude Code starts a new worktree from the
remote's default branch, not from `HEAD` (unless `worktree.baseRef` is `"head"`), and turns
a `/` in the name into `+`. The engine's subagent worktrees follow what was seen.
