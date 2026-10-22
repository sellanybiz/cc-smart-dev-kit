/**
 * Stop: a session that changed files and did not run the project's fast check gets one
 * reminder.
 *
 * A project names its fast check once, as `checks.fast` in `.claude/cc-smart-dev-kit.json`
 * (`cc-smart-dev-kit project init` asks for it), and a session that stops after changing files
 * without running it gets **one** block naming the command, per change. The next stop — the one
 * the block caused — carries `stop_hook_active: true`, and the hook is silent there. A change
 * made after a reminder earns the next one: the transcript carries the block's own reason
 * (`Stop hook feedback: …`), so the same change is never reminded about twice, and a check that
 * fails does not trap the turn.
 *
 * **The session's own transcript is the record.** The hook reads it as JSONL, line by line,
 * in order: a `tool_use` of Edit, Write or NotebookEdit is a change (unless its result was an
 * error: a refused or failed edit changed nothing); a `tool_use` of Bash or PowerShell whose
 * line runs the check (`ranCheck`, through the one shell reader) is the check. A change after
 * the check — or with no check at all — is the block. Only the session's own work counts: a
 * subagent keeps its own transcript, and a sidechain line is skipped.
 *
 * **Silent** when the project sets no `checks.fast`, in a project with no
 * cc-smart-dev-kit.json, in a crew session (its own report gate answers, `crew-role`), on a
 * turn that still waits on background work, with no transcript path, and when the transcript
 * cannot be read — fail open, because a reminder must never stop a person's work. Only the
 * file's last `VERIFY_GATE_TAIL_BYTES` are read, like every other reader of a session's end
 * (`transcript.ts`): a check that ran before that window is not seen, so the hook may remind
 * once about a check that did run — a reminder, never a held session.
 *
 * **`notify` asks this module's decision** (`verifyGateWouldBlock`): a Stop that this hook will
 * block is not the end of the turn, so the "finished" alert waits for the stop that ends it.
 */
import { crewIdOf } from "../crew/session";
import type { CcSmartDevKitConfig } from "../project/config";
import { loadProjectConfig, locateCheckout } from "../project/resolve";
import {
  type Dialect,
  dialectOfTool,
  invocationOf,
  MAX_NESTING,
  nestedCommand,
  nestedDialect,
  shellSteps,
  wordsOf,
} from "../shell/command";
import { type HookInput, type HookResult, SILENT, stringField } from "./io";
import type { Env, HookContext } from "./run";
import { tailLines } from "./transcript";

/** How much of the transcript's end the hook reads: one turn's edits and its check runs. */
export const VERIFY_GATE_TAIL_BYTES = 4 * 1024 * 1024;

/** The tools that change a file: what the gate counts as work a check should follow. */
export const CHANGE_TOOLS = ["Edit", "Write", "NotebookEdit"] as const;

/** The words Claude Code writes before a blocked stop's reason in the transcript. */
const STOP_FEEDBACK = "Stop hook feedback:";

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

/** The blocks of one transcript line's `message.content`, when it has them. */
function blocksOf(line: Record<string, unknown>): Array<Record<string, unknown>> {
  const content = objectOf(line.message)?.content;
  if (!Array.isArray(content)) return [];
  return content.filter(
    (block): block is Record<string, unknown> => objectOf(block) !== null && block !== null,
  );
}

/** The `tool_use` blocks of one transcript line, in order. */
function toolUses(line: Record<string, unknown>): Array<Record<string, unknown>> {
  return blocksOf(line).filter((block) => block.type === "tool_use");
}

/** A tool result's text: its `content` as a string, or the text blocks of its array. */
function resultText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((block) => {
      const text = objectOf(block)?.text;
      return typeof text === "string" ? text : "";
    })
    .join("\n");
}

/** A result that says the call never changed anything: refused by the person or a guard. */
const REFUSED = /(doesn't want to proceed|tool use was rejected|has been denied)/i;

/**
 * The tool calls whose result was an error, by `tool_use_id`. An Edit that failed or was
 * refused changed no file, so it is no reason to ask for the check.
 */
function failedCalls(lines: readonly string[]): Set<string> {
  const failed = new Set<string>();
  for (const line of lines) {
    if (!line.includes('"tool_result"')) continue;
    let entry: unknown;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    const record = objectOf(entry);
    if (record === null) continue;
    for (const block of blocksOf(record)) {
      if (block.type !== "tool_result") continue;
      const id = stringField(block.tool_use_id);
      if (id === null) continue;
      const text = resultText(block.content);
      if (block.is_error === true || REFUSED.test(text)) failed.add(id);
    }
  }
  return failed;
}

/** The words the line's commands hand their programs, nested commands included, in order. */
function runWords(line: string, dialect: Dialect, depth = 0): string[] {
  if (depth > MAX_NESTING) return [];
  const words: string[] = [];
  for (const step of shellSteps(line, { blindWhenOpen: true, dialect, joinLines: true })) {
    const command = wordsOf(step.text, dialect);
    words.push(...command);
    const invocation = invocationOf(command);
    if (invocation === undefined) continue;
    const inner = nestedCommand(invocation.program, invocation.args, step.pipedFrom);
    if (inner !== undefined) {
      words.push(...runWords(inner, nestedDialect(invocation.program), depth + 1));
    }
  }
  return words;
}

/** True when `wanted` sits in `run`, in order and unbroken. */
function contains(run: readonly string[], wanted: readonly string[]): boolean {
  for (let at = 0; at + wanted.length <= run.length; at += 1) {
    if (wanted.every((word, index) => run[at + index] === word)) return true;
  }
  return false;
}

/**
 * True when this shell line ran the project's fast check: the check's own command words
 * appear, in order and unbroken, among the words the line's commands run, as the one shell
 * reader (`src/shell/command.ts`) reads them. So `bun run check:neutral` is not
 * `bun run check`, a wrapper or a `bash -c "…"` is read through, and a line that only quotes
 * the check (`echo "bun run check"`) runs it not. Not told the tool, the line is read both
 * ways, like every guard that is not told it (`readingsOf`).
 */
export function ranCheck(command: string, check: string, dialect?: Dialect): boolean {
  const dialects: readonly Dialect[] = dialect === undefined ? ["bash", "powershell"] : [dialect];
  return dialects.some((one) => {
    const wanted = runWords(check, one);
    return wanted.length > 0 && contains(runWords(command, one), wanted);
  });
}

/** True when this line carries the Stop feedback of this hook's own reminder. */
function isOwnReminder(line: Record<string, unknown>, check: string): boolean {
  const content = objectOf(line.message)?.content;
  const texts =
    typeof content === "string"
      ? [content]
      : blocksOf(line)
          .map((block) => (typeof block.text === "string" ? block.text : ""))
          .filter((text) => text !== "");
  const reason = verifyGateReason(check);
  return texts.some((text) => text.includes(STOP_FEEDBACK) && text.includes(reason));
}

/** Where the last change, the last run of the check and the last reminder are: -1 when absent. */
export interface SeenIn {
  lastEdit: number;
  lastCheck: number;
  lastReminder: number;
}

/** The transcript's last change, last check and last reminder of this hook, from its lines. */
export function seenIn(lines: readonly string[], check: string): SeenIn {
  const seen: SeenIn = { lastEdit: -1, lastCheck: -1, lastReminder: -1 };
  const failed = failedCalls(lines);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    // Most lines are prose or results: do not parse them.
    if (!line.includes('"tool_use"') && !line.includes(STOP_FEEDBACK)) continue;
    let entry: unknown;
    try {
      entry = JSON.parse(line);
    } catch {
      continue; // The tail's first line may be cut, and its last one half written.
    }
    const record = objectOf(entry);
    // A sidechain line is a subagent's own conversation: not this session's change.
    if (record === null || record.isSidechain === true) continue;
    if (isOwnReminder(record, check)) seen.lastReminder = index;
    for (const block of toolUses(record)) {
      const name = stringField(block.name);
      if (name !== null && (CHANGE_TOOLS as readonly string[]).includes(name)) {
        if (!failed.has(stringField(block.id) ?? "")) seen.lastEdit = index;
        continue;
      }
      // A shell line only: Bash or PowerShell, in that tool's own dialect.
      const dialect = dialectOfTool(name);
      if (dialect === undefined) continue;
      const command = stringField(objectOf(block.input)?.command);
      if (command !== null && ranCheck(command, check, dialect)) seen.lastCheck = index;
    }
  }
  return seen;
}

/**
 * The decision, from the input and the project's file alone: what `verifyGate` answers, and
 * what `notify` asks, so its "finished" alert lands at the real end of the turn.
 */
export function verifyGateWouldBlock(
  input: HookInput,
  config: CcSmartDevKitConfig | null,
  env: Env,
): boolean {
  // A project that never opted in must not notice the plugin.
  if (config === null) return false;
  // The stop a block caused: never a second block for the same turn.
  if (input.stop_hook_active === true) return false;
  // A crew session has its own gate: the report (`crew-role`).
  if (crewIdOf(env) !== null) return false;
  // A turn that waits on background work is not over: Claude Code wakes the session when it lands.
  if (Array.isArray(input.background_tasks) && input.background_tasks.length > 0) return false;
  const check = config.checks?.fast;
  if (check === undefined) return false;
  const transcript = stringField(input.transcript_path);
  if (transcript === null) return false;
  // Fail open: without the transcript the hook cannot tell what changed.
  const lines = tailLines(transcript, VERIFY_GATE_TAIL_BYTES);
  if (lines === null) return false;
  const seen = seenIn(lines, check);
  // One reminder per change: a change already reminded about earns no second one, and a
  // change made after that reminder earns the next one.
  return seen.lastEdit > Math.max(seen.lastCheck, seen.lastReminder);
}

/** `verifyGateWouldBlock` at the input's own folder: the project read as the frame reads it. */
export function verifyGateWouldBlockAt(input: HookInput, env: Env): boolean {
  const cwd = stringField(input.cwd);
  if (cwd === null) return false;
  try {
    const checkout = locateCheckout(cwd, { env });
    return (
      checkout !== null && verifyGateWouldBlock(input, loadProjectConfig(checkout).config, env)
    );
  } catch {
    // A project that cannot be read asks nothing of a sibling hook either.
    return false;
  }
}

export function verifyGate(context: HookContext): HookResult {
  if (context.event !== "Stop") return SILENT;
  if (!verifyGateWouldBlock(context.input, context.project.config, context.env)) return SILENT;
  const check = context.project.config?.checks?.fast ?? "";
  return { stdout: JSON.stringify({ decision: "block", reason: verifyGateReason(check) }) };
}
