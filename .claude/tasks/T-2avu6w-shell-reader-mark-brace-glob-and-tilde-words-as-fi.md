---
id: "T-2avu6w"
title: "Shell reader: mark brace, glob and tilde words as filled"
kind: "follow-up"
status: "open"
when: "next-release"
created: "2026-11-12"
from: "branch fix/herdr-4.3.1"
---
Found in the 4.3.1 P1 review (#292). src/shell/command.ts (~741–767) marks `$`-expansions as filled but not brace (`{a,b}`), glob (`*`, `?`, `[…]`) or tilde (`~`) words. So a guard that relies on `filled` (the herdr answer judge since 4.3.1, the gh api guard) may quote text the shell changes before the program sees it. Example: `--expect 'approve Bash: '{rm,ls}` asks while showing the braces. Low risk for herdr answer (the msg must still match exactly), but fix it in the reader, per .claude/rules/hooks.md (one shell reader). Add reader tests and re-run the guard tests.