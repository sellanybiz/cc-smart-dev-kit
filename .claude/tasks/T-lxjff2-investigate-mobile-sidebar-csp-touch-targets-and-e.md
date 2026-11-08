---
id: "T-lxjff2"
title: "Investigate mobile sidebar CSP, touch targets and Escape behavior"
kind: "follow-up"
status: "open"
created: "2026-11-08"
from: "branch worktree-agent-ad926290a71e9513f"
---
Observed during isolated rebuilt portal mock UI verification, not established as a new defect from removal change. Opening mobile Sidebar emitted inline-style CSP violation; dialog appeared. Ten navigation links measured275.5x32px at390x844 (below44px guideline); first Escape left dialog, second closed; focus restoration unproved. Investigate source attribution and baseline reproduction before fixing. Preserve strict portal CSP; do not add unsafe-inline. Also favicon404 observed. Evidence in task186 UI Report; screenshots in session scratchpad. Removal checks passed six routes/five breakpoints/no overflow/no Needs/Warp/settings sends. No live-state mutation or native behavior tested.