/**
 * The StopFailure hook: a desktop alert when a turn stopped at the plan's usage limit.
 *
 * Claude Code runs StopFailure instead of Stop when a turn ends on an API error, and ignores
 * the hook's output and exit code (docs/claude-code-contract.md). Its input has `error`
 * (`rate_limit` for the plan limit AND for a short rate limit), `last_assistant_message`,
 * the error text Claude Code showed, and `transcript_path`, the session's transcript. So the
 * limit is told apart by:
 *   - the text Claude Code 2.1.300 shows for it, "You've hit your limit · resets …" (a short
 *     rate limit says "… (not your usage limit) …"); or
 *   - the router's state file: it saw Anthropic's plan-limit answer in the last two minutes.
 * Which model hit it: the session's own, the last Claude model in its transcript, when the
 * state file has a limit for it; else the freshest limit of a model that can have a model
 * slot (Opus, Fable). The alert offers that model's slot.
 *
 * Only for a person who set the gateway up (`gateway.json` exists): someone who never
 * opted in must not notice the plugin. A `gateway.json` that cannot be read still gives the
 * plain alert: it says what happened, with no action. It never blocks: the work that waits
 * (a notification with buttons that waits for a click) runs in a detached worker, started
 * through the launcher (`~/.local/bin/cc-smart-dev-kit alert-worker …`), never from the plugin's
 * version folder, which an update may delete while it waits. The hook itself exits at once.
 * Every error becomes one stderr line and exit 0.
 *
 * The alert:
 *   - Linux (`notify-send` with `--action`): "Use <target> until it resets" runs
 *     `cc-smart-dev-kit gateway slot <opus|fable> <model>,<targets>`; "Wait" does nothing. The
 *     fallback then ends by itself: the router asks Claude again and goes back once it answers.
 *   - macOS: a plain notification that names the command.
 *   - Windows: the same kind of alert as macOS, as a toast (`windowsToastArgv`), which names
 *     the command; a toast with an action button needs an activation callback this hook does
 *     not have, so the action stays Linux-only.
 *   - Anything else: one stderr line.
 */

import { existsSync, readFileSync } from "node:fs";
import { COMMAND } from "../build-info/names";
import type { CliPaths } from "../cli/paths";
import { type GatewayConfig, loadConfigFile } from "../gateway/config";
import {
  currentLimits,
  formatClock,
  type LimitRecord,
  type LimitState,
  parseLimitState,
} from "../gateway/limit-state";
import { settingsReport } from "../gateway/settings";
import { MODEL_SLOTS, parseTarget, withoutContextSuffix } from "../gateway/targets";
import { alertsAt, type ResolvedAlerts } from "../workflow/alerts";
import { hasDesktop } from "./desktop-alert";
import type { Env } from "./run";
import { lastClaudeModel } from "./transcript";
import { TOAST_SHELL, windowsToastArgvFor } from "./windows-toast";

/** The words Claude Code 2.1.300 shows when a plan's usage limit stops a turn. */
const LIMIT_TEXT = /^You've hit your (?:[\w-]+ ){0,3}limit\b/;

/** The words Claude Code 2.1.300 shows for a short rate limit, which is not the plan's. */
const NOT_LIMIT_TEXT = /\(not your usage limit\)/;

/** How recent the router's plan-limit answer must be to explain this stop. */
export const STATE_FRESH_MS = 2 * 60_000;

/**
 * The Claude model the alert offers after the model itself when only that model's own
 * window ran out (`seven_day_opus`): the rest of the plan still answers it.
 */
export const OTHER_CLAUDE = "claude-sonnet-5-5";

/** The CLI command the hook starts the worker with, through the launcher. Not in `--help`. */
export const ALERT_WORKER_COMMAND = "alert-worker";

/** What the alert says, and the one action it may offer. */
export interface Alert {
  /** The slot command's arguments, for the "Use … until it resets" action; null: none. */
  action: null | { args: string[]; label: string };
  body: string;
  title: string;
}

/** What the hook reads besides its input; a test passes its own. */
export interface AlertContext {
  /** The alerts settings (`src/workflow/alerts.ts`): `failed` decides whether it alerts at all. */
  alerts: ResolvedAlerts;
  /** One stderr line when the alert settings could not be read; null when all read. */
  alertsProblem: null | string;
  /** The gateway config; null when there is none, or it cannot be read. */
  config: GatewayConfig | null;
  /** True when `gateway.json` exists, readable or not: the person set the gateway up. */
  gatewaySetUp: boolean;
  /** True when Claude Code's settings point at the router. */
  gatewayOn: boolean;
  nowMs: number;
  /** The session's own model: the last Claude model in its transcript; null when unknown. */
  sessionModel: null | string;
  state: LimitState | null;
  /** Shown times use it; undefined: the machine's. */
  timeZone?: string;
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The model slot (`cc-smart-dev-kit-opus`) and family (`opus`) of a Claude model; null for none. */
function slotOf(model: string): null | { family: string; slot: string } {
  for (const [slot, family] of Object.entries(MODEL_SLOTS)) {
    if (model.includes(`-${family}-`)) return { family, slot };
  }
  return null;
}

/**
 * The slot targets the alert offers for `model`, the model itself first: then, when only
 * that model's own window ran out (a claim that ends in `_<family>`, such as
 * `seven_day_opus`), `OTHER_CLAUDE`, which the rest of the plan still answers; then every
 * `<backend>:<model>` target of the worker slot, in order. An account-wide claim
 * (`five_hour`, `seven_day`, or none named) stops every Claude model, so no Claude model
 * follows it. Null when the worker slot has no backend target.
 */
export function suggestedTargets(
  config: GatewayConfig,
  model: string,
  family: string,
  claim: null | string,
): null | string[] {
  const backends = (config.slots["cc-smart-dev-kit-worker"] ?? []).filter((text) => {
    const parsed = parseTarget(text);
    return "target" in parsed && parsed.target.kind === "backend";
  });
  if (backends.length === 0) return null;
  const modelOnly = claim?.endsWith(`_${family}`) === true;
  return [model, ...(modelOnly ? [OTHER_CLAUDE] : []), ...backends];
}

/** A target as the action's label names it: `glm-5.3-flash`, `claude-sonnet-5-5`. */
function shortName(target: string): string {
  return target.slice(target.lastIndexOf("/") + 1).replace(/^[^:]*:/, "");
}

/**
 * The alert for this stop, or null when there is none to give: not a rate limit, a short
 * rate limit, or a person who never set the gateway up.
 */
export function planAlert(input: unknown, ctx: AlertContext): Alert | null {
  // `alerts.events` decides which moments alert at all: this hook's alert is the "failed"
  // one (a turn died), and with it left out the person asked for no alert here. The notifier
  // reads the same setting for its own StopFailure alert, so one stop gives none, not two.
  if (!ctx.alerts.events.value.includes("failed")) return null;
  if (!isJsonObject(input) || input.error !== "rate_limit") return null;
  const text = typeof input.last_assistant_message === "string" ? input.last_assistant_message : "";
  // Claude Code says so in words for a short rate limit: those words win over the state.
  if (NOT_LIMIT_TEXT.test(text)) return null;
  const limits = ctx.state === null ? [] : currentLimits(ctx.state, ctx.nowMs);
  const fresh = ([, record]: [string, LimitRecord]) => ctx.nowMs - record.seenAt < STATE_FRESH_MS;
  if (!LIMIT_TEXT.test(text) && !limits.some(fresh)) return null;
  if (!ctx.gatewaySetUp) return null;

  // The session's own model first; else the freshest limit of a model with a model slot.
  const own =
    ctx.sessionModel === null
      ? undefined
      : limits.find(([model]) => model === withoutContextSuffix(ctx.sessionModel ?? ""));
  const slotted = limits
    .filter((entry) => slotOf(entry[0]) !== null && fresh(entry))
    .sort(([, a], [, b]) => b.seenAt - a.seenAt)[0];
  const chosen = own ?? slotted;
  const model = chosen?.[0] ?? null;
  const record = chosen?.[1] ?? null;
  const reset =
    record?.resetsAt !== null && record?.resetsAt !== undefined
      ? `resets ${formatClock(record.resetsAt, ctx.nowMs, ctx.timeZone)}`
      : (/resets [^(]+/.exec(text)?.[0]?.trim() ?? "no reset time known");
  const title = "Claude usage limit reached";
  const head = `${model ?? "Claude"}: ${record?.claim ?? "plan limit"}, ${reset}.`;
  if (ctx.config === null) {
    return {
      action: null,
      body: `${head} Claude Code continues by itself after the reset. The gateway config cannot be read, so no fallback is offered: ${COMMAND} doctor says why.`,
      title,
    };
  }
  const slot = model === null ? null : slotOf(model);
  if (slot === null || model === null) {
    return {
      action: null,
      body: `${head} Claude Code continues by itself after the reset.`,
      title,
    };
  }
  if (Object.hasOwn(ctx.config.modelSlots ?? {}, model)) {
    return {
      action: null,
      body: `${head} The ${slot.slot} fallback is on, yet this turn stopped: check ${COMMAND} gateway status.`,
      title,
    };
  }
  const targets = suggestedTargets(ctx.config, model, slot.family, record?.claim ?? null);
  const command = `${COMMAND} gateway slot ${slot.family} ${(targets ?? [model, "<backend>:<model>"]).join(",")}`;
  if (targets === null || !ctx.gatewayOn) {
    return {
      action: null,
      body: `${head} To use a more affordable model until it resets: ${command}`,
      title,
    };
  }
  return {
    action: {
      args: ["gateway", "slot", slot.family, targets.join(",")],
      label: `Use ${shortName(targets[1] ?? "")} until it resets`,
    },
    body: `${head} A more affordable model until it resets: ${command} (Claude takes over again by itself once it answers).`,
    title,
  };
}

/**
 * What the hook reads from this machine for `planAlert`; never throws. The alert settings
 * come from the folder the session is in (`alertsAt`, once per run), so a project's
 * `workflow.alerts` counts here like everywhere else.
 */
export function readAlertContext(
  paths: CliPaths,
  nowMs: number,
  input: unknown,
  env: Env = process.env,
): AlertContext {
  const cwd =
    isJsonObject(input) && typeof input.cwd === "string" && input.cwd !== "" ? input.cwd : null;
  const here = alertsAt(paths, cwd, env);
  const gatewaySetUp = existsSync(paths.gatewayConfigFile);
  let config: GatewayConfig | null = null;
  if (gatewaySetUp) {
    try {
      config = loadConfigFile(paths.gatewayConfigFile);
    } catch {
      // A config that cannot be used offers no action; the alert still says what happened.
      config = null;
    }
  }
  let state: LimitState | null = null;
  try {
    state = parseLimitState(readFileSync(paths.gatewayStateFile, "utf8"));
  } catch {
    // No state file yet: the router never saw a limit.
    state = null;
  }
  let gatewayOn = false;
  try {
    gatewayOn = settingsReport(paths.settingsFile).baseUrl !== null;
  } catch {
    gatewayOn = false;
  }
  const transcript =
    isJsonObject(input) && typeof input.transcript_path === "string" ? input.transcript_path : null;
  const sessionModel = transcript === null ? null : lastClaudeModel(transcript);
  return {
    alerts: here.alerts,
    alertsProblem: here.problem,
    config,
    gatewayOn,
    gatewaySetUp,
    nowMs,
    sessionModel,
    state,
  };
}

/** What the notifier asks about this stop: the machine both hooks run on. */
export interface LimitAlertDeps {
  env: Env;
  nowMs: number;
  paths: CliPaths;
  platform: NodeJS.Platform;
  /** Finds a program on PATH (the real one: `Bun.which` with the hook's PATH). */
  which: (command: string) => null | string;
}

/**
 * True when this machine has a desktop to show the alert on — the route the StopFailure
 * hook's own alert needs: `notify-send` with a desktop on Linux (without one it has no bus
 * to show anything on), `osascript` on macOS, the PowerShell toast on Windows. False: that
 * hook has no route here, and the alert is the notifier's.
 *
 * The Linux desktop rule is one home, `hasDesktop` (`desktop-alert.ts`): the notifier
 * decides its own route by the same one, so the two hooks can never disagree about whether
 * a desktop is there and alert twice (or not at all).
 */
export function limitAlertDesktop(
  platform: NodeJS.Platform,
  env: Env,
  which: (command: string) => null | string,
): boolean {
  if (platform === "linux") return hasDesktop(platform, env) && which("notify-send") !== null;
  if (platform === "darwin") return which("osascript") !== null;
  if (platform === "win32") return which(TOAST_SHELL) !== null;
  return false;
}

/**
 * True when the StopFailure hook will show this stop's usage-limit alert itself: a desktop to
 * show it on, a person who set the gateway up, and a plan limit rather than a short rate
 * limit (`planAlert`). The notifier asks this before it stays quiet for a `rate_limit` stop,
 * so one stop never gives two alerts — and where that hook has no alert to give (no desktop,
 * no gateway, a short limit), the notifier shows one on its own routes instead.
 */
export function stopFailureWillAlert(input: unknown, deps: LimitAlertDeps): boolean {
  if (!limitAlertDesktop(deps.platform, deps.env, deps.which)) return false;
  return planAlert(input, readAlertContext(deps.paths, deps.nowMs, input, deps.env)) !== null;
}

/** One program run: its argv and how long it may take. */
export interface Run {
  argv: string[];
  timeoutMs: number;
}

/**
 * Runs a program, exec form: its exit code (null: it did not start, or was stopped), its
 * stdout, and whether its time ran out.
 */
export type Runner = (run: Run) => { exitCode: null | number; stdout: string; timedOut: boolean };

/** The real `Runner`: `Bun.spawnSync`, stdout read, stderr dropped. */
export const spawnRunner: Runner = ({ argv, timeoutMs }) => {
  try {
    const result = Bun.spawnSync(argv, { stderr: "ignore", stdout: "pipe", timeout: timeoutMs });
    return {
      exitCode: result.exitCode,
      stdout: result.stdout.toString(),
      timedOut: result.exitedDueToTimeout === true,
    };
  } catch {
    // The program is not there (no notify-send): the caller falls back or gives up.
    return { exitCode: null, stdout: "", timedOut: false };
  }
};

/** How long the notification with buttons waits for a click. */
export const ACTION_WAIT_MS = 30 * 60_000;

/** The alert from the worker's argument; null when it is not one. */
export function parseAlert(text: string): Alert | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    // Not from the hook: nothing to show.
    return null;
  }
  if (!isJsonObject(raw) || typeof raw.title !== "string" || typeof raw.body !== "string") {
    return null;
  }
  const action = raw.action;
  if (action === null) return { action: null, body: raw.body, title: raw.title };
  if (
    !isJsonObject(action) ||
    typeof action.label !== "string" ||
    !Array.isArray(action.args) ||
    !action.args.every((arg: unknown) => typeof arg === "string")
  ) {
    return null;
  }
  return {
    action: { args: action.args as string[], label: action.label },
    body: raw.body,
    title: raw.title,
  };
}

/** AppleScript text in double quotes. */
function appleString(text: string): string {
  return `"${text.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

/**
 * A plain notification, no action: its program run for this platform; null when none. On
 * Windows the same sender the notifier and the update hook use (`windowsToastArgv`), with no
 * shell looked up first: the hook that decided this machine has a desktop route looked it
 * up already (`limitAlertDesktop`).
 */
export function plainNotification(alert: Alert, platform: string): null | Run {
  const body = alert.body;
  if (platform === "linux") {
    return {
      argv: ["notify-send", "--app-name=cc-smart-dev-kit", alert.title, body],
      timeoutMs: 10_000,
    };
  }
  if (platform === "darwin") {
    return {
      argv: [
        "osascript",
        "-e",
        `display notification ${appleString(body)} with title ${appleString(alert.title)}`,
      ],
      timeoutMs: 10_000,
    };
  }
  if (platform === "win32") {
    // The toast script waits a few seconds at most (the balloon fallback), so 10 s is room.
    return { argv: windowsToastArgvFor(alert.title, body), timeoutMs: 10_000 };
  }
  return null;
}

/**
 * True when the hook starts the detached worker for this alert: the launcher is there and the
 * platform has something the worker would do that the hook cannot.
 *
 * The worker exists for the wait — the Linux notification stays until the person clicks, and
 * it may wait half an hour, so it runs from the installed version through the launcher
 * (`src/entries/stop-failure.ts`) rather than from the plugin folder an update may delete.
 * Windows has no such wait: the alert is a plain toast, shown now (`runAlert`), and the
 * launcher there is a `.cmd` twin this POSIX-named path cannot point at
 * (docs/windows-notify.md). So on Windows the hook shows the toast itself.
 */
export function usesAlertWorker(platform: NodeJS.Platform, launcherExists: boolean): boolean {
  return platform !== "win32" && launcherExists;
}

/**
 * The detached worker (`cc-smart-dev-kit alert-worker`, run through the launcher): shows the alert
 * and, on Linux with an action, waits for the click. "use" runs the slot command through
 * the launcher too (`launcher`, its path), so it is the installed version's at click time,
 * then says how it went. A `notify-send` without `--action` (an old one, or no
 * notification service) gets the plain notification instead. Returns what it did.
 */
export function runAlert(alert: Alert, platform: string, launcher: string, run: Runner): string {
  if (platform === "linux" && alert.action !== null) {
    const asked = run({
      argv: [
        "notify-send",
        "--app-name=cc-smart-dev-kit",
        `--action=use=${alert.action.label}`,
        "--action=wait=Wait",
        alert.title,
        alert.body,
      ],
      timeoutMs: ACTION_WAIT_MS,
    });
    // Nobody clicked within the wait: the notification has done its job.
    if (asked.timedOut) return "no answer";
    if (asked.exitCode === 0) {
      if (asked.stdout.trim() !== "use") return "waited";
      const slot = run({ argv: [launcher, ...alert.action.args], timeoutMs: 60_000 });
      const done = slot.exitCode === 0;
      run({
        argv: [
          "notify-send",
          "--app-name=cc-smart-dev-kit",
          done ? "Fallback on" : "Fallback not turned on",
          done
            ? `${alert.action.label.replace(/^Use /, "Using ")}: ${COMMAND} gateway status shows it. Send a message in Claude Code to go on now.`
            : `Run it yourself to see why: ${COMMAND} ${alert.action.args.join(" ")}`,
        ],
        timeoutMs: 10_000,
      });
      return done ? "used" : "use failed";
    }
  }
  const plain = plainNotification(alert, platform);
  if (plain === null) return "no notifier";
  run(plain);
  return "shown";
}
