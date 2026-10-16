/**
 * What each page shows: the machine's real facts, read through the plugin's own modules.
 *
 * Nothing here changes anything. Every read is the same read the CLI makes — the config
 * through `loadConfigFile`, the health page through `routerHealth`, the models through
 * `listModels`, the state file through `parseLimitState` — so a page can never disagree with
 * `cc-smart-dev-kit gateway status` about the same machine.
 *
 * Some numbers a page would like are not here, and are not invented:
 *
 *   - **Plan usage percentages.** Claude Code computes them from the headers of its own
 *     answers and hands them to the status line on stdin (`src/cli/statusline.ts`); nothing
 *     writes them down. The router records only the limits it saw (which model, which
 *     window, when it resets), and that is what the page shows.
 *   - **Prices and image support.** They are in OmniRoute's own catalog, which the gateway
 *     never reads: `/v1/models` carries an id and a context length, and that is all.
 */

import { readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { VERSION } from "../build-info";
import { listModels } from "../gateway/backends";
import {
  DEFAULT_PORT,
  type GatewayConfig,
  judgeTargetTested,
  loadConfigFile,
  messageOf,
} from "../gateway/config";
import { routerHealth } from "../gateway/health";
import {
  currentFallbacks,
  currentLimits,
  type FallbackRecord,
  formatClock,
  type LimitRecord,
  parseLimitState,
} from "../gateway/limit-state";
import { UNIT_NAME } from "../gateway/service";
import { settingsReport, shownBackendUrl } from "../gateway/settings";
import { isModelSlot, JUDGE_SLOT, MODEL_SLOTS, parseTarget } from "../gateway/targets";
import { companionChecks, companionState, companions } from "../machine/companions";
import { detectSystem, detectWarpApp, warpCheck } from "../machine/warp";
import { type OmnirouteContext, omnirouteFacts } from "../omniroute/commands";
import type { GlobalInstall } from "../omniroute/install";
import type { CcSmartDevKitConfig } from "../project/config";
import { resolveProject } from "../project/resolve";
import type { PortalContext } from "./context";
import { type SettingsRow, settingsRows } from "./settings";
import type {
  Env,
  ProjectInitAnswers,
  ProjectInitDefaults,
  ProjectInitPlan,
  ResolvedWorkflow,
  WorkflowAdapter,
} from "./workflow-adapter";

/** What every page's header and footer show. */
export interface PortalFacts {
  /** The port the portal itself listens on. */
  portalPort: number;
  /**
   * The router: its port, and whether its health page answers. **Null** when there is no
   * gateway config to name one (never set up, or unreadable): the Machine page and the
   * privacy page draw without it, and a page that needs it says so instead of showing a port.
   */
  router: null | { port: number; up: boolean };
  version: string;
}

/** The port the router is meant to be on: the config's, else the default. */
export function configuredPort(config: GatewayConfig | null): number {
  return config?.port ?? DEFAULT_PORT;
}

/** What `readConfig` answered: the config, or why it cannot be used. */
export type ConfigRead = { config: GatewayConfig } | { error: string };

/**
 * The config, or why it cannot be used. Never throws: a page must still render. Read once per
 * request (`server.ts`): the shell's facts and the page both take that one answer, so a
 * config that changes in between cannot draw a page saying two things at once.
 */
export function readConfig(ctx: PortalContext): ConfigRead {
  try {
    return { config: loadConfigFile(ctx.paths.gatewayConfigFile) };
  } catch (error) {
    return { error: messageOf(error) };
  }
}

/**
 * True when `gateway.json` is there at all: only `ENOENT` means the gateway was never set
 * up. A file that is there but cannot be read (mode 000, a folder) is a problem to fix, and
 * its own error is shown instead of a page that says nothing is set up.
 */
export function configExists(ctx: PortalContext): boolean {
  try {
    readFileSync(ctx.paths.gatewayConfigFile);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== "ENOENT";
  }
}

/**
 * The shell's facts: the version, this portal's port, and whether the router answers. `found`
 * is the request's one config read (`readConfig`); the page is drawn from the same answer.
 */
export async function shellFacts(
  ctx: PortalContext,
  portalPort: number,
  found: ConfigRead,
): Promise<PortalFacts> {
  // No config to read: no port names a router, so no page claims one (and nothing is probed).
  if ("error" in found) return { portalPort, router: null, version: VERSION };
  const port = found.config.port;
  const health = await routerHealth(port, ctx.probe.fetch);
  return { portalPort, router: { port, up: !("error" in health) }, version: VERSION };
}

// ── The router's health page ────────────────────────────────────────────────────

/** The router's own answer, as the pages read it. */
export interface RouterFacts {
  /** Seconds it has been up. */
  cooling: [string, number][];
  fallbacks: number;
  limited: [string, number][];
  port: number;
  requests: number;
  up: boolean;
  uptimeSec: number;
  /** Why it is down, when it is. */
  why: null | string;
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function entriesOf(value: unknown): [string, number][] {
  if (!isJsonObject(value)) return [];
  return Object.entries(value)
    .filter((entry): entry is [string, number] => typeof entry[1] === "number")
    .sort(([a], [b]) => (a < b ? -1 : 1));
}

export async function routerFacts(ctx: PortalContext, port: number): Promise<RouterFacts> {
  const health = await routerHealth(port, ctx.probe.fetch);
  if ("error" in health) {
    return {
      cooling: [],
      fallbacks: 0,
      limited: [],
      port,
      requests: 0,
      up: false,
      uptimeSec: 0,
      why: health.error,
    };
  }
  const body = isJsonObject(health.body) ? health.body : {};
  const number = (key: string): number => (typeof body[key] === "number" ? body[key] : 0);
  return {
    cooling: entriesOf(body.cooling),
    fallbacks: number("fallbacks"),
    limited: entriesOf(body.limited),
    port: typeof body.port === "number" ? body.port : port,
    requests: number("requests"),
    up: true,
    uptimeSec: number("uptimeSec"),
    why: null,
  };
}

// ── The router's log, through journald ──────────────────────────────────────────

export interface LogLine {
  level: "ERROR" | "INFO" | "WARN";
  /** The router's own words, without its level word. */
  text: string;
  /** `13:52:07`, or the whole line's time when it is not today. */
  time: string;
}

/** The level word a router line starts with. */
export function levelOf(line: string): LogLine["level"] {
  if (line.startsWith("WARN ")) return "WARN";
  if (line.startsWith("ERROR ")) return "ERROR";
  return "INFO";
}

/** A journal line's message and time; null when it is not a line this reads. */
export function parseJournalLine(text: string, nowMs: number): LogLine | null {
  const trimmed = text.trim();
  if (trimmed === "") return null;
  if (trimmed.startsWith("{")) {
    let raw: unknown;
    try {
      raw = JSON.parse(trimmed);
    } catch {
      return null;
    }
    if (!isJsonObject(raw)) return null;
    const message = typeof raw.MESSAGE === "string" ? raw.MESSAGE : null;
    if (message === null) return null;
    const micros =
      typeof raw.__REALTIME_TIMESTAMP === "string" ? Number(raw.__REALTIME_TIMESTAMP) : NaN;
    const at = Number.isFinite(micros) ? micros / 1000 : nowMs;
    return { level: levelOf(message), text: leadingTimeOff(message), time: clockOf(at, nowMs) };
  }
  // `-o short-iso` and a terminal's own output: `2026-10-16T13:52:07+0400 host unit[1]: …`
  const match =
    /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?\s+(.*)$/.exec(trimmed);
  if (match === null) return null;
  const rest = match[2] ?? "";
  const message = rest.slice(rest.indexOf(": ") + 2);
  const at = Date.parse(rest);
  return {
    level: levelOf(message),
    text: leadingTimeOff(message),
    time: clockOf(Number.isNaN(at) ? nowMs : at, nowMs),
  };
}

/** The router's request lines start with their own ISO time; the column already shows it. */
function leadingTimeOff(message: string): string {
  return message.replace(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z?\s+/, "");
}

function clockOf(ms: number, nowMs: number): string {
  return formatClock(Math.floor(ms / 1000), nowMs);
}

/**
 * The router's recent log lines, newest last. `journalctl --user` only: the router runs as a
 * user unit. A machine without journald, or with no unit yet, gets no lines and a note.
 */
export function routerLog(
  ctx: PortalContext,
  count: number,
): { lines: LogLine[]; note: null | string } {
  if (!ctx.systemd) return { lines: [], note: "no systemd here, so there is no journal to read" };
  const result = ctx.runner([
    "journalctl",
    "--user",
    "-u",
    UNIT_NAME,
    "-n",
    String(count),
    "--no-pager",
    "-o",
    "json",
  ]);
  if (result.exitCode !== 0) {
    const why = (result.output.trim().split("\n").at(-1) ?? "").trim();
    return {
      lines: [],
      note: `the journal could not be read${why === "" ? "" : ` (${why})`}. In a terminal: journalctl --user -u ${UNIT_NAME.replace(/\.service$/, "")} -f`,
    };
  }
  const nowMs = ctx.now();
  const lines = result.output
    .split("\n")
    .map((line) => parseJournalLine(line, nowMs))
    .filter((line): line is LogLine => line !== null);
  return { lines, note: null };
}

// ── Slots ───────────────────────────────────────────────────────────────────────

export interface SlotTarget {
  /** The target as the config spells it. */
  target: string;
  /** `Claude login`, or the backend's name. */
  from: string;
  /** Seconds it is resting for, or null. */
  restingFor: null | number;
  /**
   * True only for a judge target that passed the force-push test. Every other target is
   * `false`: the Slots page shows "Not tested yet" until the person runs the test there, and
   * the router's own model list is not a test.
   */
  tested: boolean;
}

export interface SlotRow {
  /** The words the page shows instead of the slot key's prefix. */
  info: string;
  key: string;
  kind: string;
  name: string;
  note: string;
  targets: SlotTarget[];
}

/** The words each slot kind gets, the same ones the Slots page shows. */
const SLOT_META: Readonly<Record<string, { info: string; kind: string }>> = {
  fable: {
    info: "claude-fable-5-1 answers first. The next target answers only when Anthropic refuses at the plan limit, until the reset.",
    kind: "model",
  },
  judge: {
    info: "Claude judges auto mode's safety check whenever Claude can answer. This chain answers only at the plan limit or with no Claude login, and only while the judge switch is on.",
    kind: "off by default",
  },
  opus: {
    info: "claude-opus-5-5 answers first. The next target answers only when Anthropic refuses at the plan limit, until the reset.",
    kind: "model",
  },
  scout: {
    info: "Affordable. File search, greps, reading and summaries.",
    kind: "affordable",
  },
  worker: {
    info: "Affordable. Building, doc updates, tests and mechanical runs.",
    kind: "affordable",
  },
};

/** A slot key's short name: `cc-smart-dev-kit-scout` → `scout`. */
export function slotName(key: string): string {
  return key.replace(/^cc-smart-dev-kit-/, "");
}

/** The five slots the pages list, in the mockups' order. */
export const SLOT_ORDER = ["scout", "worker", JUDGE_SLOT, ...Object.keys(MODEL_SLOTS)] as const;

/** Every slot, with what the config holds for it, in the page's order. */
export function slotRows(config: GatewayConfig, router: RouterFacts): SlotRow[] {
  const resting = new Map<string, number>(router.cooling);
  const keys = [
    ...["scout", "worker", JUDGE_SLOT, ...Object.keys(MODEL_SLOTS)].map(
      (name) => `cc-smart-dev-kit-${slotName(name)}`,
    ),
    ...Object.keys(config.slots).filter(
      (key) => !SLOT_ORDER.some((name) => key === `cc-smart-dev-kit-${slotName(name)}`),
    ),
  ];
  const rows: SlotRow[] = [];
  for (const key of [...new Set(keys)]) {
    const name = slotName(key);
    const meta = SLOT_META[name] ?? { info: "A slot of this machine's own.", kind: "other" };
    const targets = config.slots[key];
    const on =
      targets !== undefined &&
      (!isModelSlot(key) || Object.values(config.modelSlots ?? {}).includes(key));
    rows.push({
      info: meta.info,
      key,
      kind: on ? meta.kind : "off",
      name,
      note: slotNote(config, key, on),
      targets: (targets ?? []).map((target) => {
        const parsed = parseTarget(target);
        const known = "target" in parsed ? parsed.target : null;
        return {
          from: known === null ? "?" : known.kind === "anthropic" ? "Claude login" : known.backend,
          restingFor: resting.get(target) ?? null,
          target,
          tested: key === JUDGE_SLOT && judgeTargetTested(config, target),
        };
      }),
    });
  }
  return rows;
}

/** The CLI's own note for a slot, in the same words (`printSlots`). */
function slotNote(config: GatewayConfig, key: string, on: boolean): string {
  if (!on) {
    return isModelSlot(key)
      ? `off: ${MODEL_SLOTS[key] ?? key} goes to Anthropic unchanged`
      : "off: auto mode's safety checks go to Claude, and to no one else";
  }
  if (key === JUDGE_SLOT) {
    const untested = (config.slots[key] ?? []).filter(
      (target) => !judgeTargetTested(config, target),
    );
    return untested.length > 0
      ? `NOT TESTED, so ignored: ${untested.join(", ")}`
      : "only when Claude cannot answer a check";
  }
  if (isModelSlot(key)) return "the rest only at the plan's usage limit";
  return "";
}

// ── The live model list ─────────────────────────────────────────────────────────

export interface ModelRow {
  backend: string;
  /** `128K`, or `—` when the backend does not say. */
  context: string;
  id: string;
  /** True for a `claude-…` model: it runs on the person's own login. */
  plan: boolean;
}

/** `128000` → `128K`. */
export function contextText(length: null | number): string {
  if (length === null) return "—";
  return length >= 1000 ? `${Math.round(length / 1000)}K` : String(length);
}

/** Every `claude-…` name the config mentions: the model slots' keys, and every target. */
export function claudeModels(config: GatewayConfig): string[] {
  const found = new Set<string>(Object.keys(config.modelSlots ?? {}));
  for (const targets of Object.values(config.slots)) {
    for (const target of targets) {
      const parsed = parseTarget(target);
      if ("target" in parsed && parsed.target.kind === "anthropic") found.add(parsed.target.model);
    }
  }
  return [...found].sort();
}

export interface BackendRow {
  /** Milliseconds its `/v1/models` took, or null when it did not answer. */
  ms: null | number;
  models: ModelRow[];
  name: string;
  /** `✓ answering`, `✗ <why>`, or `not listed`. */
  state: "answers" | "failed" | "unlisted";
  url: string;
  why: null | string;
}

/** Each backend's model list, timed, with its key masked and never sent to a page. */
export async function backendRows(
  ctx: PortalContext,
  config: GatewayConfig,
): Promise<BackendRow[]> {
  const rows: BackendRow[] = [];
  for (const [name, backend] of Object.entries(config.backends).sort(([a], [b]) =>
    a < b ? -1 : 1,
  )) {
    const started = ctx.now();
    const listed = await listModels(backend.baseUrl, backend.apiKey, 8_000);
    const ms = ctx.now() - started;
    const url = shownBackendUrl(backend.baseUrl, backend.apiKey);
    if ("error" in listed) {
      rows.push({ models: [], ms: null, name, state: "failed", url, why: listed.error });
      continue;
    }
    if (listed.status !== 200) {
      rows.push({
        models: [],
        ms: null,
        name,
        state: "failed",
        url,
        why: `HTTP ${listed.status}`,
      });
      continue;
    }
    rows.push({
      models: listed.models
        .map((model) => ({
          backend: name,
          context: contextText(model.contextLength),
          id: `${name}:${model.id}`,
          plan: false,
        }))
        .sort((a, b) => a.id.localeCompare(b.id)),
      ms,
      name,
      state: "answers",
      url,
      why: null,
    });
  }
  return rows;
}

// ── Switches ────────────────────────────────────────────────────────────────────

export interface SwitchFacts {
  /** The `opus` and `fable` fallback chains are set. */
  fallback: boolean;
  /** `ANTHROPIC_BASE_URL` is in Claude Code's settings. */
  gateway: boolean;
  /** The judge slot is set, and every target passed the force-push test. */
  judge: boolean;
  /** The judge slot is set but a target has not passed: it judges nothing. */
  judgeUntested: boolean;
  /** The port the settings point at, when they point anywhere. */
  settingsBaseUrl: null | string;
  /** Env keys someone else set that would replace the login or pin every subagent. */
  warnings: string[];
}

/** Which model slots are on: `modelSlots` names a slot and the slot is in the config. */
export function modelSlotsOn(config: GatewayConfig): string[] {
  return Object.values(config.modelSlots ?? {}).filter((slot) => Object.hasOwn(config.slots, slot));
}

export function switchFacts(ctx: PortalContext, config: GatewayConfig): SwitchFacts {
  const report = settingsReport(ctx.paths.settingsFile);
  // The two the CLI itself warns about (`printOverrides`), in the same words.
  const warnings: string[] = [];
  if (report.subagentOverrides.length > 0) {
    warnings.push(
      `${report.subagentOverrides.join(", ")} set: every agent launched without a model runs on it, with the gateway possibly an affordable slot. Remove it by hand unless you want that.`,
    );
  }
  if (report.loginOverrides.length > 0) {
    warnings.push(
      `${report.loginOverrides.join(", ")} set: that replaces your own Claude login. Remove it for the gateway.`,
    );
  }
  const judgeTargets = config.slots[JUDGE_SLOT] ?? [];
  return {
    fallback: modelSlotsOn(config).length > 0,
    gateway: report.baseUrl !== null,
    judge:
      judgeTargets.length > 0 && judgeTargets.every((target) => judgeTargetTested(config, target)),
    judgeUntested: judgeTargets.some((target) => !judgeTargetTested(config, target)),
    settingsBaseUrl: report.baseUrl,
    warnings,
  };
}

// ── Plan limits ─────────────────────────────────────────────────────────────────

export interface LimitRow {
  /** The window that ran out (`five_hour`, `seven_day`, `seven_day_opus`), in words. */
  claim: string;
  model: string;
  /** `13:00`, or null when Anthropic named no reset. */
  resets: null | string;
}

export interface FallbackRow {
  /** The slot answering from a fallback. */
  slot: string;
  model: string;
  target: string;
  /** When its fallback started, as a clock time. */
  since: string;
}

/** The plan-limit words of a claim, the same the status line uses. */
export function claimText(claim: null | string): string {
  switch (claim) {
    case "five_hour":
      return "the 5-hour window";
    case "seven_day":
      return "the 7-day window";
    case "seven_day_opus":
      return "the 7-day Opus window";
    case "seven_day_sonnet":
      return "the 7-day Sonnet window";
    default:
      return claim ?? "its window";
  }
}

/** The plan limits the router last saw, and the slots answering from a fallback now. */
export function limitFacts(ctx: PortalContext): {
  fallbacks: FallbackRow[];
  limits: LimitRow[];
  read: boolean;
} {
  let text: string | null = null;
  try {
    text = readFileSync(ctx.paths.gatewayStateFile, "utf8");
  } catch {
    text = null;
  }
  const state = text === null ? null : parseLimitState(text);
  if (state === null) return { fallbacks: [], limits: [], read: false };
  const nowMs = ctx.now();
  return {
    fallbacks: currentFallbacks(state, nowMs).map(([slot, record]: [string, FallbackRecord]) => ({
      model: record.model,
      since: formatClock(Math.floor(record.since / 1000), nowMs),
      slot,
      target: record.target,
    })),
    limits: currentLimits(state, nowMs).map(([model, record]: [string, LimitRecord]) => ({
      claim: claimText(record.claim),
      model,
      resets: record.resetsAt === null ? null : formatClock(record.resetsAt, nowMs),
    })),
    read: true,
  };
}

// ── Machine: updates, jobs, companions, doctor, OmniRoute ───────────────────────

export interface CompanionRow {
  /** The command that fixes it, and what to copy; null when there is nothing to fix. */
  command: null | string;
  detail: string;
  id: string;
  /** `ok`, `off`, `missing`, `outside`, `unknown`. */
  state: string;
  /** What to run for `claude plugin …`, when the portal may run it itself. */
  enableArgv: null | string[];
  title: string;
}

/** One row per companion plugin, with the words `doctor` uses for its state. */
export function companionRows(ctx: PortalContext): CompanionRow[] {
  return companions().map((companion) => {
    const check = companionChecks(ctx.paths, [companion])[0];
    const state = companionState(ctx.paths, companion);
    const enableArgv = state.kind === "off" ? ["claude", "plugin", "enable", companion.id] : null;
    return {
      command: enableArgv === null ? null : enableArgv.join(" "),
      // `doctor`'s own line: what is wrong and the command that fixes it, never a second wording.
      detail: check?.text ?? `${companion.id} ${state.kind}`,
      enableArgv,
      id: companion.id,
      state: state.kind,
      title: companion.name,
    };
  });
}

/**
 * What the Machine page's OmniRoute card shows. It is built from `OmnirouteFacts`, never the
 * facts object itself: that one holds the backend's **key**, and nothing that reaches a page
 * — not a view, not a line, not a JSON answer — may hold one.
 */
export interface OmnirouteRow {
  /** The backend as a line: its name, then its address with the key masked. */
  backend: null | string;
  install: GlobalInstall | null;
  /** The newest release's version, when the registry could be read. */
  newestVersion: null | string;
  /** The version the last update replaced, for the card's own line. */
  previous: null | { at: string; version: string };
  /** Why the registry could not be read, in words. */
  registryError: null | string;
  /** The word for the state: `ok`, `behind`, `unknown`. */
  state: "behind" | "ok" | "unknown";
  unit: null | string;
}

/**
 * What the Machine page's Warp card shows. Warp is optional, and installing or removing it
 * needs `sudo`: the card shows the two commands to copy, and the page never runs them.
 */
export interface WarpRow {
  /** Doctor's own line for it: what is installed, and which command to run. */
  detail: string;
  /** True when the Warp app is here. */
  installed: boolean;
}

export function warpRow(ctx: PortalContext): WarpRow {
  const system = detectSystem(ctx.machine);
  return {
    detail: warpCheck(ctx.machine, ctx.paths).text,
    installed: detectWarpApp(ctx.machine, system).installed,
  };
}

// ── The project: the Settings page, and the card on Machine ─────────────────────

/**
 * The project the portal's folder is in, as both screens read it — through the plugin's own
 * `resolveProject`, so the portal and every hook agree about one repo. Never throws: a folder
 * outside git, a project file that will not parse, and a version the plugin does not meet all
 * come back as one line in words, and the screens draw without it.
 */
export interface ProjectRead {
  /** The project's file, parsed; null when there is none (or it cannot be read). */
  config: CcSmartDevKitConfig | null;
  /** The file it came from; null when there is none. */
  configFile: null | string;
  /** The repo root: `<root>/.claude/` holds the two files the Project card writes. */
  root: null | string;
  /** Why there is no usable project, in words; null when there is one, or none is needed. */
  why: null | string;
}

export function readProject(ctx: PortalContext, cwd: string): ProjectRead {
  try {
    const project = resolveProject(cwd, { env: ctx.env });
    if (project === null) {
      return {
        config: null,
        configFile: null,
        root: null,
        why: "this folder is not inside a git project",
      };
    }
    return {
      config: project.config,
      configFile: project.configFile,
      root: project.root,
      why: project.config === null ? "this project has no .claude/cc-smart-dev-kit.json yet" : null,
    };
  } catch (error) {
    // Git older than 2.31, a main checkout that moved, or a cc-smart-dev-kit.json that is
    // broken or needs a newer plugin: doctor's to report, and a line here.
    return {
      config: null,
      configFile: null,
      root: null,
      why: messageOf(error),
    };
  }
}

/** The project's own name, as the Project card shows it: the root folder's name. */
export function projectName(root: string): string {
  return basename(root);
}

/** A file's text, or null when it is not there (or cannot be read). */
function readTextFile(file: string): null | string {
  try {
    return readFileSync(file, "utf8");
  } catch {
    // Not there, or not readable: both are "no file" to a plan that writes it.
    return null;
  }
}

/** Where the two files of a project live: `<root>/.claude/`. */
export function projectFiles(root: string): { config: string; settings: string } {
  return {
    config: join(root, ".claude", "cc-smart-dev-kit.json"),
    settings: join(root, ".claude", "settings.json"),
  };
}

/** Both files as they are now: what a plan is made against, read at the moment it is made. */
export function projectFileTexts(root: string): {
  existing: null | string;
  existingSettings: null | string;
} {
  const files = projectFiles(root);
  return {
    existing: readTextFile(files.config),
    existingSettings: readTextFile(files.settings),
  };
}

/**
 * The line under the Project card's settings preview: what the engine's lines do to the file.
 * One home — the page draws it and the preview's answer carries it (`project.preview`), so
 * the sentence can never describe a different plan than the boxes beside it.
 */
export function settingsLineNote(hookLines: number): string {
  if (hookLines === 0) return "No line is added to .claude/settings.json.";
  return `${hookLines} line${hookLines === 1 ? "" : "s"}, added inside the existing file. Nothing else there changes.`;
}

/** The Project card's own data: the form's answers, and the plan they would write. */
export interface ProjectCardData {
  /** The form's first answers; null when there is nothing to fill it with. */
  answers: ProjectInitAnswers | null;
  /** Why the project cannot be read at all: a notice instead of the form. */
  error: null | string;
  /** The folder's own name, when there is a project folder. */
  name: null | string;
  /** The plan the answers would write, the moment the page is drawn; null when it cannot be made. */
  plan: ProjectInitPlan | null;
  /** Why the preview cannot be built; null when it can. */
  planError: null | string;
  /** The repo root the two files go in; null when the folder is not in a git project. */
  root: null | string;
  /** True: `.claude/cc-smart-dev-kit.json` is there. */
  set: boolean;
}

/**
 * The project's own defaults, as the card and the actions read them. `detectFacts` runs git
 * and, when `gh` is on PATH, GitHub itself, so the server hands in the remembered reader
 * (`server.ts`) instead of calling the module for every form change.
 */
export type ProjectDefaultsReader = (input: { env: Env; root: string }) => ProjectInitDefaults;

/**
 * The card's facts, read through the workflow adapter: the CLI's own detection for the form's
 * defaults, and the same pure plan the write will make. A project that cannot be read — no
 * git, a broken file — is one line in words and no form.
 */
export function projectCardData(
  ctx: PortalContext,
  cwd: string,
  readDefaults: ProjectDefaultsReader,
  workflow: WorkflowAdapter,
): ProjectCardData {
  const base: ProjectCardData = {
    answers: null,
    error: null,
    name: null,
    plan: null,
    planError: null,
    root: null,
    set: false,
  };
  const project = readProject(ctx, cwd);
  if (project.root === null) return { ...base, error: project.why };
  // The root is there: a missing file is the card's "not set up" state, never an error. A file
  // that is there but cannot be read is `readProject`'s own line, above.
  const texts = projectFileTexts(project.root);
  const head: ProjectCardData = {
    ...base,
    name: projectName(project.root),
    root: project.root,
    set: project.config !== null,
  };
  try {
    // The defaults are the CLI's own detection over the project's file; the plan is then made
    // against the same file text this page read, so the preview and the answers agree.
    const defaults = readDefaults({ env: ctx.env, root: project.root });
    return {
      ...head,
      answers: defaults.answers,
      plan: workflow.planProjectInit({
        answers: defaults.answers,
        existing: texts.existing,
        existingSettings: texts.existingSettings,
        root: project.root,
      }),
    };
  } catch (error) {
    return { ...head, planError: messageOf(error) };
  }
}

/** The Settings page's own data: every row, its value, and where that value came from. */
export interface SettingsData {
  /**
   * The auto-merge row's own line, computed with the module's own rule: `null` when the value
   * is off (nothing would merge), else whether a pull request into this project's base may be
   * merged by itself, and the base's name.
   */
  autoMerge: null | { allowed: boolean; base: null | string };
  /** Why the values cannot be resolved (a broken file of the person's own, no module): a notice. */
  error: null | string;
  /** What to know about the project, when its own file cannot be read; null otherwise. */
  projectNote: null | string;
  rows: SettingsRow[];
}

/**
 * Every row of the Settings page. The values come from the module's own `resolveWorkflow`, so
 * the page and `cc-smart-dev-kit workflow show` can never disagree; a file of the person's own
 * that is broken is a notice — never a row showing a default it does not have.
 */
export function settingsData(
  ctx: PortalContext,
  cwd: string,
  workflow: WorkflowAdapter,
): SettingsData {
  const empty = (why: string | null): SettingsData => ({
    autoMerge: null,
    error: why,
    projectNote: null,
    rows: [],
  });
  const project = readProject(ctx, cwd);
  // Named whether there is no project at all or its file cannot be read: a row may not show
  // `default` for a value the project really sets, and a broken file must not read as silence.
  const projectNote = project.why === null ? null : `No project's own values here: ${project.why}.`;
  let resolved: ResolvedWorkflow;
  try {
    resolved = workflow.resolveWorkflow(ctx.paths, project.config);
  } catch (error) {
    return { ...empty(messageOf(error)), projectNote };
  }
  const rows = settingsRows(resolved, { projectFile: project.configFile !== null });
  const base = project.config?.worktrees?.base ?? null;
  const autoMerge = resolved.autoMerge.value
    ? {
        allowed:
          base !== null &&
          project.root !== null &&
          workflow.autoMergeAllowed(
            resolved,
            project.config,
            base,
            workflow.repositoryDefaultBranch(project.root, ctx.env),
          ),
        base,
      }
    : null;
  return { autoMerge, error: null, projectNote, rows };
}

export async function omnirouteRow(
  omnirouteCtx: OmnirouteContext,
  installedIsOlder: (installed: null | string, available: null | string) => boolean,
): Promise<OmnirouteRow> {
  const facts = await omnirouteFacts(omnirouteCtx);
  const newest = facts.newest;
  const backend = facts.backend;
  return {
    // `shownBackendUrl`, like every other address on a page: it masks the key.
    backend:
      backend === null
        ? null
        : `${backend.name} → ${shownBackendUrl(backend.baseUrl, backend.apiKey)}`,
    install: facts.install,
    newestVersion: newest?.version ?? null,
    previous: facts.state.previous,
    registryError: facts.registryError,
    state:
      facts.install === null || newest === null
        ? "unknown"
        : installedIsOlder(facts.install.version, newest.version)
          ? "behind"
          : "ok",
    unit: facts.unit?.name ?? null,
  };
}
