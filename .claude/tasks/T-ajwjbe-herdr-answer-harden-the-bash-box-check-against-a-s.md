---
id: "T-ajwjbe"
title: "herdr answer: harden the Bash box check against a status/screen mismatch"
kind: "follow-up"
status: "open"
when: "any"
created: "2026-11-12"
from: "branch fix/herdr-4.3.3"
---
From the 4.3.3 review (src/herdr/command.ts). Both gaps need the status msg/turn and the screen to describe different commands; no trigger is proved (hunch), so this is hardening, not a bug fix.

1. boxShowsAction removes all whitespace, so msg `rm -rf ~/x` matches a box showing `rm -rf ~ /x`. It is the trade-off for wrapped lines. A stricter match would join box lines by the screen's wrap (a line that fills the box width joins with no space) and otherwise keep single spaces.
2. The re-read just before the keys compares only dialogOptions, not the box. A different Bash dialog with the same option labels passes if msg and turn also stay the same. Compare the parsed box too.

Done when: both are closed with tests that fail before the change, or one of them is shown unreachable and recorded in docs/design/herdr.md.