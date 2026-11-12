---
id: "T-cm3mrt"
title: "Parked detached worktrees: one parked test for the verdict and the removal"
kind: "follow-up"
status: "open"
when: "next-release"
created: "2026-11-12"
from: "branch fix/uncommitted-on-base"
refs: ["src/worktrees/scan.ts","src/worktrees/scan-parked.ts"]
---
The verdict counts a folder as parked only when it is on a branch (`src/worktrees/scan.ts`, `isParkedWorktree(listed.path) && listed.branch !== null`), while `removeWorktree` uses the folder name alone (`alreadyParked = isParkedWorktree(listed.path)`). A detached worktree that a removal really stopped halfway in therefore counts the removal's own deletions as unsaved, so it is kept forever. No bytes are lost; this was already true before 4.5.1. Fix: one shared helper for "parked", and drop the branch condition if a detached parked folder is safe to judge the same way (check why the branch condition was added, D62). Found by the 4.5.1 re-review.