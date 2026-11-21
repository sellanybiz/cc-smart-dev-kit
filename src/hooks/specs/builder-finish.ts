import { builderFinish, builderFinishAnswer } from "../builder-finish";
import type { HookSpec } from "../run";

/**
 * The builder's hand-back (`builder-finish.ts`): a builder subagent never hands back while the
 * task its brief names (`Your task: #<n>`) still has open blocking steps — it closes or drops
 * each, then reports. SubagentStop only, and like `subagent-background` it **touches no
 * worktree**, the one kind of plugin SubagentStop entry `hooks.md` allows; the two never
 * answer the same thing (that one blocks for running background work, this one for open
 * steps). **Machine-wide**, like `keep-going`: it reads only the person's own task list, so it
 * judges the same with no cc-smart-dev-kit.json and with a broken or too new one, and honors
 * `ownHooks` where a file lists it. Anything it cannot read lets the builder finish.
 */
export const builderFinishHook: HookSpec = {
  name: "builder-finish",
  events: ["SubagentStop"],
  onConfigProblem: (_message, input, event, checkout, context) =>
    builderFinishAnswer(input, event, checkout, context.paths),
  run: builderFinish,
};
