import type { HookSpec } from "../run";
import { subagentBackground } from "../subagent-background";

/**
 * The subagent's hand-back (`subagent-background.ts`): a subagent never ends its turn while
 * background work it started still runs — it waits for the work or stops it, then reports.
 * SubagentStop only, and like `review-record` it **touches no worktree**, the one kind of
 * plugin SubagentStop entry `hooks.md` allows. It reads no setting, but it is still
 * project-scoped: with no cc-smart-dev-kit.json it stays silent. A broken or too new file is
 * one stderr line, exit 0 (an informational hook never stops a subagent), and a transcript it
 * cannot read is no block at all: the hook cannot tell whose background work is running.
 */
export const subagentBackgroundHook: HookSpec = {
  name: "subagent-background",
  events: ["SubagentStop"],
  onConfigProblem: (message) => ({
    stderr: `cc-smart-dev-kit subagent-background: ${message}`,
  }),
  run: subagentBackground,
};
