# Moving a machine from the old names (0.3.0)


Before 0.3.0 the plugin's own names — the plugin and marketplace, the command, the
folders, the gateway's slots and the router units — said `anymodel`.
`cc-smart-dev-kit migrate` (`src/cli/migrate.ts`) moves such a machine, and that file is
the only code that still names them (with its test, and `README.md` § Moving from
anymodel). The command has a fixed order, and the order is the point of it:

1. **Refusals.** Inside a Claude Code session (it replaces the router that session's model
   traffic goes through), and on a Bun older than `MIN_BUN`.
2. **Read and check everything, before anything moves.** The new plugin's install; the
   folders (two are never merged silently); the new state folder, which the move may go
   into when it holds nothing but this plugin's own bookkeeping (a Claude session's start
   writes its `sessions/` record and an update check there before anyone runs `migrate`) —
   anything else in it stops the run, naming what is in each folder; the gateway config
   (readable by its owner alone, and **the whole rewritten config through the schema**, so
   a rewrite that would not be valid is refused here, not after the move); the settings;
   the records (`owned.json`, `owned-entries.json`, `changed.json`); and the Claude
   sessions that started with the old plugin and still run.
3. **Every question**, before a single byte is written: the router restart (only when the
   old router runs) and the old plugin's uninstall (only when it is still installed, and
   only ever on a terminal). A "no" — or no terminal to ask on, and no `--yes` — stops
   with nothing written: a machine that moves without replacing its router would be left
   half moved.
4. **A dry run stops here**, with the plan: the steps it would do, the changes each would
   make, and the question it would ask. It reads the state folder and the records of the
   old names, so its plan is exactly what a real run does.
5. **The moves and the rewrites**, each recorded as it finishes in
   `<stateDir>/migrate-progress.json` (mode 600, removed when the move is done): the
   folders and the launcher file; the state folder's records and backups (the file paths
   in `owned.json`, `owned-entries.json` and `changed.json`, each entry's `baseline`, and
   each backup's folder and file name) so `restore` still finds what the old setup
   changed; the settings keys the old setup owned (and that still hold its value, the
   remembered-value rule — a key the person changed *or removed* since is theirs); the
   instructions block's markers and import path, then the copy through
   `installInstructions`, the one path `setup` uses — **when a block is there**: 0.2.x
   shipped no instructions, so a 0.2.x machine has none, and the move installs none and
   says so in its closing lines (`instructionsToSetup`); the gateway config's slots, with
   an alias for each old name so a session that still holds one keeps working, and an alias
   of a project's own that pointed at an old slot pointed at the renamed one (an alias to
   an alias would make the whole config invalid); the limit state's fallback keys; and the
   launcher's text for this version.
6. **The router.** The old units **whose files are there** are disabled and stopped
   (`--no-block`, one call each, socket first) — a 0.2.x machine has no socket unit, and
   `systemctl disable` on a unit that does not exist fails, which must never stop a move
   (`stopUnits` in `src/gateway/service.ts`, shared with `restore`). Then the old
   router's **own** health page (`/__anymodel/health`) is asked until the port is refused
   or that page stops answering (15 s, bounded); only then are this version's units
   installed through the gateway's own path (`installRouter`) and its health page checked.
   A router that never lets go fails this step, and the step says so.
7. **The closing lines**: restart every session; test the judge again when the old config
   had a tested one (its proof names the old command, so it does not carry over); and the
   old plugin's uninstall commands.

A step that fails prints which step, what the steps before it did (kept), and that running
`migrate` again goes on from there: each step is safe to repeat, and a resumed run skips
the steps the progress file records. "Nothing to move." is not only about the folders
being gone: `oldPiecesPresent` also counts an old slot name in the gateway config, the old
markers in `~/.claude/CLAUDE.md`, an old path in a record or in a backup's name, and an
unfinished run's progress file. Every changed file gets a backup first.

The old names live in one table (`OLD`), and the units the router step works on — both
pairs' names, their folder, and the port — are one injectable table
(`MigrateOptions.router`), so a live check runs the whole command against throwaway
runtime units on a free port without touching a real machine's router.

`renamedPath` renames only the paths this move actually moves (the four folders, the
launcher file, the two unit files): a path of the person's own that happens to carry the
old word in a segment is not ours to rename.

Verified live, with real `systemctl --user` on throwaway runtime units
(`amtest-old-router.service` in `/run/user/<uid>/systemd/user`, a fake old router on a free
port, removed afterwards) and a scratch HOME: the real `systemctl disable` of the socket
unit file a 0.2.x machine never had fails with "Unit … does not exist" (shown first), and
`stopUnits` then skips it, disables and stops the service for real (a read-only `is-active`
after it says `inactive`), and throws nothing; the old router's health page is waited for
against a real server on a real port — held while it answers, and `free` only once the port
is refused. The half that starts and enables this version's units (`installRouter` runs
`systemctl --user enable` and `start`) still has to be run where a check may start a
service; `MigrateOptions.router` is what it needs.
