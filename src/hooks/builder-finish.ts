/**
 * SubagentStop: a builder never hands back while its phase still has open blocking steps.
 * "Builder" here means any agent the build skill gives a phase: the builder, or the
 * rules-maintainer for a phase that edits instruction files.
 *
 * The build skill launches every builder with the exact line `Your task: #<n>` in its brief,
 * where `#<n>` is the phase's task in the kit's task list (`plugin/skills/build/SKILL.md`). The
 * builder keeps its steps as tasks under it. A builder that reports while one of those steps
 * is still open hands back unfinished work as if it were done. This hook reads the line and
 * says so once, naming each open step and the call that closes it.
 *
 * **Which agents:** an `agent_type` that ends with one of `BUILDER_TYPE_ENDS`
 * (`cc-smart-dev-kit:builder` and `cc-smart-dev-kit:rules-maintainer`, the plugin's own: the
 * build skill launches both with the same line). **Which task:** the first `Your task: #<n>`
 * line of the agent's brief, which is the first `user` entry of its own transcript
 * (`agent_transcript_path`) — never a later line, so a task number the agent itself wrote or
 * read later is not the brief. **Which steps:** the ones that hold the task's done
 * (`holdingUnder`, the same set `task_done` refuses on): open blocking tasks at any depth under
 * it, reached through blocking tasks only.
 * A non-blocking step holds nothing.
 *
 * **The project key** is the main checkout's (`projectKey`), the key the task server writes
 * under for every worktree of the repository: a builder that runs in its own worktree
 * (`.claude/worktrees/<name>`) finds the tasks its caller made in the main checkout. The frame
 * already holds the checkout, so this costs no second git call.
 *
 * **Once per hand-back:** the stop a block caused carries `stop_hook_active: true`, and the
 * hook is silent there, so a step that truly cannot close never traps the agent; the caller
 * then sees it open in the task list. The answer is `decision: "block"` with a plain reason
 * and **no `additionalContext`**, the form `subagent-background` proved on 2.1.308.
 *
 * **Fails open:** another agent type, no transcript, no `Your task:` line, no task list yet, a
 * task that is not there: silence. A task list that cannot be read: one stderr line.
 * **Machine-wide**, like `keep-going`: it reads only the person's own task list, never a project
 * setting, so it judges the same with no `cc-smart-dev-kit.json` and with a broken or too new one
 * (`builderFinishHook` in `specs.ts`). Outside git it is silent.
 */
import { closeSync, openSync, readSync } from "node:fs";
import { COMMAND } from "../build-info/names";
import type { CliPaths } from "../cli/paths";
import type { Project } from "../project/resolve";
import { projectKey } from "../tasks/context";
import { TASK_TOOL } from "../tasks/words";
import { holdingSteps } from "../tasks/work/read";
import { type HookInput, type HookResult, SILENT, stringField } from "./io";
import { agentTypeOf } from "./review-record";
import type { HookContext } from "./run";

/**
 * The ends of the agent types this hook judges: the plugin's builder
 * (`cc-smart-dev-kit:builder`) and its rules-maintainer (`cc-smart-dev-kit:rules-maintainer`).
 */
export const BUILDER_TYPE_ENDS = ["builder", "rules-maintainer"] as const;

/**
 * How much of a transcript's start is read for the brief. The brief is the first line; a
 * brief longer than this is not one a person wrote, and the hook stays silent.
 */
export const BRIEF_HEAD_BYTES = 1024 * 1024;

/** The brief's line that names the phase's task: exactly `Your task: #<n>`, alone on its line. */
const TASK_LINE = /^Your task: #(\d+)[ \t\r]*$/m;

/** True for an agent type this hook judges. */
export function isBuilder(agentType: string | null): boolean {
  return agentType !== null && BUILDER_TYPE_ENDS.some((end) => agentType.endsWith(end));
}

/** The task number of the brief's first `Your task: #<n>` line, or null when it has none. */
export function briefTaskNumber(brief: string): number | null {
  const found = TASK_LINE.exec(brief)?.[1];
  return found === undefined ? null : Number(found);
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A message's text: its `content` as a string, or its text blocks joined by a newline. */
function messageText(content: unknown): string | null {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return null;
  return content
    .filter(
      (block): block is { text: string } =>
        isJsonObject(block) && block.type === "text" && typeof block.text === "string",
    )
    .map((block) => block.text)
    .join("\n");
}

/**
 * The text of a transcript's first `user` entry: a subagent's brief. Only the file's first
 * `BRIEF_HEAD_BYTES` are read; a line that is not JSON is skipped. Null when the file cannot be
 * read or holds no such entry there.
 */
export function firstPromptText(transcriptPath: string): string | null {
  let text: string;
  try {
    const fd = openSync(transcriptPath, "r");
    try {
      const buffer = Buffer.alloc(BRIEF_HEAD_BYTES);
      const read = readSync(fd, buffer, 0, BRIEF_HEAD_BYTES, 0);
      text = buffer.subarray(0, read).toString("utf8");
    } finally {
      closeSync(fd);
    }
  } catch {
    return null;
  }
  for (const line of text.split("\n")) {
    if (line.trim() === "") continue;
    let entry: unknown;
    try {
      entry = JSON.parse(line);
    } catch {
      // A line cut by the read's end, or one that is not JSON at all.
      continue;
    }
    if (!isJsonObject(entry) || entry.type !== "user" || !isJsonObject(entry.message)) continue;
    return messageText(entry.message.content);
  }
  return null;
}

/** One open step, as the reason names it. */
export interface OpenStep {
  number: number;
  subject: string;
}

/** Bounded hook context: show eight items, then tell the reader how to find the rest. */
export function cappedHookList<T>(
  items: readonly T[],
  render: (item: T) => string,
  command: string,
  separator = ", ",
): string {
  const shown = items.slice(0, 8).map(render);
  if (items.length > 8) shown.push(`+${items.length - 8} more: ${command}`);
  return shown.join(separator);
}

/** What the builder reads when it hands back with steps still open: each step and its close. */
export function handBackReason(task: number, open: readonly OpenStep[]): string {
  return [
    `Task #${task} still has ${open.length} open blocking steps. Close each one, then hand back:`,
    cappedHookList(
      open,
      (step) => {
        const ref = `"#${step.number}"`;
        return `- #${step.number} ${step.subject.replace(/\s+/g, " ")}: finish it and close it with \`${TASK_TOOL.done}\` (task ${ref}, with evidence), or drop it with \`${TASK_TOOL.done}\` (task ${ref}, outcome "dropped") and a note saying why.`;
      },
      TASK_TOOL.list,
      "\n",
    ),
  ].join("\n");
}

export function builderFinish(context: HookContext): HookResult {
  return builderFinishAnswer(context.input, context.event, context.project, context.paths);
}

/**
 * The answer from the input and the checkout alone: no project setting is read, so the frame's
 * `onConfigProblem` gives the same answer as `run`.
 */
export function builderFinishAnswer(
  input: HookInput,
  event: string,
  project: Pick<Project, "mainCheckout" | "root">,
  paths: CliPaths,
): HookResult {
  if (event !== "SubagentStop") return SILENT;
  // The stop a block caused: never a second block for the same hand-back.
  if (input.stop_hook_active === true) return SILENT;
  if (!isBuilder(agentTypeOf(input))) return SILENT;
  const transcript = stringField(input.agent_transcript_path);
  if (transcript === null) return SILENT;
  const brief = firstPromptText(transcript);
  if (brief === null) return SILENT;
  const task = briefTaskNumber(brief);
  if (task === null) return SILENT;
  const read = holdingSteps(paths, projectKey(project.mainCheckout ?? project.root), task);
  if (read.state === "unreadable") {
    return { stderr: `${COMMAND} builder-finish: the task list cannot be read (${read.why})` };
  }
  if (read.state === "none" || read.value === null || read.value.open.length === 0) return SILENT;
  return {
    stdout: JSON.stringify({ decision: "block", reason: handBackReason(task, read.value.open) }),
  };
}
