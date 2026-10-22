/**
 * The checks `worker lead` and `worker start` share, in the order they run, each a refusal with
 * one line and its fix (exit 1):
 *
 *   1. the caller is not a worker (`WORKER_ENV`): a worker never leads and never starts workers;
 *   2. the folder is in a git project, whose `.claude/cc-smart-dev-kit.json` reads;
 *   3. workers are on here (D34): `workflow.workers.enabled`, resolved the way `workflow show`
 *      resolves it — the project's file over the person's `workflow.json`, off by default;
 *   4. a Claude Code session runs this command (`callingSession`);
 *   5. that session is not in bypass mode (`bypassReason`).
 *
 * `worker answer` and `worker watch` run in a lead's session and share the same checks; what a
 * worker never does changes with the command (`never answers`, `never watches`).
 */
import { COMMAND } from "../build-info/names";
import type { SessionRecord } from "../hooks/sessions";
import type { CcSmartDevKitConfig } from "../project/config";
import { type Checkout, loadProjectConfig, locateCheckout } from "../project/resolve";
import { type ResolvedWorkflow, resolveWorkflow } from "../workflow/resolve";
import { REPORT_COMMAND } from "./brief";
import { bypassReason, settingsFilesOf } from "./bypass";
import type { WorkerContext } from "./context";
import { runningWorkers } from "./places";
import { callingSession, workerIdOf } from "./session";
import { listWorkers, readWorker, type WorkerRecord } from "./store";

/** Who calls, once every check passed. */
export interface Caller {
  checkout: Checkout;
  config: CcSmartDevKitConfig | null;
  /** The repository: its main checkout (every worktree of it shares one store). */
  repo: string;
  resolved: ResolvedWorkflow;
  /** The session that runs the command; null when the command may run without one. */
  session: SessionRecord | null;
}

/** The caller, or the lines that refuse it (exit 1). */
export type CallerRead = { caller: Caller; ok: true } | { lines: string[]; ok: false };

/** The message of anything thrown. */
export function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** The commands a lead runs, and what a worker never does with each. */
export const LEAD_COMMANDS = ["lead", "start", "answer", "watch"] as const;
export type LeadCommand = (typeof LEAD_COMMANDS)[number];

/** What a worker never does, per command, in the words the refusal uses. */
const NEVER_DOES: Record<LeadCommand, string> = {
  answer: "answers its lead's questions",
  lead: "leads",
  start: "starts workers",
  watch: "watches its lead's workers",
};

/** How the command reads the session that runs it. */
export interface CallerOptions {
  /**
   * What the command does when no Claude Code session runs it. `required` (the default) refuses
   * it; `optional` goes on with no session — for the commands a plugin's monitor runs, which the
   * host arms as a process of its own, not of the session.
   */
  session: "optional" | "required";
}

/** Runs the shared checks for `worker <command>`. */
export function readCaller(
  command: LeadCommand,
  ctx: WorkerContext,
  options: CallerOptions = { session: "required" },
): CallerRead {
  const refuse = (line: string, fix?: string): CallerRead => ({
    lines:
      fix === undefined
        ? [`worker ${command}: ${line}`]
        : [`worker ${command}: ${line}`, `Fix: ${fix}`],
    ok: false,
  });
  const worker = workerIdOf(ctx.env);
  if (worker !== null) {
    return refuse(
      `this session is the worker ${worker}, and a worker never ${NEVER_DOES[command]}`,
      `hand the need to your lead: ${REPORT_COMMAND} --question "<the question>" --option "<choice>" --option "<choice>"`,
    );
  }
  let checkout: Checkout | null;
  let config: CcSmartDevKitConfig | null;
  try {
    checkout = locateCheckout(ctx.cwd, { env: ctx.env });
    config = checkout === null ? null : loadProjectConfig(checkout).config;
  } catch (error) {
    return refuse(reasonOf(error));
  }
  if (checkout === null) {
    return refuse("this folder is not in a git project", "run it in the project's folder");
  }
  let resolved: ResolvedWorkflow;
  try {
    resolved = resolveWorkflow(ctx.paths, config);
  } catch (error) {
    return refuse(reasonOf(error));
  }
  if (!resolved.workers.enabled.value) {
    return refuse(
      "workers are off in this project: turn them on with workflow.workers.enabled",
      `${COMMAND} workflow set workers.enabled true --project (this project), or the same without --project (every project of yours)`,
    );
  }
  let session: SessionRecord | null;
  try {
    session = callingSession(ctx.paths.claudeConfigDir, ctx.pid, ctx.processes.parentOf);
  } catch (error) {
    return refuse(reasonOf(error));
  }
  if (session === null && options.session === "required") {
    return refuse(
      "no Claude Code session runs this command",
      "run it from the Bash tool of the session that leads",
    );
  }
  if (session !== null) {
    const bypass = bypassReason(
      ctx.processes.commandLineOf(session.pid),
      settingsFilesOf(checkout.root, ctx.paths.settingsFile),
    );
    if (bypass !== null) {
      return refuse(
        `${bypass}, and a lead there acts on every worker's message with no question`,
        "restart this session in another permission mode (auto, say)",
      );
    }
  }
  const repo = checkout.mainCheckout ?? checkout.root;
  return { caller: { checkout, config, repo, resolved, session }, ok: true };
}

/** The worker a worker session is, and the repository it works in. */
export interface WorkerSelf {
  /** The worker's own record in the store. */
  record: WorkerRecord;
  /** The repository: its main checkout (every worktree of it shares one store). */
  repo: string;
  /** The workflow settings of this project, resolved as `workflow show` resolves them. */
  resolved: ResolvedWorkflow;
}

/** The worker session, or the lines that refuse it (exit 1). */
export type WorkerSelfRead = { ok: true; self: WorkerSelf } | { lines: string[]; ok: false };

/**
 * The session that runs the command, or the lines that refuse it (exit 1). A command that needs
 * a session (one that acts as the lead) refuses without one; the watch does not, because a
 * plugin's monitor runs as a process of its own.
 */
export function requireSession(
  caller: Caller,
  command: LeadCommand,
): { ok: true; session: SessionRecord } | { ok: false; lines: string[] } {
  if (caller.session !== null) return { ok: true, session: caller.session };
  return {
    ok: false,
    lines: [
      `worker ${command}: no Claude Code session runs this command`,
      "Fix: run it from the Bash tool of the session that leads",
    ],
  };
}

/** How a command finds the worker it runs for. */
export interface SelfOptions {
  /**
   * When the environment names no worker, find it by the folder: the worker whose worktree is
   * this checkout. For the one command a plugin's monitor runs (`self-watch`), whose process
   * environment is the host's own and may not carry the settings' `env`. A step and a report run
   * from the worker's Bash tool, where the variable is proved (L1a.1), and keep to it.
   */
  byWorktree: boolean;
}

/**
 * The worker this session is: the one `CC_SMART_DEV_KIT_WORKER` names (the id the launcher put
 * in the worker's own settings), and the repository it works in (its main checkout, so every
 * worktree of it shares one store). A session that names no worker, a folder that is not in a
 * git project, and a worker the store does not know are each a refusal with one line.
 */
export function readWorkerSelf(
  ctx: WorkerContext,
  command = "worker",
  options: SelfOptions = { byWorktree: false },
): WorkerSelfRead {
  const refuse = (line: string): WorkerSelfRead => ({
    lines: [`${command}: ${line}`],
    ok: false,
  });
  const named = workerIdOf(ctx.env);
  if (named === null && !options.byWorktree) {
    return refuse(
      "this session is not a worker, and only a worker records its own steps and reports",
    );
  }
  let checkout: Checkout | null;
  try {
    checkout = locateCheckout(ctx.cwd, { env: ctx.env });
  } catch (error) {
    return refuse(reasonOf(error));
  }
  if (checkout === null) {
    return refuse("this folder is not in a git project, so the worker's repository is unknown");
  }
  const repo = checkout.mainCheckout ?? checkout.root;
  let record: WorkerRecord | null;
  try {
    if (named !== null) {
      record = readWorker(ctx.paths.stateDir, repo, named);
    } else {
      const here = runningWorkers(listWorkers(ctx.paths.stateDir, repo).records).filter(
        (one) => one.worktree === checkout.root,
      );
      record = here.length === 1 ? (here[0] ?? null) : null;
    }
  } catch (error) {
    return refuse(reasonOf(error));
  }
  if (record === null) {
    return refuse(
      named === null
        ? "this session is not a worker, and only a worker records its own steps and reports"
        : `no worker "${named}" is recorded for ${repo}`,
    );
  }
  let resolved: ResolvedWorkflow;
  try {
    resolved = resolveWorkflow(ctx.paths, loadProjectConfig(checkout).config);
  } catch (error) {
    return refuse(reasonOf(error));
  }
  return { ok: true, self: { record, repo, resolved } };
}
