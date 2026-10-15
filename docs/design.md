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
- Auto mode's safety check stays on Claude unless the person turns on the opt-in judge
  slot.
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

- **A SessionStart hook** only refreshes managed files, under the lock, or adds a note to
  the session (§ The hooks).
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

The hooks use `worktrees`, `protectedBranches` and `sessionNames` (§ The hooks); the
plugin accepts `instructions` and `autoMode` now and uses them from Phase 5 and 6
(`roadmap.md`).

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

## The hooks

The hooks live in `src/hooks/`. There are two kinds, by who wires them (`wiring` in each
spec, `specs.ts`):

- **The plugin's hooks** (`HOOKS`): each one a bundle (`src/entries/<name>.ts` →
  `plugin/dist/<name>.js`), wired in exec form in `plugin/hooks/hooks.json`, so they run in
  every project. They run through `plugin/bin/anymodel-bun`, a small `sh` script that finds
  bun without PATH (Claude Code's hooks get the PATH it was started with, which may lack
  bun): the bun `anymodel setup` baked into the launcher, then `$BUN_INSTALL/bin/bun`,
  `~/.bun/bin/bun`, and PATH; with none, one line on stderr and exit 1. The baked line is
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
