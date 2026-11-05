# Updates


Claude Code's own plugin auto-update (`autoUpdate: true`, which `setup` turned on before
0.7.0) did not run on a machine where it was on: 15 minutes after a session started, not
even the marketplace copy was refreshed (anthropics/claude-code#61854). The same two
commands by hand worked at once. So the plugin updates itself (the owner's decision,
2026-10-15). Since 0.7.0 it is the only updater (D39): Claude Code's own auto-update is off
for this marketplace, because it knows nothing of the major hold below and would install a
major version by itself the day it runs.

- **Claude Code's own auto-update off** (`src/setup/auto-update.ts`). Claude Code 2.1.306
  decides by the first of three that is set: the settings' `extraKnownMarketplaces.<name>.
  autoUpdate`, then the `autoUpdate` in its own `known_marketplaces.json`, then its default
  (off for a marketplace that is not Anthropic's). A session start copies a settings value
  into that record, and copies nothing when the settings have none. So a removed key leaves
  an older `true` in the record, and auto-update stays on; only an explicit `false` in the
  settings turns it off (proved live: `claude-code-contract.md`). `setup` manages the key at
  `false`, with the usual ownership rules: an older setup's `true` is its own and becomes
  `false`; a `true` the person set stops setup (`ForeignKeyError`). A machine that reached
  0.7.0 through the background update never ran setup, so each background check first turns
  setup's own leftover `true` to `false` (`turnOffLeftoverAutoUpdate`: `applyManagedJson`
  under the state lock, with no wait), and nothing else: a key a `restore` took away is not
  put back, and a `true` of the person's stays. Every failure there (a busy lock, the
  person's value, a broken settings file) is one line in `update.log`, and the check goes on.
  `doctor` passes while nothing turns it on, and fails on a `true` in the settings (setup's:
  run setup; the person's: remove it by hand, then setup) or in the record.

- **The SessionStart hook** (`src/entries/update-check.ts`, logic in
  `src/update/background.ts`) records which version the session loaded, and starts the
  check in a **detached** process (its own session, no pipe to the hook) when one is due:
  at most once an hour per config folder, and not while updates are held. It needs no
  network and no lock, and returns at once (about 60 ms on a loaded machine, most of it
  bun's own start). It prints nothing, unless the last background check failed and no
  session was told yet, or a major version is held (below): then one `systemMessage`, to
  an attended session only (Claude Code sets `CLAUDE_CODE_SESSION_ATTENDED=0` for the hooks
  of `claude -p`; such a session neither shows it nor counts as told). It runs bun through `plugin/bin/cc-smart-dev-kit-bun.sh`,
  which looks where the launcher does, so a Claude Code started with no bun on PATH
  still runs it.
- **Claude Code's switches for updates are honoured.** While `DISABLE_AUTOUPDATER`,
  `DISABLE_UPDATES` or `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC` is set (environment or
  the `env` of `settings.json`) and `FORCE_AUTOUPDATE_PLUGINS` is not, the hook starts
  nothing and only records "skipped: <name> is set"; the background check asks again
  under its lock. One list for both, and for `doctor`: `src/update/opt-out.ts`.
- **The background check** takes the update lock (`<stateDir>/update/lock`, the same
  `withLock` as setup, but its own file, so a slow update never blocks `cc-smart-dev-kit setup`),
  asks again whether a check is due (two sessions starting together check once), then
  compares the remote head (`git ls-remote`) with Claude Code's copy, and the installed
  version with the copy's (`src/update/check.ts`). When either is behind it runs `claude
  plugin marketplace update cc-smart-dev-kit`, then `claude plugin update cc-smart-dev-kit@cc-smart-dev-kit
  --scope user` when the copy holds a newer version; logs each step to
  `<stateDir>/update.log`; records the result in `update-check.json`; and shows one
  desktop notification when a new version was installed (with the `gateway setup` hint
  when its router differs from the running copy). The detached process and both commands
  run in the home folder, without git variables that point at another repo (`GIT_DIR`,
  `GIT_INDEX_FILE`, …, which a session inside a git hook may carry). A command's output
  that goes into a record passes through the URL redaction. Not failures: a marketplace
  that cannot be read is `unreachable` (information) until it has been so for 24 hours in
  a row, and Claude Code's own refresh holding git's `index.lock` at that moment is
  `skipped`.
- **A companion plugin too old for the new version stops the update first.** Claude Code
  refuses to install a plugin while an installed dependency is outside the range it asks
  for (`docs/claude-code-contract.md` § Plugin dependencies), and `cc-smart-dev-kit update`
  would then fail the same way. So after the refresh, `applyUpdate` reads the new version's
  `dependencies` from the copy's own `plugin.json` (`readManifestDependencies`; the running
  version's own list only when that file cannot be read), and checks each **installed**
  companion's version against it with doctor's range check (`versionState` and
  `companionCheck` in `src/machine/companions.ts`). One that is outside the range, or has no
  version number, skips `claude plugin update` and fails with one line that names the
  companion and its fix, built from its id: "cc-smart-dev-kit 2.3.0 was not installed, because
  of a companion plugin it needs: claude-mem@thedotmack 14.2.0 is outside >=15.0.0. First
  run: claude plugin update claude-mem@thedotmack". The command prints it and exits 1; the
  background check records it as `failed`, so the next attended session start tells it once.
  A companion that is not installed does not stop the update: Claude Code installs it with the
  update when its marketplace is added, and doctor names it with its own fix. Neither does a
  dependency from a marketplace this version does not know: the new version's setup adds it.
- **`cc-smart-dev-kit update`** does the same in the terminal, with each command's output;
  `--check` only reads (the remote's version comes from a shallow fetch into a temp
  folder, never from Claude Code's copy); `--hold` / `--resume` switch the background
  update off and on for this machine, with one atomic write and no lock, and say so when
  a check is running now (it finishes).
- **`doctor`** shows the last check and its result, the hold, and running sessions that
  loaded an older version than the one installed now.
- **A major version waits for the person (D33, since 0.7.0).** A new major one may need the
  person's own work first (1.0.0 refuses the retired worktree fields), so it must not reach a
  machine behind their back. `applyUpdate` (`src/update/apply.ts`) refreshes the
  marketplace, and when the copy's version is a new major one (`isNewMajor` in
  `src/update/major.ts`: the first number grows, compared with `Bun.semver.order`; a
  version it cannot read is no major step) it asks its caller first (`onMajor`). The
  background check says no: it installs nothing, records `skipped` with the reason, and
  writes `<stateDir>/update-major.json` (the version, the version installed then, when it
  was first found, and the why). The hold is its own file, not a new result in
  `update-check.json`: an older version's hook refuses a result it does not know, counts the
  record as no check, and would check again at once. A later check that finds the install
  current (installed by hand, or the release taken back) removes the file.
  - **The session start** shows one line while the file names a version above the installed
    one: "cc-smart-dev-kit 1.0.0 is ready: it is a major version (it refuses old project
    fields). Read What's new, then run `cc-smart-dev-kit update`." Only when the hook's
    input says a session starts (`source` `startup` or `resume`, or no `source`), never on a
    `clear` or a `compact` of the same session; to an attended session only; after a failure
    to tell, in the same `systemMessage`. `update --hold` and Claude Code's switches for
    updates come first: they silence it.
  - **The why comes from the new version.** The running code is the installed version's: it
    cannot know why a later major is one. So each major names its reason in
    `src/update/major-notes.json` (`{ "1.0.0": "it refuses old project fields" }`), and the
    check reads that file from Claude Code's marketplace copy (the new version's repo, just
    refreshed) at `MAJOR_NOTES_PATH`, keeping only short one-line notes of the majors the
    step crosses. Every installed version reads that path, so the file never moves; a test
    keeps the current major's note in it. Without the file the line has no why.
  - **`cc-smart-dev-kit update`** is the person's yes. Before it installs a major version it
    prints that it is one and lists the repos that still carry a retired piece (below); then
    it installs, and asks for `cc-smart-dev-kit setup` (a major version's own one-time steps
    run there). The hold's file goes only once the version it holds is really installed
    (`!isOlder(after, held.version)`): a failed install, or a `claude plugin update` that
    ends well and installs nothing, keeps it, and `update` says on stderr, with exit 1, that
    the major version still waits. `update --check` says when the newer version is a major
    one, and `doctor` shows a held major as a `·` line naming `update`, never `claude plugin
    update` (which would skip the hold).
  - **The repo list** (1.0.0, `src/update/retired-repos.ts`), printed by `update` before a
    major and by every `setup` run (`--dry-run` too): the folders Claude Code's saved
    sessions name (`sessionWorkFolders` in `src/sessions/command.ts`, the same reader
    `sessions` uses: one file per project folder, its newest), each taken to its own checkout
    root and, beside it, to the main checkout: a linked worktree's own file wins over the main
    checkout's, as `loadProjectConfig` reads it, so a long-lived worktree on an older branch
    is its own finding; a folder that is gone or not in git is skipped. A checkout is listed,
    one `!` line with `cd <checkout> && cc-smart-dev-kit project init` (a worktree's line names
    the main checkout too), when its `.claude/cc-smart-dev-kit.json` sets a retired field
    (`retiredFieldsOf`, over `RETIRED_WORKTREE_FIELDS`), is not valid JSON (with the error), or
    one of its two settings files runs an engine hook (`retiredEngineHookOf`). Read-only: no
    other repo is ever written.
  - **An installed version that cannot be read is no major step.** `installed_plugins.json`
    may name no version (`findUserInstall` gives null), or one that is not a version: then
    `isNewMajor` is false, and the background check installs the newer version as before.
  - **A version before 0.7.0 does not know this rule.** Its background check (0.6.0's
    `applyUpdate`) installs whatever is newer. A machine follows the new rule only once a
    session has loaded a version that has it; a session still on the old version that runs
    its SessionStart again (a `/clear`, a compaction) most likely runs the old hook (its
    plugin folder is fixed for the session; not proved). So 0.7.0 ships before 1.0.0, on
    its own, to reach the machines first.

The trade-off, accepted: a bad release reaches every machine within the hour, without a
person running anything. A rollback is a new, higher version, which reaches them the same
way; `--hold` keeps one machine where it is. Proved live: a real Claude Code session's
SessionStart hook started the background check, which outlived the session and ran both
`claude plugin` commands, in a throwaway config folder (`claude-code-contract.md`).
