# GP4a — doctor, restore and `gateway off` know every project

## Goal, and why

After GP2 a project can hold its own gateway state. Three places must see it, all through GP2's
**one effective-state reader** (read GP2's merged code first; never a second reader):

- **`doctor`**: one line per known project with its state and its source file; a warning when a
  project's `model` or an `ANTHROPIC_DEFAULT_*_MODEL` names a slot or a backend target (that would
  bypass the slots), or when a project file sets `CLAUDE_CODE_SUBAGENT_MODEL[_FORCE]` (it makes an
  agent launched without a `model` run on whatever it names — the gateway skill's "never" list).
  Claude Code's own model keys are documented in the line, never written by the kit.
- **`restore`**: it counts the gateway's keys only in the user file today (`src/cli/restore.ts`,
  around line 260): count and take back the kit's owned keys in **every** file it wrote (each
  project's `settings.local.json` / `settings.json`, the `.git/info/exclude` line), with the
  two-stage router rule unchanged (`.claude/rules/setup-and-managed-files.md` § restore).
- **`gateway off`**: list the projects still `on` (their own value keeps them on the router after the
  machine goes off) with the command that turns each off.

## Files (change nothing else)

`src/cli/doctor.ts` (or the gateway's doctor checks in `src/gateway/`), `src/cli/restore.ts`,
`src/gateway/commands.ts` (`off`'s output), their tests; `README.md` § doctor's list and § restore;
`docs/gateway.md`; `plugin/dist/*.js`. The router bundle must not change.

## Done-check

Tests with temp projects in each state; `bun run build`; `bun run check`; your review; your report.
