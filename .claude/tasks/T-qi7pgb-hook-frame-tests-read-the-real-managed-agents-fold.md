---
id: "T-qi7pgb"
title: "Hook-frame tests read the real managed agents folder: let runHook take injected paths"
kind: "follow-up"
status: "open"
when: "next-release"
created: "2026-11-04"
from: "branch worktree-smarter-claude-2-2"
---
Found in the 2.2.0 build (phase B1, #137). The agent guard reads Claude Code's managed agents folder (/etc/claude-code/.claude/agents on Linux) from CliPaths. Tests that call the guard directly pass a temp folder. But tests that run through `runHook` (src/hooks/fail-closed.test.ts, src/hooks/matrix.test.ts) still read the real folder, because `handleHook` builds its own paths from the environment. On a machine with managed agents those tests could flake (testing.md: temp folders only). Fix (the builder's recommendation, (b)): let `handleHook` (src/hooks/run.ts) and `runHook` (src/testing/hooks.ts) take injected CliPaths. Do NOT add an environment variable to move the folder: a project's settings `env` reaches the hook, so it would let a repo hide managed definitions from the guard.