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
`~/.claude/plugins/cache/anymodel/anymodel/<version>/`. There is no install step there: no
`bun install`, no `node_modules`.

- **Nothing in `plugin/` imports from outside it.** Every script in it is a bundle that
  carries all its code (`zod` included), or a small shell script.
- **`plugin/` holds:** `.claude-plugin/plugin.json` (the manifest), `dist/` (bundles),
  `bin/` (on the Bash tool's PATH in Claude Code), `hooks/hooks.json`, `instructions/`
  (plain Markdown that `setup` copies), `skills/`, `agents/` and `output-styles/`.
- **The router bundle never changes by accident.** Code that `src/entries/router.ts`
  imports (`src/cli/paths.ts`, `src/gateway/`) changes `plugin/dist/router.js`, which makes
  every machine restart its router. After `bun run build`, check `git diff --stat
  plugin/dist`: a `router.js` line needs a reason.
- **Never run anything long-lived from the version folder.** Claude Code deletes an old
  one after an update: 14 days later, the docs say (not proved yet:
  `docs/claude-code-contract.md`). A long-running part runs from a copy in
  `~/.local/share/anymodel/`: the router (`src/entries/router.ts` → `dist/router.js`,
  copied by `gateway setup`), later the portal.

## Bundles are committed

`bun run build` (`scripts/build.ts`) turns each `src/entries/<name>.ts` into
`plugin/dist/<name>.js`: target bun, ESM, not minified, one flat folder. **One build per
entry:** built together, Bun keeps a library export in every bundle when any entry uses
it, so a CLI change could change `router.js`.

- **After any change under `src/`, run `bun run build` and commit `plugin/dist` in the
  same commit.** `bun run build:check` (in `bun run check` and CI) builds into a temp
  folder and fails on a missing, stale or extra bundle.
- **Never edit `plugin/dist/*.js` by hand.** It is excluded from Biome and the
  neutrality check because it is built from `src/`.
- **A new bundle is a new file in `src/entries/`.** A test file there is skipped.
- `plugin/bin/anymodel` is written by hand. It finds `dist/cli.js` from its own
  location (`dirname "$0"`), because `CLAUDE_PLUGIN_ROOT` is not set in the Bash tool.
- `plugin/bin/anymodel-bun` is written by hand too: the hooks' way to bun when PATH has
  none (`hooks.md`). It reads the launcher's `baked_bun=` line, so a change to that line
  in `launcherScript` changes the shim too (`src/setup/bun-shim.test.ts`).

## The version lives in one place

`version` in `plugin/.claude-plugin/plugin.json`. The marketplace manifest has none.

- `src/build-info/` reads `version` and `repository` from `plugin.json` through a Bun
  macro (code that runs at build time), and the `dependencies` list (the companion
  plugins). The bundle holds those values only, never the rest of the file.
- So **a version bump changes `plugin/dist/cli.js`**: rebuild after it.
- **But never `plugin/dist/router.js`.** A changed router bundle makes `gateway setup`
  restart the router on every machine, which cuts answers in flight. So code in the
  router bundle imports the fixed names (`COMMAND`, `PLUGIN`, …) from
  `src/build-info/names.ts`, never from `src/build-info` (its index bakes in the
  version). `src/build-info/manifest.test.ts` › "the router bundle" fails when the
  version or the repository gets into `router.js`.
- **Any change under `plugin/` needs a version bump.** Claude Code keys installs and
  updates by the version, so without a bump no user ever gets the change. CI enforces
  it: a pull request that changes anything under `plugin/` must raise `version`
  (`scripts/check-version-bump.ts`). A change to `src/` that changes a bundle changes
  `plugin/dist/`, so it needs a bump too.
- Use `VERSION`, `MARKETPLACE_SOURCE`, `PLUGIN_ID` and the command strings from
  `src/build-info/`. Never write the version, the repository or `anymodel@anymodel` twice.

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
