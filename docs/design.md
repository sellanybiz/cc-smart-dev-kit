# Design

How the `cc-smart-dev-kit` plugin is built, and why. For the phases ahead see `roadmap.md`; for the
Claude Code behaviour it relies on see `claude-code-contract.md`.

Each part has its own page under `docs/design/`; this page is the index. A reference of the
form `docs/design/<page>.md` § *section* names a heading on that page, and
`bun run check:docs` fails when one does not resolve. New to the code: start with the three
parts, then the part you are changing.

## The plugin's parts

| Page | What it holds |
|---|---|
| [The three parts](design/parts.md) | The launcher, why long-running parts run from copies, the Bun it needs, and the two flags on every bun run inside a person's folder. |
| [How the command prints](design/command.md) | One way to print: headings, marked lines, `Fix:` lines, a verdict, and the same words rich or plain. |
| [The installer](design/installer.md) | The one command that does the whole install, and what its first real run taught it. |
| [Instructions, skills and agents](design/instructions.md) | The general text every session loads, the 21 skills, the 5 agents, and the output style. |
| [Per-project opt-in](design/project-json.md) | `.claude/cc-smart-dev-kit.json`: every field, and how a project adds its own part to a general skill. |
| [Updates](design/updates.md) | The hourly background check, the major-version hold, and `cc-smart-dev-kit update`'s steps. |
| [Companion plugins](design/companions.md) | claude-mem and frontend-design: why the plugin does not load without them. |
| [Warp](design/warp.md) | The optional terminal: its signed source, the pinned key, `--warp` and `--remove-warp`. |
| [Notes](design/notes.md) | Neutral by design, keeping up with Claude Code, and the alternatives we did not take. |

## The gateway and its machine

| Page | What it holds |
|---|---|
| [The AI gateway](design/gateway.md) | The router, the five slots and their two modes, the fallback and breaker switches, and the judge. |
| [OmniRoute](design/omniroute.md) | The program the affordable slots answer from, and the three-day rule for a new release. |
| [Heavy jobs](design/jobs.md) | The machine-wide queue: slots, the kinds, the config, and the shared view. |
| [The browser](design/browser.md) | The person's own Google Chrome, the Playwright extension, the required token, and the costs upstream will not fix. |
| [MCP servers at user scope](design/mcp.md) | What `setup` registers, why at user scope, and the Tavily key's order. |
| [Claude Code's retry watchdog](design/retry-watchdog.md) | The three settings, on by default, and the 24-hour cap (D56). |
| [Auto mode reads only user settings](design/auto-mode.md) | Why a project's trust rules are copied into the person's `settings.json`. |

## What changes a user's machine

| Page | What it holds |
|---|---|
| [How `setup` changes user files](design/setup.md) | The managed writers, what is never taken, the lock, backups, `--dry-run`, `restore`, and who changes what and when. |

## Hooks and guards

| Page | What it holds |
|---|---|
| [The hooks](design/hooks.md) | One frame for every hook, the plugin's hooks, the Agent guard, each subagent's usage, the session-escape guard, the Fable-session note, the notifier, the Bash judge and the job route, `doctor --live`, the safe switch, and Claude Code's own worktrees (and the finished ones that clean themselves). |

## The work and its pages

| Page | What it holds |
|---|---|
| [The workflow](design/workflow.md) | What may happen by itself after a step — commit, push, a pull request, a merge — the review record, and the merge guard's one decision. |
| [GitHub Issues](design/issues.md) | The opt-in switch (`workflow.issues`), `cc-smart-dev-kit issue file`, the hidden marker that keeps one finding to one issue, what is refused before anything is sent, the guards, a phase started from an issue (only one the person labelled, its text kept as data, the hand-back comment), and what the later issue parts add. |
| [Lead and the crew](design/crew.md) | The lead and the launch, the caps and the queue, a plan's own folder with its briefs and the record of each crew run, a phase from an issue, the board and the end of a crew session, the crew session's steps and its report, the lead's watch, the crew talks, and the crew's own hooks. |
| [The portal](design/portal.md) | What it is and is not, how it starts (D10), the door, the live stream and the JSON API, the pages' facts and actions, what it runs from, and what a page cannot know. |
| [Sessions and worktrees](design/sessions.md) | Reading Claude Code's saved sessions, reopening the ones a crash or a closed window stopped, confirmed targeted finished-session removal, orphan crew cleanup, stale-lock and cache safety, and the flow report. |
| [Moving a machine from the old names](design/migrate.md) | What 0.2.x left, what `migrate` moves, and the order it moves it in. |

## The rest

| Page | What it holds |
|---|---|
| [claude-mem](design/claude-mem.md) | The memory-use block off and work state on (D68), claude-mem on the gateway's scout slot, the choices from the portal or the command, and the take-over of a value set by hand. |
