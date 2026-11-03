# Claude Code's retry watchdog, on by default for the person's own sessions (D56)


Claude Code's `CLAUDE_CODE_RETRY_WATCHDOG=1` makes a session wait and retry, instead of failing,
when a model is limited or down. Proved on 2.1.306: Claude Code reads it from a settings file's
`env`, it retries past 11 requests, and `CLAUDE_CODE_RETRY_WATCHDOG_USAGE_LIMIT_RECHECK_MS` makes
it check whether a usage limit was lifted early. It is the only way the main session's subagents
survive a limit in process, so `setup` turns it on.

- **One home**: `src/setup/retry-watchdog.ts` holds the three env names, their values
  (`RETRY_WATCHDOG_VALUE`, `RETRY_WATCHDOG_RECHECK_MS` = 300000,
  `RETRY_WATCHDOG_MAX_USAGE_LIMIT_WAIT_MS` = 86400000), the two flags, the "no" file, the lines
  setup prints, the state `doctor` reads and its lines. `src/cli/setup.ts` holds only the
  decision and the write.
- **On by default** (D56). Setup writes the keys with no question, on a terminal or not, with
  `--yes` or not. A "no" (`--no-retry-watchdog`, or an answer from before D56) is remembered in
  `<stateDir>/retry-watchdog-declined`, and setup leaves the keys out while none of ours is
  there. A key of the person's own in the settings' `env` is theirs and stays, with no cap added
  beside it: their watchdog, their limits. `--retry-watchdog` writes all three and forgets the
  "no". A "no" left beside our own keys (an older `--retry-watchdog` did not remove it) is
  stale: a plain run keeps the keys on, completes an older setup's two keys with the cap, and
  forgets it. `--dry-run` names each change and writes nothing.
- **The 24-hour cap** (D56). `…_MAX_USAGE_LIMIT_WAIT_MS` = 86400000 ends a wait whose usage
  limit resets more than 24 hours away, so the request ends instead of holding a `claude -p`
  script for days. The 5-hour limit, and a model that is down or overloaded, are still waited
  out with no limit (no `…_MAX_WAIT_MS`, D42).
- **Three owned keys** under `env`, through `applyManagedJson` (backup, atomic write, lock,
  ownership). A plain setup leaves a key of the person's own alone, silently. With
  `--retry-watchdog`, a value they set is theirs too: a different one stops setup in the
  read-only pass (`ForeignKeyError`); the same one is named and left alone.
  `--no-retry-watchdog` removes the ones that are ours and remembers a "no". `restore` removes
  ours like any owned key, and the `env` object with them when setup made it.
- **`doctor`** has one `·` line (`retryWatchdogState`): on (ours), on (the person's own), off with
  the command that turns it on, or off because the person's own value leaves it off. It is
  information, never a failure.
