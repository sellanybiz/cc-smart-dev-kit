---
id: "T-uf4fo2"
title: "Task store lift: load the graph once when restoring holds, and skip a hold on an ancestor"
kind: "follow-up"
status: "open"
when: "any"
created: "2026-11-11"
from: "branch main"
---
Found in the 4.0.0 phase B round 3 review. Both are Low.

1. `repairTaskLayers` (src/tasks/work/db.ts, around line 149) calls `waitsForTask` for each restored hold. Each call reloads `allTasks` for the project, and `holdingUnder` rebuilds the children map for every node it visits (src/tasks/work/queries.ts:167-183, 309-325). All of it runs inside BEGIN IMMEDIATE. A large old store with deep nesting could make other writers hit their busy timeout. Fix: load the tasks once per project, keep the wait map in memory, and build the children map once.

2. A hunch, not run: take a hand-made old cycle B › phase › A, where A is non-blocking. After the lift, a restored hold can block A on its own ancestors (the phase, and B). Nothing deadlocks, but `addBlockers` refuses that same state ("it sits under it", src/tasks/work/store.ts:224-228). Fix: move the "sits under it" walk into the shared helper, so the lift and `addBlockers` both use it. Add a test with that store.