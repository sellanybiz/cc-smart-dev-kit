---
id: "T-ixwrwd"
title: "Workflows refuse their arguments when started directly (audit-run got \"area\")"
kind: "follow-up"
status: "done"
when: "now"
created: "2026-11-11"
closed: "2026-11-11"
from: "branch feat/model-menu-4-1"
evidence: "Fixed in 4.1.0 phase E (#244), merged 3fe07274 on feat/model-menu-4-1. Owner-run scan: all 17 past refusals were argument shape, now shown in each workflow's description."
---
Owner report 2026-11-12 (screenshot): "claude is failing most of the time to launch a workflow". Seen: another session ran `cc-smart-dev-kit:audit-run` with args {area: ...}; the script refused it: `unknown key "area"`, expected { target?, question?, tracks?, budget?, findingsPath? }.

Likely root cause (to prove first): Claude Code lists each plugin workflow as a skill of its own (`cc-smart-dev-kit:audit-run`, `review-split`, `research-sweep`) with only its meta.description. That description says "Audit an area for one class of defect", which invites an `area` key. The argument contract lives only in the calling skill (`plugin/skills/audit/SKILL.md` § 3), so a session that starts the workflow directly never sees it and guesses.

Fix direction: each workflow's meta.description names its argument object and points at its calling skill (/cc-smart-dev-kit:audit, review, research-first); check review-split.js and research-sweep.js the same way. Collect the other launch failures from saved transcripts (~/.claude/projects/**/*.jsonl, "refused its arguments" and other Workflow errors) before deciding, so "most of the time" is covered, not just this one key. Tests in src/workflows/.

## Log
- 2026-11-11 done: Fixed in 4.1.0 phase E (#244), merged 3fe07274 on feat/model-menu-4-1. Owner-run scan: all 17 past refusals were argument shape, now shown in each workflow's description.
