# OmniRoute


The affordable slots answer through OmniRoute, a program a person installs themselves (a
global Bun or npm install) and runs as a user service (`src/omniroute/`).
`cc-smart-dev-kit omniroute status|update|rollback` keeps it on a version that has had a few
days to prove itself. `doctor` says, as information, when one is waiting.

- **Nothing about one machine is written into the plugin.** The unit is found by reading
  `~/.config/systemd/user/*.service` and taking the one whose `ExecStart` runs OmniRoute; the
  install is found from that command line by walking up to the package's own manifest. With
  no unit, Bun's and npm's global folders and the `omniroute` on PATH are looked in. The
  backend that talks to it is the one named `omniroute` in `gateway.json`, else one on this
  machine whose port the unit's `Environment=` or `EnvironmentFile=` names.
- **Three days.** `newestRelease` reads `https://registry.npmjs.org/omniroute` and takes the
  newest plain `x.y.z` with a published time at least three days old. A canary, a version
  published today and a version the registry has no time for are all left out. A release that
  reaches a machine the hour it is published reaches it before anyone else has run it, and
  OmniRoute is the model path of every affordable slot here.
- **The update.** Record the version it replaces in `<stateDir>/omniroute.json`; install
  through the manager that owns the install (`bun add --global omniroute@<v>`, or
  `npm install --global`); `systemctl --user restart <unit>`; wait until the backend answers
  `GET /v1/models` at all — up to a minute, with a growing pause between tries (`waitForBackend`,
  refused connections are "not listening yet"; an HTTP answer, 401 included, ends the wait);
  then check the model path (`probeModel`, `src/gateway/backends.ts`): `GET /v1/models` with
  the backend's key — a 401 is named as the key, not the version — and one tiny chat to the
  first affordable target of the scout slot (`PROBE_PROMPT`, a fixed word of the plugin's own;
  nothing from a conversation, the machine or the person is sent). On any failure: install the
  old version again, restart, wait and check the same way, and print what failed. The wait is
  why a good release is not rolled back for being slow to listen: `systemctl --user restart`
  returns before OmniRoute binds its port.
- **Record, install, restart and check are one change, under setup's lock** (`withLock`): a
  second `update` or `rollback` — a terminal and the portal, or two terminals — waits for the
  first, and says who holds it when the wait runs out. `rollback` takes the same lock.
- **A folder this user cannot write is refused before anything is recorded or run**
  (`installIsWritable`: the package's folder and the one holding it). A global install under a
  root-owned prefix fails with EACCES halfway through, and the put-back then "fails" the same
  way though nothing changed; the command to copy (`sudo <manager> …`) is printed instead, and
  `sudo` is never run.
- **`--to <version>` follows the three-day rule** (`toRefusal`). It must be a plain `x.y.z`
  that the registry lists and that is at least three days old; a version published this
  morning, a canary, a `https://…` tarball and a `github:…` spec are refused in words and
  nothing runs — `bun add --global omniroute@<spec>` would otherwise install whatever npm
  resolved the spec to. A version npm marks deprecated is not offered by `newestRelease`
  either, and can never be named by `--to`.
- **Never in the background, and never inside a Claude Code session.** It restarts a service
  that answers real requests, so a person runs it, sees each step and reads what failed; and a
  session must not move its own model path mid-turn. The confirmation says what the restart
  costs: while the unit comes back, a slot whose fallback is on falls to its next target,
  and one whose chain is used up fails.
- **`rollback`** installs the recorded version and keeps the record, so a second rollback is a
  no-op rather than a bounce.
- **Every effect goes through an injected `runner`, `registry` and `fetch`**, so a test uses a
  fake bun, a fake systemctl, a fake registry and a fake backend, and never reaches the real
  OmniRoute, the real registry or systemd (`src/omniroute/omniroute.test.ts`).



Before 0.3.0 the plugin's own names — the plugin and marketplace, the command, the
folders, the gateway's slots and the router units — said `anymodel`.
`cc-smart-dev-kit migrate` (`src/cli/migrate.ts`) moves such a machine, and that file is
the only code that still names them (with its test, and `README.md` § Moving from
anymodel). It:

- moves the folders (`~/.config`, the state folder, `~/.local/share`, `~/.local/state`)
  and the launcher file, and rewrites the state folder's records and backups — the file
  paths in `owned.json`, `owned-entries.json` and `changed.json`, each entry's
  `baseline`, and each backup's folder and file name — so `restore` still finds what the
  old setup changed and can still undo it;
- gives the settings keys the old setup owned (and that still hold its value, the
  remembered-value rule) this version's value: the slots' names and the words of their
  descriptions;
- rewrites the instructions block's markers and import path, then refreshes the copy
  through `installInstructions`, the one path `setup` uses;
- renames the gateway config's slots and adds an alias for each old name, so a Claude
  session that is still running (its settings name the old slots) keeps working until it
  restarts;
- replaces the `anymodel-router` units through the gateway's own install path
  (`installRouter`), after stopping and disabling the old ones with `--no-block`, as
  `restore` does;
- says to uninstall the old plugin, and does it after a yes on a terminal.

It refuses to run inside a Claude Code session: it replaces the router that session's own
model traffic goes through. It also stops before writing anything when a target folder is
already there — two folders are never merged by themselves. Every step prints one line,
each changed file gets a backup first, and `--dry-run` writes, runs and stops nothing. A
second run says "Nothing to move.". One thing does not carry over: a judge target's test
proof (the proof's own text changed with the name), so a judge needs its test again.
