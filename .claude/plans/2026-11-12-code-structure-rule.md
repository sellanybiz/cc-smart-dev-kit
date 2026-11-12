# The code-structure rule: simple means clean and organized, not dumb code (task #241)

## Summary

- Rename the `extract-or-duplicate` skill to `code-structure` and widen it into the one home
  for how code is shaped: split by responsibility, helper vs service vs module, naming, files.
- Add the principle to `core.md` with no token growth, preload the skill in the `builder`, and
  teach every reviewer (review skill, senior engineer, split review, audit) how a design finding
  meets the evidence bar.
- Clean break on the old name (owner's choice): no fallback, no doctor check; release notes say
  what to rename.

## Context

The owner (2026-11-11/12): "A more important rule is needed for Claude: code simplicity, code
structure, file structure, naming… just like a senior company or developers manage it." And:
"simplicity means keep things clean and organized; it does not mean bad and dumb code."

The gap check and outside research are done and not redone:
`origin/main:.claude/plans/archive/2026-11-12-model-menu-4-1.md` § "Next plan (owner,
2026-11-11), not built here".

**Goal:** every session and every builder writes code a senior team would approve: complete and
robust, each unit with one nameable job, names that say what things are, files laid out by
concept. It also means no code built for needs that do not exist yet, and no tiny-function or
DRY-at-any-cost dogma.

## Decisions (owner, this session)

| Decision | Choice |
|---|---|
| Rule's home | **Rename** `extract-or-duplicate` → `code-structure` |
| Old name | **Clean break, no doctor check.** The skill reads only `code-structure.md`; the release notes say what to rename, and in which order |
| Builder | **Preload** the skill (`skills:`), about 2.6k tokens per builder launch |
| Review spend (usage at 84%) | Plan-review `opus` `xhigh` (done); edge-case hunter `sonnet` `high` (done); final review `opus` `xhigh` |
| Version | **Minor, 4.4.0** (owner's call, against the release skill's "breaks a project → major"): installs within the hour; the rename goes first in the release notes and PR body |

## Research (condensed)

- Gaps: when to split unique code by responsibility; helper vs service vs module; the conflict
  between `extract-or-duplicate/SKILL.md:31` ("a long function used once stays") and `:72`
  ("split past about 100 lines"); naming; "cleaner" and "structural change" (`core.md:104`)
  undefined; the builder has no simplicity line and no preload; the evidence bar fits bugs only.
- Sources confirmed by the plan review: Sandi Metz, "The Wrong Abstraction"
  (https://sandimetz.com/blog/2016/1/20/the-wrong-abstraction): "If you find yourself passing
  parameters and adding conditional paths through shared code, the abstraction is incorrect."
  GitLab, "Guidelines for reusing abstractions" (https://docs.gitlab.com/development/reusing_abstractions/):
  a service coordinates changes between models; "When an object makes no changes to the state of
  the application, then it's not a service." The archived plan names Ousterhout (deep modules),
  PEP 8, Google and Angular style guides without links; the skill text names no author.
- Leave out: tiny functions as a goal, DRY at any cost, layers "for flexibility", hard line limits.

## Code exploration

- `plugin/skills/extract-or-duplicate/SKILL.md` (82 lines): search; extract now or wait; where
  the shared piece lives; reusable components; naming and size; before the commit.
- `plugin/instructions/core.md` (128 lines, ~2,347 tokens): `:98` "(extract and parameterize)";
  `:100-104` "One home for everything", with the skill pointer and the undefined "cleaner".
- **Two budgets bind:** `bun run check:context-budget` (`scripts/check-context-budget.ts:38,45`;
  in `bun run check` and CI): always-on (skill and agent names + descriptions) **2,700 / 2,700**;
  core **2,347 / 2,350**. Tokens = characters ÷ 4. Any growth fails; a trim lowers the budget to
  the new figure in the same commit (the script's header). `check:core-lines`: 140 max, warns above 130.
- `plugin/agents/builder.md`: preloads `impact-analysis`, `verify-change`.
- The evidence bar lives in `core.md:86-88`, `review/SKILL.md:49-62`, and in prompts of
  `plugin/workflows/review-split.js:129,184` and `plugin/workflows/audit-run.js:92,129`
  ("missing guard"; `src/workflows/review-split.test.ts:129` asserts it). The senior engineer
  does not load the review skill; it reads `review/references/axes.md`, as do the edge-case
  hunter and the review skill.
- Old-name mentions (excluding archives): `core.md:103`, `impact-analysis/SKILL.md:84`,
  `README.md:1630`, `evals/cases/extract-on-duplicate-logic/case.yaml:4,15,18`,
  `evals/baseline/fast-claude-haiku-5-5.json:130`. Nothing in `src/` or `scripts/` lists skills.
- Preload lists to update: `docs/design/instructions.md:248-251`, `README.md:1655-1657` (also
  missing the builder's `verify-change` today), `docs/claude-code-contract.md:298`.
- Evals: the duplicate-logic case scores 0 in the baseline and is `watch` (never fails); the
  compare reads case names and scores only (`evals/run.ts:476-493`). Trigger evals here measure,
  they cannot gate.
- Herdr branch `fix/herdr-4.3.1`: 10 files (src/herdr, two hooks, its skill and doc, and
  `docs/claude-code-contract.md` at line 416 — not ours at 298). Both branches release from
  4.3.0; re-check the base right before merge.
- A sibling project carries `.claude/cc-smart-dev-kit/extract-or-duplicate.md` and names the old
  skill in its `.claude/CLAUDE.md` and `impact-analysis.md` add-on. Plan 3 (#181) owns that repo:
  a note on #181 adds the rename. This plan does not touch it.

## Approach

### 1. The skill: `plugin/skills/code-structure/SKILL.md` (`git mv`, then rewrite)

Frontmatter `name: code-structure`. Description, pinned (205 characters, under today's 225, so
always-on does not grow):

> Use when shaping code - placing a new file, helper, service or component, naming, splitting a
> long function, duplicate logic. Triggers include "where should this go", "duplicate code",
> "extract", "naming".

No "clean this up" trigger (Claude Code's built-in `simplify` skill owns that phrase). Title:
"Code Structure: Clean, Organized, Never Simplistic". Body ≤ 220 lines (budget 300). Add-on:
`.claude/cc-smart-dev-kit/code-structure.md`. The project's own conventions and its language's
standard style win over this skill's defaults. Every rule the old skill has moves here.

1. **Simple, not simplistic** — the owner's line first. Clean and organized: complete, robust,
   readable. Never shorter by dropping error handling, a case, a type or a test.
2. **Build only what the task needs** — no layer, option, parameter or prop for a guessed future.
3. **Search before you write** — kept.
4. **Split by responsibility** (resolves `:31`/`:72`) — a unit does one job you can name in a
   short sentence without "and". Split when it does several jobs, or a block needs a comment to
   say *what* it does: name that block as a function in the same file. A long function that
   reads as one straight sequence of one job stays. About 100 lines per function and 500 per file
   are a prompt to look, never a limit or a reason alone. Keep together what changes together;
   do not split what must be read together. A private wrapper that adds nothing is a finding, and
   so are tiny functions made for their own sake; a public entry point that keeps callers out of
   a module's private parts is not a pass-through.
5. **Extract now, or wait?** — kept (same logic → one home now; merely similar → wait for the
   third). Added: extracting to *name* a block stays in its file; extracting for *reuse* needs a
   real second caller. A parameter carries data that varies; a flag or branch that picks a code
   path for one caller means the logic was not the same — keep the shared core shared, and move
   the caller-specific path back to that caller. Decide it once and say why; do not flip between
   extracting and inlining across review rounds.
6. **Helper, service, module** — a helper is a pure function (no state, no I/O) beside its
   callers; a service coordinates state changes across several things and is called from an
   edge (a route, a handler, a command); a module is one concept behind a small public entry
   point, deep (a simple interface over real work), not shallow. Each earns its place now: a
   real second caller, a simple interface over real work, or the project's own pattern. Each
   layer calls only the layers the project allows. Input is validated once, at the edge;
   authorization is not input validation and is still checked inside the function (review axes
   § Security).
7. **Where the shared piece lives** and **Reusable components** — kept.
8. **Naming** — for names the task owns: the purpose for a new reader; length by scope; no
   repeated context (`user.userName` → `user.name`); booleans read as a yes/no question
   (`isReady`, `hasAccess`), not negative (`notDisabled`); functions are verbs that say their
   effect (`loadInvoice`, not `handleData`); types are nouns; units in the name (`timeoutMs`); no
   made-up abbreviations; no grab-bag files or functions named for their kind (`utils.ts`,
   `misc.ts`, `data2`, `tmp`); match the siblings' case style. External contracts (API fields,
   library paths, generated names) keep their names. A name that lies is a bug.
9. **Files and folders** — follow the project's layout; new code beside its feature; one concept
   per file, one main export for a major type; split by concept, not line count; one helpers
   folder per layer — a project's existing one stays its home, with files inside named by job.
10. **Cleaner vs structural change** — defines `core.md`'s words. *Cleaner* (no need to ask,
    only inside the files the task changes): fewer jobs per unit, truer local and private names,
    dead code and unused imports removed, a comment that says why. *Structural change*: moving or
    renaming files or folders, an exported name or a module's public interface, a layer
    boundary, a new folder or layer pattern, splitting a file other code imports from. What the
    task or the approved plan names is already agreed; ask only for one beyond it (a subagent
    reports it to its caller). Unasked cleanup of untouched code stays out of the diff.
11. **Comments say why; unused code goes.**
12. **Before the commit** — the old six questions, plus: one job per unit? names true? nothing
    built for a need that does not exist?

### 2. `plugin/instructions/core.md` — pinned, no token growth

- `:98`: "(extract and parameterize)" → "(reuse or extract it)".
- `:102-104`, new text:

  ```
    now; merely similar code waits for a third case. Simple means clean and organized, not
    simplistic; ask before a structural change (`/cc-smart-dev-kit:code-structure`).
  ```

  This drops the old pointer and "Keep the structure as you found it, or cleaner;" (its meaning
  moves to the skill § 10). Net about −9 characters. Lower `CORE.max` in
  `scripts/check-context-budget.ts` to the new figure, and `ALWAYS_ON.max` too if the
  description trim lowered it (the script's own rule).

### 3. `plugin/agents/builder.md`

Add `cc-smart-dev-kit:code-structure` to `skills:`. § Build and check step 1, one sentence: shape
new and changed code by the loaded code-structure skill. No rule text copied.

### 4. Design findings meet the evidence bar, for every reviewer

- **One home:** a short section in `plugin/skills/review/references/axes.md`, "Design findings",
  read by the review skill, the senior engineer and the edge-case hunter. The four fields:
  Trigger = a concrete next change (a named second caller, the edit this task makes);
  Path = the `file:line`s; Outcome = the concrete cost (two copies that will drift, a boolean that
  says the opposite, one function doing three jobs); Why allowed = the rule it breaks (a
  `code-structure` section, the project's add-on or rule), **refuted** when a project convention
  or the sibling files already use that shape. Taste with no rule is a hunch. Severity follows
  § Severity: most are Suggestions; a lying name or a boundary violation ranks higher.
  § Craft gets "structure and names: `/cc-smart-dev-kit:code-structure`".
- `plugin/skills/review/SKILL.md` § The evidence bar: one pointer line to that section.
- `plugin/workflows/review-split.js` (`:129`, `:184`) and `plugin/workflows/audit-run.js`
  (`:92`, `:129`): one short clause in each find and refute prompt, under 12 words so
  `check:duplicates` passes: "A design finding's missing guard is the rule it breaks." Keep the
  words "missing guard". Their tests stay green.
- `core.md:86-88` stays as is (no token room; the axes file carries the detail).

### 5. The rest of the rename

- `plugin/skills/impact-analysis/SKILL.md:84` → `/cc-smart-dev-kit:code-structure`.
- `README.md:1630` row (the wider skill); `README.md:1655-1657` preloads (add the builder's
  `verify-change` and `code-structure`); `docs/design/instructions.md:248-251` (builder loads
  `code-structure`, and why); `docs/claude-code-contract.md:298` (builder also relies on it for
  `code-structure`; the mechanism is already proved, no new live proof).
- Evals: `extract-on-duplicate-logic/case.yaml` grader → `fires-code-structure`, its regex and
  description (case name kept, so the compare still pairs it); baseline file untouched. One new
  `watch` + `trigger` case, `code-structure-on-mixed-function`: a scaffolded `src/order.js` whose
  one function parses, validates and saves; prompt "This function parses, validates and saves an
  order. Should it be split, and what should the parts be called?"; grader: the skill fires.

### 6. Release (main session)

- Version in `plugin/.claude-plugin/plugin.json`, `install.sh:79`, `install.ps1:82`;
  `bun run build`; `CHANGELOG.md` entry. The rename goes first in the release notes and the PR body.
- **What to run**, in order: update the plugin and restart open sessions; then rename the
  project's `.claude/cc-smart-dev-kit/extract-or-duplicate.md` to `code-structure.md` and change
  `/cc-smart-dev-kit:extract-or-duplicate` mentions to `/cc-smart-dev-kit:code-structure`. Until
  both are done, the project's add-on is not read (old plugin + new file, or new plugin + old file).
- Semver: **4.4.0**, the owner's call. The trade-off, written down: the release skill counts a
  change that breaks a project as major, and a major version would be held until each person
  runs `cc-smart-dev-kit update`; a minor one installs within the hour, so a project's old add-on
  stops being read with only the release notes to say so.

## Files to change

| File | Change |
|---|---|
| `plugin/skills/extract-or-duplicate/SKILL.md` → `plugin/skills/code-structure/SKILL.md` | move + rewrite (§ 1) |
| `plugin/instructions/core.md`, `scripts/check-context-budget.ts` | pinned text, budgets lowered (§ 2) |
| `plugin/agents/builder.md` | preload + one line (§ 3) |
| `plugin/skills/review/references/axes.md`, `plugin/skills/review/SKILL.md`, `plugin/workflows/review-split.js`, `plugin/workflows/audit-run.js` | design findings (§ 4) |
| `plugin/skills/impact-analysis/SKILL.md`, `README.md`, `docs/design/instructions.md`, `docs/claude-code-contract.md` | rename and preload lists (§ 5) |
| `evals/cases/extract-on-duplicate-logic/case.yaml`, new `evals/cases/code-structure-on-mixed-function/` | evals (§ 5) |
| `plugin/.claude-plugin/plugin.json`, `install.sh`, `install.ps1`, `CHANGELOG.md`, `plugin/dist/*` | release (§ 6, main session) |

## Patterns to follow

- Skill shape: the other plugin skills (trigger-first `description`, add-on line first).
- Instruction edits through `rules-maintainer`: conflict check before and after, one home per
  rule, agents point and never copy. Plain English; neutral examples only.
- `check:duplicates`: no 12+-word sentence repeated across the plugin's texts.

## Edge cases

- **The always-on and core budgets** — both at their cap. Pinned texts above shrink both; P1 runs
  `check:context-budget`.
- **Reviewers never see the design-finding rule** — it lives in `axes.md` (read by all three
  reviewers) and a clause in both workflow scripts.
- **Two answers on extraction** — `core.md:98` no longer says "parameterize"; the skill says when
  a flag means inline, and to decide once.
- **Useful adapters flagged as pass-throughs** — the skill's exception for public entry points.
- **Approved structural work asked again** — what the task or plan names is already agreed.
- **Authorization dropped as "validated at the edge"** — the skill says authorization stays inside.
- **Helpers folder vs "no utils"** — grab-bag *files and functions* only; an existing folder stays.
- **External names renamed** — external contracts keep their names.
- **The skill fires too often or not at all** — description keeps the old triggers, drops
  "clean this up". The trigger evals measure but cannot gate (baseline 0, `watch`): say so; a
  paid before/after run is optional, in your terminal.
- **Mixed versions during the move** — old plugin + new file, or new plugin + old file, both lose
  the add-on until both move: the release notes give the order. A running session keeps its
  old copy until restart.
- **First upgraded session with a stale managed `core.md` copy** (a busy lock on refresh,
  `src/update/background.ts:216-240`): the live proof checks the managed copy too.
- **Herdr branch merging first** — re-check the base, pick a version above `main`, rebuild, rerun
  checks before our merge.
- Access, money, data, UI: do not apply (instruction text and two prompt strings).

## What could break

- Every pointer to the old name: renamed here; the final grep finds none outside archives and
  the CHANGELOG.
- `review-split.js` / `audit-run.js` prompt tests (`src/workflows/*.test.ts`): the clause is added,
  "missing guard" kept.
- `check:docs`: no doc points at an old-skill heading (checked).

## A simpler approach?

Widening the old skill in place was simpler; the owner chose the clearer name. No runtime code
changes: instruction text, two prompt strings, docs, evals and a budget figure.

## Rollback

Revert the merge and release the next version from the revert; projects that renamed their
add-on rename it back (one file).

## How we prove it

- `bun run check` (includes `check:context-budget`, `check:core-lines`, `check:duplicates`,
  `check:docs`, `check:neutral`, tests, `build:check`), both `claude plugin validate … --strict`.
- `grep -rn extract-or-duplicate` outside archives and the CHANGELOG: nothing.
- Live on this machine after merge and update: a new session lists `cc-smart-dev-kit:code-structure`;
  the managed `~/.claude/cc-smart-dev-kit/instructions/core.md` names it; a builder launch has the
  skill loaded (asked without tools, as the contract row's proof does).
- Optional, paid, your terminal: `bun run evals watch` on the two trigger cases.

## Phases, owners, waves

| Phase | Owner | Files | Done-check |
|---|---|---|---|
| **P1** The rule: §§ 1–5 | `cc-smart-dev-kit:rules-maintainer`, `sonnet`, `high` | all but § 6 | conflict check before/after; the grep; `check:context-budget`, `check:duplicates`, `check:docs`, `check:core-lines`, `lint`, `bun test src/workflows evals` |
| **Main** Release § 6 + integration | main session | release row | `bun run build`, full `bun run check`, both validates |
| **Review** Final whole-branch review | `cc-smart-dev-kit:senior-engineer`, `opus`, `xhigh` | the branch | findings fixed or ruled out |

One wave: P1 → release step → final review (with one phase, it is the task review too) → PR
into `main` → merge on your yes → update this machine, `doctor`, live proof → archive this plan,
close #241, note the sibling project's rename on #181.
