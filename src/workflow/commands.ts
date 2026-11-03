/**
 * `cc-smart-dev-kit workflow [show] | set <setting> <value> [--project] | unset <setting> [--project]
 * | propose <setting> <value> [--unset] [--folder <project>] [--json] | review-done [--sha <commit>]
 * | merge-check [<pr>… | --branch <b> --base <base>]`.
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
 * key (`REVIEW_GATE_KEYS`) the three refuse inside Claude Code. `propose` changes one of the
 * project's own settings through a pull request instead (`propose.ts`, D57): a branch and a
 * worktree cut from `origin/<worktrees.base>`, the same writer, the commit, the push and
 * `gh pr create` — never a write in the main checkout. `review-done` records one commit in the
 * review record (`reviews.ts`) — default HEAD — which is what the merge guard reads before a
 * merge it would make without a person. It refuses inside Claude Code (`CLAUDECODE`), where
 * the `review-record` hook writes the record from the review agent's own end: a record a
 * session writes for itself is only its own word.
 *
 * `merge-check` judges a merge without making one, with the merge guard's own judgment
 * (`merge-check.ts`): each pull request number, or a local branch against a base. It prints one
 * line per verdict and exits 0 when every merge is allowed, 1 when any asks.
 *
 * Exit codes, the same as the rest of the command: 0 done, 1 a file that cannot be read or
 * written (or a merge that asks), 2 a setting or a value that is not one of the settings there are.
 */
import { resolve } from "node:path";
import { COMMAND } from "../build-info/names";
import { type CliPaths, tildify } from "../cli/paths";
import { runGit } from "../hooks/git";
import type { CcSmartDevKitConfig } from "../project/config";
import { type Checkout, CONFIG_PATH, loadProjectConfig, locateCheckout } from "../project/resolve";
import { clashesOf, clashLines } from "./clashes";
import {
  checkBranch,
  checkPullRequest,
  type MergeVerdict,
  type MergeWorld,
  notChecked,
  notInTime,
} from "./merge-check";
import { proposeWorkflow } from "./propose";
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
import {
  INBOUND_KEYS,
  OUTBOUND_KEYS,
  parseWorkflowValue,
  REVIEW_GATE_KEYS,
  showValue,
  WORKFLOW_KEYS,
} from "./schema";
import { writePersonalSetting, writeProjectSetting } from "./write";

type Env = Record<string, string | undefined>;

export interface WorkflowContext {
  paths: CliPaths;
  cwd: string;
  env: Env;
  print: (line: string) => void;
  error: (line: string) => void;
  /** The clock a branch name's day comes from (`propose`); the system clock when left out. */
  now?: () => number;
}

export const WORKFLOW_USAGE = `Usage: ${COMMAND} workflow [show] | set <setting> <value> [--project] | unset <setting> [--project] | propose <setting> <value> [--unset] [--folder <project>] [--json] | review-done [--sha <commit>] | merge-check [<pr>… | --branch <b> --base <base>]

The settings are: ${WORKFLOW_KEYS.join(", ")}
show (the default) prints each value and where it came from: the project's
.claude/cc-smart-dev-kit.json, your own ~/.config/cc-smart-dev-kit/workflow.json, or the
built-in default, and whether the commit this checkout is on has a recorded review. set
and unset write one value: your own file, or the project's with --project. A switch
(switches.*) is not stored: it reads and writes the setting it maps onto, so
switches.sessionNames needs --project, and switches.statusLine and switches.updateHold refuse
it. switches.jobRoute (heavy commands go through the job queue) is the exception: without
--project it is your own default for every project, in your file; with --project it is the
project's jobs.route, which wins over yours. Off until one of them says on.
propose changes one of the project's own settings through a pull request: a branch and a
worktree cut from origin/<worktrees.base>, the setting written by the same writer set
--project uses, committed, pushed, and the pull request opened with gh. It counts once it
is merged. --folder names the project (the current folder otherwise), --unset removes the
project's value, and --json prints { url, branch, worktree, setting, from, to }.
The review gate (${REVIEW_GATE_KEYS.join(", ")}) is what the merge guard judges with: its
project part is read from ${CONFIG_PATH} as committed on the base (origin/<base>), and
show prints it on its gate lines, with the fixesAfterReview limits in force. Inside Claude
Code, set, unset and propose of those refuse: run them in your own terminal (propose, and the
pull request's review, are the gate).
${OUTBOUND_KEYS.join(" and ")} let text leave this machine for GitHub (${COMMAND} issue file), and
${INBOUND_KEYS.join(" and ")} decides which issues are ready: set and unset refuse these inside
Claude Code too; propose does not, since a person reviews its pull request.
review-done records that the change set up to a commit (default: HEAD, or --sha <commit>)
had its one premium review and its fixes. The merge guard reads it before a merge it
would make by itself, while reviewBeforePush is on. Inside Claude Code the review-record
hook writes it, when a review agent (the reviewAgents setting) returns, so review-done
refuses there: it is for your own terminal.
merge-check judges a merge without making it, with the merge guard's own judgment: each
pull request number, or a local branch against a base (--branch <b> --base <base>). A pull
request is allowed when the committed policy passes: autoMerge on, its base the project's
integration base, every required check green, and a review covering its head under
fixesAfterReview. A branch is allowed when the review record covers its head. One line per
verdict; exit 0 when every merge is allowed, 1 when any asks.`;

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
  lines.push(`gate fixesAfterReview in force: ${fixesInForce(gate.resolved)}`);
  return { lines, gate };
}

/**
 * The D17 limits as one sentence: what a fix after a review may reach. `0`/`0`/`0` is the
 * exact reviewed commit only.
 */
function fixesInForce(resolved: ResolvedWorkflow): string {
  const { lines, files, percent } = resolved.fixesAfterReview;
  if (lines.value === 0 && files.value === 0 && percent.value === 0) {
    return "0/0/0: only a review of the exact commit counts";
  }
  return `${lines.value} lines in ${files.value} files, or ${percent.value}% of the reviewed change, whichever is more`;
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
 * The refusal of a review-gate key (`REVIEW_GATE_KEYS`) inside a Claude Code session, shared by
 * `set`, `unset` and `propose` so the three refuse in the same words: the gate is the person's.
 */
function gateKeyRefusal(sub: "propose" | "set" | "unset", key: WorkflowKey): string {
  const fix =
    sub === "propose"
      ? `Run it in your own terminal (\`${COMMAND} workflow propose ${key} <value>\`): the pull request is the gate.`
      : `Run it in your own terminal; for the project's policy, change ${CONFIG_PATH} there, commit it to the base and push it — the merge guard reads only the committed file.`;
  return `${COMMAND} workflow ${sub} ${key} cannot run inside a Claude Code session: ${key} is part of the merge guard's review gate, which only you change. ${fix}`;
}

/**
 * Why each key of `OUTBOUND_KEYS` and `INBOUND_KEYS` is the person's: what it lets through. The
 * one home of the words of `issueKeyRefusal`.
 */
function issueKeyReason(key: WorkflowKey): string {
  if (key === "issues.readyLabel") {
    return "names the label that marks a GitHub issue a person chose (D67), whose text the kit then never rewrites; only you choose it";
  }
  return "lets text leave this machine for GitHub, which only you switch";
}

/**
 * The refusal of an outbound or inbound key (`OUTBOUND_KEYS`, `INBOUND_KEYS`) in `set` and
 * `unset` inside a Claude Code session: the switch that lets text leave for GitHub and the label
 * that says which issues are ready are the person's.
 * `propose` stays open, because its pull request is reviewed and merged by a person.
 */
function issueKeyRefusal(sub: "set" | "unset", key: WorkflowKey): string {
  return `${COMMAND} workflow ${sub} ${key} cannot run inside a Claude Code session: ${key} ${issueKeyReason(key)}. Run it in your own terminal; for the project's policy, change ${CONFIG_PATH} there, commit it to the base and push it — the kit reads only the committed file. \`workflow propose\` opens a pull request you review instead.`;
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

/** How long one child a `merge-check` run starts may take: no hook deadline, and a person waits. */
const MERGE_CHECK_TIMEOUT_MS = 30_000;

/** The world one `merge-check` run judges in: this checkout, gh in this folder, no hook deadline. */
function checkWorld(paths: CliPaths, checkout: Checkout, cwd: string, env: Env): MergeWorld {
  return { paths, checkout, folder: cwd, env, timeFor: () => MERGE_CHECK_TIMEOUT_MS };
}

/** One verdict as a person reads it: what was checked, then allowed, or the reason it asks. */
function verdictLine(verdict: MergeVerdict, subject: string, env: Env): string {
  if (verdict.kind === "allowed") return `${subject}: allowed — ${verdict.reason}`;
  if (verdict.kind === "silent") {
    return `${subject}: no verdict — this project runs its own merge guard (ownHooks in the committed policy), so its answer decides`;
  }
  if (verdict.kind === "refused") return `${subject}: asks — ${verdict.reason}`;
  if (verdict.kind === "unread") return `${subject}: asks — ${notChecked(verdict.what, env)}`;
  return `${subject}: asks — ${notInTime(verdict.what)}`;
}

/** `merge-check`'s arguments: pull request numbers, or a branch with its base. */
type MergeCheckArgs =
  | { ok: true; prs: number[]; branch: string | null; base: string | null }
  | { ok: false; why: string };

function mergeCheckArgs(argv: string[]): MergeCheckArgs {
  const prs: number[] = [];
  let branch: string | null = null;
  let base: string | null = null;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index] ?? "";
    if (arg === "--branch" || arg === "--base") {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith("--")) {
        return { ok: false, why: `${arg} needs a branch name` };
      }
      if (arg === "--branch") branch = value;
      else base = value;
      index += 1;
      continue;
    }
    if (arg.startsWith("-")) return { ok: false, why: `Unknown option: ${arg}` };
    if (!/^\d+$/.test(arg)) return { ok: false, why: `Not a pull request number: ${arg}` };
    prs.push(Number(arg));
  }
  if (branch !== null || base !== null) {
    if (branch === null || base === null) {
      return { ok: false, why: "merge-check needs both --branch and --base" };
    }
    if (prs.length > 0) {
      return {
        ok: false,
        why: "merge-check takes pull request numbers, or --branch with --base, not both",
      };
    }
    return { ok: true, prs, branch, base };
  }
  if (prs.length === 0) {
    return { ok: false, why: "merge-check needs a pull request number, or --branch with --base" };
  }
  return { ok: true, prs, branch: null, base: null };
}

/**
 * `workflow merge-check [<pr>… | --branch <b> --base <base>]`: the merge guard's judgment,
 * printed and not made. Exit 0 when every verdict is allowed, 1 when any asks.
 */
async function mergeCheck(context: WorkflowContext, argv: string[]): Promise<number> {
  const parsed = mergeCheckArgs(argv);
  if (!parsed.ok) {
    context.error(`${parsed.why}\n\n${WORKFLOW_USAGE}`);
    return 2;
  }
  const here = project(context.cwd, context.env);
  if (here.checkout === null) {
    context.error(`${COMMAND} workflow merge-check: ${here.why}`);
    return 1;
  }
  if (here.config === null) {
    context.error(
      `${COMMAND} workflow merge-check: ${here.why}, so there is no merge policy to check`,
    );
    return 1;
  }
  const world = checkWorld(context.paths, here.checkout, context.cwd, context.env);
  if (parsed.branch !== null && parsed.base !== null) {
    const verdict = await checkBranch(world, { branch: parsed.branch, base: parsed.base });
    context.print(verdictLine(verdict, `branch ${parsed.branch}`, context.env));
    return verdict.kind === "allowed" ? 0 : 1;
  }
  let everyAllowed = true;
  const defaultBranches = new Map<string, string | null>();
  for (const pr of parsed.prs) {
    const verdict = await checkPullRequest(world, { ref: String(pr), repo: null }, defaultBranches);
    if (verdict.kind !== "allowed") everyAllowed = false;
    context.print(verdictLine(verdict, `#${pr}`, context.env));
  }
  return everyAllowed ? 0 : 1;
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
    context.error(gateKeyRefusal(sub === "set" ? "set" : "unset", wanted));
    return 1;
  }
  if (
    (OUTBOUND_KEYS.includes(wanted) || INBOUND_KEYS.includes(wanted)) &&
    insideClaudeCode(context.env)
  ) {
    context.error(issueKeyRefusal(sub === "set" ? "set" : "unset", wanted));
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

/** `propose`'s arguments: one setting, one value or `--unset`, a folder, and JSON. */
type ProposeArgs =
  | { folder: null | string; json: boolean; ok: true; setting: WorkflowKey; value: unknown }
  | { ok: false; why: string };

function proposeArgs(argv: string[]): ProposeArgs {
  const words: string[] = [];
  let folder: null | string = null;
  let json = false;
  let unset = false;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index] ?? "";
    if (arg === "--json") {
      json = true;
      continue;
    }
    if (arg === "--unset") {
      unset = true;
      continue;
    }
    if (arg === "--folder") {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith("--")) {
        return { ok: false, why: "--folder needs the project's folder" };
      }
      folder = value;
      index += 1;
      continue;
    }
    if (arg.startsWith("--")) return { ok: false, why: `Unknown option: ${arg}` };
    words.push(arg);
  }
  const [key, ...rest] = words;
  if (key === undefined || !WORKFLOW_KEYS.includes(key as WorkflowKey)) {
    return {
      ok: false,
      why:
        key === undefined
          ? "propose needs a setting"
          : `Unknown setting: ${key}. The settings are: ${WORKFLOW_KEYS.join(", ")}`,
    };
  }
  const wanted = key as WorkflowKey;
  if (unset) {
    return rest.length > 0
      ? { ok: false, why: "propose takes a value, or --unset, not both" }
      : { folder, json, ok: true, setting: wanted, value: undefined };
  }
  const text = rest[0];
  if (rest.length !== 1 || text === undefined) {
    return {
      ok: false,
      why: `propose needs one value${rest.length > 1 ? ' (quote a list, like "needs-you, question")' : ""}, or --unset`,
    };
  }
  const parsed = parseWorkflowValue(wanted, text);
  return parsed.ok
    ? { folder, json, ok: true, setting: wanted, value: parsed.value }
    : { ok: false, why: parsed.why };
}

/**
 * `workflow propose <setting> <value> [--unset] [--folder <project>] [--json]`: one of the
 * project's own settings, changed through a pull request (`propose.ts`, D57). Of a review-gate
 * key it refuses inside Claude Code, as `set` does there.
 */
async function propose(context: WorkflowContext, argv: string[]): Promise<number> {
  const parsed = proposeArgs(argv);
  if (!parsed.ok) {
    context.error(`${parsed.why}\n\n${WORKFLOW_USAGE}`);
    return 2;
  }
  if (REVIEW_GATE_KEYS.includes(parsed.setting) && insideClaudeCode(context.env)) {
    context.error(gateKeyRefusal("propose", parsed.setting));
    return 1;
  }
  return await proposeWorkflow(
    {
      env: context.env,
      // A relative `--folder` is relative to the folder the command runs in, as a shell reads it.
      folder: parsed.folder === null ? context.cwd : resolve(context.cwd, parsed.folder),
      paths: context.paths,
      print: context.print,
      error: context.error,
      ...(context.now === undefined ? {} : { now: context.now }),
    },
    parsed.setting,
    parsed.value,
    { json: parsed.json },
  );
}

/** `cc-smart-dev-kit workflow …`; the exit code. */
export async function runWorkflow(argv: string[], context: WorkflowContext): Promise<number> {
  const [sub, ...rest] = argv;
  if (sub === undefined || sub === "show") return show(context);
  if (sub === "set" || sub === "unset") return setOrUnset(context, sub, rest);
  if (sub === "propose") return await propose(context, rest);
  if (sub === "review-done") return await reviewDone(context, rest);
  if (sub === "merge-check") return await mergeCheck(context, rest);
  context.error(`Unknown workflow command: ${sub}\n\n${WORKFLOW_USAGE}`);
  return 2;
}
