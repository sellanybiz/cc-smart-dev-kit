---
id: "T-3i4ny3"
title: "Live proof: doctor's Herdr core check with Herdr closed"
kind: "follow-up"
status: "open"
when: "any"
created: "2026-11-12"
from: "branch fix/uncommitted-on-base"
---
The last open live proof from the Herdr session-orchestration work (plan 2026-11-12-herdr-orchestration, task #273 item 11). Every other proof passed on 4.4.1.

Steps, at a quiet time (closing Herdr ends every session inside it): close the Herdr app fully, open a plain terminal outside Herdr, run `cc-smart-dev-kit doctor`, and read the Herdr group. Expected: the core check says Herdr's core is not reachable, as a warning with its fix line (start Herdr), not a crash or a hang, and the other groups still print. Then reopen Herdr and run doctor again: the core check passes.

Done when: both runs are seen and recorded here; a wrong result becomes a bug fix with a test.