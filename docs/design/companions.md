# Companion plugins


cc-smart-dev-kit depends on claude-mem and frontend-design (`plugin.json` `dependencies`, with
`allowCrossMarketplaceDependenciesOn` in `marketplace.json`). A dependency is the
plugin system's own way to bring another plugin along: Claude Code installs it, keeps it
in its version range, and does not load cc-smart-dev-kit without it. The plugin's code reads the
list from `plugin.json` at build time (`DEPENDENCIES`), and `src/machine/companions.ts`
knows where each marketplace comes from.

Claude Code installs a dependency only from a marketplace the person added, and installs
the missing ones when that marketplace is added (both seen live). So `setup` adds a
missing marketplace with `claude plugin marketplace add`, which brings the companion;
with the marketplace there and the plugin gone, it runs `claude plugin install`. It never
turns on a companion the person turned off, and never updates one: it says what to run.
These are Claude Code's own commands on its own files, so `restore` does not undo them.
