# GP3 — `cc-smart-dev-kit launch`: one session with or without the gateway

## Goal, and why

A person sometimes wants ONE session on a different model path than the machine or the project:
plain Claude for a sensitive task, the gateway for a long one, or a profile. R6 (the research
archive § R6) found that a settings file's `env` beats a shell export, so a launcher cannot work by
environment variables; it must pass `--settings`. Read GP0's results first (P3: `--settings` beats
project files; P4: settings beat the shell; P10: `--settings` carries over to a background session).

## What to build

`cc-smart-dev-kit launch [--no-gateway | --gateway | --profile <name>] [-- <claude args>]`:
- writes a small settings file with only `env.ANTHROPIC_BASE_URL` (`https://api.anthropic.com` for
  `--no-gateway`; the router's root for `--gateway`; `…/p/<name>` for `--profile`), and starts
  `claude --settings <file> <claude args>` in the current folder, attached to the terminal (it
  replaces itself where the platform allows; otherwise it waits and passes the exit code on);
- **one home for the settings-file write**: the crew launch already writes a session settings file
  (`crewSettingsFile` in `src/crew/store.ts`, `crewSettingsText` in `src/crew/start.ts`) — reuse or
  extract that helper; never a second writer. The file lives in the state folder, mode 0600, and
  is removed or reused safely (two launches at once must not clash);
- refuses `--profile` with a name `gateway.json` does not have, `--gateway` when the router is not
  set up, and runs nothing inside Claude Code (it would start a session inside a session: one line);
- Windows: a `.cmd` launcher cannot pass a file it must write first in one line — use the state
  file the R6 note names; say what was and was not proved on Windows.

## Files (change nothing else)

`src/cli/launch.ts` (new) and its test, `src/entries/cli.ts` (the command), `src/cli/help.ts`,
the shared settings-file helper (`src/crew/store.ts` / `start.ts`, only to extract it),
`README.md` (the command), `docs/gateway.md` (§ One session), `plugin/skills/gateway/SKILL.md`,
`plugin/dist/*.js`. The router bundle must not change.

## Done-check

Tests with a fake `claude` on PATH that logs its argv and the settings file's content; `bun run
build`; `bun run check`; your review; your report.
