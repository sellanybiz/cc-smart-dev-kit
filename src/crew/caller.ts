/**
 * The checks `crew lead` and `crew start` share, in the order they run, each a refusal with
 * one line and its fix (exit 1):
 *
 *   1. the caller is not a crew session (`CREW_ENV`): a crew session never leads and never starts crew sessions;
 *   2. the folder is in a git project, whose `.claude/cc-smart-dev-kit.json` reads;
 *   3. crew sessions are on here (D34): `workflow.crew.enabled`, resolved the way `workflow show`
 *      resolves it — the project's file over the person's `workflow.json`, off by default;
 *   4. a Claude Code session runs this command (`callingSession`) — and a command that says
 *      the person acted through the portal (`asPerson`) has none above it;
 *   5. that session is not in bypass mode (`bypassReason`).
 *
 * `crew answer` and `crew watch` run in a lead's session and share the same checks; what a
 * crew session never does changes with the command (`never answers`, `never watches`).
 */
import { COMMAND } from "../build-info/names";
import type { SessionRecord } from "../hooks/sessions";
import type { CcSmartDevKitConfig } from "../project/config";
import { type Checkout, loadProjectConfig, locateCheckout } from "../project/resolve";
import { type ResolvedWorkflow, resolveWorkflow } from "../workflow/resolve";
import { CREW_NEVER_DOES, type LeadCommand, REPORT_COMMAND } from "./brief";
import { bypassReason, settingsFilesOf } from "./bypass";
import type { CrewContext } from "./context";
import { runningCrew } from "./places";
import { callingSession, crewIdOf } from "./session";
import { type CrewRecord, listCrew, readCrew } from "./store";

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

/**
 * The commands a lead runs, and what a crew session never does with each: one home in
 * `./brief.ts`, with the Bash judge, which denies the same commands.
 */
const NEVER_DOES = CREW_NEVER_DOES;

/** How the command reads the session that runs it. */
export interface CallerOptions {
  /**
   * True: the person acted through the portal (D52), so **no Claude Code session may run this
   * command**. The session lookup always runs: the portal's child has no session above it (the
   * portal starts detached and is reparented away from the session that started it,
   * `src/hooks/detached.ts`, `src/portal/lifecycle.ts`), and a session the lookup does find
   * refuses the flag with one line — it is the portal's, and giving it never skips a check.
   * **The crew-session refusal stays** — the portal's child clears `CC_SMART_DEV_KIT_CREW`
   * (`src/portal/cli-child.ts`), so the person's click passes it, and a crew session that gives
   * the flag itself is still refused. The workflow and project checks stay too.
   */
  asPerson?: boolean;
  /**
   * What the command does when no Claude Code session runs it. `required` (the default) refuses
   * it; `optional` goes on with no session — for the commands a plugin's monitor runs, which the
   * host arms as a process of its own, not of the session.
   */
  session: "optional" | "required";
}

/** Runs the shared checks for `crew <command>`. */
export function readCaller(
  command: LeadCommand,
  ctx: CrewContext,
  options: CallerOptions = { session: "required" },
): CallerRead {
  const refuse = (line: string, fix?: string): CallerRead => ({
    lines:
      fix === undefined
        ? [`crew ${command}: ${line}`]
        : [`crew ${command}: ${line}`, `Fix: ${fix}`],
    ok: false,
  });
  // A crew session never runs this, whoever gave the flags: a crew session's environment says
  // what it is (`CC_SMART_DEV_KIT_CREW`), and the portal's child clears it (D52).
  const crew = crewIdOf(ctx.env);
  if (crew !== null) {
    return refuse(
      `this session is the crew session ${crew}, and a crew session never ${NEVER_DOES[command]}`,
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
  if (!resolved.crew.enabled.value) {
    return refuse(
      "crew sessions are off in this project: turn them on with workflow.crew.enabled",
      `${COMMAND} workflow set crew.enabled true --project (this project), or the same without --project (every project of yours)`,
    );
  }
  // The lookup always runs, whatever the flag says: `--as-person` means "no Claude Code session
  // runs this", so a session it finds refuses the flag instead of being skipped over.
  let session: SessionRecord | null;
  try {
    session = callingSession(ctx.paths.claudeConfigDir, ctx.pid, ctx.processes.parentOf);
  } catch (error) {
    return refuse(reasonOf(error));
  }
  if (options.asPerson === true && session !== null) {
    return refuse(
      "--as-person is the portal's: a Claude Code session runs this command",
      "run it without --as-person",
    );
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
        `${bypass}, and a lead there acts on every crew session's message with no question`,
        "restart this session in another permission mode (auto, say)",
      );
    }
  }
  const repo = checkout.mainCheckout ?? checkout.root;
  return { caller: { checkout, config, repo, resolved, session }, ok: true };
}

/** The crew session a crew session is, and the repository it works in. */
export interface CrewSelf {
  /** The crew session's own record in the store. */
  record: CrewRecord;
  /** The repository: its main checkout (every worktree of it shares one store). */
  repo: string;
  /** The workflow settings of this project, resolved as `workflow show` resolves them. */
  resolved: ResolvedWorkflow;
}

/** The crew session, or the lines that refuse it (exit 1). */
export type CrewSelfRead = { ok: true; self: CrewSelf } | { lines: string[]; ok: false };

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
      `crew ${command}: no Claude Code session runs this command`,
      "Fix: run it from the Bash tool of the session that leads",
    ],
  };
}

/** How a command finds the crew session it runs for. */
export interface SelfOptions {
  /**
   * When the environment names no crew session, find it by the folder: the crew session whose worktree is
   * this checkout. For the one command a plugin's monitor runs (`self-watch`), whose process
   * environment is the host's own and may not carry the settings' `env`. A step and a report run
   * from the crew session's Bash tool, where the variable is proved (L1a.1), and keep to it.
   */
  byWorktree: boolean;
}

/**
 * The crew session this session is: the one `CC_SMART_DEV_KIT_CREW` names (the id the launcher put
 * in the crew session's own settings), and the repository it works in (its main checkout, so every
 * worktree of it shares one store). A session that names no crew session, a folder that is not in a
 * git project, and a crew session the store does not know are each a refusal with one line.
 */
export function readCrewSelf(
  ctx: CrewContext,
  command = "crew",
  options: SelfOptions = { byWorktree: false },
): CrewSelfRead {
  const refuse = (line: string): CrewSelfRead => ({
    lines: [`${command}: ${line}`],
    ok: false,
  });
  const named = crewIdOf(ctx.env);
  if (named === null && !options.byWorktree) {
    return refuse(
      "this session is not a crew session, and only a crew records its own steps and reports",
    );
  }
  let checkout: Checkout | null;
  try {
    checkout = locateCheckout(ctx.cwd, { env: ctx.env });
  } catch (error) {
    return refuse(reasonOf(error));
  }
  if (checkout === null) {
    return refuse(
      "this folder is not in a git project, so the crew session's repository is unknown",
    );
  }
  const repo = checkout.mainCheckout ?? checkout.root;
  let record: CrewRecord | null;
  try {
    if (named !== null) {
      record = readCrew(ctx.paths.stateDir, repo, named);
    } else {
      const here = runningCrew(listCrew(ctx.paths.stateDir, repo).records).filter(
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
        ? "this session is not a crew session, and only a crew records its own steps and reports"
        : `no crew session "${named}" is recorded for ${repo}`,
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
