---
name: claude-code-upgrade
description: Move the plugin to a newer Claude Code — read the changelog for hooks, plugins, settings, auto mode, MCP and subagents, walk docs/claude-code-contract.md row by row, run the tests and the validates (only the validates run the new version), prove the live rows, fix what changed, raise .claude-code-version, release. Use when the weekly CI job opens a claude-code-upgrade issue, or a new Claude Code version is out.
---

# Upgrade to a newer Claude Code

The plugin relies on Claude Code behaviour that can change in any release. Every such
behaviour is a row in `docs/claude-code-contract.md`. This skill checks those rows
against the new version, fixes what broke, and records the new tested version.

The tested version lives in one file: `.claude-code-version` at the repo root. CI
installs exactly that version. A weekly CI job installs the newest Claude Code, runs the
tests and both validates, and opens (or updates) one issue with the label
`claude-code-upgrade` when it is newer or a check fails. **Only the two validates run
Claude Code.** The tests do not, so a green weekly run proves only that the manifests
still validate; every other row needs this skill.

## 1. Find the two versions

```sh
cat .claude-code-version
curl -fsSL https://registry.npmjs.org/@anthropic-ai/claude-code/latest | jq -r .version
```

Read the open `claude-code-upgrade` issue too, if there is one: it lists which checks
failed.

## 2. Read the changelog

Read every Claude Code release between the two versions
(`https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md`). Note each entry
about:

- hooks: events, input fields, output, exit codes, timeouts, WorktreeCreate and
  WorktreeRemove;
- plugins: install, update, the cache folder, `installed_plugins.json`,
  `known_marketplaces.json`, `plugin validate`, `bin/`, plugin variables;
- settings keys, permissions and auto mode (the safety check's request and answer);
- MCP servers and their tool names;
- subagents and request headers;
- `CLAUDE.md` imports.

## 3. Walk the contract

Go through `docs/claude-code-contract.md` one row at a time. For each row: does a
changelog entry touch it? Mark the rows to prove again. A changelog that says nothing
is not proof, and neither is a green `bun run check`: a unit test proves our reader, not
Claude Code. Once a version has many changes, prove the live rows again live.

## 4. Test against the new version

1. Install the new version (`claude update`, or as CI does it, in a temp folder).
2. Run:

   ```sh
   bun run check
   claude plugin validate plugin --strict
   claude plugin validate . --strict
   ```

   `bun run check` does not run Claude Code; it shows the plugin still builds and its
   own tests pass. Only the two validates run the new version.

3. From Phase 3 on: `cc-agentic doctor --live`. It runs a throwaway session in a temp
   repo with the plugin and proves the hooks and the worktree contract. It needs a
   login, so it runs on a machine, not in CI. Before Phase 3, prove the marked live rows
   by hand in a throwaway project.

## 5. Fix

For each row that changed:

- fix the plugin at the cause, with a test that fails on the old behaviour;
- update the row: the new behaviour, how it is proved;
- update `docs/design.md` or a rule in `.claude/rules/` when the change moves a design
  point (for example `hooks.md`).

When a change cannot be fixed in the plugin yet, write it into the issue and stop
before step 6: the tested version must not claim what was not proved.

## 6. Raise the tested version

1. Write the new version into `.claude-code-version`.
2. Set "Last proved on" to the new version for every row you proved again.
3. Release (`release` skill). A fix is usually `patch`. Only the version file changed?
   Merge it without a release: no user gets anything new.
4. Close the `claude-code-upgrade` issue from the pull request.

## New features are separate

A new Claude Code feature we want to use goes in as a normal change, in its own pull
request, with its own contract row. Keep the upgrade pull request to what the new
version needs.
