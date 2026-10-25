/**
 * What each screen shows, gathered once: the server-rendered pages and the JSON API both read
 * the same answers from here, so a page and `/api/…` can never say different things about one
 * machine. The facts themselves come from `facts.ts` and the plugin's own modules; this module
 * only assembles them per screen.
 *
 * The server keeps what changes between requests (the doctor pass it remembers, the project's
 * remembered defaults) and hands it in: this module reads, and holds nothing.
 */

import type { Check } from "../cli/doctor";
import type { GatewayConfig } from "../gateway/config";
import { historyDbExists } from "../gateway/history";
import { requestsSince } from "../gateway/history-read";
import { backendAddress } from "../gateway/settings";
import { isOlder } from "../update/check";
import type { LastCheck } from "../update/state";
import { type ActionContext, autoModeChange, jobLines, updateState } from "./actions";
import type { ProjectDefaultsReader, RouterFacts } from "./facts";
import {
  backendRows,
  browserCardData,
  type ConfigRead,
  claudeModels,
  companionRows,
  limitFacts,
  type ModelRow,
  omnirouteRow,
  type PortalFacts,
  projectCardData,
  routerFacts,
  routerLog,
  type SettingsData,
  seenClaudeModels,
  settingsData,
  slotRows,
  switchFacts,
  warpRow,
} from "./facts";
import type { HealthData, MachineData, OverviewData, OverviewRequests, SlotsData } from "./views";
import type { WorkflowAdapter } from "./workflow-adapter";

/** What every screen's data is built from: the actions' context and the server's memory. */
export interface PageDataDeps {
  action: ActionContext;
  /** The request's one config read. */
  found: ConfigRead;
  /** The last doctor pass, running one when there is none (the server's memory). */
  doctor: () => Promise<{ at: number; checks: Check[] } | null>;
  /** The frame's facts for this request (`shellFacts`, with the port the server bound). */
  facts: () => Promise<PortalFacts>;
  /** The project's remembered defaults (`server.ts`). */
  projectDefaults: ProjectDefaultsReader;
  workflow: WorkflowAdapter;
}

/** One line saying what the last background update check found, in `doctor`'s own words. */
export function summaryOf(last: null | LastCheck): string {
  if (last === null) {
    return "A new Claude session checks for a newer version by itself, at most once an hour.";
  }
  switch (last.result) {
    case "updated":
      return `The last check installed ${last.detail}. Restart the sessions to load it.`;
    case "up-to-date":
      return `${last.detail} is the newest version.`;
    case "failed":
      return `The last check failed: ${last.detail}.`;
    case "unreachable":
      return `The marketplace could not be read (${last.detail}). It counts as a failure only after 24 hours in a row.`;
    case "skipped":
      return `The last check was skipped: ${last.detail}`;
    default:
      return "A check is running now; it finishes.";
  }
}

/** The self-update's state, for the Machine page and `/api/update`. */
export function updateFacts(action: ActionContext): {
  held: null | { at: string; from: null | string; notes: string[]; version: string };
  heldSince: null | string;
  installed: null | string;
  last: LastCheck | null;
  newest: null | string;
  summary: string;
} {
  const state = updateState(action);
  return {
    held: state.held,
    heldSince: state.heldSince,
    installed: state.installed,
    last: state.last,
    newest: state.last?.result === "up-to-date" ? state.last.detail : null,
    summary: summaryOf(state.last),
  };
}

/** The project's auto-mode change, for the Machine page: null outside a project, or for none. */
export function autoModeCard(deps: PageDataDeps): MachineData["autoMode"] {
  try {
    const change = autoModeChange(deps.action);
    if (change === null) return null;
    if (change.wanted.entries.length === 0 && change.removed.length === 0) return null;
    return {
      added: change.added,
      differsFrom: change.differsFrom,
      from: change.from,
      hash: change.hash,
      removed: change.removed,
      settings: change.settings,
    };
  } catch {
    // A project setup cannot read (a broken or too-new cc-smart-dev-kit.json) is `doctor`'s
    // to report; the Machine page simply offers nothing to write.
    return null;
  }
}

/** The Machine page's data. **No gateway config is needed for any of it.** */
export async function machineData(deps: PageDataDeps): Promise<MachineData> {
  const doctor = await deps.doctor();
  const updates = updateFacts(deps.action);
  return {
    autoMode: autoModeCard(deps),
    browser: await browserCardData(deps.action.portal),
    companions: companionRows(deps.action.portal),
    doctor,
    jobs: await jobLines(deps.action),
    omniroute: await omnirouteRow(deps.action.omniroute, isOlder),
    project: await projectCardData(
      deps.action.portal,
      deps.action.cwd,
      deps.projectDefaults,
      deps.workflow,
    ),
    updates: {
      heldSince: updates.heldSince,
      installed: updates.installed,
      last: updates.last,
      newest: updates.newest,
      summary: updates.summary,
    },
    warp: await warpRow(deps.action.portal),
  };
}

/**
 * How far back the Overview's request rate looks. Its card says "last 5 min", and the rate is
 * the window's count divided by its minutes (F4).
 */
export const OVERVIEW_RATE_WINDOW_MS = 5 * 60_000;

/**
 * The Overview's model-request numbers, from the history database: the rate over the last five
 * minutes, and the count since the router started. Read through `history-read.ts`, the one home
 * for a history query (F4, F5).
 *
 * A machine with no history file has logged no request at all — a new machine, or one whose
 * history is off — so both numbers are null and the page says so, rather than showing a rate of
 * 0 as though requests were counted and simply absent. A router that does not answer has no
 * uptime to count from, so the count since its start is null too.
 */
export function overviewRequests(
  deps: PageDataDeps,
  router: RouterFacts,
  now: number,
): OverviewRequests {
  const file = deps.action.portal.paths.historyDbFile;
  if (!historyDbExists(file)) return { perMinute: null, sinceRouterStart: null };
  try {
    return {
      perMinute:
        requestsSince(file, { from: now - OVERVIEW_RATE_WINDOW_MS }) /
        (OVERVIEW_RATE_WINDOW_MS / 60_000),
      sinceRouterStart: router.up
        ? requestsSince(file, { from: now - router.uptimeSec * 1000 })
        : null,
    };
  } catch {
    // The file is there but cannot be read as a database. The history's own routes answer a
    // 500 saying so; the Overview is not worth losing over it, and its card says it has no
    // number rather than showing a zero. `doctor` is where the file's state is reported.
    return { perMinute: null, sinceRouterStart: null };
  }
}

/** The Overview's data: needs a usable gateway config. */
export async function overviewData(
  deps: PageDataDeps,
  config: GatewayConfig,
): Promise<OverviewData> {
  const ctx = deps.action.portal;
  const router = await routerFacts(ctx, config.port);
  const limits = limitFacts(ctx);
  const omniroute = config.backends.omniroute;
  const dashboard = omniroute === undefined ? null : backendAddress(omniroute.baseUrl);
  const log = await routerLog(ctx, 200);
  return {
    backends: await backendRows(ctx, config),
    dashboardUrl: dashboard === null ? null : `${dashboard}/`,
    fallbacks: limits.fallbacks,
    limits: limits.limits,
    limitsRead: limits.read,
    requests: overviewRequests(deps, router, ctx.now()),
    router,
    slots: slotRows(config, router),
    switches: switchFacts(ctx, config),
    warnings: log.lines.filter((line) => line.level !== "INFO"),
  };
}

/** The Slots page's data: the chains, the live models, and which judge targets passed. */
export async function slotsData(deps: PageDataDeps, config: GatewayConfig): Promise<SlotsData> {
  const ctx = deps.action.portal;
  const router = await routerFacts(ctx, config.port);
  const backends = await backendRows(ctx, config);
  const models: ModelRow[] = [
    ...backends.flatMap((backend) => backend.models),
    ...claudeModels(config, seenClaudeModels(ctx)).map((id) => ({
      backend: "Claude login",
      context: "the plan's",
      id,
      plan: true,
    })),
  ];
  const rows = slotRows(config, router);
  const tested: Record<string, string> = {};
  for (const row of rows) {
    for (const target of row.targets) {
      if (target.tested) tested[`${row.name}\u0000${target.target}`] = "blocked";
    }
  }
  return {
    breakers: router.breakers,
    backendNotes: backends
      .filter((backend) => backend.state !== "answers")
      .map(
        (backend) =>
          `${backend.name} could not be listed (${backend.why}). Its models are missing from the table; ${backend.url} is what the config names.`,
      ),
    chains: Object.fromEntries(rows.map((row) => [row.name, row.targets.map((t) => t.target)])),
    fallback: Object.fromEntries(rows.map((row) => [row.name, row.fallback])),
    models,
    slots: rows,
    tested,
  };
}

/** The Health page's data: needs a usable gateway config. */
export async function healthData(deps: PageDataDeps, config: GatewayConfig): Promise<HealthData> {
  const ctx = deps.action.portal;
  const router = await routerFacts(ctx, config.port);
  const limits = limitFacts(ctx);
  return {
    backends: await backendRows(ctx, config),
    fallbacks: limits.fallbacks,
    limits: limits.limits,
    log: await routerLog(ctx, 200),
    router,
  };
}

/** The Settings page's data: no gateway needed. Awaited: the project read is off the loop. */
export async function settingsPageData(deps: PageDataDeps): Promise<SettingsData> {
  return await settingsData(deps.action.portal, deps.action.cwd, deps.workflow);
}
