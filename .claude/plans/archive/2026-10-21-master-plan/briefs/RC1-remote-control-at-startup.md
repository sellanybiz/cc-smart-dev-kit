# RC1 — setup turns Remote Control's auto-connect on (1.2.1)

## Goal, and why

Your branch starts from `release-1.2.1`. The plan: `.claude/plans/2026-10-21-master-plan.md`
§ Release 1.2.1, row RC1, and decision D66.

**The owner (2026-10-25):** "please enable back remote control", and in the morning, asked whether
setup should write `remoteControlAtStartup=true` on every machine as a key that `restore` removes:
**"Yes, write it."**

**What is already true** (DF1's proof, `docs/claude-code-contract.md`, the Remote Control row):
Claude Code allows Remote Control only while `ANTHROPIC_BASE_URL` is unset or its host is exactly
`api.anthropic.com`, so `gateway on` turns it off and `gateway off` brings it back; `gateway on`
says so in one line. Auto-connect at a session's start is `remoteControlAtStartup`, read from the
user's settings, a `--settings` file or managed settings only (not from a project's files).

## The change

1. **`cc-smart-dev-kit setup` writes `remoteControlAtStartup: true`** into Claude Code's user
   settings (`settings.json` under `CLAUDE_CONFIG_DIR`, through `cliPaths()`), as a **managed key**
   through `src/setup/` (`applyManagedJson`, its owned-keys record, a backup, the lock, an atomic
   write; `.claude/rules/setup-and-managed-files.md`):
   - only when the key is **absent**: a value the person set (`true` or `false`) is theirs, never
     overwritten, and setup says nothing about it (or one quiet line: pick, and say why);
   - `--dry-run` shows the line and writes nothing; a second setup changes nothing;
   - `restore` removes it only while it still holds the value the kit wrote (the managed-key rule:
     a person who changed it keeps theirs);
   - one line in setup's report, in its section, with the words of the other managed keys.
   No question at setup: the owner chose it as a default (`.claude/rules/setup-commands.md`: every
   question first still holds for the others).
2. **Find whether it applies**: read Claude Code's own docs and the binary's reading of
   `remoteControlAtStartup` on the tested version (`.claude-code-version`), the value's type, and
   whether it needs anything else to connect (a login, the claude.ai account). If it is a no-op or
   refused on some setups (an API-key login, a managed-settings lock), the line says so and setup
   still writes it only where it applies; say what you found in the contract row.
3. **doctor**: none, unless a check that already lists the managed keys picks it up by itself.
4. **The words:** `README.md` (what setup writes; the Remote Control paragraph), `docs/gateway.md`
   (§ the Remote Control limit: auto-connect is now on by default, `gateway on` still turns Remote
   Control off), `docs/design/setup.md`, `docs/claude-code-contract.md` (the key's row, the version
   you proved it on), and one bullet under `## 1.2.1` in `CHANGELOG.md`.

## Files (change nothing else)

`src/setup/*` (the managed key's home: find where the other Claude Code user-settings keys are
planned, and put it beside them), `src/cli/setup*`, `src/cli/restore*` (only if a list there
names keys by hand), their tests, `README.md`, `docs/gateway.md`, `docs/design/setup.md`,
`docs/claude-code-contract.md`, `CHANGELOG.md` (`## 1.2.1`), `plugin/dist/*.js`. **`plugin.json`
stays as it is.** JW1 changed how `src/setup/` writes JSON (`src/setup/json-edit.ts`, the file's
own layout kept): use it.

## Setup in your worktree

Run `bun install` in your own worktree. Never link another checkout's `node_modules`. Never read
or run git in another worktree. Tests never touch the real `~/.claude`, `~/.config` or `~/.local`.

## Done-check

1. Tests, each seen failing first: absent (written, the line), the person's `true` and `false`
   (untouched), `--dry-run` (shown, nothing written), a second run (nothing), `restore` (removed;
   and kept when the person changed it), a settings file with other keys and its own layout
   (unchanged beyond the key).
2. `bun run build`, then `bun run check` and both `claude plugin validate … --strict`.
3. Your own review, then one second opinion: the `cc-smart-dev-kit:reviewer` agent on `sonnet` at
   `high`.
4. Commit a checkpoint after each green step. Fill the report's fields. Never send an empty report.
5. Before you report, stop every background check you started.
