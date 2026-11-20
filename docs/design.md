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
| [Instructions, skills and agents](design/instructions.md) | The general text every session loads, the skills, the 5 agents, and the output style. |
| [Per-project opt-in](design/project-json.md) | `.claude/cc-smart-dev-kit.json`: every field, and how a project adds its own part to a general skill. |
| [Updates](design/updates.md) | The hourly background check, the major-version hold, and `cc-smart-dev-kit update`'s steps. |
| [Companion plugins](design/companions.md) | claude-mem and frontend-design: why the plugin does not load without them. |
| [Notes](design/notes.md) | Neutral by design, keeping up with Claude Code, and the alternatives we did not take. |

## The gateway and its machine

| Page | What it holds |
|---|---|
| [The AI gateway](design/gateway.md) | The router, the five slots and their two modes, the fallback and breaker switches, and the judge. |
| [OmniRoute](design/omniroute.md) | The program the affordable slots answer from, and the three-day rule for a new release. |
| [Heavy jobs](design/jobs.md) | The machine-wide queue: its slots (one by default), heavy kinds, the CPU and memory caps and the shared status view. |
| [The browser](design/browser.md) | The person's own Google Chrome, the Playwright extension, the required token, and the costs upstream will not fix. |
| [MCP servers at user scope](design/mcp.md) | What `setup` registers, why at user scope, and the Tavily key's order. |
| [Claude Code's retry watchdog](design/retry-watchdog.md) | The three settings, on by default, and the 24-hour cap (D56). |
| [Auto mode reads only user settings](design/auto-mode.md) | Why a project's trust rules are copied into the person's `settings.json`. |

## What changes a user's machine

| Page | What it holds |
|---|---|
| [How `setup` changes user files](design/setup.md) | The managed writers, what is never taken, the lock, backups, `--dry-run`, `restore`, and who changes what and when. |

## Hooks

| Page | What it holds |
|---|---|
| [The hooks](design/hooks.md) | One frame for every hook, the plugin's hooks, each subagent's usage, the keep-going stop, the away state, the Fable-session note, notification retirement, the Bash judge and the job route (the kit's one guard), `doctor --live`, the safe switch, the hooks retired in 5.7.0, and Claude Code's own worktrees (and the finished ones that clean themselves). |

## The work and its pages

| Page | What it holds |
|---|---|
| [The kit's task list](design/tasks.md) | The subagent ledger: plan, phase and step tasks; agent, branch, worktree and base; reports, rulings and dependencies. Plans handed to children: file lists, the reservation, the take and start refusals and the classifier. Deploy tasks for prod and staging, the release gates, the CI check, and the deploy-skill block. |
| [The workflow](design/workflow.md) | What may happen by itself after a step — commit, push, a pull request, a merge — the review record, the merge judgment (`workflow merge-check`), and the plan settings `plans.runMode` and `plans.mergeFiles`. |
| [GitHub Issues](design/issues.md) | The switch (`workflow.issues`, on by default since 5.0.0), `cc-smart-dev-kit issue file`, the hidden marker that keeps one finding to one issue, what is refused before anything is sent, raw issue writes, the fixed-unreleased mark and the release list. |
| [The portal](design/portal.md) | What it is and is not, how it starts (D10), the door, the live stream and the JSON API, the pages' facts and actions, what it runs from, and what a page cannot know. |
| [Herdr orchestration](design/herdr.md) | Linked children and independent sessions, identity, private briefs, remote rules, blocked children (the person's), handing out plans (`start --plan`, `herdr plans`, resume), follow-up children (`start --followup`), event cursors and live proofs still owed. |
| [Sessions and worktrees](design/sessions.md) | Saved sessions, targeted finished-session removal, safe worktree cleanup and the flow report. |
| [Moving a machine from the old names](design/migrate.md) | What 0.2.x left, what `migrate` moves, and the order it moves it in. |

## The rest

| Page | What it holds |
|---|---|
| [claude-mem](design/claude-mem.md) | Memory only since D75 (with D68's history), claude-mem on the gateway's scout slot, the choices from the portal or the command, and the take-over of a value set by hand. |
