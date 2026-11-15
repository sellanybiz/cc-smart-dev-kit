---
id: "T-enpt7a"
title: "Off Linux, give the caller a process start identity so a /clear keeps ownership and claims"
kind: "follow-up"
status: "open"
when: "any"
created: "2026-11-15"
from: "branch feat/plan-queue"
---
Found in the review of 4.9.0's store fix (#352). `callerOf` gives procStart null off Linux (src/tasks/work/identity.ts ~:103). `parseSessionRecord` does not read Windows records' `procStartFt` (src/hooks/sessions.ts ~:29; docs/claude-code-contract.md ~:62). `claimHeldBy` then falls back to session ids, so on Windows (and macOS, unless its records carry procStart, which is not proved) a /clear loses the task queue's ownership and a claim's tie to its process. Fix: read procStartFt on Windows, and a ps start time on macOS (prove the record fields live first, then add contract rows). Optional: also store the boot id so pid plus start ticks cannot repeat across a reboot.