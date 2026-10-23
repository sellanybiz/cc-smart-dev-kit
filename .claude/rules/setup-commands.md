---
paths:
  - "src/cli/setup*"
  - "src/cli/project-init*"
  - "src/machine/**"
  - "src/mcp/**"
  - "src/update/apply.ts"
  - "src/setup/auto-mode.ts"
  - "src/setup/warp.ts"
---

# What Setup May Do, And When

`setup` is the one command that shows a change before it makes it, and asks about anything
that is not mechanical. This is when it may run something that restarts a program, needs
root, or writes a trust rule. How it writes: `setup-and-managed-files.md`. How it prints:
`command-output.md`. How the parts fit: `docs/design/setup.md` § How `setup` changes user files.

- Restarts and permission changes happen only in a manual run (`cc-smart-dev-kit setup`,
  `gateway setup`, `restore`) that shows the change first. A restart or stop of a running
  service says what it cuts, and asks: `confirm()` on a terminal; with no terminal, it
  stops and changes nothing unless `--yes` was given. The SessionStart hook only starts
  the background self-update (`session-start.md`), which installs a new plugin version with
  `claude plugin` commands and restarts nothing. Its one write to a user file is the
  managed `autoUpdate` key, `true` → `false`, only while that `true` is still setup's own
  (`src/setup/auto-update.ts`, D39).
- **A running program is never changed behind the person's back**: the tmux line
  (`src/setup/tmux.ts`) goes into `~/.tmux.conf` only when `tmux` is on PATH, and setup
  **prints** `tmux set -g allow-passthrough all` for a running server instead of running
  it — a running server keeps its own value until they apply it (or restart tmux).
- Setup refuses to start before `claude plugin marketplace add` has run, and says which
  command to run.
- **Commands that need root** (installing or removing the Warp app) run only in a manual
  `setup --warp` / `--remove-warp`, after the exact list was shown and the person said yes
  on a terminal. `--yes` never skips that question. With no terminal, or a "no", those
  commands (and Warp's plugin and shortcuts, which go with them) are left out, the rest
  of setup is done, and setup exits 1. `sudo` asks for the password itself:
  cc-smart-dev-kit never sees, stores or pipes one, and never runs a downloaded script (no
  `curl | sh`). Files root needs are made in `<stateDir>/warp/` and put in place with
  `sudo install` (or `rpm --import` from there); that folder is removed after the run.
  Warp's signing key is downloaded over HTTPS only (each redirect too) and must hold
  exactly one key, with the pinned fingerprint (`WARP_KEY_FINGERPRINT`).
- **Trust rules always need a person at a terminal.** The auto-mode entries are shown as
  `+` / `-` lines, then asked; `--yes` skips the question only on a terminal. With no
  terminal they are left out whatever the flags, and setup says so. A project setup
  cannot read (invalid or too-new `cc-smart-dev-kit.json`, old git, a missing main checkout)
  leaves only these entries out, with a `!` note.
- **An offered setting is asked once, and the default is no** (the status line, the retry
  watchdog: `src/setup/retry-watchdog.ts`). Only on a terminal; a "no" is a file in the state
  folder (`statusline-declined`, `retry-watchdog-declined`) that stops the question; a flag turns
  it on without asking (and `--no-retry-watchdog` turns it off and remembers the "no"); with no
  terminal nothing is asked or changed, and `--dry-run` says so. Its keys are owned keys.
- **Every question comes first.** All questions are asked before anything runs or is
  written. A "no" to one drops only what depends on it.
- **`claude plugin …` steps run only when a person runs `cc-smart-dev-kit setup`**; nothing in
  the background (hooks, the self-update) ever runs setup. They run only for what is
  missing (a companion's marketplace or plugin; Warp's plugin, only with `--warp`). It
  never turns on a plugin the person turned off; it says what to run. Without `claude` on
  PATH, these steps are skipped and named, the rest is done, and setup exits 1.
- **The system is reached through `Machine`** (`src/machine/machine.ts`): commands, the
  terminal question, the platform, `/etc/os-release`, the Warp app's path, file checks
  and downloads. A test in the same process hands in a fake one, with fake commands on a
  PATH of its own; a test that runs the CLI as its own process gives the host's facts in
  `CC_SMART_DEV_KIT_TEST_HOST` and a PATH of fakes, so it never reads the machine it runs on.
