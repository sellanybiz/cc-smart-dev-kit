---
id: "T-425mbb"
title: "Tests can still write to the real home: the preload should point HOME at a temp folder"
kind: "follow-up"
status: "open"
when: "now"
created: "2026-11-11"
from: "branch feat/model-menu-4-1"
---
2026-11-12, during 4.1.0 phase B: a new test called `cliPaths(home)` with a string instead of an env object. TypeScript flagged it, but `bun test` ran it first: at run time the string has no HOME, so the paths fell back to the real home folder (`os.homedir()`), and the test wrote two made-up rows (session "s-1") into the real router history (~/.local/state/cc-smart-dev-kit/history.db). Cleanup is with the owner.

The rule (.claude/rules/testing.md: never the real HOME) is only text. The port guard shows the pattern for a mechanical guard. Fix direction: the test preload (src/testing/setup.ts) sets HOME (and XDG_* / CLAUDE_CONFIG_DIR as needed) to a fresh temp folder before any test, so a path that falls back to the home folder lands in a temp folder; and/or cliPaths/routerPaths refuse a non-object argument. Prove it: a test that resolves the default paths with no env and checks they sit under the temp folder. Check subprocess tests (subprocessGuard env) get the same.