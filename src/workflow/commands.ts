/**
 * `cc-smart-dev-kit workflow [show] | set <setting> <value> [--project] | unset <setting> [--project]
 * | review-done [--sha <commit>]`.
 *
 * `show` prints every value with where it came from, so a person can see whether it is the
 * project's policy, their own, or the built-in default — and, for a switch, that it is the
 * value of the setting it maps onto right now (`resolve.ts`). Its `gate` lines are the review
 * gate exactly as the merge guard reads it — the policy committed on `origin/<worktrees.base>`
 * (`resolveGate`) — and it prints whether the commit this checkout is on has a recorded review
 * that gate trusts. Both `show` and `set` end with the settings that cannot work together
 * (`workflowClashes` in `clashes.ts`, D16): one `!` line each, with its fix. `set` and `unset` write one value where
 * it really lives (`write.ts`): without `--project`, the person's own defaults; with it, the
 * project's `.claude/cc-smart-dev-kit.json` in this checkout (the person commits it). Of a gate
 * key (`REVIEW_GATE_KEYS`) both refuse inside Claude Code. `review-done` records one commit in the
 * review record (`reviews.ts`) — default HEAD — which is what the merge guard reads before a
 * merge it would make without a person. It refuses inside Claude Code (`CLAUDECODE`), where
 * the `review-record` hook writes the record from the review agent's own end: a record a
 * session writes for itself is only its own word.
 *
 * Exit codes, the same as the rest of the command: 0 done, 1 a file that cannot be read or
 * written, 2 a setting or a value that is not one of the settings there are.
 */
import { COMMAND } from "../build-info/names";
import { type CliPaths, tildify } from "../cli/paths";
import { runGit } from "../hooks/git";
import type { CcSmartDevKitConfig } from "../project/config";
import { type Checkout, CONFIG_PATH, loadProjectConfig, locateCheckout } from "../project/resolve";
import { clashesOf, clashLines } from "./clashes";
import {
  type Gate,
  type ResolvedWorkflow,
  resolvedValueOf,
  resolveGate,
  resolveWorkflow,
  sourceLabel,
} from "./resolve";
import {
  BY_HAND,
  COMMIT_SHA,
  hasReview,
  type RecordedReview,
  recordReview,
  reviewsFile,
} from "./reviews";
import type { WorkflowKey } from "./schema";
import { parseWorkflowValue, REVIEW_GATE_KEYS, showValue, WORKFLOW_KEYS } from "./schema";
import { writePersonalSetting, writeProjectSetting } from "./write";

type Env = Record<string, string | undefined>;

export interface WorkflowContext {
  paths: CliPaths;
  cwd: string;
  env: Env;
  print: (line: string) => void;
  error: (line: string) => void;
}

export const WORKFLOW_USAGE = `Usage: ${COMMAND} workflow [show] | set <setting> <value> [--project] | unset <setting> [--project] | review-done [--sha <commit>]

The settings are: ${WORKFLOW_KEYS.join(", ")}
show (the default) prints each value and where it came from: the project's
.claude/cc-smart-dev-kit.json, your own ~/.config/cc-smart-dev-kit/workflow.json, or the
built-in default, and whether the commit this checkout is on has a recorded review. set
and unset write one value: your own file, or the project's with --project. A switch
(switches.*) is not stored: it reads and writes the setting it maps onto, so
switches.sessionNames and switches.jobRoute need --project, and switches.statusLine and
switches.updateHold refuse it.
The review gate (${REVIEW_GATE_KEYS.join(", ")}) is what the merge guard judges with: its
project part is read from ${CONFIG_PATH} as committed on the base (origin/<base>), and
show prints it on its gate lines. Inside Claude Code, set and unset of those refuse: change
them in your own terminal, and commit and push the project's file to the base.
review-done records that the change set up to a commit (default: HEAD, or --sha <commit>)
had its one premium review and its fixes. The merge guard reads it before a merge it
would make by itself, while reviewBeforePush is on. Inside Claude Code the review-record
hook writes it, when a review agent (the reviewAgents setting) returns, so review-done
refuses there: it is for your own terminal.`;

/** One git call a `workflow` run makes (a `rev-parse`): milliseconds, never a hang. */
const WORKFLOW_GIT_TIMEOUT_MS = 5_000;

/** The checkout of `cwd`, its project's settings, and why there are none. */
function project(
  cwd: string,
  env: Env,
): { checkout: Checkout | null; config: CcSmartDevKitConfig | null; why: string | null } {
  try {
    const checkout = locateCheckout(cwd, { env });
    if (checkout === null) {
      return { checkout: null, config: null, why: "this folder is not in a git project" };
    }
    const loaded = loadProjectConfig(checkout);
    return loaded.config === null
      ? { checkout, config: null, why: `${loaded.root} has no .claude/cc-smart-dev-kit.json` }
      : { checkout, config: loaded.config, why: null };
  } catch (error) {
    return {
      checkout: null,
      config: null,
      why: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * The checkout of `cwd` alone, without the project's settings. Recording a review needs the
 * repository, not the project's policy: a `cc-smart-dev-kit.json` that is broken (or too
 * new) must not stop a person from recording one — the record is what the merge guard reads,
 * and the guards that cannot read the file fail closed until it is fixed.
 */
function checkoutOf(cwd: string, env: Env): { checkout: Checkout | null; why: string | null } {
  try {
    const checkout = locateCheckout(cwd, { env });
    return {
      checkout,
      why: checkout === null ? "this folder is not in a git project" : null,
    };
  } catch (error) {
    return { checkout: null, why: error instanceof Error ? error.message : String(error) };
  }
}

/** The commit `rev` names in `folder`: the full sha, or null when git cannot name one. */
function commitOf(folder: string, rev: string, env: Env): string | null {
  const run = runGit(
    folder,
    ["rev-parse", "--verify", "--quiet", `${rev}^{commit}`],
    env,
    WORKFLOW_GIT_TIMEOUT_MS,
  );
  return run.ok && COMMIT_SHA.test(run.out) ? run.out : null;
}

/** The repository a checkout belongs to: the main checkout of every worktree of it. */
function repoOf(checkout: Checkout): string {
  return checkout.mainCheckout ?? checkout.root;
}

/**
 * The line `show` prints: whether the commit this checkout is on has a recorded review that
 * `agents` (the gate's own list, when it can be read) trusts — the merge guard's answer.
 */
function reviewLine(
  paths: CliPaths,
  checkout: Checkout | null,
  agents: readonly string[],
  env: Env,
): string {
  if (checkout === null) return "review-done = no (this folder is not in a git project)";
  const head = commitOf(checkout.root, "HEAD", env);
  if (head === null) return "review-done = no (this checkout has no commit yet)";
  const recorded = hasReview(reviewsFile(paths.stateDir, repoOf(checkout)), head, agents);
  return `review-done = ${recorded ? "yes" : "no"} (HEAD ${head.slice(0, 7)})`;
}

/**
 * The gate's lines: the review gate exactly as the merge guard reads it — the policy committed
 * on `origin/<worktrees.base>`, the same read (`resolveGate`) — so `show` never disagrees with
 * the guard, even while this checkout's own file says something else. Nothing for a folder
 * with no project file: there the guard is silent.
 */
function gateLines(
  paths: CliPaths,
  checkout: Checkout | null,
  config: CcSmartDevKitConfig | null,
  env: Env,
): { lines: string[]; gate: Gate | null } {
  if (checkout === null || config === null) return { lines: [], gate: null };
  const base = config.worktrees?.base;
  if (base === undefined) {
    return {
      lines: [
        "gate: this project names no worktrees.base, so the merge guard reads the policy committed on each pull request's base",
      ],
      gate: null,
    };
  }
  const read = resolveGate(paths, checkout, base, { env, timeoutMs: WORKFLOW_GIT_TIMEOUT_MS });
  if (!read.ok) {
    return {
      lines: [
        `gate: the merge guard cannot read the policy committed on ${base} (${read.why}), so it asks before every merge`,
      ],
      gate: null,
    };
  }
  const { gate } = read;
  const lines = [
    `gate: what the merge guard judges with, from origin/${base}:${CONFIG_PATH} as committed (this checkout's own copy does not count)`,
  ];
  for (const key of REVIEW_GATE_KEYS) {
    const value = resolvedValueOf(gate.resolved, key);
    lines.push(`gate ${key} = ${showValue(key, value.value)} (${sourceLabel(value, gate.branch)})`);
  }
  return { lines, gate };
}

function show(context: WorkflowContext): number {
  const { paths, env, cwd, print } = context;
  const here = project(cwd, env);
  let resolved: ResolvedWorkflow;
  let gate: { lines: string[]; gate: Gate | null };
  try {
    resolved = resolveWorkflow(paths, here.config);
    gate = gateLines(paths, here.checkout, here.config, env);
  } catch (error) {
    context.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
  print(
    `your own defaults: ${tildify(paths.workflowConfigFile, paths.home)}; a project's .claude/cc-smart-dev-kit.json wins field by field`,
  );
  for (const key of WORKFLOW_KEYS) {
    const { value, source } = resolvedValueOf(resolved, key);
    print(`${key} = ${showValue(key, value)} (${source})`);
  }
  for (const line of gate.lines) print(line);
  for (const line of clashLines(clashesOf(resolved, here.config?.worktrees?.base ?? null))) {
    print(line);
  }
  const agents = (gate.gate?.resolved ?? resolved).reviewAgents.value;
  print(reviewLine(paths, here.checkout, agents, env));
  if (here.why !== null) print(`no project settings here: ${here.why}`);
  return 0;
}

/**
 * True inside a Claude Code session (`CLAUDECODE`, which Claude Code sets for the commands it
 * runs). A courtesy, not a lock: a command can drop the variable (`env -u CLAUDECODE`). It
 * keeps a session from changing the review gate by mistake; the merge guard reading only the
 * committed policy is what keeps a session's own edits out of it.
 */
function insideClaudeCode(env: Env): boolean {
  return env.CLAUDECODE !== undefined;
}

/**
 * `workflow review-done [--sha <commit>]`: one commit into the review record of this
 * repository. The command records; it never reviews anything itself.
 */
async function reviewDone(context: WorkflowContext, argv: string[]): Promise<number> {
  // Inside Claude Code the record must come from the review agent itself (`review-record`),
  // or it is only the session's word: a session can record a commit nobody read. The person,
  // in their own terminal, records one by hand — that is what this command is for.
  if (insideClaudeCode(context.env)) {
    context.error(
      `${COMMAND} workflow review-done cannot run inside a Claude Code session: the review record is written by the review-record hook when a review agent (workflow setting reviewAgents) returns, so a record is never the session's own word. Run it in your own terminal to record one by hand.`,
    );
    return 1;
  }
  let rev = "HEAD";
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index] ?? "";
    const value = argv[index + 1];
    if (arg !== "--sha") {
      context.error(`Unknown option: ${arg}\n\n${WORKFLOW_USAGE}`);
      return 2;
    }
    if (value === undefined || value.startsWith("--")) {
      context.error(`--sha needs a commit\n\n${WORKFLOW_USAGE}`);
      return 2;
    }
    rev = value;
    index += 1;
  }
  // The project's own file is not read: a review record does not depend on the project's
  // policy, and a broken file must not stop a person from recording one.
  const here = checkoutOf(context.cwd, context.env);
  if (here.checkout === null) {
    context.error(`${COMMAND} workflow review-done: ${here.why}`);
    return 1;
  }
  const commit = commitOf(here.checkout.root, rev, context.env);
  if (commit === null) {
    context.error(
      `${COMMAND} workflow review-done: ${rev} is not a commit in this repository\n\n${WORKFLOW_USAGE}`,
    );
    return 1;
  }
  const file = reviewsFile(context.paths.stateDir, repoOf(here.checkout));
  let recorded: RecordedReview;
  try {
    recorded = await recordReview(file, commit, BY_HAND, Date.now());
  } catch (error) {
    context.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
  const where = tildify(file, context.paths.home);
  const short = commit.slice(0, 7);
  context.print(
    recorded.added
      ? `+ ${where}: the review of ${short} is recorded`
      : `= ${where}: the review of ${short} was already recorded (${recorded.at})`,
  );
  return 0;
}

function setOrUnset(context: WorkflowContext, sub: string, argv: string[]): number {
  const [key, ...rest] = argv;
  const projectFlag = rest.includes("--project");
  // `set` takes one value, `unset` takes none; `--project` is the one flag.
  const words = rest.filter((arg) => arg !== "--project");
  const unknown = words.filter((arg) => arg.startsWith("--"));
  if (unknown.length > 0) {
    context.error(`Unknown option: ${unknown.join(" ")}\n\n${WORKFLOW_USAGE}`);
    return 2;
  }
  if (key === undefined || !WORKFLOW_KEYS.includes(key as WorkflowKey)) {
    context.error(
      key === undefined
        ? `${sub} needs a setting\n\n${WORKFLOW_USAGE}`
        : `Unknown setting: ${key}. The settings are: ${WORKFLOW_KEYS.join(", ")}`,
    );
    return 2;
  }
  const wanted = key as WorkflowKey;
  // The review gate is the person's to change, never a session's: refused before anything
  // is parsed or written. The project's part counts only once committed and pushed anyway.
  if (REVIEW_GATE_KEYS.includes(wanted) && insideClaudeCode(context.env)) {
    context.error(
      `${COMMAND} workflow ${sub} ${key} cannot run inside a Claude Code session: ${key} is part of the merge guard's review gate, which only you change. Run it in your own terminal; for the project's policy, change ${CONFIG_PATH} there, commit it to the base and push it — the merge guard reads only the committed file.`,
    );
    return 1;
  }
  let value: unknown;
  if (sub === "set") {
    const text = words[0];
    if (words.length !== 1 || text === undefined) {
      context.error(
        `set needs one value${words.length > 1 ? ' (quote a list, like "needs-you, question")' : ""}\n\n${WORKFLOW_USAGE}`,
      );
      return 2;
    }
    const parsed = parseWorkflowValue(wanted, text);
    if (!parsed.ok) {
      context.error(`${parsed.why}\n\n${WORKFLOW_USAGE}`);
      return 2;
    }
    value = parsed.value;
  } else if (words.length > 0) {
    context.error(`unset takes no value\n\n${WORKFLOW_USAGE}`);
    return 2;
  }
  try {
    const line = projectFlag
      ? writeProjectSetting(context.cwd, key, value, context.env)
      : writePersonalSetting(context.paths, key, value);
    context.print(line);
    // D16: a write that leaves settings that cannot work together says so, with the fix. The
    // policy after the write is read the same way `show` reads it.
    const here = project(context.cwd, context.env);
    for (const clash of clashLines(
      clashesOf(resolveWorkflow(context.paths, here.config), here.config?.worktrees?.base ?? null),
    )) {
      context.print(clash);
    }
    return 0;
  } catch (error) {
    context.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

/** `cc-smart-dev-kit workflow …`; the exit code. */
export async function runWorkflow(argv: string[], context: WorkflowContext): Promise<number> {
  const [sub, ...rest] = argv;
  if (sub === undefined || sub === "show") return show(context);
  if (sub === "set" || sub === "unset") return setOrUnset(context, sub, rest);
  if (sub === "review-done") return await reviewDone(context, rest);
  context.error(`Unknown workflow command: ${sub}\n\n${WORKFLOW_USAGE}`);
  return 2;
}
