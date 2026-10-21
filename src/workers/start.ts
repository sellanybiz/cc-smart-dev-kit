/**
 * `cc-smart-dev-kit worker start <phase> --slug <s> --kind <kind> --brief <file|-> …`: starts one
 * worker, a background Claude Code session in its own worktree, and **returns at once** (D25):
 * one line, `started …`, `queued …` or `failed …`. Nothing here waits on the worker, polls, or
 * retries.
 *
 * In order:
 *   1. the shared checks (`readCaller`: not a worker, workers on, a Claude session, no bypass),
 *      and a lead recorded for this session in this repository (`worker lead` first);
 *   2. the brief (a file, or stdin with `-`), the model and effort — the kind's (`workerLaunch`,
 *      D21), or the person's override judged by the Agent guard's own policy (`judgeLaunch`): a
 *      launch the guard refuses is refused, and one it would ask the person about (`opus` at
 *      `max`, Fable) is refused too, because `worker start` never asks; the person starts such a
 *      session themselves;
 *   3. `claude` found, the base a commit, the branch name valid;
 *   4. under the machine-wide places lock: the name not in use (the store, the branch, the
 *      folder), then start now or queued (`placeFor`: its phases, the cap, the memory), and the
 *      record (`starting` or `queued`, one `created` event);
 *   5. its files: the brief with its frame (`brief.md`) and the settings file that names the
 *      worker to its own session (`settings.json`, `{"env":{"CC_SMART_DEV_KIT_WORKER":<id>}}`);
 *   6. a queued worker ends here. Otherwise: `git worktree add -b wk/<phase>-<slug>
 *      .claude/worktrees/wk-<phase>-<slug> <base>` in the main checkout (fast; anything slow is
 *      the worker's own first step), the `.worktreeinclude` files copied, then `claude --bg -w …`
 *      from the main checkout, the short id read from its `backgrounded` line, and ONE read of
 *      `claude agents --json --all` to see that the session works in its worktree. A session in
 *      another folder is stopped at once (it is ours: the store records it), and the worker is
 *      `failed`. When nothing started (`claude` refused, `Workspace not trusted`), the worktree
 *      and its branch are taken back, so a second try finds the name free.
 */
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { COMMAND } from "../build-info/names";
import { tildify } from "../cli/paths";
import { gatewayFactsOf, judgeLaunch } from "../hooks/agent-guard";
import { runGit, samePath } from "../hooks/git";
import {
  AFFORDABLE_EFFORT,
  answeringSlot,
  isAffordable,
  type LaunchModel,
  resolveLaunchModel,
  WORKER_KINDS,
  type WorkerKind,
  workerLaunch,
} from "../models/launch-policy";
import { copyWorktreeInclude } from "../worktrees/include";
import { briefText, firstPrompt } from "./brief";
import { type Caller, readCaller, reasonOf } from "./caller";
import {
  agentRow,
  type ClaudeDeps,
  callClaude,
  findClaude,
  launchArgs,
  parseAgents,
  parseBackgrounded,
  refusedUntrusted,
  WORKER_PERMISSION_MODE,
} from "./claude";
import type { Env, WorkerContext } from "./context";
import { workerName } from "./names";
import {
  OPUS_TIER,
  onOpusTier,
  placeFor,
  runningWorkers,
  unmetWaits,
  withPlacesLock,
} from "./places";
import { WORKER_ENV } from "./session";
import {
  createWorker,
  type LeadRecord,
  listAllWorkers,
  readLead,
  updateWorker,
  type WorkerChange,
  type WorkerRecord,
  workerBriefFile,
  workerSettingsFile,
  writeStoreFile,
} from "./store";

/** What `worker start` was asked, already checked to be well formed (`command.ts`). */
export interface StartArgs {
  phase: string;
  slug: string;
  kind: WorkerKind;
  /** A file to read the brief from, or `-` for stdin. */
  brief: string;
  base: null | string;
  files: string[];
  model: null | string;
  effort: null | string;
  waitsFor: string[];
}

/** How long one quick git call may take (a `rev-parse`, a `check-ref-format`). */
const GIT_TIMEOUT_MS = 15_000;

/**
 * How long `git worktree add` may take: a checkout of a big tree, and the repo's own
 * `post-checkout` hook (Git LFS), are seconds; this is the ceiling, not the expected time.
 */
const WORKTREE_ADD_TIMEOUT_MS = 120_000;

/** The subagent type a worker is judged as: one that builds (never a read-only one). */
const WORKER_AGENT_TYPE = "general-purpose";

/** The folder name of a worker's worktree, under `.claude/worktrees/`. */
export function worktreeName(phase: string, slug: string): string {
  return `wk-${phase}-${slug}`;
}

/** A worker's branch. */
export function workerBranch(phase: string, slug: string): string {
  return `wk/${phase}-${slug}`;
}

/** The model and effort a worker starts on, and what answers them. */
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
 * The model and effort: the kind's own, or the override (`--model`, `--effort`) — a model
 * without an effort runs at the kind's effort, or at `AFFORDABLE_EFFORT` when an affordable
 * model answers it. Either way the Agent guard's policy judges it: anything it would refuse or
 * ask the person about is refused here, with its words.
 */
export function chooseLaunch(
  kind: WorkerKind,
  override: { effort: null | string; model: null | string },
  ctx: Pick<WorkerContext, "env" | "paths">,
): Chosen | { refusal: string } {
  const gateway = gatewayFactsOf(ctx.paths);
  const own = workerLaunch(kind, gateway, ctx.env);
  const model = override.model ?? own.model;
  const real = override.model === null ? own.real : resolveLaunchModel(model, gateway, ctx.env);
  const kindEffort = isAffordable(real) ? AFFORDABLE_EFFORT : WORKER_KINDS[kind].effort;
  const effort = (
    override.effort ?? (override.model === null ? own.effort : kindEffort)
  ).toLowerCase();
  const verdict = judgeLaunch(
    { effort, fork: false, model, prompt: "", subagentType: WORKER_AGENT_TYPE, tool: "Agent" },
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
      refusal: `the agent guard asks the person before ${model} at effort ${effort} (${first}), and worker start never asks: pick a model and effort it runs with no question, or the person starts that session themselves`,
    };
  }
  return { effort, model, real, slot: answeringSlot(model, gateway, ctx.env) };
}

/** `named → resolved`, or the name alone when nothing else answers it. */
function modelText(chosen: { model: string; real: LaunchModel }): string {
  return chosen.real.model === chosen.model
    ? chosen.model
    : `${chosen.model} → ${chosen.real.model}`;
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

/** The refusal of `worker start`, with a fix line when there is one. */
function refusal(line: string, fix?: string, code: 1 | 2 = 1): Refusal {
  const lines = [`worker start: ${line}`];
  if (fix !== undefined) lines.push(`Fix: ${fix}`);
  return new Refusal(lines, code);
}

/** The brief as given: the file, or stdin with `-`. Throws a refusal when it is missing or empty. */
async function readBrief(args: StartArgs, ctx: WorkerContext): Promise<string> {
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
}

/** Steps 1–3: every check that needs no lock. Throws a `Refusal`. */
async function plan(args: StartArgs, ctx: WorkerContext): Promise<Plan> {
  const read = readCaller("start", ctx);
  if (!read.ok) throw new Refusal(read.lines, 1);
  const { caller } = read;
  let lead: LeadRecord | null;
  try {
    lead = readLead(ctx.paths.stateDir, caller.repo, caller.session.sessionId);
  } catch (error) {
    throw refusal(reasonOf(error));
  }
  if (lead === null) {
    throw refusal(
      `this session is no lead in ${tildify(caller.repo, ctx.paths.home)}`,
      `run ${COMMAND} worker lead --plan <slug> in it first`,
    );
  }
  const briefGiven = await readBrief(args, ctx);
  const chosen = chooseLaunch(args.kind, args, ctx);
  if ("refusal" in chosen) throw refusal(chosen.refusal, undefined, 2);
  const claude = findClaude({ home: ctx.paths.home, platform: ctx.platform, which: ctx.which });
  if (claude === null) {
    throw refusal(
      "claude is not on PATH, nor in ~/.local/bin",
      "install Claude Code, or put its folder on PATH",
    );
  }
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
  const branch = workerBranch(args.phase, args.slug);
  if (gitOut(caller.repo, ["check-ref-format", "--branch", branch], ctx.env) === null) {
    throw refusal(`${branch} is not a name git takes for a branch`, "pick another --slug", 2);
  }
  let name: string;
  try {
    name = workerName(lead.tag, args.phase, args.slug);
  } catch (error) {
    throw refusal(reasonOf(error), undefined, 2);
  }
  const worktree = join(caller.repo, ".claude", "worktrees", worktreeName(args.phase, args.slug));
  return { baseRef, baseSha, branch, briefGiven, caller, chosen, claude, lead, name, worktree };
}

/**
 * True when a recorded worker still holds its name: every one but a `removed` worker, and a
 * `failed` one that never got a session and left no worktree (its launch started nothing, and
 * what it made was taken back) — the record stays as history, and a second try may start.
 */
export function holdsName(record: WorkerRecord): boolean {
  if (record.state === "removed") return false;
  return !(record.state === "failed" && record.shortId === null && !existsSync(record.worktree));
}

/** Why the name is in use already, or null when it is free: the store, the branch, the folder. */
function inUse(
  planned: Plan,
  records: readonly WorkerRecord[],
  ctx: WorkerContext,
): null | Refusal {
  const { branch, caller, name, worktree } = planned;
  const recorded = records.find(
    (one) => one.repo === caller.repo && one.branch === branch && holdsName(one),
  );
  if (recorded !== undefined) {
    return refusal(
      `${recorded.name} is recorded already, ${recorded.state}, on ${branch}`,
      `remove it first (${COMMAND} worker rm "${recorded.name}"), or pick another --slug`,
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
function takeBack(planned: Plan, env: Env): null | string {
  const { baseSha, branch, caller, worktree } = planned;
  const removed = runGit(caller.repo, ["worktree", "remove", worktree], env, GIT_TIMEOUT_MS);
  // The branch goes only while it still points where it was cut: nothing was committed on it.
  const head = gitOut(
    caller.repo,
    ["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`],
    env,
  );
  const deleted =
    head === baseSha && runGit(caller.repo, ["branch", "-D", branch], env, GIT_TIMEOUT_MS).ok;
  if (removed.ok && deleted) return null;
  return `left behind: ${removed.ok ? "" : `the worktree ${worktree} `}${deleted ? "" : `the branch ${branch}`}`.trim();
}

/** Marks the worker failed with `reason`, prints its line; exit 1. */
async function failed(
  record: WorkerRecord,
  reason: string,
  ctx: WorkerContext,
  change: WorkerChange = {},
): Promise<number> {
  try {
    await updateWorker(
      ctx.paths.stateDir,
      record.repo,
      record.id,
      { ...change, state: "failed" },
      ctx.now(),
      reason,
    );
  } catch (error) {
    ctx.error(`worker start: the store could not record the failure: ${reasonOf(error)}`);
  }
  ctx.print(`failed ${record.name}: ${reason}`);
  return 1;
}

/** The last line a program printed, for a message. */
function lastLine(text: string): string {
  return text.trim().split(/\r?\n/).at(-1)?.trim() ?? "";
}

/** Step 6: the worktree, the session, the one check of where it works. */
async function launch(planned: Plan, record: WorkerRecord, ctx: WorkerContext): Promise<number> {
  const { caller, chosen, worktree } = planned;
  const added = runGit(
    caller.repo,
    ["worktree", "add", "-b", planned.branch, worktree, planned.baseSha],
    ctx.env,
    WORKTREE_ADD_TIMEOUT_MS,
  );
  if (!added.ok)
    return await failed(record, `git worktree add failed: ${lastLine(added.err)}`, ctx);
  try {
    copyWorktreeInclude(caller.repo, worktree, ctx.env);
  } catch (error) {
    ctx.error(`worker start: the .worktreeinclude files were not copied: ${reasonOf(error)}`);
  }
  const deps: ClaudeDeps = {
    env: ctx.env,
    home: ctx.paths.home,
    platform: ctx.platform,
    runProgram: ctx.runProgram,
    which: ctx.which,
  };
  const briefFile = workerBriefFile(ctx.paths.stateDir, caller.repo, record.id);
  const args = launchArgs({
    effort: chosen.effort,
    model: chosen.model,
    name: record.name,
    prompt: firstPrompt(record.name, planned.lead.name, briefFile),
    settingsFile: workerSettingsFile(ctx.paths.stateDir, caller.repo, record.id),
    worktreeName: worktreeName(record.phase, record.slug),
  });
  const nothingStarted = async (reason: string): Promise<number> => {
    const left = takeBack(planned, ctx.env);
    return await failed(record, left === null ? reason : `${reason}; ${left}`, ctx);
  };
  const started = callClaude(deps, planned.claude, args, caller.repo);
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
  const listed = callClaude(deps, planned.claude, ["agents", "--json", "--all"], caller.repo);
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
  if (row.cwd === null || !samePath(row.cwd, worktree)) {
    // It is ours (the store records it): a worker outside its worktree would edit another checkout.
    const stop = callClaude(deps, planned.claude, ["stop", shortId], caller.repo);
    const stopped = stop.ok && stop.run.exitCode === 0;
    return await failed(
      record,
      `session ${shortId} works in ${row.cwd ?? "an unknown folder"}, not in its worktree: ${stopped ? "it was stopped" : `stop it: claude stop ${shortId}`}`,
      ctx,
      { sessionId, shortId },
    );
  }
  let recorded = true;
  try {
    await updateWorker(
      ctx.paths.stateDir,
      caller.repo,
      record.id,
      { sessionId, shortId, state: "working" },
      ctx.now(),
      `started (${shortId})`,
    );
  } catch (error) {
    // The session runs; only its record is behind. The watch reads agent view and catches up.
    recorded = false;
    ctx.error(`worker start: the store could not record the start: ${reasonOf(error)}`);
  }
  ctx.print(
    `started ${record.name} (${shortId}) · ${modelText(chosen)} ${chosen.effort} · ${planned.branch} @ ${planned.baseSha.slice(0, 7)}`,
  );
  return recorded ? 0 : 1;
}

/** `worker start`; the exit code. */
export async function runWorkerStart(args: StartArgs, ctx: WorkerContext): Promise<number> {
  let planned: Plan;
  try {
    planned = await plan(args, ctx);
  } catch (error) {
    if (!(error instanceof Refusal)) throw error;
    for (const line of error.lines) ctx.error(line);
    return error.code;
  }
  const { caller, chosen, lead } = planned;
  const workers = caller.resolved.workers;
  let decided: { record: WorkerRecord; why: null | string };
  try {
    decided = await withPlacesLock(ctx.paths.stateDir, async () => {
      const all = listAllWorkers(ctx.paths.stateDir).records;
      const taken = inUse(planned, all, ctx);
      if (taken !== null) throw taken;
      const unmet = unmetWaits(
        args.waitsFor,
        all.filter((one) => one.repo === caller.repo),
      );
      const running = runningWorkers(all);
      const input = {
        freeGb: null,
        max: workers.max.value,
        maxOpus: workers.maxOpus.value,
        needGb: workers.memoryGb.value,
        opus: chosen.real.tier === OPUS_TIER,
        running: running.length,
        runningOpus: onOpusTier(running).length,
        unmet,
      };
      // The memory is read only when nothing else holds the worker back.
      const first = placeFor(input);
      const place = first.start ? placeFor({ ...input, freeGb: await ctx.freeMemoryGb() }) : first;
      const record = await createWorker(
        ctx.paths.stateDir,
        {
          base: place.start ? { ref: planned.baseRef, sha: planned.baseSha } : null,
          baseRef: planned.baseRef,
          branch: planned.branch,
          effort: chosen.effort,
          files: args.files,
          id: `${args.phase}-${args.slug}-${ctx.randomSuffix()}`,
          kind: args.kind,
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
          permissionMode: WORKER_PERMISSION_MODE,
          phase: args.phase,
          plan: lead.plan,
          pr: null,
          questions: [],
          repo: caller.repo,
          reportPath: null,
          sessionId: null,
          shortId: null,
          slug: args.slug,
          state: place.start ? "starting" : "queued",
          waitsFor: args.waitsFor,
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
    ctx.error(`worker start: ${reasonOf(error)}`);
    return 1;
  }
  const { record, why } = decided;
  try {
    writeStoreFile(
      workerBriefFile(ctx.paths.stateDir, caller.repo, record.id),
      briefText(planned.briefGiven, {
        baseRef: planned.baseRef,
        branch: planned.branch,
        files: args.files,
        leadName: lead.name,
        workerName: record.name,
        worktree: planned.worktree,
      }),
    );
    writeStoreFile(
      workerSettingsFile(ctx.paths.stateDir, caller.repo, record.id),
      `${JSON.stringify({ env: { [WORKER_ENV]: record.id } }, null, 2)}\n`,
    );
  } catch (error) {
    return await failed(record, `its brief could not be written: ${reasonOf(error)}`, ctx);
  }
  if (why !== null) {
    ctx.print(`queued ${record.name}: ${why}`);
    return 0;
  }
  return await launch(planned, record, ctx);
}
