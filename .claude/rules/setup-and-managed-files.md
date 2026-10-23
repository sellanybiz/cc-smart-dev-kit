---
paths:
  - "src/setup/**"
  - "src/cli/restore.ts"
  - "src/cli/paths.ts"
  - "src/workflow/write.ts"
---

# Setup And Managed Files

`cc-smart-dev-kit setup` changes files that belong to the user: `~/.claude/settings.json`,
`~/.claude/CLAUDE.md` (one block that imports the instructions' copy), the launcher. A
mistake there breaks someone's Claude Code.
So every change to a user's file goes through `src/setup/`, and nothing else writes one.
What setup may do, and when: `setup-commands.md`. How a command prints: `command-output.md`.
How the parts fit: `docs/design/setup.md` § How `setup` changes user files.

## The one way to write

| Kind of file | Use | Owns |
|---|---|---|
| JSON settings | `applyManagedJson` | single keys, listed in `owned.json` |
| A JSON list of strings (`autoMode.environment`) | `applyManagedEntries` | single entries, each with its source, listed in `owned-entries.json` |
| One hook entry in a `hooks.<event>` list (`settings.json`) | `applyManagedHook` (`managed-hook.ts`) | the entry it wrote, listed in `owned-hooks.json` |
| Markdown | `applyManagedMarkdown` | one block between `<!-- cc-smart-dev-kit:begin -->` and `<!-- cc-smart-dev-kit:end -->` |
| Exact lines in a text file the person owns (`~/.tmux.conf`) | `applyManagedLine` / `removeManagedLines` (`managed-line.ts`) | the exact lines it added, listed as `lines` in `changed.json` (`file-line`) |
| A file it owns whole (the launcher) | `writeManagedFile` | the whole file |
| A folder it owns whole (the portal's export) | `writeManagedFolder` (`managed-folder.ts`) | the whole folder, listed in `owned-folders.json` |

Each of them:

- **Writes only on a real change.** The same content again means no write, no backup,
  no new file. A second `setup` prints "Nothing to change."
- **Writes in this order** (`writeManagedFile`):
  1. makes the backup;
  2. records the change in `changed.json` (the file, and the kind: `json-keys`,
     `json-entries`, `markdown-block`, `file-line` or `whole-file`), so `restore` knows
     what to undo. The first time, that backup becomes the file's baseline. The record
     needs the backup's path,
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
- **Keeps the file's mode,** except the launcher, which is always 755, and a JSON write
  that sets a `secret` key, which leaves the file at 600.
- **Known limit:** the backup folder's name is the file's real path, encoded
  (`encodeURIComponent`). A real path long enough to make that name longer than 255
  bytes fails with ENAMETOOLONG.

## Never take what is not ours

- A JSON key that exists with another value and is not in `owned.json` is **never
  overwritten**: `ForeignKeyError`, and nothing is written. The user removes it by hand
  if cc-smart-dev-kit should manage it.
- A key that already has the wanted value but is not ours stays unowned.
- **An owned key remembers the value cc-smart-dev-kit wrote** (`owned.json`: `{ path, value }`,
  or `{ path, sha256 }` for a `secret`, never the secret itself). When it holds another
  value now, and not an `unchosen` one, the person changed it: it is theirs. Setting it
  throws `ForeignKeyError` like any foreign key; removing it (restore) leaves it and
  drops the ownership. A record with no value (an older `owned.json`, or the claim
  written just before a write) is owned whatever the key holds, and gets its value at
  the next write. This is general, in `applyManagedJson`: every caller gets it.
- **The one exception: an unchosen value.** A caller may name, per key, the values that
  mean "nobody chose this yet" (`unchosen`): a program's own default that the program
  wrote into its file itself. claude-mem does that on its first run, so its keys
  may be taken while they hold `""` (or `claude` for its provider, or `true` for a start
  block). Any other value
  is the person's choice: `claudeMemPlan` then leaves that key alone. Restore removes
  the key, and the program falls back to the same default.
- **A secret is never printed.** A key whose value is a secret (claude-mem's API key) is
  named in `secret`: an error says "a secret", and setup's output masks it.
- **List entries:** setup adds an entry at the end and owns it; it never changes,
  reorders or removes an entry it did not add, and an entry already there stays
  unowned. Each entry is owned per source (a project); it leaves the list when its last
  source drops it. An `anchor` (`"$defaults"`) goes first when setup creates the list
  and goes only with it.
- Removal removes only owned keys. Every other key, and the text around a Markdown
  block, stays as it is.
- A Markdown file with a broken block (not exactly one begin and one end marker, in
  that order) throws and is not written.
- **Check before the first write.** Setup checks `settings.json` before it writes the
  launcher, so a key the user set (for example `autoUpdate: true`) fails before
  anything is written.

## State, lock and paths

- **The browser's writes inside Chrome's own folder** go through `applyManagedJson` (`json-keys`),
  and only while no Chrome runs on that user data folder. `restore` puts them back like
  any other key; nothing else of Chrome's is written, and no command deletes a profile or an
  extension. Which two files, and why: `.claude/rules/browser.md`.
- **A folder owned whole is build output, so it has no backup.** `writeManagedFolder` writes a
  complete new folder beside the old one, records its path in `owned-folders.json` before the
  swap, then renames the new one into place and removes the old one. The record is its own
  file, not a `changed.json` kind, because a running older CLI refuses a kind it does not
  know (the same rule as the managed hook entries). `restore` removes the folder whole; the
  next portal start writes it again. Today that is one folder: `~/.local/share/cc-smart-dev-kit/portal-ui/`.
- **`gateway.json` backs itself up, in the state folder, beside the other backups.** A key that
  really replaces one already there makes `backupFile(stateDir, gatewayConfigFile)` run first —
  the one backup helper, `<stateDir>/backups/<the path, encoded>/`, never a copy beside a file
  that holds keys. It is NOT a managed change (`changed.json` does not track it): `restore`
  leaves `gateway.json` alone on purpose, because it holds the person's key. The setup line says
  which folder the backup is in; copying a file back is the person's own step.
- **`cc-smart-dev-kit mcp status [--json]`** (`src/mcp/status.ts`) is read-only and answers which
  of the plugin's MCP servers (`SERVER_NAMES`) are its own and which are registered by
  something else, on the same rule as setup (`sameConfig` against the record). Its line shows a server's command and
  arguments — never an `env` or a `headers`, which can hold a key. The installer asks with it
  (`install.sh`, `install.ps1`); `doctor` warns from the same facts.
- **State (`<stateDir>`):** `$CLAUDE_CONFIG_DIR/cc-smart-dev-kit/` (by default
  `~/.claude/cc-smart-dev-kit/`): `owned.json`, `owned-entries.json`, `owned-hooks.json`, `changed.json`, the `lock`, and `backups/`
  (mode 0700). Beside them, the instructions' two state files: `no-instructions` (a stored
  `setup --no-instructions`, honoured by every later setup and by the copy's refresh) and
  `instructions-version` (the version that wrote the copy). `restore` removes both.
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
- **Paths come from `cliPaths()`,** which follows `HOME`, `CLAUDE_CONFIG_DIR` and (on
  Windows, where `HOME` is undefined) `USERPROFILE`. Never call `homedir()` or write
  `~/.claude` anywhere else: tests point these at a temp folder. On Windows the layout is
  the same one under `%USERPROFILE%` — `docs/windows-setup.md` says why.
- **A mode call goes through `setFileMode()`** (`file-mode.ts`): on Windows a mode is not
  protection (the profile's ACL is) and a failing `chmod`/`fchmod` must never end a run.
- **A check that reads a mode goes through `isOwnerOnly()`** in the same module: every
  reader that refuses a file "the group or others can read" (the gateway's config, the
  browser's token, the Tavily key file, the browser's output folder) asks it. Off Windows
  the bits decide; on Windows every file counts as the owner's alone, because
  `statSync().mode` there is made up (`0666` for a writable file) and a refusal over it
  would refuse **every** file the plugin owns.
- **One launcher, many config folders.** The launcher `~/.local/bin/cc-smart-dev-kit` is
  shared by every config folder; the state (lock, records, backups) is per config folder.
  So a `restore` under one `CLAUDE_CONFIG_DIR` can remove a launcher another one relies
  on. A launcher started without `CLAUDE_CONFIG_DIR` looks in `~/.claude`.

## `--dry-run` and `restore`

- **`--dry-run`** goes through the same steps and writes nothing at all: no user file,
  no state folder, no lock. It reaches no network either: a check it would make (the
  claude-mem backend) is printed as "would check …". Every new step takes `dryRun` and
  is tested with it.
  Setup always runs this read-only pass first, outside the lock, also without
  `--dry-run`: a key the user set stops it before anything is written.
- **`restore`** removes everything cc-smart-dev-kit added and keeps everything else:
  - JSON settings: removes only the keys in `owned.json` that still hold cc-smart-dev-kit's
    value. A key the person changed since stays. Foreign keys stay, also ones added
    after setup.
  - JSON lists: removes only the entries in `owned-entries.json`. The anchor stays when
    the person added an entry since; it is then no longer claimed.
  - Hook entries: removes the entry listed in `owned-hooks.json` from `hooks.<event>` while
    it still matches what setup wrote; an entry the person changed since stays, and so does
    every other entry. A `hooks` object or event list setup created goes with its last
    entry. Its record is its own file, never a `changed.json` kind, so an older running
    cc-smart-dev-kit never reads a kind it refuses.
  - Plugins and marketplaces setup added with `claude plugin …` stay: they are Claude
    Code's own changes to its own files, and removing claude-mem would remove the
    person's memory plugin.
  - Markdown: removes the managed block and keeps the text around it.
  - Lines (`file-line`): removes exactly the lines in `changed.json` and keeps every
    other line, in the person's own order. A line the person edited or removed since is
    not there to remove. A line they wrote themselves is never claimed, so restore keeps
    it (the tmux line, `src/setup/tmux.ts`).
  - Files owned whole (the launcher): puts back the **baseline**, the backup made at
    cc-smart-dev-kit's first change to the file since the last restore. When setup created
    the file, it removes it.
  - A file setup created, with only an empty `{}` or empty text left, is removed.
  - **An object cc-smart-dev-kit created goes with its last key.** A JSON object cc-smart-dev-kit
    made for its own keys (the `env` a Tavily or a gateway key went into) is removed when a
    restore empties it, so no `"env": {}` is left behind. An object the person had stays, also
    when it is empty: `createdObjects` answers from the baseline backup (a missing or
    unreadable baseline proves nothing, and nothing is pruned).
  - Each change makes a normal backup first, so a restore can be undone by hand.
  - A restored file is no longer tracked in `changed.json`, so a second `restore`
    changes nothing. When the baseline backup is missing, the file is left alone.
- A new kind of managed change must say how `restore` undoes it, with a test.
- **What a retired piece left is taken back by setup with the same helpers** (Serena, 0.6.0:
  `src/mcp/retired.ts`): a registration only while the record proves it is setup's own, a
  file through `removeManagedFile` (backup first) and `forgetChange`, never a file that a
  registration of the person's still names. `--dry-run` shows each step; `doctor` has one ✗
  line until it is done.
- **A service is a managed change too.** When `gateway setup` installed the router (its
  copy or unit is in `changed.json`), `restore` works in two stages, because running
  sessions are taken to keep pointing at the router until they restart (one live look
  saw otherwise: `docs/claude-code-contract.md`; the stages stay until it is repeated):
  - **stage 1**, while cc-smart-dev-kit's gateway env keys still hold its value in **any
    settings file it wrote** — the user's `settings.json`, a project's own
    `settings.local.json` or team `.claude/settings.json` (`ownedGatewayEnvKeys` over
    `changed.json`'s `json-keys` entries; a file whose address is Anthropic's, from
    `gateway project off`, does not count): it restores everything except the router's files
    (`restore(stateDir, { except })`, which leaves them tracked) and says to restart
    every running session, then run `restore` again. Nothing stops, nothing is asked.
  - **stage 2**, with no such key left: it stops the router before it restores its files
    (`stopRouter`; how the stop works, and why it waits only for the unit's own router:
    `gateway.md` § The service), then restores them, runs `systemctl --user daemon-reload`,
    and removes the restart-pending marker. It waits only for the unit's own router.
    Stopping a running router cuts answers in flight, so it asks first, or needs `--yes`.
  - **`--now`**: both at once, after the warning that every running session fails until
    it restarts; asked, or `--yes`.

## The launcher

`~/.local/bin/cc-smart-dev-kit` is a small POSIX `sh` script that reads Claude Code's
`installed_plugins.json` and runs `dist/cli.js` of the installed version. It stays
valid across updates.

- Setup writes into it the absolute path of the `bun` that ran setup. The launcher tries
  that first, then `bun` on PATH, so it works under systemd and cron (which have a short
  PATH).
- It repeats the lookup of `findUserInstall()` (`installed-plugins.ts`) in plain JS.
  **Change one, change the other**, and the launcher tests.
- **Windows gets a second launcher beside it:** `cc-smart-dev-kit.cmd` (`launcher-cmd.ts`),
  written by `setup` on a `win32` host and removed by `restore` like the `sh` one (one whole
  file each). `cmd` and PowerShell cannot run a `sh` script; Git Bash runs the `sh` one.
  `doctor` checks both, and starts the `.cmd` through `cmd.exe` — a `.cmd` is not an
  executable. Its plugin lookup cannot use `for /f` over a path with spaces, so it prints
  the folder to a file in `%TEMP%` and reads it back. `docs/windows-setup.md`.
