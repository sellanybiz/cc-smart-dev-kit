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
 * slot (`familySlotFor`: haiku → scout, sonnet → worker, opus → opus, fable → fable).
 *
 * **The alert says what happened and nothing else** (owner, 2026-10-25): which limit was hit and
 * when it resets. It offers no model, no chain, no fallback switch, no `gateway on`, and no
 * button that sets one — whatever the session is on (the machine's gateway, a project that is
 * off, a profile, a launch). The one thing it adds is a plain fact about the slot that answers
 * this model, when that fact explains a stop that should not have happened: the slot's chain
 * starts with a backend, or its fallback is on, yet the turn stopped (`slotFact`).
 *
 * Only for a person who set the gateway up (`gateway.json` exists): someone who never
 * opted in must not notice the plugin. A background session (`CLAUDE_JOB_DIR`,
 * `background-session.ts`) shows nothing here: agent view alerts for it while the list is
 * open, and the session inherits the daemon's display, so its own alert would go to the
 * wrong place. A `gateway.json` that cannot be read still gives the plain alert. It never
 * blocks: the entry starts the notification detached and exits at once. Every error becomes
 * one stderr line and exit 0.
 *
 * The alert is a plain notification on every platform: `notify-send` on Linux, `osascript` on
 * macOS, a toast (`windowsToastArgv`) on Windows.
 *
 * **The breaker's 429** (D42, BR2): when every target of a slot is limited or down, the
 * router holds the request and then answers a 429 whose message starts
 * `cc-smart-dev-kit-router: every target of <slot> is limited or down since …`. That is no
 * plan limit, so Claude Code never auto-continues it, and its words differ by login (under an
 * API key `Request rejected (429) · <message>`, under a subscription "Server is temporarily
 * limiting requests (not your usage limit)"). While the state file holds a fresh breaker
 * record for that slot, `breakerAlert` alerts **once per opening**, keyed on the record's
 * `since` with a mark in the state folder; a stale record gives none. It says the slot, since
 * when, and each target with why it rests; the router's own message already names the command
 * that changes the chain. The body ends with "Then send a message to go on", or "Claude Code
 * goes on by itself" when Claude Code's retry watchdog is on (`src/setup/retry-watchdog.ts`).
 *
 * **No model id of the plugin's own** (owner, 2026-10-17): the alert names the model that hit
 * the limit and the targets of the person's own chains, never another.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { COMMAND, PLUGIN } from "../build-info/names";
import type { CliPaths } from "../cli/paths";
import { fallbackOn, type GatewayConfig } from "../gateway/config";
import {
  type BreakerRecord,
  currentBreakers,
  currentLimits,
  formatClock,
  type LimitRecord,
  type LimitState,
  parseLimitState,
  stateKeyFor,
} from "../gateway/limit-state";
import { familySlotFor, parseTarget, withoutContextSuffix } from "../gateway/targets";
import { retryWatchdogState } from "../setup/retry-watchdog";
import { alertsAt, type ResolvedAlerts } from "../workflow/alerts";
import { sessionGatewayOf } from "./agent-guard";
import { inBackgroundSession } from "./background-session";
import { hasDesktop } from "./desktop-alert";
import type { Env } from "./run";
import { lastClaudeModel } from "./transcript";
import { TOAST_SHELL, windowsToastArgvFor } from "./windows-toast";

/** The words Claude Code 2.1.300 shows when a plan's usage limit stops a turn. */
const LIMIT_TEXT = /^You've hit your (?:[\w-]+ ){0,3}limit\b/;

/** The words Claude Code 2.1.300 shows for a short rate limit, which is not the plan's. */
const NOT_LIMIT_TEXT = /\(not your usage limit\)/;

/**
 * The router's own 429 when every target of a slot is limited or down (`breakerMessage`,
 * `src/gateway/breaker.ts`): its message names the slot and when the breaker opened. Claude
 * Code puts its own words around it, so it is looked for anywhere in the text, not at the
 * start: under an API key the text is `Request rejected (429) · <message>`.
 */
const BREAKER_TEXT = new RegExp(
  `${PLUGIN}-router: every target of (\\S+)(?: in profile (\\S+))? is limited or down since `,
);

/**
 * Where this hook remembers the breaker openings it alerted about, so one opening alerts
 * once: `<stateDir>/breaker-alerted.json`, `{"<slot>": <sinceMs>}`. Written by the hook, read
 * by `readAlertContext`; a file that cannot be read or written only means an alert may come
 * twice, never that one is lost.
 */
export const BREAKER_ALERT_FILE = "breaker-alerted.json";

/** How recent the router's plan-limit answer must be to explain this stop. */
export const STATE_FRESH_MS = 2 * 60_000;

/**
 * The CLI command that shows an alert in a detached worker, through the launcher. Not in
 * `--help`. The notifier starts it (`notify.ts`: the click that raises the session's window);
 * this hook shows its plain notification itself and starts no worker.
 */
export const ALERT_WORKER_COMMAND = "alert-worker";

/** What the alert says: a title and a body. It offers nothing to click or to run. */
export interface Alert {
  body: string;
  title: string;
}

/** What the hook reads besides its input; a test passes its own. */
export interface AlertContext {
  /** The alerts settings (`src/workflow/alerts.ts`): `failed` decides whether it alerts at all. */
  alerts: ResolvedAlerts;
  /** One stderr line when the alert settings could not be read; null when all read. */
  alertsProblem: null | string;
  /**
   * The breaker openings already alerted about, by slot, each the record's `since` in
   * milliseconds (`BREAKER_ALERT_FILE`). One opening then never alerts twice.
   */
  breakerAlerted: Record<string, number>;
  /**
   * The gateway config as this session sees it: a profile's view when its URL names one
   * (`sessionGatewayOf`); null when there is none, or it cannot be read. The alert reads the
   * slot that answers the model from it (`slotFact`) and nothing else.
   */
  config: GatewayConfig | null;
  /**
   * True when this session's own `ANTHROPIC_BASE_URL` points at the router. A session that is
   * off the gateway — by its project, or by its launch — is answered by no slot, so no slot
   * fact is true of it: it gets the plain line (`slotFact` is read only while this is true).
   */
  gatewayOn: boolean;
  /** True when `gateway.json` exists, readable or not: the person set the gateway up. */
  gatewaySetUp: boolean;
  nowMs: number;
  /** The session's own model: the last Claude model in its transcript; null when unknown. */
  sessionModel: null | string;
  state: LimitState | null;
  /** Shown times use it; undefined: the machine's. */
  timeZone?: string;
  /**
   * True when Claude Code's retry watchdog is on (`CLAUDE_CODE_RETRY_WATCHDOG`, set by setup
   * as `src/setup/retry-watchdog.ts`): the session then goes on by itself after a breaker 429.
   */
  watchdogOn: boolean;
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The slot key a Claude model's requests reach (`familySlotFor`); null for a name of no known family. */
function slotKeyOf(model: string): string | null {
  return familySlotFor(model)?.slot ?? null;
}

/**
 * A plain fact about the slot `slot` that answers the model at its limit, when the fact explains
 * a stop that should not have happened; null when there is none to give. The alert offers
 * nothing to change (owner, 2026-10-25): it points at `gateway status` and stops there.
 *   - the slot's chain starts with an affordable target: Claude was not the slot's first answer;
 *   - the chain holds two targets or more and its fallback is on: the fallback is set already.
 * No chain, or a chain that starts with Claude and falls back to nothing, gives no fact.
 */
function slotFact(config: GatewayConfig, slot: string): string | null {
  const chain = config.slots[slot] ?? [];
  const head = chain[0];
  if (head !== undefined) {
    const parsed = parseTarget(head);
    if (!("target" in parsed) || parsed.target.kind !== "anthropic") {
      return `${slot} answers from ${head} first, yet this turn stopped: check ${COMMAND} gateway status.`;
    }
  }
  if (chain.length > 1 && fallbackOn(config, slot)) {
    return `The ${slot} fallback is on, yet this turn stopped: check ${COMMAND} gateway status.`;
  }
  return null;
}

/** A breaker opening that explains this stop: the slot, and the state's fresh record for it. */
export interface BreakerOpening {
  /** The profile whose chain it is; null for the machine's default (`stateKeyFor`). */
  profile: null | string;
  record: BreakerRecord;
  /** The slot as the router names it: `cc-smart-dev-kit-worker`. */
  slot: string;
}

/**
 * The breaker opening this stop names, or null: not a rate-limit stop, no router 429 in its
 * words, no gateway set up, or no fresh breaker record for the slot the words name (a record
 * a stopped router left behind explains nothing). The words are looked at wherever Claude
 * Code put them: it wraps the router's message in its own for both login types.
 */
export function breakerOpening(input: unknown, ctx: AlertContext): BreakerOpening | null {
  if (!isJsonObject(input) || input.error !== "rate_limit") return null;
  if (!ctx.gatewaySetUp || ctx.state === null) return null;
  const text = typeof input.last_assistant_message === "string" ? input.last_assistant_message : "";
  const match = BREAKER_TEXT.exec(text);
  const slot = match?.[1] ?? null;
  if (slot === null) return null;
  // A profile's breaker is its own record, keyed `<profile>/<slot>` (owner D29); its 429
  // names the profile in the same message, so the record it belongs to is exact.
  const profile = match?.[2] ?? null;
  const key = stateKeyFor(slot, profile);
  const found = currentBreakers(ctx.state, ctx.nowMs).find(([name]) => name === key);
  return found === undefined ? null : { profile, record: found[1], slot };
}

/** What the alert says about a breaker record's targets: `omniroute:a HTTP 429 until 21:07`. */
function failedTargets(record: BreakerRecord, nowMs: number, timeZone?: string): string {
  return record.targets
    .map((target) => {
      const why = target.status === null ? "no answer" : `HTTP ${target.status}`;
      return `${target.target} ${why} until ${formatClock(Math.ceil(target.until / 1000), nowMs, timeZone)}`;
    })
    .join("; ");
}

/** The breaker alert, with the opening it is about: the hook records it, so it never repeats. */
export interface BreakerAlert {
  alert: Alert;
  /** The record's key in the state file: `<profile>/<slot>`, or the slot alone (`stateKeyFor`). */
  mark: string;
  /** The record's `since`, in milliseconds: what the mark keeps (`BREAKER_ALERT_FILE`). */
  since: number;
  /** The slot as the router names it. */
  slot: string;
}

/**
 * The alert for a stop on the breaker's 429, or null: no opening in the words and the state,
 * an opening already alerted about (`ctx.breakerAlerted`), or a person who asked for no alert
 * at a failed turn. It says the slot, since when, and each target with why it rests — facts
 * only (owner, 2026-10-25): the router's own message already names the command that changes the
 * chain, so the alert offers no model, no chain and no action. The last words say what happens
 * next: a message goes on now, or Claude Code's retry watchdog does.
 */
export function breakerAlert(input: unknown, ctx: AlertContext): BreakerAlert | null {
  if (!ctx.alerts.events.value.includes("failed")) return null;
  const opening = breakerOpening(input, ctx);
  if (opening === null) return null;
  const mark = stateKeyFor(opening.slot, opening.profile);
  if (ctx.breakerAlerted[mark] === opening.record.since) return null;
  const { profile, record, slot } = opening;
  const since = formatClock(Math.floor(record.since / 1000), ctx.nowMs, ctx.timeZone);
  const failures = failedTargets(record, ctx.nowMs, ctx.timeZone);
  const where = profile === null ? slot : `${slot} in profile ${profile}`;
  const head = `${where}: every target limited or down since ${since}${failures === "" ? "" : ` (${failures})`}.`;
  const goOn = ctx.watchdogOn ? "Claude Code goes on by itself." : "Then send a message to go on.";
  return {
    alert: { body: `${head} ${goOn}`, title: "Gateway slot limited" },
    mark,
    since: record.since,
    slot,
  };
}

/**
 * Remembers that this breaker opening was alerted about, so the same opening never alerts
 * twice. A file that cannot be written is one lost mark: a later stop of the same opening
 * may alert again, and nothing else changes.
 */
export function rememberBreakerAlert(
  paths: CliPaths,
  alerted: Record<string, number>,
  opening: BreakerAlert,
): void {
  try {
    mkdirSync(paths.stateDir, { recursive: true, mode: 0o700 });
    writeFileSync(
      join(paths.stateDir, BREAKER_ALERT_FILE),
      `${JSON.stringify({ ...alerted, [opening.mark]: opening.since }, null, 2)}\n`,
      { mode: 0o600 },
    );
  } catch {
    // One lost mark: an alert, never a failure of the person's turn.
  }
}

/**
 * The alert for this stop, or null when there is none to give: not a rate limit, a short
 * rate limit, the breaker's 429 (`breakerAlert` owns that), or a person who never set the
 * gateway up.
 */
export function planAlert(input: unknown, ctx: AlertContext): Alert | null {
  // `alerts.events` decides which moments alert at all: this hook's alert is the "failed"
  // one (a turn died), and with it left out the person asked for no alert here. The notifier
  // reads the same setting for its own StopFailure alert, so one stop gives none, not two.
  if (!ctx.alerts.events.value.includes("failed")) return null;
  if (!isJsonObject(input) || input.error !== "rate_limit") return null;
  const text = typeof input.last_assistant_message === "string" ? input.last_assistant_message : "";
  // The breaker's 429 is no plan limit, whatever the state file holds: its own alert owns it.
  if (BREAKER_TEXT.test(text)) return null;
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
    .filter((entry) => slotKeyOf(entry[0]) !== null && fresh(entry))
    .sort(([, a], [, b]) => b.seenAt - a.seenAt)[0];
  const chosen = own ?? slotted;
  const model = chosen?.[0] ?? null;
  const record = chosen?.[1] ?? null;
  const reset =
    record?.resetsAt !== null && record?.resetsAt !== undefined
      ? `resets ${formatClock(record.resetsAt, ctx.nowMs, ctx.timeZone)}`
      : (/resets [^(]+/.exec(text)?.[0]?.trim() ?? "no reset time known");
  const head = `${model ?? "Claude"}: ${record?.claim ?? "plan limit"}, ${reset}.`;
  // Which limit and when it resets; a slot fact only where it explains a stop that should not
  // have happened (`slotFact`), and only for a session a slot answers (`ctx.gatewayOn`). Never
  // an offer: no model, no chain, no switch, no click — whatever the session is on.
  const slot = model === null ? null : slotKeyOf(model);
  const fact =
    slot === null || ctx.config === null || !ctx.gatewayOn ? null : slotFact(ctx.config, slot);
  return {
    body: `${head} ${fact ?? "Claude Code continues by itself after the reset."}`,
    title: "Claude usage limit reached",
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
  // The session's own gateway (RF1-2): its effective `ANTHROPIC_BASE_URL`, which the hook's
  // environment carries, and a profile's chains when that URL names one. A config that cannot
  // be used is null: the alert gives no slot fact, and still says what happened.
  const { config, gatewayOn } = sessionGatewayOf(paths, env);
  let state: LimitState | null = null;
  try {
    state = parseLimitState(readFileSync(paths.gatewayStateFile, "utf8"));
  } catch {
    // No state file yet: the router never saw a limit.
    state = null;
  }
  // The retry watchdog: a value the person set counts like setup's own; a settings file that
  // cannot be read says nothing, so the alert speaks of a message instead.
  let watchdogOn = false;
  try {
    const watchdog = retryWatchdogState(paths);
    watchdogOn = watchdog === "ours" || watchdog === "yours";
  } catch {
    watchdogOn = false;
  }
  const transcript =
    isJsonObject(input) && typeof input.transcript_path === "string" ? input.transcript_path : null;
  const sessionModel = transcript === null ? null : lastClaudeModel(transcript);
  return {
    alerts: here.alerts,
    alertsProblem: here.problem,
    breakerAlerted: readBreakerAlerted(paths.stateDir),
    config,
    gatewayOn,
    gatewaySetUp,
    nowMs,
    sessionModel,
    state,
    watchdogOn,
  };
}

/** The breaker openings already alerted about (`BREAKER_ALERT_FILE`); none when it cannot be read. */
function readBreakerAlerted(stateDir: string): Record<string, number> {
  try {
    const raw: unknown = JSON.parse(readFileSync(join(stateDir, BREAKER_ALERT_FILE), "utf8"));
    if (!isJsonObject(raw)) return {};
    return Object.fromEntries(
      Object.entries(raw).filter(
        (entry): entry is [string, number] => typeof entry[1] === "number",
      ),
    );
  } catch {
    // No mark yet, or one this version does not read: every opening is new.
    return {};
  }
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
 * True when the StopFailure hook will show this stop's alert itself: a desktop to show it on,
 * a person who set the gateway up, and either a plan limit rather than a short rate limit
 * (`planAlert`) or the breaker's 429 with a fresh opener (`breakerOpening`). The notifier asks
 * this before it stays quiet for a `rate_limit` stop, so one stop never gives two alerts — and
 * where that hook has no alert to give (no desktop, no gateway, a short limit), the notifier
 * shows one on its own routes instead. In a background session neither alerts.
 *
 * A breaker stop counts even when its opening was already alerted about: this hook owns every
 * one of them, and the notifier's own "the turn failed" line must not become the second alert
 * the mark was written to prevent.
 *
 * A background session never alerts here: agent view alerts for it while the list is open,
 * and the session inherits the daemon's display, so an alert of its own would go to the wrong
 * place (`background-session.ts`).
 */
export function stopFailureWillAlert(input: unknown, deps: LimitAlertDeps): boolean {
  if (inBackgroundSession(deps.env)) return false;
  if (!limitAlertDesktop(deps.platform, deps.env, deps.which)) return false;
  const ctx = readAlertContext(deps.paths, deps.nowMs, input, deps.env);
  if (breakerOpening(input, ctx) !== null) return true;
  return planAlert(input, ctx) !== null;
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

/**
 * The alert from the worker's argument; null when it is not one. An alert an older hook wrote
 * may still carry an `action`: it is read as the plain alert it is now, with no button and no
 * command to run.
 */
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
  return { body: raw.body, title: raw.title };
}

/** AppleScript text in double quotes. */
function appleString(text: string): string {
  return `"${text.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

/**
 * The alert as a plain notification: its program run for this platform; null when none. On
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
 * Shows an alert the `alert-worker` command was handed in this hook's format (`parseAlert`): an
 * older hook, still running in a session that began before an update, starts the worker for it.
 * The hook itself shows its alert without a worker (`src/entries/stop-failure.ts`). Returns what
 * it did: `shown`, or `no notifier` when this platform has none.
 */
export function runAlert(alert: Alert, platform: string, run: Runner): string {
  const plain = plainNotification(alert, platform);
  if (plain === null) return "no notifier";
  run(plain);
  return "shown";
}
