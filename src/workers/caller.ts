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
 */
import { COMMAND } from "../build-info/names";
import type { SessionRecord } from "../hooks/sessions";
import type { CcSmartDevKitConfig } from "../project/config";
import { type Checkout, loadProjectConfig, locateCheckout } from "../project/resolve";
import { type ResolvedWorkflow, resolveWorkflow } from "../workflow/resolve";
import { REPORT_COMMAND } from "./brief";
import { bypassReason, settingsFilesOf } from "./bypass";
import type { WorkerContext } from "./context";
import { callingSession, workerIdOf } from "./session";

/** Who calls, once every check passed. */
export interface Caller {
  checkout: Checkout;
  config: CcSmartDevKitConfig | null;
  /** The repository: its main checkout (every worktree of it shares one store). */
  repo: string;
  resolved: ResolvedWorkflow;
  session: SessionRecord;
}

/** The caller, or the lines that refuse it (exit 1). */
export type CallerRead = { caller: Caller; ok: true } | { lines: string[]; ok: false };

/** The message of anything thrown. */
export function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Runs the shared checks for `worker <command>`. */
export function readCaller(command: "lead" | "start", ctx: WorkerContext): CallerRead {
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
      `this session is the worker ${worker}, and a worker never ${command === "lead" ? "leads" : "starts workers"}`,
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
  if (session === null) {
    return refuse(
      "no Claude Code session runs this command",
      "run it from the Bash tool of the session that leads",
    );
  }
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
  const repo = checkout.mainCheckout ?? checkout.root;
  return { caller: { checkout, config, repo, resolved, session }, ok: true };
}
