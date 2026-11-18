---
id: "T-b67hib"
title: "git-guard's 64 KB \"substitutions that never close\" test overflows the stack under full-suite load"
kind: "follow-up"
status: "open"
when: "next-release"
created: "2026-11-18"
from: "branch worktree-heavy-queue-coverage"
---
Two reviewers saw src/hooks/git-guard.test.ts › "a 64 KB command line is read within the guard's time › substitutions that never close" throw RangeError: Maximum call stack size exceeded in the shell reader (src/shell/command.ts, the read/readDouble recursion around the `"$(` nesting), in a full `bun test src/jobs src/hooks src/shell src/worktrees` run. It passes alone, and in `bun run check` on 2026-11-18. The heavy-queue-coverage plan noted this stack depth as an older issue: a guard falls back to asking through onCrash, so it is safe, but the test is flaky and a 64 KB line must stay linear (hooks.md). Root cause, not a bigger stack: make the nested reading iterative (an explicit stack), or cap the depth with a fail-closed answer, and prove it under full-suite load.