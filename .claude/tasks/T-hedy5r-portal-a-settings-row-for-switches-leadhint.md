---
id: "T-hedy5r"
title: "Portal: a Settings row for switches.leadHint"
kind: "follow-up"
status: "open"
when: "next-release"
created: "2026-11-05"
from: "branch worktree-smarter-claude-2-2"
---
2.2.0 added `switches.leadHint` (the person's own workflow.json, on by default; `resolve.ts` leadHintFrom). The portal's Settings page lists the other switches but not this one. Add its row from the same switch data the other rows use (never a second list), read-only or writable the same way `switches.statusLine` is. Found at the B2 review, 2026-11-05.