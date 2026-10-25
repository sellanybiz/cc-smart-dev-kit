# CL9 — drop B0's one-release `portal.json` read (1.4.1)

Your branch starts from `release-1.4.1`, cut from `main` after 1.4.0 shipped. The lead owns
`plugin/.claude-plugin/plugin.json`, the installers' version lines and the CHANGELOG's version
heading: leave them. The plan: `.claude/plans/2026-10-21-master-plan.md` § the last stage ("drop
B0's one-release `portal.json` read"). Read `.claude/rules/gateway.md`,
`.claude/rules/bundles-and-releases.md`, `.claude/rules/setup-and-managed-files.md` and
`.claude/rules/testing.md` first.

## Why

B0 (0.6.0) moved the chains and switches a 0.5.x portal kept in its own file, `portal.json`, into
`gateway.json`'s `kept`. The read was meant to live one release. It still runs in every `gateway
setup` and every `gateway` config upgrade: `portalChains`, `withPortalChains`, `portalMemoryText`
and the strip-and-rewrite of `portal.json` (`src/gateway/commands.ts`, about lines 835-975, called
at about 2274 and 2315), with `cliPaths().portalStateFile` (`src/cli/paths.ts:49-50,139`). A machine
still on 0.5.x is now nine releases back; its update path is `migrate` and `setup`, which this does
not touch.

## What to build

1. Remove the `portal.json` read and its rewrite from the gateway's config upgrade, and every helper
   only it used. `portalStateFile` goes from `cliPaths()` when nothing else reads it (search the
   whole of `src/`, `scripts/` and `portal/`). Do not delete a person's `portal.json`: leave the
   file alone, read nothing from it.
2. The tests that prove the old move (`src/portal/server.test.ts` about 2438-2560, and any in
   `src/gateway/`) go with it. Keep any test that still proves something true (for example, "the
   portal keeps no copy of its own"); rewrite it so it no longer needs the path. Add one test: a
   `gateway setup` / config upgrade on a home that has a 0.5.x `portal.json` leaves that file
   byte for byte as it was and moves nothing.
3. Docs: `docs/design/gateway.md:63`, `docs/gateway.md:524` and `:1735`, the README's `gateway
   setup` row (about line 868) — say nothing about the move any more, or one line that 0.5.x's
   `portal.json` is no longer read (from 1.4.1). A CHANGELOG bullet under a `## 1.4.1` heading the
   lead adds (write yours under `## Unreleased` at the top; the lead renames it).
4. **The repo's own floor:** `doctor` warns that this repository's `.claude/cc-smart-dev-kit.json`
   says `requires ">=0.5.2"` while its fields need `">=1.0"`. Raise it to what `requiresFloor`
   says (run `bun --no-env-file --config=plugin/bunfig.toml plugin/dist/cli.js doctor` after `bun
   run build` from your worktree to confirm the line is gone).
5. `bun run build`; `git diff --stat plugin/dist` must not list `router.js` (the CLI changed, not
   the router). Say so in the report.

## Files

`src/gateway/commands*`, `src/gateway/` tests that cover the move, `src/cli/paths*`,
`src/portal/server.test.ts` (only the move's tests), `docs/design/gateway.md`, `docs/gateway.md`,
`README.md` (the `gateway setup` row), `CHANGELOG.md` (`## Unreleased` only),
`.claude/cc-smart-dev-kit.json` (`requires` only), `plugin/dist/*` (only through `bun run build`).
Change nothing else.

## Done-check

The targeted tests (`bun test src/gateway/ src/portal/server.test.ts src/cli/`), `bun run build`,
`bun run check`, both `claude plugin validate … --strict`. Your own review, then one second opinion
(`cc-smart-dev-kit:reviewer`, `sonnet`, `high`). Tests never touch the real `~/.claude`,
`~/.config`, `~/.local`, nor port 20100. Neutral: no names of a company, person or machine.
