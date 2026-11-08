---
paths:
  - "src/cli/setup*"
  - "src/cli/project-init*"
  - "src/machine/**"
  - "src/mcp/**"
  - "src/update/apply.ts"
  - "src/setup/auto-mode.ts"
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
- **A running program is never changed behind the person's back.** Retiring an owned
  tmux line must leave the running server unchanged.
- Setup refuses to start before `claude plugin marketplace add` has run, and says which
  command to run.
- Downloaded installer scripts are forbidden except for the official Herdr GUI installer
  below. Never see, store or pipe a sudo password.
- **Herdr GUI is the only downloaded-installer exception.** Manual setup offers its latest
  GUI by default, showing the official installer and its normal core bootstrap before any
  changes. Ask on a terminal; without a terminal require `--yes`. Dry-run downloads and runs
  nothing. Use only `https://releases.herdr.dev/app/install.sh` or its `install.ps1` sibling;
  clear inherited app/core installer controls, including alternate release origins, version
  pins, install-directory overrides and bundle-only mode, in that subprocess only. Preserve
  ordinary user-directory and platform environment. The upstream installer checks release
  artifact hashes, not the downloaded installer scripts. Leave an existing GUI alone. Never install the TUI, use root or a package
  manager fallback, launch the GUI, or change its preferences, telemetry, themes or agents.
  Upstream owns its app, core, shortcuts and PATH changes; kit restore leaves them alone.
  This exception does not authorize other downloaded scripts or background installation.
- **Trust rules always need a person at a terminal.** The auto-mode entries are shown as
  `+` / `-` lines, then asked; `--yes` skips the question only on a terminal. With no
  terminal they are left out whatever the flags, and setup says so. A project setup
  cannot read (invalid or too-new `cc-smart-dev-kit.json`, old git, a missing main checkout)
  leaves only these entries out, with a `!` note.
- **An offered setting is asked once, and the default is no** (the status line). Only on a
  terminal; a "no" is a file in the state folder (`statusline-declined`) that stops the question;
  a flag turns it on without asking; with no terminal nothing is asked or changed, and
  `--dry-run` says so. Its keys are owned keys.
- **The retry watchdog is on by default** (D56, `src/setup/retry-watchdog.ts`): setup writes its
  three owned keys without a question, with or without a terminal and with `--yes`, unless a "no"
  is on file (`retry-watchdog-declined`) or a key of the person's own is in the settings;
  `--no-retry-watchdog` takes ours out and remembers the "no". One of the three is a 24-hour cap
  (`…_MAX_USAGE_LIMIT_WAIT_MS`): a usage limit that resets further away ends the wait, so a
  `claude -p` script returns instead of waiting for days.
- **Every question comes first.** All questions are asked before anything runs or is
  written. A "no" to one drops only what depends on it.
- **`claude plugin …` steps run only when a person runs `cc-smart-dev-kit setup`**; nothing in
  the background (hooks, the self-update) ever runs setup. They run only for what is
  missing (a companion's marketplace or plugin). It
  never turns on a plugin the person turned off; it says what to run. Without `claude` on
  PATH, these steps are skipped and named, the rest is done, and setup exits 1.
- **The system is reached through `Machine`** (`src/machine/machine.ts`): commands, the
  terminal question, the platform, `/etc/os-release`, file checks
  and downloads. A test in the same process hands in a fake one, with fake commands on a
  PATH of its own; a test that runs the CLI as its own process gives the host's facts in
  `CC_SMART_DEV_KIT_TEST_HOST` and a PATH of fakes, so it never reads the machine it runs on.
