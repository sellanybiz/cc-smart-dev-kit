# How `setup` changes user files


`setup` owns **managed** parts of user files, and only those:

- in a JSON settings file, single keys (listed in its state, `owned.json`, each with the
  value cc-smart-dev-kit wrote there, or only its SHA-256 for a secret);
- in a JSON list of strings, single entries, each with the source that wants it (listed
  in `owned-entries.json`): the auto-mode block;
- in a Markdown file, one block between `<!-- cc-smart-dev-kit:begin -->` and
  `<!-- cc-smart-dev-kit:end -->`;
- whole files it creates itself (the launcher, the copy of the instructions);
- folders it owns whole, each marked (`.cc-smart-dev-kit-owned`) and listed in
  `owned-folders.json`, with no backup (build output): the portal's export, which an update
  swaps for a new folder, and the git hooks folder (`~/.local/share/cc-smart-dev-kit/git-hooks/`,
  `src/jobs/hook-folder.ts`), one `sh` script per hook name with mode 755. Git reads the hooks
  folder while a commit runs, so it is never swapped or renamed away: `writeManagedFiles` rewrites each
  script in place (temp file, rename) and removes a name that left the list. A folder at that
  path without the mark is the person's: setup never replaces it, and `doctor` says to move it
  away. `restore` removes both folders.

The guarantees:

- **A fixed order for each write:**
  1. make the backup;
  2. record the change in `changed.json`, so `restore` can undo it (the first time,
     with that backup as the baseline). The record needs the backup's path, so the
     backup comes first;
  3. write a temp file and fsync it;
  4. compare the file with the text read earlier;
  5. rename the temp file over it. A reader never sees half a file.

  A cheap compare also runs before the backup, so a file that changed already gets no
  backup. A backup from a failed try is removed, unless it became the baseline.
- **Fewer lost edits:** when the compare fails, the step starts again from the read, up
  to 3 times, and an ownership claim made in the failed try is undone first. The compare
  narrows the window for a race with another program (Claude Code writes
  `settings.json` too); it does not close it.
- **Backups in the state folder,** `<stateDir>/backups/` (mode 0700), one subfolder per
  file, named from its real path. Never beside the file: a settings file linked from a
  dotfiles repo would get backups, with secrets in them, inside that repo, and a backup
  in a `bin` folder would sit on PATH. A backup is never executable; an executable's
  mode goes into the backup's name.
- **A lock** against two runs at once. It holds the pid, that process's start time and
  the host name. It is stale only when the pid is dead, or alive with a different start
  time (the pid was reused). When the holder cannot be judged, it is stale after 10
  minutes: neither `/proc` nor `ps` gives the start time, the lock was written on
  another host (a home folder shared between machines), or the lock cannot be read.
  Otherwise a live holder is never taken over, and there is no refresh timer. A run
  that removes a stale lock first takes a claim file, `lock.takeover` (O_EXCL), so it
  never removes a live lock that took the stale one's place.
- **Never someone else's key:** a key that exists with another value and is not owned
  is never overwritten; setup stops and says so. One exception, named per key: a value
  that means "nobody chose this yet" — a program's own default, which that program wrote
  into its file itself (claude-mem seeds every default on its first run). Such a key may
  be taken; restore removes it, and the program falls back to the same default. Setup checks `settings.json` before it
  writes the launcher, so such a key (for example `autoUpdate: true`) stops it before
  anything is written.
- **A key the person changed is theirs.** An owned key remembers the value cc-smart-dev-kit
  wrote. When it holds another value now (and not the program's own default), the
  person chose it: setup does not overwrite it (it stops, as for any key not its own),
  and restore leaves it and gives up the ownership. A record from an older `owned.json`
  has no value: it stays owned as before, and gets its value at the next setup. A
  write that sets a secret leaves the file at mode 600.
- **A default that is a managed key, written only while it is absent.** Setup writes
  `remoteControlAtStartup: true` (Remote Control's auto-connect, D66) into the user's
  settings with no question, through `applyManagedJson` (`src/setup/remote-control.ts` plans
  it). A value of the person's own (`true` or `false`) is theirs: setup neither writes nor
  names it. A key setup wrote and the person changed or deleted since is theirs too: setup
  gives up its claim in the record (one quiet `·` line, once), so a `true` they write later is
  never taken for setup's. The release is a lasting record too, `remote-control-released` in
  the state folder (like the status line's "no"): an absent key is then left absent on every
  later run, and `restore` leaves the record, as it leaves that "no". A second setup changes nothing, and `restore` removes the key only
  while it still holds the `true` setup wrote.
- **`--dry-run`** shows every change and writes nothing at all: no state folder, no
  lock. Every setup runs this read-only pass first, outside the lock.
- **`restore`** removes what cc-smart-dev-kit added and keeps everything else: its own JSON
  keys and its Markdown block go; a whole file goes back to its **baseline** (the backup
  made at cc-smart-dev-kit's first change to it since the last restore), or is removed when
  setup created it. An object cc-smart-dev-kit created that a removal empties (the `env` its
  own keys went into) goes with its last key, so no `"env": {}` is left behind; an object the
  person had stays, also when it is empty (`createdObjects`, from the baseline backup: a
  baseline that is missing or unreadable proves nothing, and nothing is pruned). An object
  setup created is removed **even when the person emptied it later**: it is still the object
  setup made, and a missing object and `{}` read the same to Claude Code. A record
  (`changed.json`) that cannot be read is not an error here — a read-only pass must go on —
  so nothing is pruned and one line on stderr says so; a command that really writes reads
  the record itself and reports its own error. It backs up
  each file before it changes it. With the gateway on, the
  router's copy and unit wait for a second restore (§ The AI gateway), and its first stage
  names the command that runs the second one — the `bun --no-env-file --config=… …/dist/cli.js
  restore` line, when that stage removed the launcher and `cc-smart-dev-kit` is off the PATH. That
  first stage keeps a file tracked only for a key it **wrote again** (the gateway's address, the
  `writeInstead` list); a value a take-over recorded that comes back is the person's own, so it is
  named as put back and the file is forgotten. When no address was written because every one is
  the person's — set, changed or removed — the stage says the sessions keep the router until they
  restart. A restore with nothing left changes nothing.

Its state (`<stateDir>`) lives in `$CLAUDE_CONFIG_DIR/cc-smart-dev-kit/` (by default
`~/.claude/cc-smart-dev-kit/`): `owned.json`, `owned-entries.json`, `owned-hooks.json`, `owned-folders.json`, `changed.json`, the lock and `backups/`. The
state is per config folder, but the launcher in `~/.local/bin` is shared by all of
them. So a restore under one config folder can remove a launcher another one relies
on. A launcher started without `CLAUDE_CONFIG_DIR` looks in `~/.claude`.

## The plan folder

Setup writes `plansDirectory: ".claude/plans"` in the user's `settings.json` through
`applyManagedJson`, in a separate call inside the setup lock. The read-only pass shows it
for `--dry-run`. It is an owned key, with the same backup and restore path as other settings.
Plan files themselves belong to the project, are committed, and are never removed by restore.
A dirty worktree holding an uncommitted plan remains protected by the worktree cleanup check.

A `ForeignKeyError` for this key becomes an information line, not a failed setup: a personal
plan folder must not stop the other writes. A personal value equal to the default is also
left unowned. A second run changes nothing; restore removes only a value setup still owns
and leaves a changed personal value alone. Doctor names the user-level plan folder, or
Claude Code's default when no string is set, and says that project settings may override it.
No second plan-folder resolver is added: verify-gate already reads the user, project and
project-local settings and excludes both the configured folder and `.claude/plans`.

Claude Code resolves a relative folder against the session's own project root (proved on
2.1.326, `claude-code-contract.md` § Worktrees): a session started in the main checkout writes
its plan in the main checkout's `.claude/plans/`, and one started in a linked worktree writes it
in that worktree's. So a plan approved in plan mode from the main checkout of a project that
guards its main folder lands there, and the `plan-task` skill copies it into the worktree
(`main-folder-guard` lets that one write through, `docs/design/hooks.md`). A home-root project
or a Windows path with a backslash may fall back to the config folder's `plans` directory, and
is [still to prove](../claude-code-contract.md#relied-on-not-proved-yet).

## The task system (D75)

Setup registers `cc-smart-dev-kit-tasks` at user scope through the stable launcher, with
`alwaysLoad: true`, so the task tools are in every request from the first turn. It asks before
adding `mcp__cc-smart-dev-kit-tasks__*` to `permissions.allow`: this is a trust rule, like the
auto-mode entries, and is left out when no terminal can ask.

Managed deny entries remove `TaskCreate`, `TaskUpdate`, `TaskList`, `TaskGet` and
`TodoWrite` from Claude's tools. They never deny `TaskStop` or `TaskOutput`. Setup takes
back its own `env.CLAUDE_CODE_ENABLE_TODO_TOOLS` opt-in from D68. It sets claude-mem's
`CLAUDE_MEM_WORK_STATE_ENABLED` to `"false"`; a `"true"` the person sets after that stays.
Restore undoes the managed registration, permission entries and settings, not the person's
choices or task data.

After updating, run setup and restart Claude Code. Run `task import claude-mem` once to
move open lists; the import is not an automatic setup step. Doctor checks the server,
allow and deny entries, claude-mem's switch, work-store schema and integrity, and in a
project the task-file findings from `task check`. [Task design](tasks.md) owns the stores,
commands and guards. The status line adds rows for current work: the plan, its phases and the current phase's tasks
([Task design](tasks.md) § The hooks and pages that read it has the rows).

### Who changes what, and when

- **A SessionStart hook** adds a note to the session (§ The hooks) or starts the background
  self-update (§ Updates). It writes no user file, and never restarts or stops anything. It may
  refresh two managed copies that a plugin update leaves behind, through `src/setup/` under its
  lock: the instructions copy, and the git hooks folder, the first session start of a new
  version (`refreshGitHooksFolder`). It never creates the folder: only `setup` does, after it
  shows the change.
- **The background self-update** installs a newer plugin version with Claude Code's own
  `claude plugin` commands. It writes no user file and restarts nothing.
- **The move to the Claude defaults (D66) is `setup`'s alone.** Once per machine, in its own
  section of the report ("Gateway"): a backup of `gateway.json`, every slot's chain moved to
  Claude (a machine's chain waits in `kept`, a profile's is removed) and every fallback switch
  removed, the gateway turned off through `gateway off`'s code (`turnOff`), claude-mem back on
  Claude, one line per change. `doctor` says in one `·` line when a `gateway.json` still waits
  for it. Its marker (`claude-by-default` in the state
  folder) is written at the first real setup on every machine; `--dry-run` writes nothing, and
  `restore` leaves the marker, as it leaves `gateway.json`. A session start and the background
  update never reach it (a test walks their imports). `docs/gateway.md` § Slots and defaults.
- **The gateway menu refresh is a separate setup step.** After the defaults step is done,
  setup retires the old kit-owned Fable pin and refreshes `modelPicker` only for our still-owned
  active router address (`ourActiveGateway`, which doctor asks too); otherwise it removes an
  unchanged kit menu left behind, so a rollback or an older `gateway off` heals. A person's menu, including one removed by hand, stays theirs. The
  step uses the managed JSON writer under setup's lock, with the same dry-run preview.
  `docs/gateway.md` § What `gateway on` writes describes the rows and all their writers.
- **A manual run** (`cc-smart-dev-kit setup`, `cc-smart-dev-kit gateway setup`, `restore`) is the
  only thing that restarts or stops a service or changes a permission. It shows the change
  first, and asks before it cuts the answers in flight. Two more restart a service, and both
  are a person's own run too: the **portal's** "Restart the router" (the same `gateway setup
  --yes` the terminal runs, after a confirmation on the page) and **`omniroute update` /
  `rollback`** (which restart the unit the affordable slots answer through). Neither is ever
  started by a hook, a session or the background self-update.

So an automatic update can never restart something or widen a permission without the
user seeing it: a new router version runs only after `gateway setup`, which asks.


## Subagent concurrency

Setup writes `env.CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS` as the managed string `"10"` in
Claude Code's user settings. A value you set yourself stays yours. Use
`cc-smart-dev-kit setup --max-subagents <n>` to change the kit's value: it also takes the key
back after the person removed it, and over a value of their own it never writes, only warns
(a `!` line). `restore` takes back only the value the kit owns. This uses Claude Code's own per-session cap, not a kit queue.
Claude Code's default without the key is 20. A launch past the cap fails and Claude is told
not to retry. The key exists from Claude Code v2.1.217; the live check is still owed.

`doctor` prints one information line, `max subagents: …` (`maxSubagentsLine`,
`src/setup/max-subagents.ts`): the kit's value, the person's own value, a key the person removed
(Claude Code's own default), or no key yet, each with how to change it. Setup prints the same
line when it leaves a person's value alone, and one line when it sets or changes its own.

## Optional Herdr GUI

Manual setup offers the latest GUI by default. `--no-herdr` skips only this run.
An existing GUI stays unchanged; root, unsupported builds and Linux without a desktop
get manual guidance. All questions finish before the download or staging begins.
Consent, official installer/core bootstrap and upstream ownership boundaries live in
`.claude/rules/setup-commands.md`; the user-facing contract is `README.md` § Herdr GUI.
`src/machine/herdr.ts` plans the offer; `src/setup/herdr.ts` stages it under the setup lock,
uses explicit interpreter argv with installer controls cleared only in the child, checks
GUI/core presence without launching either, and removes its staging files. A missing core
after GUI installation is reported distinctly. These fake-machine tests are not native
platform installation proof.
