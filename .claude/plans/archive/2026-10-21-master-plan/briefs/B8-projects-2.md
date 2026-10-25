# B8 round 2 — build from the hand-off

## How to read (this phase already burned two sessions on reading)
Your context starts at about 65,000 tokens before you read anything, and you hand off at 70%. So: **read the hand-off report(s) named below first — they are short and hold the facts**; do NOT read again anything they list as done; open only the functions you change, by line range (`grep -n` to find them, then `sed -n <a>,<b>p`); never open README.md or docs/design.md whole — `grep -n` the one section you update and read only its lines. Start building within your first few steps; commit at each green step.

**Hand-off report to read first:** `~/.claude/cc-smart-dev-kit/crew/<repo id>/reports/B8-projects-63e2a0.json`. The goal, files and done-check are those of `.claude/plans/2026-10-21-master-plan/briefs/B8-projects.md` (Settings → Projects (the brief b8.md's goal)): read only its Goal, Build, Files and Done-check sections, **not** its Read-first list (your predecessor read it; the facts are in the report).
