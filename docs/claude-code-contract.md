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
| An exec-form hook runs: `{"type":"command","command":"${CLAUDE_PLUGIN_ROOT}/bin/anymodel-bun","args":["--missing=<mode>","${CLAUDE_PLUGIN_ROOT}/dist/<n>.js"]}`. `${CLAUDE_PLUGIN_ROOT}` is filled in inside `command` and inside `args`, and the `command` (a `sh` script with execute permission) runs with no shell and no PATH lookup. | 2.1.300 | live: Phase 0 spike (`"command":"bun"`, `${CLAUDE_PLUGIN_ROOT}` inside `args`); Phase 3 rework (this form: every hook of `hooks.json` ran from `--plugin-dir`, with `PATH=/usr/bin:/bin`, which holds no bun); repeatable with `doctor --live` |
| A hook command that is not found does not run, and Claude Code goes on without it: with `"command": "bun"` and no bun on PATH, no plugin hook ran and the Bash call went through unguarded (nothing in the hook log). Through `bin/anymodel-bun` every hook runs: it finds bun from the launcher (`baked_bun=` in `~/.local/bin/anymodel`, `$BUN_INSTALL/bin/bun`, `~/.bun/bin/bun`, then PATH), and with none it answers by its `--missing=` mode (`ask` for a guard, `quiet` otherwise) and exits 0. | 2.1.300 | live: Phase 3 rework, a copy of the plugin with the old form, `PATH=/usr/bin:/bin`: the hook log stayed empty, the session finished; with this branch's plugin and the same PATH (2026-10-15); unit (the shim's order and both modes): `src/hooks/bun-shim.test.ts`, `src/setup/bun-shim.test.ts` |
| SessionStart, UserPromptSubmit, PreToolUse and PostToolUse hooks fire from a plugin (also in `claude -p`). | 2.1.300 | live: Phase 0 spike; Phase 3 (the hook log: `worktree-leftovers` and `session-name` at SessionStart, `session-name` at UserPromptSubmit, `git-guard` and `after-merge` around a Bash call); SessionStart and the git guard's PreToolUse repeated by `doctor --live` |
| A plugin loaded with `--plugin-dir` runs its hooks even when a plugin of the same name is installed and enabled (the installed `anymodel` 0.2.1, with no hooks, was there). | 2.1.300 | live: Phase 3; every `doctor --live` relies on it |
| A `command` without `args`, in a project's `.claude/settings.json`, runs through `sh -c`: `"$HOME/.local/bin/anymodel" hook worktree-create` gets `$HOME` filled in, the hook input on stdin, and its stdout read as the hook's answer; Claude Code's PATH is not needed to find it. | 2.1.300 | live: Phase 3 rework (`claude -p -w feat/x` and EnterWorktree, with `PATH=/usr/bin:/bin`, which holds neither bun nor `~/.local/bin`); `doctor --live` (the engine's repo is wired this way, with the command string pointing at the plugin under test rather than the launcher); unit (the same string through `/bin/sh` and a real launcher): `src/cli/hook-commands.test.ts` › "the exact command a project wires" |
| The hook input's `cwd` follows the session into a worktree. WorktreeRemove's input `cwd`, and its process folder, are the worktree being removed. | 2.1.300 | live: Phase 0 spike; Phase 3 (a logging hook); repeatable with `doctor --live` (the git guard's `cwd` is the worktree; WorktreeRemove finds the repo from its `cwd`) |
| `CLAUDE_PROJECT_DIR` stays at the folder the session started in, also in a worktree. | 2.1.300 | live: Phase 0 spike; repeatable with `doctor --live` from Phase 3 |
| The `hooks` of a settings file have the shape `{"<event>":[{"matcher":"…","hooks":[{"type":"command",…}]}]}`; a matcher is "*" / "" / missing (all), a list of exact names (only letters, digits, `_`, `-`, space, `,`, `\|`), or else an unanchored JavaScript regular expression. (What `anymodel doctor` reads, through `src/hooks/settings-hooks.ts`, to report a project hook running next to a plugin hook. No hook reads these files.) | 2.1.300 | docs (code.claude.com/docs/en/hooks § matcher, read 2026-10-15); unit (our reader): `src/hooks/settings-hooks.test.ts` › "matcherSelects: Claude Code's matcher rules"; the live row below used a project hook of this shape |
| Claude Code's records of the running sessions, `<config folder>/sessions/<pid>.json`, carry `pid`, `sessionId`, `cwd` (it follows the session into a worktree) and `name` (the one ListAgents shows). Not a documented format. (Read by the message guard, the worktree reuse check and the leftovers note.) | 2.1.300 | live: the keys seen on this machine's records, 2026-10-15; unit (our reader): `src/hooks/guards.test.ts` › "the message guard", `worktree-create.test.ts` › "another running session works in the worktree: refused" |
| A hook's input does not say whether the session is interactive or `claude -p` (both carry `session_id`, `transcript_path`, `cwd`, `hook_event_name`, `source`; only the interactive one also had `model`). Its environment does: `CLAUDE_CODE_SESSION_ATTENDED` is `0` in `-p` and `1` interactive (and `CLAUDE_CODE_ENTRYPOINT` is `sdk-cli` against `cli`). The self-update tells a failure only to an attended session. | 2.1.300 | live: a logging SessionStart hook in a throwaway HOME and config folder, `claude -p hi` and an interactive `claude` under `script` (2026-10-15); unit (our side): `src/update/update.test.ts` › "a failure is told to an attended session only …" |
| A `StopFailure` hook runs instead of `Stop` when a turn ends on an API error. Its input has the common fields plus `error` (the matcher value; `rate_limit` for the plan's usage limit **and** for a short rate limit), `last_assistant_message` (the error text Claude Code showed) and, per the docs, an optional `error_details` (absent in all live runs). The common fields include `transcript_path`, the session's transcript (seen live: its file, in `<config>/projects/<project>/<session>.jsonl`). Claude Code ignores its output and exit code (code.claude.com/docs/en/hooks § StopFailure, read 2026-10-15). | 2.1.300 | live (2026-10-15, § Usage limits): one `StopFailure` per stopped turn, in `-p` and interactive, with a `--settings` hook; unit (our reader): `src/hooks/stop-failure.test.ts` › "which stops get an alert" (all tests), "the hook as Claude Code runs it" (all tests) |
| **The plugin's own** `StopFailure` hook (`plugin/hooks/hooks.json`, matcher `rate_limit`) runs: the interactive `claude --plugin-dir <worktree>/plugin` (in tmux, a throwaway HOME, a made-up API key, the test router in front of a fake Anthropic at its plan limit, no `--settings` hook) stopped on the 429, and the hook started the worker through the real launcher script (`~/.local/bin/anymodel alert-worker …`, installed version = the worktree's `plugin/`), which called a fake `notify-send` with the "Use glm-5.3-flash until it resets" action. **In `claude -p` the same hook started but was cut off**: Claude Code exited before it finished (a wrapper logged "started" and never "ended"), so no alert; with a second, `--settings` hook beside it, it finished. With an API key (not a subscription login) Claude Code says "API Error: Request rejected (429) · Rate limit exceeded", so the hook relied on the router's fresh state there. | 2.1.300 | live (2026-10-15, test router on a free port, nothing sent to Anthropic); unit: `src/hooks/stop-failure.test.ts` › "the hook as Claude Code runs it" |
| A hook gets `CLAUDE_PID`, the pid of the Claude Code process, which is also the hook's parent. The self-update records each session under it. | 2.1.300 | live: a logging SessionStart hook in a throwaway config folder (2026-10-15); unit (our side): `src/update/update.test.ts` › "the hook records its session; a record of a process that is gone is dropped" |
| SessionStart hooks run in `claude -p` too, also with no login (the session ends "Not logged in" after the hooks ran). | 2.1.300 | live: throwaway config folder, `claude --plugin-dir … -p hi` (2026-10-15) |
| A process a SessionStart hook starts detached (`setsid`, no pipe to the hook) outlives the hook and the session, and Claude Code does not wait for it. From there, `claude plugin marketplace update anymodel` and `claude plugin update anymodel@anymodel --scope user` work, with the hook's environment (`CLAUDECODE=1`, `CLAUDE_CONFIG_DIR`, …). | 2.1.300 | live: in a throwaway config folder, installed from the real marketplace, set one release behind (installed 0.2.0, the copy on a local commit); a real session start of this build (`--plugin-dir`) installed 0.2.1 in the background, 11 s later (2026-10-15). unit (our side): `src/update/update.test.ts` › "a newer version: the hook returns at once …", which fails when the child holds the hook's stdout |
| A SessionStart hook's JSON answer `{"systemMessage": "…"}` is shown to the person. The self-update uses it once, after a failed background update. | not proved | unit (what we print): `src/update/update.test.ts` › "a failed update: recorded; the next session start says so once, as a systemMessage" |

## Usage limits

What Claude Code does when Anthropic refuses a request for the plan's usage limit, and how
that differs from a short rate limit.

**The answer's shape** comes from Claude Code 2.1.300 itself: its built-in test limiter
(in the binary, the class that sets `anthropic-ratelimit-unified-*` headers) builds the
refusal as status 429, body `{"error":{"type":"rate_limit_error","message":"Rate limit
exceeded"}}`, with `anthropic-ratelimit-unified-status: rejected`,
`anthropic-ratelimit-unified-representative-claim` (`five_hour`, `seven_day`,
`seven_day_opus`, `seven_day_sonnet`), `anthropic-ratelimit-unified-reset` (Unix seconds)
and `retry-after` (seconds to the reset). It counts it as a refusal only while
`anthropic-ratelimit-unified-overage-status` is absent or `rejected` (paid extra usage
takes over otherwise). Public write-ups agree: a request on a subscription login gets the
`anthropic-ratelimit-unified-*` family, an API key the per-minute
`anthropic-ratelimit-requests-*` family (ssdnodes.com/learn/claude-api-rate-limit-headers-explained;
claudecodecamp.com, "I Tried to Reverse Engineer Claude Code's Usage Limits";
github.com/anthropics/claude-code/issues/12829). **A real refusal from Anthropic was not
captured:** no account here was at its limit, so the live runs answered with a fake
Anthropic in that shape.

How the live runs were made (2026-10-15): a fake Anthropic (a small Bun server) on a free
test port, never 20100, forwarding nothing; `claude -p` (and once the interactive `claude`
in tmux) in a temp folder, with `ANTHROPIC_BASE_URL` set for that one process,
`--setting-sources project --strict-mcp-config`, and a `--settings` file with a logging
StopFailure hook (and a status line that saved its input). No request reached Anthropic.

| Behaviour | Last proved on | How it is proved |
|---|---|---|
| **At the plan's usage limit** (the shape above, `five_hour`): Claude Code sends the request **once** and does not retry. `-p` ends with `"result": "You've hit your limit · resets 1:42am (<time zone>)"`, `"api_error": "usage_limit_reached"`, `"api_error_status": 429`. The interactive screen shows the same line, then "Usage limit reached · continuing automatically at <reset> · esc to cancel · /usage-credits to continue now". StopFailure gets `error: "rate_limit"` and that same text as `last_assistant_message`. | 2.1.300 | live (above); unit (our reading of it): `src/gateway/gateway.test.ts` › "model slots (opus, fable)" › "planUsageLimit: only a 429 that says rejected, with no paid extra usage taking over"; `src/hooks/stop-failure.test.ts` › "which stops get an alert" |
| **A short rate limit** (429 `rate_limit_error`, `retry-after: 1`, no unified headers): Claude Code retries it **10 times** (11 requests in 172 s, the waits growing to about 34 s, not the `retry-after`), then ends with "API Error: Server is temporarily limiting requests (not your usage limit) · <Anthropic's message>", `api_error: null`; StopFailure gets `error: "rate_limit"` with that text. | 2.1.300 | live (above); unit: `src/hooks/stop-failure.test.ts` › "a short rate limit, another error, or no gateway: no alert" |
| **No model switch by itself** at the limit: with `--model claude-opus-5-5` and `seven_day_opus` refused (Sonnet would have answered), Claude Code sent one Opus request and stopped; with `--fallback-model claude-sonnet-5-5` too. (Why the router's model slot exists.) | 2.1.300 | live (above) |
| The status line's input has `rate_limits.five_hour` / `rate_limits.seven_day`, each with `used_percentage` (0 to 100) and `resets_at` (Unix seconds), filled from Anthropic's `anthropic-ratelimit-unified-5h-utilization` / `-7d-utilization` (0 to 1) and `-5h-reset` / `-7d-reset` headers: a fake answer with `5h-utilization: 0.87` gave `used_percentage: 87`. Only for a Claude subscription, after the first answer (code.claude.com/docs/en/statusline). After a refused request (the 429 above) the input had no `rate_limits`. | 2.1.300 | live (interactive, above); unit (our reader): `src/cli/statusline.test.ts` (all tests) |
| A model slot's fallback reaches Claude Code as a normal answer: `claude -p --model claude-opus-5-5` through a TEST router (the worktree's `createRouter`, a fake Anthropic at its limit, a fake backend) ended with the backend's text, `is_error: false`. | 2.1.300 | live (2026-10-15, test router on a free port); unit: `gateway.test.ts` › "model slots (opus, fable)" (all tests) |
| Claude Code writes each subagent to `<config>/projects/<project>/<session>/subagents/agent-<id>.jsonl`, beside `agent-<id>.meta.json` (`model`: `opus` / `sonnet` / `haiku`, or none). Each `type: "assistant"` line is one content block of a reply: `message.id`, `message.model` (a cheap backend's own name when a slot answered), `timestamp`, `cwd`. | 2.1.300 | seen in this machine's transcripts (read only); unit (our reader): `src/cli/usage.test.ts` (all tests) |

## Worktrees

| Behaviour | Last proved on | How it is proved |
|---|---|---|
| WorktreeCreate input has `name`, `cwd` and `session_id`. `name` is the name as asked, a `/` included (`feat/y`). The hook prints the worktree's folder on stdout. | 2.1.300 | live: Phase 0 spike; Phase 3 (a logging hook); Phase 3 rework (`claude -p -w feat/x` through the project wiring: the session ran in `<prefix>feat-x`); `doctor --live` |
| **Claude Code's default worktree** (no WorktreeCreate hook): `<repo>/.claude/worktrees/<name>` on a new branch `worktree-<name>`, a `/` in the name becoming `+` in both (`feat/x` → `feat+x`, `worktree-feat+x`); from the remote's default branch (`origin/HEAD`), **not** the local HEAD, unless `worktree.baseRef` is `"head"`; locked (`claude session <name> (pid …)`) while the session runs. `ExitWorktree` with `remove` deletes the folder and the branch. (What a project without the engine gets, and what the engine copies for a subagent's worktree.) | 2.1.300 | live: Phase 3, a throwaway repo with a local "origin" one commit behind the local `main`: the worktree started at `origin/main`; Phase 3 rework (EnterWorktree, then `remove`: folder and branch gone); `doctor --live` (no WorktreeCreate hook ran, the session's git guard ran in `.claude/worktrees/<name>`, then folder and branch gone). The docs (code.claude.com/docs/en/worktrees) say the rest: `worktree.baseRef`, the 24-hour fetch, `.worktreeinclude`. unit (our copy, subagents): `src/hooks/worktree-create.test.ts` › "a subagent's worktree: Claude Code's shape, no setup" |
| A WorktreeCreate hook **replaces** Claude Code's own creation, for sessions and subagents: one that exits 0 and prints nothing, **alone**, makes the creation fail: "The WorktreeCreate hook ran without an error but didn't output a worktree path". There is no fallback to the default. **Why the plugin ships no WorktreeCreate:** it cannot step aside for a project that did not opt in, and a hook-made worktree loses Claude Code's lock, its cleanup marker, `-w "#123"` and its Git LFS handling (`design.md` § The worktree engine). So the engine is opt-in per project. | 2.1.300 | live: Phase 3, EnterWorktree in a throwaway repo with only a silent plugin hook |
| A failing project WorktreeCreate stops the creation and shows its stderr. `claude -p -w <name>`: "Error creating worktree: WorktreeCreate hook failed: `<command>`: `<stderr>`", and the session does not start; EnterWorktree: the tool fails with "WorktreeCreate hook failed: `<command>`: `<stderr>`", and no worktree is made. Seen for the launcher missing (`/bin/sh: 1: …/anymodel: not found`) and for the plugin not installed (the launcher's "anymodel: the anymodel plugin is not installed. Run: claude plugin install anymodel@anymodel"). | 2.1.300 | live: Phase 3 rework, both cases, `-w` and EnterWorktree (the missing launcher simulated by wiring `anymodel-missing`) |
| A project's WorktreeCreate and a plugin's both run: two worktrees are made, and the project's path is used. (Why `anymodel doctor` fails on a second WorktreeCreate next to the engine's.) | 2.1.300 | live: Phase 0 spike |
| A plugin hook that answers with nothing is a hook Claude Code lets pass: proved with a plugin WorktreeCreate that exits 0 and prints nothing next to the project's own (in its `.claude/settings.json`): exactly one worktree, at the project's path, for `claude -w <name>` and for EnterWorktree alike. **This is what `ownHooks` relies on** (`docs/design.md` § The safe switch): a plugin hook listed there exits 0 and prints nothing, so the project's own copy answers alone. (The plugin no longer ships that hook; the silence works the same for the hooks it ships, whose answer is read the same way.) | 2.1.300 | live: Phase 3, twice with a silent probe plugin and once with this plugin (its hook log: `worktree-create` exit 0, empty stdout; one new worktree, the project hook's, where the session ran `pwd`); unit: `src/hooks/matrix.test.ts` › "listed in ownHooks: a plugin hook stays silent (the project's copy answers)" (every hook) |
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

## Instructions, skills and agents

| Behaviour | Last proved on | How it is proved |
|---|---|---|
| An `@path` import in the user's `<config dir>/CLAUDE.md` loads the imported file into the **main session**: as `@~/.claude/…` (with `HOME` and `CLAUDE_CONFIG_DIR` set to a throwaway folder), as a path relative to that `CLAUDE.md`, and as an absolute path. The managed block's HTML-comment markers do not stop it. | 2.1.300 | live, 2026-10-15: `claude -p` in a throwaway `HOME` and `CLAUDE_CONFIG_DIR` (no login; requests through the local gateway's scout slot), a marker word in the imported file, asked "what is the code word?" — answered with it in all three forms; the control without the import answered "NONE". unit (what setup writes): `src/setup/instructions.test.ts`, `src/cli/cli.test.ts` › "anymodel setup: the instructions" |
| The same import reaches a **general-purpose subagent**. | 2.1.300 | live, 2026-10-15: the same setup; the main session started one `general-purpose` agent whose whole prompt was the question (its transcript shows no code word in the prompt), and it answered with the marker word |
| A plugin's agents and skills are named `<plugin>:<name>` (`anymodel:reviewer`, `anymodel:review`); a plugin's output style is not switched on by loading the plugin. | 2.1.300 | live, 2026-10-15: `claude -p --plugin-dir plugin --output-format stream-json --verbose` in a throwaway config; the init event listed `anymodel:code-explorer`, `anymodel:reviewer`, `anymodel:rules-maintainer`, `anymodel:ui-verifier` and every `anymodel:` skill, with `output_style: default` |
| A plugin agent's `skills:` frontmatter loads each named skill's full text into the agent's context at start, with no tool call. A plugin skill is named there as `<plugin>:<name>` (`anymodel:review`); the bare name (`review`) loads nothing. `reviewer` and `rules-maintainer` rely on it for the `anymodel:review` and `anymodel:self-evolve` skills, whose files they have no path to otherwise (the installed plugin's folder has the version in its name). | 2.1.300 | live, 2026-10-15: `claude -p --plugin-dir <copy of plugin/> --model anymodel-scout --permission-mode default --allowedTools Agent` in a throwaway `HOME` and `CLAUDE_CONFIG_DIR` (a placeholder `ANTHROPIC_AUTH_TOKEN` for that one process, so Claude Code starts without a login; the scout slot never sends it on). A probe word was added to the copy's skill only; the main session launched the agent with "Do not use any tool … what is the probe code word?". With `skills: [anymodel:review]` the reviewer answered the word, and with `skills: [anymodel:self-evolve]` the rules maintainer did, neither with a tool call; the control without `skills:` answered NONE, and so did `skills: [review]`. Docs: code.claude.com/docs/en/sub-agents § Preload skills into subagents |

How to repeat the import check by hand: make a folder with `home/.claude/CLAUDE.md` holding
`@~/.claude/anymodel/instructions/marker.md`, put a code word in that file, and run
`claude -p "What is the code word in your instructions? Reply NONE if there is none."` with
`HOME` and `CLAUDE_CONFIG_DIR` pointed there. Without a login there, point
`ANTHROPIC_BASE_URL` at a running gateway and use its scout slot as the model. Never edit
the real `~/.claude/CLAUDE.md` for it.

## Plugin dependencies

Seen live on 2026-10-15 in throwaway config folders (`HOME` and `CLAUDE_CONFIG_DIR` both
under a scratch folder), with this repo's folder added as the `anymodel` marketplace.
Docs: code.claude.com/docs/en/plugins/dependencies (read 2026-10-15).

| Behaviour | Last proved on | How it is proved |
|---|---|---|
| `plugin.json` `dependencies` takes `{"name", "marketplace", "version"}` objects, and `marketplace.json` takes `allowCrossMarketplaceDependenciesOn`; both validates pass `--strict` with them. | 2.1.300 | CI: the two validate steps |
| A dependency comes only from a marketplace the user added. Without it, `claude plugin install anymodel@anymodel` exits 0 with `Warning: dependency "claude-mem@thedotmack" was not installed (no marketplace you have added lists it) … "anymodel" will not load without them`, and `claude plugin list` shows anymodel `✘ failed to load`. (Why `setup` adds the marketplaces.) | 2.1.300 | live; unit (our side): `src/cli/cli.test.ts` › "their marketplaces are not added: setup adds each, which installs the plugin" |
| `claude plugin marketplace add <source>` installs the missing dependencies of installed plugins (`(+ 1 dependency: claude-mem)`), and then anymodel loads. The entry it writes in `installed_plugins.json` carries `"auto": true`. | 2.1.300 | live: by hand, and through `anymodel setup` from this repo's source |
| Without `allowCrossMarketplaceDependenciesOn`, a dependency from another marketplace is not installed, even with that marketplace added: the install exits 0, and anymodel fails to load. | 2.1.300 | live: a copy of this marketplace with the field removed |
| A dependency already installed and enabled at user scope stays as it is: an older claude-mem in range (13.30.0) kept its `installedAt` and `gitCommitSha`. | 2.1.300 | live |
| An installed dependency outside the range stops the install: `Dependency "claude-mem@thedotmack" is installed at 13.28.0, which does not satisfy: >=13.29.0`, and `claude plugin list` shows `Requires "claude-mem@thedotmack" >=13.29.0, installed 13.28.0`. | 2.1.300 | live; unit (doctor's check): `src/cli/cli.test.ts` › "not added, turned off, or outside the range: one ✗ each, with what to run" |
| claude-mem tags its releases `v<version>`, not `claude-mem--v<version>`, and its marketplace points at it by a relative path (`./plugin`). So the range finds no tag, the install takes the marketplace's current copy (13.39.0, no commit suffix), and the range is checked when the plugin loads. A tag-resolved version would carry a 12-character commit suffix (the docs); doctor drops it before the range check. | 2.1.300 | live (`git ls-remote --tags`, and the installed version); unit (our reader): `src/cli/cli.test.ts` › "a version resolved from a git tag carries a commit suffix; the range is checked without it" |
| A dependency with no `version` (frontend-design) is recorded with a commit id as its version (`8f814f49002f`). | 2.1.300 | live |
| `enabledPlugins["<id>"]: true` in user settings means the plugin is on; doctor reads it for each companion. | 2.1.300 | live (the settings after the installs); unit (our reader): `src/cli/cli.test.ts` › "not added, turned off, or outside the range: one ✗ each, with what to run" |

## Auto mode

| Behaviour | Last proved on | How it is proved |
|---|---|---|
| Auto mode reads `autoMode.environment` from the user's `settings.json` and not from a project's `.claude/settings.json`: run in the project, `claude auto-mode config` listed the entry `setup` wrote into user settings, and not the one in the project's own settings. After `restore`, the entry was gone. | 2.1.300 | live: `claude auto-mode config` in a throwaway config; unit (our side): `src/cli/cli.test.ts` › "anymodel setup: the auto-mode block" (all tests) |
| `"$defaults"` in `autoMode.environment` keeps the built-in entries: with it, `claude auto-mode config` gave 22 entries, one of them ours and one the built-in "Trusted repo"; without it, only ours. (Why setup starts a new list with `"$defaults"`.) | 2.1.300 | live: `claude auto-mode config`; unit: `src/setup/managed-entries.test.ts` › "no list yet: creates it with the anchor first, then the entries, all owned" |

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
| The judge answers a safety check only when Claude cannot: Claude first, the judge only on the plan's usage limit (§ Usage limits), a 401, or no login; a short 429 or a 5xx goes back to Claude Code, which then retries or asks the person. (Ours; it relies on the check's shape in the rows above and the limit's shape in § Usage limits.) A judge target must first block a test check built on that shape (`judge-test.ts`). | 2.1.300 | unit: `gateway.test.ts` › "auto mode's safety check" › "judge set, Claude answers: …", "judge set, the plan's usage limit: …", "judge set, a 401 …", "judge set, a 5xx or a short 429: …", "judge not set, the plan's usage limit: …"; `src/cli/gateway-cli.test.ts` › "anymodel gateway slot judge: never set untested" (all tests). Not live: a real auto-mode check was not driven through the fallback |
| Thinking blocks from an Opus history reach a cheap backend as they are, and GLM 5.3 Flash behind OmniRoute takes them: a 3-turn history with a `thinking` block (a made-up signature), and one with a `redacted_thinking` block, both answered 200 with the right text. (A model slot relies on it; it changes no message.) | 2.1.300 | live: measured once, 2026-10-15, through OmniRoute on this machine with the router's OmniRoute key, `max_tokens` 64; not repeated per model |
| **A fallback's thinking block, kept, makes Opus refuse the next turn once.** Turn 1: `claude -p --model claude-opus-5-5` through a TEST router (this worktree's `createRouter`, a free port, Claude Code's own headers forwarded) whose Anthropic was a fake at its plan limit and whose fallback was the real GLM 5.3 Flash through OmniRoute; with the cleaning off (`fallbackAnswersAsIs`, test only) Claude Code stored GLM's answer with a `thinking` block whose `signature` was empty. Turn 2 (`--resume`, the test router now forwarding to the real Anthropic): Opus 5.5 answered **400 "messages.1.content.0: Invalid `signature` in `thinking` block"**; Claude Code 2.1.300 sent the request once more by itself and that one got 200; a third turn got 200 at once. **With the cleaning on** (`cleanFallbackResponse`), Claude Code stored GLM's answer as one text block and turn 2 got 200 at once. A fallback that answered with thinking only was stored as the one text block "(The fallback model answered with thinking only.)", and Opus 5.5 took that history (200). Not seen: the session staying stuck after the 400; the interactive `claude`. 5 real Opus requests in all, tiny prompts. | 2.1.300 | live (2026-10-15); unit: `src/gateway/fallback-answer.test.ts` (all tests); `gateway.test.ts` › "model slots (opus, fable)" › "the fallback's answer reaches Claude Code without its thinking blocks; one log line names it", "Claude's own answer keeps its thinking blocks, byte for byte; the test-only switch keeps the fallback's", "Opus refuses a thinking block's signature after a fallback: a WARN names the cause and /rewind" |
| Claude Code answers a `tool_use` with a `tool_result` whose `tool_use_id` is the `id` it was given (the Messages API's own rule), so a fallback answer's `tool_use` id made safe by the router is the only id the history ever holds; nothing is mapped back. OmniRoute 16.3.5 makes OpenAI-shaped tool call ids safe itself (`sanitizeToolId` in its `openai-to-claude` translator: every character outside `[a-zA-Z0-9_-]` becomes `_`); a backend that passes a provider's own ids through may not. | 2.1.300 | read: the Messages API docs (tool use), OmniRoute 16.3.5's installed source; unit: `fallback-answer.test.ts` › "a whole answer" › "thinking and redacted_thinking blocks go; …", "a streamed answer" › "thinking blocks' events go, …". Not live: no fallback answered with a bad id here |

## Relied on, not proved yet

The design depends on these, but no test or live check here has proved them. "The docs
say so" is not proof: a docs page can be ahead of, or behind, the release. Prove each
one before the phase that needs it ("now": at the first real release), then move it
into a table above.

- **An exec-form hook on Windows** runs with `bun.exe`. The plugin's own hooks run through
  `plugin/bin/anymodel-bun`, a `sh` script, which Windows does not run: the plugin is macOS
  and Linux for now (`docs/design.md` § The plugin's hooks, and the Windows helper that was
  not ported). Making it work there means a Windows shim (a `.cmd`/PowerShell one, or the
  exec form with the bun path), and this row proved again. (Phase 10, on a Windows machine)
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
  (anthropics/claude-code#61854) says only the catalog refreshes, and on 2026-10-15 one
  machine saw neither happen within 15 minutes. So the plugin updates itself
  (`design.md` § Updates), and `doctor`'s "behind the marketplace" check catches a missed
  update either way. (Now)
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
  `FORCE_AUTOUPDATE_PLUGINS` is set; the background self-update skips its check under the
  same rule (`src/update/opt-out.ts`). (Now)
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

The row that was here, "a running session keeps the gateway env keys it started with",
is now the gateway table's row "A running session picks up a change to the `env` of
`settings.json` without a restart": the one live look so far saw the opposite.
`restore`'s two stages (`src/cli/gateway-cli.test.ts` › "anymodel restore: the gateway
in two stages", our side only) were built on the old assumption and stay as they are
until the observation is repeated, for a removed key too (`docs/roadmap.md`).

## Not Claude Code, relied on the same way: systemd and Bun

The router's restart without refused requests (`gateway.md` § The service) relies on
these. They are not Claude Code's, but they can change with a release all the same.

| Behaviour | Last proved on | How it is proved |
|---|---|---|
| `Bun.serve` cannot serve on an inherited listening socket: it has no `fd` option, and an unknown `fd` is ignored (it serves on its default port). `node:http`'s `listen({ fd: 3 })` binds a random port instead. | Bun 1.4.2 | live: `systemd-socket-activate` and a one-file server (2026-10-15); the types: `node_modules/bun-types/serve.d.ts` |
| `node:net`'s `createServer().listen({ fd: 3 })` accepts on the socket systemd passed. | Bun 1.4.2 | live, the same way; test: `src/gateway/listen.test.ts` › "serves its health page and a whole stream on the socket's port, through the relay" |
| `Bun.serve` on a unix socket closes a connection after 10 s with nothing sent unless `idleTimeout: 0` is given (the types allow the option only beside a port; `server.timeout(req, 0)` does not help). | Bun 1.4.2 | live: a 14 s silent answer, three ways (2026-10-15); test: `listen.test.ts` › "a stream silent for 12 s is not cut behind the relay", which fails without the option |
| A socket unit keeps the port open while its service restarts: new connections wait in its queue for the new process. | systemd 259 | live: throwaway units, 0 of 66 requests failed across a restart (2026-10-15) |
| systemd refuses to start a socket unit while its service still runs or drains ("Socket service … already active, refusing"). And when the service's stop runs, a start of its socket waits for that stop to finish; a start of both in one call does not, and fails. | systemd 259 | live: throwaway units (2026-10-15); the start order is asserted in `src/gateway/commands.test.ts` › "the move from the older unit …" |
| `stop --no-block` of the socket and the service in one call closes the port, and no connection starts the router again. | systemd 259 | live: the real `stopRouter` on throwaway units (2026-10-15) |
| A socket-activated service that hits its start limit makes systemd close the socket too (socket result `service-start-limit-hit`), with or without a connection waiting; a waiting connection is reset, later ones are refused. A start within the limit's window fails until `reset-failed`. | systemd 259 | live: throwaway units with a failing `ExecStart`, rendered by `renderUnit` (2026-10-15); the `reset-failed` call is asserted in `src/gateway/commands.test.ts` |
| `Bun.serve` drops a connection whose client ends its sending side (a half close) before it answers, over TCP and a unix socket. | Bun 1.4.2 | live: a one-file probe, 300 ms answer, with and without the client's `end()` (2026-10-15); test (our side): `listen.test.ts` › "a client that half-closes after its request still gets the whole answer" |
| `node:net` in Bun emits no `error` on its server when an accept fails for too many open files; the connection stays in the queue. (Node emits one, and crashes without a listener.) | Bun 1.4.2 | live: a server under `prlimit --nofile=30:30` and 60 clients from another process (2026-10-15); the listener is tested with an emitted error: `listen.test.ts` › "an error the relay's server emits later is logged; the process runs on" |

The two rows that were here for Phase 3 are now in the Worktrees table, both proved live.
"The default worktree" was **wrong** as written: Claude Code starts a new worktree from the
remote's default branch, not from `HEAD` (unless `worktree.baseRef` is `"head"`), and turns
a `/` in the name into `+`. The engine's subagent worktrees follow what was seen.
