---
id: "T-tgca4r"
title: "Queue git hooks on native Windows (the git prefix through Git for Windows' sh)"
kind: "follow-up"
status: "open"
when: "any"
created: "2026-11-17"
from: "branch worktree-heavy-queue-coverage"
---
The heavy-queue-coverage plan (2026-11-18) does not prefix git commands or install the kit's git hooks folder on native Windows. Prove the hook script through Git for Windows' sh and the .cmd launcher (docs/windows-setup.md, docs/windows-jobs.md), then turn it on there.