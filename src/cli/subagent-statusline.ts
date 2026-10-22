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
 * Every field is text Claude Code hands over (the label can hold a model's words), so each
 * goes through `oneLine` first: one line, no control characters, cut to the row's own width.
 * A broken input prints nothing at all and exits 0 — a status line never breaks a session.
 */
import { COMMAND } from "../build-info";
import { oneLine } from "../gateway/plain-text";
import { familySlotFor } from "../gateway/targets";

/** One task's row body, as Claude Code reads it back. */
export interface SubagentRow {
  content: string;
  id: string;
}

/** One visible subagent, the fields this row reads (the rest is ignored). */
export interface StatusTask {
  agentType: null | string;
  effort: null | string;
  id: string;
  label: null | string;
  model: null | string;
}

/** The longest row body when the input names no width: a terminal's usual 80 columns. */
const DEFAULT_COLUMNS = 80;

/** The shortest body worth printing: below it the row says nothing a person can read. */
const MIN_COLUMNS = 20;

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
      effort: text(one.effort),
      id,
      label: text(one.label) ?? text(one.description) ?? text(one.name),
      model: text(one.model),
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

/** Where one subagent's requests go: `slot → model → effort`, and who it is in front. */
export function rowContent(task: StatusTask, columns = DEFAULT_COLUMNS): string {
  const slot = slotOf(task.model) ?? "?";
  const model = task.model ?? "model not resolved yet";
  // Claude Code leaves the effort out when it set none: the model's own default answers.
  const effort = task.effort ?? "default effort";
  const route = `${slot} → ${model} → ${effort}`;
  const body = task.label === null ? route : `${task.label} · ${route}`;
  // One column goes to the mark, so a cut body still fits the row it is drawn in.
  const width = Math.max(MIN_COLUMNS, Math.trunc(columns));
  return oneLine(body, width - 1, { mark: "…" });
}

/** The rows an input makes: one per task, each with its own body. */
export function subagentRows(input: unknown): SubagentRow[] {
  const columns =
    typeof input === "object" &&
    input !== null &&
    !Array.isArray(input) &&
    typeof (input as Record<string, unknown>).columns === "number"
      ? ((input as Record<string, unknown>).columns as number)
      : DEFAULT_COLUMNS;
  return statusTasks(input).map((task) => ({ content: rowContent(task, columns), id: task.id }));
}

/** Runs the command: stdin in, one JSON line per row out. Never fails a session. */
export async function runSubagentStatusline(
  read: () => Promise<string> = () => Bun.stdin.text(),
): Promise<number> {
  let input: unknown = null;
  try {
    const raw = await read();
    input = raw.trim() === "" ? null : JSON.parse(raw);
  } catch {
    // Not JSON: no rows, and the session goes on.
    return 0;
  }
  for (const row of subagentRows(input)) console.log(JSON.stringify(row));
  return 0;
}
