---
name: verify-change
description: Use after a batch of code edits, while you are still building - the cheap loop. Read your own diff, run the tests it touches, check the blast radius of anything shared, run the checks the push will run before you hand back, and at the plan's end test with the person what only they can judge. Not for a turn that edited no code; the deeper pass before a commit is the review skill. Trigger phrases - "run the tests", "check my changes", "does it still work", "implementation complete".
---

# Verify A Change — The Cheap Loop

**Project add-on:** `.claude/cc-smart-dev-kit/verify-change.md` — read it first when it exists. Where
it differs, the add-on wins (`core.md`, top). It names the project's test, lint and
type-check commands and what its git hooks run.

Run this after every batch of edits, while you are still building. It is cheap, and it is
where most mistakes die. The deeper pass — dimensions, edge cases, severity — is
`/cc-smart-dev-kit:review`, once per commit of finished work.

## 1. Read your own diff — `git diff`

Read it as a reviewer would. Look for:

- debug output, `debugger`, commented-out blocks;
- an accidental deletion, a missing import;
- a hard-coded value that should be configuration;
- an async path with no error handling;
- **a file you did not expect** — find out why before you go on.

## 2. Run the tests that cover what you touched

The tests for the files you changed, not the whole suite after every edit. A green suite
proves only what it covers: know where the project has no tests, and say so.

A bug: write the test that reproduces it first and watch it fail, then fix the code. A test
that fails: fix the cause (the core instructions' root-cause list). A new test must be able to
fail: break the code once on purpose and watch it go red. Never lower a coverage floor to go
green.

## 3. Blast radius — only when you changed shared code

You changed a shared type, function, hook, service, route, cache key, event name or anything
with several callers:

- find every caller (`Grep` for the name as a whole word, `\bname\b`) and the text forms
  too — route strings, keys, event names;
- run the type check once, to see every broken caller now.

The full protocol — scope limits, renames, data — is `/cc-smart-dev-kit:impact-analysis`.

## 4. Run the checks the push will run — before you hand back

Before you hand work back (as a builder) or push it (as the integrator), run the same checks
the project's push hook and CI will run on it: the tests, the linter **including any slower,
stricter rule set the push hook adds** (for example type-aware lint rules), the type check,
the build. A commit hook that passed does not prove the push hook will. Find them in the
project's hook configuration, its CI workflow and its package scripts. A check that fails:
fix it at the source; never silence it.

While still mid-build, you need not run the heavy ones after every edit — the project's hooks
and CI run them too. Run them once your piece is complete.

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

Once, when the plan's work is finished and its pull requests are open — not after every edit
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
