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
 * The judge covers Herdr commands and these launch and proposal cases:
 *   - **a raw background session** — `claude --bg` / `--background` — asks the person in an
 *     attended session, and is refused where nobody answers (`claude -p`). Such a session runs
 *     beside this one, nobody watches it and it reports to nobody: the kit's work runs in
 *     subagents, which report back to the session that started them.
 *   - **a print run** — `claude -p` / `--print` — by the launch policy every Agent launch meets
 *     (`judgeLaunch`, `src/hooks/agent-guard.ts`, the one home): the model and effort it names
 *     as `--model` and `--effort`, after Claude Code's own overrides. No model or no effort is
 *     refused; the `fable` tier asks; the `opus` tier at `max` asks; and where the outer session
 *     is itself `claude -p`, with nobody to answer, an ask is a refusal (the guard's own rule).
 *     The prompt is read for a `Fable reason:` line, so a Fable session the person asked for is
 *     an ask, exactly as for an agent.
 *   - **`workflow propose`** asks the person first (RF1-4) whenever the gate the git and merge
 *     guards read (`resolveGate`: the default, the person's file, the project's
 *     file as committed on `origin/<worktrees.base>`) has `autoPush` off or `openPr` short of
 *     `ready` — the command pushes a branch and opens a pull request ready for review. The
 *     question names the push, the pull request and the switch that says no; a gate or a project
 *     it cannot read is a question with its reason; in `claude -p`, where nobody answers, it is
 *     a denial. The portal's Workflow card asks on its page and runs the CLI in a child, which
 *     no hook sees, so it passes as before.
 *
 * **A launch behind a wrapper or a computed program is judged too.** The reader steps over
 * `setsid`, `flock` and the other wrappers, and reads `npx`/`bunx`/`pnpm dlx` of
 * `@anthropic-ai/claude-code` as `claude`. A program the line works out when it runs
 * (`$(which claude) --bg`, `$CLAUDE -p`) is read from its own words: `--bg` is a background
 * launch, and `-p` counts only when a word names Claude Code (`cp -p` is no launch).
 *
 * What it never judges: a `claude` subcommand (`claude agents`, `claude stop`, …), and a
 * session's own work.
 * A word inside quotes, a here-doc or a comment is text, read through the one shell reader
 * (`src/shell/command.ts`), never a second lexer.
 */
import { isAbsolute, resolve } from "node:path";
import { COMMAND } from "../build-info/names";
import type { CliPaths } from "../cli/paths";
import { machineRule, readMachines } from "../herdr/machines";
import {
  childModeAllowed,
  HERDR_VERBS,
  normalizeMode,
  parseHerdrArgs,
  RELAY_MESSAGE_LIMIT,
  relayMessageLength,
} from "../herdr/words";
import {
  checkoutFailure,
  loadProjectConfig,
  locateCheckout,
  type TimeFor,
} from "../project/resolve";
import {
  CHANGE_DIR,
  type Dialect,
  invocationOf,
  invocationsOf,
  isComputedWord,
  MAX_NESTING,
  nestedCommand,
  nestedDialect,
  type RunInvocation,
  shellSteps,
  withoutRedirections,
  wordsOf,
} from "../shell/command";
import { resolveGate, sourceLabel } from "../workflow/resolve";
import { HERDR_START, judgeLaunch, PRINT_RUN, readGuardContext } from "./agent-guard";
import { isAttended } from "./attended";
import { SHORT_GUARD_BUDGET_MS, startBudget } from "./budget";
import { GUARD_GIT_TIMEOUT_MS } from "./git";
import { type HookInput, type HookResult, stringField, toolDecision } from "./io";
import { kitArguments, namesKit } from "./kit-invocation";
import type { Env } from "./run";

/** One command a line runs: its program, its arguments, and its own words. */
export interface Step {
  args: string[];
  /** The program is worked out when the line runs (`$CLAUDE`, `$(which claude)`). */
  computed: boolean;
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
  /** Commands used by the Herdr rules, including commands behind wrappers. */
  invocations: RunInvocation[];
  /** The line names hc/herdr-app, or names herdr alongside the kit command. */
  namesHerdr: boolean;
  /** A shell assignment targets the Herdr terminal identity anywhere on this line. */
  identityAssigned: boolean;
  /** The `claude` launches it starts, in order. */
  launches: ClaudeLaunch[];
  /** Every command the line runs, its inner shell text included (three levels). */
  steps: Step[];
  /** The line runs `workflow propose` (`isWorkflowPropose`). */
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
 * A program the line works out when it runs (`$BIN workflow …`, `$(command -v …) workflow …`)
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
 * the judge its own words, where the word may sit anywhere (`$(command -v cc-smart-dev-kit)
 * workflow propose` reaches the judge as the words `$(command`, `-v`, `cc-smart-dev-kit)`,
 * `workflow`, …).
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
 * True when a step runs the kit's `workflow propose`. The command pushes a branch and opens a
 * pull request in children no hook sees, so the guards that judge the session's own `git push`
 * and `gh pr create` never see them.
 *
 * `--help` prints the usage and proposes nothing (the dispatcher answers it before any command
 * runs), so reading it is no act. A subcommand the judge cannot read — a word the line works out
 * when it runs (`workflow $SUB`), or none at all (`echo propose | xargs cc-smart-dev-kit
 * workflow`) — may be `propose`: it is judged rather than let through.
 *
 * **A computed program is the kit's only when the line names the kit** (`namesKit`, the test
 * `session-escape-guard` makes too), unless the words say `workflow propose`. Its words are all
 * the judge has, and `workflow` at their end, or followed by a word the line works out, is as
 * likely a test filter or another program's subcommand and argument (`"$PY" -m pytest -k
 * workflow $EXTRA`, `$(which gh) workflow $SUB`) as the kit's: a line that does not name the
 * kit proposes nothing there. The words `workflow propose` are the kit's own domain words and
 * keep their reading on any line.
 */
function isWorkflowPropose(step: Step, lineNamesKit: boolean): boolean {
  const words = kitWordsOf(step);
  if (words === null) return false;
  const at = kitWordAt(words, step, "workflow");
  if (at === -1 || asksHelp(words.slice(at + 1))) return false;
  const sub = words[at + 1];
  if (sub === "propose") return true;
  // Not `propose`: a word the kit would read as another subcommand is no proposal, so only a
  // missing or a computed one is open, and a computed program's open word is the kit's only
  // when the line names the kit.
  if (sub !== undefined && !isComputedWord(sub)) return false;
  return !step.computed || lineNamesKit;
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

/**
 * `cc-smart-dev-kit job run …`, whatever path the launcher is named by: the queue must not
 * nest.
 */
export function isJobRun(program: string, args: string[]): boolean {
  return program === COMMAND && args[0] === "job" && args[1] === "run";
}

/**
 * One line's commands, in order, its shells' inner text read too (`bash -c '…'`), three
 * levels deep — the same walk the classifier and `programsOf` make, over the one reader.
 */
function walk(line: string, dialect: "bash" | "powershell", depth: number, all: Step[]): void {
  for (const step of shellSteps(line, { blindWhenOpen: true, dialect, joinLines: true })) {
    const words = wordsOf(step.text, dialect);
    if (words.length === 0) continue;
    const invocation = invocationOf(words);
    if (invocation === undefined) continue;
    all.push({
      args: invocation.args,
      computed: invocation.computed,
      program: invocation.program,
      words,
    });
    const inner = nestedCommand(invocation.program, invocation.args, step.pipedFrom);
    if (inner !== undefined && depth < MAX_NESTING) {
      walk(inner, nestedDialect(invocation.program), depth + 1, all);
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
  const steps: Step[] = [];
  walk(command, dialect, 0, steps);
  let workflowPropose = false;
  const proposals: Proposal[] = [];
  const moved = steps.some((step) => CHANGE_DIR.has(step.program));
  const lineNamesKit = namesKit(command);
  const launches: ClaudeLaunch[] = [];
  for (const step of steps) {
    if (isWorkflowPropose(step, lineNamesKit)) {
      workflowPropose = true;
      proposals.push(proposalOf(step, moved));
    }
    const launch = claudeLaunch(step) ?? computedLaunch(step);
    if (launch !== null) launches.push(launch);
  }
  const invocations = invocationsOf(command, dialect);
  const namesHerdr =
    shellSteps(command, { dialect, blindWhenOpen: true, joinLines: true }).some((step) =>
      wordsOf(step.text, dialect).some((word) =>
        word
          .split(/[=\s()]+/)
          .some(
            (token) =>
              ["hc", "herdr-app"].includes(token) || (token === "herdr" && namesKit(command)),
          ),
      ),
    ) || invocations.some((one) => one.program === "hc" || one.program === "herdr-app");
  return {
    launches,
    proposals,
    steps,
    workflowPropose,
    invocations,
    namesHerdr,
    identityAssigned: assignsHerdrIdentity(command, dialect),
  };
}

/** What the judge answers about one command line: an ask, a denial, or nothing. */
export interface BashVerdict {
  decision: "ask" | "deny";
  reason: string;
  /** A short word for the hook log: `bg`, `print`, `propose`. */
  why: string;
}

/** What the judge reads from the session and the machine. */
export interface JudgeContext {
  env: Env;
  input: HookInput;
  paths: CliPaths;
  /**
   * When the hook started (ms since the epoch: the frame's `nowMs`). The time budget of the
   * git calls a question makes counts from there, so the frame's own project lookup, which
   * runs first, is already spent from it. Unset: from the judge's own start.
   */
  startedAtMs?: number;
}

/** Why a raw background launch is the person's to approve, and what to use instead. */
const BACKGROUND_LAUNCH_REASON = [
  "This starts a raw background session (`claude --bg`): it runs beside this session, nobody watches it, and it reports to nobody.",
  "Build the work with subagents instead (the Agent tool): each one reports back to the session that started it.",
].join("\n");

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
function proposeQuestion(folder: string, context: JudgeContext, timeFor: TimeFor): string | null {
  let checkout: ReturnType<typeof locateCheckout>;
  let base: null | string;
  try {
    // `job-route` has 10 s in `hooks.json`, and Claude Code kills a hook that overruns: the git
    // calls here share one budget (`budget.ts`). A call that timed out, or was not made for want of
    // time, is an error saying git did not answer (`GIT_TIMED_OUT`), never "not in a git project".
    checkout = locateCheckout(folder, { env: context.env, timeFor });
    if (checkout === null) return cannotTellProject(`${folder} is not in a git project`);
    base = loadProjectConfig(checkout).config?.worktrees?.base ?? null;
  } catch (error) {
    // The reason alone: the question names it in a sentence, and a timeout's own fix ("run this
    // again") is for a command the person ran, not for a line they are asked to approve.
    return cannotTellProject(checkoutFailure(error));
  }
  const acts = proposeActs(base);
  try {
    const read = resolveGate(context.paths, checkout, base, {
      env: context.env,
      timeFor,
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
 * The verdict on a line's proposals (RF1-4): an ask with the first question one of them raises,
 * a denial where nobody answers (`claude -p`), or null when the gate allows every one.
 */
function judgeProposals(proposals: readonly Proposal[], context: JudgeContext): BashVerdict | null {
  const cwd = stringField(context.input.cwd);
  // One deadline for every git call the questions make, whatever the number of proposals,
  // counted from the hook's start.
  const { timeFor } = startBudget(
    context.env,
    Date.now,
    SHORT_GUARD_BUDGET_MS,
    context.startedAtMs,
  );
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
        timeFor,
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

/** Said before the launch policy's own words, so a `claude -p` denial reads as one. */
const PRINT_FORM =
  "This Bash command starts a Claude Code session in print mode (`claude -p`), and the launch policy judges its model and effort like any Agent launch: name them as `--model <model> --effort <effort>`.";

/** The verdict on one launch; null when it may run. */
function judgeClaudeLaunch(launch: ClaudeLaunch, context: JudgeContext): BashVerdict | null {
  if (launch.form === "bg") {
    if (!isAttended(context.env)) {
      return {
        decision: "deny",
        reason: `${BACKGROUND_LAUNCH_REASON}\nNobody answers a question in \`claude -p\`, so the raw launch is refused.`,
        why: "bg",
      };
    }
    return { decision: "ask", reason: BACKGROUND_LAUNCH_REASON, why: "bg" };
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
      // A print run has no agent definition: the policy reads none, and says so (`PRINT_RUN`).
      tool: PRINT_RUN,
    },
    guard,
    context.env,
  );
  if (verdict.decision === "allow") return null;
  return { decision: verdict.decision, reason: `${PRINT_FORM}\n${verdict.reason}`, why: "print" };
}

/** PowerShell splits method calls and braced assignments across shell steps.
 * Whole-line patterns lean to the safe side: matching text in a string literal can deny too.
 */
function powershellIdentity(command: string): boolean {
  return [
    /\$\{?env:hc_terminal_id\}?\s*\+?=(?!=)/i,
    /\b(?:set-item|si|new-item|ni|set-content|add-content|copy-item|rename-item|move-item)\b[^\n;|]*\benv:[\\/]?hc_terminal_id\b/i,
    /\bSetEnvironmentVariable\s*\(\s*['"]HC_TERMINAL_ID['"]/i,
    /\brename-item\b[^\n;|]*\benv:[^\n;|]*\s+['"]?HC_TERMINAL_ID\b/i,
  ].some((pattern) => pattern.test(command));
}

/** Assignment-only steps have no invocation, so keep their shell words too. */
function assignsHerdrIdentity(command: string, dialect: Dialect, depth = 0): boolean {
  if (dialect === "powershell" && powershellIdentity(command)) return true;
  const assigned = (word: string) => /^HC_TERMINAL_ID(?:\+?=|$)/.test(word);
  return shellSteps(command, { dialect, blindWhenOpen: true, joinLines: true }).some((step) => {
    const words = wordsOf(step.text, dialect);
    if (["for", "select"].includes(words[0] ?? "") && assigned(words[1] ?? "")) return true;
    const invocation = invocationOf(words);
    if (words[0] === "HC_TERMINAL_ID" && words[1] === "=") return true;
    if (invocation === undefined) return words.some(assigned);
    const { program, args, prefix } = invocation;
    if (
      prefix.some((word) => /^HC_TERMINAL_ID\+?=/.test(word)) ||
      (["export", "declare", "typeset", "local", "readonly"].includes(program) &&
        args.some(assigned)) ||
      (program === "printf" &&
        args.some(
          (word, at) =>
            (word === "-v" && assigned(args[at + 1] ?? "")) ||
            (word.startsWith("-v") && assigned(word.slice(2))),
        )) ||
      (program === "let" && args.some((word) => /^HC_TERMINAL_ID\s*(?:\+?=|$)/.test(word))) ||
      (program === "getopts" && args.some(assigned)) ||
      (["declare", "typeset", "local"].includes(program) &&
        args.some((word) => /^-[a-zA-Z]*n[a-zA-Z]*$/.test(word)) &&
        args.some((word) => word.split("=")[1] === "HC_TERMINAL_ID")) ||
      (["read", "mapfile", "readarray"].includes(program) && args.some(assigned))
    )
      return true;
    const inner = nestedCommand(program, args, step.pipedFrom);
    return (
      inner !== undefined &&
      depth < MAX_NESTING &&
      assignsHerdrIdentity(inner, nestedDialect(program), depth + 1)
    );
  });
}

/** The kit's Herdr arguments, including computed kit programs in a domain-naming line. */
function herdrArguments(
  one: Pick<RunInvocation, "program" | "args" | "computed">,
  reading: BashReading,
): string[] | null {
  const args = kitArguments(one.program, withoutRedirections(one.args));
  if (args?.[0] === "herdr") return args.slice(1);
  if (one.computed) {
    const at = one.args.indexOf("herdr");
    if (
      at >= 0 &&
      (reading.namesHerdr || (HERDR_VERBS as readonly string[]).includes(one.args[at + 1] ?? ""))
    )
      return one.args.slice(at + 1);
  }
  return null;
}

function herdrDomain(reading: BashReading): boolean {
  return reading.invocations.some(
    (one) =>
      one.program === "hc" ||
      one.program === "herdr-app" ||
      (one.computed && reading.namesHerdr) ||
      herdrArguments(one, reading) !== null,
  );
}

/** Quote short prompt excerpts without terminal controls or invisible direction changes. */
function herdrExcerpt(text: string): string {
  const excerpt = text.slice(0, RELAY_MESSAGE_LIMIT);
  const points = Array.from(excerpt);
  const quoted = points
    .map((char) =>
      /[\p{Cc}\p{Cf}]/u.test(char)
        ? Array.from(
            { length: char.length },
            (_, i) => `\\u${char.charCodeAt(i).toString(16).padStart(4, "0")}`,
          ).join("")
        : JSON.stringify(char).slice(1, -1),
    )
    .join("");
  return `"${quoted}"${relayMessageLength(text) > RELAY_MESSAGE_LIMIT ? "…" : ""}`;
}

/** Herdr policy never calls hc: it uses only the line, hook mode and machine allowlist. */
function judgeHerdr(reading: BashReading, context: JudgeContext): BashVerdict | null {
  if (!herdrDomain(reading)) return null;
  const verdict = (decision: "ask" | "deny", reason: string): BashVerdict => ({
    decision,
    reason,
    why: "herdr",
  });
  if (reading.identityAssigned)
    return verdict("deny", "Do not set HC_TERMINAL_ID: Herdr supplies the terminal identity.");
  let ask: BashVerdict | null = null;
  // steps preserves repeated executions, unlike the deduplicated invocations.
  const hasAnswer = reading.steps.some((step) => herdrArguments(step, reading)?.[0] === "answer");
  if (
    reading.invocations.some(
      (one) => herdrArguments(one, reading)?.[0] === "answer" && one.filled.length > 0,
    )
  )
    return verdict(
      "deny",
      "Pass the exact prompt msg literally in single quotes; do not let the shell fill any herdr answer words.",
    );
  if (hasAnswer && reading.steps.length > 1)
    return verdict(
      "deny",
      "Run herdr answer as the only step on its Bash line so the person approves exactly one answer.",
    );
  const remember = (reason: string) => {
    ask ??= isAttended(context.env)
      ? verdict("ask", reason)
      : verdict(
          "deny",
          `${reason}\nNobody answers a question in \`claude -p\`; run this in an interactive session.`,
        );
  };
  const remoteRead = (machine: string) => {
    try {
      const rule = machineRule(readMachines(context.paths.machinesFile), machine);
      if (rule !== "free")
        remember(
          `Approve Herdr read on ${machine}: ${rule === "production" ? "this is a production machine" : "this machine is not allowlisted"}.`,
        );
    } catch (error) {
      remember(
        `Cannot read the Herdr machine rules: ${error instanceof Error ? error.message : String(error)} Approve this remote read only if you meant it.`,
      );
    }
  };
  for (const one of reading.invocations) {
    if (one.computed && reading.namesHerdr) {
      remember("This line computes a Herdr program at run time. Approve it only if you meant it.");
      continue;
    }
    const args = withoutRedirections(one.args);
    if (
      ["export", "declare", "typeset", "local", "readonly"].includes(one.program) &&
      args.some(isComputedWord)
    )
      remember(
        "This line computes an environment assignment on a Herdr line. Approve only if it does not change HC_TERMINAL_ID.",
      );
    if (one.program === "herdr-app" && args[0] === "do") {
      return verdict(
        "deny",
        `Raw herdr-app do is not allowed. Use ${COMMAND} herdr start, send, answer or stop instead.`,
      );
    }
    if (one.program === "hc") {
      const raw = [...args];
      while (raw[0] === "--json") raw.shift();
      const [verb, sub] = raw;
      if (raw.length === 1 && ["--version", "-V", "--skill", "--help", "-h"].includes(verb ?? ""))
        continue;
      if (raw.length === 2 && !verb?.startsWith("-") && ["--help", "-h"].includes(sub ?? ""))
        continue;
      const read =
        ["ls", "get", "read", "wait", "templates", "schema"].includes(verb ?? "") ||
        (verb === "machine" && sub === "ls") ||
        (verb === "file" && sub === "read") ||
        (verb === "server" && sub === "status");
      const machine = optionValue(
        raw.slice(0, raw.indexOf("--") < 0 ? undefined : raw.indexOf("--")),
        "--on",
      );
      if (verb === "file" && sub === "read" && machine) remoteRead(machine);
      const terminalArgs = raw.slice(1);
      // Each verb takes one TERMINAL (`hc <verb> --help`); `wait --children` names one too.
      const addresses = ["read", "get", "wait"].includes(verb ?? "")
        ? [
            ...positionalsOf(terminalArgs, [
              "--lines",
              "--children",
              "--output",
              "--timeout",
            ]).slice(0, 1),
            ...(verb === "wait" ? [optionValue(terminalArgs, "--children")] : []),
          ]
        : verb === "events"
          ? [optionValue(terminalArgs, "--terminal"), optionValue(terminalArgs, "--children-of")]
          : [];
      for (const address of addresses) {
        const slash = address?.indexOf("/") ?? -1;
        if (address && slash > 0) remoteRead(address.slice(0, slash));
      }
      if (verb === "events") {
        const input = context.input.tool_input;
        if (
          typeof input === "object" &&
          input !== null &&
          "run_in_background" in input &&
          input.run_in_background === true
        )
          continue;
        return verdict(
          "deny",
          `hc events never ends: run it in the background or use ${COMMAND} herdr wait.`,
        );
      }
      if (read) continue;
      const fix =
        verb === "run"
          ? "herdr start"
          : verb === "send" || verb === "keys"
            ? "herdr send or herdr answer"
            : verb === "kill" || verb === "rm"
              ? "herdr stop"
              : verb === "label"
                ? "herdr adopt"
                : verb === "attach"
                  ? "herdr send or herdr answer"
                  : "job run for a background program (or a guarded herdr verb)";
      return verdict("deny", `Raw hc ${verb ?? "write"} is not allowed. Use ${COMMAND} ${fix}.`);
    }
    const herdr = herdrArguments(one, reading);
    if (herdr === null || (herdr.length === 2 && ["--help", "-h"].includes(herdr[1] ?? "")))
      continue;
    // These always ask, even when malformed or carrying --asked: no hook-side hc read
    // can tell a question from a permission prompt.
    if (herdr[0] === "answer") {
      const parsed = parseHerdrArgs(herdr);
      const detail =
        !("error" in parsed) && parsed.verb === "answer"
          ? `${herdrExcerpt(parsed.target)}: ${parsed.option !== undefined ? `option ${herdrExcerpt(parsed.option)}` : `text ${herdrExcerpt(parsed.text ?? "")}`}; expected prompt ${herdrExcerpt(parsed.expect)}`
          : herdrExcerpt(herdr.slice(1).join(" "));
      remember(
        `Approve the answer to Herdr child ${detail}. Only the person may answer a permission prompt.`,
      );
      continue;
    }
    if (herdr[0] === "machines") {
      const parsed = parseHerdrArgs(herdr);
      if (!("error" in parsed) && parsed.verb === "machines" && parsed.action === "list") continue;
      remember(`Approve this Herdr machine rule change: ${herdr.slice(1).join(" ")}.`);
      continue;
    }
    if (herdr[0] !== "start") continue;
    if (!isAttended(context.env))
      return verdict(
        "deny",
        "Nobody answers or watches a Herdr session started by `claude -p`; its reports would reach nobody. Start it from an interactive session.",
      );
    const flags = herdr.slice(1, herdr.indexOf("--") < 0 ? undefined : herdr.indexOf("--"));
    if (optionValue(flags, "--mode") === "bypassPermissions")
      return verdict("deny", "bypassPermissions is never allowed.");
    const parsed = parseHerdrArgs(herdr);
    if ("error" in parsed)
      return verdict(
        "deny",
        `Pass both --model and --effort, plus --mode, to herdr start.\n${parsed.error}`,
      );
    if (parsed.verb !== "start") continue;
    const lead = stringField(context.input.permission_mode) ?? "";
    if (lead === "bypassPermissions")
      return verdict(
        "deny",
        "The lead's own mode is bypassPermissions, which is never allowed. Change the lead mode before starting a child.",
      );
    const mode = childModeAllowed(lead, parsed.mode);
    if (!mode.ok) {
      const reason = `${mode.why} Lead mode: ${lead || "unknown"}; child mode: ${parsed.mode}.`;
      if (!normalizeMode(lead) && lead !== "bypassPermissions") remember(reason);
      else return verdict("deny", reason);
    }
    const launch = judgeLaunch(
      {
        tool: HERDR_START,
        fork: false,
        model: parsed.model,
        effort: parsed.effort,
        prompt: parsed.brief,
        subagentType: null,
      },
      readGuardContext(context.paths, context.input, context.env),
      context.env,
    );
    if (launch.decision === "deny") return verdict("deny", launch.reason);
    if (launch.decision === "ask") remember(launch.reason);
    if (parsed.on) {
      try {
        const rule = machineRule(readMachines(context.paths.machinesFile), parsed.on);
        if (rule !== "free")
          remember(
            `Approve Herdr start on ${parsed.on}: ${rule === "production" ? "this is a production machine" : "this machine is not allowlisted"}.`,
          );
      } catch (error) {
        remember(
          `Cannot read the Herdr machine rules: ${error instanceof Error ? error.message : String(error)} Approve this remote launch only if you meant it.`,
        );
      }
    }
  }
  return ask;
}

/**
 * The judge's answer about one command line: a denial, an ask, or null when it judges nothing.
 * A denial wins over an ask, and the first launch that asks is the one named.
 */
export function judgeBash(reading: BashReading, context: JudgeContext): BashVerdict | null {
  // A proposal crosses the gate the git and merge guards read, in children they never see: the
  // person approves it where that gate says the push or the pull request is theirs.
  let ask = judgeHerdr(reading, context);
  if (ask?.decision === "deny") return ask;
  if (reading.proposals.length > 0) {
    const proposed = judgeProposals(reading.proposals, context);
    if (proposed?.decision === "deny") return proposed;
    ask ??= proposed;
  }
  for (const launch of reading.launches) {
    const verdict = judgeClaudeLaunch(launch, context);
    if (verdict === null) continue;
    if (verdict.decision === "deny") return verdict;
    ask ??= verdict;
  }
  return ask;
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
 * True for launches, workflow proposals and Herdr commands: the crash domain.
 */
export function judgedDomain(reading: BashReading): boolean {
  return reading.launches.length > 0 || reading.workflowPropose || herdrDomain(reading);
}
