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
import { maskKey, settingsReport } from "../gateway/settings";
import { isModelSlot, JUDGE_SLOT, MODEL_SLOTS, parseTarget } from "../gateway/targets";
import { companionChecks, companionState, companions } from "../machine/companions";
import { type OmnirouteContext, type OmnirouteFacts, omnirouteFacts } from "../omniroute/commands";
import type { PortalContext } from "./context";

/** What every page's header and footer show. */
export interface PortalFacts {
  /** The port the portal itself listens on. */
  portalPort: number;
  /** The router: its port, and whether its health page answers. */
  router: { port: number; up: boolean };
  version: string;
}

/** The port the router is meant to be on: the config's, else the default. */
export function configuredPort(config: GatewayConfig | null): number {
  return config?.port ?? DEFAULT_PORT;
}

/** The config, or why it cannot be used. Never throws: a page must still render. */
export function readConfig(ctx: PortalContext): { config: GatewayConfig } | { error: string } {
  try {
    return { config: loadConfigFile(ctx.paths.gatewayConfigFile) };
  } catch (error) {
    return { error: messageOf(error) };
  }
}

/** True when `gateway.json` is there at all: without one the gateway was never set up. */
export function configExists(ctx: PortalContext): boolean {
  try {
    readFileSync(ctx.paths.gatewayConfigFile);
    return true;
  } catch {
    return false;
  }
}

/** The shell's facts: the version, this portal's port, and whether the router answers. */
export async function shellFacts(ctx: PortalContext, portalPort: number): Promise<PortalFacts> {
  const found = readConfig(ctx);
  const port = "config" in found ? found.config.port : DEFAULT_PORT;
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
    info: "Cheap. File search, greps, reading and summaries.",
    kind: "cheap",
  },
  worker: {
    info: "Cheap. Building, doc updates, tests and mechanical runs.",
    kind: "cheap",
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

/** A backend's address as a page shows it: nothing that looks like a credential. */
export function shownBackendUrl(baseUrl: string, apiKey: string): string {
  const masked = maskKey(apiKey);
  try {
    const url = new URL(baseUrl);
    if (url.username !== "" || url.password !== "") {
      url.username = "";
      url.password = "";
    }
    return `${url.href.replace(/\/$/, "")} (key ${masked})`;
  } catch {
    return `(key ${masked})`;
  }
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

/** What the Machine page's OmniRoute card shows. */
export interface OmnirouteRow {
  backend: null | string;
  facts: OmnirouteFacts;
  /** The word for the state: `ok`, `behind`, `unknown`. */
  state: "behind" | "ok" | "unknown";
  /** The newest release's age in days, when known. */
  newestVersion: null | string;
  unit: null | string;
}

export async function omnirouteRow(
  omnirouteCtx: OmnirouteContext,
  installedIsOlder: (installed: null | string, available: null | string) => boolean,
): Promise<OmnirouteRow> {
  const facts = await omnirouteFacts(omnirouteCtx);
  const newest = facts.newest;
  return {
    backend: facts.backend === null ? null : `${facts.backend.name} → ${facts.backend.baseUrl}`,
    facts,
    newestVersion: newest?.version ?? null,
    state:
      facts.install === null || newest === null
        ? "unknown"
        : installedIsOlder(facts.install.version, newest.version)
          ? "behind"
          : "ok",
    unit: facts.unit?.name ?? null,
  };
}
