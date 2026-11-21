import { afterMerge, mergesPullRequest } from "../after-merge";
import { addContext, SILENT, stringField, toolInput } from "../io";
import type { HookSpec } from "../run";

export const afterMergeHook: HookSpec = {
  name: "after-merge",
  events: ["PostToolUse", "PostToolUseFailure"],
  onConfigProblem: (message, input, event) => {
    const command = stringField(toolInput(input).command);
    return command !== null && mergesPullRequest(command)
      ? addContext(event, `cc-smart-dev-kit: ${message}`)
      : SILENT;
  },
  run: afterMerge,
};
