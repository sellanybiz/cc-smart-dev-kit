# Slop guards: make "is there already one?" a step, not a hope

**Summary.** An audit of a large app built through the kit found most of its defects were copies
of shared code that already existed. The kit says "one home", but no step proves the search, the
reviewer is kept to the diff, and the refuters are told sibling copies *refute* a finding. Plan 1
(`slop-guards`) adds a recorded search, a reuse review track, the project's own guard commands and
a slop audit preset. Plan 2 (`scale-capacity`, queued) adds capacity checks and sibling guards.

## Context

The source is an audit feedback file the person supplied (kept outside this repo; it names the
audited project, so no name or path from it goes into this repo — `.claude/rules/neutrality.md`).
Every claim about the kit was checked against `origin/main` (6.3.0), then re-checked by a
`Mode: plan-review` second read (opus, xhigh).

### What the feedback gets right (verified)

| Claim | Where in the kit |
|---|---|
| The builder gets "reuse before you write" in one clause, with no proof | `plugin/agents/builder.md:64-65` |
| The reviewer is pushed away from searching the repo | `plugin/agents/senior-engineer.md:66-73` (limits 2-4); the track prompt "read the code the diff touches" (`plugin/workflows/review-split.js:216`) |
| "Fix the class" stops at the plan's files | `plugin/skills/review/references/axes.md:39-41` |
| The § 11 slop list has no duplication item | `plugin/skills/code-structure/SKILL.md:133-161` |
| A general helper is placed in the first feature that needs it | `code-structure` § 6 (`:64` "keep it beside its callers") and § 7 (`:80` "scope it as narrowly as its use") say so |
| Most design findings rank as Suggestions, so a drifted copy does too | `axes.md:55-56` |
| A plan has no Homes section; plan-review never checks other open plans | `plugin/skills/plan-task/SKILL.md` § 3; `senior-engineer.md:62-65` |
| Plan review tracks are by area; none looks for copies | `plugin/skills/build/SKILL.md:185-191` |
| An audit is one class, two to four tracks | `plugin/skills/audit/SKILL.md:30-35` |
| Nothing in the kit names an unused-export, duplicate or size guard | no hit in `plugin/` or `README.md` |
| `performance-budget` has no capacity question | its § Before the change |

**Found by the second read, worse than the feedback says:** both refuter prompts say "A project
convention or sibling files with that shape refute it" (`review-split.js:284`,
`audit-run.js:142`; pinned by `src/workflows/review-split.test.ts:134` and
`src/workflows/audit-run.test.ts:129`), and `axes.md:54-55` says the same for design findings.
For a duplicate, sibling copies are the *evidence*. Today a refuter is told to throw it out.

### Where the feedback is partly wrong

- **"Wait for the third copy."** The kit already unifies *the same logic* at copy two
  (`core.md:100-102`, `code-structure` § 5). Only *merely similar* code waits. The failure is that
  nobody sees copy two, so the fix is detection (the person's decision).
- **"Search three ways."** `code-structure` § 3 already lists name, what it does and structure.
  Missing: the words it shows, shared layers first, and a record that the search ran.
- **"The design findings table needs a Trigger."** It has one (`axes.md:49`). Missing: concrete
  duplicate triggers, and a drifted copy ranked as a real defect.
- **"A claim is a test."** `self-evolve` says "instructions are advice; hooks are certain"
  (`:83`); missing is the rule for a "one home" claim in code.

### Not taken, and why

- **`project init` installs knip and jscpd.** JavaScript-only; the kit serves any stack. The
  project names its guard commands and the review runs them (the person's decision).
- **The review record counts "bypassed home" findings.** Hook code for a number nobody acts on.
  The build skill offers the slop audit when a plan's review found one instead.
- **Similar code in two features extracted at copy two.** Kept the third-copy wait (the person's
  decision); the reuse track and the Homes line catch copy two.
- **A rules-maintainer edit** for "a one-home rule needs its guard": `rules-maintainer` already
  loads `self-evolve`, so one home there.

## Decisions

1. Two plans, each its own pull request and minor release: `slop-guards` now, `scale-capacity`
   queued. They share `plan-task/SKILL.md` and `axes.md`, so plan 2 waits.
2. **The Homes line**, defined once in `code-structure` § 3. For every new export, one line under
   `Homes:` in the builder's `Report:`:
   `<name> (<kind>) — searched: <name>; <words it shows | n/a>; <a distinctive body line | n/a> — found: <paths | none> — why new: <reason>`.
   The kinds: function, component, hook, constant, type, schema, SQL function, error class. A
   props or arguments type is covered by its unit's line. A phase with no new export writes
   `Homes: none`. **Who checks it:** the lead checks every line is present at hand-back
   (build § 3, while the builder can still be resumed); the reuse track spot-checks the content.
   Outside a plan, the main session writes its own Homes lines into the second opinion's brief.
3. **Guards are the project's.** A new `code-structure` § 13 *Mechanical guards*, appended after
   § 12 so no section number moves: unused exports that count test-only use as unused, a
   duplicate detector, a file and function size ratchet, a front-door import lint. Each is a
   ratchet: the count may only go down. The project lists the commands in its review add-on
   (`.claude/cc-smart-dev-kit/review.md`) under a `Reuse signals` heading. The lead (or the main
   session outside a plan) runs them once and hands the output to the reviewers; no reviewer
   runs a repo-wide tool itself (`core.md:36-37`). No `cc-smart-dev-kit.json` field, no setup code.
4. **The reuse track is part of the `review-split` script**, like the spec track: two new args,
   `reuse?: boolean` (adds one track named `reuse`) and `signals?: string` (the `Reuse signals`
   output; every track gets it). The reuse track's prompt is its one home: search the repo three
   ways for each new export, literal over about 40 characters, user-facing sentence and helper
   body; with `spec` set, read the phases' `Report:` notes and spot-check their Homes lines; this
   brief allows more calls for those read-only searches (limit 4's own exception). The other
   tracks stay inside the limits. Its tier follows `risky`, like every track.
5. **The refuter sentence changes** in both scripts and in `axes.md` § Design findings: a sibling
   copy is a duplicate's evidence, never its excuse; only a written project rule refutes it.
   Worded differently in each script so `check:duplicates` passes.
6. **Work a plan needs outside its files.** An export the plan needs from another feature is in
   the plan: the lead adds that file to the plan's `files` with `task_update`, adds a step, and
   tells the person in one line. A guard whose file is outside the plan goes to the person (the
   one-plan rule).

## Plan 1 — `slop-guards`

### Approach, file by file

**Phase `author`** (how code gets written) — `rules-maintainer`, `sonnet`, `high`:

- `plugin/instructions/core.md` — the *One home* bullet points at the recorded search
  (`code-structure` § 3) and says where the main session records its Homes lines. Stays at most
  130 lines (now 129; `check:core-lines` warns above 130). The claim rule lives in § 11 only;
  `core.md:105` already points there.
- `plugin/skills/code-structure/SKILL.md`
  - § 3: add the words it shows and shared layers first; define the Homes line (decision 2).
  - § 5: an *identical* composite still follows § 7's "extract before shipping it twice"; a
    *merely similar* composite of shared UI parts goes to the shared UI layer when a third screen
    builds it.
  - § 6 (`:64`) and § 7 (`:80`, `:84`): keep narrow scope as the rule, with one exception — a
    helper with no feature words (a cursor, a page cut, a retry tail, a formatter) goes to the
    shared layer on its first write. Say it is placement, not a new layer, so § 2 still holds.
  - § 9: a folder is named for the concept it owns; test doubles and fixtures live in the
    project's test-support home, and product code never branches on one.
  - § 11 gains: a copy of something a shared layer exports; a hand-built composite of shared
    parts; per-feature copies of cross-cutting plumbing; an inline word rule when the project has
    a words home; code alive only through its tests; a `v1` left beside its `v2`; a "one home"
    claim in code with no guard; one mode switched on in three or more places.
  - § 12 item 2 points to § 3. New § 13 (decision 3).
- `plugin/agents/builder.md` — step 1: the § 3 search and the Homes line; step 5: grep the repo
  for each literal, sentence and helper body over about 40 characters it added; never mirror
  another feature's private helper — report it, so the lead exports it (decision 6).
- `plugin/skills/plan-task/SKILL.md` — § 3 becomes nine questions, adding **Homes** (shared pieces
  reused, new shared homes with paths, copies deleted); § 4 brief's patterns and tools names the
  homes to use; § 5 "Name contracts and dependencies": a new shared home is a contract, so two
  phases that would build the same one get one owner and a `blocked_by`; § 5 last wave: a `v2`
  with live `v1` callers gets its delete step; decision 6's path. Body stays at most 300 lines.
- `plugin/skills/build/SKILL.md` — § 3 hand-back: every Homes line present, else resume the
  builder; after each merge, grep the phase's new export *names* against the repo (catches two
  parallel phases exporting one name, not renamed copies); before round 1, run the project's
  `Reuse signals` once and save the output as a `Reuse signals:` note on the plan task; § 6
  passes `reuse: true` and `signals` for a code plan (a single-layer plan lets the reuse track
  replace the cross-layer track, so a round stays under the size guideline); a plan whose review
  found a bypassed home or drifted copy ends with an offer of the slop audit. Already 313 body
  lines, over the 300 target: the phase cuts or moves at least as much as it adds and names it.
- `plugin/skills/self-evolve/SKILL.md` — a rule that says "X has one home" comes with its test or
  lint, or is marked advice with the reason.

**Phase `review`** (how copies get caught) — `rules-maintainer`, `sonnet`, `high`:

- `plugin/agents/senior-engineer.md` — limit 3: a search of the repo for an existing home of
  what the diff adds is part of the review, not side work; limit 4: a brief that asks for that
  search allows more calls for it (the reuse track's does). `Mode: plan-review` checks the plan's
  Homes answer against the repo, and against other open plans: `task_list` scope project, then
  `task_get` their phase briefs (the store already refuses two plans on one path; this catches one
  concept at two paths).
- `plugin/skills/review/references/axes.md` — dimension 6 points at the reuse method (its home is
  decision 4's prompt for plans; for a single reviewer this dimension states it in one short
  paragraph, worded apart from the prompt); dimension 10: a bypassed home's fix also adds the
  guard that fails on the next one, inside the plan or to the person (decision 6); § Design
  findings: the refute line (decision 5), the concrete triggers (Nth copy with the drift shown, a
  composite K files build, feature-local plumbing core has, `v1` beside `v2`, a test as the only
  caller, a third mode switch, an unguarded claim — pointing at § 11, not repeating it), and a
  drifted copy users can see ranks Warning.
- `plugin/skills/review/SKILL.md` — § Second opinion: run `Reuse signals` once and put the output
  and the author's Homes lines in the brief; § A big change set: define the `reuse` and `signals`
  args.
- `plugin/skills/audit/SKILL.md` — a slop audit preset as ready-made runs, *one class each* so
  § 1 and `auditor.md` stay true: "duplication and bypassed homes", "dead code and `v1` beside
  `v2`", "structure, naming and oversized units"; tracks are the areas; one run per area for a
  large codebase; offered after a plan's review found a bypassed home.
- `README.md` § A project adds its own part: name the `Reuse signals` heading of the review
  add-on; the skills index line for audit if its description changes.

**Phase `workflow`** (the scripts) — `builder`, `sonnet`, `high`:

- `plugin/workflows/review-split.js` — the `reuse` and `signals` args (checked like the others),
  the reuse track and its prompt part, `signals` in every track's prompt, the refuter sentence.
- `plugin/workflows/audit-run.js` — the refuter sentence.
- `src/workflows/review-split.test.ts`, `src/workflows/audit-run.test.ts` — the new sentence; the
  args refused when wrong; `reuse: true` adds exactly one track and its prompt; `signals` reaches
  every track; no reuse track without the flag. Each test fails first.
- `docs/design/instructions.md` — its part on the review rounds and the refuters (`:196-234`,
  `:368-380`).

**Main session:** the release files (below) and the release (`release` skill).

### Files to change

`plugin/instructions/core.md`, `plugin/skills/code-structure/SKILL.md`, `plugin/agents/builder.md`,
`plugin/skills/plan-task/SKILL.md`, `plugin/skills/build/SKILL.md`,
`plugin/skills/self-evolve/SKILL.md`, `plugin/agents/senior-engineer.md`,
`plugin/skills/review/references/axes.md`, `plugin/skills/review/SKILL.md`,
`plugin/skills/audit/SKILL.md`, `README.md`, `plugin/workflows/review-split.js`,
`plugin/workflows/audit-run.js`, `src/workflows/review-split.test.ts`,
`src/workflows/audit-run.test.ts`, `docs/design/instructions.md`; plus the release files below.

### Waves

One wave: the three file sets are disjoint, and the contracts (the Homes line, the two args, the
§ 13 number) are fixed above. Each brief says a conflict found in another phase's files goes
under Follow-ups, unedited. `check:docs` does not check `§` references between skills, so after
all three merge the lead greps every new `§` reference and reads § 11 and the axes triggers side
by side.

### Patterns to follow

Plain short sentences; one home per rule, pointed to (`check:duplicates` fails a repeated
12-word sentence across `plugin/`, workflows included); neutral examples only; a section
reference by its heading. Workflow args follow the existing `CHECKS` table in each script.

### Edge cases

- **core.md budget:** at most 130 lines.
- **Skill budgets:** build must not grow past its 313 body lines; plan-task stays at most 300.
- **Duplicate sentences:** § 11, the axes triggers, the reuse prompt and the single reviewer's
  paragraph describe the same patterns: each points or is worded apart.
- **The refuter change** must not let every design finding through: a written project rule still
  refutes, and a narrow trigger still ranks Suggestion.
- **Report noise:** `n/a` fields and `Homes: none` keep it short; a props type rides on its unit.
- **No `Reuse signals`:** the review says so in one line and goes on.
- **Agent count:** plan rounds run `risky: true` (opus, xhigh); a reuse track is one more agent,
  so fewer findings get refuted and more land under Unchecked for the lead. Stated in build § 6.
- **Old callers of the scripts:** both new args are optional; a call without them runs as today.
- **Review record:** the reuse track is a `Mode: review` track, so the record is unchanged.
- **Neutrality:** no name or path from the audited project in any file, the changelog or a commit.

### What could break

Every session loads `core.md`; every builder `builder.md` and `code-structure`; every review
`senior-engineer.md`, `axes.md` and the refuter prompts. A contradiction (limit 3 against the
reuse search, § 7 against shared-on-first-write) makes reviewers inconsistent: the round 1 tracks
look for it.

### A simpler approach?

Only rewording § 3 and § 11 was the minimum. Rejected: the audit shows rules that relied on
judgment held nowhere, while every rule with a mechanical guard held. The refuter fix, the
recorded search, the reuse track and the project's guards are the smallest set that adds a check.

### Rollback

Revert the pull request; the release skill's rollback ships the previous version.

### How we prove it

- `bun test src/workflows` (the new tests fail first), then the full `bun run check` and both
  `claude plugin validate … --strict`, once, in the main session.
- Each phase: `check:duplicates`, `check:docs`, `check:neutral`, `check:core-lines`, lint.
- Live, by the person: a builder's report shows a `Homes:` section; `/cc-smart-dev-kit:review` on
  a diff that re-adds an existing helper reports the reuse finding and a refuter confirms it.
- The plan's two `review-split` rounds (`risky: true`; instruction tracks: accuracy against the
  code, one home per rule, contradictions; plus the workflow scripts' track), and the final
  review only if round 2's fixes are big.

## Plan 2 (queued) — `scale-capacity`

Waits for plan 1's merge (shared files). One phase `capacity`, `rules-maintainer`, `sonnet`,
`high`:

- `plan-task` § 3: a plan that adds a queue, a cap, a per-event read, a notifying trigger, a row
  lock or an append-only table answers **Capacity**: cost per user and per event, and the scale
  where it bites. Plan-review checks it.
- `axes.md` dimension 2: the scale class (a global cap with no stated limit; interactive work in
  a bulk lane; no per-tenant fairness; per-event fan-out of reads; a lock held across a read; no
  lock timeout; a hot index; a tenant-blind index; a table that only grows). Dimensions 3 and 10:
  a change that adds a guard to a shared-looking pattern searches the sibling features; hits
  outside the plan go to the person.
- `performance-budget`: a backend section (connection budget, queue caps, fan-out, herds after a
  restart, growth and retention, scale tests with many tenants) and a project capacity page.
- `react-best-practices`: checks a project can adopt (a virtualizer or an allow-list for long
  lists, render-count tests for high-frequency frames, a context never mixing fast state with
  stable actions, the compiler lint flag — confirmed in current React Compiler docs first).

## Release files

`plugin/.claude-plugin/plugin.json`, `install.sh`, `install.ps1`, `CHANGELOG.md` and `plugin/dist/`
are the project's `plans.mergeFiles`: builders never touch them; the lead bumps, builds and
writes the changelog after the last phase merges (`.claude/cc-smart-dev-kit/build.md`).
