/**
 * SubagentStop: a subagent never hands back while its own background work still runs.
 *
 * A subagent that ends its turn with a background Bash task (or a background subagent) of its
 * own still running leaves Claude Code holding the agent open: the parent already has the
 * report, the task outlives the turn, and the person's panel shows the agent as if it were
 * stuck. The fix belongs to the agent — wait for the work, or stop it, before the final
 * report (`/cc-smart-dev-kit:subagent-decision` § How to brief; `/cc-smart-dev-kit:crew` § 4)
 * — and this hook says it once when the agent did not.
 *
 * **The input's `background_tasks` is the SESSION's in-flight list, not this agent's.** Proved
 * offline on 2.1.308 (fake Anthropic, throwaway HOME): a subagent launched in the background
 * appears in its own stop's list, and a foreground subagent's stop lists the main session's
 * own background shell. So the hook keeps only the tasks the ending agent itself started: the
 * ids that appear in its own transcript (`agent_transcript_path`), where a Bash tool result
 * names the background task id and an Agent tool result names the child agent id. The ending
 * agent's own id is dropped first: every line of its transcript carries it as `agentId`, so a
 * background subagent would otherwise match itself. A task whose id is not in that transcript
 * belongs to another agent, and is none of this one's business.
 *
 * **One block, never two**: the stop a block caused carries `stop_hook_active: true`, and the
 * hook is silent there. The answer is `decision: "block"` with a plain reason and **no
 * `additionalContext`** (proved on 2.1.308: the subagent's next turn carries
 * `SubagentStop hook blocking error from command: …: <reason>`). The hook reads no setting
 * from `cc-smart-dev-kit.json`, but it is project-scoped like `review-record`: with no file it
 * stays silent, so a project that never opted in does not notice the plugin. A transcript
 * that cannot be read is **no block**: the hook cannot tell whose work it is, and a subagent
 * must always be able to finish.
 */
import { readFileSync } from "node:fs";
import { type HookInput, type HookResult, SILENT, stringField } from "./io";
import type { HookContext } from "./run";

/** What the subagent reads when it hands back too early. */
export const HAND_BACK_REASON =
  "Your background work is still running: wait for it or stop it, then report.";

/**
 * The ids of the in-flight background tasks the input lists, in order. The contract says the
 * array holds in-flight work only, so an entry's presence is its state; an entry without a
 * string id can never be matched to the agent and is dropped.
 */
export function backgroundTaskIds(input: HookInput): string[] {
  if (!Array.isArray(input.background_tasks)) return [];
  const ids: string[] = [];
  for (const task of input.background_tasks) {
    if (typeof task !== "object" || task === null || Array.isArray(task)) continue;
    const id = stringField((task as Record<string, unknown>).id);
    if (id !== null) ids.push(id);
  }
  return ids;
}

/** True when `text` names any of `ids`: the agent itself started those tasks. */
function startedByAgent(text: string, ids: readonly string[]): boolean {
  return ids.some((id) => text.includes(id));
}

export function subagentBackground(context: HookContext): HookResult {
  const { input, event, project } = context;
  // A project that never opted in must not notice the plugin (the frame reaches here with no
  // project file, `project.config === null`).
  if (project.config === null) return SILENT;
  if (event !== "SubagentStop") return SILENT;
  // The turn a block caused: never a second block for the same hand-back.
  if (input.stop_hook_active === true) return SILENT;
  // The ending agent's own entry is the session's record of THIS subagent while it stops
  // (a background subagent's list holds itself); its transcript carries its own id on every
  // line, so it must not count as background work of its own.
  const selfId = stringField(input.agent_id);
  const ids = backgroundTaskIds(input).filter((id) => id !== selfId);
  if (ids.length === 0) return SILENT;
  const transcript = stringField(input.agent_transcript_path);
  if (transcript === null) return SILENT;
  let text: string;
  try {
    // The whole transcript: the task id is in a tool result near the end of it. Read only
    // when this session has in-flight work at all, which is the rare stop.
    text = readFileSync(transcript, "utf8");
  } catch {
    // Fail open: without the transcript the hook cannot tell whose work is still running.
    return SILENT;
  }
  return startedByAgent(text, ids)
    ? { stdout: JSON.stringify({ decision: "block", reason: HAND_BACK_REASON }) }
    : SILENT;
}
