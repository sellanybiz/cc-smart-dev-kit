/**
 * `cc-smart-dev-kit crew <command>`: the lead and its crew (`docs/design.md` § Lead and
 * crew sessions). This file reads the arguments and hands each command its checked values: `lead`
 * (`lead.ts`), `start` (`start.ts`), `step` (`step.ts`), `report` (`report.ts`), `answer`
 * (`answer.ts`), `tell` (`tell.ts`), `watch` (`watch.ts`), `self-watch` (`self-watch.ts`), the
 * board — `list`, `status`, `kinds`, `attach` (`board.ts`) — and the end of a crew session —
 * `stop`, `resume` (`end.ts`) and `rm` (`remove.ts`).
 *
 * Exit codes, as everywhere in the command: 0 done, 1 a refusal or an error, 2 a wrong command
 * or option — one line, then where the help is.
 */
import { COMMAND } from "../build-info/names";
import { ALLOWED_EFFORTS, CREW_KIND_NAMES, CREW_KINDS, isCrewKind } from "../models/launch-policy";
import { type AnswerArgs, runCrewAnswer } from "./answer";
import { commaList, parseOptions } from "./args";
import { runCrewAttach, runCrewKinds, runCrewList, runCrewStatus } from "./board";
import type { CrewContext } from "./context";
import { runCrewResume, runCrewResumePaused, runCrewStop } from "./end";
import { type LeadArgs, runCrewLead } from "./lead";
import { isNameTag, isPhase, isSlug, PHASE_RULE, SLUG_RULE, TAG_RULE } from "./names";
import { runCrewRm } from "./remove";
import { isReportStatus, REPORT_STATUS_NAMES, type ReportArgs, runCrewReport } from "./report";
import { runCrewSelfWatch } from "./self-watch";
import { runCrewStart, type StartArgs } from "./start";
import { CREW_STEPS, isCrewStep, runCrewStep } from "./step";
import { runCrewTell, type TellArgs } from "./tell";
import { isTellKind, TELL_KINDS } from "./tell-format";
import { BOARD_COMMANDS, boardCommand, TELL_ARGS, TELL_SUMMARY, TELL_USAGE } from "./usage";
import { runCrewWatch, type WatchArgs } from "./watch";

/** Every kind, with the model it names and what it is for: built from `CREW_KINDS`. */
const KIND_LINES = CREW_KIND_NAMES.map(
  (kind) => `  ${kind.padEnd(14)}${CREW_KINDS[kind].model}: ${CREW_KINDS[kind].about}`,
).join("\n");

/**
 * The board and the end of a crew session, one short line each: built from their own table
 * (`usage.ts`), so the lines and each command's own help are one text.
 */
const OTHER_COMMANDS = BOARD_COMMANDS.map(
  (one) => `  ${`${one.name}${one.args === "" ? "" : ` ${one.args}`}`.padEnd(24)}${one.summary}`,
).join("\n");

/** How far in a command's description starts in the usage (the columns after the command). */
const DESCRIPTION_INDENT = " ".repeat(17);

/**
 * `text` broken at spaces into lines of at most `width` columns, a later line starting with
 * `indent`: for the lines of the usage that are built from data.
 */
function wrapText(text: string, width: number, indent: string): string {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(" ")) {
    if (line !== "" && line.length + 1 + word.length > width) {
      lines.push(line);
      line = word;
    } else {
      line = line === "" ? word : `${line} ${word}`;
    }
  }
  lines.push(line);
  return lines.join(`\n${indent}`);
}

/** The steps, wrapped to the usage's 80 columns: built from `CREW_STEPS`. */
const STEPS_LINE = wrapText(
  `The steps: ${CREW_STEPS.join(", ")}.`,
  80 - DESCRIPTION_INDENT.length,
  DESCRIPTION_INDENT,
);

export const CREW_USAGE = `Usage: ${COMMAND} crew <command>

Commands:
  lead [--plan <slug>] [--tag <tag>]
                 Records this Claude Code session as the lead of a plan in this
                 repository, named LEAD <tag> <plan>. Run it once in the session
                 that leads; it prints the /rename line that shows the name.
  start <phase> --slug <slug> --kind <kind> --brief <file|-> [--base <ref>]
        [--files <glob,...>] [--model <model>] [--effort <effort>]
        [--waits-for <phase,...>] [--continue <crew session>]
                 Starts one crew session: a background Claude Code session named
                 C <tag> <phase> <slug>, in its own worktree on the branch
                 crew/<phase>-<slug>, cut from --base or the lead's branch. It
                 returns at once: started, queued (the caps, the free memory, or
                 the phases it waits for), or failed, with the reason.
                 --continue <crew session> starts the hand-off's next crew session: the
                 same phase, cut from the old crew session's head, with the old brief
                 and the old crew session's report, and the next number in its name.
  step <step> [--note <text>]
                 Records one milestone of a crew session's phase: the step, the time
                 and HEAD's sha. A crew session runs it; the lead sees one line.
                 ${STEPS_LINE}
  report --status done|blocked|failed|handoff [--file <file|->]
                 The hand-back report a crew session gives its lead. The command fills
                 the branch, the commits, the diff counts, the files outside the
                 brief, the review record and the pull request; the crew session gives
                 the tests, the other checks, the review's findings, the docs,
                 what only the lead may do, and what is still open. The file is
                 that part as JSON, or prose kept as the report's summary.
  report --question "<the question>" --option "<choice>" --option "<choice>"
          [--recommend <n>]
                 Records a question for the lead. The crew session goes on with
                 everything the question does not block.
  answer <crew session> "<the answer>"
                 The lead's answer to a crew session's question. A running crew session
                 gets it as a message (the command prints the line the lead
                 sends); a stopped one is resumed with it.
  tell ${TELL_ARGS}
                 ${wrapText(TELL_SUMMARY, 80 - DESCRIPTION_INDENT.length, DESCRIPTION_INDENT)}
                 It records the note for your lead, and prints one SendMessage
                 line per receiver. Status goes to the lead, never a peer.
  watch [--lead <session>] [--once] [--timeout <seconds>]
                 One line per change in this lead's crew sessions: their steps, their
                 reports, their questions, what they need from you. It also
                 starts the queued crew sessions when a place frees, and ends the
                 ones whose work is done. --once ends on the next change: where
                 the plugin's monitors do not run (telemetry off), the lead
                 runs "crew watch --once" in the background, and again after
                 each event. --timeout bounds the wait.
  self-watch [--once]
                 The crew session's own line about its context and its time: hand off
                 at the context share, a note when the phase runs long. It says
                 nothing else, and repeats its line every 15 minutes while it is
                 ignored. --once checks once and exits.

The board and the end of a crew session (a command's own help: crew <command> --help):
${OTHER_COMMANDS}

The kind gives the model and the effort (--model and --effort override them, judged
by the agent guard's rules; one the guard would ask you about is refused):
${KIND_LINES}

Crew sessions are off until workflow.crew.enabled is on: ${COMMAND} workflow set
crew.enabled true --project. A crew session commits on its branch and never pushes; the
lead merges.`;

/** One usage mistake: the line, then where the help is (exit 2). */
function usageError(line: string, sub?: string): string {
  return `${line}\nSee: ${COMMAND} crew ${sub === undefined ? "" : `${sub} `}--help`;
}

const START_OPTIONS = [
  "--slug",
  "--kind",
  "--brief",
  "--base",
  "--files",
  "--model",
  "--effort",
  "--waits-for",
  "--continue",
] as const;

/** `crew start`'s arguments, checked; or the mistake. */
export function parseStartArgs(argv: readonly string[]): StartArgs | { error: string } {
  const parsed = parseOptions(argv, START_OPTIONS);
  if ("error" in parsed) return parsed;
  const { options, positionals } = parsed;
  const [phase, ...extra] = positionals;
  if (phase === undefined) return { error: "Say which phase: crew start <phase> …" };
  if (extra.length > 0) return { error: `Unknown argument: ${extra.join(" ")}` };
  if (!isPhase(phase))
    return { error: `The phase "${phase}" is not one: a phase is ${PHASE_RULE}` };
  const continueFrom = options.get("--continue") ?? null;
  const slug = options.get("--slug");
  if (slug === undefined && continueFrom === null) {
    return { error: "Say the crew session's slug: --slug <slug>" };
  }
  if (slug !== undefined && !isSlug(slug)) {
    return { error: `The slug "${slug}" is not one: a slug is ${SLUG_RULE}` };
  }
  const kindText = options.get("--kind");
  const kind = kindText !== undefined && isCrewKind(kindText) ? kindText : null;
  if (kindText === undefined && continueFrom === null) {
    return { error: `Say the phase's kind: --kind <${CREW_KIND_NAMES.join("|")}>` };
  }
  if (kindText !== undefined && kind === null) {
    return { error: `Unknown kind: ${kindText} (the kinds: ${CREW_KIND_NAMES.join(", ")})` };
  }
  const brief = options.get("--brief");
  if (brief === undefined && continueFrom === null) {
    return { error: "Give the crew session its brief: --brief <file>, or --brief - for stdin" };
  }
  const effort = options.get("--effort")?.toLowerCase() ?? null;
  if (effort !== null && !(ALLOWED_EFFORTS as readonly string[]).includes(effort)) {
    return {
      error: `Unknown effort: ${effort} (a crew session runs at ${ALLOWED_EFFORTS.join(", ")})`,
    };
  }
  const waitsFor = commaList(options.get("--waits-for"));
  const badWait = waitsFor.find((one) => !isPhase(one));
  if (badWait !== undefined) {
    return { error: `--waits-for names "${badWait}", which is no phase: a phase is ${PHASE_RULE}` };
  }
  if (waitsFor.includes(phase)) return { error: `The phase ${phase} cannot wait for itself` };
  return {
    base: options.get("--base") ?? null,
    brief: brief ?? "",
    continueFrom,
    effort,
    files: commaList(options.get("--files")),
    kind: kind ?? "build",
    model: options.get("--model") ?? null,
    phase,
    slug: slug ?? "",
    waitsFor: [...new Set(waitsFor)],
  };
}

/** `crew lead`'s arguments, checked; or the mistake. */
export function parseLeadArgs(argv: readonly string[]): LeadArgs | { error: string } {
  const parsed = parseOptions(argv, ["--plan", "--tag"]);
  if ("error" in parsed) return parsed;
  if (parsed.positionals.length > 0) {
    return { error: `Unknown argument: ${parsed.positionals.join(" ")}` };
  }
  const tag = parsed.options.get("--tag") ?? null;
  if (tag !== null && !isNameTag(tag))
    return { error: `The tag "${tag}" is not one: a tag is ${TAG_RULE}` };
  return { plan: parsed.options.get("--plan") ?? null, tag };
}

/** `crew list`'s arguments, checked; or the mistake. */
export function parseListArgs(
  argv: readonly string[],
): { all: boolean; json: boolean } | { error: string } {
  const parsed = parseOptions(argv, [], ["--all", "--json"]);
  if ("error" in parsed) return parsed;
  if (parsed.positionals.length > 0) {
    return { error: `Unknown argument: ${parsed.positionals.join(" ")}` };
  }
  return { all: parsed.flags.has("--all"), json: parsed.flags.has("--json") };
}

/** The one crew session `crew <command>` names: its name, id or short id; or the mistake. */
export function parseTargetArgs(
  command: string,
  argv: readonly string[],
): { error: string } | { ref: string } {
  const parsed = parseOptions(argv, []);
  if ("error" in parsed) return parsed;
  const [ref, ...extra] = parsed.positionals;
  if (ref === undefined) return { error: `Say which crew session: crew ${command} <name|id>` };
  if (extra.length > 0) {
    return { error: `Unknown argument: ${extra.join(" ")} (put a name with spaces in quotes)` };
  }
  return { ref };
}

/**
 * `crew resume`'s arguments, checked: one crew session by its name, id or short id, or
 * `--paused` for every paused crew session of a lead at once (D42, after `/login`), with
 * `--lead <session>` when the command's own session is not the lead.
 */
export function parseResumeArgs(
  argv: readonly string[],
): { all: true; lead: null | string } | { error: string } | { ref: string } {
  const parsed = parseOptions(argv, ["--lead"], ["--paused"]);
  if ("error" in parsed) return parsed;
  const [ref, ...extra] = parsed.positionals;
  const lead = parsed.options.get("--lead") ?? null;
  if (parsed.flags.has("--paused")) {
    if (ref !== undefined) {
      return {
        error: `crew resume --paused takes no crew session: name one, or --paused for all of them`,
      };
    }
    return { all: true, lead };
  }
  if (lead !== null) {
    return { error: "--lead is for --paused: name that crew session, or resume every paused one" };
  }
  if (ref === undefined) {
    return {
      error: "Say which crew session: crew resume <name|id>, or --paused for every paused one",
    };
  }
  if (extra.length > 0) {
    return { error: `Unknown argument: ${extra.join(" ")} (put a name with spaces in quotes)` };
  }
  return { ref };
}

/** `crew kinds` takes no argument; the mistake when it gets one. */
export function parseKindsArgs(argv: readonly string[]): null | { error: string } {
  const parsed = parseOptions(argv, []);
  if ("error" in parsed) return parsed;
  if (parsed.positionals.length > 0) {
    return { error: `Unknown argument: ${parsed.positionals.join(" ")}` };
  }
  return null;
}

/**
 * Runs a board or end command. Whatever it throws — a store file that cannot be read — is one
 * line and exit 1, never a stack trace.
 */
async function guarded(
  sub: string,
  ctx: CrewContext,
  run: () => number | Promise<number>,
): Promise<number> {
  try {
    return await run();
  } catch (error) {
    ctx.error(`crew ${sub}: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
}

/** `cc-smart-dev-kit crew …`; the exit code. */
export async function runCrew(argv: readonly string[], ctx: CrewContext): Promise<number> {
  const [sub, ...rest] = argv;
  if (
    sub === undefined ||
    sub === "--help" ||
    sub === "-h" ||
    rest.includes("--help") ||
    rest.includes("-h")
  ) {
    if (sub === undefined) {
      ctx.error(usageError("Say which crew command"));
      return 2;
    }
    ctx.print(sub === "tell" ? TELL_USAGE : (boardCommand(sub)?.help ?? CREW_USAGE));
    return 0;
  }
  if (sub === "list") {
    const args = parseListArgs(rest);
    if ("error" in args) {
      ctx.error(usageError(args.error, sub));
      return 2;
    }
    return await guarded(sub, ctx, () => runCrewList(args, ctx));
  }
  if (sub === "kinds") {
    const mistake = parseKindsArgs(rest);
    if (mistake !== null) {
      ctx.error(usageError(mistake.error, sub));
      return 2;
    }
    return runCrewKinds(ctx);
  }
  if (sub === "resume") {
    const args = parseResumeArgs(rest);
    if ("error" in args) {
      ctx.error(usageError(args.error, sub));
      return 2;
    }
    return await guarded(sub, ctx, () =>
      "all" in args ? runCrewResumePaused(args.lead, ctx) : runCrewResume(args.ref, ctx),
    );
  }
  if (sub === "status" || sub === "attach" || sub === "stop" || sub === "rm") {
    const args = parseTargetArgs(sub, rest);
    if ("error" in args) {
      ctx.error(usageError(args.error, sub));
      return 2;
    }
    const { ref } = args;
    const run = {
      attach: () => runCrewAttach(ref, ctx),
      rm: () => runCrewRm(ref, ctx),
      status: () => runCrewStatus(ref, ctx),
      stop: () => runCrewStop(ref, ctx),
    }[sub];
    return await guarded(sub, ctx, run);
  }
  if (sub === "start") {
    const args = parseStartArgs(rest);
    if ("error" in args) {
      ctx.error(usageError(args.error));
      return 2;
    }
    return await runCrewStart(args, ctx);
  }
  if (sub === "lead") {
    const args = parseLeadArgs(rest);
    if ("error" in args) {
      ctx.error(usageError(args.error));
      return 2;
    }
    return await runCrewLead(args, ctx);
  }
  if (sub === "step") {
    const args = parseStepArgs(rest);
    if ("error" in args) {
      ctx.error(usageError(args.error));
      return 2;
    }
    return await runCrewStep(args.step, args.note, ctx);
  }
  if (sub === "report") {
    const args = parseReportArgs(rest);
    if ("error" in args) {
      ctx.error(usageError(args.error));
      return 2;
    }
    return await runCrewReport(args, ctx);
  }
  if (sub === "answer") {
    const args = parseAnswerArgs(rest);
    if ("error" in args) {
      ctx.error(usageError(args.error));
      return 2;
    }
    return await runCrewAnswer(args, ctx);
  }
  if (sub === "tell") {
    const args = parseTellArgs(rest);
    if ("error" in args) {
      ctx.error(usageError(args.error, sub));
      return 2;
    }
    return await guarded(sub, ctx, () => runCrewTell(args, ctx));
  }
  if (sub === "watch") {
    const args = parseWatchArgs(rest);
    if ("error" in args) {
      ctx.error(usageError(args.error));
      return 2;
    }
    return await runCrewWatch(args, ctx);
  }
  if (sub === "self-watch") {
    const parsed = parseOptions(rest, [], ["--once"]);
    if ("error" in parsed) {
      ctx.error(usageError(parsed.error));
      return 2;
    }
    if (parsed.positionals.length > 0) {
      ctx.error(usageError(`Unknown argument: ${parsed.positionals.join(" ")}`));
      return 2;
    }
    return await runCrewSelfWatch(ctx, parsed.flags.has("--once"));
  }
  ctx.error(usageError(`Unknown crew command: ${sub}`));
  return 2;
}

/** `crew step`'s arguments, checked; or the mistake. */
export function parseStepArgs(
  argv: readonly string[],
): { error: string } | { note: null | string; step: string } {
  const parsed = parseOptions(argv, ["--note"]);
  if ("error" in parsed) return parsed;
  const [step, ...extra] = parsed.positionals;
  if (step === undefined) {
    return { error: `Say which step: crew step <${CREW_STEPS.join("|")}>` };
  }
  if (extra.length > 0) return { error: `Unknown argument: ${extra.join(" ")}` };
  if (!isCrewStep(step)) {
    return { error: `"${step}" is not a step: a step is one of ${CREW_STEPS.join(", ")}` };
  }
  return { note: parsed.options.get("--note") ?? null, step };
}

/** `crew report`'s arguments, checked; or the mistake. */
export function parseReportArgs(argv: readonly string[]): ReportArgs | { error: string } {
  const parsed = parseOptions(
    argv,
    ["--status", "--file", "--question", "--option", "--recommend"],
    [],
    ["--option"],
  );
  if ("error" in parsed) return parsed;
  const { options, lists, positionals } = parsed;
  if (positionals.length > 0) return { error: `Unknown argument: ${positionals.join(" ")}` };
  const status = options.get("--status") ?? null;
  if (status !== null && !isReportStatus(status)) {
    return { error: `Unknown status: ${status} (the statuses: ${REPORT_STATUS_NAMES.join(", ")})` };
  }
  const question = options.get("--question") ?? null;
  const optionValues = lists.get("--option") ?? [];
  const recommendRaw = options.get("--recommend") ?? null;
  let recommend: null | number = null;
  if (recommendRaw !== null) {
    const parsedNumber = Number(recommendRaw);
    if (!Number.isInteger(parsedNumber) || parsedNumber < 1) {
      return { error: `--recommend is the number of one of the options, not "${recommendRaw}"` };
    }
    recommend = parsedNumber;
  }
  if (question === null && status === null) {
    return {
      error: `Say what the report is: --status ${REPORT_STATUS_NAMES.join("|")}, or --question "<the question>"`,
    };
  }
  if (question !== null && status !== null) {
    return { error: "A report ends a phase; a question asks about it: give one, not both" };
  }
  // Each form takes its own options: one that belongs to the other is a mistake, not ignored.
  if (question === null && (optionValues.length > 0 || recommendRaw !== null)) {
    return { error: '--option and --recommend belong to a question: --question "<the question>"' };
  }
  if (question !== null && options.has("--file")) {
    return { error: "A question has no file: the question and its options are the whole of it" };
  }
  return {
    file: options.get("--file") ?? null,
    options: optionValues,
    question,
    recommend,
    status,
  };
}

/** `crew answer`'s arguments, checked; or the mistake. */
export function parseAnswerArgs(argv: readonly string[]): AnswerArgs | { error: string } {
  const parsed = parseOptions(argv, []);
  if ("error" in parsed) return parsed;
  const [crew, text, ...extra] = parsed.positionals;
  if (crew === undefined)
    return { error: 'Say which crew session: crew answer <crew session> "<text>"' };
  if (text === undefined) return { error: 'Say the answer: crew answer <crew session> "<text>"' };
  if (extra.length > 0) return { error: `Unknown argument: ${extra.join(" ")}` };
  return { text, crew };
}

/**
 * `crew tell`'s arguments, checked; or the mistake. The receivers come first and the text last,
 * because a receiver is a name (one quoted word) and the text is the sentence it says.
 */
export function parseTellArgs(argv: readonly string[]): TellArgs | { error: string } {
  const parsed = parseOptions(argv, ["--kind"]);
  if ("error" in parsed) return parsed;
  const kindText = parsed.options.get("--kind");
  if (kindText === undefined) {
    return { error: `Say the kind of the note: --kind <${TELL_KINDS.join("|")}>` };
  }
  if (!isTellKind(kindText)) {
    return {
      error: `Unknown kind: ${kindText} (a crew session tells ${TELL_KINDS.join(" or ")}, nothing else)`,
    };
  }
  const rest = parsed.positionals.slice(0, -1);
  const text = parsed.positionals.at(-1) ?? "";
  if (rest.length === 0) {
    return { error: `Say who you tell: crew tell <name…> --kind ${kindText} "<text>"` };
  }
  if (text.trim() === "") {
    return { error: `Say what you tell: crew tell <name…> --kind ${kindText} "<text>"` };
  }
  return { kind: kindText, text, to: rest };
}
/** `crew watch`'s arguments, checked; or the mistake. */
export function parseWatchArgs(argv: readonly string[]): WatchArgs | { error: string } {
  const parsed = parseOptions(argv, ["--lead", "--timeout"], ["--once"]);
  if ("error" in parsed) return parsed;
  if (parsed.positionals.length > 0) {
    return { error: `Unknown argument: ${parsed.positionals.join(" ")}` };
  }
  const once = parsed.flags.has("--once");
  const lead = parsed.options.get("--lead") ?? null;
  if (lead !== null && !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(lead)) {
    return { error: `"${lead}" is not a session id` };
  }
  const timeoutRaw = parsed.options.get("--timeout") ?? null;
  let timeoutSeconds: null | number = null;
  if (timeoutRaw !== null) {
    const seconds = Number(timeoutRaw);
    if (!Number.isInteger(seconds) || seconds < 0) {
      return { error: `--timeout is a whole number of seconds, not "${timeoutRaw}"` };
    }
    timeoutSeconds = seconds;
  }
  return { lead, once, timeoutSeconds };
}
