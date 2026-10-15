---
name: release
description: Ship a new version of the anymodel plugin — pick the semver step, bump plugin.json, build, run every check and both validates, open the pull request, wait for the owner's yes, then update one machine and run doctor. Also covers a rollback. Use for "release", "bump the version", "ship the plugin", "roll back".
---

# Release the `anymodel` plugin

Machines with auto-update on take a new version on their next start. So a release
reaches everyone without a further step: check it well before the merge.

## 1. Pick the version step (semver)

The version is `version` in `plugin/.claude-plugin/plugin.json`, `MAJOR.MINOR.PATCH`.

| Step | When |
|---|---|
| **patch** | A fix. No new field, command or behaviour a project must know about. |
| **minor** | Something new that breaks nothing: a command, a hook, a skill, an optional `anymodel.json` field (`.claude/rules/anymodel-json.md`). |
| **major** | Something that breaks a project or a machine: an `anymodel.json` field removed, renamed or narrowed; a command removed; a managed file's format changed. Only with the owner's yes. |

A project that needs the new version raises `requires` in its own `anymodel.json`. Say in
the pull request which version a project should require for the new part.

## 2. Bump and build

1. Change `version` in `plugin/.claude-plugin/plugin.json`. Change nothing else there.
2. `bun run build`. The version is baked into `plugin/dist/cli.js`, so the bundle
   changes even when no code did.

CI enforces the bump: a pull request that changes anything under `plugin/` (a rebuilt
bundle counts) must raise `version` (`scripts/check-version-bump.ts`). Claude Code keys
installs and updates by the version, so a change without a bump never reaches a user.

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
   step and why, and anything a user must run (`anymodel setup`, a restart).
   The router changed (`plugin/dist/router.js` differs from the last release, which is
   `main`: `git diff origin/main -- plugin/dist/router.js`)? Say so in the body: each
   machine with the gateway runs `anymodel gateway setup`, which asks before it restarts
   the router (a restart cuts the answers in flight). A version bump alone does not
   change `router.js`: the router takes no baked version (`src/build-info/names.ts`).
3. Wait for CI to go green.
4. **The merge waits for the owner's yes.** Ask once; do not merge on your own.

## 5. After the merge, on one machine

```sh
claude plugin marketplace update anymodel
claude plugin update anymodel@anymodel
anymodel doctor
```

Then restart Claude Code: an update makes a new version folder, and a running session
keeps the old one. After the restart:

- `anymodel version` prints the new version;
- `anymodel doctor` is all `✓`;
- when the release changed what `setup` manages, run `anymodel setup --dry-run`, read
  the change, then `anymodel setup`;
- when the release changed the router, and this machine runs the gateway: `doctor` says
  the router copy is not this version's; run `anymodel gateway setup` (it asks before the
  restart).

Something wrong? Roll back (below) before other machines start.

## Rollback

Release a **new, higher** version with the old behaviour: revert the change, bump
`patch`, and follow this skill from step 2. Never publish a lower version number, never
force-push `main`, and never edit a version folder on a machine. Claude Code moves every
machine forward to the new version, which is the one path they all take.
