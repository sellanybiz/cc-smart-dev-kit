# IX2 — the 1.4.0 review's findings on what the kit reads from GitHub (1.4.0)

Your branch starts from `release-1.3.0`, the 1.4.0 release (version already 1.4.0; the lead owns
`plugin/.claude-plugin/plugin.json` and the installers' version lines — leave them). The plan:
`.claude/plans/2026-10-21-master-plan.md`, D67 and § Release 1.4.0 (planned as 1.3.0). Read
`docs/design/issues.md`, `.claude/rules/cc-smart-dev-kit-json.md`, `.claude/rules/hooks.md`
(§ Timeouts), `.claude/rules/command-output.md` and `.claude/rules/testing.md` first.

An Opus `xhigh` review of `release-1.2.1...release-1.3.0` found these; the lead checked the code
for 1, 2 and 3. Each fix comes with a test named after its finding, seen failing first.

## Medium

1. **Text GitHub hides from the person who adds the label still reaches the brief, unmarked**
   (`src/issues/pickup.ts:182-193`, `visibleText`). The design promises the text is made "as
   visible as it was to the person who labelled it" (`docs/design/issues.md` § A phase from an
   issue). Name, the way the HTML comment is named (`[hidden …: …]`): a link reference definition
   (a line matching `^ {0,3}\[[^\]]+\]:`, which CommonMark renders as nothing — `[//]: # (…)`), the
   content of the tags GitHub strips (`script`, `style`, `template`, and any other its sanitizer
   drops: research it, cite the source in a comment), and a numeric or named HTML entity of a
   hidden code point (`&#xE0049;`, `&#x202E;`, `&#8238;`), shown as `[U+XXXX]`. Visible markdown is
   left alone. A test per form, through `visibleText` and through the brief block.
2. **A session can choose which label counts as ready, and can turn the inbound feed on**
   (`src/workflow/schema.ts:533`, `OUTBOUND_KEYS`; `src/workflow/commands.ts` refuses `set`/`unset`
   inside Claude Code only for those keys). **The lead's decision:** `issues.readyLabel` and
   `issues.watch` join the refusal inside Claude Code — a session must never pick which issues are
   ready (D67: work starts only from an issue the person labelled), nor open the channel that puts
   outside text into the lead's context; `propose` stays open, as for the other two. Read
   `readyLabel` like `enabled`, from the person's file and the project's file as committed on the
   base, never a working copy (check where `pickIssue` reads it today; `watch` already is). Update
   the rule's row (`.claude/rules/cc-smart-dev-kit-json.md`, `workflow.issues`), the README's
   `issues.readyLabel` and `issues.watch` rows, and the design page.
3. **Every look writes one event per lead ever recorded** (`src/crew/watch.ts:536`, `deliver`
   loops over `listLeads(...).records`; lead records are never removed). Deliver only to the leads
   that can hear it: this lead, and the others whose watch is alive — use the liveness the store
   already has (the watch's lease or the lead's presence mark; find it, never a second one). A
   lead that comes back later starts silent, as a first look does. Test: ten old lead records, two
   live → events for two.
4. **The pass's GitHub budget only stops new calls; no call is cut short**
   (`src/issues/pending.ts:153-158`; `src/issues/fixed.ts:149,158` `openGate`, `markFixed`'s
   reads and writes; `src/issues/feed.ts:255-264` `kitAccount` with no time check). Give each `gh`
   call `min(its own timeout, deadline − now)` and skip it under about one second, as the merge
   guard's `GUARD_BUDGET_MS` does (`.claude/rules/hooks.md` § Timeouts). A write cut short says
   "may have been posted" and is checked before a retry (the marker already guards a double).
   Test with a fake `gh` that sleeps: the pass ends near its budget.
5. **The lead marks "fixed" whatever numbers a crew report names** (`src/crew/watch.ts:596`
   `queueIssueMarks`, `src/issues/phase-issues.ts:20-27`; `plugin/skills/lead/SKILL.md:246-250`).
   The design says the lead reads the report before the merge; the skill never asks it to check
   the numbers. Two parts: the lead skill's hand-back step says to check each reported issue
   number against the record's issue and the brief before the merge; and the watch, before it
   queues a mark, says one line for each number neither the record's issue nor the brief names
   ("#7 is not in the brief: not marked; mark it with …") and does not queue it. Say what the lead
   runs to mark one it agrees with (an existing command; add none unless nothing fits — then ask
   the lead first).

## Low

6. **A clock moved back silences the feed** (`src/issues/feed.ts:352,359,390,399`; a rate
   limit's `reset` comes from GitHub's clock, `:187-190`): treat `nextAt > now + max(interval, 1 h)`
   as due. Test with a moved clock.
7. **A failed state write repeats the same news every pass** (`feed.ts:378-381`): keep `nextAt`
   (and the cursor the delivery used) in the watch's memory when `writeIssueFeed` throws, so the
   next pass neither repeats the lines nor retries a rate-limited look at once. One line says the
   state could not be written, once per change.
8. **The README contradicts the lead skill on who adds the ready label** (`README.md` the
   `issues.readyLabel` row, about line 2609; `plugin/skills/lead/SKILL.md:123-126`): the kit's
   commands never add it; the lead adds it only for an issue you named, after the guard asks you.

## Files

`src/issues/pickup*`, `src/issues/feed*`, `src/issues/pending*`, `src/issues/fixed*` (the budget
only), `src/issues/phase-issues*`, `src/workflow/schema*`, `src/workflow/commands*`,
`src/workflow/resolve*` (only if `readyLabel`'s read needs it), `src/crew/watch*`,
`src/crew/store*` (only to read liveness, if no reader exists), `src/workflow/merge-check*` (only if
`runGh` needs a per-call timeout argument), `plugin/skills/lead/SKILL.md`,
`.claude/rules/cc-smart-dev-kit-json.md` (the `workflow.issues` row), `README.md` (the rows named
above), `docs/design/issues.md`, `docs/design/crew.md` (if it describes the feed's delivery),
`CHANGELOG.md` (one bullet under `## 1.4.0`'s fixes, plain words), `plugin/dist/*` and
`plugin/portal-ui/**` (only through `bun run build` / `bun run build:portal`, if the portal mirrors
the keys). Change nothing else. **Not yours:** `src/hooks/**`, `src/shell/**`,
`src/issues/screen*`, `src/issues/file*`, `src/issues/doctor*`, `src/issues/handback*`,
`src/setup/**` — another phase (IX1) owns them at the same time. If a fix needs one of them, ask
the lead.

## Done-check

The targeted tests (`bun test src/issues/ src/crew/watch.test.ts src/workflow/`), then `bun run
build`, then `bun run check`, both `claude plugin validate … --strict`, and `bun run check:portal`
if the portal changed. Your own review, then one second opinion (`cc-smart-dev-kit:reviewer`,
`opus`, `xhigh`: outside text reaching a model). Tests never touch the real `~/.claude`,
`~/.config`, `~/.local`, nor port 20100, and never call the real GitHub. Neutral: no names of a
company, person or machine, no home paths.
