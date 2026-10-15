---
paths:
  - "src/setup/**"
  - "src/cli/**"
---

# Setup And Managed Files

`cc-agentic setup` changes files that belong to the user: `~/.claude/settings.json`,
later `~/.claude/CLAUDE.md`, the launcher. A mistake there breaks someone's Claude Code.
So every change to a user's file goes through `src/setup/`, and nothing else writes one.

## The one way to write

| Kind of file | Use | Owns |
|---|---|---|
| JSON settings | `applyManagedJson` | single keys, listed in `owned.json` |
| Markdown | `applyManagedMarkdown` | one block between `<!-- cc-agentic:begin -->` and `<!-- cc-agentic:end -->` |
| A file it owns whole (the launcher) | `writeManagedFile` | the whole file |

Each of them:

- **Writes only on a real change.** The same content again means no write, no backup,
  no new file. A second `setup` prints "Nothing to change."
- **Backs up first:** `<file>.bak-cc-agentic-<UTC stamp>` beside the file. A file that
  did not exist gets an empty `.absent` marker. A backup is never executable; an
  executable's mode goes into the name (`.mode-755`).
- **Writes atomically:** a temp file in the same folder, fsync, then rename. A reader
  sees the old file or the new one, never half of one.
- **Starts again when someone else wrote in between.** Just before the write, it
  compares the file with the text it read. If they differ, it reads again and redoes the
  step, up to 3 times.
- **Follows a symlink:** a linked dotfile stays a link, and its target gets the change.
- **Keeps the file's mode,** except the launcher, which is always 755.
- **Records the file** in `changed.json`, with the kind of change (`json-keys`,
  `markdown-block` or `whole-file`) and its first backup, so `restore` knows what to undo.

## Never take what is not ours

- A JSON key that exists with another value and is not in `owned.json` is **never
  overwritten**: `ForeignKeyError`, and nothing is written. The user removes it by hand
  if cc-agentic should manage it.
- A key that already has the wanted value but is not ours stays unowned.
- Removal removes only owned keys. Every other key, and the text around a Markdown
  block, stays as it is.
- A Markdown file with a broken block (not exactly one begin and one end marker, in
  that order) throws and is not written.

## State, lock and paths

- **State:** `$CLAUDE_CONFIG_DIR/cc-agentic/` (by default `~/.claude/cc-agentic/`):
  `owned.json`, `changed.json` and the `lock`.
- **The lock:** every command that writes runs inside `withLock`. The lock file is made
  with O_EXCL (only one process can create it). Its owner refreshes it every 30 seconds.
  It is stale when its owner is dead, or when it was not refreshed for 2 minutes. A
  waiting run tries for up to 10 seconds, then says who holds it.
- **Paths come from `cliPaths()`,** which follows `HOME` and `CLAUDE_CONFIG_DIR`. Never
  call `homedir()` or write `~/.claude` anywhere else: tests point these at a temp folder.

## `--dry-run` and `restore`

- **`--dry-run`** goes through the same steps and writes no user file. Every new step
  takes `dryRun` and is tested with it.
- **`restore`** removes everything cc-agentic added and keeps everything else:
  - JSON settings: removes only the keys in `owned.json`. Foreign keys stay, also ones
    added after setup.
  - Markdown: removes the managed block and keeps the text around it.
  - Files owned whole (the launcher): puts back the **oldest** backup (the state before
    cc-agentic's first change), or removes the file when setup created it.
  - A file setup created, with only an empty `{}` or empty text left, is removed.
  - Each change makes a normal backup first, so a restore can be undone by hand.
  - A restored file is no longer tracked in `changed.json`, so a second `restore`
    changes nothing. When the oldest backup is missing, the file is left alone.
- A new kind of managed change must say how `restore` undoes it, with a test.

## The launcher

`~/.local/bin/cc-agentic` is a small POSIX `sh` script that reads Claude Code's
`installed_plugins.json` and runs `dist/cli.js` of the installed version. It stays
valid across updates.

- Setup writes into it the absolute path of the `bun` that ran setup. The launcher tries
  that first, then `bun` on PATH, so it works under systemd and cron (which have a short
  PATH).
- It repeats the lookup of `findUserInstall()` (`installed-plugins.ts`) in plain JS.
  **Change one, change the other**, and the launcher tests.

## What setup may do, and when

- Restarts and permission changes happen only in a manual `cc-agentic setup` run that
  shows the change first. The SessionStart hook (Phase 3) only refreshes managed files.
- Setup refuses to start before `claude plugin marketplace add` has run, and says which
  command to run.

## Command output

- `setup` prints one line per change: `+` created, `~` changed, `-` removed, with `~`
  for the home folder (`tildify`).
- `doctor` prints one `✓` or `✗` line per check. A `✗` line says what to run.
- Exit codes: 0 done, 1 a failed check or an error, 2 a wrong command or option.
- A check that reaches the network has a timeout and never asks for a password
  (`git ls-remote` with `GIT_TERMINAL_PROMPT=0` and ssh `BatchMode`).
