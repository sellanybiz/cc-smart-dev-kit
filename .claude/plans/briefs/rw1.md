# RW1 — Claude Code's retry watchdog on by default (D56)

## Goal, and why

Today `cc-smart-dev-kit setup` offers Claude Code's retry watchdog once, on a terminal, and the
default is no (D42). With no terminal (the installer's own run, a `!` line in Claude Code) it is
never asked, so most machines never get it, and a person's own session fails at a usage limit
instead of waiting. The owner decided (D56, `.claude/plans/2026-10-21-master-plan.md` § Decisions,
and § Release 1.1.1): **the watchdog is on by default.**

D56, quoted: "`setup` turns it on without a question, with or without a terminal and with `--yes`,
unless the person said no before (`retry-watchdog-declined`) or set a value of their own;
`--no-retry-watchdog` takes it out and remembers the no. Still no time limit (D42: keep waiting),
so a `claude -p` script can wait until a model answers. A machine gets it at its next `setup` (the
installer runs one); the background update never runs setup."

## Your files (and change nothing else)

- `src/setup/retry-watchdog.ts` — the one home: the env names and values, the flags, the "no"
  file, the state `doctor` reads. The question (`RETRY_WATCHDOG_QUESTION`) goes; the trade-offs
  move into the line setup prints and into the docs.
- `src/cli/setup.ts` — `askRetryWatchdog`, `retryWatchdogUndecided`, `retryWatchdogDryNote` and
  where they are called (around lines 700–750, 1160–1175, 1240–1255): no question; an undecided
  machine gets `managed.retryWatchdog = "on"`.
- Their tests: `src/cli/setup.test.ts`, `src/cli/cli.test.ts` (› "D42: setup offers Claude Code's
  retry watchdog" — rename to D56 and rewrite to the new behaviour), `src/testing/fake-machine.ts`
  only if a test needs it, `src/cli/doctor.ts` only if a doctor line's words become untrue.
- Docs: `README.md` § Waiting at a limit (and its two flag rows in the setup table, and the
  setup summary sentence near line 316 if it names the watchdog), `docs/design/retry-watchdog.md`
  (the title and the "Asked once, default no" bullet), `docs/claude-code-contract.md` (the
  `CLAUDE_CODE_RETRY_WATCHDOG=1` row's words "offers it once … (default no)" — its proof is
  unchanged), `.claude/rules/setup-commands.md` (the bullet "An offered setting is asked once,
  and the default is no": take the watchdog out of it and add one line for D56; the status line
  stays asked, default no), `CHANGELOG.md` (a new `## 1.1.1` section at the top, in users' words:
  what changes, that it comes at the next `setup`, and how to turn it off).
- `plugin/dist/*.js` — rebuilt with `bun run build` in the same commit as the `src/` change.

**Not yours** (the lead's): `plugin/.claude-plugin/plugin.json` (the version bump), the plan and
the briefs. Do not touch `src/crew/start.ts`: a crew session's own settings already turn the
watchdog on, and stay as they are.

## The behaviour, case by case (each one a test that can fail)

| The machine | A real `setup` | `setup --dry-run` |
|---|---|---|
| Neither key in `env`, no "no" on file (terminal or not, `--yes` or not) | writes both owned keys (`RETRY_WATCHDOG_SETTINGS`), one `~`/`+` line as setup prints any owned key, plus one `·` line saying what it means and how to turn it off (`--no-retry-watchdog`) | names that a real run turns it on; writes nothing |
| A "no" on file (`retry-watchdog-declined`) | nothing; one `·` line: off because you said no, `--retry-watchdog` turns it on | the same `·` line |
| The person's own key, a value that turns it on | left alone (as today) | the same |
| The person's own key, a value that leaves it off (`0`) | left alone: their choice (as today) | the same |
| Our keys already there | "Nothing to change" for them | the same |
| `--retry-watchdog` | writes both keys, and removes a "no" on file if there is one (so the state agrees) | names both |
| `--no-retry-watchdog` | removes our keys and remembers the "no" (as today) | names it |
| `restore` | removes our keys (as today); a later `setup` turns it on again unless a "no" is on file | — |

- Every question still comes first (`.claude/rules/setup-commands.md`): there is no watchdog
  question any more, so nothing waits on one.
- The keys go through `applyManagedJson` as today: a different value the person set stops setup
  in the read-only pass (`ForeignKeyError`), as today.
- The `·` line's words, in plain English: every Claude session on this machine now waits and
  retries at a limit instead of failing ("Retrying in …"; Esc cancels), with no time limit, so a
  `claude -p` script can wait until a model answers. Keep it to one or two short lines, through
  the report as the other lines are (`.claude/rules/command-output.md`).
- `doctor`'s line (`retryWatchdogState`) stays as it is unless a word in it becomes untrue.
- The `stop-failure` hook already reads the state (`src/hooks/stop-failure.ts`): no change there.

## Done-check

1. The targeted tests: `bun test src/cli/setup.test.ts src/cli/cli.test.ts`, with a test per row
   of the table above; each fails when its line of code is reverted.
2. `bun run build`, then `bun run check` (the type check, Biome, `check:neutral`,
   `check:duplicates`, `check:docs`, `check:core-lines`, every test, `build:check`) — all green.
3. `git grep -n -iE "default (is )?no|asked once|RETRY_WATCHDOG_QUESTION"` shows nothing stale
   about the watchdog outside `.claude/plans/` and the archives.
4. Your review, then your report.

## Round 2 (the owner, 2026-10-23): a 24-hour cap, and you are a subagent now

- **The work so far is commit `d5abf0f` on `crew/RW1-watchdog-on`**, in the worktree
  `.claude/worktrees/crew-RW1-watchdog-on`. The first session was stopped by the lead (it ran
  without the kit loaded: LS1). Read that commit first, judge it against this brief, and go on
  from it. You are the lead's subagent, not a crew session: no `crew report`, no `crew step`; you
  commit on that branch and report back to the lead.
- **The cap:** setup writes a third owned key with the other two:
  `CLAUDE_CODE_RETRY_WATCHDOG_MAX_USAGE_LIMIT_WAIT_MS` = `86400000` (24 hours), one named
  constant in `src/setup/retry-watchdog.ts` with the others, in `RETRY_WATCHDOG_SETTINGS`. Why:
  a weekly limit can reset days away, and Claude Code's own automatic continue refuses a wait
  past 24 h for that reason; with the cap the request ends instead of holding a `claude -p`
  script for days. The 5-hour limit and an overloaded or failing model are still waited out
  with no limit (the cap only applies to a usage limit's reset distance). Proved: the contract
  row on `CLAUDE_CODE_RETRY_WATCHDOG=1` (`…_MAX_USAGE_LIMIT_WAIT_MS` ends it at that distance:
  900 000 → 901 s, on 2.1.308); say in that row that setup now writes it.
- **A machine that already has our two keys** gets the third at its next `setup` (one line).
  **A person's own `CLAUDE_CODE_RETRY_WATCHDOG`** (not ours): setup adds no cap beside it — their
  watchdog, their limits. `--no-retry-watchdog` and `restore` take all three of ours out.
- **The `·` line** also says: a limit that resets more than 24 hours away ends the wait.
- **Crew sessions are unchanged:** `src/crew/start.ts` keeps its own two keys and no cap (D42).
  Check that a new constant in the module does not reach the crew settings.
- **`CHANGELOG.md` is now the lead's**: do not edit it. Everything else in "Your files" stands.
- The docs: README § Waiting at a limit, `docs/design/retry-watchdog.md` and the rule say the
  cap and why, in one sentence each.
- Done when `bun run check` is green on the branch head; one commit on top of `d5abf0f`
  (squash nothing). Report: the commit, the files with one line each, the commands and results,
  and anything left open.
