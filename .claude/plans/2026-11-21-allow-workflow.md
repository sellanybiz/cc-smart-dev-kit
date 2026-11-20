# allow* settings, a checked hand-back, and package scripts in the queue

## Summary

- The workflow settings get names that say what they do: `allowCommit`, `allowPush`,
  `allowMerge`. The old `autoCommit`, `autoPush`, `autoMerge` keep working everywhere, and
  `doctor` says how to rename them. `openPr` keeps its name: it is a choice of three, not a yes.
- A phase closes only when the commit its builder reported is in the plan branch.
- A `bun run <script>` whose body runs heavy work is queued, even when the body also runs a light
  command first (`next typegen && tsc --noEmit`). Release 6.1.0, stacked on 6.0.0 (PR #85).

## Context

The person, 2026-11-21: "auto merge and auto push was meaning Claude should not ask for a
prompt ... rename it like allow merge allow push allow commit"; and the rulings saved on #631:
"Rename to allow*, keep old names working". Two bugs another session hit the same day are in
this plan by the person's ruling:

- A build hand-back merged the worktree's default branch while the builder had committed on
  another branch, and the phase closed with none of its work.
- `"tsc": "SKIP_ENV_VALIDATION=1 next typegen && tsc --noEmit"` skipped the job queue with no
  message.

The 6.0.0 change already made `autoMerge` merge into `main` (through `workflow merge-check`), so
that part of #631 is done.

## Research

The scout's report is on #631 (2026-11-21). The facts the design rests on:

- **The schemas:** `workflowSchema` (`src/workflow/schema.ts:172`) is a strict object, used by
  both the person's file (`personalWorkflowSchema`, `.extend` at 303) and the project file
  (`src/project/config.ts:409`). An unknown key fails the strict parse.
- **The precedent:** there is no alias pattern yet. Retired keys load and are ignored
  (`schema.ts:271-281`).
- **The readers:** every reader goes through `ResolvedWorkflow` (`resolve.ts:77-80`, 533-536,
  590-593). `loadWorkflow` (134-148) is the one parse of the person's file. `sourceOf` (189)
  names where a value came from.
- **`requiresFloor`** (`src/project/init.ts:252-300`) raises a project file's `requires` for new
  keys, so an older plugin is never handed a key it would refuse.
- **The hand-back:** `task_done` on a phase has no commit check (`src/tasks/ops.ts:772-812`, and
  `refuseBareClose` in `plan-guards.ts:155-171` exempts phases). A phase stores `branch` and
  `base` (`work/types.ts:89-91`).
- **The queue:** a script body that fails the strict walk makes the call opaque (`classify.ts`
  `scan`, about 541-552). The route then returns nothing and job-route leaves the line raw
  (`job-route.ts:698-706`).

## Approach

1. **The rename.**
   - The keys are `allowCommit`, `allowPush`, `allowMerge`.
   - **The alias:** one alias table in `src/workflow/schema.ts`
     (`WORKFLOW_KEY_ALIASES = {autoCommit: "allowCommit", …}`, one home). A preprocess step
     inside `workflowSchema`, so both files get it, maps an old key to its new key. When a file
     holds both, the new key wins.
   - **The readers:** `ResolvedWorkflow`, `RESOLVED`, `POLICY_KEYS`, `REVIEW_GATE_KEYS`, `show` and
     the portal use the new names. `sourceOf` sees an aliased value as set, not as a default.
   - **The command:** `workflow set autoPush true` is accepted and writes `allowPush`, with one
     line saying so. `unset` and `propose` accept both names.
   - **Writes:** every write uses the new name. A project write raises `requires` through a new
     `WORKFLOW_ALLOW_KEYS_SINCE = "6.1.0"`, so an older plugin is not handed a key it would
     refuse.
   - **`doctor`:** for a file that still uses an old name, one line with the rename to do. It is
     never a failure.
   - **Messages and the portal:** `clashes.ts`, `pr-switches.ts`, `auto-merge.ts` and
     `project init` use the new names.
2. **The hand-back check.**
   - **The guard:** a new guard in `src/tasks/plan-guards.ts`, applied when a phase closes `done`
     (the `task_done` branch and `task_update` status done). When the phase records `branch` and
     `base`, the close needs at least one commit in `base..branch`, and that branch must be
     reachable from the plan branch (`git merge-base --is-ancestor <branch> <plan branch>`). The
     refusal names both. With no `branch` recorded, it does nothing.
   - **The build skill**, § 3 and § 5: merge the commit the report names, then check
     `git merge-base --is-ancestor <commit> <plan branch>` before closing the phase.
3. **The queue.**
   - **The fix:** in `scan`'s opaque branch, a script call that is the line's own command, whose
     body fails the strict walk only because of a light command (not depth, not a cycle), and
     whose body takes a slot, counts as heavy: its kinds come from the plain walk of the body.
   - **The cause:** `Scan` records why it went opaque, so depth and cycles stay refused.
   - **What stays the same:** a person's own line that mixes heavy work with another command
     (`bun run tsc && rm x`) is refused as before.
   - **The tests:** `job-route.test.ts:1552-1560` and `classify.test.ts:1812-1820` change with it.
4. **The words.**
   - **Text:** README, `docs/design/workflow.md`, `docs/jobs.md`, the commit, build, pull-request
     and user-unavailable skills, `instructions/optin/worktrees.md`, `review-split.js`'s
     comments, and CHANGELOG `## 6.1.0`.
   - **What to run:** `cc-smart-dev-kit update`. An old name keeps working, and
     `cc-smart-dev-kit workflow set allowPush true` moves a value.
5. **Version:** 6.1.0 in `plugin.json`, `install.sh` and `install.ps1`. Rebuild `plugin/dist`
   and `plugin/portal-ui`. `router.js` must not change.

## Phases

| Phase | Files | Agent |
|---|---|---|
| `rename` | `src/workflow/`, `src/project/`, `src/cli/`, `src/portal/`, `portal/src/`, `src/testing/fake-workflow.ts` | builder, `sonnet`, `high` |
| `checks` | `src/jobs/classify.ts`, `src/tasks/`, `src/hooks/job-route.test.ts`, their tests | builder, `sonnet`, `high` |
| `words` | README, `docs/`, `plugin/skills/`, `plugin/instructions/`, `plugin/workflows/` comments, CHANGELOG | rules-maintainer, `sonnet`, `high` |

All three run at once: their files do not overlap.

The main session does the version, `dist`, the portal export, one review round (the build skill
§ 6; one round, as the person chose for 6.0.0), and the full check.

## Edge cases

- **An old file with `autoPush: true`** keeps pushing, and `show` prints `allowPush = true
  (project)`.
- **Both names in one file:** the new one wins. `doctor` names the old one to remove.
- **The person's file has an old name and the project's a new one:** the project still wins,
  field by field.
- **An older plugin and a project file with `allowPush`:** `requires` 6.1.0 tells the older
  plugin to update, and nothing is refused silently.
- **A phase closed with no branch recorded:** allowed, as today.
- **A phase whose branch has no commits past its base:** refused, with both names.
- **`bun run check` with the body `biome check . && tsc --noEmit`:** queued now.
- **`bun run check; git status`:** still refused as a mixed line.
- **A script that calls itself, or nests too deep:** still not routed.

## How we prove it

- **Tests**, each new row seen red first:
  - the alias in both files;
  - `set` with an old name;
  - `sourceOf` with an aliased value;
  - the `requires` floor;
  - the `doctor` line;
  - the phase close refusals and passes;
  - the script-body queue rows.
- **Checks:** `bun run check`, the portal tests, both validates, and `build:check` with
  `router.js` unchanged.

## Rollback

A new version with the old names as the only names. An alias never rewrites a file by itself,
so nothing needs migrating back.
