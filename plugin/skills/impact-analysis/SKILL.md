---
name: impact-analysis
description: Use when changing anything used in two or more places - shared types, functions, hooks, services, API routes, database schema, cache or query keys, event names, stores, permission keys, component props. Trace every consumer before the change, update every reference, and check them again after. Trigger phrases - "rename", "remove", "change the signature", "update shared", "modify type", "drop column".
---

# Impact Analysis — The Blast Radius

**Project add-on:** `.claude/cc-smart-dev-kit/impact-analysis.md` — read it first when it exists.
Where it differs, the add-on wins (`core.md`, top). It lists the project's shared artifacts
and where their consumers hide.

Every change has a blast radius. Know it before you commit. A bug in one place usually
exists in three.

## Before the change: find every consumer

- **Symbols** (a function, type, class, hook, component): `Grep` for the name as a whole word
  (`\bname\b`), its import lines included, then `Read` around each hit to see the function it
  sits in. Where a language server runs for the file, `LSP` finds the references and the
  definition without the comments and look-alike names a text search returns; with none, it
  answers with an error. More than three files to read: hand the sweep to `Explore` with the
  exact names, and ask for every hit. When the question is a file's shape — its functions and
  exports — claude-mem's `smart_outline` (one file), `smart_unfold` (one symbol's body) and
  `smart_search` (the repo) answer it without reading whole files; when they are not there or
  do not answer, fall back to `Grep` and `Read`. Search **your** checkout: in a worktree, a
  search of the main checkout misses every caller your branch added.
- **Text** (a route string, a cache or query key, an event name, a column name, an
  environment variable, a permission key): `Grep`.
- **No `Grep` or `Glob` tool?** On macOS, Linux and WSL, Claude Code leaves both out of the
  session, and out of any agent that also lists `Bash`. Then `grep -rnw` and `find` through
  `Bash` are the same searches: Claude Code's shell runs fast built-in versions of both.
- **Never cut a caller list short** — no `| head`, no `-m`. This pass is about completeness,
  and a cut list looks exactly like a finished one. Count the hits, then read them; a long
  list is itself the finding.

Then:

1. Search code, tests, fixtures, docs, instruction files, migrations and seeds.
2. Count the consumers; more than three → list them.
3. Pick the change's shape, in this order: keep the public contract and change only the
   inside; change every consumer in one pull request; or add the new beside the old, move the
   consumers, then remove the old.
4. More than five affected files the plan does not list → a scope change: ask the person
   (in a subagent, hand it back). Inside the plan's file list, go on.

## Fix the pattern, not the instance

When asked to fix X, ask: is X unique, or one case of a class? The class fix is part of the
work in the files the plan changes. Beyond them only when the plan names it or the person
says yes; otherwise the core instructions' one-plan rule. Prefer a structural fix (a
shared helper, a type constraint, a constraint in the database, middleware, a lint rule) to
patching each site.

## Edge cases hide in the blast radius

Walk the edge-case axes against **each consumer**, not only the file you edited. They are in
the review skill's `references/axes.md` (`../review/references/axes.md` from this skill's
folder). The three this catches most often:

- a consumer that passes `null` or an empty list where the new code assumes a value;
- a second caller whose cache key or realtime channel lacks the tenant id;
- a cached, stored or in-flight copy of the **old** shape that outlives the deploy.

## Complete the change

A change is done only when every reference is updated:

- a removed column → types, queries, response mappings, services, component props;
- a removed function or component → exports, imports, registrations, the file itself;
- a renamed field → types, payloads, queries, cache keys, labels;
- a changed signature → **every** caller;
- a renamed feature, folder, table or event → also the docs and the instruction files, which
  drift silently and keep teaching the old name;
- a renamed key that also lives in **data** (a permission key in a table, a cache key in a
  running cache) → the code, the data and the cache, never the code alone. Production data
  goes through the project's own process, never a direct write.

## After the change

1. Search again for every changed name: zero stale references.
2. Run `/cc-smart-dev-kit:verify-change` (your diff, then the checks for what you changed; the whole type check waits for its § 4).
3. Re-read each call site from the first trace: still correct?
4. A database change: check its indexes and the project's access rules.
5. New files: right folder and name (`/cc-smart-dev-kit:extract-or-duplicate`).

Creating something is changing something: search first, extend what exists, and design for
the first two or three callers, not for a guessed tenth.

**Banned:** "it compiles, ship it"; changing a shared signature and one caller; happy-path
thinking; growing the scope without asking; skipping the search after the change.
