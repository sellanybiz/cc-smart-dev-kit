---
paths:
  - "src/**"
  - "scripts/**"
  - "plugin/**"
  - "docs/**"
  - "README.md"
---

# Dynamic, Not Hard-Coded (owner, 2026-10-16)

Path-targeted: it loads whenever you touch the plugin's code, scripts, plugin files or docs —
exactly where a copied value can slip in. The general rule for every project is in
`plugin/instructions/core.md` § Core principles; this is how it applies to this repo.

## One source per value

- **The plugin's own names** come from `src/build-info/` (`COMMAND`, `PLUGIN`, `VERSION`),
  and a test reads the same constant. **New code and command output build a name from
  those**, never type `cc-smart-dev-kit`; a string already there is not rewritten in a
  sweep, it changes when the code around it changes.
- **Paths** come from `cliPaths()` / the gateway's paths module — never a typed
  `~/.config/…` or `~/.local/share/…` in code; docs show the path once per section.
- **Ports, timeouts, budgets and limits** are one named constant (or a config default) each.
- **Pinned versions** (MCP servers, Bun, OmniRoute) live in their one table (`src/mcp/versions.ts`,
  the Bun minimum, …); a doc or test that names one reads or quotes that table.
- **Lists** a page, a help text, a doctor check or a doc shows — slots, hooks, skills, servers,
  settings keys, companion plugins — are built from the data that defines them (the schema, the
  spec table, `hooks.json`), not written out a second time.
- **Facts about the machine or repo** — the platform, the default branch, an installed tool, a
  found Chrome — are looked up when needed, injected for tests, never assumed.

## The limit

Make a value configurable when people or projects really differ; a knob for a guessed future is
its own defect (`plugin/instructions/core.md` § Best by default). `check:neutral`,
`check:duplicates` and `check:core-lines` are the mechanical half of this rule; the review is
the rest.
