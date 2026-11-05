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

- **`plugin/` holds** the manifest, committed bundles and portal export, launchers, hooks,
  instructions, skills, agents, workflows, output styles and default settings. No
  `node_modules`. Keep `bunfig.toml` empty: plugin Bun calls select it so a project's
  preload cannot run. See `docs/design/parts.md`.
- **Nothing in `plugin/` imports from outside it.** Every script in it is a bundle that
  carries all its code (`zod` included), or a small shell script.
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
  copied by `gateway setup`) and the portal (`src/entries/portal.ts` → `dist/portal.js`
  beside `plugin/portal-ui/`, its export; the session-start part's starter and `portal` copy
  both through `writeManagedFile` and `writeManagedFolder`, so `restore` removes them). The
  portal stays up from session start to session start (D10), so
  this is not a rule about a short run: its process outlives many version folders.

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
- **The portal's export is build output too, and committed.** `bun run build:portal`
  (`scripts/portal-export.ts`) builds `portal/` and copies `portal/out` into
  `plugin/portal-ui/`; `bun run check:portal` rebuilds and compares byte for byte, and CI
  runs it in its own step after installing `portal/`'s own dependencies. It is **not part
  of `bun run build`**: that step must not need React's `node_modules`, and it must not
  pay the Next build's time. The export is reproducible — `generateBuildId` in
  `portal/next.config.ts` fixes the id Next makes at random, so a second build is byte for
  byte the same (`diff -r` is empty) — which is why a plain compare is the check. **Build it
  on Linux:** Next's compiler for Windows gives the same source other bytes, so an export built
  on Windows fails CI's compare (the script says so there; its header has the detail).
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

## The names before this one

Two older names exist, and a command or a check still knows each. Keep both in mind when
you touch a check that names a plugin, a launcher or a folder.

- **`cc` in the marketplace `cc-agentic`** (before 0.2.0; the plugin id was
  `cc@cc-agentic`). `doctor` fails while such a plugin is still enabled, and its line is
  the order to leave that state (`README.md` § Commands).
- **`anymodel`** (0.2.x): every folder, the launcher, the router units and the gateway's
  slots said it. `cc-smart-dev-kit migrate` moves such a machine
  (`src/cli/migrate.ts`; the person's page is `README.md` § Moving from anymodel). It
  decides by itself what to move, so the installer runs it on every machine and it is a
  no-op where there is nothing to move.

## Dependencies

- Runtime dependencies: `zod`, official MCP SDK (`@modelcontextprotocol/server` and
  `@modelcontextprotocol/core` 2.4.0; approved 2026-11-03). Ask the owner before adding another.
- SDK only in `plugin/dist/tasks-mcp.js`, never `cli.js`. Use `bun add`; commit `bun.lock`.
- `acorn` (8.x, the JavaScript parser; approved 2026-11-05) only in the agent guard's bundles
  (`agent-guard.js`, and `bash-judge`'s if it shares the reader), for reading Workflow scripts.
  Never in `cli.js` or `router.js`: check `git diff --stat plugin/dist` after the build.

## Releasing

A new version follows the `release` skill: semver, bump, build, check, both validates,
pull request, the owner's yes, then the update on one machine. CI fails a pull request
that changes `plugin/` without the bump (above). A rollback is a new
version with the old behaviour, never a lower version number.
