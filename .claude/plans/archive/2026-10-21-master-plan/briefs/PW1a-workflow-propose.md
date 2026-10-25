# PW1a — propose a project's workflow change as a pull request (the command, the API, the action)

## Goal, and why

D57 (`.claude/plans/2026-10-21-master-plan.md` § Decisions): the portal changes one project's
workflow settings (`autoCommit`, `autoPush`, `openPr`, `autoMerge`, `reviewBeforePush`, … every
key `workflow set --project` takes) **through a pull request**, never by writing the project's
main checkout. The project's `.claude/cc-smart-dev-kit.json` is committed and shared, and the
merge guard reads its review gate from the committed base (`origin/<base>`), so a change counts
once it is merged. PW1b builds the card on what you build here; this phase is the contract.

## What to build

1. **One CLI command, the one home for the flow:**
   `cc-smart-dev-kit workflow propose <setting> <value> [--folder <project>]` (and `--unset` for
   removing a project value, if `workflow unset --project` exists for that key — follow
   `src/workflow/commands.ts`). Steps, each stopping with one plain line on failure:
   - find the project (`--folder`, else the current folder) and its base (`worktrees.base`,
     `src/project/`);
   - `git fetch origin <base>`; a new branch `worktree-workflow-<setting>-<short date or id>` and a
     worktree for it under `<repo>/.claude/worktrees/` (Claude Code's own layout, so the plugin's
     auto-clean removes it after the merge) from `origin/<base>`;
   - write the one value with **the same writer `workflow set --project` uses**
     (`src/workflow/write.ts`: it validates the value and raises `requires` when the key needs a
     newer plugin) — never a second writer; a value already equal: say so and stop, no branch;
   - `git commit` (the person's git identity; a plain message naming the setting, old and new
     value), `git push -u origin <branch>`, `gh pr create --base <base>` with a short body (what
     changed, why it counts only once merged);
   - print the PR's URL; `--json` prints `{ url, branch, worktree, setting, from, to }`.
   - **Inside Claude Code it refuses** the review-gate keys (`REVIEW_GATE_KEYS`), as `workflow set`
     does there; outside it (the portal, a terminal) every key is allowed — the PR is the gate.
   - No `gh` login, a push refused, a base that cannot be fetched: one line with the fix, exit 1;
     a branch or worktree it made before the failure is removed again (never left half-made).
2. **The API answer:** `GET /api/projects/<id>/workflow` → each workflow setting's value and its
   source (`project` / `personal` / `default`), from **the resolver `workflow show` uses**
   (`src/workflow/resolve.ts`) — never a second reader; plus the base and whether `gh` is logged
   in (one cached read, as the portal's other `gh` facts). Types in `src/portal/api/types.ts` and
   the portal app's `portal/src/api/wire.ts` (+ its mock), in the existing style.
3. **The action:** `project.workflow.propose` in `src/portal/actions.ts`, asks first (as every
   action), runs the CLI command through `runCliChild` (`src/portal/cli-child.ts`: never the
   function in the server process), returns the PR URL or the refusal line in place. A crew
   session cannot run it (the portal's door already refuses a crew session: check and test it).

## Files (change nothing else)

`src/workflow/commands.ts` (+ a new `src/workflow/propose.ts` for the flow), their tests;
`src/cli/help.ts`; `src/portal/actions.ts`, `src/portal/api/routes.ts`, `src/portal/api/types.ts`,
`src/portal/api/data.ts` or `work.ts` (whichever builds project answers), their tests;
`portal/src/api/wire.ts`, `portal/src/api/mock*.ts`; `README.md` (the command's row, § The
workflow), `docs/design/workflow.md` and `docs/design/portal.md` (one paragraph each);
`plugin/dist/*.js` (rebuilt). The card itself is PW1b's: do not build UI.

## Edge cases (each a test, in temp git repos with a fake `gh` and a local bare remote)

A project with no file (refuse: `project init` first); a value equal to the current one; an
invalid value (the writer's own refusal); a key that needs a newer plugin (`requires` raised in the
same commit); a branch name already taken; no `gh` or no login; a push refused; a fetch failure;
`--json`; inside Claude Code with a review-gate key (refused) and without (allowed). Never the real
`HOME`, never a real remote, never the live router's port.

## Done-check

The targeted tests, then `bun run build`, then `bun run check`; your review; your report with the
command's exact output for one success and one refusal.
