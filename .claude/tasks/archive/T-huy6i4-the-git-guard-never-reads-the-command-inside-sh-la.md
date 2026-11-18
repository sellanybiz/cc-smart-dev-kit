---
id: "T-huy6i4"
title: "The git guard never reads the command inside `sh <launcher> job run -- …`"
kind: "follow-up"
status: "done"
when: "next-release"
created: "2026-11-18"
closed: "2026-11-18"
from: "branch worktree-heavy-queue-coverage"
evidence: "Fixed on the plan branch in 9b70ed68 (heavy-queue-coverage), before release: nestedCommand's claiming branches (shells with a script, find/watch/su/parallel, cmd without /c, pwsh without -Command) fall back to the kit's job run through jobRunLine. Four git-guard rows (sh <launcher>, bash -x \"$HOME/…\", eval sh <launcher>, su root <launcher>) fail on the reader before the fix and pass after. bun test src/jobs src/hooks src/shell src/worktrees: 3555 pass, 0 fail."
---
Found by the final fix's re-review of heavy-queue-coverage (2026-11-18). It was already this way before that plan. In src/shell/command.ts nestedCommand, the shells branch (`sh`, `bash`…) returns undefined for `sh <launcher> job run -- X` before the kit's job-run branch is reached, so X is never read. The git guard is silent on `sh ~/.local/bin/cc-smart-dev-kit job run -- git reset --hard` (asked when spelled `cc-smart-dev-kit job run -- …`). classifyHeavyCommand also gives null for that spelling, unlike the other three kit spellings. The queued flag (isJobRun via kitArguments) is right. Fix in the one reader: when a shell's first operand is the kit's launcher (kitArguments recognises it), read the words after `--` the way the job-run branch does. A row in git-guard.test.ts "a shell wrapper's inner command is read" must fail first.

## Log
- 2026-11-18 done: Fixed on the plan branch in 9b70ed68 (heavy-queue-coverage), before release: nestedCommand's claiming branches (shells with a script, find/watch/su/parallel, cmd without /c, pwsh without -Command) fall back to the kit's job run through jobRunLine. Four git-guard rows (sh <launcher>, bash -x "$HOME/…", eval sh <launcher>, su root <launcher>) fail on the reader before the fix and pass after. bun test src/jobs src/hooks src/shell src/worktrees: 3555 pass, 0 fail.
