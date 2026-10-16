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
`~/.claude/plugins/cache/cc-smart-dev-kit/cc-smart-dev-kit/<version>/`. There is no install step there: no
`bun install`, no `node_modules`.

- **Nothing in `plugin/` imports from outside it.** Every script in it is a bundle that
  carries all its code (`zod` included), or a small shell script.
- **`plugin/` holds:** `.claude-plugin/plugin.json` (the manifest), `dist/` (bundles),
  `bin/` (on the Bash tool's PATH in Claude Code), `hooks/hooks.json`, `instructions/`
  (plain Markdown that `setup` copies), `skills/`, `agents/`, `output-styles/`,
  `serena/` (the one file `setup` copies to the data folder and starts Serena with,
  `contexts/worktree.yml`: a registration cannot name a path that an update deletes), and
  `bunfig.toml` (**empty, and it stays empty**: every bun the plugin starts in a person's
  folder gets `--config=` pointing at it, so a project's own `bunfig.toml` — its `preload` —
  never runs inside the plugin; `docs/design.md` § The two flags on every bun run inside a
  person's folder).
- **The router bundle never changes by accident.** Code that `src/entries/router.ts`
  imports (`src/gateway/`, its paths in `src/gateway/paths.ts`) changes
  `plugin/dist/router.js`, which makes every machine restart its router. The router reads
  its own paths module only, never `src/cli/paths.ts`, so a CLI path added there cannot
  change it (`src/build-info/manifest.test.ts` › "the router bundle" fails when it does).
  After `bun run build`, check `git diff --stat plugin/dist`: a `router.js` line needs a
  reason.
- **Never run anything long-lived from the version folder.** Claude Code deletes an old
  one after an update: 14 days later, the docs say (not proved yet:
  `docs/claude-code-contract.md`). A long-running part runs from a copy in
  `~/.local/share/cc-smart-dev-kit/`: the router (`src/entries/router.ts` → `dist/router.js`,
  copied by `gateway setup`), later the portal.

## Bundles are committed

`bun run build` (`scripts/build.ts`) turns each `src/entries/<name>.ts` into
`plugin/dist/<name>.js`: target bun, ESM, not minified, one flat folder. **Each entry is
built on its own** (one `Bun.build` per entry): Bun drops a shared module's unused code by
what all the entries of one build use, so building them together made a new bundle change
the others, `router.js` included.

- **After any change under `src/`, run `bun run build` and commit `plugin/dist` in the
  same commit.** `bun run build:check` (in `bun run check` and CI) builds into a temp
  folder and fails on a missing, stale or extra bundle.
- **Never edit `plugin/dist/*.js` by hand.** It is excluded from Biome and the
  neutrality check because it is built from `src/`.
- **A new bundle is a new file in `src/entries/`.** A test file there is skipped.
- `plugin/bin/cc-smart-dev-kit` is written by hand. It finds `dist/cli.js` from its own
  location (`dirname "$0"`), because `CLAUDE_PLUGIN_ROOT` is not set in the Bash tool.
- `plugin/bin/cc-smart-dev-kit-bun.sh` is written by hand too (the `.sh` is what makes Claude
  Code run it through bash on Windows, `docs/windows-hooks.md`): the plugin's hooks run
  through it, so they find bun without PATH (`.claude/rules/hooks.md`). It reads the launcher's
  `baked_bun='…'` line, so a change to that line in `src/setup/launcher.ts` changes it too.
  Both shim tests run the real launcher script (`src/hooks/bun-shim.test.ts`,
  `src/setup/bun-shim.test.ts`).

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
  `src/build-info/`. Never write the version, the repository or `cc-smart-dev-kit@cc-smart-dev-kit` twice.

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
