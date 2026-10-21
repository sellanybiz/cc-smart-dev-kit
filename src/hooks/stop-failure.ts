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
 * state file has a limit for it; else the freshest limit of a Claude model whose family has a
 * slot (`familySlotFor`: haiku → scout, sonnet → worker, opus → opus, fable → fable). The
 * alert offers that slot's fallback (`offerFor`): the model first, the person's own affordable
 * targets after it, and the slot's fallback switch on, so the next target answers while the
 * model is at its limit and the model answers again once it can.
 *
 * Only for a person who set the gateway up (`gateway.json` exists): someone who never
 * opted in must not notice the plugin. A background session (`CLAUDE_JOB_DIR`,
 * `background-session.ts`) shows nothing here: agent view alerts for it while the list is
 * open, and the session inherits the daemon's display, so its own alert would go to the
 * wrong place. A `gateway.json` that cannot be read still gives the
 * plain alert: it says what happened, with no action. It never blocks: the work that waits
 * (a notification with buttons that waits for a click) runs in a detached worker, started
 * through the launcher (`~/.local/bin/cc-smart-dev-kit alert-worker …`), never from the plugin's
 * version folder, which an update may delete while it waits. The hook itself exits at once.
 * Every error becomes one stderr line and exit 0.
 *
 * The alert:
 *   - Linux (`notify-send` with `--action`): "Use <target> until it resets" runs, in order,
 *     `cc-smart-dev-kit gateway slot <slot> <model>,<targets>` (when the slot needs that chain)
 *     and `cc-smart-dev-kit gateway fallback <slot> on`; "Wait" does nothing. The fallback then
 *     ends by itself: the model rests after its 429, the router asks it again, and it answers
 *     first once it can.
 *   - macOS: a plain notification that names the commands.
 *   - Windows: the same kind of alert as macOS, as a toast (`windowsToastArgv`), which names
 *     the commands; a toast with an action button needs an activation callback this hook does
 *     not have, so the action stays Linux-only.
 *
 * **No model id of the plugin's own** (owner, 2026-10-17): every target the alert names is
 * the model that hit the limit, or one the person put in their own chains.
 *   - Anything else: one stderr line.
 */

import { existsSync, readFileSync } from "node:fs";
import { COMMAND } from "../build-info/names";
import type { CliPaths } from "../cli/paths";
import { fallbackOn, type GatewayConfig, loadConfigFile } from "../gateway/config";
import {
  currentLimits,
  formatClock,
  type LimitRecord,
  type LimitState,
  parseLimitState,
} from "../gateway/limit-state";
import { settingsReport } from "../gateway/settings";
import {
  type ClaudeFamily,
  claudeFamily,
  familySlotFor,
  familySlotKey,
  JUDGE_SLOT,
  parseTarget,
  SLOT_PREFIX,
  withoutContextSuffix,
} from "../gateway/targets";
import { alertsAt, type ResolvedAlerts } from "../workflow/alerts";
import { inBackgroundSession } from "./background-session";
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

/** The CLI command the hook starts the worker with, through the launcher. Not in `--help`. */
export const ALERT_WORKER_COMMAND = "alert-worker";

/** What the alert says, and the one action it may offer. */
export interface Alert {
  /**
   * The "Use … until it resets" action: the CLI commands it runs, in order, each as its
   * arguments (`["gateway", "fallback", "opus", "on"]`); null: none.
   */
  action: null | { commands: string[][]; label: string };
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

/** The slot a Claude model's requests reach (`familySlotFor`), with the family it is for. */
interface FamilySlot {
  family: ClaudeFamily;
  /** The slot key: `cc-smart-dev-kit-opus`. */
  key: string;
  /** The slot as the CLI takes it: `opus`. */
  name: string;
}

/** The family slot of a Claude model; null for a name of no known family. */
function slotOf(model: string): FamilySlot | null {
  const found = familySlotFor(model);
  const family = claudeFamily(model);
  if (found === null || family === null) return null;
  return { family, key: found.slot, name: found.slot.slice(SLOT_PREFIX.length) };
}

/**
 * The person's own chains the alert takes stand-in targets from, in order: the worker's
 * (Sonnet's work: the person's building model), the scout's, then every other slot in the
 * config — never the judge's (a model chosen to judge safety checks), and never `own`, the
 * slot the alert is about.
 */
function standInChains(config: GatewayConfig, own: string): string[][] {
  const first = (["sonnet", "haiku"] as const)
    .map(familySlotKey)
    .filter((key): key is string => key !== null);
  const keys = [...new Set([...first, ...Object.keys(config.slots)])];
  return keys
    .filter((key) => key !== own && key !== JUDGE_SLOT && Object.hasOwn(config.slots, key))
    .map((key) => config.slots[key] ?? []);
}

/**
 * The chain the alert offers for a slot that has none yet, or only one target: `first` (the
 * slot's own target, else the model that hit the limit); then, when only that family's own
 * window ran out (a claim that ends in `_<family>`, such as `seven_day_opus`), the first
 * `claude-…` target of another family in the person's own chains, which the rest of the plan
 * still answers; then every `<backend>:<model>` target of those chains, in order, each once
 * (`standInChains`). An account-wide claim (`five_hour`, `seven_day`, or none named) stops
 * every Claude model, so no Claude model follows it. Null when the person's chains hold no
 * backend target: there is nothing affordable to offer, and the plugin names no model itself.
 */
export function suggestedTargets(
  config: GatewayConfig,
  first: string,
  slot: FamilySlot,
  claim: null | string,
): null | string[] {
  const chains = standInChains(config, slot.key).flat();
  const backends = chains.filter((text) => {
    const parsed = parseTarget(text);
    return "target" in parsed && parsed.target.kind === "backend";
  });
  if (backends.length === 0) return null;
  const modelOnly = claim?.endsWith(`_${slot.family}`) === true;
  const otherClaude = modelOnly
    ? chains.find((text) => {
        const family = claudeFamily(text);
        return text.startsWith("claude-") && family !== null && family !== slot.family;
      })
    : undefined;
  return [...new Set([first, ...(otherClaude === undefined ? [] : [otherClaude]), ...backends])];
}

/** A target as the action's label names it: `glm-5.3-flash`, `claude-sonnet-5-5`. */
function shortName(target: string): string {
  return target.slice(target.lastIndexOf("/") + 1).replace(/^[^:]*:/, "");
}

/** Commands as the person would type them: `cc-smart-dev-kit gateway … && cc-smart-dev-kit gateway …`. */
function typed(commands: string[][]): string {
  return commands.map((args) => `${COMMAND} ${args.join(" ")}`).join(" && ");
}

/** What the alert can offer for a slot at its model's limit. */
type Offer =
  /** Nothing to set: the slot already answers some other way, and the words say so. */
  | { kind: "none"; words: string }
  /** The commands that turn the fallback on, and the chain they leave in the slot. */
  | { commands: string[][]; kind: "commands"; targets: string[] }
  /** No affordable target in the person's chains: the words say what to do. */
  | { kind: "no-target"; words: string };

/**
 * What the alert offers for `slot`, whose first Claude target `model` hit the plan's limit,
 * from the person's own config (0.5.0: every slot the same way, no chain written by the
 * plugin):
 *   - the slot's chain starts with an affordable target: Claude was not the slot's first
 *     answer, so the alert only points at `gateway status`;
 *   - two targets or more, fallback on: the fallback is already set, yet the turn stopped;
 *   - two targets or more, fallback off: the person's own chain, with the switch on
 *     (`gateway fallback <slot> on`);
 *   - no chain, or one target: the chain `suggestedTargets` builds, saved with
 *     `gateway slot <slot> <targets>`, then the switch on. Both, always, in that order: the
 *     switch needs a chain, and a click may come half an hour after the alert.
 */
function offerFor(
  config: GatewayConfig,
  slot: FamilySlot,
  model: string,
  claim: null | string,
): Offer {
  const chain = config.slots[slot.key] ?? [];
  const fallback = ["gateway", "fallback", slot.name, "on"];
  const head = chain[0];
  if (head !== undefined) {
    const parsed = parseTarget(head);
    if (!("target" in parsed) || parsed.target.kind !== "anthropic") {
      return {
        kind: "none",
        words: `${slot.key} answers from ${head} first, yet this turn stopped: check ${COMMAND} gateway status.`,
      };
    }
  }
  if (chain.length > 1) {
    if (fallbackOn(config, slot.key)) {
      return {
        kind: "none",
        words: `The ${slot.key} fallback is on, yet this turn stopped: check ${COMMAND} gateway status.`,
      };
    }
    return { commands: [fallback], kind: "commands", targets: chain };
  }
  const targets = suggestedTargets(config, head ?? model, slot, claim);
  if (targets === null) {
    const shown = typed([
      ["gateway", "slot", slot.name, `${head ?? model},<backend>:<model>`],
      fallback,
    ]);
    return {
      kind: "no-target",
      words: `To use a more affordable model until it resets: ${shown} (${COMMAND} gateway models lists the models).`,
    };
  }
  return {
    commands: [["gateway", "slot", slot.name, targets.join(",")], fallback],
    kind: "commands",
    targets,
  };
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

  // The session's own model first; else the freshest limit of a model whose family has a slot.
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
  const offer = offerFor(ctx.config, slot, model, record?.claim ?? null);
  if (offer.kind !== "commands") return { action: null, body: `${head} ${offer.words}`, title };
  const shown = typed(offer.commands);
  if (!ctx.gatewayOn) {
    return {
      action: null,
      body: `${head} To use a more affordable model until it resets, turn the gateway on (${COMMAND} gateway on), then: ${shown}`,
      title,
    };
  }
  return {
    action: {
      commands: offer.commands,
      label: `Use ${shortName(offer.targets[1] ?? "")} until it resets`,
    },
    body: `${head} A more affordable model until it resets: ${shown} (Claude takes over again by itself once it answers).`,
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
 * no gateway, a short limit), the notifier shows one on its own routes instead. In a
 * background session neither alerts.
 *
 * A background session never alerts here: agent view alerts for it while the list is open,
 * and the session inherits the daemon's display, so an alert of its own would go to the wrong
 * place (`background-session.ts`).
 */
export function stopFailureWillAlert(input: unknown, deps: LimitAlertDeps): boolean {
  if (inBackgroundSession(deps.env)) return false;
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
  if (!isJsonObject(action) || typeof action.label !== "string") return null;
  const commands = action.commands;
  if (
    !Array.isArray(commands) ||
    commands.length === 0 ||
    !commands.every(
      (args: unknown) =>
        Array.isArray(args) &&
        args.length > 0 &&
        args.every((arg: unknown) => typeof arg === "string"),
    )
  ) {
    return null;
  }
  return {
    action: { commands: commands as string[][], label: action.label },
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
 * and, on Linux with an action, waits for the click. "use" runs the action's commands in
 * order through the launcher too (`launcher`, its path), so they are the installed version's
 * at click time, stops at the first that fails, then says how it went. A `notify-send` without `--action` (an old one, or no
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
      // In order, and no further once one fails: the switch needs the chain before it.
      const done = alert.action.commands.every(
        (args) => run({ argv: [launcher, ...args], timeoutMs: 60_000 }).exitCode === 0,
      );
      run({
        argv: [
          "notify-send",
          "--app-name=cc-smart-dev-kit",
          done ? "Fallback on" : "Fallback not turned on",
          done
            ? `${alert.action.label.replace(/^Use /, "Using ")}: ${COMMAND} gateway status shows it. Send a message in Claude Code to go on now.`
            : `Run it yourself to see why: ${typed(alert.action.commands)}`,
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
