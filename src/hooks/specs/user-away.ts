import { guardCrash } from "../guard-crash";
import type { HookSpec } from "../run";
import { inAwayDomain, userAwayAnswer } from "../user-away";

/**
 * While the person cannot answer (`cc-smart-dev-kit user unavailable`): the two tools that ask
 * them are refused with the step to take the recommended option and record a decision (nothing
 * is parked), and one note per change is said at the prompt — or, for a session the person never
 * prompts, by one block at its stop (`user-away.ts`). Claude Code's own permission prompt is not
 * answered: a hook never approves for the person, so the event is not wired.
 *
 * **Machine-wide**, like `job-route`: the person is one for the whole machine, so the answer
 * reads the state file and never the project's, and a broken or too new project file, and a
 * folder outside git, are judged the same way. **`alwaysOn`**: `ownHooks` cannot switch it off —
 * the switch is the person's, and a project must not be able to turn it off for a session. A
 * crash asks about the calls in its domain (the two question tools), like any guard; on the other
 * two events it says one line on stderr and the session goes on.
 */
export const userAwayHook: HookSpec = {
  name: "user-away",
  events: ["PreToolUse", "UserPromptSubmit", "Stop"],
  alwaysOn: true,
  onConfigProblem: (_message, input, event, _checkout, context) =>
    userAwayAnswer(input, event, context.env, context.paths, context.nowMs),
  outsideGit: (input, event, _why, context) =>
    userAwayAnswer(input, event, context.env, context.paths, context.nowMs),
  // The two tools that ask the person are a guard's domain: a crash asks about them, as any guard
  // does. On the other two events there is no call to ask about; the crash is one line on
  // stderr, and the prompt's text, or the stop goes on as it would without this hook.
  onCrash: (why, input, event, context) =>
    event === "UserPromptSubmit" || event === "Stop"
      ? { stderr: `cc-smart-dev-kit user-away: ${why}` }
      : guardCrash("whether the person is available", inAwayDomain)(why, input, event, context),
  run: ({ input, event, env, paths, nowMs }) => userAwayAnswer(input, event, env, paths, nowMs),
};
