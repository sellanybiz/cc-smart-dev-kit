/**
 * The Bash judge: what a Bash line does that the launch policy judges, besides running.
 *
 * `job-route` is the one hook that answers it (PreToolUse on Bash, `job-route.ts`), and it is
 * **machine-wide** (`HookSpec.alwaysOn`): routing a heavy command through the queue is a
 * project's opt-in, but the judge below runs everywhere, whatever the project's file says. A
 * session must not be able to switch off the limits on its own launches by editing a file it
 * owns (the same reason `session-escape-guard` is always on).
 *
 * Four things a line does are judged, and nothing else:
 *   - **a raw background session** — `claude --bg` / `--background` — asks the person in an
 *     attended session, and is refused where nobody answers (`claude -p`). Both answers show
 *     the `crew start` line: that launch is recorded in the store, gets its own worktree and
 *     its lead, and its report is heard (D25). The crew launcher picks the kind's model and
 *     effort; a person who wants another one starts the session themselves (the launcher
 *     refuses an override the Agent guard would ask about — W1a).
 *   - **a print run** — `claude -p` / `--print` — by the launch policy every Agent launch meets
 *     (`judgeLaunch`, `src/hooks/agent-guard.ts`, the one home): the model and effort it names
 *     as `--model` and `--effort`, after Claude Code's own overrides. No model or no effort is
 *     refused; the `fable` tier asks; the `opus` tier at `max` asks; and where the outer session
 *     is itself `claude -p`, with nobody to answer, an ask is a refusal (the guard's own rule).
 *     The prompt is read for a `Fable reason:` line, so a Fable session the person asked for is
 *     an ask, exactly as for an agent.
 *   - **a crew session starting crew sessions** (`crew start` while `CC_SMART_DEV_KIT_CREW` is
 *     set) is denied: a crew session hands the need to its lead (D36, D45), in the launcher's
 *     own words (`CREW_NEVER_DOES`).
 *   - **polling** — a `crew list` / `crew status` read or a `claude agents --json` read inside a
 *     `while`/`until`/`for` loop or a `watch`, or next to a `sleep` — is denied: a crew
 *     session's news arrives by itself, through the lead's watch and the monitors, and a loop
 *     spends turns on nothing the watch does not already say.
 *
 * What it never judges: a `claude` subcommand (`claude agents`, `claude stop`, …), a `crew`
 * command that is not `start` or a status read, a `sleep` on its own, and a session's own work.
 * A word inside quotes, a here-doc or a comment is text, read through the one shell reader
 * (`src/shell/command.ts`), never a second lexer.
 */
import { COMMAND } from "../build-info/names";
import type { CliPaths } from "../cli/paths";
import { CREW_NEVER_DOES, REPORT_COMMAND } from "../crew/brief";
import { crewIdOf } from "../crew/session";
import { toolOf } from "../jobs/classify";
import {
  CHANGE_DIR,
  invocationOf,
  isAssignmentOnly,
  MAX_NESTING,
  nestedCommand,
  nestedDialect,
  shellSteps,
  wordsOf,
} from "../shell/command";
import { judgeLaunch, readGuardContext } from "./agent-guard";
import { isAttended } from "./attended";
import { type HookInput, type HookResult, stringField, toolDecision } from "./io";
import type { Env } from "./run";

/** One command a line runs: its program, its arguments, and its own words. */
export interface Step {
  args: string[];
  program: string;
  words: string[];
}

/** A Claude Code launch a Bash line starts. */
export interface ClaudeLaunch {
  effort: null | string;
  /** `bg`: `claude --bg`; `print`: `claude -p` / `--print`. */
  form: "bg" | "print";
  model: null | string;
  /** The positional words: the prompt a `-p` run reads, a reason line included. */
  prompt: string;
}

/** What one Bash line does, as the judge reads it. */
export interface BashReading {
  /** The `crew start` commands the line runs. */
  crewStarts: number;
  /** The `claude` launches it starts, in order. */
  launches: ClaudeLaunch[];
  /** The crew-status reads it runs: `crew list`, `crew status`, `claude agents --json`. */
  statusReads: number;
  /** Every command the line runs, its inner shell text included (three levels). */
  steps: Step[];
  /** The commands of the line itself, without the inner text of a shell it runs. */
  top: Step[];
  /** True for a loop keyword (`while`, `until`, `for`) or a `sleep`, anywhere in the line. */
  waits: boolean;
}

/**
 * The options of `claude` whose value is the next word, so it is not read as the prompt
 * (`claude --help`). An option this list does not know is skipped alone, so its value may be
 * read as prompt text: the judge only looks for a reason line there, and a reason line read
 * from anywhere in the command is still the person's own.
 */
const CLAUDE_VALUED = [
  "--add-dir",
  "--agent",
  "--agents",
  "--allowedTools",
  "--allowed-tools",
  "--append-system-prompt",
  "--autocompact",
  "--betas",
  "--debug-file",
  "--disallowedTools",
  "--disallowed-tools",
  "--effort",
  "--environment",
  "--fallback-model",
  "--file",
  "--input-format",
  "--json-schema",
  "--max-budget-usd",
  "--mcp-config",
  "--model",
  "--output-format",
  "--permission-mode",
  "--permission-prompts",
  "--plugin-dir",
  "--plugin-url",
  "--remote-control-session-name-prefix",
  "--session-id",
  "--setting-sources",
  "--settings",
  "--system-prompt",
  "--tools",
  "-n",
  "--name",
];

/** A loop keyword: its first word starts a loop over its body. */
const LOOP_KEYWORDS: ReadonlySet<string> = new Set(["for", "until", "while"]);

/** `watch`'s options that take a value, so the command watched starts after them. */
const WATCH_VALUED = ["-n", "--interval"];

/** `gh`'s options that take a value, so a value is never read as its subcommand. */
const GH_VALUED = ["-R", "--repo", "--hostname"];

/** True for `--flag`, `--flag=value`, or one of the exact short flags named. */
function hasFlag(args: readonly string[], ...names: readonly string[]): boolean {
  return args.some(
    (arg) =>
      names.includes(arg) ||
      (arg.startsWith("--") && names.some((name) => arg.startsWith(`${name}=`))),
  );
}

/** The value of a `--option <value>` or `--option=<value>`; null when the line names none. */
function optionValue(args: readonly string[], name: string): null | string {
  for (let index = 0; index < args.length; index++) {
    const arg = args[index] ?? "";
    if (arg === name) return args[index + 1] ?? null;
    if (arg.startsWith(`${name}=`)) return arg.slice(name.length + 1);
  }
  return null;
}

/** The words of a command that are neither options nor an option's value, in order. */
function positionalsOf(args: readonly string[], valued: readonly string[]): string[] {
  const found: string[] = [];
  for (let index = 0; index < args.length; index++) {
    const arg = args[index] ?? "";
    if (arg === "--") {
      found.push(...args.slice(index + 1));
      break;
    }
    if (arg.startsWith("-")) {
      if (!arg.includes("=") && valued.includes(arg)) index++;
      continue;
    }
    found.push(arg);
  }
  return found;
}

/** The launch a `claude` command starts; null for anything else (a subcommand, a plain run). */
function claudeLaunch(step: Step): ClaudeLaunch | null {
  if (step.program !== "claude") return null;
  const bg = hasFlag(step.args, "--bg", "--background");
  const print = hasFlag(step.args, "-p", "--print");
  if (!bg && !print) return null;
  return {
    effort: optionValue(step.args, "--effort"),
    form: bg ? "bg" : "print",
    model: optionValue(step.args, "--model"),
    prompt: positionalsOf(step.args, CLAUDE_VALUED).join(" "),
  };
}

/** True for `cc-smart-dev-kit crew start …`, whatever path the launcher is named by. */
function isCrewStart(program: string, args: string[]): boolean {
  return program === COMMAND && args[0] === "crew" && args[1] === "start";
}

/** True for a crew-status read: `crew list`, `crew status`, or `claude agents --json`. */
function isStatusRead(program: string, args: string[]): boolean {
  if (program === COMMAND && args[0] === "crew") {
    return args[1] === "list" || args[1] === "status";
  }
  return program === "claude" && args[0] === "agents" && hasFlag(args.slice(1), "--json");
}

/**
 * `cc-smart-dev-kit job run …`, whatever path the launcher is named by. The queue must not
 * nest, and a lead's queued job is one of the things it never waits on.
 */
export function isJobRun(program: string, args: string[]): boolean {
  return program === COMMAND && args[0] === "job" && args[1] === "run";
}

/** True for a CI watch a lead never waits on: `gh pr checks … --watch`, `gh run watch …`. */
function isCiWatch(program: string, args: string[]): boolean {
  if (program !== "gh") return false;
  const words = positionalsOf(args, GH_VALUED);
  if (words[0] === "run" && words[1] === "watch") return true;
  return words[0] === "pr" && words[1] === "checks" && hasFlag(args, "--watch");
}

/**
 * True for the project's full check: a package manager's `check` script (`bun run check`,
 * `npm run check`, `pnpm run check`, `yarn check`, …), read by the classifier's own tool table
 * (`toolOf`), so the script rules stay in one home.
 */
function isFullCheck(step: Step): boolean {
  return toolOf(step.program, step.args)?.script === "check";
}

/** The command `watch` runs, from the words after it: its own options are skipped, and a
 * command given as one quoted word is read as the words it holds (`watch -n 5 'crew list'`). */
function watchTarget(args: readonly string[]): string[] | null {
  let index = 0;
  while (index < args.length && (args[index] ?? "").startsWith("-")) {
    index += WATCH_VALUED.includes(args[index] ?? "") ? 2 : 1;
  }
  const target = args.slice(index);
  if (target.length === 0) return null;
  return target.length === 1 ? wordsOf(target[0] ?? "") : target;
}

/** True when the step's first word starts a loop (`while true; do …`). */
function startsLoop(words: readonly string[]): boolean {
  return LOOP_KEYWORDS.has(words[0] ?? "");
}

/** A `cd`, an assignment, or nothing: the shell's own step, never the work a line does. */
function isShellStep(step: Step): boolean {
  return isAssignmentOnly(step.words) || CHANGE_DIR.has(step.program);
}

/**
 * One line's commands, in order, its shells' inner text read too (`bash -c '…'`), three
 * levels deep — the same walk the classifier and `programsOf` make, over the one reader.
 */
function walk(
  line: string,
  dialect: "bash" | "powershell",
  depth: number,
  top: Step[],
  all: Step[],
): void {
  for (const step of shellSteps(line, { blindWhenOpen: true, dialect, joinLines: true })) {
    const words = wordsOf(step.text, dialect);
    if (words.length === 0) continue;
    const invocation = invocationOf(words);
    if (invocation === undefined) continue;
    const read = { args: invocation.args, program: invocation.program, words };
    if (depth === 0) top.push(read);
    all.push(read);
    const inner = nestedCommand(invocation.program, invocation.args, step.pipedFrom);
    if (inner !== undefined && depth < MAX_NESTING) {
      walk(inner, nestedDialect(invocation.program), depth + 1, top, all);
    }
  }
}

/** What the line does, as the judge reads it. Pure. */
export function readBash(command: string): BashReading {
  const top: Step[] = [];
  const steps: Step[] = [];
  walk(command, "bash", 0, top, steps);
  let crewStarts = 0;
  let statusReads = 0;
  let waits = false;
  const launches: ClaudeLaunch[] = [];
  for (const step of steps) {
    if (isCrewStart(step.program, step.args)) crewStarts++;
    if (isStatusRead(step.program, step.args)) statusReads++;
    if (startsLoop(step.words) || step.program === "sleep") waits = true;
    const target = step.program === "watch" ? watchTarget(step.args) : null;
    if (target !== null) {
      const watched = invocationOf(target);
      if (watched !== undefined && isStatusRead(watched.program, watched.args)) {
        statusReads++;
        waits = true;
      }
    }
    const launch = claudeLaunch(step);
    if (launch !== null) launches.push(launch);
  }
  return { crewStarts, launches, statusReads, steps, top, waits };
}

/** What a lead never waits on: the project's full check, a CI watch, or a queued job. */
export type Background = "check" | "ci-watch" | "job";

/**
 * Why a lead's line runs in the background, or null when it is nothing a lead waits on. The
 * whole line must be that thing (and `cd`s and assignments), so a compound line that also
 * does something else is left to run as the model wrote it.
 */
export function backgroundFor(top: readonly Step[]): Background | null {
  if (top.length === 0) return null;
  const everyStep = (one: (step: Step) => boolean) =>
    top.every((step) => isShellStep(step) || one(step)) && top.some(one);
  if (everyStep((step) => isCiWatch(step.program, step.args))) return "ci-watch";
  if (everyStep((step) => isJobRun(step.program, step.args))) return "job";
  if (everyStep(isFullCheck)) return "check";
  return null;
}

/** What the judge answers about one command line: an ask, a denial, or nothing. */
export interface BashVerdict {
  decision: "ask" | "deny";
  reason: string;
  /** A short word for the hook log: `bg`, `print`, `crew-start`, `poll`. */
  why: string;
}

/** What the judge reads from the session and the machine. */
export interface JudgeContext {
  env: Env;
  input: HookInput;
  paths: CliPaths;
}

/** The `crew start` line a raw background launch is told to use instead. */
function backgroundLaunchReason(): string {
  return [
    "This starts a raw background session (`claude --bg`): the kit does not record it, its lead never hears it, it runs outside a crew worktree, and it reports to nobody.",
    "Start the phase as a crew session instead:",
    `  ${COMMAND} crew start <phase> --slug <slug> --kind <kind> --brief <file|->`,
    `In a session that leads nothing yet, record the lead first: ${COMMAND} crew lead --plan <slug>.`,
    "The crew session starts on its kind's model and effort; for any other one, start the session yourself.",
  ].join("\n");
}

/** The words a crew session gets when it tries to start another (the launcher's own rule). */
function crewStartsNothing(crewId: string): string {
  return [
    `This session is the crew session \`${crewId}\`, and a crew session never ${CREW_NEVER_DOES.start}.`,
    `Hand the need to your lead: ${REPORT_COMMAND} --question "<the question>" --option "<choice>" --option "<choice>"`,
  ].join("\n");
}

/** The denial of a polling line: the news arrives by itself, through the watch and the monitors. */
function pollReason(): string {
  return [
    "This command polls for crew news, and a crew session's news arrives by itself: the lead's watch prints each change, and a monitor wakes the session.",
    `Read the crew with \`${COMMAND} crew watch\` — never a loop over \`crew list\`, \`crew status\` or \`claude agents --json\`, and never with \`sleep\` between reads.`,
  ].join("\n");
}

/** Said before the launch policy's own words, so a `claude -p` denial reads as one. */
const PRINT_FORM =
  "This Bash command starts a Claude Code session in print mode (`claude -p`), and the launch policy judges its model and effort like any Agent launch: name them as `--model <model> --effort <effort>`.";

/** The verdict on one launch; null when it may run. */
function judgeClaudeLaunch(launch: ClaudeLaunch, context: JudgeContext): BashVerdict | null {
  const crew = crewIdOf(context.env);
  if (launch.form === "bg") {
    // A crew session starting a session is the very thing `crew start` refuses; the judge says
    // the same before the launcher would, and never asks the person about it.
    if (crew !== null) return { decision: "deny", reason: crewStartsNothing(crew), why: "bg" };
    if (!isAttended(context.env)) {
      return {
        decision: "deny",
        reason: `${backgroundLaunchReason()}\nNobody answers a question in \`claude -p\`, so the raw launch is refused.`,
        why: "bg",
      };
    }
    return { decision: "ask", reason: backgroundLaunchReason(), why: "bg" };
  }
  // A print run is a launch like any Agent launch: the one policy judges it, with its words.
  const guard = readGuardContext(context.paths, context.input, context.env);
  const verdict = judgeLaunch(
    {
      effort: launch.effort,
      fork: false,
      model: launch.model,
      prompt: launch.prompt,
      subagentType: "general-purpose",
      tool: "Agent",
    },
    guard,
    context.env,
  );
  if (verdict.decision === "allow") return null;
  return { decision: verdict.decision, reason: `${PRINT_FORM}\n${verdict.reason}`, why: "print" };
}

/**
 * The judge's answer about one command line: a denial, an ask, or null when it judges nothing.
 * A denial wins over an ask, and the first launch that asks is the one named.
 */
export function judgeBash(reading: BashReading, context: JudgeContext): BashVerdict | null {
  const crew = crewIdOf(context.env);
  if (crew !== null && reading.crewStarts > 0) {
    return { decision: "deny", reason: crewStartsNothing(crew), why: "crew-start" };
  }
  let ask: BashVerdict | null = null;
  for (const launch of reading.launches) {
    const verdict = judgeClaudeLaunch(launch, context);
    if (verdict === null) continue;
    if (verdict.decision === "deny") return verdict;
    ask ??= verdict;
  }
  if (ask !== null) return ask;
  if (reading.statusReads > 0 && reading.waits) {
    return { decision: "deny", reason: pollReason(), why: "poll" };
  }
  return null;
}

/** The judge's answer as the hook's answer. */
export function judgeAnswer(verdict: BashVerdict): HookResult {
  return toolDecision(verdict.decision, verdict.reason);
}

/** The command of a Bash call, or null when the input names none. */
export function commandOf(input: HookInput): null | string {
  const fields = input.tool_input;
  if (typeof fields !== "object" || fields === null || Array.isArray(fields)) return null;
  return stringField((fields as Record<string, unknown>).command);
}

/** True when the judge judges this line: a launch, a crew start or a poll — its crash domain. */
export function judgedDomain(reading: BashReading): boolean {
  return (
    reading.crewStarts > 0 ||
    reading.launches.length > 0 ||
    (reading.statusReads > 0 && reading.waits)
  );
}
