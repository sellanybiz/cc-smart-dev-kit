import { SILENT } from "../io";
import { KEEP_GOING, keepGoing, keepGoingAnswer } from "../keep-going";
import type { HookSpec } from "../run";

/**
 * The keep-going guard (`keep-going.ts`): Stop, one **block per stalled state** when a phase of
 * a plan this Claude process works on is `in_progress`, no background work runs
 * (`background_tasks`), and the turn's last answer has no `Waiting for:` line. The same reason
 * already given, with no subagent started or resumed since, keeps it silent
 * (`stopFeedbackGiven`). It names the builder to resume with `SendMessage` (or a phase needing a
 * fresh builder), the next ready phase, and how to close or record a blocker, and warns against
 * moving a phase back to pending to end the turn. When the own plan gives no reason, it also
 * names what a lead's plans wait on (`leadPlansReason`), from the store's classifier alone:
 * `herdr wait` for plans with a running child, `herdr plans --wait` for closed plans whose pull
 * request is not merged yet, `herdr start --plan <slug>` for a child that is gone. It runs no
 * git, gh or hc. It reads no setting
 * and needs no cc-smart-dev-kit.json: the task store is the person's own, so it runs in a project
 * with no file and honors `ownHooks` where there is one. Silent outside git (the frame's
 * default), on the stop its own block caused (`stop_hook_active`), or with no readable task
 * store or caller. An unreadable transcript keeps the decision. A broken or too new file changes
 * nothing: the hook reads no setting of it, so it judges the same way
 * (`.claude/rules/hooks-guards.md` § Fail closed).
 */
export const keepGoingHook: HookSpec = {
  name: KEEP_GOING,
  events: ["Stop"],
  onConfigProblem: (_message, input, event, checkout, context) =>
    event === "Stop" ? keepGoingAnswer(input, checkout, context.paths, context.env) : SILENT,
  run: keepGoing,
};
