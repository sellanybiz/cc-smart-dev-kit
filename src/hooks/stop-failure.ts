/**
 * The StopFailure hook: a desktop alert when a turn stopped at the plan's usage limit.
 *
 * Claude Code runs StopFailure instead of Stop when a turn ends on an API error, and ignores
 * the hook's output and exit code (docs/claude-code-contract.md). Its input has `error`
 * (`rate_limit` for the plan limit AND for a short rate limit) and `last_assistant_message`,
 * the error text Claude Code showed. So the limit is told apart by:
 *   - the text Claude Code 2.1.300 shows for it, "You've hit your limit · resets …" (a short
 *     rate limit says "… (not your usage limit) …"); or
 *   - the router's state file: it saw Anthropic's plan-limit answer in the last two minutes.
 * The state file also names the model, so the alert can offer that model's slot.
 *
 * Only for a person who set the gateway up (`gateway.json` exists): someone who never
 * opted in must not notice the plugin. It never blocks: the work that can wait (a
 * notification with buttons that waits for a click) runs in a detached worker process, and
 * the hook itself exits at once. Every error becomes one stderr line and exit 0.
 *
 * The alert:
 *   - Linux (`notify-send` with `--action`): "Use <model> until it resets" runs
 *     `anymodel gateway slot <opus|fable> <model>,<target>`; "Wait" does nothing. The
 *     fallback then ends by itself: the router asks Claude again and goes back once it answers.
 *   - macOS: a plain notification that names the command.
 *   - Anything else: one stderr line.
 */

import { existsSync, readFileSync } from "node:fs";
import { COMMAND } from "../build-info/names";
import type { CliPaths } from "../cli/paths";
import { type GatewayConfig, loadConfigFile } from "../gateway/config";
import {
  currentLimits,
  formatClock,
  type LimitState,
  parseLimitState,
} from "../gateway/limit-state";
import { settingsReport } from "../gateway/settings";
import { MODEL_SLOTS, parseTarget } from "../gateway/targets";

/** The words Claude Code 2.1.300 shows when a plan's usage limit stops a turn. */
const LIMIT_TEXT = /^You've hit your (?:[\w-]+ ){0,3}limit\b/;

/** The words Claude Code 2.1.300 shows for a short rate limit, which is not the plan's. */
const NOT_LIMIT_TEXT = /\(not your usage limit\)/;

/** How recent the router's plan-limit answer must be to explain this stop. */
export const STATE_FRESH_MS = 2 * 60_000;

/** What the alert says, and the one action it may offer. */
export interface Alert {
  /** The slot command's arguments, for the "Use … until it resets" action; null: none. */
  action: null | { args: string[]; label: string };
  body: string;
  title: string;
}

/** What the hook reads besides its input; a test passes its own. */
export interface AlertContext {
  config: GatewayConfig | null;
  /** True when Claude Code's settings point at the router. */
  gatewayOn: boolean;
  nowMs: number;
  state: LimitState | null;
  /** Shown times use it; undefined: the machine's. */
  timeZone?: string;
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The first `<backend>:<model>` target of the worker slot, then the scout slot. */
function cheapTarget(config: GatewayConfig): null | string {
  for (const slot of ["anymodel-worker", "anymodel-scout"]) {
    for (const text of config.slots[slot] ?? []) {
      const parsed = parseTarget(text);
      if ("target" in parsed && parsed.target.kind === "backend") return text;
    }
  }
  return null;
}

/**
 * The alert for this stop, or null when there is none to give: not a rate limit, a short
 * rate limit, or a person who never set the gateway up (`ctx.config` null and no state).
 */
export function planAlert(input: unknown, ctx: AlertContext): Alert | null {
  if (!isJsonObject(input) || input.error !== "rate_limit") return null;
  const text = typeof input.last_assistant_message === "string" ? input.last_assistant_message : "";
  const limits = ctx.state === null ? [] : currentLimits(ctx.state, ctx.nowMs);
  const latest = limits.sort(([, a], [, b]) => b.seenAt - a.seenAt)[0];
  const fresh = latest !== undefined && ctx.nowMs - latest[1].seenAt < STATE_FRESH_MS;
  // Claude Code says so in words for a short rate limit: those words win over the state.
  if (NOT_LIMIT_TEXT.test(text)) return null;
  if (!LIMIT_TEXT.test(text) && !fresh) return null;
  if (ctx.config === null) return null;

  const model = fresh ? latest[0] : null;
  const record = fresh ? latest[1] : null;
  const reset =
    record?.resetsAt !== null && record?.resetsAt !== undefined
      ? `resets ${formatClock(record.resetsAt, ctx.nowMs, ctx.timeZone)}`
      : (/resets [^(]+/.exec(text)?.[0]?.trim() ?? "no reset time known");
  const title = "Claude usage limit reached";
  const head = `${model ?? "Claude"}: ${record?.claim ?? "plan limit"}, ${reset}.`;
  const slot =
    model === null
      ? undefined
      : Object.entries(MODEL_SLOTS).find(([, family]) => model.includes(`-${family}-`));
  if (slot === undefined || model === null) {
    return {
      action: null,
      body: `${head} Claude Code continues by itself after the reset.`,
      title,
    };
  }
  const [slotKey, family] = slot;
  if (Object.hasOwn(ctx.config.modelSlots ?? {}, model)) {
    return {
      action: null,
      body: `${head} The ${slotKey} fallback is on, yet this turn stopped: check ${COMMAND} gateway status.`,
      title,
    };
  }
  const target = cheapTarget(ctx.config);
  const command = `${COMMAND} gateway slot ${family} ${model},${target ?? "<backend>:<model>"}`;
  if (target === null || !ctx.gatewayOn) {
    return {
      action: null,
      body: `${head} To use a cheaper model until it resets: ${command}`,
      title,
    };
  }
  const short = target.slice(target.lastIndexOf("/") + 1).replace(/^[^:]*:/, "");
  return {
    action: {
      args: ["gateway", "slot", family, `${model},${target}`],
      label: `Use ${short} until it resets`,
    },
    body: `${head} A cheaper model until it resets: ${command} (Claude takes over again by itself once it answers).`,
    title,
  };
}

/** What the hook reads from this machine for `planAlert`; never throws. */
export function readAlertContext(paths: CliPaths, nowMs: number): AlertContext {
  let config: GatewayConfig | null = null;
  if (existsSync(paths.gatewayConfigFile)) {
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
  return { config, gatewayOn, nowMs, state };
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

/** What the worker needs to reach the CLI. */
export interface WorkerPaths {
  bunPath: string;
  cliBundle: string;
}

/** How long the notification with buttons waits for a click. */
export const ACTION_WAIT_MS = 30 * 60_000;

/** AppleScript text in double quotes. */
function appleString(text: string): string {
  return `"${text.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

/** A plain notification, no action: its program run for this platform; null when none. */
export function plainNotification(alert: Alert, platform: string): null | Run {
  const body = alert.body;
  if (platform === "linux") {
    return { argv: ["notify-send", "--app-name=anymodel", alert.title, body], timeoutMs: 10_000 };
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
  return null;
}

/**
 * The detached worker: shows the alert and, on Linux with an action, waits for the click.
 * "use" runs the slot command through the CLI bundle, then says how it went. A
 * `notify-send` without `--action` (an old one, or no notification service) gets the plain
 * notification instead. Returns what it did, for the tests.
 */
export function runAlert(alert: Alert, platform: string, paths: WorkerPaths, run: Runner): string {
  if (platform === "linux" && alert.action !== null) {
    const asked = run({
      argv: [
        "notify-send",
        "--app-name=anymodel",
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
      const slot = run({
        argv: [paths.bunPath, paths.cliBundle, ...alert.action.args],
        timeoutMs: 60_000,
      });
      const done = slot.exitCode === 0;
      run({
        argv: [
          "notify-send",
          "--app-name=anymodel",
          done ? "Fallback on" : "Fallback not turned on",
          done
            ? `${alert.action.label.replace(/^Use /, "Using ")}: anymodel gateway status shows it.`
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
