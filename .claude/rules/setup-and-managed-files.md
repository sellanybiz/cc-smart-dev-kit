---
paths:
  - "src/setup/**"
  - "src/cli/**"
---

# Setup And Managed Files

`anymodel setup` changes files that belong to the user: `~/.claude/settings.json`,
later `~/.claude/CLAUDE.md`, the launcher. A mistake there breaks someone's Claude Code.
So every change to a user's file goes through `src/setup/`, and nothing else writes one.

## The one way to write

| Kind of file | Use | Owns |
|---|---|---|
| JSON settings | `applyManagedJson` | single keys, listed in `owned.json` |
| Markdown | `applyManagedMarkdown` | one block between `<!-- anymodel:begin -->` and `<!-- anymodel:end -->` |
| A file it owns whole (the launcher) | `writeManagedFile` | the whole file |

Each of them:

- **Writes only on a real change.** The same content again means no write, no backup,
  no new file. A second `setup` prints "Nothing to change."
- **Writes in this order** (`writeManagedFile`):
  1. makes the backup;
  2. records the change in `changed.json` (the file, and the kind: `json-keys`,
     `markdown-block` or `whole-file`), so `restore` knows what to undo. The first
     time, that backup becomes the file's baseline. The record needs the backup's path,
     so the backup comes first. The record comes before the write, so a crash right
     after the rename never leaves a change that `restore` cannot see;
  3. writes a temp file in the same folder, and fsyncs it;
  4. compares the file on disk with the text it read earlier;
  5. renames the temp file over the file. A reader sees the old file or the new one,
     never half of one.

  A cheap compare also runs before step 1, so a file that changed already gets no
  backup and no temp file. When a try fails after step 1, its backup is removed, unless
  it became the baseline.
- **Starts again when the compare fails:** it reads the file again and redoes the step,
  up to 3 times. An ownership claim (a key added to `owned.json`) made in the failed try
  is undone first. The compare narrows the window for a race with another program
  (Claude Code writes `settings.json` too); it does not close it.
- **Keeps backups in the state folder,** `<stateDir>/backups/`, never beside the file.
  Each file gets its own subfolder, named from its real path. A file that did not exist
  gets an empty `.absent` marker. A backup is never executable; an executable's mode goes
  into the backup's name (`.mode-755`). Why not beside the file: a settings file linked
  from a dotfiles repo would get backups, with secrets in them, inside that repo; and a
  backup in a `bin` folder would sit on PATH.
- **Follows a symlink:** a linked dotfile stays a link, and its target gets the change;
  also a link whose target does not exist yet. A new file is tracked under its folder's
  real path.
- **Keeps the file's mode,** except the launcher, which is always 755.
- **Known limit:** the backup folder's name is the file's real path, encoded
  (`encodeURIComponent`). A real path long enough to make that name longer than 255
  bytes fails with ENAMETOOLONG.

## Never take what is not ours

- A JSON key that exists with another value and is not in `owned.json` is **never
  overwritten**: `ForeignKeyError`, and nothing is written. The user removes it by hand
  if anymodel should manage it.
- A key that already has the wanted value but is not ours stays unowned.
- Removal removes only owned keys. Every other key, and the text around a Markdown
  block, stays as it is.
- A Markdown file with a broken block (not exactly one begin and one end marker, in
  that order) throws and is not written.
- **Check before the first write.** Setup checks `settings.json` before it writes the
  launcher, so a key the user set (for example `autoUpdate: false`) fails before
  anything is written.

## State, lock and paths

- **State (`<stateDir>`):** `$CLAUDE_CONFIG_DIR/anymodel/` (by default
  `~/.claude/anymodel/`): `owned.json`, `changed.json`, the `lock`, and `backups/`
  (mode 0700).
- **The lock:** every command that writes runs inside `withLock`. The lock file is made
  with O_EXCL (only one process can create it). It holds the pid, the start time of that
  process, and the host name. It is stale only when that pid is dead, or alive with a
  different start time (the pid was reused). When the holder cannot be judged, it is
  stale after 10 minutes: neither `/proc` nor `ps` gives the start time, the lock was
  written on another host (a home folder shared between machines), or the lock file
  cannot be read. Otherwise a live holder is never taken over, however long it runs.
  There is no refresh timer. A run that removes a stale lock first takes the claim file
  `lock.takeover` (O_EXCL), so it never removes a live lock that took the stale one's
  place. A waiting run tries for up to 10 seconds, then says who holds it.
- **Paths come from `cliPaths()`,** which follows `HOME` and `CLAUDE_CONFIG_DIR`. Never
  call `homedir()` or write `~/.claude` anywhere else: tests point these at a temp folder.
- **One launcher, many config folders.** The launcher `~/.local/bin/anymodel` is
  shared by every config folder; the state (lock, records, backups) is per config folder.
  So a `restore` under one `CLAUDE_CONFIG_DIR` can remove a launcher another one relies
  on. A launcher started without `CLAUDE_CONFIG_DIR` looks in `~/.claude`.

## `--dry-run` and `restore`

- **`--dry-run`** goes through the same steps and writes nothing at all: no user file,
  no state folder, no lock. Every new step takes `dryRun` and is tested with it.
  Setup always runs this read-only pass first, outside the lock, also without
  `--dry-run`: a key the user set stops it before anything is written.
- **`restore`** removes everything anymodel added and keeps everything else:
  - JSON settings: removes only the keys in `owned.json`. Foreign keys stay, also ones
    added after setup.
  - Markdown: removes the managed block and keeps the text around it.
  - Files owned whole (the launcher): puts back the **baseline**, the backup made at
    anymodel's first change to the file since the last restore. When setup created
    the file, it removes it.
  - A file setup created, with only an empty `{}` or empty text left, is removed.
  - Each change makes a normal backup first, so a restore can be undone by hand.
  - A restored file is no longer tracked in `changed.json`, so a second `restore`
    changes nothing. When the baseline backup is missing, the file is left alone.
- A new kind of managed change must say how `restore` undoes it, with a test.
- **A service is a managed change too.** When `gateway setup` installed the router (its
  copy or unit is in `changed.json`), `restore` works in two stages, because running
  sessions are taken to keep pointing at the router until they restart (one live look
  saw otherwise: `docs/claude-code-contract.md`; the stages stay until it is repeated):
  - **stage 1**, while anymodel's gateway env keys are in `settings.json`
    (`ownedGatewayEnvKeys`): it restores everything except the router's files
    (`restore(stateDir, { except })`, which leaves them tracked) and says to restart
    every running session, then run `restore` again. Nothing stops, nothing is asked.
  - **stage 2**, with no such key left: it disables and stops the unit and its socket
    first, while their files are still there (`stopRouter`: `is-active`, `disable` of
    both, one `stop --no-block` of both, then up
    to 15 s while this router still answers on the config's port; the drain finishes in
    the background), then restores the files, runs `systemctl --user daemon-reload`, and
    removes the restart-pending marker. It waits only for the unit's own router: a unit
    that was not `active` or `deactivating`, or a port that answers but not as this
    router, gets one note and no wait. This router still answering after 15 s stops it
    with an error before any file is restored.
    Stopping a running router cuts answers in flight, so it asks first, or needs `--yes`.
  - **`--now`**: both at once, after the warning that every running session fails until
    it restarts; asked, or `--yes`.

## The launcher

`~/.local/bin/anymodel` is a small POSIX `sh` script that reads Claude Code's
`installed_plugins.json` and runs `dist/cli.js` of the installed version. It stays
valid across updates.

- Setup writes into it the absolute path of the `bun` that ran setup. The launcher tries
  that first, then `bun` on PATH, so it works under systemd and cron (which have a short
  PATH).
- It repeats the lookup of `findUserInstall()` (`installed-plugins.ts`) in plain JS.
  **Change one, change the other**, and the launcher tests.

## What setup may do, and when

- Restarts and permission changes happen only in a manual run (`anymodel setup`,
  `gateway setup`, `restore`) that shows the change first. A restart or stop of a running
  service says what it cuts, and asks: `confirm()` on a terminal; with no terminal, it
  stops and changes nothing unless `--yes` was given. The SessionStart hook only
  refreshes managed files and starts the background self-update (`hooks.md`), which
  installs a new plugin version with `claude plugin` commands and restarts nothing.
- Setup refuses to start before `claude plugin marketplace add` has run, and says which
  command to run.

## Command output

- `setup` prints one line per change: `+` created, `~` changed, `-` removed, with `~`
  for the home folder (`tildify`). Its last line: "Done. Each changed file has a backup
  in ~/.claude/anymodel/backups/." (the state folder's `backups/`).
- `doctor` prints one `✓` or `✗` line per check. A `✗` line says what to run. A part
  the person may leave out (the gateway, never set up) is a `·` line: information, never
  a failure. The list of checks is in `README.md` § Commands; keep it in step.
- Exit codes: 0 done, 1 a failed check or an error, 2 a wrong command or option.
- A check that reaches the network has a timeout and never asks for a password:
  `git ls-remote` with `GIT_TERMINAL_PROMPT=0`. It adds ssh `BatchMode` only when the
  user has no `GIT_SSH_COMMAND`, `GIT_SSH` or `core.sshCommand` of their own.
- A printed URL never shows credentials: remove them first.
