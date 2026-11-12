---
id: "T-ktucun"
title: "Worktree path has six homes and ignores a project's own WorktreeCreate hook; macOS ps may miss processes without a terminal"
kind: "follow-up"
status: "open"
when: "next-release"
created: "2026-11-12"
from: "phase B review of plan herdr-orchestration (#267), § Outside this change"
---
Two gaps found by phase B's review on 2026-11-12. Both are outside the Herdr plan.

1. The path `join(repo, ".claude", "worktrees", name)` is built in six places: scan, scan-parked, saved-sessions, propose, live-check, and herdr. It needs one home. A project with its own WorktreeCreate hook puts `claude -w` worktrees elsewhere (see the `docs/claude-code-contract.md` row "A project's WorktreeCreate and a plugin's both run"). So the recorded worktree and the collision checks point at the wrong folder there.
2. `runningPrograms` (`src/worktrees/machine-facts.ts`) runs `ps -ww -o pid=,ppid=,args=` without `-A` or `-x`. On macOS, plain `ps` lists only processes that have a controlling terminal. So the Herdr identity walk may refuse there, and the worktree cleaner may miss processes that are in use. Not proved: no macOS machine was at hand. Prove it on macOS, then fix it.