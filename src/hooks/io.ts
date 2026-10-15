/**
 * What a hook reads and what it answers (the Claude Code hook contract:
 * `docs/claude-code-contract.md` § Hooks).
 *
 * A hook gets one JSON object on stdin. It answers with its exit code, its stdout (the
 * contract's answer and nothing else) and one short line on stderr when something is worth
 * saying. The functions here build those answers; `run.ts` writes them.
 */

/** The fields of a hook's input that the plugin reads. Anything else is ignored. */
export interface HookInput {
  hook_event_name?: unknown;
  session_id?: unknown;
  cwd?: unknown;
  /** SessionStart: "startup", "resume", "clear" or "compact". */
  source?: unknown;
  /** WorktreeCreate. */
  name?: unknown;
  /** WorktreeRemove. */
  worktree_path?: unknown;
  /** SubagentStop. */
  agent_id?: unknown;
  agent_type?: unknown;
  /** PreToolUse, PostToolUse, PostToolUseFailure. */
  tool_name?: unknown;
  tool_input?: unknown;
  tool_response?: unknown;
  /** UserPromptSubmit. */
  prompt?: unknown;
}

/** A hook's answer. Nothing set: exit 0, nothing printed. */
export interface HookResult {
  exitCode?: number;
  stdout?: string;
  /** One short line, without the line break. */
  stderr?: string;
}

/** Nothing to do: exit 0, no output. */
export const SILENT: HookResult = {};

/** The input as an object, or null when it is not a JSON object. */
export function parseHookInput(text: string): HookInput | null {
  try {
    const value: unknown = JSON.parse(text);
    return typeof value === "object" && value !== null && !Array.isArray(value)
      ? (value as HookInput)
      : null;
  } catch {
    return null;
  }
}

/** A string field of the input, or null. */
export function stringField(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

/** The tool input as an object (empty when it is not one). */
export function toolInput(input: HookInput): Record<string, unknown> {
  const value = input.tool_input;
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/**
 * A PreToolUse decision. "deny": the reason goes to Claude. "ask": the person is asked, and
 * the reason is shown to them (Claude Code labels it `[plugin:anymodel]`).
 */
export function toolDecision(decision: "ask" | "deny", reason: string): HookResult {
  return {
    stdout: JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: decision,
        permissionDecisionReason: reason,
      },
    }),
  };
}

/** Text added to Claude's context (SessionStart, UserPromptSubmit, PostToolUse, …). */
export function addContext(event: string, text: string): HookResult {
  return {
    stdout: JSON.stringify({
      hookSpecificOutput: { hookEventName: event, additionalContext: text },
    }),
  };
}
