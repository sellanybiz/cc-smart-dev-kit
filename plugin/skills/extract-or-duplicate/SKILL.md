---
name: extract-or-duplicate
description: Use when similar logic shows up in two or more places, when placing a new file, or when picking the layer for a new helper or component. Decides extract now or wait, where the shared piece lives, and how it is named. Trigger phrases - "where should this go", "duplicate code", "similar logic", "extract", "new file", "new component".
---

# Placement, Naming, Extract Or Duplicate

**Project add-on:** `.claude/cc-smart-dev-kit/extract-or-duplicate.md` — read it first when it
exists. Where it differs, the add-on wins (`core.md`, top). It holds the project's folder
layout, naming and layer rules; this skill holds the general method.

The rule — one home for everything — is in the core instructions (§ Core principles). This
skill is how to apply it.

## Search before you write

Before you add a helper, component, constant, type, mapper or hook, look for one that
already exists: by name (`Grep` for it as a whole word), by what it does, and by structure —
claude-mem's `smart_search` lists the functions and types whose names match. If it exists,
import it. This is the cheapest half of the skill, and the half people skip.

## Extract now, or wait?

**Same logic** — changing one copy forces changing the other — **extract now**. It is the
same logic when:

- it now exists in two places, or you are about to paste it into a second;
- the copies already drifted and caused a bug.

**Merely similar — wait for the third.** Two things that look alike are not a repeat: with a
third you can see which parts are the same and which are coincidence. A long function used
once stays where it is. An abstraction built for a guessed use case locks in the wrong shape,
and the real second caller never fits it.

Duplication that meets the bar, in the files your task changes: fix it now — one copy at its
right home, every call site pointed at it, the copies deleted. Elsewhere: the core
instructions' one-plan rule.

## Where the shared piece lives

Scope it as narrowly as it is used, and widen it only when a new caller appears:

1. **Used on both sides** (for example browser and server): the project's shared layer, kept
   pure — no UI framework, no server-only imports.
2. **One side only:** that side, as close to its callers as possible — the feature's own
   folder, or the one file.
3. **Needed by another feature:** through that feature's public entry point, never by
   reaching into its private folders.

The project's own layer names, import aliases and boundaries come from its add-on file and
rules. Respect them; a boundary violation is Critical in review.

## Reusable components

About to ship the same UI a second time? Extract first, then build the second use.

- Coupled to a feature's data → that feature's components folder; the owner is the feature
  that supplies the data.
- No feature coupling → the project's shared UI folder.
- A UI library's own primitives stay where the library put them; import them directly.

**The contract:** props for the callers that exist — no prop nobody uses yet. The component
decides presentation; callers decide data and callbacks. No caller-specific text baked in:
labels come in as props with defaults. Document the props so the next caller finds them in
30 seconds.

## Naming and size

- Match the names of the siblings: the project's case style for components, utilities,
  hooks and folders. One naming style per kind of file.
- One responsibility per file; one main export for a major type (a component, a service, a
  hook). Split a function past about 100 lines, a file past about 500.
- One folder for helpers per layer — never `utils/` next to `helpers/` next to `lib/`.

## Before the commit

1. Right folder, layer and name?
2. Any duplicate I should extract?
3. Boundaries intact?
4. File and functions a sensible size?
5. Matches the existing pattern?
6. Would the next developer find it in 30 seconds?
