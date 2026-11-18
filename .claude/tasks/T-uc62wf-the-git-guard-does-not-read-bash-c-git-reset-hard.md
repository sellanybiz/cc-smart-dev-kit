---
id: "T-uc62wf"
title: "The git guard does not read `bash -c '\"$@\"' _ git reset --hard`"
kind: "follow-up"
status: "open"
when: "next-release"
created: "2026-11-18"
from: "branch worktree-heavy-queue-coverage"
---
Found by a review in the heavy-queue-coverage plan (2026-11-18); it was already this way before that plan. `bash -c '"$@"' _ git reset --hard` runs `git reset --hard` (the -c script expands its positional arguments, $1… after the `_` that becomes $0), but src/shell/command.ts reads the -c script `"$@"` as a computed program with no words and never reads the positional arguments, so the git guard is silent. Fix in the one reader: when a shell's -c script expands "$@", "$*", $1… as its program, read the positional arguments after $0 as the command (both ways when the script is more than that). A row in git-guard.test.ts "a shell wrapper's inner command is read" must fail first.