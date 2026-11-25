# Plan: slop-followups (kit 6.6.0)

**Summary.** Close the six AI-slop gaps the app's code-quality audit found still open after 6.5.2,
in the owner's chosen form. Two small kit commands make the gaps mechanical: `workflow claims` (the
project's "one home" claims, and a diff that re-defines what one names) and `workflow slop` (a
running count of bypassed homes and drifted copies, and when a slop audit is due). The skills use
them, and a new reference shows how to set up the § 13 guards for any stack.

## Context

The audit session compared its feedback file (§§ 3.1, 3.7, 3.9, 4.3, 4.6) with the 6.3.0 → 6.5.2
diff. Every other item shipped in 6.4.0 and 6.5.0. I checked these six in the plugin:

| # | Feedback | What the plugin says today |
|---|---|---|
| 1 | [3.1] cross-feature at two | `core.md:101` and code-structure § 5: merely similar code waits for a third |
| 2 | [4.3] claims grep as a signal | § 11 names "a claim with no guard"; nothing hands claims to reviewers |
| 3 | [4.6] a running count | nothing counts bypassed-home or drifted-copy findings across plans |
| 4 | [3.7] a recurring slop audit | audit's slop preset is offered only after a review finds one (`build` § 6, `audit` § The slop preset) |
| 5 | [3.9] guard setup | § 13 says the project owns the guards; nothing helps a project get them |
| 6 | [3.9] a front-door gate per feature | § 13 lists it as a guard type only |

**The owner's ruling (AskUserQuestion, "Build my version"):** items 2–6 as asked; item 1 keeps the
third, and makes the second copy visible instead. Why not extract at two: two copies often only
look alike; a helper made too early grows a flag per caller, which § 11 already counts as slop.

## Approach

### A. `workflow claims` — the claims grep (item 2)

`cc-smart-dev-kit workflow claims [--base <ref>]`, read-only, always exit 0 (a signal, not a gate).

1. **Claims:** `git grep -n -i -E` over tracked files for the claim phrases: `the one home`,
   `the one place`, `one place for`, `the only place`, `single source of truth`, `one home for`,
   `the one rule`. The phrase list is one exported constant. Each hit's backticked words that look
   like identifiers are the **named symbols** (`` `formatPrice` `` in "the one home for prices is
   `formatPrice`"). A claim with no backticked name is still listed (the reviewer reads it).
2. **Hits:** with `--base` (default: the merge base with `origin/<default branch>`), read
   `git diff --unified=0 <base>...HEAD` added lines. A **hit** is an added line, in a file other
   than the claim's own file, that *defines* a named symbol: one regex per common form (`function
   X`, `const|let|var X =`, `class X`, `type X`, `interface X`, `def X`, `fn X`, `func X`,
   `X = (`), language-neutral and listed in one table.
3. **Output:** `Claims (N):` each `file:line — the phrase — names: a, b`; then `Re-defined in this
   diff (M):` each `file:line defines X, which <claim file:line> calls its one home`. Capped lists
   with "+K more" (the kit's usual cap). `--json` for the workflow script.

Home: `src/workflow/claims.ts` (+ test), dispatched from `src/workflow/commands.ts`. Git through
the existing runner the workflow module already uses; the default branch looked up, never assumed.

### B. `workflow slop` — the count and the cadence (items 3, 4)

A small record beside the review record: `<stateDir>/slop/<repoKey>.json` (reuse `repoKey`,
`atomicWrite`, `withLock` from `src/workflow/reviews.ts` and `src/setup/`), mode 0600, per repo,
machine-local like the review record.

- `workflow slop record --plan <slug> --bypassed <n> --drifted <n>`: the lead runs it when a plan
  closes. It stores `{plan, at, bypassed, drifted, areas}`; **areas come from the plan task's own
  file list** in the task store (each path cut to its first two segments), so the lead passes no
  paths. A second record for the same plan replaces the first (idempotent). It then prints the
  status line below.
- `workflow slop status [--json]`: plans closed since the last audit, their bypassed and drifted
  totals, the areas they touched, and **due** or not.
- `workflow slop audited [--area <path>]...`: the lead runs it after a slop audit; it starts the
  count again (areas named: only those; none: all).
- **Due** when either holds: the plans since the last audit reach `workflow.slopAudit.everyPlans`
  (new setting, default 5, `0` turns the cadence off), or the plan just recorded found a bypassed
  home or a drifted copy (today's trigger, kept). The status line says which, and names the areas.

Setting: `slopAudit.everyPlans` in `src/workflow/schema.ts` (one field, the same validation as the
other counts), shown by `workflow show`, settable with `workflow set`.

### C. Doctor and project init point at guard setup (item 5's "offered")

- `doctor`'s project checks (`src/cli/project-checks.ts`): a project with a `cc-smart-dev-kit.json`
  and no `Reuse signals` heading in `.claude/cc-smart-dev-kit/review.md` gets one info line (not a
  failure): no reuse guards yet, and how to get them (ask Claude: code-structure § 13).
- `project init` (`src/cli/project-init.ts`) prints the same hint as its last next step, from the
  same one sentence (one home: exported beside the doctor check).

### D. Instructions (items 1, 4, 5, 6, and wiring A and B in)

- **code-structure § 5:** a builder that writes merely similar code names the earlier copy on its
  `Homes:` line (`similar to <path:symbol>, not shared: <why>`); the third copy's author then sees
  two named copies and extracts. One sentence on why the kit waits for the third.
- **code-structure § 13:** the guards plus the claims command; a project without guards is offered
  setup once, as a plan of its own; points at the new reference.
- **New `plugin/skills/code-structure/references/guards.md`** (not always-on, so no context-budget
  cost): how to set up the four guards for the project's own stack — research the maintained tool
  for each (`research-first`; JS/TS examples, each checked against current docs when written:
  knip, jscpd, a size script, `no-restricted-imports` or dependency-cruiser); the ratchet and
  baselines; CI and pre-push; the `Reuse signals` heading; and the **front-door gate generated from
  the folders**: a script lists the feature folders and writes the import rule from that list, so
  a new feature gets its door rule without an edit. Nothing installed without the person's yes.
- **build § 6:** before each review round also run `workflow claims` and add it to `signals`; at
  plan close run `workflow slop record` and, when it says due, offer the slop audit on the areas it
  names (replacing today's offer sentence); after an audit, `workflow slop audited`.
- **review skill** (outside a plan): the main session runs `workflow claims` with the signals.
- **audit § The slop preset:** "Offer these runs" now reads the `workflow slop` status (cadence,
  areas); seed from `workflow slop status`.
- **review-split.js `reusePart`:** read the claims in `signals`; a diff that re-defines a claimed
  symbol is a finding; two `similar to` lines naming the same earlier copy is a finding ("third
  copy: extract now").
- **builder agent** (`plugin/agents/builder.md`): the `similar to` form of the Homes line.
- `core.md` unchanged (its "waits for a third" stays true); `rules-maintainer` unchanged
  (self-evolve covers it — the audit session's own "your call").

## Files to change

- Phase `signals`: `src/workflow/claims.ts`, `src/workflow/claims.test.ts`,
  `src/workflow/slop.ts`, `src/workflow/slop.test.ts`, `src/workflow/commands.ts`,
  `src/workflow/commands.test.ts`, `src/workflow/schema.ts`, `src/workflow/schema.test.ts`,
  `src/cli/project-checks.ts`, `src/cli/project-checks.test.ts`, `src/cli/project-init.ts`,
  `src/cli/project-init.test.ts`, `README.md`, `docs/design/workflow.md`.
- Phase `author`: `plugin/skills/code-structure/SKILL.md`,
  `plugin/skills/code-structure/references/guards.md` (new), `plugin/skills/build/SKILL.md`,
  `plugin/skills/review/SKILL.md`, `plugin/skills/audit/SKILL.md`, `plugin/agents/builder.md`,
  `plugin/workflows/review-split.js`, `src/workflows/review-split.test.ts`,
  `docs/design/instructions.md`.
- Main session (merge files): `plugin/.claude-plugin/plugin.json`, `install.sh`, `install.ps1`,
  `CHANGELOG.md`, `plugin/dist/`, the plan file's archive move.

## Contracts (written here, so both phases start at once)

```
cc-smart-dev-kit workflow claims [--base <ref>] [--json]
  --json: { claims: [{ file, line, phrase, names: string[] }],
            hits:   [{ file, line, name, claim: { file, line } }] }
cc-smart-dev-kit workflow slop record --plan <slug> --bypassed <n> --drifted <n>
cc-smart-dev-kit workflow slop status [--json]
  --json: { since: string|null, plans: [{ plan, at, bypassed, drifted, areas }],
            bypassed, drifted, areas: string[], due: boolean, why: string|null }
cc-smart-dev-kit workflow slop audited [--area <path>]...
setting: workflow.slopAudit.everyPlans (integer ≥ 0, default 5; 0 = cadence off)
```

## Patterns to follow

- The review record (`src/workflow/reviews.ts`): key, file, lock, atomic write, keep-newest cap.
- Command output (`.claude/rules/command-output.md`): one way to print, marks with words.
- Workflow settings (`schema.ts` groups like `fixesAfterReview`), shown by `workflow show`.
- Instructions: one home per rule (`check:duplicates`), budgets (`check:core-lines`,
  `check:context-budget`); the always-on budget is nearly full (2845 / 2851), so no new skill and
  no new skill description.

## Edge cases

- **No git, shallow clone, unknown default branch:** `claims` lists the claims and says why it
  read no diff (one line), exit 0. `--base` given: used as is; a bad ref is one error line.
- **Noisy claims:** phrases in generated or vendored files. Read tracked files only, and skip
  lockfiles and build output (`dist/`) through the kit's existing exclude list if one exists (the
  builder searches first), else one short list in `claims.ts`.
- **A name defined twice on purpose** (an overload, a re-export `export { X } from`): a re-export
  is not a definition; only the forms in the table count. Reviewers judge the rest.
- **Huge repos:** one `git grep` and one `git diff`; no per-file git calls (linear).
- **`slop record` for an unknown plan slug:** refused with the fix (the slug from `task_list`).
  Plan with no file list: areas empty, still counted.
- **Several machines:** the count is machine-local (like the review record); a team on several
  machines gets an audit offer per machine. Accepted; said in the design page.
- **Concurrent writers** (two leads close plans at once): the lock; a busy lock waits, then fails
  with its fix line.
- **Setting missing in an older project file:** default 5.
- **Away mode:** an offered audit is "ask first" today (audit § 2); away, the lead records a
  decision and does not start a paid audit run unasked — unchanged rule, stated where the offer is.
- **Neutrality:** no project or tool vendor is named beyond third-party tool names as examples in
  `guards.md` (exception 2 covers package coordinates; prose examples stay generic).

## What could break

- `workflow` subcommand parsing (`commands.ts`): new verbs must not change existing ones;
  `commands.test.ts` covers the old verbs.
- `workflow show`/`set` list settings from the schema; a new field appears in both (tests
  assert exact output — update them).
- review-split.js prompt text: `src/workflows/review-split.test.ts` asserts parts of it.
- No hook reads any of this; the router bundle is untouched (check `git diff --stat plugin/dist`).

## A simpler approach?

Pure instructions (grep by hand, count in task notes) would ship faster, but an LLM counting
plans across sessions and matching claims by eye is exactly the unguarded rule § 13 warns about.
The two commands are small, read-only or append-only, and testable.

## Rollback

Revert the release (a new version with the old behaviour). The slop record file is new and
unused by anything else; leaving it on a machine is harmless.

## How we prove it

- Unit tests with exact output: claims (phrases, named symbols, hits in other files only, no-diff
  path, re-export not a hit); slop (record, replace, due by count, due by finding, audited by
  area, setting 0, unknown plan refused, lock); doctor info line with and without the heading;
  init's hint; schema default and `workflow show`.
- Each new check seen red once.
- `bun run check`, both validates.
- Reviews (`/cc-smart-dev-kit:build` § 6): two review-split rounds; tracks: the commands (CLI +
  store), the instructions (accuracy against the commands, one home per rule, contradictions),
  plus spec and reuse; a final senior-engineer review if the fixes pass `fixesAfterReview`.
- Live: run `workflow claims` on this repo and on the app (read-only) and look at the output.

## Homes

- Reuses: `repoKey`, `atomicWrite`, `withLock` (review record), the workflow schema and
  `workflow show/set`, the task store's plan file list (`task_files`), the command output helpers,
  the git runner the workflow module uses, `cappedHookList`-style capping if a list helper exists
  for commands (builder searches).
- New homes: `src/workflow/claims.ts` (claim phrases + definition forms, one table each),
  `src/workflow/slop.ts` (the record and the due rule), the guard-setup hint sentence (exported
  beside the doctor check), `references/guards.md` (how to set up guards).
- Deletes: build § 6's and audit's separate "offer after a bypassed home" sentences, replaced by
  the `slop` status.
- Open plans checked: none in flight in this project.

## Phases and waves

- **Wave 1 (parallel, disjoint files):**
  - `signals` — Signals: the claims and slop commands, the setting, doctor/init hint.
    `cc-smart-dev-kit:builder`, sonnet, high.
  - `author` — Author: skills, reference, agent and review-split wiring.
    `cc-smart-dev-kit:rules-maintainer`, sonnet, high (works from the contracts above).
- **Main session:** merge both, version 6.6.0, CHANGELOG, build, archive this plan, two review
  rounds, full check, PR (merge on the owner's yes).

Self-check: no edge-case hunter or second plan read: the plan is two disjoint, additive phases
with no schema migration, hook or deploy path; the two review rounds cover it.
