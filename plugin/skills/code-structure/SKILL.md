---
name: code-structure
description: Use when shaping code - placing a new file, helper, service or component, naming, splitting a long function, duplicate logic. Triggers include "where should this go", "duplicate code", "extract", "naming".
---

# Code Structure: Clean, Organized, Never Simplistic

**Project add-on:** `.claude/cc-smart-dev-kit/code-structure.md` — read it first when it
exists. Where it differs, the add-on wins (`core.md`, top). The project's conventions and
its language's standard style win over this skill's defaults.

## 1. Simple, not simplistic

Simplicity means keep things clean and organized; it does not mean bad and dumb code.
Code must be complete, robust and readable. Never make it shorter by dropping error
handling, a case, a type or a test.

## 2. Build only what the task needs

No layer, option, parameter or prop for a guessed future need. An abstraction built for an
imagined caller locks in the wrong shape, and the real second caller never fits it.

## 3. Search before you write

Before adding a helper, component, hook, constant, type, schema, mapper or error class, look
for one already there. Search three ways, the shared layers first (§ 7), then the feature
folders:

1. **By name** (`Grep` as a whole word), then by the words it shows: the sentence, label or
   message a user sees, and the domain words.
2. **By what it does:** the same job under another name. claude-mem's `smart_search` lists
   matching functions and types; when absent or unhelpful, use `Grep`.
3. **By structure:** one distinctive line of the body, such as a literal or a call chain.

If one exists, import it.

**Record the search.** For every new export, write one line under `Homes:` in your `Report:`:

`<name> (<kind>) — searched: <name>; <words it shows | n/a>; <a distinctive body line | n/a> — found: <paths | none> — why new: <reason>`

The kinds are function, component, hook, constant, type, schema, SQL function and error
class. A props or arguments type rides on its unit's line. With no new export, write
`Homes: none`. The lead checks that every line is there; the review spot-checks what is in
them. Outside a plan, the main session writes its own lines into the review's brief.

## 4. Split by responsibility

A unit does one job you can name in a short sentence without "and". Split when it does
several jobs, or a block needs a comment to say *what* it does: name that block as a
function in the same file. A long function that reads as one straight sequence of one job
stays. About 100 lines per function and 500 per file are a reason to look, never on their
own a reason to split.
Keep together what changes together; do not split what must be read together.

A private wrapper that adds nothing is a finding, as are tiny functions made for their
own sake. A public entry point that keeps callers out of a module's private parts is not
a pass-through.

## 5. Extract now, or wait?

**Same logic** means changing one copy forces changing the other. Give it one home now
when it exists twice, you are about to paste it into a second place, or copies have
already drifted and caused a bug. Reuse an existing implementation or extract the shared core.

**Merely similar — wait for the third.** Two things that look alike need not be a repeat;
a third shows which parts are shared and which are coincidence. Extracting to *name* a
block stays in its file; extracting for *reuse* needs a real second caller.

A parameter carries data that varies. A flag or branch that picks a code path for one
caller means the logic was not the same: keep the common core shared and move the
caller-specific path back to that caller. Decide once and say why; do not flip between
extracting and inlining across review rounds.

Duplication that meets the bar, in files the task changes: fix it now, point every call
site at its right home and remove the copies. Elsewhere: the core instructions' one-plan rule.

## 6. Helper, service, module

- A **helper** is a pure function: no state or I/O (reading or writing outside itself).
  Keep it beside its callers.
- A **service** coordinates state changes across several things, called from an edge such
  as a route, handler or command.
- A **module** puts one concept behind a small public entry point. Make it deep: a simple
  interface over real work, not a shallow layer that only forwards calls.
- A function that does one I/O job (a query, a file read, an API call) is neither helper nor
  service: keep it beside its callers or in the project's data-access layer, and keep the pure
  logic it uses in a helper.

Each earns its place now: a real second caller, a simple interface over real work, or the
project's own pattern. Each layer calls only layers the project allows. Validate input
once, at the edge. Authorization is not input validation: still check it inside the
function (review axes § Security).

## 7. Where the shared piece lives; reusable components

Scope it as narrowly as its use, widening only when another caller appears:

1. **Both sides**, such as browser and server: the project's shared layer, kept pure —
   no UI framework or server-only imports.
2. **One side:** close to its callers, in the feature's folder or the one file.
3. **Another feature needs it:** through that feature's public entry point, never its
   private folders.

Use the project's layer names, import aliases and boundaries from its add-on and rules.
A boundary violation is Critical in review.

Before shipping the same UI twice, extract, then build the second use. A component coupled
to feature data belongs in that feature's components folder, owned by the feature supplying
the data. Otherwise use the project's shared UI folder. Import a UI library's primitives
directly from their library home.

Props serve callers that exist, not hypothetical ones. The component decides presentation;
callers decide data and callbacks. Caller-specific labels come as props with defaults,
not baked-in text. Document props so the next caller finds them in 30 seconds.

## 8. Naming

For names the task owns, say the purpose to a new reader; use longer names for wider scopes.

- Avoid repeated context: `user.name`, not `user.userName`.
- Booleans ask a yes/no question (`isReady`, `hasAccess`), not a negative (`notDisabled`).
- Functions are verbs that say their effect: `loadInvoice`, not `handleData`. Types are nouns.
- Put units in names (`timeoutMs`); do not invent abbreviations.
- No catch-all files named for their kind (`utils.ts`, `misc.ts`), and no empty names
  (`data2`, `tmp`).
- Match siblings' case style for components, utilities, hooks and folders: one style per kind.

External contracts — API fields, library paths, generated names — keep their names.
A name that lies is a bug.

## 9. Files and folders

Follow the project's layout; put new code beside its feature. One concept per file, one
main export for a major type (a component, service or hook). Split by concept, not line count.
One helpers folder per layer: never add `utils/` beside `helpers/` beside `lib/`. An existing
folder stays the home; name the files inside by their job.

## 10. Cleaner vs structural change

**Cleaner**, without asking and only inside files the task changes: fewer jobs per unit,
truer local and private names, removed dead code and unused imports, a comment that says why.

**Structural change:** moving or renaming files or folders; an exported name or a module's
public interface; a layer boundary; a new folder or layer pattern; splitting a file other
code imports from. What the task or approved plan names is already agreed. Ask only for
structural work beyond it; a subagent reports it to its caller. Unasked cleanup of files the
task does not change stays out of the diff.

## 11. No AI slop

Code reads as if written by hand, by someone who will maintain it: the smallest complete
diff, with no line the task does not need and none missing that it does. Read your diff for
these and remove each one:

- **Narration comments:** what the next line does, step banners (`// Step 1`), a comment per
  line, words to the reviewer ("now we…", "this fixes…"). A comment gives a reason the code
  cannot show.
- **Docstrings** that repeat the name or the signature.
- **Defensive code for what cannot happen:** a `try`/`catch`, null check or type guard around
  something that cannot fail, or a catch that logs and carries on when the caller needed to
  know. Handle the case that can happen; let the rest fail loudly.
- **A fallback that hides a bug:** `?? []`, `|| ""` or a default on a value that must exist.
- **Nothing just in case** (§§ 2 and 4): an option, flag or config key no caller uses; a
  compatibility shim, re-export or alias nobody asked for.
- **Unused code:** dead code, unused imports, commented-out blocks. Delete them; git keeps
  the history.
- **Debug output:** logging added while building, and log lines that narrate a normal run.
- **Churn:** reformatting, reordered imports or renames in lines the task does not change.
  A cleaner edit (§ 10) makes the code truer; churn only moves text.
- **Tests that prove nothing:** a test that asserts what its own mock returns, tests the
  language or the framework, only checks that something exists, or snapshots output nobody
  reads.
- **Placeholders:** `TODO`, a stubbed branch, `not implemented`, or invented example values.
- **Names that narrate** (`processAndValidateUserDataIfNeeded`) or say nothing (§ 8).

Two more have their own homes: a cast or ignore comment that quiets a checker (the core
instructions' root-cause rule), and code unlike its siblings (§ 8, and § 12's pattern check).

## 12. Before the commit

1. Right folder, layer and name?
2. Any duplicate to reuse or extract, and the search recorded (§ 3)?
3. Boundaries intact?
4. Files and functions a sensible size?
5. Matches the existing pattern?
6. Would the next developer find it in 30 seconds?
7. One job per unit?
8. Names true?
9. Nothing built for a need that does not exist?
10. Nothing from § 11's list?
