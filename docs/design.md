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

### The Bun it needs

anymodel needs Bun 1.4.3 or later. The number lives in one place, `MIN_BUN` in
`src/build-info/bun.ts`, which the router bundle may import (it holds no plugin
version). `package.json` `engines.bun` and the Bun version of both CI workflows follow
it, and a test (`src/build-info/bun.test.ts`) fails when one of them differs.

Why 1.4.3: a request to a backend on this machine carries the backend's key, and it must
never go through a proxy from the environment. `fetch(url, { proxy: false })` says so,
and Bun honours it from 1.4.3 on (oven-sh/bun#42692). Bun 1.4.2 ignores it and sends the
request to `HTTP_PROXY` (measured). No workaround is kept for an older Bun: the owner
chose a required version over one (2026-10-15).

Where it is checked, each time against the Bun running the code (`Bun.version`):

- **The CLI**, at start. On an older Bun every command stops with "anymodel needs
  Bun ≥ 1.4.3; this is 1.4.2 (<path>). Upgrade this Bun, then run the command again.",
  except the ones that send no key and help the person out: `doctor`, `restore`,
  `version` and help (`src/cli/bun-check.ts`).
- **`doctor`**: its first line is the Bun, ✓ or ✗. On an older Bun it skips the gateway
  checks, which send the backend key.
- **`gateway setup`** (`installRouter`): refuses to install the router for an older Bun,
  before it asks or writes anything.
- **The router**, at start: it does not listen on an older Bun. systemd stops trying after
  5 failed starts in 60 s (`StartLimitBurst` in `src/gateway/service.ts`), so upgrading Bun
  in place does not bring the router back by itself. `gateway setup` does: it clears the
  start limit (`systemctl --user reset-failed`) and starts the socket and the unit again,
  with the new Bun's path written into the unit.
- **The tests**: the preload (`src/testing/setup.ts`) stops `bun test` on an older Bun
  with one line. The `package.json` scripts call `"$npm_execpath"` (the Bun running
  `bun run`), never `bun` from PATH, and tests start subprocesses with
  `process.execPath`: `<path>/bun run check` runs every step on that one Bun.

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
  login), and a target must pass a test check before it is set; the router uses only a
  target whose test proof is in the config. Otherwise Claude Code asks the person.
- Opus and Fable stay byte for byte on Anthropic. An opt-in model slot answers from a
  fallback only at the plan's usage limit, its answers without thinking blocks (Opus
  refuses one it cannot verify; the owner's yes for this case); the router writes what it
  saw to a small state file that the status line and the StopFailure alert read. The
  alert's worker runs through the launcher, never from the plugin's version folder.
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

## Web search

`anymodel search` (`src/search/`) searches the web, or reads one page's text, through the
same local OmniRoute the gateway uses — same config file, same `omniroute` backend, same
key (`docs/search.md`):

- The command reads the key through the gateway's own config reader, never a copy of it,
  and never prints it: an OmniRoute error answer, or a failed request's reason, is
  masked with the router's own `maskSecrets` before it reaches the terminal. To an
  OmniRoute on this machine the key never goes through a proxy (`directIfLoopback`, the
  rule the gateway's own backend calls use; it needs Bun ≥ 1.4.3, § The Bun it needs).
- Web text is data, not terminal input: every field is printed through
  `src/gateway/plain-text.ts`, the one home (shared with the router's log) that turns
  each control character into a space.
- The plain output is cut (about 2500 characters, 300 a snippet), because Ollama's web
  search puts a whole page in each result's snippet; `--json` prints the whole answer.
- The query, and a `--fetch` URL, go to a third party (the search or fetch provider), so
  `--fetch` refuses a local or private address.
- It is a command, not a service: no part of it runs in the background, and nothing
  changes on a machine until a person runs it.

## Heavy jobs

One queue for the whole machine (`src/jobs/`, design and limits in `jobs.md`):

- `anymodel job run --kind <kind> -- <command>` reserves the job's gigabytes, waits while
  they are not free, runs the job, and gives them back however it ends. Kinds and sizes
  are defaults a project can replace in its `anymodel.json` (`jobs.kinds`); a machine sets
  its limits in `~/.config/anymodel/jobs.json`. `--exclusive <name>` (with a kind, or
  alone) also keeps a name to one job at a time: a lease that holds the name.
- **The job runs in a process group of its own**, so a signal reaches its workers too,
  and its memory is given back only once the group (and its systemd scope) is empty.
- **Leases are files, judged like the lock.** Each reservation is a small file naming
  its writer's pid and start time. A file whose writer is gone (a dead or reused pid) is
  stale and the next reader removes it, through the same `holderIsGone` as setup's lock.
  So nothing needs cleaning after a crash, and no native code (`flock`) is needed. A
  writer in another pid namespace (a container on the same host) keeps its files alive
  with a heartbeat. A shared folder is for one host: one clock, no network file system.
- **Two kinds of budget,** this machine's and optional shared folders (containers or
  users on one host), taken in a fixed order and given back in reverse, so they never
  wait on each other in a circle. Oldest first, fair share on shared folders, a live check
  against real free memory (cgroup-aware), and no give-up timeout.
- **The launch** puts a job in its own systemd memory group with a kill mark where Linux
  allows it, so that if memory still runs out, a heavy job dies first.
- **The state is per user** (`~/.local/share/anymodel/jobs/`): nothing in it outlives
  its writers, and no service runs.
- A pure classifier (`classifyHeavyCommand`) says which kind a Bash command runs; a later
  hook routes heavy commands through `job run`.

## How `setup` changes user files

`setup` owns **managed** parts of user files, and only those:

- in a JSON settings file, single keys (listed in its state, `owned.json`, each with the
  value anymodel wrote there, or only its SHA-256 for a secret);
- in a JSON list of strings, single entries, each with the source that wants it (listed
  in `owned-entries.json`): the auto-mode block;
- in a Markdown file, one block between `<!-- anymodel:begin -->` and
  `<!-- anymodel:end -->`;
- whole files it creates itself (the launcher, the copy of the instructions).

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
  writes the launcher, so such a key (for example `autoUpdate: false`) stops it before
  anything is written.
- **A key the person changed is theirs.** An owned key remembers the value anymodel
  wrote. When it holds another value now (and not the program's own default), the
  person chose it: setup does not overwrite it (it stops, as for any key not its own),
  and restore leaves it and gives up the ownership. A record from an older `owned.json`
  has no value: it stays owned as before, and gets its value at the next setup. A
  write that sets a secret leaves the file at mode 600.
- **`--dry-run`** shows every change and writes nothing at all: no state folder, no
  lock. Every setup runs this read-only pass first, outside the lock.
- **`restore`** removes what anymodel added and keeps everything else: its own JSON
  keys and its Markdown block go; a whole file goes back to its **baseline** (the backup
  made at anymodel's first change to it since the last restore), or is removed when
  setup created it. It backs up each file before it changes it. With the gateway on, the
  router's copy and unit wait for a second restore (§ The AI gateway). A restore with
  nothing left changes nothing.

Its state (`<stateDir>`) lives in `$CLAUDE_CONFIG_DIR/anymodel/` (by default
`~/.claude/anymodel/`): `owned.json`, `owned-entries.json`, `changed.json`, the lock and `backups/`. The
state is per config folder, but the launcher in `~/.local/bin` is shared by all of
them. So a restore under one config folder can remove a launcher another one relies
on. A launcher started without `CLAUDE_CONFIG_DIR` looks in `~/.claude`.

### Who changes what, and when

- **A SessionStart hook** adds a note to the session (§ The hooks) or starts the background
  self-update (§ Updates). It writes no user file, and never restarts or stops anything.
  (Refreshing managed files from it is not built yet; when it is, it goes through
  `src/setup/` under its lock, and `anymodel setup` does that by hand today.)
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

The hooks use `worktrees`, `protectedBranches` and `sessionNames` (§ The hooks). The plugin
accepts `instructions` and `autoMode` now: `setup` uses `autoMode` (§ Auto mode reads only
user settings), and the opt-in instructions load through the project's own import line
(§ Instructions, skills and agents), so `instructions` does not load them yet.

- A hook finds the project from its input's `cwd`, which follows the session into a
  worktree. A worktree's own `anymodel.json` wins; else the main checkout's is used. A moved
  or deleted main checkout, and git older than 2.31, each give a clear error.
- **`requires` is checked before the strict parse.** A project may use a field newer
  than a user's plugin; that user is told to update, not that the field is unknown.
- **Without `anymodel.json`, the plugin does Claude Code's default** and its guards stay
  silent. A project that never opted in does not notice the plugin.
- **The worktree engine needs more than the file:** the project also wires its three hooks
  in its own `.claude/settings.json` (§ The hooks › The worktree engine).

### How a project adds its own part to a general skill

A general skill reads the project's own additions when they exist. For example,
`/anymodel:review` also follows the project's `.claude/anymodel/review.md`, and where they disagree,
the project's text wins. The plugin stays general; each project keeps its own rules in
its own repo.

## Instructions, skills and agents

The plugin carries general working instructions for Claude, 16 skills and 4 agents, all
written for any project (`README.md` § Instructions, skills and agents lists them).

**The always-on instructions reach Claude through the user's `CLAUDE.md`.** A plugin cannot
add text to every session by itself, but Claude Code loads `<config dir>/CLAUDE.md` in every
session, and an `@path` line there imports another file. So `setup`:

1. copies `plugin/instructions/**.md` to `<stateDir>/instructions/` — each file a whole file
   anymodel owns, so `restore` removes it; a file a newer plugin no longer ships is taken
   out of the copy (`src/setup/instructions.ts`);
2. then writes one managed block into `<config dir>/CLAUDE.md` that imports `core.md`.

Why a copy: the plugin's own folder has the version in its name and goes away after an
update, so an import cannot point into it. The block names the copy as `~/…` when the config
folder is under `HOME` (so a `CLAUDE.md` shared between machines through a dotfiles repo
stays right on each), else by its absolute path. `--no-instructions` takes the block out
first, then the copy, so nothing ever imports a missing file; a `CLAUDE.md` that setup
created and that holds nothing else is removed.

**Two state files sit beside the copy** (`src/setup/instructions.ts`), in the state folder:

- `no-instructions`: the person's `--no-instructions`. While it is there, a plain `setup`
  keeps the instructions out; `--instructions` removes it; `restore` removes it too (a setup
  after a restore starts fresh). Why stored: a choice that a plain `setup` (run after every
  update) quietly undid would be no choice.
- `instructions-version`: the plugin version that last wrote the copy.
  `instructionsNeedRefresh(paths, version)` is true for an installed copy, not opted out,
  whose stamp names another version. `doctor` uses it (and compares each file with the
  plugin's). `refreshInstructionsCopy(paths, version)` brings only the copy up to that
  version: no block, no other step, no question, nothing when opted out or never installed.
  It is meant for the **new** version's first run after an update: the update itself runs
  the old version's code, which does not know the new files. Until something calls it, a
  plugin update reaches the copy at the next `setup` run.

**A project's import of an opt-in file loads nothing where the copy is missing** (a teammate
without anymodel, or after `--no-instructions`), and Claude Code says nothing. `doctor` reads
the memory files Claude Code would load (`CLAUDE.md`, `.claude/CLAUDE.md`, `CLAUDE.local.md`
in the current folder and every folder above) and names an anymodel import whose file is
missing.

That an import in the user's `CLAUDE.md` reaches the main session and a subagent was proved
live (`claude-code-contract.md` § Instructions). The built-in `Explore` and `Plan` agents load
no `CLAUDE.md`, so a brief to them restates what they must respect.

**Opt-in instructions** (`optin/`) are copied too, but only a project's own import line loads
them: they are for projects that work the way they describe (one session per worktree).

**One home per rule.** Each rule lives in one place: the always-on instructions state it; one
skill holds its procedure and points back; an agent's file holds only that agent's job. The
precedence is stated once, at the top of `core.md`: where the project's own `CLAUDE.md`,
rules or `.claude/anymodel/<skill>.md` differ, the project's text wins.
`bun run check:duplicates` (`scripts/check-duplicates.ts`, in `bun run check` and CI) fails
when the same sentence of 12 or more words appears in two files of the plugin's
instructions, skills, agents or output styles. A deliberate repeat goes in
`scripts/check-duplicates.allow.json` with its reason. It cannot see the same rule said in
other words; that stays a review job.

**Agents pin no model and no effort.** The caller passes both on each launch, so an agent
never runs on a model nobody chose. Plugin agents and skills are named `anymodel:<name>`.
An agent that works by a skill loads it with `skills:` in its frontmatter (`reviewer`:
`anymodel:review`; `rules-maintainer`: `anymodel:self-evolve`): the skill's text is in its
context from the start, and it needs no path to the plugin's version folder (proved live:
`claude-code-contract.md` § Instructions).
Agents that need an MCP server name its tools as `mcp__serena__*` or `mcp__playwright__*`:
the servers are registered for the user (§ MCP servers at user scope), so the names stay.

**The output style** ships but is never switched on: a person picks it with `/output-style`.
## The hooks

The hooks live in `src/hooks/`. There are two kinds, by who wires them (`wiring` in each
spec, `specs.ts`):

- **The plugin's hooks** (`HOOKS`): each one a bundle (`src/entries/<name>.ts` →
  `plugin/dist/<name>.js`), wired in exec form in `plugin/hooks/hooks.json`, so they run in
  every project. They run through `plugin/bin/anymodel-bun`, a small `sh` script that finds
  bun without PATH (Claude Code's hooks get the PATH it was started with, which may lack
  bun): the bun `anymodel setup` baked into the launcher, then `$BUN_INSTALL/bin/bun`,
  `~/.bun/bin/bun`, and PATH. With none it answers by its `--missing=` mode and exits 0: a
  PreToolUse guard passes `--missing=ask`, so it asks the person instead of letting the tool
  run (a guard fails closed); every other hook passes `--missing=quiet`, one line on stderr.
  The baked line is
  single-quoted the way `shellQuote` writes it (each `'` as `'\''`), and the shim undoes
  exactly that, so a bun under a folder like `/home/o'brien` is found.
- **The worktree engine** (`PROJECT_HOOKS`): WorktreeCreate, WorktreeRemove and
  SubagentStop, which a project wires itself as `anymodel hook <name>` (§ The worktree
  engine). The launcher already runs its baked bun.

The contract they follow: `.claude/rules/hooks.md`. The Claude Code behaviour they rely on,
each row proved: `claude-code-contract.md` § Hooks and § Worktrees.

### One frame for every hook

Every hook, of both kinds, runs in the same frame (`src/hooks/run.ts`), in this order:

1. **Read the input.** Not JSON, another event, or a `cwd` outside git: nothing to do.
2. **The project's own copy, for a plugin hook only.** When the project's `anymodel.json`
   lists the hook in `ownHooks` (`["git-guard"]`), the plugin's hook exits 0 and prints
   nothing, so the project's copy runs alone (§ The safe switch). Only that field is read
   (`ownHooksOf`), on its own, so it works even when the rest of the `anymodel.json` is
   broken or needs a newer plugin. It is explicit on purpose: a project hook on the same
   event is not enough to silence a plugin hook, because it may be a logger, a different
   check, or a copy that does not cover the same commands — and a guard that went quiet for
   that would leave the person unguarded (owner, 2026-10-16). `anymodel doctor`, run in a
   project, prints one `·` line per listed hook, and warns (`!`) when a listed hook has no
   project hook left to answer, or when a project hook runs next to a plugin hook the list
   does not name. A hook the project wires itself skips this step: that wiring is its
   opt-in.
3. **Read `anymodel.json`.** When it is broken, needs a newer plugin, or lacks what the hook
   `needs` (the engine needs `worktrees`), the hook **fails closed**, each in the way that
   suits its event: a guard asks the person (it cannot know whether the project turned it
   on), WorktreeCreate fails with the reason, WorktreeRemove keeps the worktree, an
   informational hook says one line. "Closed" never means silent: a person must hear why.
4. **Run.** Any error is one line on stderr and exit 0 (a hook's bug never stops work),
   except WorktreeCreate and WorktreeRemove, which exit 1: they cannot succeed without
   their folder.

The frame is general on purpose: later hooks (notifications, the routing of heavy jobs)
are new specs in it, plugin-wired or project-wired.

### The worktree engine

A WorktreeCreate hook **replaces** Claude Code's own creation, for sessions and subagents,
in every project where it is wired, and a hook that prints no folder makes the creation fail
(proved live). So a plugin WorktreeCreate cannot step aside for a project that never opted
in: it would have to rebuild Claude Code's own worktrees there, and it cannot rebuild them
whole. A hook-made worktree loses the lock Claude Code puts on a worktree while a session
uses it, the marker its periodic sweep looks for, the reset of a reused clean worktree,
`--worktree "#123"` (a pull request) and the neutralised filter drivers (Git LFS). **So the
engine is opt-in per project** (owner, 2026-10-15): the plugin wires no WorktreeCreate,
WorktreeRemove or SubagentStop, and a project that wants the engine:

1. gives its `anymodel.json` a `worktrees` field, and
2. wires the three hooks in its own `.claude/settings.json`, as the README's § Worktrees
   shows (its one home; `anymodel hook` prints the same lines, from
   `src/hooks/project-wiring.ts`, and a test keeps the two the same).

Each line is a shell string, `"$HOME/.local/bin/anymodel" hook <name>`: the shell fills in
`$HOME`, so the launcher is found by its full path whatever PATH Claude Code was started
with, and the launcher runs the bun setup baked into it. The bare name `anymodel` would need
`~/.local/bin` on that PATH, which an IDE or a desktop launcher may not give. Without the
launcher (setup never ran), Claude Code's creation fails and shows the shell's "not found"
(proved live). Wired without `worktrees`, the engine fails closed and names the fix.

Then, in that project:

- **A session's worktree:** `<parent of the main checkout>/<prefix><name>` (a `/` becomes
  `-`) on the branch `<name>`. One creation of a branch runs at a time: a lock file in the
  common git dir (`create-lock.ts`, O_EXCL, holding pid, process start time and session id)
  is held through `git worktree add` and the setup, so a second session asking for the same
  branch mid-create gets one clear refusal instead of two creates fighting over the folder
  and the branch; a lock whose process is gone is taken over. An existing worktree of that
  branch is entered again, unless another running session works in it. Otherwise an existing
  branch is checked out, or a new one is cut (not tracking the base) from `origin/<base>`
  right after `git fetch origin <base>`; a failed fetch refuses, because a new branch starts
  only from the latest base — so **a repo with no `origin` cannot create a new session
  branch** (`git worktree add` gets 500 s, the setup 540 s of the hook's 600 s). Then the project's `setup` runs inside (argv, at most 9 minutes, its
  output on stderr). A setup that fails leaves the worktree and exits 1; entering it again
  runs setup again (a marker in the worktree's git folder records a finished setup).
- **A subagent's worktree (`agent-<hex>`):** what Claude Code would make for it,
  `<main checkout>/.claude/worktrees/<name>` on the branch `worktree-<name>`. The base
  follows Claude Code's `worktree.baseRef` setting: `"fresh"` (the default) is the remote's
  default branch (`origin/HEAD`), fetched when the repo was not fetched for a day, at most
  5 s and never asking for a password; `"head"`, or no remote, is the asking checkout's
  HEAD. No setup: a subagent's worktree must be quick.
- **Both** copy the gitignored files `.worktreeinclude` names, which Claude Code no longer
  does once a hook makes the worktree.

**WorktreeRemove** removes a worktree only when nothing can be lost: not the main checkout,
not locked, no worktree inside it, nothing changed or untracked, and no ignored file git does
not keep (`local-files.ts`: `git status --porcelain --ignored`, minus what comes back by
itself — `node_modules`, build output, caches — and minus a `.worktreeinclude` copy the main
checkout still holds byte for byte). An ignored file that cannot come back (an edited
`.env.local`, a notes file, a key) keeps the worktree, exit 1, and the files are named: `git
worktree remove` deletes ignored files without a word. Then its branch, when every commit on
it is also on another branch or a remote. Uncommitted work: kept, exit 1, and Claude Code
says it was not removed. Its input carries no "discard" field (seen live), and Claude Code
cannot check a worktree outside the repo itself, so `ExitWorktree` needs
`discard_changes: true` there: this hook is then the last check, and it never discards.

**SubagentStop** does what Claude Code does without hooks: a subagent's worktree that
changed nothing (no edit, no commit of its own) goes, with its branch. Claude Code keeps
every worktree a hook made for a subagent and runs no WorktreeRemove for it (its docs; seen
live). It finds the worktree by the subagent shape above.

`anymodel doctor`, run in a project, checks the engine's wiring against `worktrees`: with
`worktrees`, all three hooks wired; wired without it, ✗; and ✗ for any other WorktreeCreate
hook in the project's or the user's settings (Claude Code runs both and makes two
worktrees).

### The plugin's hooks

| Hook | Event (matcher) | On when | What it does |
|---|---|---|---|
| `git-guard` | PreToolUse (Bash, PowerShell) | `anymodel.json` exists | Asks before a force-push (git's abbreviations included: `--forc`), a push to a protected branch (`protectedBranches`, default `main`), `push --all`/`--mirror`, a branch deleted on the remote (`git push origin :x`, `-d`/`--delete`), `reset --hard`, `clean -f`, `worktree remove -f`, a checkout or restore that discards changes, `branch -D`, `stash clear` and an unnamed `stash drop`, and (with `worktrees`) a bare `git stash` / `stash pop`. One shell lexer (`shell-command.ts`) reads each command of a line; quoted text, here-docs and comments are data, and shell keywords, wrappers (`timeout 60 git push -f`, `env -i sudo -u me …`, `xargs …`), the here-doc a shell reads as its script, and the text piped into one are read through. Known limits: a git alias, `branch -f`, `checkout -B`, `switch -C`, `ssh`, a script file. "Ask", never "deny": the person may mean it. |
| `main-folder-guard` | PreToolUse (Edit, Write, NotebookEdit) | `worktrees.guardMainFolder` | Denies an edit of a file in the main checkout itself, with the way into a worktree. |
| `message-guard` | PreToolUse (SendMessage) | `anymodel.json` exists | Denies a message to a session that works outside this repo (from Claude Code's session records). |
| `after-merge` | PostToolUse, PostToolUseFailure (Bash, PowerShell) | `worktrees` | After `gh pr merge`: the steps that clear the merged worktree, and the message to send the other sessions when it went into `worktrees.base`. |
| `worktree-leftovers` | SessionStart (startup, resume) | `worktrees` | Names the finished worktrees (every commit on `origin/<base>`, nothing uncommitted, no session in it, idle an hour, no ignored file that cannot come back) and the ones whose folder is gone. Removes nothing. |
| `session-name` | SessionStart, UserPromptSubmit | `sessionNames` | Tells the session to name itself after its task (`anymodel session-name`), then sets that as its title at the next prompt. |

Without `anymodel.json` every one of them is silent: a project that never opted in sees only
Claude Code's own worktrees.

**Left in the project that had them** (project values or project tools, not general): a ban
on one package manager, the local database wipe guard, the heavy-job guard, a pull request
into a release branch, the main checkout following the base branch after each merge
(installs and migrations), the notes about one project's dev notes, migrations and env
files, and the claude-mem start-folder note. **Waiting for Phase 4:** the Serena root
record (Serena's edits in the main-folder guard) and the Playwright output folder, both tied
to MCP servers the plugin registers in Phase 4. **Not ported:** the Windows helper that
removes a worktree after the session lets go of it (the plugin is macOS and Linux for now).

### `doctor --live`

`anymodel doctor --live` (opt-in; it uses the person's login and costs a few cents) makes two
throwaway repos in a temp folder, one without `anymodel.json` and one that turned the
worktree engine on exactly as the README says, and runs one `claude -p` session in each with
this plugin (`--plugin-dir`), only the EnterWorktree, ExitWorktree and Bash tools,
`--allowedTools` for exactly the calls it makes (never a mode that skips the permission
checks), and a three-step prompt: enter a worktree, `git status` there, leave with
"remove". The temp repo's project hooks run **the plugin being checked**
(`liveHookCommand`: this CLI's own `plugin/dist/cli.js`, with the bun running it), not the
installed launcher `~/.local/bin/anymodel`, which would prove whatever version is installed
instead. Every hook run is logged (`ANYMODEL_HOOK_LOG`, with each run's `cwd` and the spec's
`logFacts`), and it checks: without `anymodel.json`, the plugin's hooks fired (SessionStart,
the git guard), the git guard **read the command line** (its log names the programs it
parsed: a hook that fired is not a guard that answered), no WorktreeCreate hook ran, Claude
Code made its own worktree and the session worked in it, and ExitWorktree removed it; with
the engine, its WorktreeCreate made the configured folder, the session worked there, and its
WorktreeRemove removed the folder and the branch. When all pass it records the Claude Code
version in the state folder (`live-check.json`); plain `doctor` shows that line, and says
to run it again when the installed Claude Code is another version.

## The safe switch

A project may already have its own copy of a piece the plugin now ships (a guard, a note).
Moving it to the plugin must never run it twice or leave a gap:

The project names its own copies, and the plugin steps aside for exactly those:

1. **The project lists each plugin hook it still runs itself**: `ownHooks: ["git-guard"]`
   in its `anymodel.json`. The plugin's copy of that hook then stays silent there
   (§ The hooks › One frame for every hook). A plugin hook the list does not name still
   speaks, so a gap is never silent, and a project hook on the same event alone silences
   nothing.
2. Every machine gets the plugin, and `anymodel doctor` is green on each.
3. **Then the project removes its copy**, one at a time, and takes that name out of
   `ownHooks`; with the list empty it raises `requires` in its `anymodel.json`.
4. **A small fail-closed check in the project** covers a machine without the plugin: it
   stops risky work instead of going on unguarded.

Rollback is a new release with the old behaviour. A version number never goes down.

`anymodel doctor` follows the switch at both ends: a name in `ownHooks` whose event has no
project hook left to answer is a warning (the project is unguarded while it is listed), and
a project hook running next to a plugin hook that is not listed is a warning too (both may
answer the same command).

The worktree engine is not part of the switch, because the project wires it itself: a project
with its own worktree hooks moves by replacing those lines with the engine's, in one commit
(README § Worktrees). `anymodel doctor` reports a second WorktreeCreate left behind.

## MCP servers at user scope

`setup` registers MCP servers (later: the shared browser, Serena) at user scope. The
plugin does not serve them. A server served from a plugin gets a new tool-name prefix,
which would break every permission rule, hook matcher and agent tool list that names
`mcp__<server>__*`. Registered by `setup`, the names stay as they are.

## Auto mode reads only user settings

Claude Code's auto mode reads `autoMode` from the user's settings (and managed settings,
and `--settings`), never from a project's `.claude/settings.json`: a repo could otherwise
grant itself trust (proved live: `claude-code-contract.md`). So `setup`, run in a
project, copies that project's `autoMode` rules from its `anymodel.json` into
`autoMode.environment` in the user's `settings.json`. The project owns the wording; the
plugin only copies it.

- **Owned entries, not an owned list.** The list is shared with the person and other
  tools, so anymodel owns single entries (`src/setup/managed-entries.ts`), each recorded
  with its source: the project's main checkout, one source for all its worktrees. A
  setup in a project makes that project's owned entries exactly its `autoMode`: new ones
  are added at the end, dropped ones taken out. An entry two projects want stays until
  the last one drops it. An entry already in the list that anymodel did not add is left
  alone and never owned.
- **`"$defaults"` first.** A list without `"$defaults"` replaces Claude Code's built-in
  entries instead of adding to them (seen live). When setup creates the list, it puts
  `"$defaults"` first and owns it; it goes only with the list, when nothing but it is
  left. A restore with entries of the person's left keeps it, and no longer claims it.
- **Trust rules are asked, always of a person at a terminal.** A change is shown as `+` /
  `-` lines, then asked; `--yes` skips the question, not the lines, and only on a
  terminal. With no terminal the entries are left out, whatever the flags, and setup
  says so. A change of the same entries again is no change: nothing is shown or asked.
- **The question names the file.** In a worktree with its own `anymodel.json`, that file
  is where the entries come from; when it says something else than the main checkout's,
  the question says so plainly.
- **Only one part of setup.** A project setup cannot read (an invalid or too-new
  `anymodel.json`, git older than 2.31, a worktree whose main checkout is gone) leaves
  the entries out with a note; the launcher, auto-update and the companions still
  happen. Outside git, setup needs no git.
- **Every question first.** The auto-mode question and Warp's commands are asked before
  anything runs or is written. A "no" drops only what depends on it.

## Companion plugins

anymodel depends on claude-mem and frontend-design (`plugin.json` `dependencies`, with
`allowCrossMarketplaceDependenciesOn` in `marketplace.json`). A dependency is the
plugin system's own way to bring another plugin along: Claude Code installs it, keeps it
in its version range, and does not load anymodel without it. The plugin's code reads the
list from `plugin.json` at build time (`DEPENDENCIES`), and `src/machine/companions.ts`
knows where each marketplace comes from.

Claude Code installs a dependency only from a marketplace the person added, and installs
the missing ones when that marketplace is added (both seen live). So `setup` adds a
missing marketplace with `claude plugin marketplace add`, which brings the companion;
with the marketplace there and the plugin gone, it runs `claude plugin install`. It never
turns on a companion the person turned off, and never updates one: it says what to run.
These are Claude Code's own commands on its own files, so `restore` does not undo them.

## claude-mem on the gateway

claude-mem's summaries run on Claude Haiku, on the person's own login, by default.
With the gateway set up, `setup` points claude-mem's openai-compatible provider straight
at the backend of the gateway's cheap model (the scout slot's first backend target), with
Claude Haiku as claude-mem's quota fallback (`src/machine/claude-mem.ts`). The fallback
takes claude-mem's work while the cheap model is in a quota or rate-limit cooldown, and
hands it back once the cheap model answers again; it is not a fallback for a backend
that is down or refuses its key (claude-mem never routes around an authentication
failure: its CHANGELOG, 13.29.0).

- Seven keys in claude-mem's settings, owned through `applyManagedJson`. claude-mem's
  seeded defaults count as unchosen; any other value of the seven is the person's
  choice (also one anymodel wrote and the person changed since, and a key pool of their
  own in `CLAUDE_MEM_OPENAI_COMPAT_API_KEYS`), and then none of them change.
- **Straight to the backend, not through the router.** claude-mem speaks OpenAI's format
  and the router speaks Anthropic's, and claude-mem's own fallback already goes back to
  Claude. The key is the backend's key from `gateway.json`.
- **Checked before the write, the way claude-mem calls it:** claude-mem's custom preset
  adds `/chat/completions` to its base URL (its worker, 13.35.0), so setup sends one
  `POST <backend>/v1/chat/completions` for the model with the key and `max_tokens: 1`;
  it must answer, or nothing is written. `--dry-run` sends nothing.
- **An old nested file** (only `env` at the top, holding claude-mem's keys) is left
  alone: claude-mem itself rewrites such a file flat on its next start, and drops any
  flat key written beside `env` then (its `loadFromFile`), so a key written either way
  now would be lost or no longer owned.
- **No cheap target any more** while the keys are still anymodel's: setup says that
  claude-mem still points at the old backend, and how to fix it.
- **No chroma workaround.** An older pin of claude-mem's vector search (`pydantic<2.12`
  through a wrapped `uvx`) is not needed: claude-mem 13.35.0 ships its own pin
  (`pydantic<2.14`, its CHANGELOG, #4595). `doctor` warns (`!`, never a failure) below
  13.35.0.

## Warp

The Warp terminal is opt-in (`setup --warp`): plain `setup` never installs a system app,
and never Warp's plugin either. `src/machine/warp.ts` asks the system's own package
manager (apt, dnf, Homebrew) whether Warp is there, builds the exact install or remove
commands, and `setup` shows them and asks. They need root, so:

- they run only on a terminal, after the person said yes; `sudo` asks for the password
  itself, and anymodel never sees, stores or pipes it. With no terminal, or a "no", the
  Warp part is left out (its plugin too) and the rest of setup goes on; setup exits 1;
- the key and the source file are made by anymodel in its own state folder, then put in
  place by `sudo install` (apt) or imported from there with `rpm --import` (dnf). No
  downloaded script ever runs;
- **the key is pinned.** It is downloaded over HTTPS, every redirect checked, and must
  hold exactly one key with the fingerprint `0913165C78D5B7A41B42AC657FF7AB39D60F803F`
  (`gpg --show-keys`, with a fresh gpg home in the state folder). That fingerprint came
  from the key at Warp's documented address, and the same key is built into Warp's own
  package (below). Another key stops the Warp part before any command runs;
- `--remove-warp` on dnf removes only the `gpg-pubkey` whose id (version) is the end of
  that fingerprint, never a key picked by its name;
- a command that fails half way lists what ran before it and names
  `anymodel setup --remove-warp` to undo it.

**What Warp's .deb writes** (read from the control member of `warp-terminal`
0.2026.10.07.08.29.stable.00, the amd64 package and the arm64 one, fetched from Warp's apt
repository and unpacked, never installed). Its postinst:

- writes Warp's key, built into the script, to `<apt trustedparts>/warpdotdev.gpg`
  (`/etc/apt/trusted.gpg.d/warpdotdev.gpg` with apt's defaults) on every install and
  upgrade;
- writes the source `<apt sourceparts>/warpdotdev.sources` (deb822, with a two-line
  "automatically configured" header, `Architectures:` — `amd64` in the amd64 package,
  `arm64` in the arm64 one: each package writes the architecture it is for — and
  `Signed-By: /etc/apt/trusted.gpg.d/warpdotdev.gpg`), but only when neither that file
  nor `warpdotdev.list` exists;
- its postrm, on purge, removes the key and both source files.

So anymodel writes the same key path, and the source with the same path and the very
same text — this machine's architecture in the `Architectures:` line — before the first
install; the package then finds its source there and leaves it. apt never sees two Warp
sources or two Signed-By values. A source already there (the package's, or a `.list`
from Warp's manual guide) is kept as it is.

Warp's apt repository has `amd64` and `arm64` packages (its `Packages` files, read
2026-10-16), and its rpm repository `x86_64` and `aarch64` builds (its repodata, read
2026-10-15), so a Debian-family or Fedora-family machine is installed for on either
x86_64 or arm64; other architectures get the download link.

Warp's Claude plugin is not a dependency (a machine may have no Warp). Only `--warp`
adds it; `doctor` names `anymodel setup --warp` when the app is there without it.
`--remove-warp` removes it with the app.

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
