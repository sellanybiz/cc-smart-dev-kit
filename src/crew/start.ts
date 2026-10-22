/**
 * `cc-smart-dev-kit crew start <phase> --slug <s> --kind <kind> --brief <file|-> …`: starts one
 * crew session, a background Claude Code session in its own worktree, and **returns at once** (D25):
 * one line, `started …`, `queued …` or `failed …`, and — for an opus-tier session that starts
 * while no 5-hour window reading is stored — one note line after it (D54). Nothing here waits on
 * the crew session, polls, or retries.
 *
 * In order:
 *   1. the shared checks (`readCaller`: not a crew session, crew sessions on, a Claude session, no bypass),
 *      and a lead recorded for this session in this repository (`crew lead` first);
 *   2. the brief (a file, or stdin with `-`), the model and effort — the kind's (`crewLaunch`,
 *      D46), or the person's override judged by the Agent guard's own policy (`judgeLaunch`): a
 *      launch the guard refuses is refused, and one it would ask the person about (`opus` at
 *      `max`, Fable) is refused too, because `crew start` never asks; the person starts such a
 *      session themselves;
 *   3. `claude` found, the base a commit, the branch name valid;
 *   4. under the machine-wide places lock: the name not in use (the store, the branch, the
 *      folder), then start now or queued (`placeFor`: its phases, its lead's caps, the
 *      machine's ceiling and the 5-hour window, the memory), and the record (`starting` or
 *      `queued`, one `created` event);
 *   5. its files: the brief with its frame (`brief.md`) and the settings file that names the
 *      crew session to its own session and turns Claude Code's retry watchdog on, with no wait
 *      limit (`settings.json`, `{"env":{"CC_SMART_DEV_KIT_CREW":<id>,
 *      "CLAUDE_CODE_RETRY_WATCHDOG":"1","CLAUDE_CODE_RETRY_WATCHDOG_USAGE_LIMIT_RECHECK_MS":"300000"}}`,
 *      D42);
 *   6. a queued crew session ends here. Otherwise: `git worktree add -b crew/<phase>-<slug>
 *      .claude/worktrees/crew-<phase>-<slug> <base>` in the main checkout (fast; anything slow is
 *      the crew session's own first step), the `.worktreeinclude` files copied, then `claude --bg -w …`
 *      from the main checkout, the short id read from its `backgrounded` line, and ONE read of
 *      `claude agents --json --all` to record the session id and see that agent view lists it.
 *      **The folder is not judged here**: `claude agents --json` reports the launch folder until a
 *      `-w` session has entered its worktree (2.1.308), so an immediate read races it. The crew
 *      session stays `starting`; its own SessionStart hook (`crew-role`) judges its `cwd` against
 *      the record's worktree — the role card inside it, and `failed` with the reason outside it
 *      (`src/hooks/crew-role.ts`). When nothing started (`claude` refused, `Workspace not
 *      trusted`), the worktree and its branch are taken back, so a second try finds the name free.
 */
import { existsSync, readFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { COMMAND } from "../build-info/names";
import { tildify } from "../cli/paths";
import { gatewayFactsOf, judgeLaunch } from "../hooks/agent-guard";
import { runGit } from "../hooks/git";
import {
  AFFORDABLE_EFFORT,
  answeringSlot,
  CREW_KINDS,
  type CrewKind,
  crewLaunch,
  isAffordable,
  isCrewKind,
  type LaunchModel,
  resolveLaunchModel,
  uiEffortAllowed,
  uiRuleText,
  uiTierAllowed,
} from "../models/launch-policy";
import {
  RETRY_WATCHDOG_ENV,
  RETRY_WATCHDOG_RECHECK_ENV,
  RETRY_WATCHDOG_RECHECK_MS,
  RETRY_WATCHDOG_VALUE,
} from "../setup/retry-watchdog";
import type { ResolvedWorkflow } from "../workflow/resolve";
import { copyWorktreeInclude } from "../worktrees/include";
import { claudeDeps } from "./agents";
import { BRIEF_FRAME_MARK, briefText, firstPrompt, REPORT_COMMAND } from "./brief";
import { type Caller, readCaller, reasonOf, requireSession } from "./caller";
import {
  agentRow,
  CREW_PERMISSION_MODE,
  callClaude,
  findClaude,
  launchArgs,
  parseAgents,
  parseBackgrounded,
  refusedUntrusted,
} from "./claude";
import type { CrewContext, Env } from "./context";
import { lastLine, modelText } from "./display";
import { CREW_REF, crewName } from "./names";
import {
  OPUS_TIER,
  onOpusTier,
  placeFor,
  runningCrew,
  runningForLead,
  unmetWaits,
  withPlacesLock,
} from "./places";
import { CREW_ENV } from "./session";
import {
  type CrewChange,
  type CrewRecord,
  createCrew,
  crewBriefFile,
  crewReportFile,
  crewSettingsFile,
  type HandBackReport,
  type KnownOr,
  type LeadRecord,
  listAllCrew,
  listCrew,
  readLead,
  readReport,
  updateCrew,
  writeStoreFile,
} from "./store";
import { usageFacts, usageUnreadLine } from "./usage-guard";

/** What `crew start` was asked, already checked to be well formed (`command.ts`). */
export interface StartArgs {
  phase: string;
  slug: string;
  kind: CrewKind;
  /** A file to read the brief from, or `-` for stdin. */
  brief: string;
  base: null | string;
  files: string[];
  model: null | string;
  effort: null | string;
  waitsFor: string[];
  /** The crew session this one continues (the hand-off): its name or its id; null when it is new. */
  continueFrom: null | string;
}

/** How long one quick git call may take (a `rev-parse`, a `check-ref-format`). */
const GIT_TIMEOUT_MS = 15_000;

/**
 * How long `git worktree add` may take: a checkout of a big tree, and the repo's own
 * `post-checkout` hook (Git LFS), are seconds; this is the ceiling, not the expected time.
 */
const WORKTREE_ADD_TIMEOUT_MS = 120_000;

/** The subagent type a crew session is judged as: one that builds (never a read-only one). */
const CREW_AGENT_TYPE = "general-purpose";

/** The folder name of a crew session's worktree, under `.claude/worktrees/`. */
export function worktreeName(phase: string, slug: string, n?: null | number): string {
  return `${CREW_REF}-${phase}-${slug}${handoffSuffixOf(n)}`;
}

/** A crew session's branch. */
export function crewBranch(phase: string, slug: string, n?: null | number): string {
  return `${CREW_REF}/${phase}-${slug}${handoffSuffixOf(n)}`;
}

/**
 * The `-2`, `-3` a hand-off's next crew session carries on its branch and its worktree folder, so the
 * next crew session of a phase never takes the branch or the folder of the one before it. The name
 * carries ` 2` instead (`crewName`, `names.ts`); the branch and the folder cannot carry a
 * space.
 */
function handoffSuffixOf(n: null | number | undefined): string {
  if (n === undefined || n === null || n === 1) return "";
  if (!Number.isInteger(n) || n < 2) {
    throw new Refusal([`a hand-off number is a whole number of 2 or more, not ${n}`], 2);
  }
  return `-${n}`;
}

/** The model and effort a crew session starts on, and what answers them. */
interface Chosen {
  effort: string;
  model: string;
  real: LaunchModel;
  slot: null | string;
}

/** The guard's text on one line. */
function oneLine(text: string): string {
  return text.replace(/\s*\n\s*/g, " ").trim();
}

/**
 * The one plain line a `ui` session's override is refused with (D50): UI/UX work never runs on
 * an affordable model or below `high`, and the kind's own model and effort already meet the
 * rule. The names in it come from `UI_POLICY`, the rule's one home.
 */
function uiRefusal(): string {
  return `UI/UX work runs only on ${uiRuleText()} (D50): pick one of those for a \`ui\` session.`;
}

/**
 * The model and effort: the kind's own, or the override (`--model`, `--effort`) — a model
 * without an effort runs at the kind's effort, or at `AFFORDABLE_EFFORT` when an affordable
 * model answers it. A `ui` session is never put on an affordable model or below `high` (D50).
 * Either way the Agent guard's policy judges it: anything it would refuse or ask the person
 * about is refused here, with its words.
 */
export function chooseLaunch(
  kind: CrewKind,
  override: { effort: null | string; model: null | string },
  ctx: Pick<CrewContext, "env" | "paths">,
): Chosen | { refusal: string } {
  const gateway = gatewayFactsOf(ctx.paths);
  const own = crewLaunch(kind, gateway, ctx.env);
  const model = override.model ?? own.model;
  const real = override.model === null ? own.real : resolveLaunchModel(model, gateway, ctx.env);
  const kindEffort = isAffordable(real) ? AFFORDABLE_EFFORT : CREW_KINDS[kind].effort;
  const effort = (
    override.effort ?? (override.model === null ? own.effort : kindEffort)
  ).toLowerCase();
  if (kind === "ui" && (!uiTierAllowed(real) || !uiEffortAllowed(effort))) {
    return { refusal: uiRefusal() };
  }
  const verdict = judgeLaunch(
    { effort, fork: false, model, prompt: "", subagentType: CREW_AGENT_TYPE, tool: "Agent" },
    { ...gateway, sessionModel: null },
    ctx.env,
  );
  if (verdict.decision === "deny") {
    return {
      refusal: `the agent guard refuses ${model} at effort ${effort}: ${oneLine(verdict.reason)}`,
    };
  }
  if (verdict.decision === "ask") {
    const first = verdict.reason.split("\n")[0] ?? "";
    return {
      refusal: `the agent guard asks the person before ${model} at effort ${effort} (${first}), and crew start never asks: pick a model and effort it runs with no question, or the person starts that session themselves`,
    };
  }
  return { effort, model, real, slot: answeringSlot(model, gateway, ctx.env) };
}

/** One git call's trimmed output, or null when it failed. */
function gitOut(folder: string, args: string[], env: Env): null | string {
  const run = runGit(folder, args, env, GIT_TIMEOUT_MS);
  return run.ok ? run.out : null;
}

/** The ref the lead is on: its branch, or the commit of a detached HEAD. */
function currentRef(root: string, env: Env): null | string {
  return (
    gitOut(root, ["symbolic-ref", "--quiet", "--short", "HEAD"], env) ??
    gitOut(root, ["rev-parse", "--verify", "--quiet", "HEAD"], env)
  );
}

/** The commit `ref` names in `root`; null when it names none. */
function commitOf(root: string, ref: string, env: Env): null | string {
  return gitOut(root, ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`], env);
}

/** A refusal before anything is recorded: its lines, and the exit code. */
class Refusal extends Error {
  constructor(
    readonly lines: string[],
    readonly code: 1 | 2,
  ) {
    super(lines.join("\n"));
  }
}

/** The refusal of `crew start`, with a fix line when there is one. */
function refusal(line: string, fix?: string, code: 1 | 2 = 1): Refusal {
  const lines = [`crew start: ${line}`];
  if (fix !== undefined) lines.push(`Fix: ${fix}`);
  return new Refusal(lines, code);
}

/** The brief as given: the file, or stdin with `-`. Throws a refusal when it is missing or empty. */
async function readBrief(args: StartArgs, ctx: CrewContext): Promise<string> {
  let text: string;
  if (args.brief === "-") {
    text = await ctx.readStdin();
  } else {
    try {
      text = readFileSync(resolve(ctx.cwd, args.brief), "utf8");
    } catch (error) {
      throw refusal(`the brief ${args.brief} cannot be read (${reasonOf(error)})`);
    }
  }
  if (text.trim() === "") throw refusal("the brief is empty", undefined, 2);
  return text;
}

/** Everything known before the record is written. */
interface Plan {
  caller: Caller;
  lead: LeadRecord;
  briefGiven: string;
  chosen: Chosen;
  claude: string;
  baseRef: string;
  baseSha: string;
  name: string;
  branch: string;
  worktree: string;
  /** The phase's slug: the old crew session's, for a continuation. */
  slug: string;
  /** The phase the crew session works on. */
  phase: string;
  /** The phase's kind: the old crew session's, for a continuation. */
  kind: KnownOr<CrewKind>;
  /** The files the phase owns. */
  files: string[];
  /** The phases it waits for. */
  waitsFor: string[];
  /** The id of the crew session whose hand-off this one carries on; null for a crew session's first try. */
  continues: null | string;
}

/**
 * What the launch needs, without the rest of the plan: the crew session's own folder, the branch it
 * gets, the commit it is cut from, and the model and effort it runs on. The launcher
 * (`crew start`) and the watch (which starts a queued crew session) both go through it.
 */
export interface LaunchSpec {
  /** The repository the worktree is made in, and where `claude` runs. */
  repo: string;
  /** The worktree's folder. */
  worktree: string;
  /** The branch the worktree gets. */
  branch: string;
  /** The commit the worktree is cut from. */
  baseSha: string;
  /** The model the launch names. */
  model: string;
  /** The model that answers it, when it is not the one named. */
  resolved: string;
  /** The effort the launch runs at. */
  effort: string;
  /** The lead's name, in the session's first line. */
  leadName: string;
  /** The `claude` to run. */
  claude: string;
}

/** Steps 1–3: every check that needs no lock. Throws a `Refusal`. */
async function plan(args: StartArgs, ctx: CrewContext): Promise<Plan> {
  const read = readCaller("start", ctx);
  if (!read.ok) throw new Refusal(read.lines, 1);
  const { caller } = read;
  const session = requireSession(caller, "start");
  if (!session.ok) throw new Refusal(session.lines, 1);
  let lead: LeadRecord | null;
  try {
    lead = readLead(ctx.paths.stateDir, caller.repo, session.session.sessionId);
  } catch (error) {
    throw refusal(reasonOf(error));
  }
  if (lead === null) {
    throw refusal(
      `this session is no lead in ${tildify(caller.repo, ctx.paths.home)}`,
      `run ${COMMAND} crew lead --plan <slug> in it first`,
    );
  }
  const claude = findClaude({ home: ctx.paths.home, platform: ctx.platform, which: ctx.which });
  if (claude === null) {
    throw refusal(
      "claude is not on PATH, nor in ~/.local/bin",
      "install Claude Code, or put its folder on PATH",
    );
  }
  if (args.continueFrom !== null) {
    return await planContinuation(args, ctx, caller, lead, claude);
  }
  const briefGiven = await readBrief(args, ctx);
  const chosen = chooseLaunch(args.kind, args, ctx);
  if ("refusal" in chosen) throw refusal(chosen.refusal, undefined, 2);
  const root = caller.checkout.root;
  const baseRef = args.base ?? currentRef(root, ctx.env);
  const baseSha = baseRef === null ? null : commitOf(root, baseRef, ctx.env);
  if (baseRef === null || baseSha === null) {
    throw refusal(
      baseRef === null
        ? "this checkout has no commit to start from"
        : `the base ${baseRef} is no commit here`,
      "name a branch or a commit with --base",
    );
  }
  const branch = crewBranch(args.phase, args.slug);
  if (gitOut(caller.repo, ["check-ref-format", "--branch", branch], ctx.env) === null) {
    throw refusal(`${branch} is not a name git takes for a branch`, "pick another --slug", 2);
  }
  let name: string;
  try {
    name = crewName(lead.tag, args.phase, args.slug);
  } catch (error) {
    throw refusal(reasonOf(error), undefined, 2);
  }
  const worktree = join(caller.repo, ".claude", "worktrees", worktreeName(args.phase, args.slug));
  return {
    baseRef,
    baseSha,
    branch,
    briefGiven,
    caller,
    chosen,
    claude,
    continues: null,
    files: args.files,
    kind: args.kind,
    lead,
    name,
    phase: args.phase,
    slug: args.slug,
    waitsFor: args.waitsFor,
    worktree,
  };
}

/**
 * The hand-off: a new crew session of the same phase, cut from the old crew session's head, with the old
 * brief and the old crew session's report, and the next number in its name.
 *
 * It is a new launch, so it goes through the same launch policy a fresh start does
 * (`chooseLaunch`, D21): the old crew session's model and effort are asked for again, and the Agent
 * guard's rules judge them now. **The old crew session is stopped, not removed** (`stopContinued`).
 */
async function planContinuation(
  args: StartArgs,
  ctx: CrewContext,
  caller: Caller,
  lead: LeadRecord,
  claude: string,
): Promise<Plan> {
  const records = listCrew(ctx.paths.stateDir, caller.repo).records;
  const old = records.find((one) => one.name === args.continueFrom || one.id === args.continueFrom);
  if (old === undefined) {
    throw refusal(
      `no crew session named "${args.continueFrom}" is recorded in this repository`,
      `the crew here: ${records.map((one) => one.name).join(", ")}`,
    );
  }
  if (old.phase !== args.phase) {
    throw refusal(
      `${old.name} works on phase ${old.phase}, and this one is ${args.phase}`,
      `crew start ${old.phase} --continue "${old.name}"`,
    );
  }
  if (old.state !== "handoff") {
    throw refusal(
      `${old.name} is ${old.state}, and only a crew session that handed off can be continued`,
      `the crew session hands off with \`${REPORT_COMMAND} --status handoff\``,
    );
  }
  // One next crew session per hand-off: a second `--continue` of the same crew session would put two
  // crew sessions on one phase. A next crew session that failed or was removed leaves the way free.
  const next = records.find(
    (one) => one.continues === old.id && one.state !== "failed" && one.state !== "removed",
  );
  if (next !== undefined) {
    throw refusal(
      `${old.name} has its next crew session already: ${next.name}, ${next.state}`,
      `${COMMAND} crew status "${next.name}"`,
    );
  }
  if (!isCrewKind(old.kind)) {
    throw refusal(`${old.name} has a kind this kit does not know (${old.kind})`);
  }
  const chosen = chooseLaunch(old.kind, { effort: old.effort, model: old.model.named }, ctx);
  if ("refusal" in chosen) throw refusal(chosen.refusal, undefined, 2);
  const number =
    records.filter((one) => one.phase === old.phase && one.slug === old.slug).length + 1;
  let name: string;
  try {
    name = crewName(lead.tag, old.phase, old.slug, number);
  } catch (error) {
    throw refusal(reasonOf(error), undefined, 2);
  }
  const branch = crewBranch(old.phase, old.slug, number);
  if (gitOut(caller.repo, ["check-ref-format", "--branch", branch], ctx.env) === null) {
    throw refusal(`${branch} is not a name git takes for a branch`, undefined, 2);
  }
  const baseSha = commitOf(caller.repo, old.branch, ctx.env);
  if (baseSha === null) {
    throw refusal(
      `the branch ${old.branch} of ${old.name} is no commit here`,
      "the old crew session's branch must still be in this repository",
    );
  }
  return {
    baseRef: old.branch,
    baseSha,
    branch,
    briefGiven: continuationBrief(ctx, caller.repo, old),
    caller,
    chosen,
    claude,
    continues: old.id,
    files: old.files,
    kind: old.kind,
    lead,
    name,
    phase: old.phase,
    slug: old.slug,
    waitsFor: old.waitsFor,
    worktree: join(caller.repo, ".claude", "worktrees", worktreeName(old.phase, old.slug, number)),
  };
}

/**
 * The brief of a continuation: the lead's own brief for the phase (the part before the frame —
 * the frame is always last, so the last mark is the right cut), then what the old crew session left
 * behind. A report that cannot be read is a refusal: a hand-off without it would lose what the
 * next crew session must know.
 */
function continuationBrief(ctx: CrewContext, repo: string, old: CrewRecord): string {
  let given = "";
  try {
    const text = readFileSync(crewBriefFile(ctx.paths.stateDir, repo, old.id), "utf8");
    const cut = text.lastIndexOf(BRIEF_FRAME_MARK);
    given = (cut === -1 ? text : text.slice(0, cut)).trimEnd();
  } catch {
    // The old brief is gone: the report below still says what the next crew session must know.
  }
  let report: HandBackReport | null;
  try {
    report = readReport(crewReportFile(ctx.paths.stateDir, repo, old.id));
  } catch (error) {
    throw refusal(`the report of ${old.name} cannot be read: ${reasonOf(error)}`);
  }
  return [given, report === null ? "" : reportBlock(report)]
    .filter((part) => part !== "")
    .join("\n\n");
}

/** What a crew session that handed off left behind, as the block the next crew session reads. */
function reportBlock(report: HandBackReport): string {
  const lines = [
    `## What ${report.phase} left behind`,
    "",
    `- Its branch was \`${report.branch.name}\` at ${report.branch.sha.slice(0, 7)}; it changed ${report.changed.files} files (+${report.changed.insertions}, -${report.changed.deletions}).`,
  ];
  if (report.docs.length > 0) lines.push(`- The docs it changed: ${report.docs.join(", ")}.`);
  if (report.outsideBrief.length > 0) {
    lines.push(`- It changed files outside its brief: ${report.outsideBrief.join(", ")}.`);
  }
  if (report.needsLead.length > 0) {
    lines.push(`- What only the lead may do: ${report.needsLead.join("; ")}.`);
  }
  if (report.open.length > 0) lines.push(`- What is still open: ${report.open.join("; ")}.`);
  if (typeof report.summary === "string" && report.summary !== "") {
    lines.push("", "Its own words:", "", report.summary);
  }
  return lines.join("\n");
}

/**
 * True when a recorded crew session still holds its name: every one but a `removed` crew session, and a
 * `failed` one that never got a session and left no worktree (its launch started nothing, and
 * what it made was taken back) — the record stays as history, and a second try may start.
 */
export function holdsName(record: CrewRecord): boolean {
  if (record.state === "removed") return false;
  return !(record.state === "failed" && record.shortId === null && !existsSync(record.worktree));
}

/** Why the name is in use already, or null when it is free: the store, the branch, the folder. */
function inUse(planned: Plan, records: readonly CrewRecord[], ctx: CrewContext): null | Refusal {
  const { branch, caller, name, worktree } = planned;
  const recorded = records.find(
    (one) => one.repo === caller.repo && one.branch === branch && holdsName(one),
  );
  if (recorded !== undefined) {
    return refusal(
      `${recorded.name} is recorded already, ${recorded.state}, on ${branch}`,
      `remove it first (${COMMAND} crew rm "${recorded.name}"), or pick another --slug`,
    );
  }
  if (
    gitOut(caller.repo, ["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`], ctx.env) !==
    null
  ) {
    return refusal(
      `the branch ${branch} is there already, for ${name}`,
      "delete it, or pick another --slug",
    );
  }
  if (existsSync(worktree)) {
    return refusal(
      `the folder ${tildify(worktree, ctx.paths.home)} is there already`,
      "remove that worktree (git worktree remove), or pick another --slug",
    );
  }
  return null;
}

/** The worktree and branch taken back after a launch that started nothing; null when both went. */
function takeBack(spec: LaunchSpec, env: Env): null | string {
  const { baseSha, branch, repo, worktree } = spec;
  const removed = runGit(repo, ["worktree", "remove", worktree], env, GIT_TIMEOUT_MS);
  // The branch goes only while it still points where it was cut: nothing was committed on it.
  const head = gitOut(repo, ["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`], env);
  const deleted =
    head === baseSha && runGit(repo, ["branch", "-D", branch], env, GIT_TIMEOUT_MS).ok;
  if (removed.ok && deleted) return null;
  return `left behind: ${removed.ok ? "" : `the worktree ${worktree} `}${deleted ? "" : `the branch ${branch}`}`.trim();
}

/** Marks the crew session failed with `reason`, prints its line; exit 1. */
async function failed(
  record: CrewRecord,
  reason: string,
  ctx: CrewContext,
  change: CrewChange = {},
): Promise<number> {
  try {
    await updateCrew(
      ctx.paths.stateDir,
      record.repo,
      record.id,
      { ...change, state: "failed" },
      ctx.now(),
      reason,
    );
  } catch (error) {
    ctx.error(`crew start: the store could not record the failure: ${reasonOf(error)}`);
  }
  ctx.print(`failed ${record.name}: ${reason}`);
  return 1;
}

/** Step 6: the worktree, the session, and the session id it records. */
async function launch(spec: LaunchSpec, record: CrewRecord, ctx: CrewContext): Promise<number> {
  const { worktree } = spec;
  const added = runGit(
    spec.repo,
    ["worktree", "add", "-b", spec.branch, worktree, spec.baseSha],
    ctx.env,
    WORKTREE_ADD_TIMEOUT_MS,
  );
  if (!added.ok)
    return await failed(record, `git worktree add failed: ${lastLine(added.err)}`, ctx);
  try {
    copyWorktreeInclude(spec.repo, worktree, ctx.env);
  } catch (error) {
    ctx.error(`crew start: the .worktreeinclude files were not copied: ${reasonOf(error)}`);
  }
  const deps = claudeDeps(ctx);
  const briefFile = crewBriefFile(ctx.paths.stateDir, spec.repo, record.id);
  const args = launchArgs({
    effort: spec.effort,
    model: spec.model,
    name: record.name,
    prompt: firstPrompt(record.name, spec.leadName, briefFile),
    settingsFile: crewSettingsFile(ctx.paths.stateDir, spec.repo, record.id),
    // The folder's own name: a hand-off's next crew session has a number in it (`crew-B6b-x-2`), and a
    // queued crew session is launched later from its record, so the record's path is the one source.
    worktreeName: basename(worktree),
  });
  const nothingStarted = async (reason: string): Promise<number> => {
    const left = takeBack(spec, ctx.env);
    return await failed(record, left === null ? reason : `${reason}; ${left}`, ctx);
  };
  const started = callClaude(deps, spec.claude, args, spec.repo);
  if (!started.ok) return await nothingStarted(started.why);
  const { run } = started;
  const output = `${run.stdout}\n${run.stderr}`;
  if (run.timedOut) {
    return await failed(
      record,
      "claude --bg did not answer in time: a session may have started; see claude agents",
      ctx,
    );
  }
  if (refusedUntrusted(output)) {
    return await nothingStarted(
      "Workspace not trusted: open this repo once with claude and accept the trust prompt",
    );
  }
  if (run.exitCode !== 0) {
    return await nothingStarted(`claude --bg failed (exit ${run.exitCode}): ${lastLine(output)}`);
  }
  const backgrounded = parseBackgrounded(output);
  if (backgrounded === null) {
    return await failed(
      record,
      "claude --bg printed no line backgrounded · <id> · <name>: a session may have started; see claude agents",
      ctx,
    );
  }
  const { shortId } = backgrounded;
  const listed = callClaude(deps, spec.claude, ["agents", "--json", "--all"], spec.repo);
  const rows = listed.ok && listed.run.exitCode === 0 ? parseAgents(listed.run.stdout) : null;
  if (rows === null) {
    return await failed(
      record,
      `session ${shortId} started, but claude agents --json could not be read`,
      ctx,
      { shortId },
    );
  }
  const row = agentRow(rows, shortId);
  if (row === null) {
    return await failed(
      record,
      `session ${shortId} started, but claude agents does not list it`,
      ctx,
      { shortId },
    );
  }
  const sessionId = row.sessionId;
  // Where the session works is **not** judged from this read: `claude agents --json` reports the
  // folder a `--bg -w` session was launched in until it has entered its worktree (2.1.308,
  // `docs/claude-code-contract.md`), so one immediate read races the move — five crew sessions
  // were failed and stopped this way in the first live use. The crew session stays `starting`.
  // Its own SessionStart hook judges its real `cwd` (`src/hooks/crew-role.ts`), and the watch
  // fails a `starting` record whose session died (`src/crew/watch.ts`).
  let recorded = true;
  try {
    await updateCrew(
      ctx.paths.stateDir,
      spec.repo,
      record.id,
      // The time its session started, not the time it was recorded: a crew session that waited in
      // the queue has not run for the hours it waited.
      { sessionId, shortId, startedAt: new Date(ctx.now()).toISOString() },
      ctx.now(),
    );
  } catch (error) {
    // The session runs; only its record is behind. The watch reads agent view and catches up.
    recorded = false;
    ctx.error(`crew start: the store could not record the start: ${reasonOf(error)}`);
  }
  ctx.print(
    `started ${record.name} (${shortId}) · ${spec.resolved} ${spec.effort} · ${spec.branch} @ ${spec.baseSha.slice(0, 7)}`,
  );
  return recorded ? 0 : 1;
}

/** `crew start`; the exit code. */
export async function runCrewStart(args: StartArgs, ctx: CrewContext): Promise<number> {
  let planned: Plan;
  try {
    planned = await plan(args, ctx);
  } catch (error) {
    if (!(error instanceof Refusal)) throw error;
    for (const line of error.lines) ctx.error(line);
    return error.code;
  }
  const code = await startPlanned(planned, ctx);
  if (code === 0 && args.continueFrom !== null) {
    await stopContinued(planned, args, ctx);
  }
  return code;
}

/**
 * Stops the session of the crew session a continuation took over from. Its work is done (it handed
 * off), and a session holds memory (D35). **Its record stays `handoff`** — the store's own word
 * for "handed off to a next crew session, and ended" — and so do its branch and its worktree, so the
 * lead can read what it did and `crew rm` can clean it up once the lead has merged.
 */
async function stopContinued(planned: Plan, args: StartArgs, ctx: CrewContext): Promise<void> {
  const records = listCrew(ctx.paths.stateDir, planned.caller.repo).records;
  const old = records.find((one) => one.name === args.continueFrom || one.id === args.continueFrom);
  if (old === undefined || old.shortId === null) return;
  const claude = findClaude({ home: ctx.paths.home, platform: ctx.platform, which: ctx.which });
  if (claude === null) return;
  const called = callClaude(claudeDeps(ctx), claude, ["stop", old.shortId], planned.caller.repo);
  if (!called.ok || called.run.exitCode !== 0) {
    ctx.error(
      `crew start: the old crew session's Claude session was not stopped: claude stop ${old.shortId} failed`,
    );
    return;
  }
  ctx.print(`${old.name}: session stopped — it handed off; its branch and its record stay`);
}

/** The start itself: the decision, the record, the files, and the launch. */
async function startPlanned(planned: Plan, ctx: CrewContext): Promise<number> {
  const { caller, chosen, lead } = planned;
  const crew = caller.resolved.crew;
  // The 5-hour window and the opus slot's fallback: read outside the lock, as they change
  // nothing about who takes which place.
  const usage = usageFacts(ctx.paths, ctx.now());
  let decided: { record: CrewRecord; why: null | string };
  try {
    decided = await withPlacesLock(ctx.paths.stateDir, async () => {
      const all = listAllCrew(ctx.paths.stateDir).records;
      const taken = inUse(planned, all, ctx);
      if (taken !== null) throw taken;
      const unmet = unmetWaits(
        planned.waitsFor,
        all.filter((one) => one.repo === caller.repo),
      );
      const running = runningCrew(all);
      const mine = runningForLead(all, lead.sessionId);
      const input = {
        freeGb: null,
        leadRunning: mine.length,
        leadRunningOpus: onOpusTier(mine).length,
        max: crew.max.value,
        maxOpus: crew.maxOpus.value,
        needGb: crew.memoryGb.value,
        opus: chosen.real.tier === OPUS_TIER,
        opusFallback: usage.opusFallback,
        perLead: crew.perLead.value,
        perLeadOpus: crew.perLeadOpus.value,
        running: running.length,
        runningOpus: onOpusTier(running).length,
        unmet,
        usageHoldPercent: crew.usagePercent.value,
        usagePercent: usage.percent,
      };
      // The memory is read only when nothing else holds the crew session back.
      const first = placeFor(input);
      const place = first.start ? placeFor({ ...input, freeGb: await ctx.freeMemoryGb() }) : first;
      const record = await createCrew(
        ctx.paths.stateDir,
        {
          base: place.start ? { ref: planned.baseRef, sha: planned.baseSha } : null,
          baseRef: planned.baseRef,
          branch: planned.branch,
          continues: planned.continues,
          effort: chosen.effort,
          files: planned.files,
          id: `${planned.phase}-${planned.slug}-${ctx.randomSuffix()}`,
          kind: planned.kind,
          lastLine: null,
          leadName: lead.name,
          leadSessionId: lead.sessionId,
          memoryMb: null,
          model: {
            named: chosen.model,
            resolved: chosen.real.model,
            slot: chosen.slot,
            tier: chosen.real.tier,
          },
          name: planned.name,
          permissionMode: CREW_PERMISSION_MODE,
          phase: planned.phase,
          plan: lead.plan,
          pr: null,
          questions: [],
          repo: caller.repo,
          reportPath: null,
          sessionId: null,
          shortId: null,
          slug: planned.slug,
          state: place.start ? "starting" : "queued",
          waitsFor: planned.waitsFor,
          worktree: planned.worktree,
        },
        ctx.now(),
      );
      return { record, why: place.start ? null : place.why };
    });
  } catch (error) {
    if (error instanceof Refusal) {
      for (const line of error.lines) ctx.error(line);
      return error.code;
    }
    ctx.error(`crew start: ${reasonOf(error)}`);
    return 1;
  }
  const { record, why } = decided;
  try {
    writeStoreFile(
      crewBriefFile(ctx.paths.stateDir, caller.repo, record.id),
      briefText(planned.briefGiven, {
        baseRef: planned.baseRef,
        branch: planned.branch,
        files: planned.files,
        leadName: lead.name,
        crewName: record.name,
        worktree: planned.worktree,
      }),
    );
    // The crew session's own settings: who it is, and Claude Code's retry watchdog (D42), so
    // a turn waits out a limit instead of ending. The keys and their values are CC1's
    // (`src/setup/retry-watchdog.ts`), and there is no wait limit on purpose: the owner chose
    // "keep waiting", so no `…_MAX_WAIT_MS` and no `…_MAX_USAGE_LIMIT_WAIT_MS`.
    writeStoreFile(
      crewSettingsFile(ctx.paths.stateDir, caller.repo, record.id),
      `${JSON.stringify(
        {
          env: {
            [CREW_ENV]: record.id,
            [RETRY_WATCHDOG_ENV]: RETRY_WATCHDOG_VALUE,
            [RETRY_WATCHDOG_RECHECK_ENV]: String(RETRY_WATCHDOG_RECHECK_MS),
          },
        },
        null,
        2,
      )}\n`,
    );
  } catch (error) {
    return await failed(record, `its brief could not be written: ${reasonOf(error)}`, ctx);
  }
  if (why !== null) {
    ctx.print(`queued ${record.name}: ${why}`);
    return 0;
  }
  const code = await launch(specOf(planned), record, ctx);
  // D54: an opus crew session started with no window to read; one line, once, and no
  // invented number. A session that starts anyway must know the guard was not watching.
  if (code === 0 && chosen.real.tier === OPUS_TIER && usage.percent === null) {
    ctx.print(usageUnreadLine());
  }
  return code;
}

/** The launch's own facts, out of the plan. */
function specOf(planned: Plan): LaunchSpec {
  return {
    baseSha: planned.baseSha,
    branch: planned.branch,
    claude: planned.claude,
    effort: planned.chosen.effort,
    leadName: planned.lead.name,
    model: planned.chosen.model,
    repo: planned.caller.repo,
    resolved: modelText(planned.chosen.model, planned.chosen.real.model),
    worktree: planned.worktree,
  };
}

/**
 * Starts a crew session that is queued: the record is there, its worktree and its session are not.
 *
 * **The launcher's own path, never a second one.** The queued crew session keeps the model, the
 * effort and the brief its start decided (`launch` is the same function `crew start` runs);
 * only the base is resolved now, because a queued crew session is cut from its `baseRef` when it
 * starts — so a phase that waited for another starts from the merged result.
 *
 * It prints nothing: the lead's watch is the caller, and says the start, or its failure, from
 * the state event the launch writes — once. Nothing happens while there is still no place for
 * the crew session (the caps, the free memory, or a phase it waits for).
 */
export async function startQueued(
  record: CrewRecord,
  ctx: CrewContext,
  resolved: ResolvedWorkflow,
): Promise<void> {
  const quiet: CrewContext = { ...ctx, print: () => undefined };
  const crew = resolved.crew;
  const usage = usageFacts(ctx.paths, ctx.now());
  const sha = await withPlacesLock(ctx.paths.stateDir, async (): Promise<null | string> => {
    const all = listAllCrew(ctx.paths.stateDir).records;
    const here = all.filter((one) => one.repo === record.repo);
    const running = runningCrew(all);
    const mine = runningForLead(all, record.leadSessionId);
    const input = {
      freeGb: null,
      leadRunning: mine.length,
      leadRunningOpus: onOpusTier(mine).length,
      max: crew.max.value,
      maxOpus: crew.maxOpus.value,
      needGb: crew.memoryGb.value,
      opus: record.model.tier === OPUS_TIER,
      opusFallback: usage.opusFallback,
      perLead: crew.perLead.value,
      perLeadOpus: crew.perLeadOpus.value,
      running: running.length,
      runningOpus: onOpusTier(running).length,
      unmet: unmetWaits(record.waitsFor, here),
      usageHoldPercent: crew.usagePercent.value,
      usagePercent: usage.percent,
    };
    const first = placeFor(input);
    const place = first.start ? placeFor({ ...input, freeGb: await ctx.freeMemoryGb() }) : first;
    if (!place.start) return null;
    const base = commitOf(record.repo, record.baseRef, ctx.env);
    if (base === null) {
      await failed(record, `the base ${record.baseRef} is no commit here`, quiet);
      return null;
    }
    await updateCrew(
      ctx.paths.stateDir,
      record.repo,
      record.id,
      { base: { ref: record.baseRef, sha: base }, state: "starting" },
      ctx.now(),
      "started from the queue",
    );
    return base;
  });
  if (sha === null) return;
  const claude = findClaude({ home: ctx.paths.home, platform: ctx.platform, which: ctx.which });
  if (claude === null) {
    await failed(record, "claude is not on PATH, nor in ~/.local/bin", quiet);
    return;
  }
  await launch(
    {
      baseSha: sha,
      branch: record.branch,
      claude,
      effort: record.effort,
      leadName: record.leadName,
      model: record.model.named,
      repo: record.repo,
      resolved: modelText(record.model.named, record.model.resolved),
      worktree: record.worktree,
    },
    record,
    quiet,
  );
}
