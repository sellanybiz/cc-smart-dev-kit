---
paths:
  - "install.sh"
  - "install.ps1"
  - "scripts/install*"
  - "scripts/install*/**"
---

# The Installer: One Command, And It Ships On Merge

`install.sh` (macOS, Linux, Git Bash) and `install.ps1` (native Windows) are how a person
installs or moves the plugin: the marketplaces, the plugin, `migrate`, `setup`, then
`doctor` and the list of what is left. The steps, the words and the exit codes a person
sees: `README.md` § Install.

## People run it from `main`, so the merge is the release

The installer is fetched from `main` and run: the raw URL, or `gh api` for this private
repository (`README.md` § Install). No version bump reaches it, and CI's bump check watches
`plugin/` only (`scripts/check-version-bump.ts`). A change here is live on every machine
that runs the installer next, with no release step in between: the pull request is the
release.

## Keep the contract

- **The exit codes are a contract** (`README.md` § Install is its one home: 0 done, 3
  installed with items left, 1 a step failed, 2 refused). Every path out of the installer
  ends in one of them, and says the line that finishes or retries the step.
- **The two files carry the same steps, the same words and the same exit codes.** A change
  in one is a change in the other.
- **A secret is read and cleaned the way the plugin reads one**: each key goes to the
  plugin's own command on stdin, never a file of ours and never a command line
  (`README.md` § Install), and the installers' paste cleaners (`clean_secret`,
  `Clear-Secret`) stay in step with the plugin's (`src/cli/secret-line.ts`,
  `.claude/rules/browser.md`).
- **A machine fact is asked of the plugin, never read a second time**: `gateway check`,
  `mcp status --json`, `doctor` and `setup`
  (`setup-and-managed-files.md` § State, lock and paths). A new question the installer
  needs is a command or a flag, not a second reader of a file.

## Run the tests

- `bun test scripts/install.test.ts` runs `install.sh` as its own process in a temp HOME,
  with fakes for `claude`, `bun`, `gh`, `git`, `curl` and `uname` and a scripted terminal
  (`CC_SMART_DEV_KIT_INSTALL_TTY`). Add a case for every new path.
- **A change to `install.ps1` runs `scripts/install-windows-smoke.ps1`** — the same cases
  on a real Windows machine — and waits for the Windows CI job green before the merge:
  `.github/workflows/windows.yml` runs it under `pwsh` and under Windows PowerShell 5.1,
  and both must pass. A change under `scripts/install-windows-fakes/` is part of
  `install.sh`'s proof too: both tests read the same fakes.
