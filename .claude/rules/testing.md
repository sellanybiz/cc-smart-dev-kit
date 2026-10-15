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
- **Never the real `HOME`, `~/.claude`, `~/.config` or `~/.local`.** A test that runs the
  CLI sets `HOME` and `CLAUDE_CONFIG_DIR` to a temp folder (see `src/cli/cli.test.ts`).
  Code under test takes its paths from `cliPaths()` or from arguments, never from
  `homedir()`.
- **Git in a test** uses `git()` and `cleanGitEnv()` from `src/testing/temp.ts`: no
  `GIT_*` variable from outside, no global or system git config, a fixed author.

## Fake binaries on PATH

A test never reaches the network or a real tool it does not test (`git ls-remote`,
`claude`, a service). Put a small fake script first on `PATH`, in the temp folder:

- it logs each call to a file, so the test can assert the exact arguments;
- it succeeds or fails on purpose, so both paths are tested.

`src/cli/cli.test.ts` does this for `git`.

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
