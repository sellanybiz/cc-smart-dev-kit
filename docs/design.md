# Design

How the `anymodel` plugin is built, and why. For the phases ahead see `roadmap.md`; for the
Claude Code behaviour it relies on see `claude-code-contract.md`.

## The three parts

| Part | What it is | How it reaches a machine |
|---|---|---|
| **The plugin** | Hooks, skills, agents and bundled scripts in `plugin/`. | `claude plugin install anymodel@anymodel`. Claude Code copies `plugin/` into a version folder and updates it. |
| **`anymodel setup`** | A command that does what a plugin cannot: changes to user files, MCP registration, long-running copies. | Run by hand, once after the install and again when a release asks for it. |
| **The launcher** | `~/.local/bin/anymodel`, a small `sh` script. | Written by `setup`. |

A plugin alone cannot change a user's `settings.json`, register an MCP server at user
scope, or keep a service running. A setup command alone has no versions and no update
channel. Together they get both. The cost is two places to look, so
`anymodel doctor` checks both (its list of checks: `README.md` § Commands).

**macOS and Linux for now.** The launcher and `plugin/bin/` are POSIX `sh` scripts.

### Why a stable launcher

Claude Code installs each version into its own folder,
`~/.claude/plugins/cache/anymodel/anymodel/<version>/`, and deletes an old folder some time
after an update (14 days, the docs say; not proved yet: `claude-code-contract.md`).
Installs and updates are keyed by the version, so every change to `plugin/` raises it;
CI checks that. A terminal, a systemd unit or a cron job cannot point into a folder
whose name changes. The launcher reads Claude Code's `installed_plugins.json`, finds the
user-scope install of `anymodel@anymodel`, and runs that version's `dist/cli.js`. It stays
valid across updates.

`setup` writes into the launcher the absolute path of the `bun` that ran it. The
launcher tries that first, then `bun` on PATH, so it also works under systemd and cron.

Inside Claude Code's Bash tool, `plugin/bin/anymodel` is on PATH as well, and runs the
same CLI from its own version folder.

### Why long-running parts run from copies

Anything that keeps running (the AI gateway's router; later the portal) runs from a copy
in `~/.local/share/anymodel/`, never from the version folder. Claude Code deletes that
folder after an update (14 days, not proved yet), even under a running process.
`anymodel gateway setup` copies `dist/router.js` there and writes a systemd user unit
that runs the copy with the absolute path of `bun`, and a socket unit that holds the
router's port across restarts (`gateway.md` § The service). A new plugin version changes nothing
that runs until the person runs `gateway setup` again; `doctor` says when the copy is
older than the installed version.

## The AI gateway

An optional local router between Claude Code and the model providers
(`src/gateway/`, design and limits in `gateway.md`):

- Claude models go to Anthropic byte for byte, on the person's own login. The `haiku` and
  `sonnet` names point at slots of cheaper models, each with a Claude target last.
- **No prompt text is ever changed.** A cheap backend gets two named, tested format
  translations and nothing else. A slot's Claude target gets one,
  `requestForClaudeFallback`: only the fields that Claude model refuses (Claude Code built
  the body for the slot name), never a word of the prompt. The rules:
  `.claude/rules/gateway.md`.
- Every 4xx / 5xx from any target is logged with the start of its reason, keys masked,
  so a failure can be read in the journal.
- Auto mode's safety check stays on Claude unless the person turns on the opt-in judge
  slot.
- A config `aliases` map lets a machine's old model names reach the new slots while it
  moves. The plugin ships none; a project's migration writes them.
- `gateway on` / `off` change Claude Code's settings only as owned keys through
  `src/setup/`, so `restore` undoes them, and a key someone else set stops it.
- Every session on the machine goes through the router, so its restart must not make
  them fail. systemd's `anymodel-router.socket` holds the port (socket activation) and
  passes it to the router; the router accepts on it with `node:net` (Bun's own server
  cannot take an inherited socket) and relays each connection to its own server on a
  private unix socket. On a restart the old router finishes its answers (up to 120 s;
  a longer one is cut, and Claude Code retries it) and new requests wait in the socket:
  none fails (proved live). A connection that never sends a byte is closed after half a
  second, so it cannot hold the drain. A router that keeps failing to start is given up
  after 5 starts in 60 s, and systemd closes the socket with it, so requests are refused
  at once instead of hanging (proved live). The restart still waits for that drain,
  so only a manual `gateway setup` restarts it, only when the copy or a unit changed (or
  an earlier setup did not finish: the restart-pending marker), and only after the
  person says yes (or gives `--yes`). The first setup that moves a router from the older
  plain unit cannot keep the port open (systemd will not open a socket while its service
  runs), and says so before it asks. Before anything, setup asks the port and stops when
  another program holds it; after the restart it waits for the health page.
- Running sessions are taken to keep the router's address until they restart (one live
  look saw otherwise; `claude-code-contract.md`). So `restore` takes the gateway out in
  two stages: first the env keys (the router keeps running), then, after the sessions
  restarted, the router (asked first). `restore --now` does both, with a warning. The
  stop never waits for the router's drain: `disable`, then one `stop --no-block` of the
  socket and the service together, then up to 15 s for the port to close.
- The router bundle carries no version (`src/build-info/names.ts`), so a version bump
  alone never changes `router.js` and never makes a machine restart its router.

## How `setup` changes user files

`setup` owns **managed** parts of user files, and only those:

- in a JSON settings file, single keys (listed in its state, `owned.json`);
- in a Markdown file, one block between `<!-- anymodel:begin -->` and
  `<!-- anymodel:end -->`;
- whole files it creates itself (the launcher).

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
  is never overwritten; setup stops and says so. Setup checks `settings.json` before it
  writes the launcher, so such a key (for example `autoUpdate: false`) stops it before
  anything is written.
- **`--dry-run`** shows every change and writes nothing at all: no state folder, no
  lock. Every setup runs this read-only pass first, outside the lock.
- **`restore`** removes what anymodel added and keeps everything else: its own JSON
  keys and its Markdown block go; a whole file goes back to its **baseline** (the backup
  made at anymodel's first change to it since the last restore), or is removed when
  setup created it. It backs up each file before it changes it. With the gateway on, the
  router's copy and unit wait for a second restore (§ The AI gateway). A restore with
  nothing left changes nothing.

Its state (`<stateDir>`) lives in `$CLAUDE_CONFIG_DIR/anymodel/` (by default
`~/.claude/anymodel/`): `owned.json`, `changed.json`, the lock and `backups/`. The
state is per config folder, but the launcher in `~/.local/bin` is shared by all of
them. So a restore under one config folder can remove a launcher another one relies
on. A launcher started without `CLAUDE_CONFIG_DIR` looks in `~/.claude`.

### Who changes what, and when

- **The SessionStart hook** starts the background self-update (§ Updates). It writes no
  user file, and never restarts or stops anything. (Refreshing managed files from it is
  not built yet; `anymodel setup` does that by hand.)
- **The background self-update** installs a newer plugin version with Claude Code's own
  `claude plugin` commands. It writes no user file and restarts nothing.
- **A manual run** (`anymodel setup`, `anymodel gateway setup`, `restore`) is the
  only thing that restarts or stops a service or changes a permission. It shows the change
  first, and asks before it cuts the answers in flight.

So an automatic update can never restart something or widen a permission without the
user seeing it: a new router version runs only after `gateway setup`, which asks.

## Updates

Claude Code's own plugin auto-update (`autoUpdate: true`, which `setup` turns on) did not
run on a machine where it was on: 15 minutes after a session started, not even the
marketplace copy was refreshed (anthropics/claude-code#61854). The same two commands by
hand worked at once. So the plugin updates itself (the owner's decision, 2026-10-15):

- **The SessionStart hook** (`src/entries/update-check.ts`, logic in
  `src/update/background.ts`) records which version the session loaded, and starts the
  check in a **detached** process (its own session, no pipe to the hook) when one is due:
  at most once an hour per config folder, and not while updates are held. It needs no
  network and no lock, and returns at once (about 60 ms on a loaded machine, most of it
  bun's own start). It prints nothing, unless the last background check failed and no
  session was told yet: then one `systemMessage`, to an attended session only (Claude
  Code sets `CLAUDE_CODE_SESSION_ATTENDED=0` for the hooks of `claude -p`; such a session
  neither shows it nor counts as told). It runs bun through `plugin/bin/anymodel-bun`,
  which looks where the launcher does, so a Claude Code started with no bun on PATH
  still runs it.
- **Claude Code's switches for updates are honoured.** While `DISABLE_AUTOUPDATER`,
  `DISABLE_UPDATES` or `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC` is set (environment or
  the `env` of `settings.json`) and `FORCE_AUTOUPDATE_PLUGINS` is not, the hook starts
  nothing and only records "skipped: <name> is set"; the background check asks again
  under its lock. One list for both, and for `doctor`: `src/update/opt-out.ts`.
- **The background check** takes the update lock (`<stateDir>/update/lock`, the same
  `withLock` as setup, but its own file, so a slow update never blocks `anymodel setup`),
  asks again whether a check is due (two sessions starting together check once), then
  compares the remote head (`git ls-remote`) with Claude Code's copy, and the installed
  version with the copy's (`src/update/check.ts`). When either is behind it runs `claude
  plugin marketplace update anymodel`, then `claude plugin update anymodel@anymodel
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
- **`anymodel update`** does the same in the terminal, with each command's output;
  `--check` only reads (the remote's version comes from a shallow fetch into a temp
  folder, never from Claude Code's copy); `--hold` / `--resume` switch the background
  update off and on for this machine, with one atomic write and no lock, and say so when
  a check is running now (it finishes).
- **`doctor`** shows the last check and its result, the hold, and running sessions that
  loaded an older version than the one installed now.

The trade-off, accepted: a bad release reaches every machine within the hour, without a
person running anything. A rollback is a new, higher version, which reaches them the same
way; `--hold` keeps one machine where it is. Proved live: a real Claude Code session's
SessionStart hook started the background check, which outlived the session and ran both
`claude plugin` commands, in a throwaway config folder (`claude-code-contract.md`).

## Per-project opt-in: `.claude/anymodel.json`

The plugin is installed for the user, so it runs in every project. A project opts in,
and gives its own details, with `.claude/anymodel.json`:

```json
{
  "requires": ">=0.1",
  "worktrees": { "base": "main", "prefix": "app-wt-", "setup": ["bun", "install"] },
  "instructions": true,
  "autoMode": ["In my-app: never touch production."]
}
```

The plugin accepts `worktrees`, `instructions` and `autoMode` now and uses them from
Phase 3, 5 and 6 (`roadmap.md`).

- A hook finds the project from its input's `cwd`, which follows the session into a
  worktree. A worktree's own `anymodel.json` wins; else the main checkout's is used. A moved
  or deleted main checkout, and git older than 2.31, each give a clear error.
- **`requires` is checked before the strict parse.** A project may use a field newer
  than a user's plugin; that user is told to update, not that the field is unknown.
- **Without `anymodel.json`, the plugin does Claude Code's default** and its guards stay
  silent. A project that never opted in does not notice the plugin.

### How a project adds its own part to a general skill

A general skill reads the project's own additions when they exist. For example,
`/anymodel:review` also follows the project's `.claude/anymodel/review.md`, and where they disagree,
the project's text wins. The plugin stays general; each project keeps its own rules in
its own repo.

## The safe switch

A project may already have its own copy of a piece the plugin now ships (a worktree
hook, a guard). Moving it to the plugin must never run it twice or leave a gap:

1. **A plugin release adds the piece, with a defer check.** The plugin's hook stays
   silent while the project still wires its own copy.
2. Every machine gets the plugin, and `anymodel doctor` is green on each.
3. **Then the project removes its copy** and raises `requires` in its `anymodel.json`.
4. **A small fail-closed check in the project** covers a machine without the plugin: it
   stops risky work instead of going on unguarded.

Rollback is a new release with the old behaviour. A version number never goes down.

## MCP servers at user scope

`setup` registers MCP servers (later: the shared browser, Serena) at user scope. The
plugin does not serve them. A server served from a plugin gets a new tool-name prefix,
which would break every permission rule, hook matcher and agent tool list that names
`mcp__<server>__*`. Registered by `setup`, the names stay as they are.

## Auto mode reads only user settings

Claude Code's auto mode reads its rules from the user's settings, not from a project's.
So `setup` copies each opted-in project's `autoMode` rules from its `anymodel.json` into a
managed block in the user's settings. The project owns the wording; the plugin only
copies it.

## Neutral by design

The plugin carries only general behaviour. Every project value — a branch, a folder
prefix, a command, a rule's wording — is an `anymodel.json` field or a file in the project's
own `.claude/`. The publisher appears only in the two manifests, and
`bun run check:neutral` keeps it out of every other file.

## Keeping up with Claude Code

The plugin relies on Claude Code behaviour that can change in any release.
`claude-code-contract.md` lists each behaviour, the version it was last proved on, and
how it is proved. CI tests one version, written in `.claude-code-version`. A weekly CI
job tests the newest Claude Code and opens an issue when it is newer or a check fails;
the `claude-code-upgrade` skill in `.claude/skills/` takes it from there.

## Alternatives we did not take

- **A folder linked into `~/.claude`:** no versions, no update channel, and a project
  cannot require a version. Rejected.
- **Each project carries its own copy:** every project drifts on its own, and a fix
  reaches only one of them. Rejected.
- **MCP servers served from the plugin:** it renames every tool (above). Rejected.
