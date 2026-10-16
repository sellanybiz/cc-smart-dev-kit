---
name: release
description: Ship a new version of the cc-smart-dev-kit plugin — pick the semver step, bump plugin.json, build, run every check and both validates, open the pull request, wait for the owner's yes, then update one machine and run doctor. Also covers a rollback. Use for "release", "bump the version", "ship the plugin", "roll back".
---

# Release the `cc-smart-dev-kit` plugin

Machines with auto-update on take a new version on their next start. So a release
reaches everyone without a further step: check it well before the merge.

## 1. Pick the version step (semver)

The version is `version` in `plugin/.claude-plugin/plugin.json`, `MAJOR.MINOR.PATCH`.

| Step | When |
|---|---|
| **patch** | A fix. No new field, command or behaviour a project must know about. |
| **minor** | Something new that breaks nothing: a command, a hook, a skill, an optional `cc-smart-dev-kit.json` field (`.claude/rules/cc-smart-dev-kit-json.md`). |
| **major** | Something that breaks a project or a machine: a `cc-smart-dev-kit.json` field removed, renamed or narrowed; a command removed; a managed file's format changed. Only with the owner's yes. |

A project that needs the new version raises `requires` in its own `cc-smart-dev-kit.json`. Say in
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
   step and why, and anything a user must run (`cc-smart-dev-kit setup`, a restart).
   The router changed (`plugin/dist/router.js` differs from the last release, which is
   `main`: `git diff origin/main -- plugin/dist/router.js`)? Say so in the body: each
   machine with the gateway runs `cc-smart-dev-kit gateway setup`, which asks before it restarts
   the router (a restart cuts the answers in flight). A version bump alone does not
   change `router.js`: the router takes no baked version (`src/build-info/names.ts`).
3. Wait for CI to go green.
4. **The merge waits for the owner's yes.** Ask once; do not merge on your own.

## 5. After the merge, on one machine

```sh
claude plugin marketplace update cc-smart-dev-kit
claude plugin update cc-smart-dev-kit@cc-smart-dev-kit
cc-smart-dev-kit doctor
```

A machine still on 0.2.x (the version before the name change) takes a different path:
add this marketplace, install this plugin, then run the new plugin's `dist/cli.js` with
`bun --no-env-file --config=<that version's bunfig.toml>` - `cc-smart-dev-kit` does not
exist there yet, the old launcher is the only one, and without the flags bun would load the
working folder's `.env` files and run its `bunfig.toml`:

```sh
plugin="$HOME/.claude/plugins/cache/cc-smart-dev-kit/cc-smart-dev-kit/<version>"
claude plugin marketplace add <owner>/cc-smart-dev-kit
claude plugin install cc-smart-dev-kit@cc-smart-dev-kit
bun --no-env-file --config="$plugin/bunfig.toml" "$plugin/dist/cli.js" migrate
```

That moves everything the old version wrote (`README.md` § Moving from anymodel).

Then restart Claude Code: an update makes a new version folder, and a running session
keeps the old one. After the restart:

- `cc-smart-dev-kit version` prints the new version;
- `cc-smart-dev-kit doctor` is all `✓`;
- when the release changed what `setup` manages, run `cc-smart-dev-kit setup --dry-run`, read
  the change, then `cc-smart-dev-kit setup`;
- when the release changed the router, and this machine runs the gateway: `doctor` says
  the router copy is not this version's; run `cc-smart-dev-kit gateway setup` (it asks before the
  restart).

Something wrong? Roll back (below) before other machines start.

## Rollback

Release a **new, higher** version with the old behaviour: revert the change, bump
`patch`, and follow this skill from step 2. Never publish a lower version number, never
force-push `main`, and never edit a version folder on a machine. Claude Code moves every
machine forward to the new version, which is the one path they all take.
