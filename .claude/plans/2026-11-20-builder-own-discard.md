# A builder's own discards stop asking (`builder-own-discard`)

**Summary.** The git guard asks the person before every command that throws away uncommitted
changes, even when a builder undoes its own edits in its own isolated worktree. A hook question
cannot be remembered, so each one interrupts the person. The guard now stays silent for a
working-folder discard that a subagent runs inside its own worktree, proved by its `agent_id`.
Everything else still asks. Patch release 5.6.1.

## Context

Seen live on 2026-11-20 (5.6.0): a builder ran
`cd <repo>/.claude/worktrees/agent-a96ad2a93e52655da; git checkout HEAD -- src; …`, and the
person was asked "Do you want to proceed?". Two such prompts were queued. The owner: "why its
asking for prompt again and again very anoying". Owner's decision (2026-11-20): "Fix it,
release 5.6.1".

**Cause.** `discardsChanges` (`src/hooks/git-guard.ts`) asks about every `checkout -- <path>`,
`checkout .`, `checkout -f`, `switch -f`, and `restore` without `--staged`, wherever it runs
and whoever runs it. `reset --hard`, `reset --merge` and `clean -f` ask the same way.

**What Claude Code gives the hook.** "When a subagent calls a tool, tool events such as
`PreToolUse` and `PostToolUse` fire the same configured hooks as in the main conversation, and
the input carries the `agent_id` and `agent_type` common input fields that identify the
subagent" (code.claude.com/docs/en/hooks, read 2026-11-20). A subagent with
`isolation: "worktree"` works in `<main checkout>/.claude/worktrees/agent-<agent_id>`
(contract row, proved on 2.1.300). `subagentWorktreeOf(cwd, agentId)`
(`src/hooks/subagent-worktree.ts`) already reads that shape.

## Approach

1. **Thread the agent id into the guard.** `gitGuardHook.run` reads `stringField(input.agent_id)`
   and passes it to `guardQuestions` as a new option, `agentId: string | null`.
2. **Own worktree.** In `callQuestions`, for the working-folder discards only, the guard works
   out the folder git runs in (the line's `cd` already tracked as `folder`, plus `-C` dirs as
   push does with `call.dirs`). It stays silent when that folder lies inside
   `<root>/.claude/worktrees/agent-<agentId>`. The root is found through
   `subagentWorktreeOf(folder, agentId)`: the helper is reused, not copied.
   - The kinds that go silent: `checkout`/`restore`/`switch` discards (`discardsChanges`),
     `reset --hard`, `reset --merge`, `clean -f`.
   - The kinds that still ask, everywhere: every push form, `branch -D`, `stash clear`/`drop`
     and the shared bare stash, `worktree remove -f`. They reach outside the worktree (a
     remote, a shared branch list, the shared stash, another checkout).
   - A `git --work-tree=…` or `--git-dir=…` option on the call: still asks (the folder is
     not the one git writes).
3. **Fail safe.** No `agent_id`, an id that is not hex, a folder the guard cannot follow
   (`cd $DIR`, `cd -`), a folder outside the agent's own worktree, or the main session (no id):
   it asks as today.

## Files to change

- `src/hooks/git-guard.ts`, `src/hooks/git-guard.test.ts`
- `src/hooks/specs.ts` (the `gitGuardHook.run` passes the id)
- `docs/design/hooks.md` (the git guard's row), `README.md` (the git-guard row, if it lists the asks)
- `docs/claude-code-contract.md` (a row: a subagent's PreToolUse input carries `agent_id`)
- Release, in the main session: `CHANGELOG.md`, `plugin/.claude-plugin/plugin.json`,
  `install.sh`, `install.ps1`, `plugin/dist/`

## Edge cases

- **The main session `cd`s into a builder's worktree and discards:** no `agent_id`, asks.
- **Builder A discards in builder B's worktree:** the id does not match the folder, asks.
- **A builder discards in the lead's checkout or the main checkout** (`cd ../..`): outside its
  worktree, asks.
- **A path that looks like the worktree but is a sibling** (`agent-<id>x`, `agent-<id>-old`):
  the helper's pattern ends at a separator or the end, asks.
- **`git -C <other> checkout -- x` from inside the own worktree:** the folder follows `-C`, asks.
- **A nested `bash -c "cd …; git checkout -- x"`:** read through `inspect`'s nesting with the
  same folder rule.
- **A non-isolated subagent** (works in the lead's checkout): its folder is not
  `agent-<id>`, asks.
- **Windows paths:** the helper accepts `\` and `/`.
- **Line with a discard and a push:** the push still asks.

## How we prove it

- **Red first:** rows in `git-guard.test.ts` for each silent case, and each still-asking case
  above, before the code change.
- **Live, right after the update** (only the person's machine can show it): a builder's
  `git checkout -- <file>` in its own worktree runs with no prompt, and the main session's
  same command in that folder still asks.
- **Checks:** `bun run check`, both validates, CI.

## Phases

| Phase | Files | Builder |
|---|---|---|
| `guard`: own-worktree discards are silent | `git-guard.ts`, its test, `specs.ts`, docs, contract row | `cc-smart-dev-kit:builder`, sonnet, high |

**Review:** one review of the plan in two rounds, the `review-split` workflow (every agent the
senior engineer on `opus` at `xhigh`), round 1, fixes, round 2 with round 1's report, fixes.
