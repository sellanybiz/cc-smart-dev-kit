---
paths:
  - "**/*.test.ts"
  - "src/testing/**"
---

# Testing

The code changes users' settings files. A test that touches the real ones can break
the machine it runs on. A test that cannot fail proves nothing.

## Temp folders only

- **Every file a test writes goes into `tempDir()`** (`src/testing/temp.ts`). The
  preload in `bunfig.toml` (`src/testing/setup.ts`) removes those folders after each
  test.
- **Never the real `HOME`, `~/.claude`, `~/.config` or `~/.local`.** The preload gives each
  run its own temp home (`src/testing/test-home.ts`): it sets `HOME`, `USERPROFILE`,
  `CLAUDE_CONFIG_DIR` and the `XDG_*` folders, and makes `os.homedir()` answer it. That is the
  net, not the method: a test that runs the CLI still sets `HOME` and `CLAUDE_CONFIG_DIR` to its
  own `tempDir()` (see `src/cli/cli.test.ts`), and a child started with a hand-built env gets
  `childEnv()`, so it never falls back to the real home. Code under test takes its paths from
  `cliPaths()` or from arguments, never from `homedir()`.
- **Git in a test** uses `git()` and `cleanGitEnv()` from `src/testing/temp.ts`: no
  `GIT_*` variable from outside, no global or system git config, a fixed author.

## The time zone

`bun test` runs in UTC but leaves `TZ` unset. The preload writes that zone into `TZ`, so a
test that sets `TZ` and restores it puts UTC back, not the machine's own zone
(`src/testing/setup.test.ts`). Restore `TZ` the way you found it, and never assume the
machine's zone.

## Fake binaries on PATH

A test never reaches the network or a real tool it does not test (`git ls-remote`,
`claude`, a service). Put a small fake script first on `PATH`, in the temp folder:

- it logs each call to a file, so the test can assert the exact arguments;
- it succeeds or fails on purpose, so both paths are tested.

`src/cli/cli.test.ts` does this for `git`. `src/testing/fake-machine.ts` builds a temp home
and a fake `Machine` (fake sudo, apt-get, dnf, rpm, brew, gpg, claude; a terminal that
answers what the test says) for `runSetup` in the test's own process. `src/testing/chrome-world.ts`
builds a temp home with a Chrome profile in it — a fake executable, a recorder where a real run
would start one, and a fake Windows registry — so a test about the browser never reads or starts
the real Chrome, and never touches the real `~/.config/google-chrome`.

**Never the host.** A test that runs the CLI as its own process gives it a PATH of fakes
(plus bun's folder, and git alone when it needs the real one), never the host's PATH,
and the host's facts in `CC_SMART_DEV_KIT_TEST_HOST` (platform, arch, os-release, user id), so its exact output is the same on any machine.

## Never the live router's port

A gateway router may run for real on this machine, on port 20100. **No test may ever
connect to it.** Each test uses a fake server's free port, or an injected fake probe
(`GatewayContext.probe`, the `fetch` of `routerHealth` and `gatewayChecks`).

The guard (`src/testing/port-guard.ts`) enforces it: the preload wraps `fetch`, and a call
to 127.0.0.1, localhost or [::1] on 20100 is refused and fails the test, even when the
code caught the error. A test that starts the CLI or the router as a bun subprocess
passes `subprocessGuard().args` after the bun path and `subprocessGuard().env` in its
environment, so the guard runs in there too. A command that would ask the default port
(`gateway setup` or `on` with no config) runs in the test's own process instead, with a
fake probe (`runHere` in `src/cli/gateway-cli.test.ts`).

## Every test can fail

- **Write the expected value by hand.** Never compute it with the code under test.
- **Assert exact output** where the output is the contract: the lines `setup` and
  `doctor` print, a hook's stdout, a file's content, a file's mode.
- **Prove a new check fails once.** Break the code (or the input) on purpose, watch
  the test go red, then put it back. A test you never saw fail is not trusted.
- **Test the failure paths too:** a missing file, invalid JSON, a foreign key, a busy
  lock, a version outside `requires`.

## Never weaken a test to go green

Never skip a test, loosen an assertion, or delete a case to make it pass. Find the
cause and fix it. A flaky test has a race: find it.

## Run

`bun test` runs everything; `bun test <path>` runs one file. `bun run check` runs the
tests with the other checks.
