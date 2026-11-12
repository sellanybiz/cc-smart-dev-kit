---
id: "T-66wnpy"
title: "Ask hc upstream for `hc keys --if-turn` (herdr answer's last race window)"
kind: "follow-up"
status: "open"
when: "any"
weight: "owner"
created: "2026-11-12"
from: "branch fix/herdr-4.3.1"
---
Owner decision on #273 item 10 (2026-11-12): `herdr answer` re-checks the child's status msg, turn, options and cursor right before `hc keys`, but hc keys has no expected-turn guard of its own, so a prompt that appears in that millisecond window could get the keys. Ask Herdr/hc's maintainers for a guard such as `hc keys <t> --if-turn <n>` (or `--if-msg`), like `hc send --if`. When it exists, pass it from answer (src/herdr/command.ts, the hcKeys call) and raise MIN_HC_VERSION in src/herdr/hc.ts. Filing the request is an outward action: the owner files it or says where.