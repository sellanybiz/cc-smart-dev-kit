import { recordAgentUsage } from "../agent-usage";
import type { HookSpec } from "../run";

/**
 * Each subagent's usage (`agent-usage.ts`): on its stop, one line in `agent-usage.jsonl` — the
 * time, the session, the agent and its type, and per model the replies, the four token counts
 * and the estimated USD — what `usage` shows and a portal can read. **Machine-wide**: the
 * person's spend is the machine's, not a project's, so it records with no
 * `cc-smart-dev-kit.json` and outside git, like the launch record `usage` reads. A project
 * that runs its own copy lists the name in `ownHooks`. It touches no worktree, the one kind of
 * plugin SubagentStop entry `hooks.md` allows, and it answers nothing on stdout: one stderr
 * line when its record cannot be made, exit 0.
 */
export const agentUsageHook: HookSpec = {
  name: "agent-usage",
  events: ["SubagentStop"],
  onConfigProblem: (_message, input, event, _checkout, context) =>
    recordAgentUsage(input, event, context.paths, context.nowMs),
  outsideGit: (input, event, _why, context) =>
    recordAgentUsage(input, event, context.paths, context.nowMs),
  run: ({ input, event, paths, nowMs }) => recordAgentUsage(input, event, paths, nowMs),
};
