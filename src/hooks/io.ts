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
  /** SessionStart: the model this session runs on, when Claude Code names it. */
  model?: unknown;
  /**
   * PostModelSwitch: the resolved model the session ran BEFORE the switch, and the one it runs
   * AFTER it. Claude Code 2.1.302's own input schema (`from_model`, `to_model`), read from the
   * installed binary: `docs/claude-code-contract.md` § Instructions, skills and agents.
   */
  from_model?: unknown;
  to_model?: unknown;
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
  /** PreToolUse, PostToolUse: the tool call's id (the model's `tool_use` block). */
  tool_use_id?: unknown;
  /** UserPromptSubmit. */
  prompt?: unknown;
  /** The session's transcript: every event carries it (StopFailure, PreToolUse, …). */
  transcript_path?: unknown;
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
 * the reason is shown to them (Claude Code labels it `[plugin:cc-smart-dev-kit]`).
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

/**
 * The reason of an answer that asks the person, or null when the answer is not an ask.
 * The frame reads it to record the question (`src/hooks/ask-log.ts`): an answer that is
 * not our own JSON is not an ask.
 */
export function askReason(result: HookResult): string | null {
  if (result.stdout === undefined) return null;
  try {
    const value = JSON.parse(result.stdout) as {
      hookSpecificOutput?: { permissionDecision?: unknown; permissionDecisionReason?: unknown };
    };
    const output = value.hookSpecificOutput;
    if (output?.permissionDecision !== "ask") return null;
    return typeof output.permissionDecisionReason === "string"
      ? output.permissionDecisionReason
      : "";
  } catch {
    return null;
  }
}

/** Text added to Claude's context (SessionStart, UserPromptSubmit, PostToolUse, …). */
export function addContext(event: string, text: string): HookResult {
  return {
    stdout: JSON.stringify({
      hookSpecificOutput: { hookEventName: event, additionalContext: text },
    }),
  };
}

/**
 * A line for the person, shown in Claude Code's own UI and **not** given to Claude: the
 * `systemMessage` output field ("Display a message to the user (all hooks)" —
 * `docs/claude-code-contract.md`). Never an error and never a block: the session goes on.
 */
export function systemMessage(text: string): HookResult {
  return { stdout: JSON.stringify({ systemMessage: text }) };
}
