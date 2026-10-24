/**
 * What a crew session reads first: the brief its lead gave (`crew start --brief`), with a fixed
 * frame after it, and the one line its session starts with.
 *
 * The frame repeats the essentials every crew session needs whatever its brief says, because a crew session
 * may run on older plugin code (a daemon's spare process) and its own hooks may not speak: who it
 * is and for whom, its worktree and branch, the git rule (D24: commit on its branch, never push —
 * the lead handles git), how it hands back, and how it asks (D36: never the person; a question to
 * the lead goes on the record, and the crew session goes on with what the question does not block).
 *
 * The first line is short and plain on purpose: it is a command-line argument, and on Windows a
 * `.cmd` carries it on a `cmd.exe` line where a `"` or a `%` cannot go (`claude.ts`).
 */
import { COMMAND } from "../build-info/names";
import { CREW_SKILL } from "./skills";

/** What the frame names. */
export interface BriefFacts {
  /** The crew session's name and its lead's (`crewName`, `leadName`). */
  crewName: string;
  leadName: string;
  /** The worktree's folder, its branch, and the ref it is cut from. */
  worktree: string;
  branch: string;
  baseRef: string;
  /** The files the phase owns (`--files`); empty when the brief names none. */
  files: readonly string[];
}

/** The command a crew reports with (built in W1b), as its frame names it. */
export const REPORT_COMMAND = `${COMMAND} crew report`;

/**
 * The commands a lead runs, and what a crew session never does with each (D45): one home for
 * the words the launcher's refusal (`readCaller`) uses for every command. The keys are the
 * commands; the values complete "a crew session never …". `resume`'s words name all three end
 * commands (`stop`, `resume`, `rm`), because one refusal answers each of them
 * (`src/crew/end.ts`). The Bash judge (`src/hooks/bash-judge.ts`) says the same words, read
 * through `CREW_NEVER_RUNS` below.
 */
export const CREW_NEVER_DOES = {
  answer: "answers its lead's questions",
  lead: "leads",
  "lead tell": "tells another lead",
  resume: "stops, removes or resumes crew sessions",
  start: "starts crew sessions",
  watch: "watches its lead's crew sessions",
} as const;

/**
 * Every `crew` subcommand a crew session never runs, and the phrase that completes "a crew
 * session never …" for it. The launcher refuses the lead commands through `CREW_NEVER_DOES`
 * (`readCaller`) and the three end commands in `end.ts`; the Bash judge denies them all from
 * this map, so it denies exactly the commands the launcher refuses. `satisfies` keeps the map
 * whole: a lead command added to `CREW_NEVER_DOES` must appear here too, or this file does not
 * type-check. The judge denies them by the hook's own environment, which a command line that
 * unsets `CC_SMART_DEV_KIT_CREW` (`env -u …`) cannot reach.
 */
export const CREW_NEVER_RUNS = {
  answer: CREW_NEVER_DOES.answer,
  lead: CREW_NEVER_DOES.lead,
  "lead tell": CREW_NEVER_DOES["lead tell"],
  resume: CREW_NEVER_DOES.resume,
  rm: CREW_NEVER_DOES.resume,
  start: CREW_NEVER_DOES.start,
  stop: CREW_NEVER_DOES.resume,
  watch: CREW_NEVER_DOES.watch,
} as const satisfies Record<LeadCommand | "rm" | "stop", string>;

/** One `crew` subcommand a crew session never runs. */
export type CrewNeverRun = keyof typeof CREW_NEVER_RUNS;

/** One command a lead runs: `crew <this>`. */
export type LeadCommand = keyof typeof CREW_NEVER_DOES;

/**
 * The mark between the lead's own brief and the frame every crew session gets. A brief that
 * continues another crew session's carries the old brief and the old crew session's report, and the frame
 * is written again at its end — so the two parts are told apart by this mark.
 */
export const BRIEF_FRAME_MARK = "\n\n---\n\n## Your frame (written by";

/** The frame after the lead's brief: the same for every crew session. */
export function briefFrame(facts: BriefFacts): string {
  const lines = [
    `## Your frame (written by \`${COMMAND} crew start\`)`,
    "",
    `- You are the crew session \`${facts.crewName}\`, for the lead \`${facts.leadName}\`. You run in the background: nobody watches this session.`,
    `- Your worktree is \`${facts.worktree}\`, on the branch \`${facts.branch}\`, cut from \`${facts.baseRef}\`. Work only there. Anything slow it needs first (a dependency install) is your first step.`,
  ];
  if (facts.files.length > 0) {
    lines.push(
      `- The files this phase owns: ${facts.files.map((file) => `\`${file}\``).join(", ")}. Say in your report why you changed any other file.`,
    );
  }
  lines.push(
    `- Work by \`/${CREW_SKILL}\`: it says how to build the phase, how to mark each step, and how to hand it back.`,
    "- Git: commit on your branch at each green step. Never push, never open a pull request, never merge: the lead handles git.",
    `- When the phase is ready, hand it back with \`${REPORT_COMMAND} --status done\`; when it cannot be done, with \`--status failed\` and why.`,
    "- Stop your own background checks before you report: one still running after your turn ends holds your worktree.",
    `- Never wait on the lead. Never ask the person and never call AskUserQuestion. When you need a decision, run \`${REPORT_COMMAND} --question "<the question>" --option "<choice>" --option "<choice>" --recommend <n>\` (the lead answers, or asks the person), then go on with every part of your phase the question does not block. Report \`--status blocked\` only when nothing else is left; an answer arrives as your next message.`,
  );
  return lines.join("\n");
}

/** The whole brief file: the lead's text as given, then the frame. */
export function briefText(given: string, facts: BriefFacts): string {
  return `${given.trimEnd()}\n\n---\n\n${briefFrame(facts)}\n`;
}

/** The line a crew session's Claude session starts with: who it is, and where its task is. */
export function firstPrompt(crewName: string, leadName: string, briefFile: string): string {
  return `You are the crew session ${crewName} for the lead ${leadName}. Work by /${CREW_SKILL}. Read ${briefFile} first: it is your task, and it says how you report.`;
}
