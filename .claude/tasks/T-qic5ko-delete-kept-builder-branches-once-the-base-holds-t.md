---
id: "T-qic5ko"
title: "Delete kept builder branches once the base holds them"
kind: "follow-up"
status: "open"
when: "next-release"
created: "2026-11-12"
from: "branch main"
---
Since the worktree cleanup (plan worktree-cleanup, P3), a builder's folder is removed as soon as another live branch (its lead's plan branch) holds its commits, but its branch is kept until the base holds it — and nothing revisits that branch later (branch deletion runs only at removal, scan.ts deleteBranchOnRef, or when a gone worktree is forgotten). So `worktree-agent-*` branches pile up, one per phase. No work is lost and no disk is used, but the branch list grows. Fix idea (review of P3, 2026-11-12): on --clean and the auto-clean, revisit only the branches the removals recorded (or Claude Code's `worktree-*` branches that no worktree checks out) and delete each with deleteBranchOnRef against the base. Never sweep every local branch.