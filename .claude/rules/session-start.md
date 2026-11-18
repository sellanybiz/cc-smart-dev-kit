---
paths:
  - "src/update/**"
  - "src/portal/session-start.ts"
  - "src/portal/lifecycle.ts"
  - "src/setup/instructions.ts"
  - "src/setup/auto-update.ts"
  - "src/hooks/worktree-leftovers*"
  - "src/hooks/session-name*"
  - "src/hooks/fable-session*"
  - "src/entries/update-check.ts"
---

# A Session Start

A session start is the one moment the plugin acts with nobody watching and no question to
ask. This is what it may and may not do: the SessionStart hooks, the portal's start, and the
background self-update. The frame every hook runs in: `hooks.md`. How the parts fit:
`docs/design/updates.md` § Updates and `docs/design/portal.md` § How it starts (D10).

## Session start never changes anything that matters

A SessionStart hook adds context, or refreshes managed files through `src/setup/` under its
lock. It never restarts a service, never changes a permission, and never asks a question.
Those happen only in a manual `cc-smart-dev-kit setup` run that shows the change first. A start
must stay quick: no fetch.

**The one exception is the portal (D10, the owner's):** the SessionStart part starts the
portal when it does not answer, and restarts it onto a newer version when an older one does
(`src/portal/session-start.ts`). It is not a service that changes sessions: it is a page on
this machine, it starts nothing when another program holds its port, it never asks, and it
never waits — the hook starts a detached starter and returns (`src/portal/lifecycle.ts`). It
never runs in `claude -p`, never on a `clear` or a `compact`, and its lines go to
`<stateDir>/portal.log`, never to the session.

SessionStart runs the worktree-leftovers and session-name notes, the Fable-session note,
the task note, the portal starter and the background update. The leftovers note reads the
main checkout without fetching. In a guarded main checkout it names the person's command,
not a step for the session, and adds, as the last of the main-checkout lines, one that this session is in the main checkout
and its first change goes into a worktree (`mainCheckoutNudge`: no git call, none in
`claude -p`). The update hook refreshes an outdated managed instructions copy and an outdated
git hooks folder (`refreshGitHooksFolder`, only one setup wrote, only from the installed
version's session) under the state lock; it never creates the folder, changes the user's
`CLAUDE.md` block or asks a question. A refresh failure is one stderr line.

## The background self-update

The self-update hook (`src/entries/update-check.ts`) is machine-wide, not a project's
piece, so it has no `cc-smart-dev-kit.json` and no `ownHooks` step. Its rules:

- **Return at once.** No network and no lock in the hook: it starts the check in a
  detached process (`detached: true`, stdio all `"ignore"`, so no pipe keeps Claude Code
  waiting) and returns. The test with a slow fake `claude` fails when it waits.
- **At most one check an hour**, decided again under the update lock in the background,
  so sessions that start together check once. Nothing while `update-hold` exists.
- **Claude Code's switches for updates win.** `DISABLE_AUTOUPDATER`, `DISABLE_UPDATES`
  or `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC` set (environment or the settings' `env`)
  without `FORCE_AUTOUPDATE_PLUGINS`: the hook only records "skipped: <name> is set",
  and the background check asks again under its lock. One list: `src/update/opt-out.ts`.
- **Silent on success.** It prints only one `systemMessage`, once, after a failed
  background update, and only to an attended session (`CLAUDE_CODE_SESSION_ATTENDED` is
  `0` for `claude -p`, whose hook input looks the same; `docs/claude-code-contract.md`).
  A marketplace that cannot be read is a failure only after 24 h in a row. The one other
  line: while a major version is held (D33, `src/update/major.ts`), one line at each session
  start (the input's `source` is `startup` or `resume`), never on a `clear` or a `compact`.
- **A major version is never installed in the background** (D33): the check holds it in
  `update-major.json` until the person's `cc-smart-dev-kit update`. An installed version
  that cannot be read (no `version` in `installed_plugins.json`, or not a version) is no
  major step: the check installs the newer one, as before the rule (`src/update/major.ts`).
- **Claude Code's own plugin auto-update stays off** (D39): it knows nothing of the hold.
  Each check first turns setup's own leftover `autoUpdate: true` to `false`
  (`turnOffLeftoverAutoUpdate`, `src/setup/auto-update.ts`): through `applyManagedJson`,
  under the state lock with no wait, and only while the key still holds setup's `true`. A
  value the person set, a busy lock or a broken settings file goes to `update.log` only;
  the check goes on.
- **Only Claude Code's own commands install:** `claude plugin marketplace update`, then
  `claude plugin update … --scope user`. Never `-y` (a marketplace-declared command needs
  a person), never a restart of the router or a session. They and the detached process
  run in the home folder with `gitEnv` (`commandContext`), and their output reaches a
  record only through `redactUrlsIn`.
- **A companion too old for the new version stops the update** (2.2.0, `applyUpdate`):
  after the marketplace refresh, each installed companion is checked against the
  `dependencies` of the refreshed copy's `plugin.json` (the running version's own list
  when that cannot be read), with doctor's range check (`src/machine/companions.ts`). A
  miss is a failed update with one line and its command (`claude plugin update <id>`),
  never a `plugin update` that Claude Code would refuse.
- **The same entry starts the portal (D10).** `startPortalAtSessionStart` resolves the
  *installed* version's `dist/portal.js` (never this hook's own folder: an old session's hook
  after an update must not start an older portal), starts it detached with `--ensure`, and
  returns at once — nothing on stdout, nothing waited for. It does nothing in `claude -p`, on
  a `clear` or a `compact`, or when the install has no portal bundle (`doctor` says so). A
  failure is the starter's own line in `<stateDir>/portal.log`; the hook never fails on it.
