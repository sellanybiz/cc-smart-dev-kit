---
id: "T-2e7pa6"
title: "Vendored shadcn guide: keep npx shadcn@pin as the npm runner entry (runner patch turned it into bunx)"
kind: "follow-up"
status: "open"
when: "next-release"
created: "2026-11-16"
from: "branch feat/shadcn"
---
Final review of 4.10.0 (Low): plugin/skills/shadcn/SKILL.md:12 lists the runner by packageManager; the npx→bunx runner patch turned upstream's npm entry into a second bunx entry. Add a narrow exact-match table patch in scripts/vendor-skills.ts that keeps `npx shadcn@<pin>` for npm, with a test, then the person reruns the vendor script.