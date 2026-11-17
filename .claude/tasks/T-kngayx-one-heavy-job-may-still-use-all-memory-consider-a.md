---
id: "T-kngayx"
title: "One heavy job may still use all memory: consider a per-job memory cap"
kind: "follow-up"
status: "open"
when: "any"
created: "2026-11-17"
from: "branch worktree-heavy-queue-coverage"
---
The queue caps how many full runs go at once, not what one run uses (docs/jobs.md § Limits). 2.0 removed memory checks on purpose; revisit with evidence before adding any cap. Raised 2026-11-18.