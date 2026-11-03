---
id: "T-rg3k7x"
title: "Investigate gateway doctor test failing only in full suite"
kind: "follow-up"
status: "open"
created: "2026-11-03"
from: "branch worktree-heavy-job-concurrency"
refs: ["src/cli/gateway-cli.test.ts:1954"]
---
Full check during concurrency fix: src/cli/gateway-cli.test.ts:1954 test 'set up and running: the unit, the copy, the health page, the backend, each slot’s first target' failed with legacy migration/not-installed gateway state instead of configured gateway. Isolated named test passes. 7015 pass/8 skip/1 fail. Diagnose state/order contamination; do not weaken assertions or add retry. Outside heavy-job concurrency change.