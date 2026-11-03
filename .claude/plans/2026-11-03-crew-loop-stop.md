# Plan: stop the crew's repair and diagnosis loops (1.12.0)

## Summary

On a loaded machine the kit's own defaults turn finished work into "failed". Leads on backend
models then answer each "failed" with another diagnostic phase. This release fixes the four
causes at their source:

- the full suite starves at idle CPU;
- a no-code phase has no honest `done`;
- nothing stops a repeat of a diagnosis that already concluded;
- the load gate watches a number that dips.

The lead and crew skills also get exact rules a literal model can follow.

## Context: what the server showed (2026-11-03, read-only)

- **Seven leads, 110 crew sessions started today; 42 are `failed` now.** 106 of the 110 ran on
  the `gpt-6.1-sol` backend (80 on the sonnet slot, 26 on the opus slot). 4 ran on Claude Opus.
- **"repair" and "diagnosis" are phase names the leads chose.** Examples: `root-repair` ×4,
  `repair-gate-review` ×3, `FU-C-D` → `D2` → `D3`, `8diag`/`8tax`/`8help`, and
  `GATE-SIG`/`GATE-EXT`/`GATE-CAP` → `LIFE-SIG`/`LIFE-EXT`.
- **The sweep found 7 candidate diagnosis chains, 19 sessions in all.** For example, `tool-doors`
  ran `FU-C-D`, `D2` and `D3` in about two hours.
  - D2: "original timeout did not reproduce".
  - D3: "Both tests passed; earlier timeout did not reproduce."
  - `agent-harness-v2`: "One unchanged two-file batch and one instrumented experiment both passed
    20/20", then two more phases.
- **At least 6 crew sessions only reviewed or verified another phase.** One said: "Resumed only
  the required independent review on exact unchanged commit …". The lead skill says such a
  review runs from the lead's own reviewer agent (§ 6), not from a crew session.

**Cause 1: the kit starves its own suite.**

- The heavy-job slice has `cpu.idle = 1`. That is the Linux default, `DEFAULT_CPU_WEIGHT = "idle"`
  (`src/jobs/config.ts:67`). Checked on the server's cgroup.
- A queued full suite gets CPU only when nothing else wants it. About 100 Claude processes and the
  targeted runs always want it: those runs are light-lane, `choom` only, at normal priority
  (`src/jobs/launch.ts:99`).
- So the suite times out, and the same files "pass alone". From the summaries: "seven unrelated
  timeout failures", "passed 20/20", "83/83".

**Cause 2: no honest done for a no-code phase.**

- `doneReportRefusal` (`src/crew/report.ts:329`) refuses `done` without `tests.full`.
- So a design-only, review-only or diagnosis-only phase reports `failed`. Quotes:
  - "Design deliverable complete, but report status failed solely because kit refuses done
    without tests.full";
  - "administrative done-report guard cannot represent the brief's explicit not_run design-only
    suite exemption";
  - "Review work completed, but done hand-back refused by generic whole-suite guard".

**Cause 3: nothing remembers a concluded diagnosis.** A lead reads `failed` and starts a
diagnosis. The answer is "did not reproduce", and the lead starts another on the same files.

**Cause 4: the load gate reads a number that dips.**

- `placeFor` (`src/crew/places.ts:297`) holds a start only while the **1-minute** load is above
  cores × `crew.loadPerCore`. The default is 1.5, so 24 on 16 cores.
- The server's 5-minute load sat at 27–31 while the 1-minute one dipped to 11–21, so starts went
  through.
- The server's own caps: `perLead 4`, `max 12`, `maxJobs 3`. It sets neither `loadPerCore` nor
  `cpuWeight`, so the new defaults reach it with the update.

## Decisions (the person, 2026-11-03)

- **Heavy jobs' CPU default:** a low real weight, **20**, instead of `idle`. A machine with its own
  `cpuWeight` keeps it, and `job set cpu-weight idle` still works.
- **A timeout-only full run** whose failed files pass when re-run alone **is accepted as `done`**.
  The watch and the board label it.
- **A concluded diagnosis:** `crew start` **refuses** a repeat on the same files or phase within 24
  hours, unless the lead passes `--again "<what is new>"`.
- **Load gate:** it holds on the **higher of the 1- and 5-minute** averages. The default
  `loadPerCore` becomes **1.0**.
- **Not a major change, so no play-safe or go-new choice:** every new report field is optional,
  and an old report still reads.

## Approach

### A. The full suite gets real CPU (cause 1)

- `src/jobs/config.ts`: `DEFAULT_CPU_WEIGHT` becomes `20`. `idle` stays a value the person can
  set, and the fallback of 10 stays for it.
- **`launch.ts` already sets the weights on each launch** (`set-property --runtime`, line ~283).
- **Prove live:** setting a number on a slice that is now `idle` clears `cpu.idle`, on this
  machine's systemd. If it does not, the launch also clears it (`CPUWeight=` first). Check
  `/sys/fs/cgroup/.../cpu.idle`.
- Update every text that names the default:
  - `job status`'s CPU line (`src/jobs/status.ts`);
  - the doctor line, if one names it;
  - `docs/jobs.md` (the prose at line ~519, the table at line ~594 and the sample at line ~623);
  - `docs/design/jobs.md:40`;
  - README's row.

### B. An honest done for a phase that changes no code (cause 2)

- **The field.** `tests.full` (`src/crew/report.ts:107`) also takes `{ "notRun": "<why>" }`.
- **The gate.** `doneReportRefusal` gets the branch's changed paths (`reportFacts` already reads
  `diff.paths`).
  - It accepts `notRun` only when the diff changes no file, or only Markdown files
    (`.md`, `.mdx`).
  - With any other file changed, the refusal names that file and says it needs the suite.
  - A deleted or renamed code file counts as a code change. Check that `diffAgainstBase` lists
    both sides.
- **The labels.** Wherever the suite is shown, the line reads `suite not run: <why>`, never green:
  - `runs.ts:391` (`wholeSuite`: a third value, not `true`);
  - the watch's hand-back line, the board and the portal's API.

### C. Timeouts under load, labelled and proved (cause 1, the report side)

- **The fields.** `tests.full` may carry `timeouts: string[]`, the files whose tests timed out.
  `tests.rerun` is one test run of those files alone.
- **`done` is accepted when all of these hold:**
  - `full.failed > 0`;
  - every failure is in a listed file (the count given is `full.failed`);
  - `rerun.ok` and `rerun.failed === 0`;
  - each listed file appears as a word in `rerun.command`.
- **The refusal names whichever part is missing.**
- **The lead sees** `suite: N timeouts in M files, passed alone` in the watch line and on the
  board. With A, this should be rare.

### D. A concluded diagnosis is not repeated (cause 3)

- **The field.** The report gets `diagnosis: { outcome: "not-reproduced" | "not-a-code-bug" |
  "root-cause" | "fixed", detail }`.
- **What triggers the refusal.** `crew start` refuses a new phase of the **same lead and repo**
  when an earlier crew session of that lead, ended within `DIAGNOSIS_HOLD_HOURS` (24), meets both:
  - it is the same `--phase`, or its `--files` overlap the new one's (`filesOverlap`,
    `src/crew/start.ts:1234`);
  - its report has the outcome `not-reproduced` or `not-a-code-bug`. A report with no field
    counts too when its summary matches one phrase list (`did not reproduce`, `not reproduced`,
    `could not reproduce`, `passes alone`, `passed alone`), kept in one constant.
- **What the refusal says.** It quotes the earlier crew session's name, its time and its answer
  (capped). Its fix line: "that answer stands; start again only with `--again "<what is new>"`".
  `--again` is kept on the new record, so the next refusal can quote it.
- **The source.** The watch removes a merged record (`crew rm`), so the guard reads the store's
  records **and** the lead plan's `runs/<crew id>.json` (`src/crew/runs.ts`). The builder first
  checks which fields a run file keeps (report summary, phase, files, outcome), and adds what is
  missing to the run file in the same phase.

### E. The load gate reads the steady load (cause 4)

- `src/machine/load.ts`: `LoadReading` gets `fiveMinute`, and `machineLoad` reads both averages.
- `placeFor` judges `Math.max(oneMinute, fiveMinute)` against the limit, so a dip no longer opens
  the gate while the machine is full. The hold line names both numbers.
- `src/workflow/schema.ts:438`: the default `loadPerCore` becomes 1.0. The minimum version in
  `src/project/config.ts:123` does not change.
- The continuation rule (D70) and Windows (no load average) stay as they are.
- Docs: `docs/design/crew.md:388` and README:2734.

### F. Rules a literal model can follow

- **`plugin/skills/lead/SKILL.md` § 6, "`failed` or `blocked`":** a table, from what the report
  says to what you do.

  | The report says | You do |
  |---|---|
  | the suite `notRun`, with a no-code diff | treat it as done and merge |
  | `timeouts` that passed alone | merge |
  | a real failure | a corrected brief, once |
  | `diagnosis` `not-reproduced` / `not-a-code-bug` | that is the answer: no new phase |
  | a review of fixes is needed | run the reviewer agent yourself, never a crew session |

  Two more rules:
  - one root-cause hunt per failure, at `--effort xhigh`;
  - `crew start` refused with an earlier diagnosis: do not pass `--again` unless you have a new
    fact, and name it.
- **`plugin/skills/crew/SKILL.md` § 4:** how to report `notRun`, `timeouts` with `rerun`, and
  `diagnosis`, with a JSON example each. The skill names the class each one is for, and that a
  `failed` report is only for work not done.
- **`check:duplicates` and the sizes:** the rules-maintainer keeps one home per rule.

## Edge cases (walked against the review axes)

- **Old reports, and old code still running from an old version folder.** All new fields are
  optional. A run file without them reads as before.
- **`notRun` on a code diff:** refused, and the file is named. Markdown inside `.claude/`
  (skills, rules) counts as no code, which is right: they have no suite.
- **A model that fakes `timeouts` or `rerun`:** it is the same trust as every other field. The
  command checks the shape and that each file is in the re-run. The lead sees the label, and
  merge-check and the integration review stay.
- **Diagnosis guard, false positive** (the phrase is matched, but the new phase is real work):
  `--again` passes in one flag, and the refusal says how. **No `--files` and a new phase id:** no
  guard. That is accepted: the skill rule covers it.
- **A queued phase:** the guard runs at `crew start`, before queueing, so a queued phase is
  checked once.
- **Load:** after a burst, the 5-minute reading keeps starts waiting a few minutes longer.
  Intended. A hand-off's next crew session is still never held by load.
- **CPU:** a machine that sets `cpuWeight: "idle"` keeps the old behaviour. On a systemd that
  refuses idle, nothing changes for the default (20 is a number).
- **Time zones:** the 24-hour window is computed from the ISO times in the records, in UTC.
- **Windows:** no load average, no slice. Unchanged.

## What could break (consumers)

- `ModelReport`/`HandBackReport` → `runs.ts`, `watch.ts`, `board.ts`, `src/portal/api/` (work,
  types), the portal's views where `wholeSuite` is shown. A builder greps `tests.full`,
  `wholeSuite` and `HandBackReport` and updates each one.
- `LoadReading` → `places.ts`, `crew list`'s line, and the jobs status line if it reads the load.
- `DEFAULT_CPU_WEIGHT` → `launch.ts`, `status.ts`, `set.ts`, and their tests.

## A simpler approach?

Only the skill rules (F) would have been less work, and today showed literal models do not hold
to prose. A alone would cut the timeouts, but it would leave no-code phases failing and nothing
stopping repeats. Each of A to E is a few lines at the one place that decides.

## Phases and waves

| Wave | Phase | Files | Owner |
|---|---|---|---|
| 0 | **P0 contract** | `src/crew/report.ts` schema (`notRun`, `timeouts`, `rerun`, `diagnosis`), `src/crew/store.ts` `HandBackReport` | me |
| 1 | **P1 report gate and labels** | `report.ts` gate, `runs.ts`, `watch.ts`, `board.ts`, `src/portal/api/*`, tests | `cc-smart-dev-kit:builder`, `sonnet`, high, worktree |
| 1 | **P2 diagnosis guard** | `src/crew/start.ts`, `args.ts`, `usage.ts`, the run-file fields in `runs.ts` (only the fields it needs; tell P1 which), tests | `cc-smart-dev-kit:builder`, `sonnet`, xhigh, worktree |
| 1 | **P3 CPU and load** | `src/jobs/config.ts`, `status.ts`, `launch.ts` (only if the live proof needs it), `src/machine/load.ts`, `src/crew/places.ts`, `src/workflow/schema.ts`, tests | `cc-smart-dev-kit:builder`, `sonnet`, high, worktree |
| 1 | **P4 skills and docs** | `plugin/skills/lead/SKILL.md`, `plugin/skills/crew/SKILL.md`, `docs/design/crew.md`, `docs/design/jobs.md`, `docs/jobs.md`, README | `cc-smart-dev-kit:rules-maintainer`, `sonnet`, high, worktree |
| 2 | **Integration** | merges, the 1.12.0 bump in `plugin.json` and both installers, `bun run build`, CHANGELOG, live proofs, own review, second opinion | me |

- **The one shared file.** P1 and P2 both touch `runs.ts`. P2 adds only the run-file fields;
  P1 changes only how `wholeSuite` is shown. I merge the small conflict.
- **Each phase's done-check:** its targeted tests, seen failing first (with a mutation check),
  plus `bun run typecheck` and `bun run lint`.
- **The second opinion** is `cc-smart-dev-kit:reviewer` on `opus` at `xhigh`, once, on the whole
  change set: a release counts as risky. Every builder runs on the `sonnet` slot (`gpt-6.1-sol`),
  so Opus goes to the review alone.

## Rollback

- **No release needed:** each default can be undone on a machine with
  `cc-smart-dev-kit job set cpu-weight idle` and
  `cc-smart-dev-kit workflow set crew.loadPerCore 1.5`.
- **The code:** a new patch version that reverts, per the release skill. The new report fields
  are optional, so a revert breaks no stored report.

## How we prove it

- **Unit tests (expected values by hand):**
  - the done gate: `notRun` with 0 files, with only `.md` files, with one `.ts` file (refused, the
    file named), and with a deleted `.ts` file (refused);
  - timeouts: every rule's refusal, and the accept;
  - `placeFor` with 1-min 20 and 5-min 30 on 16 cores at 1.0 (held, both numbers named), and the
    continuation not held;
  - the diagnosis guard: same phase, overlapping files, a phrase-only summary, outside 24 hours
    (passes), `--again` (passes and is kept), another lead (passes), a removed record read from
    its run file;
  - the jobs default of 20, with an explicit `idle` kept.
- **The checks:** `bun run check`, both `claude plugin validate … --strict`,
  `cd portal && bun run test`, and `bun run check:portal` if the portal changed. `router.js` must
  not change.
- **Live, on this machine:** a heavy job launched after the update, with
  `cpu.idle = 0` and `cpu.weight = 20` read from the cgroup. A `crew report` through the real
  command in a temp repo, with a docs-only branch and `notRun` (accepted) and with a code branch
  (refused).
- **With the person, after the update reaches the server:** the next day's failed count and
  chains, measured with the same read-only scripts.

## Not in this release

- Crew sessions that hand off at about 400k tokens of context (two today). It becomes a project
  task to look at the hand-off threshold on backend models.
- Lead behaviour beyond these rules.
