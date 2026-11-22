import type { HookSpec } from "../run";
import { taskStart } from "../task-start";

export const taskStartHook: HookSpec = {
  name: "task-start",
  events: ["SessionStart"],
  onConfigProblem: (_message, input, _event, _checkout, context) =>
    taskStart(input, context.paths, context.env),
  outsideGit: (input, _event, _why, context) => taskStart(input, context.paths, context.env),
  run: ({ input, paths, env, project }) => taskStart(input, paths, env, project),
};
