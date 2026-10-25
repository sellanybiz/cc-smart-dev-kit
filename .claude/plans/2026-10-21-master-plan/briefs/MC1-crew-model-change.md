# MC1 — the lead changes a crew session's model or effort when the person asks (1.2.1)

## Goal, and why

Your branch starts from `release-1.2.1` (main after 1.2.0, with 1.1.3, CL2, CL2B, EF2 and WF1
merged). The plan: `.claude/plans/2026-10-21-master-plan.md` § Release 1.2.1.

**The owner's ask (2026-10-25):** "if I tell the lead, will the lead be able to change a session's
effort or model? If not, add it." Today it cannot. A crew session's model and effort are set once,
at `crew start` (`--model`, `--effort`, or the kind's default: `crew kinds`); `crew resume`,
`crew stop` and `crew answer` take neither, and nothing changes a running crew session. Only the
person can, by `claude attach <name>` and `/model` or `/effort` in that session, and then the crew
record still names the old model, so the caps and `crew list` are wrong.

Seen the same night: four crew sessions ran on Opus at `xhigh` because the worker slot's model was
thought to be at its limit; when it answered again, the lead could not move them.

## The change

1. **Prove first** (a throwaway session of your own in your worktree, never the lead's or another
   crew session): does `claude --bg --resume <id> --model <m> --effort <e>` continue the session
   on the new model and effort (read the first new request's model in its transcript)? Does a
   crew session's own `--settings` file (`crewSettingsFile`, `src/crew/store.ts`) pin a model or
   effort that would win over the flag? Record each fact as a row in
   `docs/claude-code-contract.md`. Build on what you proved.
2. **One command**, for example `cc-smart-dev-kit crew model <name> [--model <m>] [--effort <e>]`
   (pick the name; the lead skill and `crew --help` name it). It:
   - refuses what `crew start` refuses for the same values, through the same checks (one home:
     the launch policy, `src/models/launch-policy.ts`; a `ui` kind never on an affordable model);
   - re-checks the caps when the tier changes (to opus: `crew.perLeadOpus`, `crew.maxOpus`, the
     usage window), and queues the change with the reason when a cap holds, as `crew start`
     queues;
   - a **running** crew session is stopped and resumed with the new flags through WF1's one
     resume path (`resumeSession`, which follows the session Claude Code opens), with a prompt that
     says what changed and to go on from where it stopped; a **stopped** or **paused** one keeps
     its state and takes the new values at its next resume;
   - writes the new model and effort to the record in the same write as the state (the store's
     writers), so `crew list`, the caps and the portal read the truth;
   - prints one line: the crew session, old → new, and what happened (resumed, stored for the next
     resume, queued, refused).
3. **The lead picks a phase's effort by its task (the owner, 2026-10-25).** On a Claude model,
   the kind's effort (`crew kinds`: `high` for the `sonnet` kinds) is the default, not a rule: the
   lead sets `--effort` per phase from its brief — `medium` for mechanical work, `high` by
   default, `xhigh` or `max` for a hard or risky phase — and writes the reason in the plan's row.
   On an affordable backend the effort stays `max` (the launch policy). `--model` still changes
   only when the person asks. A `ui` phase keeps `UI_POLICY`'s floor. Find whether `crew start`
   or the agent guard refuses an effort override today without the person (`src/models/launch-policy.ts`,
   `src/crew/start.ts`, the guard's crew rules) and change only what this needs.
4. **The lead's words:** `plugin/skills/lead/SKILL.md` § 2 ("Override `--model` or `--effort` only
   when the person asks" becomes: the effort by the task, as in 3; the model only when the person
   asks; a running one changed with this command), § 3's start line, `docs/design/crew.md`,
   `README.md` (the command list). A `--continue` start keeps taking `--model` and `--effort`
   (check it does, and say so).

## Files (change nothing else)

`src/crew/command.ts`, `src/crew/args.ts`, `src/crew/usage.ts`, a new `src/crew/model.ts` (the
command), `src/crew/answer.ts` (only to reuse the resume path, if it needs a parameter),
`src/crew/start.ts` (only a shared cap check, extracted, never copied), `src/crew/store.ts` (only
if the record needs a writer), `src/models/launch-policy.ts` (only to share a check), their tests,
`plugin/skills/lead/SKILL.md`, `docs/design/crew.md`, `docs/claude-code-contract.md`, `README.md`,
`plugin/dist/*.js`. **`plugin.json` stays as it is.** Other 1.2.1 phases change `answer.ts` (AN1)
and `start.ts` (NM1, WN1, LH1): keep your change there to the shared helper.

## Setup in your worktree

Run `bun install` in your own worktree. Never link another checkout's `node_modules`. Never read
or run git in another worktree. Never stop, resume or message a session you did not start.

## Done-check

1. Tests, each seen failing first: a running crew session moved from opus to sonnet (stopped,
   resumed with the flags, the record updated); an effort change alone; a stopped one (stored,
   used at the next resume); to opus past `perLeadOpus` (queued, with the reason); a `ui` kind to
   an affordable model (refused); an unknown name (refused); a removed record (refused).
2. `bun run build`, then `bun run check` and both `claude plugin validate … --strict`.
3. Your own review, then one second opinion: the `cc-smart-dev-kit:reviewer` agent on `sonnet` at
   `high`.
4. Commit a checkpoint after each green step. Never send an empty report.
5. Before you report, stop every background check and every test session you started.
