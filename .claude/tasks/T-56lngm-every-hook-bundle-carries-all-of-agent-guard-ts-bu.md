---
id: "T-56lngm"
title: "Every hook bundle carries all of agent-guard.ts: build GUARD_BUNDLES lazily, mark the package side-effect free"
kind: "follow-up"
status: "open"
when: "next-release"
created: "2026-11-05"
from: "branch worktree-smarter-claude-2-2"
---
Found in 2.2.0 (B1, #137). src/hooks/specs.ts builds GUARD_BUNDLES from HOOKS when the module loads, so every hook bundle and cli.js pull in all of agent-guard.ts and its imports. acorn could not be imported plainly in the reader because it would then land in about 22 bundles plus cli.js (a Bun.build probe showed it), so 2.2.0 injects the parser from src/entries/agent-guard.ts only (src/hooks/script-parser.ts); with no parser, every Workflow script is refused. The builder's probe showed the root fix: `"sideEffects": false` in package.json plus a lazily built GUARD_BUNDLES lets Bun drop the unused code, so every bundle shrinks. That changes every bundle (and must not change router.js: run manifest.test.ts's router check). After it, the parser may become a plain import, and the injection can go.