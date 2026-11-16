---
name: verify-change
description: Use after code edits to check changed files and shared callers; the main session owns the final full check. Not for a turn with no code changes or a deeper review. Triggers include "run the tests", "check my changes", "does it still work", "implementation complete".
---

# Verify A Change — The Cheap Loop

**Project add-on:** `.claude/cc-smart-dev-kit/verify-change.md` — read it first when it exists. Where
it differs, the add-on wins (`core.md`, top). It names the project's test, lint and
type-check commands and what its git hooks run.

Run this after every batch of edits, while you are still building. It is cheap, and it is
where most mistakes die. The main session owns the deeper review; a builder reports evidence
without reviewing itself (`/cc-smart-dev-kit:build`).

## 1. Read your own diff — `git diff`

Check the edit for accidents, not a review verdict. Look for:

- debug output, `debugger`, commented-out blocks;
- an accidental deletion, a missing import;
- a hard-coded value that should be configuration;
- an async path with no error handling;
- **a file you did not expect** — find out why before you go on.

## 2. While building, check only what you changed

A whole-project type check, lint or test run takes minutes in a big project, and many sessions
queue them. While you build, run only these:

- **Tests:** the test files you touched and the tests that cover the code you changed — the
  runner's own related-files mode where it has one. Not the whole suite.
- **Lint:** the linter on the changed files only.
- **Type errors:** where a language server runs for the file, Claude Code reports its type errors
  and warnings after each edit (a "Found N new diagnostic issues" line; `Ctrl+O` shows them): read
  and fix them. It needs a code intelligence plugin for the language, is off in cloud sessions, and
  covers the file you edited, not its callers. So it may be missing: then the type check waits for
  § 4. A one-file `tsc a.ts` is no substitute: it ignores the project's `tsconfig.json`.
- **The project's fast check:** when `.claude/cc-smart-dev-kit.json` sets `checks.fast`, run that
  command in place of picking the lint and type steps yourself. The `verify-gate` hook asks for it
  once, when you stop after changing files.

A green run proves only what it covers: know where the project has no tests, and say so.

A bug: write the test that reproduces it first and watch it fail, then fix the code. A test
that fails: fix the cause (the core instructions' root-cause list). A new test must be able to
fail: break the code once on purpose and watch it go red, keeping a copy first (`cp path
path.bak`), copying it back after (`cp path.bak path`) and deleting the copy (`rm path.bak`) —
never discard unrelated edits. Never lower a coverage floor to go green.

## 3. Blast radius — only when you changed shared code

You changed a shared type, function, hook, service, route, cache key, event name or anything
with several callers:

- find every caller (`Grep` for the name as a whole word, `\bname\b`) and the text forms
  too — route strings, keys, event names;
- read each caller you find, and change it: the whole type check is for § 4, not for this step.

The full protocol — scope limits, renames, data — is `/cc-smart-dev-kit:impact-analysis`.

## 4. The full check — once, at the end

The full check is everything the project's push hook and CI run: the whole type check, the
whole lint **including any slower, stricter rule set the push hook adds** (for example
type-aware lint rules), all the tests, the build. A commit hook that passed does not prove the
push hook will. Find them in the project's hook configuration, its CI workflow and its package
scripts. It runs once, when the work is complete:

- **The main session:** before the push, after the final review and its fix pass.
- **A subagent never runs it** — a builder or any other. The session that launched it runs the
  full check once, after its agents hand back. A subagent runs § 2 and reports what it ran.
  Whole-project typecheck or lint is allowed when its brief names it; that does not permit
  the final suite or build.

A check that fails: fix it at the source; never silence it.

**A push hook on a busy machine.** The push hook repeats this full check. When the machine is
under heavy load (`cc-smart-dev-kit job status` shows jobs waiting for a slot, or the load
average stays above the number of CPU cores for a few minutes; native Windows has no load
average, so there only the queue counts), you may push with `--no-verify` only when all of
these hold:

- this full check passed in this session on the exact commit you push (`git rev-parse HEAD`
  is the commit it ran on, and nothing changed since);
- the project's CI runs the same checks on that branch (read its workflow; a check the hook
  runs and CI does not means no skip);
- the push hook only runs checks (read it). The flag skips the whole pre-push hook, so a hook
  that also uploads or writes, such as `git lfs pre-push`, means no skip.

Say in your reply that you skipped the hook, and why. Then watch CI to the end, and treat a CI
failure like a failed hook. Without all three conditions, keep the hook and wait for the load to fall.

## 5. Driving the app? Restart the server first

Hot reload does not always pick up server-side changes: a running dev server can keep
serving the old module, and the reading you take is then a lie in the shape of evidence.
Before a measurement that decides whether server code is right, restart the server, wait
until it answers, then measure. A change to which files import which (a new file, a moved
import) needs a restart too.

Two more things a local setup may not tell you: an empty local database cannot exercise a
path that needs rows (say so, rather than claiming it passed), and a "local" config may point
at a shared remote service.

## 6. Test it with the person — what only a person can check

Once, when the plan's work is finished and its pull request is open — not after every edit
batch. First run every check you can yourself: the tests, the app in a browser (yourself or
the `cc-smart-dev-kit:ui-verifier`), the app itself through the bundled `/run` skill (it launches
and drives it), the script with real input. Then list what you cannot judge alone:

- a page behind their own login, or with their real data;
- a real click, upload or download on their screen;
- a device, browser or system you do not have;
- whether the flow makes sense to a person — the words, the order, what they expect.

For those, give short numbered steps and what they should see at each one, in the plan-end
summary. Fix what they find, and say what no person tested. (A subagent skips this section
and hands its test steps to its caller.)

## When you get stuck

1. **Attempts 1–2:** read the error, find the root cause — not the symptom — fix, run again.
2. **Attempt 3:** stop patching. Re-read the code around it. Try a different approach.
3. **After three failures:** stop. Tell the person (in a subagent, your caller) the error,
   what you tried, why it fails, and two or three ways forward.

Never loop more than three times on the same error, and never hide an error to get past it.
