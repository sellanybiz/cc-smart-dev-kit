import { addContext } from "../io";
import type { HookSpec } from "../run";
import { worktreeLeftovers } from "../worktree-leftovers";

export const worktreeLeftoversHook: HookSpec = {
  name: "worktree-leftovers",
  events: ["SessionStart"],
  onConfigProblem: (message, _input, event) => addContext(event, `cc-smart-dev-kit: ${message}`),
  run: worktreeLeftovers,
};
