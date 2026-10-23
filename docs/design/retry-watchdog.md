# Claude Code's retry watchdog, offered for the person's own sessions (D42)


Claude Code's `CLAUDE_CODE_RETRY_WATCHDOG=1` makes a session wait and retry, instead of failing,
when a model is limited or down. Proved on 2.1.306: Claude Code reads it from a settings file's
`env`, it retries past 11 requests, and `CLAUDE_CODE_RETRY_WATCHDOG_USAGE_LIMIT_RECHECK_MS` makes
it check whether a usage limit was lifted early. It is the only way the lead's own subagents
survive a limit in process, so `setup` offers it; it never takes it.

- **One home**: `src/setup/retry-watchdog.ts` holds the two env names, their values
  (`RETRY_WATCHDOG_VALUE`, `RETRY_WATCHDOG_RECHECK_MS` = 300000), the two flags, the "no" file, the
  question, the state `doctor` reads and its lines. `src/cli/setup.ts` holds only the ask and the
  write.
- **Waits with no limit** (the owner's choice, D42): no `…_MAX_WAIT_MS` and no
  `…_MAX_USAGE_LIMIT_WAIT_MS` is written, so a session keeps waiting until a model answers.
- **Asked once, default no.** The question comes with setup's other questions, on a terminal only,
  and says the trade-offs: every session waits ("Retrying in …"; Esc cancels), a `claude -p`
  script can hang, the lead's subagents survive a limit only this way. A "no" is remembered in
  `<stateDir>/retry-watchdog-declined`, the way the status line's "no" is. It is not asked when a
  flag decided, when either key is already in the settings' `env`, or after a "no". With no
  terminal nothing is asked or changed, and `--dry-run` names what a real run does.
- **Two owned keys** under `env`, through `applyManagedJson` (backup, atomic write, lock,
  ownership). `--retry-watchdog` writes them without the question; `--no-retry-watchdog` removes
  the ones that are ours and remembers a "no". A value the person set is theirs: a different one
  stops setup in the read-only pass (`ForeignKeyError`); the same one is named and left alone.
  `restore` removes ours like any owned key, and the `env` object with them when setup made it.
- **`doctor`** has one `·` line (`retryWatchdogState`): on (ours), on (the person's own), off with
  the command that turns it on, or off because the person's own value leaves it off. It is
  information, never a failure.
