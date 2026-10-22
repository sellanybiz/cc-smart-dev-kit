/**
 * Stop: a session that changed files and did not run the project's fast check gets one
 * reminder.
 *
 * A project names its fast check once, as `checks.fast` in `.claude/cc-smart-dev-kit.json`
 * (`cc-smart-dev-kit project init` asks for it), and a session that stops after changing files
 * without running it gets **one** block naming the command. The next stop — the one the block
 * caused — carries `stop_hook_active: true`, and the hook is silent there: a check that fails
 * does not trap the turn; it simply gets no second reminder.
 *
 * **The session's own transcript is the record.** The hook reads it as JSONL, line by line,
 * in order: a `tool_use` of Edit, Write or NotebookEdit is a change; a `tool_use` of Bash
 * whose command runs the check (`ranCheck`) is the check. A change after the check — or with
 * no check at all — is the block. Only the session's own work counts: a sidechain line is a
 * subagent's conversation (`isSidechain`).
 *
 * **Silent** when the project sets no `checks.fast`, in a project with no
 * cc-smart-dev-kit.json, in a crew session (its own report gate answers, `crew-role`), on a
 * turn that still waits on background work, with no transcript path, and when the transcript
 * cannot be read — fail open, because a reminder must never stop a person's work. Only the
 * file's last `VERIFY_GATE_TAIL_BYTES` are read, like every other reader of a session's end
 * (`transcript.ts`): a check that ran before that window is not seen, so the hook may remind
 * once about a check that did run — a reminder, never a held session.
 */
import { crewIdOf } from "../crew/session";
import { type HookResult, SILENT, stringField } from "./io";
import type { HookContext } from "./run";
import { tailLines } from "./transcript";

/** How much of the transcript's end the hook reads: one turn's edits and its check runs. */
export const VERIFY_GATE_TAIL_BYTES = 4 * 1024 * 1024;

/** The tools that change a file: what the gate counts as work a check should follow. */
export const CHANGE_TOOLS = ["Edit", "Write", "NotebookEdit"] as const;

/** The reminder; the command is the project's own, as its file writes it. */
export function verifyGateReason(check: string): string {
  return `This session changed files and has not run the project's fast check since: run \`${check}\`, then stop.`;
}

/** The value as a JSON object, when it is one. */
function objectOf(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** The `tool_use` blocks of one transcript line: its `message.content`, in order. */
function toolUses(line: Record<string, unknown>): Array<Record<string, unknown>> {
  const content = objectOf(line.message)?.content;
  if (!Array.isArray(content)) return [];
  return content
    .map(objectOf)
    .filter(
      (block): block is Record<string, unknown> => block !== null && block.type === "tool_use",
    );
}

/** One command line as compared: outer whitespace trimmed, every run of spaces as one. */
function flattened(command: string): string {
  return command.trim().replace(/\s+/g, " ");
}

/**
 * True when this Bash command line ran the project's fast check: the check's own words are in
 * it, however the line wraps them (`cd … &&`, `timeout 300`, a pipe to `tail`). A line that
 * only quotes the check (`echo "bun run typecheck"`) counts too: the hook errs towards
 * silence, and the cost of that mistake is one reminder fewer.
 */
export function ranCheck(command: string, check: string): boolean {
  const wanted = flattened(check);
  return wanted !== "" && flattened(command).includes(wanted);
}

/** Where the last change and the last run of the check are, by transcript line: -1 when absent. */
export interface SeenIn {
  lastEdit: number;
  lastCheck: number;
}

/** The transcript's last change and last check, from its lines in order. */
export function seenIn(lines: readonly string[], check: string): SeenIn {
  const seen: SeenIn = { lastEdit: -1, lastCheck: -1 };
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    if (line.trim() === "") continue;
    let entry: unknown;
    try {
      entry = JSON.parse(line);
    } catch {
      continue; // The tail's first line may be cut, and its last one half written.
    }
    const record = objectOf(entry);
    // A sidechain line is a subagent's own conversation: not this session's change.
    if (record === null || record.isSidechain === true) continue;
    for (const block of toolUses(record)) {
      const name = stringField(block.name);
      if (name !== null && (CHANGE_TOOLS as readonly string[]).includes(name)) {
        seen.lastEdit = index;
        continue;
      }
      if (name !== "Bash") continue;
      const command = stringField(objectOf(block.input)?.command);
      if (command !== null && ranCheck(command, check)) seen.lastCheck = index;
    }
  }
  return seen;
}

export function verifyGate(context: HookContext): HookResult {
  const { input, event, project, env } = context;
  // A project that never opted in must not notice the plugin (the frame reaches here with no
  // project file, `project.config === null`).
  if (project.config === null) return SILENT;
  if (event !== "Stop") return SILENT;
  // The stop a block caused: never a second block for the same turn.
  if (input.stop_hook_active === true) return SILENT;
  // A crew session has its own gate: the report (`crew-role`).
  if (crewIdOf(env) !== null) return SILENT;
  // A turn that waits on background work is not over: Claude Code wakes the session when it lands.
  if (Array.isArray(input.background_tasks) && input.background_tasks.length > 0) return SILENT;
  const check = project.config.checks?.fast;
  if (check === undefined) return SILENT;
  const transcript = stringField(input.transcript_path);
  if (transcript === null) return SILENT;
  const lines = tailLines(transcript, VERIFY_GATE_TAIL_BYTES);
  // Fail open: without the transcript the hook cannot tell what changed.
  if (lines === null) return SILENT;
  const seen = seenIn(lines, check);
  return seen.lastEdit > seen.lastCheck
    ? { stdout: JSON.stringify({ decision: "block", reason: verifyGateReason(check) }) }
    : SILENT;
}
