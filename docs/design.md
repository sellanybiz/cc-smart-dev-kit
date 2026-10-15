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
that runs the copy with the absolute path of `bun`. A new plugin version changes nothing
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
- Auto mode's safety check is judged by Claude whenever Claude can answer it. The opt-in
  judge slot is a fallback only, for when Claude cannot (the plan's usage limit, no valid
  login), and a target must pass a test check before it is set. Otherwise Claude Code asks
  the person.
- Opus and Fable stay byte for byte on Anthropic. An opt-in model slot answers from a
  fallback only at the plan's usage limit; the router writes what it saw to a small state
  file that the status line and the StopFailure alert read.
- A config `aliases` map lets a machine's old model names reach the new slots while it
  moves. The plugin ships none; a project's migration writes them.
- `gateway on` / `off` change Claude Code's settings only as owned keys through
  `src/setup/`, so `restore` undoes them, and a key someone else set stops it.
- A restart of the router cuts every answer in flight on the machine. So only a manual
  `gateway setup` restarts it, only when the copy or the unit changed (or an earlier
  setup did not finish: the restart-pending marker), and only after the person says yes
  (or gives `--yes`). Before anything, setup asks the port and stops when another
  program holds it; after the restart it waits for the health page.
- Running sessions are taken to keep the router's address until they restart (one live
  look saw otherwise; `claude-code-contract.md`). So `restore` takes the gateway out in
  two stages: first the env keys (the router keeps running), then, after the sessions
  restarted, the router (asked first). `restore --now` does both, with a warning. The
  stop never waits for the router's drain: `disable`, `stop --no-block`, then up to 15 s
  for its port to close.
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

- **The SessionStart hook** (Phase 3 on) only refreshes managed files, under the lock.
- **A manual run** (`anymodel setup`, `anymodel gateway setup`, `restore`) is the
  only thing that restarts or stops a service or changes a permission. It shows the change
  first, and asks before it cuts the answers in flight.

So an automatic update can never restart something or widen a permission without the
user seeing it.

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
