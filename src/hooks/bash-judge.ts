/**
 * The Bash judge: what a shell line does that the launch policy judges, besides running. On
 * native Windows Claude Code has a PowerShell tool beside Bash, so the judge reads both
 * dialects (`readBash`'s `dialect`): a limit a session can step around by choosing the other
 * shell tool is not a limit.
 *
 * `job-route` is the one hook that answers it (PreToolUse on Bash and PowerShell,
 * `job-route.ts`), and it is **machine-wide** (`HookSpec.alwaysOn`): routing a heavy command
 * through the queue is a project's opt-in, but the judge below runs everywhere, whatever the
 * project's file says. A session must not be able to switch off the limits on its own launches
 * by editing a file it owns (the same reason `session-escape-guard` is always on).
 *
 * Six things a line does are judged, and nothing else:
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
 *   - **a crew session running a lead's command** (`crew start`, `answer`, `stop`, `rm`,
 *     `resume`, `watch`, `lead`, `lead tell`, while `CC_SMART_DEV_KIT_CREW` is set) is denied:
 *     a crew session hands the need to its lead (D36, D45), in the launcher's own words
 *     (`CREW_NEVER_RUNS`). The hook's environment is the session's own, so a line that unsets
 *     the variable itself (`env -u CC_SMART_DEV_KIT_CREW …`) does not get past it.
 *   - **a crew session running `workflow propose`** (the same variable) is denied (D24): the
 *     command pushes a branch and opens a pull request in children no hook sees, so the guards
 *     that deny the session's own `git push` and `gh pr create` never see them. The same
 *     environment rule holds.
 *   - **any other session running `workflow propose`** asks the person first (RF1-4) whenever
 *     the gate those guards read (`resolveGate`: the default, the person's file, the project's
 *     file as committed on `origin/<worktrees.base>`) has `autoPush` off or `openPr` short of
 *     `ready` — the command pushes a branch and opens a pull request ready for review. The
 *     question names the push, the pull request and the switch that says no; a gate or a project
 *     it cannot read is a question with its reason; in `claude -p`, where nobody answers, it is
 *     a denial. The portal's Workflow card asks on its page and runs the CLI in a child, which
 *     no hook sees, so it passes as before.
 *   - **polling** — a `crew list` / `crew status` read or a `claude agents --json` read that
 *     repeats over time: inside a `while`/`until`/`do` loop (bash, its condition included) or a
 *     PowerShell `while`/`do`, or a `watch`, or next to a `sleep`/`Start-Sleep` — is denied: a
 *     crew session's news arrives by itself, through the lead's watch and the monitors, and a
 *     loop spends turns on nothing the watch does not already say. A `for`/`foreach` over a
 *     fixed list with no wait, and a read whose output a later loop walks, are not polls.
 *
 * **A launch behind a wrapper or a computed program is judged too.** The reader steps over
 * `setsid`, `flock` and the other wrappers, and reads `npx`/`bunx`/`pnpm dlx` of
 * `@anthropic-ai/claude-code` as `claude`. A program the line works out when it runs
 * (`$(which claude) --bg`, `$CLAUDE -p`) is read from its own words: `--bg` is a background
 * launch, and `-p` counts only when a word names Claude Code (`cp -p` is no launch).
 *
 * What it never judges: a `claude` subcommand (`claude agents`, `claude stop`, …), a `crew`
 * command that is neither a lead's (`CREW_NEVER_RUNS`) nor a status read, a `sleep` on its
 * own, and a session's own work.
 * A word inside quotes, a here-doc or a comment is text, read through the one shell reader
 * (`src/shell/command.ts`), never a second lexer.
 */
import { isAbsolute, resolve } from "node:path";
import { COMMAND } from "../build-info/names";
import type { CliPaths } from "../cli/paths";
import {
  CREW_NEVER_PROPOSES,
  CREW_NEVER_RUNS,
  type CrewNeverRun,
  REPORT_COMMAND,
} from "../crew/brief";
import { CREW_QUESTION_STEP, crewIdOf } from "../crew/session";
import { toolOf } from "../jobs/classify";
import { loadProjectConfig, locateCheckout } from "../project/resolve";
import {
  CHANGE_DIR,
  type Dialect,
  invocationOf,
  isAssignmentOnly,
  isComputedWord,
  MAX_NESTING,
  nestedCommand,
  nestedDialect,
  shellSteps,
  withoutRedirections,
  wordsOf,
} from "../shell/command";
import { resolveGate, sourceLabel } from "../workflow/resolve";
import { judgeLaunch, readGuardContext } from "./agent-guard";
import { isAttended } from "./attended";
import { GUARD_GIT_TIMEOUT_MS } from "./git";
import { type HookInput, type HookResult, stringField, toolDecision } from "./io";
import { kitArguments, namesKit } from "./kit-invocation";
import type { Env } from "./run";

/** One command a line runs: its program, its arguments, and its own words. */
export interface Step {
  args: string[];
  /** The program is worked out when the line runs (`$CLAUDE`, `$(which claude)`). */
  computed: boolean;
  /** The step is inside a repeating loop (`while`, `until`, `do`) or a `watch`. */
  inRepeat: boolean;
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
  /** The `crew` subcommands the line runs that a crew session never runs (`CREW_NEVER_RUNS`). */
  crewNeverRuns: CrewNeverRun[];
  /** The `claude` launches it starts, in order. */
  launches: ClaudeLaunch[];
  /**
   * The line polls: a status read that repeats (a `while`/`until`/`do` loop or a `watch`),
   * or a status read next to a wait program (`sleep`, `Start-Sleep`). A `for`/`foreach` over
   * a fixed list with no wait is not a poll.
   */
  poll: boolean;
  /** The crew-status reads it runs: `crew list`, `crew status`, `claude agents --json`. */
  statusReads: number;
  /** Every command the line runs, its inner shell text included (three levels). */
  steps: Step[];
  /** The commands of the line itself, without the inner text of a shell it runs. */
  top: Step[];
  /** True for a loop keyword (`while`, `until`, `for`, `foreach`, `do`) or a `sleep`, anywhere in the line (the hook log). */
  waits: boolean;
  /** The line runs `workflow propose`, which a crew session never runs (`isWorkflowPropose`). */
  workflowPropose: boolean;
  /** The project each `workflow propose` of the line proposes into (`proposalOf`), in order. */
  proposals: Proposal[];
}

/**
 * The project one `workflow propose` proposes into, as far as the line says: the folder its
 * `--folder` names (null: the folder the line runs in), or `unread` when the judge cannot tell —
 * a program, a subcommand or a folder the line works out when it runs, or a `cd` before it.
 */
export type Proposal = { folder: null | string } | { unread: string };

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

/** A loop keyword: its first word starts a loop over its body. `foreach` is PowerShell's. */
const LOOP_KEYWORDS: ReadonlySet<string> = new Set(["do", "for", "foreach", "until", "while"]);

/** A program that waits: bash's `sleep`, and PowerShell's `Start-Sleep` (`sleep` is its alias). */
const WAIT_PROGRAMS: ReadonlySet<string> = new Set(["sleep", "start-sleep"]);

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

/**
 * The words that name what the kit's own command runs, or null when the step runs none of it.
 *
 * A named program is read by the argv the command itself gets: `kitArguments`
 * (`./kit-invocation`, the one recogniser `session-escape-guard` uses too) knows the kit by its
 * name, by a path to the launcher, and by its bundle behind another program — `bun
 * …/dist/cli.js workflow …, `find . -exec cc-smart-dev-kit … \;`, `watch -n 5 cc-smart-dev-kit …`
 * — and never a program that only reads its arguments. Redirections are dropped: the command
 * never sees them (`withoutRedirections`), so `cc-smart-dev-kit 2>/dev/null workflow propose` is
 * read as the command it really runs, and a redirect target (`… > -h`) is not read as a flag.
 *
 * A program the line works out when it runs (`$BIN crew answer …`, `$(command -v …) crew …`)
 * cannot be named, and the reader splits a substitution at its spaces, so nothing after it lines
 * up: its own words are all the judge has (`computedInvocationRisk`'s rule, `after-merge.ts`).
 */
function kitWordsOf(step: Step): null | string[] {
  if (!step.computed) return kitArguments(step.program, withoutRedirections(step.args));
  return withoutRedirections(step.words);
}

/**
 * Where the words the kit's command runs say `word`, or -1. A named program's argv is
 * positional: its first word is the subcommand. A program the line works out when it runs hands
 * the judge its own words, where the word may sit anywhere (`$(command -v cc-smart-dev-kit) crew
 * answer …` reaches the judge as the words `$(command`, `-v`, `cc-smart-dev-kit)`, `crew`, …).
 */
function kitWordAt(words: readonly string[], step: Step, word: string): number {
  if (words[0] === word) return 0;
  return step.computed ? words.indexOf(word) : -1;
}

/**
 * True when these words ask for help: `-h` or `--help` before a `--`, the rule the dispatcher
 * reads them with (`asksForHelp`, `src/cli/help.ts`). The judge keeps its own four lines rather
 * than import the CLI's help table, which drags every command into a hook bundle.
 */
function asksHelp(words: readonly string[]): boolean {
  for (const word of words) {
    if (word === "--") return false;
    if (word === "-h" || word === "--help") return true;
  }
  return false;
}

/**
 * The `crew` subcommand a step runs that a crew session never runs (`CREW_NEVER_RUNS`), or
 * null: `cc-smart-dev-kit crew start|answer|stop|rm|resume|watch|lead|lead tell …`, whatever
 * path the launcher is named by, and whichever program carries it. A crew session's own commands
 * (`step`, `report`, `tell`, `self-watch`, the board reads) are not in the map, so they pass.
 */
function crewNeverRunOf(step: Step): CrewNeverRun | null {
  const words = kitWordsOf(step);
  if (words === null) return null;
  const at = kitWordAt(words, step, "crew");
  if (at === -1) return null;
  // `crew answer --help` only prints the help (`runCrew` reads the flag before the command):
  // reading a lead command's help is no act of leading, so a crew session may.
  if (asksHelp(words.slice(at + 1))) return null;
  const sub =
    words[at + 1] === "lead" && words[at + 2] === "tell" ? "lead tell" : (words[at + 1] ?? "");
  return Object.hasOwn(CREW_NEVER_RUNS, sub) ? (sub as CrewNeverRun) : null;
}

/**
 * True when a step runs the kit's `workflow propose`. A crew session never runs it (D24): the
 * command pushes a branch and opens a pull request in children no hook sees, so the guards that
 * deny the session's own `git push` and `gh pr create` never see them.
 *
 * `--help` prints the usage and proposes nothing (the dispatcher answers it before any command
 * runs), so reading it is no act, as for a lead command's help. A subcommand the judge cannot
 * read — a word the line works out when it runs (`workflow $SUB`), or none at all (`echo propose
 * | xargs cc-smart-dev-kit workflow`) — may be `propose`: in a crew session it is refused rather
 * than let through.
 *
 * **A computed program with no subcommand is the kit's only when the line names the kit**
 * (`namesKit`, the test `session-escape-guard` makes too). Its words are all the judge has, and
 * `workflow` at their end is as likely a test filter or another program's subcommand
 * (`"$PY" -m pytest -k workflow`, `$(which gh) workflow`) as the kit's: a line that does not
 * name the kit proposes nothing there. The words `workflow propose`, and a subcommand the line
 * works out, keep their reading: they are the kit's own domain words.
 */
function isWorkflowPropose(step: Step, lineNamesKit: boolean): boolean {
  const words = kitWordsOf(step);
  if (words === null) return false;
  const at = kitWordAt(words, step, "workflow");
  if (at === -1 || asksHelp(words.slice(at + 1))) return false;
  const sub = words[at + 1];
  if (sub === undefined) return !step.computed || lineNamesKit;
  return sub === "propose" || isComputedWord(sub);
}

/**
 * The project a `workflow propose` step proposes into (`Proposal`), for a step
 * `isWorkflowPropose` already said yes to. `--folder` is read as the command reads it
 * (`proposeArgs`, `src/workflow/commands.ts`): the word after it. `moved`: the line changes its
 * folder somewhere (`cd`, `pushd`, `Set-Location`), so a folder it does not name absolutely is
 * not the input's `cwd`.
 */
function proposalOf(step: Step, moved: boolean): Proposal {
  if (step.computed) return { unread: "the program is worked out when the line runs" };
  const words = kitWordsOf(step) ?? [];
  const at = kitWordAt(words, step, "workflow");
  const sub = words[at + 1];
  if (sub === undefined) return { unread: "the line names no subcommand" };
  if (sub !== "propose") return { unread: "the subcommand is worked out when the line runs" };
  const flag = words.indexOf("--folder", at + 2);
  const folder = flag === -1 ? null : (words[flag + 1] ?? "");
  if (folder !== null && (folder === "" || isComputedWord(folder))) {
    return { unread: "its --folder is worked out when the line runs" };
  }
  if (moved && (folder === null || !isAbsolute(folder))) {
    return { unread: "the line changes its folder before it" };
  }
  return { folder };
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

/** True when the step's first word starts a loop (`while true; do …`, `foreach ($x in …)`). */
function startsLoop(words: readonly string[]): boolean {
  return LOOP_KEYWORDS.has((words[0] ?? "").toLowerCase());
}

/** An open shell loop: a `while`/`until`/`do` repeats; a `for`/`foreach` runs a fixed list. */
type LoopKind = "fixed" | "repeat";

/** What a walk of one line has open and seen so far. */
interface WalkState {
  /** The line holds a loop keyword (`while`, `until`, `for`, `foreach`, `do`). */
  loops: boolean;
  /** The bash loops open at this point, innermost last (`done` closes one). */
  open: LoopKind[];
  /**
   * A PowerShell `while` / `do` was seen. Braces cut the line into steps and there is no
   * `done`, so it holds for the rest of the line: a rare extra poll, never a miss.
   */
  powershellRepeat: boolean;
}

/**
 * Whether this step runs inside a repeating loop, and the loop state after it. Bash loops
 * open at `while`/`until`/`for`/`foreach` and close at `done`, so a status read in the
 * condition (`until <read>; do …`) and in the body both count; a `for`/`foreach` over a
 * fixed list does not repeat on its own (`F2a-6`). PowerShell has no `done`: its `while` and
 * `do` count from there to the end of the line.
 */
function loopMark(words: readonly string[], dialect: Dialect, state: WalkState): boolean {
  const first = (words[0] ?? "").toLowerCase();
  if (dialect === "powershell") {
    if (first === "while" || first === "do") state.powershellRepeat = true;
    return state.powershellRepeat;
  }
  if (first === "done") {
    state.open.pop();
    return state.open.includes("repeat");
  }
  if (first === "while" || first === "until") state.open.push("repeat");
  else if (first === "for" || first === "foreach") state.open.push("fixed");
  return state.open.includes("repeat");
}

/** A `cd`, an assignment, or nothing: the shell's own step, never the work a line does. */
function isShellStep(step: Step): boolean {
  return isAssignmentOnly(step.words) || CHANGE_DIR.has(step.program);
}

/**
 * One line's commands, in order, its shells' inner text read too (`bash -c '…'`), three
 * levels deep — the same walk the classifier and `programsOf` make, over the one reader.
 * `loops` records a loop keyword even where it starts no command of its own: in PowerShell
 * `while ($true) { … }` splits at the parentheses, so `while` is a step with no program.
 */
function walk(
  line: string,
  dialect: "bash" | "powershell",
  depth: number,
  top: Step[],
  all: Step[],
  state: WalkState,
): void {
  for (const step of shellSteps(line, { blindWhenOpen: true, dialect, joinLines: true })) {
    const words = wordsOf(step.text, dialect);
    if (words.length === 0) continue;
    // The loop state is read before the program: `done` has none, and it closes a loop.
    const inRepeat = loopMark(words, dialect, state);
    if (startsLoop(words)) state.loops = true;
    const invocation = invocationOf(words);
    if (invocation === undefined) continue;
    const read = {
      args: invocation.args,
      computed: invocation.computed,
      inRepeat,
      program: invocation.program,
      words,
    };
    if (depth === 0) top.push(read);
    all.push(read);
    const inner = nestedCommand(invocation.program, invocation.args, step.pipedFrom);
    if (inner !== undefined && depth < MAX_NESTING) {
      walk(inner, nestedDialect(invocation.program), depth + 1, top, all, state);
    }
  }
}

/** The `claude` launch a computed program's words name, or null. */
function computedLaunch(step: Step): ClaudeLaunch | null {
  if (!step.computed) return null;
  const lower = step.words.map((word) => word.toLowerCase());
  // `--bg` is Claude Code's own flag; `-p` is common elsewhere (`cp -p`, `mkdir -p`), so it
  // counts only when a word names Claude Code too (`$(which claude) -p …`).
  const bg = lower.some((word) => word === "--bg" || word === "--background");
  const print =
    lower.some((word) => word === "-p" || word === "--print") &&
    lower.some((word) => word.includes("claude"));
  if (!bg && !print) return null;
  return {
    effort: optionValue(step.args, "--effort"),
    form: bg ? "bg" : "print",
    model: optionValue(step.args, "--model"),
    prompt: positionalsOf(step.args, CLAUDE_VALUED).join(" "),
  };
}

/** What the line does, as the judge reads it. Pure. `dialect` is the tool that runs it. */
export function readBash(command: string, dialect: Dialect = "bash"): BashReading {
  const top: Step[] = [];
  const steps: Step[] = [];
  const state: WalkState = { loops: false, open: [], powershellRepeat: false };
  walk(command, dialect, 0, top, steps, state);
  const crewNeverRuns: CrewNeverRun[] = [];
  let statusReads = 0;
  let statusReadsInLoop = 0;
  let waits = state.loops;
  let workflowPropose = false;
  const proposals: Proposal[] = [];
  const moved = steps.some((step) => CHANGE_DIR.has(step.program));
  const lineNamesKit = namesKit(command);
  const launches: ClaudeLaunch[] = [];
  for (const step of steps) {
    const never = crewNeverRunOf(step);
    if (never !== null) crewNeverRuns.push(never);
    if (isWorkflowPropose(step, lineNamesKit)) {
      workflowPropose = true;
      proposals.push(proposalOf(step, moved));
    }
    if (isStatusRead(step.program, step.args)) {
      statusReads++;
      if (step.inRepeat) statusReadsInLoop++;
    }
    if (WAIT_PROGRAMS.has(step.program)) waits = true;
    const target = step.program === "watch" ? watchTarget(step.args) : null;
    if (target !== null) {
      const watched = invocationOf(target);
      if (watched !== undefined && isStatusRead(watched.program, watched.args)) {
        statusReads++;
        // `watch` runs its command again and again: that is the repetition, not a loop.
        statusReadsInLoop++;
        waits = true;
      }
    }
    const launch = claudeLaunch(step) ?? computedLaunch(step);
    if (launch !== null) launches.push(launch);
  }
  // A status read repeats over time, or sits next to a wait: a `for`/`foreach` over a fixed
  // list with no wait is neither, so a `for id in a b; do … status …; done` passes (F2a-6).
  const poll = statusReadsInLoop > 0 || (sleepsIn(steps) && statusReads > 0);
  return {
    crewNeverRuns,
    launches,
    poll,
    proposals,
    statusReads,
    steps,
    top,
    waits,
    workflowPropose,
  };
}

/** True when the line runs a program that waits (`sleep`, `Start-Sleep`). */
function sleepsIn(steps: readonly Step[]): boolean {
  return steps.some((step) => WAIT_PROGRAMS.has(step.program));
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
  /** A short word for the hook log: `bg`, `print`, `crew-command`, `crew-propose`, `poll`. */
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

/** The words a crew session gets when it runs a lead's command (the launcher's own rule). */
function crewNeverRunsAnswer(crewId: string, command: CrewNeverRun): string {
  return [
    `This session is the crew session \`${crewId}\`, and a crew session never ${CREW_NEVER_RUNS[command]}.`,
    `Hand the need to your lead: ${REPORT_COMMAND} --question "<the question>" --option "<choice>" --option "<choice>"`,
  ].join("\n");
}

/**
 * The words a crew session gets when it runs `workflow propose`: the command's own refusal
 * (`src/workflow/propose.ts`) says the same, so the two belts read as one rule.
 */
function crewProposeAnswer(crewId: string): string {
  return [
    `This session is the crew session \`${crewId}\`, and a crew session never ${CREW_NEVER_PROPOSES}: \`${COMMAND} workflow propose\` pushes a branch and opens a pull request in children no hook sees.`,
    CREW_QUESTION_STEP,
  ].join("\n");
}

/**
 * What `workflow propose` does that the guards never see: `git push -u origin <branch>` and
 * `gh pr create` without `--draft` (`src/workflow/propose.ts`, step 7), both in its children.
 */
function proposeActs(base: null | string): string {
  const into = base === null ? "the project's integration base (worktrees.base)" : `\`${base}\``;
  return `This runs \`${COMMAND} workflow propose\`: it pushes a new branch to origin and opens a pull request into ${into} that is ready for review, in child processes no hook sees, so the git and merge guards never ask about either.`;
}

/** Said after every question about a proposal: the person decides. */
const APPROVE_IF_MEANT = "Approve it if you meant it.";

/** The question when the judge cannot name the project a proposal goes into, with why. */
function cannotTellProject(why: string): string {
  return `${proposeActs(null)}\n${COMMAND} cannot tell which project's workflow this line proposes into (${why}), so it cannot read the gate. ${APPROVE_IF_MEANT}`;
}

/**
 * Why a proposal into the project at `folder` is the person's to approve, or null when the gate
 * the git and merge guards read allows both its push and its pull request: `autoPush` on and
 * `openPr` at `ready` (a pull request that opens ready, `openPrRefusal`'s rule). The gate is read
 * as those guards read it (`resolveGate`, `src/hooks/push-policy.ts`): the built-in default, the
 * person's own file, and the project's file as committed on `origin/<worktrees.base>`, never a
 * checkout's working copy. Anything it cannot read is a question with its reason, never a guess.
 */
function proposeQuestion(folder: string, context: JudgeContext): string | null {
  let checkout: ReturnType<typeof locateCheckout>;
  let base: null | string;
  try {
    checkout = locateCheckout(folder, { env: context.env });
    if (checkout === null) return cannotTellProject(`${folder} is not in a git project`);
    base = loadProjectConfig(checkout).config?.worktrees?.base ?? null;
  } catch (error) {
    return cannotTellProject(error instanceof Error ? error.message : String(error));
  }
  const acts = proposeActs(base);
  try {
    const read = resolveGate(context.paths, checkout, base, {
      env: context.env,
      timeoutMs: GUARD_GIT_TIMEOUT_MS,
    });
    if (!read.ok) {
      return `${acts}\n${COMMAND} cannot tell whether the push and the pull request are allowed: the workflow committed on ${base} cannot be read (${read.why}). ${APPROVE_IF_MEANT}`;
    }
    const { autoPush, openPr } = read.gate.resolved;
    const off: string[] = [];
    if (!autoPush.value) off.push(`autoPush is off (${sourceLabel(autoPush, base)})`);
    if (openPr.value !== "ready") {
      off.push(`openPr is ${openPr.value} (${sourceLabel(openPr, base)})`);
    }
    if (off.length === 0) return null;
    return `${acts}\n${off.join(", and ")}, so the push and the pull request are yours to approve. ${APPROVE_IF_MEANT}`;
  } catch (error) {
    // The person's own workflow file is broken (`WorkflowConfigError`): the gate is unknown.
    const why = error instanceof Error ? error.message : String(error);
    return `${acts}\n${COMMAND} cannot tell whether the push and the pull request are allowed: the workflow settings cannot be read (${why}). ${APPROVE_IF_MEANT}`;
  }
}

/**
 * The verdict on a line's proposals in a session that is not a crew session (RF1-4): an ask with
 * the first question one of them raises, a denial where nobody answers (`claude -p`), or null
 * when the gate allows every one. A crew session is denied before this (D24).
 */
function judgeProposals(proposals: readonly Proposal[], context: JudgeContext): BashVerdict | null {
  const cwd = stringField(context.input.cwd);
  let question: null | string = null;
  for (const proposal of proposals) {
    if ("unread" in proposal) {
      question = cannotTellProject(proposal.unread);
    } else if (cwd === null) {
      question = cannotTellProject("the call names no folder");
    } else {
      // A relative `--folder` is relative to the folder the line runs in, as the command reads it.
      question = proposeQuestion(
        proposal.folder === null ? cwd : resolve(cwd, proposal.folder),
        context,
      );
    }
    if (question !== null) break;
  }
  if (question === null) return null;
  if (!isAttended(context.env)) {
    return {
      decision: "deny",
      reason: `${question}\nNobody answers a question in \`claude -p\`, so the proposal is refused.`,
      why: "propose",
    };
  }
  return { decision: "ask", reason: question, why: "propose" };
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
    if (crew !== null)
      return { decision: "deny", reason: crewNeverRunsAnswer(crew, "start"), why: "bg" };
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
      isolation: null,
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
  // The hook's environment is the session's own: a line that unsets the variable itself
  // (`env -u CC_SMART_DEV_KIT_CREW …`) is still this crew session's, and its first lead
  // command is the one named.
  const never = reading.crewNeverRuns[0];
  if (crew !== null && never !== undefined) {
    return { decision: "deny", reason: crewNeverRunsAnswer(crew, never), why: "crew-command" };
  }
  // `workflow propose` is no `crew` subcommand, but a crew session never runs it either (D24).
  if (crew !== null && reading.workflowPropose) {
    return { decision: "deny", reason: crewProposeAnswer(crew), why: "crew-propose" };
  }
  // Anyone else's proposal crosses the gate the git and merge guards read, in children they never
  // see: the person approves it where that gate says the push or the pull request is theirs.
  let ask: BashVerdict | null = null;
  if (reading.proposals.length > 0) {
    const proposed = judgeProposals(reading.proposals, context);
    if (proposed?.decision === "deny") return proposed;
    ask = proposed;
  }
  for (const launch of reading.launches) {
    const verdict = judgeClaudeLaunch(launch, context);
    if (verdict === null) continue;
    if (verdict.decision === "deny") return verdict;
    ask ??= verdict;
  }
  if (ask !== null) return ask;
  if (reading.poll) {
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

/**
 * True when the judge judges this line: a launch, a lead command, `workflow propose` or a poll —
 * its crash domain.
 */
export function judgedDomain(reading: BashReading): boolean {
  return (
    reading.crewNeverRuns.length > 0 ||
    reading.launches.length > 0 ||
    reading.poll ||
    reading.workflowPropose
  );
}
