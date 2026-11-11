---
id: "T-palujr"
title: "Herdr after 4.2.0: a mod panel of kit sessions, hc wait --output with the job queue, hc templates for kit roles, raw remote hc exec through a reader wrapper"
kind: "follow-up"
status: "open"
when: "any"
created: "2026-11-11"
from: "plan herdr-orchestration (#249), § Not in this plan"
---
Left out of the 4.2.0 Herdr plan on purpose (plan `.claude/plans/2026-11-12-herdr-orchestration.md` § Not in this plan):
- A Herdr mod panel that lists the kit's sessions and tasks, read from the portal's JSON API.
- `hc wait --output` joined with the heavy-job queue, so a child's long build waits for its slot.
- hc templates for the kit's roles (builder, reviewer), if hc's template format settles.
- Raw remote `hc exec`. It needs `hc` treated as a reader wrapper, so every guard sees the inner command first. Until then the judge denies it.