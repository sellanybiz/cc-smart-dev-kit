/**
 * What a worker reads first: the brief its lead gave (`worker start --brief`), with a fixed
 * frame after it, and the one line its session starts with.
 *
 * The frame repeats the essentials every worker needs whatever its brief says, because a worker
 * may run on older plugin code (a daemon's spare process) and its own hooks may not speak: who it
 * is and for whom, its worktree and branch, the git rule (D24: commit on its branch, never push —
 * the lead handles git), how it hands back, and how it asks (D36: never the person; a question to
 * the lead goes on the record, and the worker goes on with what the question does not block).
 *
 * The first line is short and plain on purpose: it is a command-line argument, and on Windows a
 * `.cmd` carries it on a `cmd.exe` line where a `"` or a `%` cannot go (`claude.ts`).
 */
import { COMMAND } from "../build-info/names";
import { WORKER_SKILL } from "./skills";

/** What the frame names. */
export interface BriefFacts {
  /** The worker's name and its lead's (`workerName`, `leadName`). */
  workerName: string;
  leadName: string;
  /** The worktree's folder, its branch, and the ref it is cut from. */
  worktree: string;
  branch: string;
  baseRef: string;
  /** The files the phase owns (`--files`); empty when the brief names none. */
  files: readonly string[];
}

/** The command a worker reports with (built in W1b), as its frame names it. */
export const REPORT_COMMAND = `${COMMAND} worker report`;

/**
 * The mark between the lead's own brief and the frame every worker gets. A brief that
 * continues another worker's carries the old brief and the old worker's report, and the frame
 * is written again at its end — so the two parts are told apart by this mark.
 */
export const BRIEF_FRAME_MARK = "\n\n---\n\n## Your frame (written by";

/** The frame after the lead's brief: the same for every worker. */
export function briefFrame(facts: BriefFacts): string {
  const lines = [
    `## Your frame (written by \`${COMMAND} worker start\`)`,
    "",
    `- You are the worker \`${facts.workerName}\`, for the lead \`${facts.leadName}\`. You run in the background: nobody watches this session.`,
    `- Your worktree is \`${facts.worktree}\`, on the branch \`${facts.branch}\`, cut from \`${facts.baseRef}\`. Work only there. Anything slow it needs first (a dependency install) is your first step.`,
  ];
  if (facts.files.length > 0) {
    lines.push(
      `- The files this phase owns: ${facts.files.map((file) => `\`${file}\``).join(", ")}. Say in your report why you changed any other file.`,
    );
  }
  lines.push(
    `- Work by \`/${WORKER_SKILL}\`: it says how to build the phase, how to mark each step, and how to hand it back.`,
    "- Git: commit on your branch at each green step. Never push, never open a pull request, never merge: the lead handles git.",
    `- When the phase is ready, hand it back with \`${REPORT_COMMAND} --status done\`; when it cannot be done, with \`--status failed\` and why.`,
    `- Never wait on the lead. Never ask the person and never call AskUserQuestion. When you need a decision, run \`${REPORT_COMMAND} --question "<the question>" --option "<choice>" --option "<choice>" --recommend <n>\` (the lead answers, or asks the person), then go on with every part of your phase the question does not block. Report \`--status blocked\` only when nothing else is left; an answer arrives as your next message.`,
  );
  return lines.join("\n");
}

/** The whole brief file: the lead's text as given, then the frame. */
export function briefText(given: string, facts: BriefFacts): string {
  return `${given.trimEnd()}\n\n---\n\n${briefFrame(facts)}\n`;
}

/** The line a worker's session starts with: who it is, and where its task is. */
export function firstPrompt(workerName: string, leadName: string, briefFile: string): string {
  return `You are the worker ${workerName} for the lead ${leadName}. Work by /${WORKER_SKILL}. Read ${briefFile} first: it is your task, and it says how you report.`;
}
