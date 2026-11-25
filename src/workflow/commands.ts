/**
 * `cc-smart-dev-kit workflow [show] | set <setting> <value> [--project] | unset <setting> [--project]
 * | propose <setting> <value> [--unset] [--folder <project>] [--json] | review-done [--sha <commit>]
 * | merge-check [<pr>… | <pr> --asked | --branch <b> --base <base>]`.
 *
 * `show` prints every value with where it came from, so a person can see whether it is the
 * project's policy, their own, or the built-in default — and, for a switch, that it is the
 * value of the setting it maps onto right now (`resolve.ts`). Its `gate` lines are the review
 * gate exactly as merge-check reads it — the policy committed on `origin/<worktrees.base>`
 * (`resolveGate`) — and it prints whether the commit this checkout is on has a recorded review
 * that gate trusts. Both `show` and `set` end with the settings that cannot work together
 * (`workflowClashes` in `clashes.ts`, D16): one `!` line each, with its fix. `set` and `unset` write one value where
 * it really lives (`write.ts`): without `--project`, the person's own defaults; with it, the
 * project's `.claude/cc-smart-dev-kit.json` in this checkout (the person commits it). Of a gate
 * key (`REVIEW_GATE_KEYS`) the three work inside Claude Code. `propose` changes one of the
 * project's own settings through a pull request instead (`propose.ts`, D57): a branch and a
 * worktree cut from `origin/<worktrees.base>`, the same writer, the commit, the push and
 * `gh pr create` — never a write in the main checkout. `review-done` records one commit in the
 * review record (`reviews.ts`) — default HEAD — which is what merge-check reads before a
 * merge it would make without a person. It refuses inside Claude Code (`CLAUDECODE`), where
 * the `review-record` hook writes the record from the review agent's own end: a record a
 * session writes for itself is only its own word.
 *
 * `merge-check` judges a merge without making one, with merge-check's own judgment
 * (`merge-check.ts`): each pull request number, or a local branch against a base. It prints one
 * line per verdict and exits 0 when every merge is allowed, 1 when any asks. `--asked` (one pull
 * request only: a yes names one merge) is the person's own yes to that merge: it sets aside
 * `allowMerge` and nothing else, so a pull request stacked on another open one is refused with it.
 *
 * `claims [--base <ref>] [--json]` hands a reviewer the project's "one home" claims and the diff's
 * re-definitions of what they name (`claims.ts`); `slop record | status | audited` keeps the count
 * of plans closed since the last slop audit and says when one is due (`slop.ts`). Both are signals,
 * read and appended, never a gate.
 *
 * Exit codes, the same as the rest of the command: 0 done, 1 a file that cannot be read or
 * written (or a merge that asks), 2 a setting or a value that is not one of the settings there are.
 */
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { COMMAND } from "../build-info/names";
import { type ParsedOptions, parseOptions } from "../cli/args";
import { type CliPaths, tildify } from "../cli/paths";
import { runGit } from "../hooks/git";
import { type CcSmartDevKitConfig, WORKFLOW_ALLOW_KEYS_SINCE } from "../project/config";
import { type Checkout, CONFIG_PATH, loadProjectConfig, locateCheckout } from "../project/resolve";
import { taskContext } from "../tasks/context";
import { openWorkDb, workDbFile } from "../tasks/work/db";
import { planByRef, planFiles } from "../tasks/work/queries";
import { baseBranch } from "../worktrees/command";
import { claimsLines, collectClaims, type DiffBase } from "./claims";
import { clashesOf, clashLines } from "./clashes";
import {
  checkBranch,
  checkPullRequest,
  type MergeVerdict,
  type MergeWorld,
  newStackCache,
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
  settleMergeFiles,
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
  currentKeyName,
  INBOUND_KEYS,
  OUTBOUND_KEYS,
  PLAN_KEYS,
  PROJECT_ONLY_KEYS,
  parseWorkflowValue,
  REVIEW_GATE_KEYS,
  RUN_MODES,
  showValue,
  WORKFLOW_KEY_ALIASES,
  WORKFLOW_KEYS,
} from "./schema";
import {
  areasOf,
  readSlop,
  recordAudit,
  recordSlop,
  slopFile,
  slopStatus,
  slopStatusLines,
} from "./slop";
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

/** The old names, said once: what the usage and a renamed setting's line both name. */
const OLD_NAMES_TEXT = `${Object.keys(WORKFLOW_KEY_ALIASES).join(", ")} are the old names of ${Object.values(WORKFLOW_KEY_ALIASES).join(", ")} (${WORKFLOW_ALLOW_KEYS_SINCE}): a file and this command still take them, and every write uses the new name`;

/**
 * The line that says a setting was typed under its old name, or null when the name is current.
 * One line, printed before the write's own line.
 */
function renamedLine(typed: string, current: string): string | null {
  return typed === current
    ? null
    : `${typed} is now called ${current}: using ${current} (the old name still works in a file)`;
}

export const WORKFLOW_USAGE = `Usage: ${COMMAND} workflow [show] | set <setting> <value> [--project] | unset <setting> [--project] | propose <setting> <value> [--unset] [--folder <project>] [--json] | review-done [--sha <commit>] | merge-check [<pr>… | <pr> --asked | --branch <b> --base <base>] | claims [--base <ref>] [--json] | slop record --plan <slug> --bypassed <n> --drifted <n> | slop status [--json] | slop audited [--area <path>]...

The settings are: ${WORKFLOW_KEYS.join(", ")}
${OLD_NAMES_TEXT}.
show (the default) prints each value and where it came from: the project's
.claude/cc-smart-dev-kit.json, your own ~/.config/cc-smart-dev-kit/workflow.json, or the
built-in default, and whether the commit this checkout is on has a recorded review. set
and unset write one value: your own file, or the project's with --project. A switch
(switches.*) is not stored: it reads and writes the setting it maps onto, so
switches.sessionNames needs --project, and switches.statusLine and switches.updateHold refuse
it. switches.jobRoute (heavy commands go through the job queue) is the exception: without
--project it is your own default for every project, in your file; with --project it is the
project's jobs.route, which wins over yours. Off until one of them says on.
switches.leadHint (one line a session when the lead model is not Claude Opus) is yours alone,
in your file: on until you set it false; --project refuses it.
propose changes one of the project's own settings through a pull request: a branch and a
worktree cut from origin/<worktrees.base>, the setting written by the same writer set
--project uses, committed, pushed, and the pull request opened with gh. It counts once it
is merged. --folder names the project (the current folder otherwise), --unset removes the
project's value, and --json prints { url, branch, worktree, setting, from, to }.
The review gate (${REVIEW_GATE_KEYS.join(", ")}) is what merge-check judges with: its
project part is read from ${CONFIG_PATH} as committed on the base (origin/<base>), and
show prints it on its gate lines, with the fixesAfterReview limits in force. set, unset and
propose of those work inside Claude Code like any other setting.
${OUTBOUND_KEYS.join(" and ")} let text leave this machine for GitHub (${COMMAND} issue file), and
${INBOUND_KEYS.join(" and ")} decides which issues are ready: set and unset refuse these inside
Claude Code too; propose does not, since a person reviews its pull request. So does
${PLAN_KEYS.join(", ")} bound a session's own work, so they refuse there as well: a session never lifts its own limit.
plans.maxPhases is the most phases a plan may hold. plans.runMode (${RUN_MODES.join(" | ")}; default ask) is how
queued plans run when two or more are laid: it is yours alone, in your file, and a project's
file that sets it is refused. plans.mergeFiles (a comma-separated list; a folder ends in /) names
the paths every plan touches and each merge settles. plans.appendOnly (a comma-separated list of
folders, each ending in /) names the folders where plans add new files: there two plans overlap
only on the same file. Both are the project's, need --project, and count only as committed on
origin/<base>.
review-done records that the change set up to a commit (default: HEAD, or --sha <commit>)
had its one premium review and its fixes. merge-check reads it before a merge that
allowMerge would make by itself, while reviewBeforePush is on. Inside Claude Code the review-record
hook writes it, when a review agent (the reviewAgents setting) returns, so review-done
refuses there: it is for your own terminal.
merge-check judges a merge without making it: each
pull request number, or a local branch against a base (--branch <b> --base <base>). A pull
request is allowed when the committed policy passes: allowMerge on, its base the project's
integration base or the repository's default branch, not stacked on another open pull request
(its commits that its base lacks, by GitHub's compare, share none with another open one's, unless
that one is opened against its branch: the lower one merges first), every required check green,
and a review covering its head under
fixesAfterReview. When gh cannot say, or may have cut the open list, it asks: a stack is never
read as absent. A branch is allowed when the review
record covers its head. One line per verdict; exit 0 when every merge is allowed, 1 when any asks.
--asked (one pull request only) says the person gave their own yes to this merge. It
sets aside allowMerge and nothing else: the base rules, the stacked check, the required checks and
the review still decide, and the verdict says the merge rests on the person's yes. A yes names one
merge, so --asked takes exactly one pull request. Use it only with that yes in hand.
claims lists the project's "one home" claims (sentences like "the one home for X is \`X\`") and,
against --base (default: the merge base with origin/<the default branch>), the lines this branch
adds that define a name a claim gives to one home, in another file. It is a signal for a reviewer
and exits 0 whatever it finds; --json prints { claims, hits }.
slop keeps this machine's count of the plans closed since the last slop audit: record stores one
plan's bypassed homes and drifted copies (its areas come from the plan's own file list in the task
store; a second record of the same plan replaces the first), status says whether an audit is due
(slopAudit.everyPlans plans closed since the last one, or the plan just recorded left a finding),
and audited starts the count again, for every area or only the --area paths named.`;

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
 * new) must not stop a person from recording one — the record is what merge-check reads,
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
 * `agents` (the gate's own list, when it can be read) trusts — merge-check's answer.
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
 * The gate's lines: the review gate exactly as merge-check reads it — the policy committed
 * on `origin/<worktrees.base>`, the same read (`resolveGate`) — so `show` never disagrees with
 * the guard, even while this checkout's own file says something else. Nothing for a folder
 * with no project file: there the guard is silent. It ends with the `plans.mergeFiles` and
 * `plans.appendOnly` lines, from the same read.
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
        "gate: this project names no worktrees.base, so merge-check reads the policy committed on each pull request's base",
      ],
      gate: null,
    };
  }
  const read = resolveGate(paths, checkout, base, { env, timeoutMs: WORKFLOW_GIT_TIMEOUT_MS });
  if (!read.ok) {
    return {
      lines: [
        `gate: merge-check cannot read the policy committed on ${base} (${read.why}), so it allows no merge`,
        committedPlanLine("plans.mergeFiles", base, [], read.why),
        committedPlanLine("plans.appendOnly", base, [], read.why),
      ],
      gate: null,
    };
  }
  const { gate } = read;
  const lines = [
    `gate: what merge-check judges with, from origin/${base}:${CONFIG_PATH} as committed (this checkout's own copy does not count)`,
  ];
  for (const key of REVIEW_GATE_KEYS) {
    const value = resolvedValueOf(gate.resolved, key);
    lines.push(`gate ${key} = ${showValue(key, value.value)} (${sourceLabel(value, gate.branch)})`);
  }
  lines.push(`gate fixesAfterReview in force: ${fixesInForce(gate.resolved)}`);
  // The committed list is the gate's own read; git is asked only which entries are folders.
  const settled = settleMergeFiles(checkout, base, gate.resolved.plans.mergeFiles.value, {
    env,
    timeoutMs: WORKFLOW_GIT_TIMEOUT_MS,
  });
  lines.push(committedPlanLine("plans.mergeFiles", base, settled.files, settled.reason));
  lines.push(
    committedPlanLine("plans.appendOnly", base, gate.resolved.plans.appendOnly.value, null),
  );
  return { lines, gate };
}

/**
 * The line `show` prints for a committed plan list (`plans.mergeFiles`, `plans.appendOnly`) as the
 * plan store and herdr read it (`resolvePlanFiles`): the list committed on
 * `origin/<worktrees.base>`, never this checkout's own copy, with why it is empty or short when
 * that is so. Built from the gate's own read of the committed file (`gateLines`), so the file is
 * read once.
 */
function committedPlanLine(
  key: "plans.mergeFiles" | "plans.appendOnly",
  base: string,
  values: readonly string[],
  reason: string | null,
): string {
  const value = showValue(key, values);
  return `${key} as the plan tools read it, from origin/${base}:${CONFIG_PATH} = ${value}${reason === null ? "" : ` (${reason})`}`;
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
  for (const line of clashLines(clashesOf(resolved))) {
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
 * keeps a session from changing a setting that is the person's alone (the issue and plan keys).
 */
export function insideClaudeCode(env: Env): boolean {
  return env.CLAUDECODE !== undefined;
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
 * The refusal of a plan key (`PLAN_KEYS`) in `set` and `unset` inside a Claude Code session, in the
 * words of each key's own reason. The cap: the task store holds the session to it, so the person
 * raises it (read from the working copy, so the words name no committed file). The run mode: the
 * person's alone, so the words are the command to run. The merge files and the append-only
 * folders: read only as committed on the base. `propose` stays open for the project settings.
 */
function planKeyRefusal(sub: "set" | "unset", key: WorkflowKey): string {
  const head = `${COMMAND} workflow ${sub} ${key} cannot run inside a Claude Code session: ${key}`;
  if (key === "plans.runMode") {
    // The person's own setting, so there is no pull request: the command is the whole fix.
    const value = sub === "set" ? ` <${RUN_MODES.join("|")}>` : "";
    return `${head} decides how many sessions spend your usage on queued plans, so only you choose it. Run this in your own terminal: ${COMMAND} workflow ${sub} ${key}${value}`;
  }
  if (key === "plans.mergeFiles" || key === "plans.appendOnly") {
    const what =
      key === "plans.mergeFiles"
        ? "names the paths the plans' overlap check leaves out"
        : "names the folders where the plans' overlap check compares files only";
    return `${head} ${what}, so a session that could widen it would lift its own check; the kit reads only the copy committed on origin/<worktrees.base>. Run it in your own terminal with --project and commit it to the base. \`workflow propose\` opens a pull request you review instead.`;
  }
  return `${head} is the limit the task tools hold this session to, so only you change it. Run it in your own terminal. \`workflow propose\` opens a pull request you review instead.`;
}

/**
 * The refusal of a project-only key (`PROJECT_ONLY_KEYS`) written without `--project`, or null.
 * (A personal-only key with `--project` is refused by the writer, `write.ts`, in the table's words.)
 */
function wrongFileRefusal(key: WorkflowKey, projectFlag: boolean): string | null {
  if (!projectFlag && PROJECT_ONLY_KEYS.includes(key)) {
    return `${key} is the project's setting, not yours: run it with --project inside the project, and commit it to the base (it counts only as committed on origin/<worktrees.base>)`;
  }
  return null;
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
  if (verdict.kind === "refused") return `${subject}: asks — ${verdict.reason}`;
  if (verdict.kind === "unread") return `${subject}: asks — ${notChecked(verdict.what, env)}`;
  return `${subject}: asks — ${notInTime(verdict.what)}`;
}

/** `merge-check`'s arguments: pull request numbers, or a branch with its base. */
type MergeCheckArgs =
  | { ok: true; prs: number[]; branch: string | null; base: string | null; asked: boolean }
  | { ok: false; why: string };

function mergeCheckArgs(argv: string[]): MergeCheckArgs {
  const prs: number[] = [];
  let branch: string | null = null;
  let base: string | null = null;
  let asked = false;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index] ?? "";
    if (arg === "--asked") {
      asked = true;
      continue;
    }
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
    // A local merge has no `allowMerge` test, so a yes has nothing to set aside: say so, never
    // accept an option that would do nothing and let a session think it did.
    if (asked) {
      return {
        ok: false,
        why: "--asked is for a pull request: a local branch has no allowMerge to set aside",
      };
    }
    if (branch === null || base === null) {
      return { ok: false, why: "merge-check needs both --branch and --base" };
    }
    if (prs.length > 0) {
      return {
        ok: false,
        why: "merge-check takes pull request numbers, or --branch with --base, not both",
      };
    }
    return { ok: true, prs, branch, base, asked };
  }
  if (prs.length === 0) {
    return { ok: false, why: "merge-check needs a pull request number, or --branch with --base" };
  }
  // A yes names one merge: never let one `--asked` cover every number on the line.
  if (asked && prs.length > 1) {
    return {
      ok: false,
      why: `--asked is one person's yes to one merge: give it exactly one pull request, not ${prs.length}`,
    };
  }
  return { ok: true, prs, branch: null, base: null, asked };
}

/**
 * `workflow merge-check [<pr>… | <pr> --asked | --branch <b> --base <base>]`: merge-check's judgment,
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
  // One list of the open pull requests, and each one's commits once, for the whole line.
  const stack = newStackCache();
  for (const pr of parsed.prs) {
    const verdict = await checkPullRequest(
      world,
      { ref: String(pr), repo: null },
      defaultBranches,
      { asked: parsed.asked, stack },
    );
    if (verdict.kind !== "allowed") everyAllowed = false;
    context.print(verdictLine(verdict, `#${pr}`, context.env));
  }
  return everyAllowed ? 0 : 1;
}

/**
 * The options of `claims` or `slop` (`parseOptions`, the one reader every subcommand uses), or
 * null after the usage error is printed: a command that takes no word refuses one.
 */
function readArgs(
  context: WorkflowContext,
  argv: string[],
  known: readonly string[],
  flags: readonly string[],
  repeatable: readonly string[] = [],
): ParsedOptions | null {
  const parsed = parseOptions(argv, known, flags, repeatable);
  const why =
    "error" in parsed
      ? parsed.error
      : parsed.positionals.length > 0
        ? `Unexpected word: ${parsed.positionals.join(" ")}`
        : null;
  if (why === null && !("error" in parsed)) return parsed;
  context.error(`${why}\n\n${WORKFLOW_USAGE}`);
  return null;
}

/**
 * Where the claims diff starts: `--base` as given, else the merge base with `origin/<the default
 * branch>`, which git's `A...B` finds. The default branch is the project's `worktrees.base`, else
 * the remote's (`baseBranch`); when neither is known, or origin has no such branch here, the reason
 * comes back instead, so the claims are listed with it.
 */
function claimsBase(
  checkout: Checkout,
  base: string | null,
  env: Env,
): DiffBase | { error: string } {
  if (base !== null) {
    return commitOf(checkout.root, base, env) === null
      ? { error: `${base} is not a commit in this repository` }
      : { ref: base };
  }
  let named: ReturnType<typeof baseBranch>;
  try {
    named = baseBranch(checkout, env, repoOf(checkout));
  } catch (error) {
    return { why: error instanceof Error ? error.message : String(error) };
  }
  if (named.from === "default") {
    return {
      why: "this project names no worktrees.base and origin/HEAD is not set, so its default branch is unknown: pass --base <ref>",
    };
  }
  const ref = `origin/${named.base}`;
  return commitOf(checkout.root, ref, env) === null
    ? { why: `${ref} is not in this clone: fetch it, or pass --base <ref>` }
    : { ref };
}

/**
 * `workflow claims [--base <ref>] [--json]`: the project's "one home" claims, and the lines this
 * branch adds that define a symbol a claim names, in another file (`claims.ts`). A signal for a
 * reviewer: it exits 0 whatever it finds. Only a wrong option (2), a base that is no commit (1) or
 * a git that cannot answer (1) are not 0.
 */
function claims(context: WorkflowContext, argv: string[]): number {
  const options = readArgs(context, argv, ["--base"], ["--json"]);
  if (options === null) return 2;
  const json = options.flags.has("--json");
  const here = checkoutOf(context.cwd, context.env);
  if (here.checkout === null) {
    context.print(json ? JSON.stringify({ claims: [], hits: [] }) : `No claims read: ${here.why}`);
    return 0;
  }
  const base = claimsBase(here.checkout, options.options.get("--base") ?? null, context.env);
  if ("error" in base) {
    context.error(`${COMMAND} workflow claims: ${base.error}`);
    return 1;
  }
  const report = collectClaims(here.checkout.root, context.env, base);
  if ("error" in report) {
    context.error(`${COMMAND} workflow claims: ${report.error}`);
    return 1;
  }
  const lines = json
    ? [JSON.stringify({ claims: report.claims, hits: report.hits }, null, 2)]
    : claimsLines(report, `${COMMAND} workflow claims --json`);
  for (const line of lines) context.print(line);
  return 0;
}

/** `slop`'s repository, its record file and the cadence in force; null after it said why not. */
function slopWorld(
  context: WorkflowContext,
  sub: string,
): { file: string; everyPlans: number } | null {
  const here = checkoutOf(context.cwd, context.env);
  if (here.checkout === null) {
    context.error(`${COMMAND} workflow slop ${sub}: ${here.why}`);
    return null;
  }
  try {
    const config = loadProjectConfig(here.checkout).config;
    return {
      file: slopFile(context.paths.stateDir, repoOf(here.checkout)),
      everyPlans: resolveWorkflow(context.paths, config).slopAudit.everyPlans.value,
    };
  } catch (error) {
    context.error(error instanceof Error ? error.message : String(error));
    return null;
  }
}

/** The status lines of the record in `file`, printed after the line of a write. */
function printSlopStatus(context: WorkflowContext, file: string, everyPlans: number): void {
  for (const line of slopStatusLines(slopStatus(readSlop(file), everyPlans), everyPlans)) {
    context.print(line);
  }
}

/** A count option as a person typed it: digits only. */
function countOption(value: string | undefined): number | null {
  return value !== undefined && /^\d+$/.test(value) ? Number(value) : null;
}

/**
 * The files of the plan `ref` names in this project's task store, and the slug it is stored
 * under; or why there is no such plan. `ref` may be the slug, `#n` or an id (`planByRef`).
 */
function planFilesOf(
  context: WorkflowContext,
  ref: string,
): { ok: true; slug: string; files: string[] } | { ok: false; why: string } {
  const tasks = taskContext(context.cwd, context.env);
  if (!tasks.ok) return { ok: false, why: tasks.why };
  const unknown = {
    ok: false as const,
    why: `plan "${ref}" is not in this project's task store. Use the slug of the plan task, as the task list shows it (task_list, scope plan).`,
  };
  const file = workDbFile(context.paths);
  if (!existsSync(file)) return unknown;
  const db = openWorkDb(file, { mode: "hook" });
  try {
    const plan = planByRef(db, tasks.project, ref);
    if (plan === null || plan.kind !== "plan") return unknown;
    return { ok: true, slug: plan.plan ?? ref, files: planFiles(db, plan) };
  } finally {
    db.close();
  }
}

/** `workflow slop record --plan <slug> --bypassed <n> --drifted <n>`: one closed plan into the count. */
async function slopRecord(context: WorkflowContext, argv: string[]): Promise<number> {
  const options = readArgs(context, argv, ["--plan", "--bypassed", "--drifted"], []);
  if (options === null) return 2;
  const plan = options.options.get("--plan");
  const bypassed = countOption(options.options.get("--bypassed"));
  const drifted = countOption(options.options.get("--drifted"));
  if (plan === undefined || bypassed === null || drifted === null) {
    context.error(
      `slop record needs --plan <slug>, --bypassed <n> and --drifted <n>, each count a whole number\n\n${WORKFLOW_USAGE}`,
    );
    return 2;
  }
  const world = slopWorld(context, "record");
  if (world === null) return 1;
  const found = planFilesOf(context, plan);
  if (!found.ok) {
    context.error(`${COMMAND} workflow slop record: ${found.why}`);
    return 1;
  }
  try {
    await recordSlop(
      world.file,
      { plan: found.slug, bypassed, drifted, areas: areasOf(found.files) },
      Date.now(),
    );
    context.print(
      `+ ${tildify(world.file, context.paths.home)}: plan ${found.slug} recorded (${bypassed} bypassed, ${drifted} drifted)`,
    );
    printSlopStatus(context, world.file, world.everyPlans);
    return 0;
  } catch (error) {
    context.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

/** `workflow slop audited [--area <path>]...`: the count starts again, for every area or the named ones. */
async function slopAudited(context: WorkflowContext, argv: string[]): Promise<number> {
  const options = readArgs(context, argv, ["--area"], [], ["--area"]);
  if (options === null) return 2;
  const named = options.lists.get("--area") ?? [];
  if (named.some((path) => areasOf([path]).length === 0)) {
    context.error(`--area needs a path\n\n${WORKFLOW_USAGE}`);
    return 2;
  }
  const areas = areasOf(named);
  const world = slopWorld(context, "audited");
  if (world === null) return 1;
  try {
    await recordAudit(world.file, areas, Date.now());
    context.print(
      `+ ${tildify(world.file, context.paths.home)}: audit recorded for ${areas.length === 0 ? "every area" : areas.join(", ")}`,
    );
    printSlopStatus(context, world.file, world.everyPlans);
    return 0;
  } catch (error) {
    context.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

/** `workflow slop status [--json]`: the count since the last audit, and whether an audit is due. */
function slopStatusCommand(context: WorkflowContext, argv: string[]): number {
  const options = readArgs(context, argv, [], ["--json"]);
  if (options === null) return 2;
  const world = slopWorld(context, "status");
  if (world === null) return 1;
  try {
    if (options.flags.has("--json")) {
      context.print(JSON.stringify(slopStatus(readSlop(world.file), world.everyPlans), null, 2));
    } else {
      printSlopStatus(context, world.file, world.everyPlans);
    }
    return 0;
  } catch (error) {
    context.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

/** `workflow slop record | status | audited` (`slop.ts`). */
async function slop(context: WorkflowContext, argv: string[]): Promise<number> {
  const [verb, ...rest] = argv;
  if (verb === "record") return await slopRecord(context, rest);
  if (verb === "audited") return await slopAudited(context, rest);
  if (verb === "status") return slopStatusCommand(context, rest);
  context.error(`slop needs record, status or audited\n\n${WORKFLOW_USAGE}`);
  return 2;
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
  const current = key === undefined ? undefined : currentKeyName(key);
  if (
    key === undefined ||
    current === undefined ||
    !WORKFLOW_KEYS.includes(current as WorkflowKey)
  ) {
    context.error(
      key === undefined
        ? `${sub} needs a setting\n\n${WORKFLOW_USAGE}`
        : `Unknown setting: ${key}. The settings are: ${WORKFLOW_KEYS.join(", ")}`,
    );
    return 2;
  }
  const wanted = current as WorkflowKey;
  if (
    (OUTBOUND_KEYS.includes(wanted) || INBOUND_KEYS.includes(wanted)) &&
    insideClaudeCode(context.env)
  ) {
    context.error(issueKeyRefusal(sub === "set" ? "set" : "unset", wanted));
    return 1;
  }
  if (PLAN_KEYS.includes(wanted) && insideClaudeCode(context.env)) {
    context.error(planKeyRefusal(sub === "set" ? "set" : "unset", wanted));
    return 1;
  }
  const wrongFile = wrongFileRefusal(wanted, projectFlag);
  if (wrongFile !== null) {
    context.error(wrongFile);
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
      ? writeProjectSetting(context.cwd, wanted, value, context.env)
      : writePersonalSetting(context.paths, wanted, value);
    const renamed = renamedLine(key, wanted);
    if (renamed !== null) context.print(renamed);
    context.print(line);
    // D16: a write that leaves settings that cannot work together says so, with the fix. The
    // policy after the write is read the same way `show` reads it.
    const here = project(context.cwd, context.env);
    for (const clash of clashLines(clashesOf(resolveWorkflow(context.paths, here.config)))) {
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
  | {
      folder: null | string;
      json: boolean;
      ok: true;
      setting: WorkflowKey;
      /** The name as typed, which may be an old one (`autoPush` for `allowPush`). */
      typed: string;
      value: unknown;
    }
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
  const current = key === undefined ? undefined : currentKeyName(key);
  if (
    key === undefined ||
    current === undefined ||
    !WORKFLOW_KEYS.includes(current as WorkflowKey)
  ) {
    return {
      ok: false,
      why:
        key === undefined
          ? "propose needs a setting"
          : `Unknown setting: ${key}. The settings are: ${WORKFLOW_KEYS.join(", ")}`,
    };
  }
  const wanted = current as WorkflowKey;
  if (unset) {
    return rest.length > 0
      ? { ok: false, why: "propose takes a value, or --unset, not both" }
      : { folder, json, ok: true, setting: wanted, typed: key, value: undefined };
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
    ? { folder, json, ok: true, setting: wanted, typed: key, value: parsed.value }
    : { ok: false, why: parsed.why };
}

/**
 * `workflow propose <setting> <value> [--unset] [--folder <project>] [--json]`: one of the
 * project's own settings, changed through a pull request (`propose.ts`, D57).
 */
async function propose(context: WorkflowContext, argv: string[]): Promise<number> {
  const parsed = proposeArgs(argv);
  if (!parsed.ok) {
    context.error(`${parsed.why}\n\n${WORKFLOW_USAGE}`);
    return 2;
  }
  // `--json` prints one object and nothing else, so the rename line stays out of it.
  const renamed = parsed.json ? null : renamedLine(parsed.typed, parsed.setting);
  if (renamed !== null) context.print(renamed);
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
  if (sub === "claims") return claims(context, rest);
  if (sub === "slop") return await slop(context, rest);
  context.error(`Unknown workflow command: ${sub}\n\n${WORKFLOW_USAGE}`);
  return 2;
}
