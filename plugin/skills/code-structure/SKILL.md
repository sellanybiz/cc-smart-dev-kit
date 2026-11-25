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

Before adding a function, component, hook, constant, type, schema, SQL function, mapper or
error class, look for one already there. Search three ways, the shared layers first (§ 7),
then the feature folders:

1. **By name** (`Grep` as a whole word), then by the words it shows: the sentence, label or
   message a user sees, and the domain words.
2. **By what it does:** the same job under another name. claude-mem's `smart_search` lists
   matching functions and types; when absent or unhelpful, use `Grep`.
3. **By structure:** one distinctive line of the body, such as a literal or a call chain.

If one exists, import it.

**Record the search.** For every new export, write one line under `Homes:` in your `Report:`:

`<name> (<kind>) — searched: <name and the words it shows>; <what it does: the query | n/a>; <a distinctive body line | n/a> — found: <paths | none> — why new: <reason>`

The three searches are the ones above, in order; the kind is one from the list above. A props
or arguments type rides on its unit's line. With no new export, write `Homes: none`. The lead
checks that every line is there; the review spot-checks what is in them. Outside a plan, the
main session's own lines go in the single senior engineer's brief, or in the `homes` arg of a
split review (`/cc-smart-dev-kit:review`); inside a plan, the lead's own integration exports go
in `homes` too.

## 4. Split by responsibility

A unit does one job you can name in a short sentence without "and". Split when it does
several jobs, or a block needs a comment to say *what* it does: name that block as a
function in the same file (a pure one with no feature words: § 7). A long function that reads as one straight sequence of one job
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
block stays in its file, except a pure helper with no feature words (§ 7); extracting for *reuse* needs a
real second caller. A composite of shared UI parts is the same case: an *identical* one follows § 7 (extract before shipping
it twice); a merely similar one goes to the shared UI layer when a third screen builds it.

**Make the second copy visible.** Why wait: two copies often only look alike, and a helper made
too early grows a flag per caller (§ 11). So whoever writes merely similar code marks the second
copy twice. The `why new` part of its `Homes:` line (§ 3) says `similar to <path:symbol>, not
shared: <why>`. And a comment at the new definition says `Similar to <path:symbol>; not shared
yet: <why> (code-structure § 5)`. The comment lives in the code, so it holds across plans and
machines, and it covers similar code that is not a new export. The author of a third copy, and
the review's reuse track, find the marker with `git grep "Similar to <path:symbol>"`, see two
named copies, and extract now.

A parameter carries data that varies. A flag or branch that picks a code path for one
caller means the logic was not the same: keep the common core shared and move the
caller-specific path back to that caller. Decide once and say why; do not flip between
extracting and inlining across review rounds.

Duplication that meets the bar, in files the task changes: fix it now, point every call
site at its right home and remove the copies. Elsewhere: the core instructions' one-plan rule.

## 6. Helper, service, module

- A **helper** is a pure function: no state or I/O (reading or writing outside itself).
  Keep it beside its callers, unless it has no feature words in it (§ 7).
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

Scope it as narrowly as its use, widening only when another caller appears (one exception
follows the list):

1. **Both sides**, such as browser and server: the project's shared layer, kept pure —
   no UI framework or server-only imports.
2. **One side:** close to its callers, in the feature's folder or the one file.
3. **Another feature needs it:** through that feature's public entry point, never its
   private folders. Never copy a feature's private helper into a second feature: export it
   or move it to the shared layer.

**One exception, for placement only:** a new pure helper with no feature words in it (a page
cut, a list or count formatter, a date formatter) goes to the shared layer the project names for
its side on its first write, even with one caller. This decides where it lives, not whether to
extract it (§ 5). With no such layer, keep it beside its caller and say so in your report's `Homes:` section.

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
folder stays the home; name the files inside by their job. Name a folder for the concept it
owns, never for its first user. Test doubles and fixtures live in the project's test-support
home, and product code never branches on one.

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
  the history. Code that only its own tests call is dead. A `v1` kept beside its `v2` is dead
  when nothing calls it (delete it), and a half-finished move when callers remain (move them,
  then delete it).
- **A copy of a shared home:** something a shared layer already exports, written again; a
  composite of shared parts built by hand when the project has one; plumbing every feature
  needs (a fetch wrapper, a retry, a cache key) rebuilt inside one feature; a rule on words
  (a plural, a label, a date format) written inline when the project has a home for words.
- **A claim with no guard:** a comment or doc that says "the one place for X" while no test or
  lint fails on a second place.
- **One mode, many switches:** the same flag or mode tested in three or more places; one
  function or table should decide it.
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

## 13. Mechanical guards

A rule that says "one home" holds only when a tool fails on a second one. The project owns
these guards; each is a ratchet, so the count may only go down:

- unused exports, where use in a test alone counts as unused;
- a duplicate detector over the source;
- a size ratchet on files and functions;
- an import lint that sends callers through a feature's front door.

The project lists its commands in its review add-on, `.claude/cc-smart-dev-kit/review.md`,
under a `Reuse signals` heading. The lead runs them before each review round, or the main
session when there is no plan, and hands the output to the reviewers. Run
`cc-smart-dev-kit workflow claims --base <the review's base>` with them, always: it lists the project's own "one home"
claims, and any added line in the diff that re-defines a symbol a claim names. A reviewer never runs
the project's guard commands itself; searching the repo for an existing home stays its job.
A project with no `Reuse signals` heading: whoever runs them (the lead, or the main session
outside a plan) says so in one line and goes on, and offers the person guard setup as a plan of
its own (`/cc-smart-dev-kit:plan-task`). When the person declines, write a `## Reuse signals`
heading into the review add-on whose body says `none: declined on <date>`. The heading then
exists, so neither this section nor `cc-smart-dev-kit doctor` asks again, and a body that starts
with `none` lists no commands to run. How to set the guards up for the project's stack:
`references/guards.md`.
