# RX2 — the release review's hooks and user-away findings (1.3.0)

Your branch starts from `release-1.2.1`, the 1.3.0 release (version already 1.3.0: the lead owns
`plugin/.claude-plugin/plugin.json`, the installers' version lines and the CHANGELOG's intro; add
your own CHANGELOG lines under `## 1.3.0` only when a fix changes what a user sees). The plan:
`.claude/plans/2026-10-21-master-plan.md` § Release 1.3.0 (planned as 1.2.1), its close.

These are findings of the release's split review (2026-10-25: four tracks on `opus` at `xhigh`, each
finding checked by a second `opus` reviewer that tried to refute it). Each one names the trigger, the
real outcome and the missing guard. **Fix each at its cause, with a test seen failing first.** If,
with the code in hand, you can show a finding is wrong, do not change the code: say why in your
report. The "judge" items are hunches: prove or drop each, and say which.

Read `.claude/rules/hooks.md` and `.claude/rules/hooks-guards.md` first (the frame, fail closed, the
fail-safe table, `alwaysOn`).

## The findings

1. **`/user-available` cannot switch the state back in Claude Code's default permission mode**
   (`src/hooks/user-away.ts:217`, `permissionAnswer`). The skill runs `cc-smart-dev-kit user status
   --json` and `user available` as Bash calls; Claude Code raises its permission prompt, and the
   PermissionRequest hook — still reading `unavailable: true` — parks and denies them. The person, who
   is back, never sees a prompt; the only way out (`! cc-smart-dev-kit user available` in their own
   shell) is documented nowhere. Fix: `permissionAnswer` stays silent (the pre-feature behaviour: the
   present person answers Claude Code's own prompt) for a shell call that is the kit's own `user
   available` / `user status` / `user list`, read with the one kit-command reader (`kitArguments` /
   `namesKit`); nothing gets looser. Also name the `!` fallback in `plugin/skills/user-available`. A
   `user-away.test.ts` case.
2. **A parked action merges two folders' calls** (`src/user-away/state.ts:175`, `sameItem`): the key is
   kind + command only, so the same `git push -u origin HEAD` from two worktrees becomes one item with
   the first one's `cwd`; the person's yes runs it there only, and the other session's push never
   happens. The same merge drops a second crew session's `--crew` on a same-worded question. Fix: the
   key also holds `cwd` and `crew` (not the session, so a retry from the same session and folder still
   dedupes). A `state.test.ts` case; update `docs/design/hooks.md` § While the person is away ("parks
   once" → "in the same folder").
3. **The words say the hook parks AskUserQuestion and ExitPlanMode; it does not.** `plugin/hooks/hooks.json:2`
   (the description) says "a question … denied and parked"; the code (`user-away.ts:11-13`,
   `:314-319`) denies with the step that parks, and the design page says "Nothing is parked by the
   hook: the session parks it". Fix the description to match the code, and add the new tier note
   (`tier-view`: one note to Claude of what each subagent tier runs) to it. (The lead fixes the
   CHANGELOG's line.)
4. **Docs name two `alwaysOn` hooks; there are three** (`docs/design/hooks.md:60-63` and `:252-253`,
   `.claude/rules/hooks-guards.md:66`): add `user-away`, with its one-line reason (the switch is the
   person's).
5. **The usage-limit alert's doc** (`docs/design/hooks.md:925`) still says it always says when the limit
   resets; since TV1 a limit that does not hold the session gives no reset date
   (`docs/gateway.md:1130` has the rule). Say so.

## Judge

- When one guard denies a call and another asks about the same call, the asking guard's process still
  parks the call as an action that "waits for their yes" (`user-away.ts`, `askedWhileAway`). Find
  whether any real command is both denied and asked (git-guard denies a force push to the default
  branch; does merge-guard or session-escape-guard ask on it?). If so, park nothing when the frame's
  answer is a deny.
- An MCP elicitation dialog also waits for the person; neither PreToolUse nor PermissionRequest covers
  it. Check Claude Code's docs and the contract: does PermissionRequest fire for an elicitation? If
  not, name the gap in `docs/design/hooks.md` § While the person is away (no code).
- A guard near its timeout, plus a park that waits up to `AWAY_LOCK_WAIT_MS` for the lock, can pass the
  hook's `timeout` in `hooks.json`; `onFailure: block` then blocks the call unparked. Check the
  numbers; if they can add past the timeout, make the park's wait fit inside it.

## Files (change nothing else)

`src/hooks/user-away.ts`, `src/user-away/**`, their tests, `plugin/hooks/hooks.json` (the description
only), `plugin/skills/user-available/SKILL.md`, `plugin/skills/user-unavailable/SKILL.md`,
`docs/design/hooks.md`, `.claude/rules/hooks-guards.md`, `README.md` (the user-away section only),
`plugin/dist/*` (through `bun run build` only), `CHANGELOG.md`. A skill change must pass
`bun run check:duplicates`.

## Done-check

The targeted tests, then `bun run build`, `bun run check`, and both `claude plugin validate …
--strict`. Your own review, then one second opinion: the `cc-smart-dev-kit:reviewer` agent on
`opus` at `xhigh`. Never touch the real `~/.claude`, `~/.config`, `~/.local` or port 20100. Run
`bun install` in your own worktree; never link another checkout's `node_modules`.
