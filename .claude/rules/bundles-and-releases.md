---
paths:
  - "src/**"
  - "scripts/**"
  - "plugin/**"
  - "package.json"
---

# Bundles And Releases

## Only `plugin/` reaches a machine

Claude Code copies only `plugin/` into
`~/.claude/plugins/cache/cc-agentic/cc/<version>/`. There is no install step there: no
`bun install`, no `node_modules`.

- **Nothing in `plugin/` imports from outside it.** Every script in it is a bundle that
  carries all its code (`zod` included), or a small shell script.
- **`plugin/` holds:** `.claude-plugin/plugin.json` (the manifest), `dist/` (bundles),
  `bin/` (on the Bash tool's PATH in Claude Code), `hooks/hooks.json`, and later
  `skills/`, `agents/` and instructions for users.
- **Never run anything long-lived from the version folder.** Claude Code deletes an old
  one after an update: 14 days later, the docs say (not proved yet:
  `docs/claude-code-contract.md`). A long-running part (later: the router, the portal)
  runs from a copy that `setup` puts in `~/.local/share/cc/`.

## Bundles are committed

`bun run build` (`scripts/build.ts`) turns each `src/entries/<name>.ts` into
`plugin/dist/<name>.js`: target bun, ESM, not minified, one flat folder.

- **After any change under `src/`, run `bun run build` and commit `plugin/dist` in the
  same commit.** `bun run build:check` (in `bun run check` and CI) builds into a temp
  folder and fails on a missing, stale or extra bundle.
- **Never edit `plugin/dist/*.js` by hand.** It is excluded from Biome and the
  neutrality check because it is built from `src/`.
- **A new bundle is a new file in `src/entries/`.** A test file there is skipped.
- `plugin/bin/cc-agentic` is written by hand. It finds `dist/cli.js` from its own
  location (`dirname "$0"`), because `CLAUDE_PLUGIN_ROOT` is not set in the Bash tool.

## The version lives in one place

`version` in `plugin/.claude-plugin/plugin.json`. The marketplace manifest has none.

- `src/build-info/` reads `version` and `repository` from `plugin.json` through a Bun
  macro (code that runs at build time). The bundle holds those two values only, never
  the rest of the file.
- So **a version bump changes `plugin/dist/cli.js`**: rebuild after it.
- **Any change under `plugin/` needs a version bump.** Claude Code keys installs and
  updates by the version, so without a bump no user ever gets the change. CI enforces
  it: a pull request that changes anything under `plugin/` must raise `version`
  (`scripts/check-version-bump.ts`). A change to `src/` that changes a bundle changes
  `plugin/dist/`, so it needs a bump too.
- Use `VERSION`, `MARKETPLACE_SOURCE`, `PLUGIN_ID` and the command strings from
  `src/build-info/`. Never write the version, the repository or `cc@cc-agentic` twice.

## Dependencies

- One runtime dependency: `zod`. Ask the owner before you add another one — it goes
  into every bundle.
- Bun only: `bun add`, never `npm`. CI installs with `bun install --frozen-lockfile`, so
  commit `bun.lock` with any dependency change.

## Releasing

A new version follows the `release` skill: semver, bump, build, check, both validates,
pull request, the owner's yes, then the update on one machine. CI fails a pull request
that changes `plugin/` without the bump (above). A rollback is a new
version with the old behaviour, never a lower version number.
