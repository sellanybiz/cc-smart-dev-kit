---
id: "T-fx5swq"
title: "task_get history prints [object Object] for a take's claim change"
kind: "follow-up"
status: "open"
when: "any"
created: "2026-11-15"
from: "branch feat/plan-queue"
---
Found by the 4.9.0 #355 builder. takeTasks (src/tasks/work/store.ts) records the `claim` change as objects ({pid, procStart, sessionId}), and the history formatter (src/tasks/work/history.ts) prints them as `[object Object]`. Format a claim the way the creator change is now formatted (#355 added wording for it). Add a test with the exact history text.