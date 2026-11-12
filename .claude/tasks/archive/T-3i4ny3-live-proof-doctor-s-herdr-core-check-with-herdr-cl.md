---
id: "T-3i4ny3"
title: "Live proof: doctor's Herdr core check with Herdr closed"
kind: "follow-up"
status: "done"
when: "any"
created: "2026-11-12"
closed: "2026-11-12"
from: "branch fix/uncommitted-on-base"
evidence: "2026-11-12, kit 4.4.1, run outside Herdr. With the app and core running (no sessions): doctor's Herdr group printed \"core not checked (hc does not document a no-start status read)\" — by design (docs/design/herdr.md: doctor never probes the core, since a read could start it). With Herdr fully quit (pgrep: no herdr process before): doctor finished in 10s, same Herdr note, and pgrep found no herdr process after, so doctor did not start the core and did not hang. The task's original expectation (\"core not reachable\" warning) was wrong; the design is the note. Doctor's exit 1 came only from the unrelated project-task lines (9 missed-release, 2 broken-ref)."
---
The last open live proof from the Herdr session-orchestration work (plan 2026-11-12-herdr-orchestration, task #273 item 11). Every other proof passed on 4.4.1.

Steps, at a quiet time (closing Herdr ends every session inside it): close the Herdr app fully, open a plain terminal outside Herdr, run `cc-smart-dev-kit doctor`, and read the Herdr group. Expected: the core check says Herdr's core is not reachable, as a warning with its fix line (start Herdr), not a crash or a hang, and the other groups still print. Then reopen Herdr and run doctor again: the core check passes.

Done when: both runs are seen and recorded here; a wrong result becomes a bug fix with a test.

## Log
- 2026-11-12 done: 2026-11-12, kit 4.4.1, run outside Herdr. With the app and core running (no sessions): doctor's Herdr group printed "core not checked (hc does not document a no-start status read)" — by design (docs/design/herdr.md: doctor never probes the core, since a read could start it). With Herdr fully quit (pgrep: no herdr process before): doctor finished in 10s, same Herdr note, and pgrep found no herdr process after, so doctor did not start the core and did not hang. The task's original expectation ("core not reachable" warning) was wrong; the design is the note. Doctor's exit 1 came only from the unrelated project-task lines (9 missed-release, 2 broken-ref).
