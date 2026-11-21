import type { HookSpec } from "../run";
import { tierView } from "../tier-view";

/**
 * The tier note (`tier-view.ts`): at every SessionStart, and at a UserPromptSubmit when it
 * changed, one note to Claude of what each subagent tier (`haiku`, `sonnet`, `opus`, `fable`)
 * runs now and the effort rule that follows, read the launch judge's way. **Machine-wide**, like
 * `agent-guard`: it runs with or without cc-smart-dev-kit.json and in a folder outside git, and
 * never a question or a block. Its SessionStart entry carries **no
 * matcher**, so a start, a resume, a clear and a compaction each say it. A project that runs its
 * own copy silences it through `ownHooks`.
 */
export const tierViewHook: HookSpec = {
  name: "tier-view",
  events: ["SessionStart", "UserPromptSubmit"],
  onConfigProblem: (_message, input, _event, _checkout, context) =>
    tierView(input, context.env, context.paths),
  outsideGit: (input, _event, _why, context) => tierView(input, context.env, context.paths),
  run: ({ input, env, paths }) => tierView(input, env, paths),
};
