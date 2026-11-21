import { recordsReview } from "../../workflow/reviews";
import { workflowDefaults } from "../../workflow/schema";
import { SILENT } from "../io";
import { agentTypeOf, reviewRecord } from "../review-record";
import type { HookSpec } from "../run";

/**
 * The review record: SubagentStart notes the commit a review agent (`workflow.reviewAgents`,
 * default: the plugin's own reviewer) starts on, and SubagentStop records it when the agent
 * stops on that same commit — what merge-check reads before a merge it would make with
 * no person watching (`src/hooks/review-record.ts`, the whole story).
 *
 * A plugin-wired SubagentStop is safe for THIS hook because it never touches a worktree
 * (`.claude/rules/hooks.md`). SubagentStart cannot block a launch, and this hook adds no
 * context to either event, so its answers are silence and stderr only.
 */
export const reviewRecordHook: HookSpec = {
  name: "review-record",
  events: ["SubagentStart", "SubagentStop"],
  onConfigProblem: (message, input, event) => {
    // Which agents record is in the project's file, so with no usable file the built-in list
    // decides whether this is even about a review: one stderr line when it is, silence when
    // it is not, like `after-merge` only speaks after a merge. Said once, at the stop, where
    // the review would have been recorded.
    const agent = agentTypeOf(input);
    return event === "SubagentStop" &&
      agent !== null &&
      recordsReview(agent, workflowDefaults.reviewAgents)
      ? { stderr: `cc-smart-dev-kit review-record: ${message}` }
      : SILENT;
  },
  run: reviewRecord,
};
