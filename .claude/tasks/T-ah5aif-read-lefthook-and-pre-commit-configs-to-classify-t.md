---
id: "T-ah5aif"
title: "Read lefthook and pre-commit configs to classify their git hooks"
kind: "follow-up"
status: "open"
when: "any"
created: "2026-11-17"
from: "branch worktree-heavy-queue-coverage"
---
lefthook and pre-commit (python) keep hook commands in YAML; the kit has no YAML parser (runtime deps fixed), so their hooks count as light unless a project kind matches the manager call. Decide whether a dependency or a narrow reader is worth it. From heavy-queue-coverage, 2026-11-18.