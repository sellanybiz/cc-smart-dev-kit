---
id: "T-knyiw7"
title: "Portal: show the 7-day usage window"
kind: "follow-up"
status: "open"
when: "next-release"
created: "2026-11-05"
from: "branch worktree-smarter-claude-2-2"
---
2.2.0 extended `src/cli/usage-window.ts` with `sevenDay` (from the status line's `rate_limits.seven_day`). The portal reads the file (`src/portal/facts.ts`, `src/portal/api/data.ts`) but shows only the 5-hour window. Show the 7-day window beside it, from the same reader; a missing window shows nothing. Found at the B2 review, 2026-11-05.