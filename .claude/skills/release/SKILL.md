---
name: release
description: Ship a new version of the cc plugin — pick the semver step, bump plugin.json, build, run every check and both validates, open the pull request, wait for the owner's yes, then update one machine and run doctor. Also covers a rollback. Use for "release", "bump the version", "ship the plugin", "roll back".
---

# Release the `cc` plugin

Machines with auto-update on take a new version on their next start. So a release
reaches everyone without a further step: check it well before the merge.

## 1. Pick the version step (semver)

The version is `version` in `plugin/.claude-plugin/plugin.json`, `MAJOR.MINOR.PATCH`.

| Step | When |
|---|---|
| **patch** | A fix. No new field, command or behaviour a project must know about. |
| **minor** | Something new that breaks nothing: a command, a hook, a skill, an optional `cc.json` field (`.claude/rules/cc-json.md`). |
| **major** | Something that breaks a project or a machine: a `cc.json` field removed, renamed or narrowed; a command removed; a managed file's format changed. Only with the owner's yes. |

A project that needs the new version raises `requires` in its own `cc.json`. Say in
the pull request which version a project should require for the new part.

## 2. Bump and build

1. Change `version` in `plugin/.claude-plugin/plugin.json`. Change nothing else there.
2. `bun run build`. The version is baked into `plugin/dist/cli.js`, so the bundle
   changes even when no code did.

## 3. Check

```sh
bun run check
claude plugin validate plugin --strict
claude plugin validate . --strict
```

All three must pass. `bun run check` runs the type check, Biome, the neutrality check,
the tests and the bundle check, in CI's order. Fix a failure at its cause; never skip
a check.

## 4. Pull request

1. Commit `plugin.json`, `plugin/dist/` and the change in one commit.
2. Open a pull request into `main`. In its body: what changed for a user, the version
   step and why, and anything a user must run (`cc-agentic setup`, a restart).
3. Wait for CI to go green.
4. **The merge waits for the owner's yes.** Ask once; do not merge on your own.

## 5. After the merge, on one machine

```sh
claude plugin marketplace update cc-agentic
claude plugin update cc@cc-agentic
cc-agentic doctor
```

Then restart Claude Code: an update makes a new version folder, and a running session
keeps the old one. After the restart:

- `cc-agentic version` prints the new version;
- `cc-agentic doctor` is all `✓`;
- when the release changed what `setup` manages, run `cc-agentic setup --dry-run`, read
  the change, then `cc-agentic setup`.

Something wrong? Roll back (below) before other machines start.

## Rollback

Release a **new, higher** version with the old behaviour: revert the change, bump
`patch`, and follow this skill from step 2. Never publish a lower version number, never
force-push `main`, and never edit a version folder on a machine. Claude Code moves every
machine forward to the new version, which is the one path they all take.
