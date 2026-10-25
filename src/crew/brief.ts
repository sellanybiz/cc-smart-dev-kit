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
 * The done report as a crew session runs it: a done report needs its JSON part (the tests, the
 * checks, the review), which the command reads from stdin with `--file -` (`report.ts`).
 */
export const REPORT_DONE_COMMAND = `${REPORT_COMMAND} --status done --file -`;

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
  model: "changes a crew session's model or effort",
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
  model: CREW_NEVER_DOES.model,
  resume: CREW_NEVER_DOES.resume,
  rm: CREW_NEVER_DOES.resume,
  start: CREW_NEVER_DOES.start,
  stop: CREW_NEVER_DOES.resume,
  watch: CREW_NEVER_DOES.watch,
} as const satisfies Record<LeadCommand | "rm" | "stop", string>;

/** One `crew` subcommand a crew session never runs. */
export type CrewNeverRun = keyof typeof CREW_NEVER_RUNS;

/**
 * What a crew session never does with a workflow change (D24): `workflow propose` pushes a
 * branch and opens a pull request, and a crew session does neither. One home for the words the
 * Bash judge denies the command with (`src/hooks/bash-judge.ts`) and the command refuses with
 * (`src/workflow/propose.ts`) — the judge under every spelling it reads, the command as the
 * second belt for a line that reaches it another way.
 */
export const CREW_NEVER_PROPOSES = "proposes a workflow change";

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
    `- Your worktree is \`${facts.worktree}\`, on the branch \`${facts.branch}\`, cut from \`${facts.baseRef}\`. Work only there.`,
    "- Setup, your first step, before anything else slow: install the project's dependencies in your own worktree, with the project's own install command. Never link or reuse another checkout's dependency folder (a symlink to it, say): undoing that asks the person, and nobody watches this session.",
  ];
  if (facts.files.length > 0) {
    lines.push(
      `- The files this phase owns: ${facts.files.map((file) => `\`${file}\``).join(", ")}. Say in your report why you changed any other file.`,
    );
  }
  lines.push(
    `- Work by \`/${CREW_SKILL}\`: it says how to build the phase, how to mark each step, and how to hand it back.`,
    "- Never ask the person to remove, unlock or force-remove a worktree; report leftovers to your lead, who uses `crew rm` or `worktrees --clean`.",
    "- Git: commit on your branch at each green step. Never push, never open a pull request, never merge: the lead handles git.",
    `- When the phase is ready, hand it back with \`${REPORT_DONE_COMMAND}\` and the JSON part (tests, checks, review); when it cannot be done, with \`--status failed\` and why.`,
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
