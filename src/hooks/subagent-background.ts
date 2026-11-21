/**
 * SubagentStop: a subagent never hands back while its own background work still runs.
 *
 * A subagent that ends its turn with a background Bash task (or a background subagent) of its
 * own still running leaves Claude Code holding the agent open: the parent already has the
 * report, the task outlives the turn, and the person's panel shows the agent as if it were
 * stuck. The fix belongs to the agent — wait for the work, or stop it, before the final
 * report (`/cc-smart-dev-kit:subagent-decision` § How to brief) — and this hook says it once
 * when the agent did not.
 *
 * **The input's `background_tasks` is the SESSION's in-flight list, not this agent's.** Proved
 * offline on 2.1.308 (fake Anthropic, throwaway HOME): a subagent launched in the background
 * appears in its own stop's list, and a foreground subagent's stop lists the main session's
 * own background shell. So the hook keeps only the tasks the ending agent itself started: the
 * ids its own transcript (`agent_transcript_path`) names in a **tool result of its own tool
 * call**, where a Bash call's background result says `Command running in background with ID:
 * <id>` and an Agent call's result says `agentId: <id>` (the contract's row, proved on
 * 2.1.308). The ending
 * agent's own id is dropped first: every line of its transcript carries it as `agentId`, so a
 * background subagent would otherwise match itself.
 *
 * **The transcript is JSONL, read line by line, and only a tool result counts.** A plain
 * substring over the whole file is wrong twice over: the parent's background id can appear in
 * the agent's text (its brief quotes the task it waits on, a file it read names it), and an
 * id in prose is not work the agent started. So a line is parsed as JSON, a `tool_use` is
 * remembered by its id and tool name, and a `tool_result` is matched only against the phrase
 * its own tool writes: a Bash background launch, or an Agent launch's child. A line that is
 * not JSON is skipped; an unreadable transcript is no block at all.
 *
 * **One block per background task, never two**: the stop a block caused carries
 * `stop_hook_active: true`, and the hook is silent there. A re-woken agent (its task reported)
 * starts a new stop with the flag false, so the hook also keeps a record per agent and task in
 * the state folder (`blocksFile`): a task already blocked once lets the next stop through, with
 * one stderr line saying the work still runs; a new task is blocked once more. A record that
 * cannot be kept lets the stop through. The answer is `decision: "block"` with a plain reason and **no
 * `additionalContext`** (proved on 2.1.308: the subagent's next turn carries
 * `SubagentStop hook blocking error from command: …: <reason>`). The hook reads no setting
 * from `cc-smart-dev-kit.json`, but it is project-scoped like `review-record`: with no file it
 * stays silent, so a project that never opted in does not notice the plugin. A transcript
 * that cannot be read is **no block**: the hook cannot tell whose work it is, and a subagent
 * must always be able to finish.
 */
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { COMMAND } from "../build-info/names";
import { withLock } from "../setup/lock";
import { atomicWrite } from "../setup/write";
import { type HookInput, type HookResult, SILENT, stringField } from "./io";
import type { HookContext } from "./run";
import { AGENT_TOOLS } from "./session-facts";

/** The hook's name: its bundle, its `ownHooks` entry, its stderr prefix. */
const SUBAGENT_BACKGROUND = "subagent-background";

/** What the subagent reads when it hands back too early. */
export const HAND_BACK_REASON =
  "Your background work is still running: wait for it or stop it, then report.";

/**
 * The id a background Bash call's tool result names (2.1.308: "Command running in background
 * with ID: bp3zidk61. Output is being written to: …").
 */
const BACKGROUND_ID = /Command running in background with ID: ([A-Za-z0-9_-]+)/;

/** The id an Agent call's background result names ("… agentId: <id> (internal ID …)"). */
const AGENT_ID = /agentId: ([A-Za-z0-9_-]+)/;

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

/** One transcript line as an object, or null when it is blank or not a JSON object. */
function lineObject(line: string): Record<string, unknown> | null {
  if (line.trim() === "") return null;
  try {
    const value: unknown = JSON.parse(line);
    return typeof value === "object" && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/** The `message.content` blocks of a transcript line, when it has them. */
function contentBlocks(line: Record<string, unknown>): Array<Record<string, unknown>> {
  const message = line.message;
  if (typeof message !== "object" || message === null || Array.isArray(message)) return [];
  const content = (message as Record<string, unknown>).content;
  if (!Array.isArray(content)) return [];
  return content.filter(
    (block): block is Record<string, unknown> =>
      typeof block === "object" && block !== null && !Array.isArray(block),
  );
}

/** A tool result's text: its `content` as a string, or the text blocks of its array. */
function resultText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((block) => {
      if (typeof block !== "object" || block === null || Array.isArray(block)) return "";
      const text = (block as Record<string, unknown>).text;
      return typeof text === "string" ? text : "";
    })
    .join("\n");
}

/**
 * The ones of `ids` the agent itself started: an id is counted only in a `tool_result` of the
 * agent's own Bash call (a background launch's `Command running in background with ID: <id>`)
 * or Agent call (a launched child's `agentId: <id>`). Nothing else in the transcript counts —
 * not the brief, not a file it read, and not its own `agentId` on every line.
 */
function startedByAgent(text: string, ids: readonly string[]): string[] {
  const wanted = new Set(ids);
  if (wanted.size === 0) return [];
  /** The tool each `tool_use` named, by its id: only that call's own result can count. */
  const tools = new Map<string, string>();
  const results: Array<{ text: string; tool: string | undefined }> = [];
  for (const raw of text.split("\n")) {
    const line = lineObject(raw);
    if (line === null) continue;
    for (const block of contentBlocks(line)) {
      if (block.type === "tool_use") {
        const id = stringField(block.id);
        const name = stringField(block.name);
        if (id !== null && name !== null) tools.set(id, name);
      } else if (block.type === "tool_result") {
        results.push({
          text: resultText(block.content),
          tool: tools.get(stringField(block.tool_use_id) ?? ""),
        });
      }
    }
  }
  const started = new Set<string>();
  for (const result of results) {
    const found =
      result.tool === "Bash"
        ? BACKGROUND_ID.exec(result.text)?.[1]
        : result.tool !== undefined &&
          (AGENT_TOOLS as readonly string[]).includes(result.tool) &&
          AGENT_ID.exec(result.text)?.[1];
    if (typeof found === "string" && wanted.has(found)) started.add(found);
  }
  return [...started];
}

/** Where the blocks already given are kept: a folder of its own, so the lock is its own. */
function blocksFile(stateDir: string): string {
  return join(stateDir, "subagent-background", "blocked.json");
}

/** How long the hook waits for the record's lock: a write takes milliseconds, the hook has 10 s. */
const BLOCKS_LOCK_WAIT_MS = 3_000;

/** A block older than this is forgotten: no background task outlives a day, and the file stays small. */
const BLOCKS_KEPT_MS = 24 * 60 * 60 * 1000;

/** The blocks in `file`, as `<agent>:<task>` keys with the time each was given; none when unreadable. */
function readBlocks(file: string): Record<string, number> {
  try {
    const parsed: unknown = JSON.parse(readFileSync(file, "utf8"));
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed).filter(
        (entry): entry is [string, number] => typeof entry[1] === "number",
      ),
    );
  } catch {
    // No record yet, or one that cannot be read: nothing was blocked, as far as the hook knows.
    return {};
  }
}

/**
 * Records that `agent` was told about each of `tasks`, and returns the ones it was NOT told
 * about before. A re-woken agent starts a new stop with `stop_hook_active` false, so the stop
 * flag alone cannot tell the second stop from a first one: this record, per agent and task,
 * can. Throws when the record cannot be locked or written.
 */
async function newBlocks(
  file: string,
  agent: string,
  tasks: readonly string[],
  atMs: number,
): Promise<string[]> {
  const folder = dirname(file);
  mkdirSync(folder, { mode: 0o700, recursive: true });
  return await withLock(
    folder,
    () => {
      const kept: Record<string, number> = {};
      for (const [key, at] of Object.entries(readBlocks(file))) {
        if (atMs - at <= BLOCKS_KEPT_MS) kept[key] = at;
      }
      const fresh = tasks.filter((task) => kept[`${agent}:${task}`] === undefined);
      if (fresh.length === 0) return [];
      for (const task of fresh) kept[`${agent}:${task}`] = atMs;
      atomicWrite(file, `${JSON.stringify(kept, null, 2)}\n`, 0o600);
      return fresh;
    },
    { waitMs: BLOCKS_LOCK_WAIT_MS },
  );
}

export async function subagentBackground(context: HookContext): Promise<HookResult> {
  const { input, event, paths, project } = context;
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
  const running = startedByAgent(text, ids);
  if (running.length === 0) return SILENT;
  // One block per task: a re-woken agent stops again with `stop_hook_active` false, and the same
  // block would repeat. The record is keyed by the agent (its transcript names it when the
  // input gives no id) and the task.
  let fresh: string[];
  try {
    fresh = await newBlocks(blocksFile(paths.stateDir), selfId ?? transcript, running, Date.now());
  } catch (error) {
    // Without the record the hook cannot keep its one-block promise, and a subagent must always
    // be able to finish: the stop goes through.
    const why = error instanceof Error ? error.message : String(error);
    return {
      stderr: `${COMMAND} ${SUBAGENT_BACKGROUND}: cannot keep the record of blocks: ${why}`,
    };
  }
  if (fresh.length > 0)
    return { stdout: JSON.stringify({ decision: "block", reason: HAND_BACK_REASON }) };
  return {
    stderr: `${COMMAND} ${SUBAGENT_BACKGROUND}: background work of this agent (${running.join(", ")}) is still running, and it was told once: this stop goes through.`,
  };
}
