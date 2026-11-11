/**
 * `cc-smart-dev-kit subagent-statusline`: the plugin's row body for each subagent in Claude
 * Code's agent panel — the slot the subagent's requests reach, the model Claude Code resolved
 * for it, and the effort it runs at (MD-13: `slot → model → effort`).
 *
 * **How Claude Code reads it** (`plugin/settings.json`, proved offline on 2.1.308:
 * `docs/claude-code-contract.md`): once per refresh tick it runs the plugin's
 * `subagentStatusLine` command with one JSON object on stdin — `columns` (the usable row
 * width) and `tasks`, one entry per visible subagent (`id`, `agentType`, `model`, `effort`,
 * `label`, …). The command answers one JSON line per row it overrides,
 * `{"id": "<task id>", "content": "<row body>"}`; a task it leaves out keeps Claude Code's own
 * row, and an empty `content` hides the row. **The body replaces `name · description · token
 * count`**, so the label comes first here and the route after it: who the agent is, then
 * where its requests go.
 *
 * **The command is a stable path, never `${CLAUDE_PLUGIN_ROOT}`**: a plugin's settings file
 * does not expand that variable in a command (proved: the literal string ran, exit 127). So
 * `plugin/settings.json` names the launcher `$HOME/.local/bin/cc-smart-dev-kit`, which setup
 * writes and which runs the installed version — the same route the notifier's user-level hook
 * takes, and one an update cannot break.
 *
 * **The slot comes from the model's Claude family** (`familySlotFor`, the router's own
 * mapping): `sonnet` → worker, `haiku` → scout, and the opus and fable model slots. It is the
 * slot the request reaches when the gateway is on; with no chain the slot is off and Claude
 * answers it, which is what the row means. A model with no family shows `?` in the slot.
 *
 * **The context use** comes after the route: `~45k/200k ctx (23%)`, from the task's `tokenCount`
 * and `contextWindowSize`. What `tokenCount` is, read in Claude Code 2.1.310's binary (read
 * only) and in its docs ("running token count of the subagent … so you can render a per-row
 * percentage from `tokenCount`"): the last request's whole input (input + cache creation +
 * cache read) plus every output token the agent has written so far, plus an estimate for the
 * answer still streaming. So it is the current context, a little too high: the earlier answers
 * are in the last input and counted again in the outputs. It is not a total over all requests.
 * `tokenSamples` is only the last 16 readings of `tokenCount`, so it adds nothing. The `~` says
 * "about". Either field missing or not a number leaves the part out (no window: `~45k ctx`), and
 * so does a count of zero (Claude Code sends 0 before the first reading). The sizes are
 * `formatTokens`, the main status line's own form. Not yet proved live (`docs/claude-code-contract.md`).
 *
 * Every field is text Claude Code hands over (the label can hold a model's words), so each
 * goes through `oneLine` first: one line, no control characters, cut to the row's own width.
 * A broken input prints nothing at all and exits 0 — a status line never breaks a session.
 */

import { COMMAND } from "../build-info";
import { type LastAnswer, lastAnswer } from "../gateway/history-read";
import { cutText, oneLine } from "../gateway/plain-text";
import { answerTargetName } from "../gateway/target-label";
import { familySlotFor } from "../gateway/targets";
import { sessionGatewayOf } from "../hooks/agent-guard";
import type { Env } from "../hooks/run";
import type { CliPaths } from "./paths";
import { formatTokens } from "./statusline-context";

/** One task's row body, as Claude Code reads it back. */
export interface SubagentRow {
  content: string;
  id: string;
}

/** One visible subagent, the fields this row reads (the rest is ignored). */
export interface StatusTask {
  agentType: null | string;
  /** The model's context window in tokens; null when the input has none. */
  contextWindowSize: null | number;
  effort: null | string;
  id: string;
  label: null | string;
  model: null | string;
  /** The running token count (see the header); null when the input has none. */
  tokenCount: null | number;
}

/** The longest row body when the input names no width: a terminal's usual 80 columns. */
const DEFAULT_COLUMNS = 80;

/** The shortest body worth printing: below it the row says nothing a person can read. */
const MIN_COLUMNS = 20;

/** The fewest label characters (mark included) worth keeping in front of the route. */
const MIN_LABEL = 6;

/** Between the parts of a row body. */
const SEPARATOR = " · ";

/** A number Claude Code sent, when it is a finite one; null for a missing or garbled field. */
function count(value: unknown): null | number {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function text(value: unknown): null | string {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

/** The tasks of a status-line input, in order; none when the input is not one. */
export function statusTasks(input: unknown): StatusTask[] {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return [];
  const tasks = (input as Record<string, unknown>).tasks;
  if (!Array.isArray(tasks)) return [];
  const out: StatusTask[] = [];
  for (const task of tasks) {
    if (typeof task !== "object" || task === null || Array.isArray(task)) continue;
    const one = task as Record<string, unknown>;
    const id = text(one.id);
    if (id === null) continue;
    out.push({
      agentType: text(one.agentType),
      contextWindowSize: count(one.contextWindowSize),
      effort: text(one.effort),
      id,
      label: text(one.label) ?? text(one.description) ?? text(one.name),
      model: text(one.model),
      tokenCount: count(one.tokenCount),
    });
  }
  return out;
}

/**
 * The slot a resolved model reaches, as the router names it (`worker`, `scout`, `opus`,
 * `fable`); null for a model that names no Claude family. The slot key's own prefix is the
 * command's name, so it comes from that one place.
 */
export function slotOf(model: null | string): null | string {
  const found = familySlotFor(model);
  if (found === null) return null;
  const prefix = `${COMMAND}-`;
  return found.slot.startsWith(prefix) ? found.slot.slice(prefix.length) : found.slot;
}

/**
 * The subagent's context use: `~45k/200k ctx (23%)`. The window is left out when the input has
 * none (`~45k ctx`); nothing at all when there is no reading yet. The `~` is honest: the count
 * is an estimate, a little above the real context (see the header).
 */
export function contextPart(task: StatusTask): null | string {
  const tokens = task.tokenCount;
  if (tokens === null || tokens <= 0) return null;
  const window = task.contextWindowSize;
  if (window === null || window <= 0) return `~${formatTokens(tokens)} ctx`;
  const percent = Math.round((tokens / window) * 100);
  return `~${formatTokens(tokens)}/${formatTokens(window)} ctx (${percent}%)`;
}

/**
 * Where one subagent's requests go: `slot → model → effort`, who it is in front, and its
 * context use after.
 *
 * **The context survives a cut.** Claude Code gives the row `columns` and the body is cut at the
 * end, so the context would go first. When the whole body is too wide, the label shrinks
 * instead (down to `MIN_LABEL` characters), so the route and the context stay whole. When even
 * the route and the context together do not fit, the context goes in front of the route and the
 * end is cut.
 */
export function rowContent(
  task: StatusTask,
  columns = DEFAULT_COLUMNS,
  answer: LastAnswer | null = null,
): string {
  const slot = slotOf(task.model) ?? "?";
  const model =
    answer === null || answer.target === "anthropic"
      ? (task.model ?? "model not resolved yet")
      : answerTargetName(answer.target);
  // Claude Code leaves the effort out when it set none: the model's own default answers.
  const effort = task.effort ?? "default effort";
  const route = `${slot} → ${model} → ${effort}`;
  const context = contextPart(task);
  // One column goes to the mark, so a cut body still fits the row it is drawn in.
  const width = Math.max(MIN_COLUMNS, Math.trunc(columns));
  const room = width - 1;
  const cut = (body: string): string => oneLine(body, room, { mark: "…" });
  if (context === null) return cut(task.label === null ? route : `${task.label} · ${route}`);

  const tail = `${route}${SEPARATOR}${context}`;
  if (task.label === null)
    return tail.length <= room ? cut(tail) : cut(`${context}${SEPARATOR}${route}`);
  const label = oneLine(task.label, Number.MAX_SAFE_INTEGER);
  const whole = `${label}${SEPARATOR}${tail}`;
  if (whole.length <= room) return cut(whole);
  // The label's share, mark included.
  const labelRoom = room - tail.length - SEPARATOR.length;
  if (labelRoom >= MIN_LABEL) {
    const short = `${cutText(label, labelRoom - 1).trimEnd()}…`;
    return cut(`${short}${SEPARATOR}${tail}`);
  }
  return tail.length <= room ? cut(tail) : cut(`${context}${SEPARATOR}${route}`);
}

/** The rows an input makes: one per task, each with its own body. */
export function subagentRows(
  input: unknown,
  answers: ReadonlyMap<string, LastAnswer> = new Map(),
): SubagentRow[] {
  const columns =
    typeof input === "object" &&
    input !== null &&
    !Array.isArray(input) &&
    typeof (input as Record<string, unknown>).columns === "number"
      ? ((input as Record<string, unknown>).columns as number)
      : DEFAULT_COLUMNS;
  return statusTasks(input).map((task) => ({
    content: rowContent(task, columns, answers.get(task.id) ?? null),
    id: task.id,
  }));
}

/** Runs the command: stdin in, one JSON line per row out. Never fails a session. */
export async function runSubagentStatusline(
  read: () => Promise<string> = () => Bun.stdin.text(),
  paths?: CliPaths,
  env: Env = {},
): Promise<number> {
  let input: unknown = null;
  try {
    const raw = await read();
    input = raw.trim() === "" ? null : JSON.parse(raw);
  } catch {
    // Not JSON: no rows, and the session goes on.
    return 0;
  }
  const answers = new Map<string, LastAnswer>();
  if (
    paths !== undefined &&
    typeof input === "object" &&
    input !== null &&
    "session_id" in input &&
    typeof input.session_id === "string"
  ) {
    const session = sessionGatewayOf(paths, env);
    if (session.gatewayOn)
      for (const task of statusTasks(input)) {
        const answer = lastAnswer(paths.historyDbFile, input.session_id, task.id, session.profile);
        if (answer !== null) answers.set(task.id, answer);
      }
  }
  for (const row of subagentRows(input, answers)) console.log(JSON.stringify(row));
  return 0;
}
