/**
 * The JSON API's machine answers: Overview, Slots, Health, Machine, Settings, Projects, Update
 * and Jobs. Each one is built from the same readers the server-rendered pages use
 * (`page-data.ts`), so the two can never disagree, and each is a plain value (`types.ts`) the
 * portal UI is written against.
 *
 * Nothing here changes anything, and nothing here holds a key: the readers mask every backend
 * key and address before a value reaches this module (`.claude/rules/portal.md`).
 */

import { type JobsAnswer, jobsAnswer, readJobs } from "../../jobs/status";
import { readClaudeMemFacts } from "../../machine/claude-mem-choices";
import { jobContext } from "../actions";
import {
  bunFacts,
  type ConfigRead,
  claudeCodeFacts,
  configExists,
  type FallbackRow,
  mcpRows,
  planWindow,
  portHolder,
  type RouterFacts,
  routerFacts,
  type SwitchFacts,
  switchFacts,
} from "../facts";
import {
  healthData,
  machineData,
  overviewData,
  overviewRequests,
  type PageDataDeps,
  settingsPageData,
  slotsData,
  updateFacts,
} from "../page-data";
import type { OverviewRequests } from "../views";
import { projectsAnswerFor } from "./projects";
import type {
  ApiError,
  HealthAnswer,
  MachineAnswer,
  NotSetUp,
  OverviewAnswer,
  ProjectsAnswer,
  SettingsAnswer,
  SlotsAnswer,
  UpdateAnswer,
} from "./types";

/** The router with no config to name: nothing is probed, and no port is invented. */
const NO_ROUTER: RouterFacts = {
  breakers: {},
  cooling: [],
  fallbacks: 0,
  port: 0,
  recent: [],
  requests: 0,
  up: false,
  uptimeSec: 0,
  why: "the gateway is not set up",
};

/** Every switch off, for a machine with no gateway config. */
const NO_SWITCHES: SwitchFacts = {
  gateway: false,
  judge: false,
  judgeUntested: false,
  models: false,
  settingsBaseUrl: null,
  warnings: [],
};

/** The words a screen shows instead of a port when the gateway is not set up. */
function notSetUp(deps: PageDataDeps): NotSetUp {
  return {
    configured: false,
    error: configExists(deps.action.portal)
      ? "error" in deps.found
        ? deps.found.error
        : "the gateway config cannot be read"
      : "the gateway is not set up",
  };
}

/** The three numbers the Overview shows about the queue. */
async function jobsAtAGlance(
  deps: PageDataDeps,
): Promise<{ budgetGb: number; heldGb: number; waiting: number }> {
  try {
    const queue = jobsAnswer(await readJobs(jobContext(deps.action)));
    const heldGb = queue.stores.reduce(
      (sum, store) => sum + store.held.reduce((each, item) => each + item.gb, 0),
      0,
    );
    return {
      budgetGb: queue.budgetGb,
      heldGb: Math.round(heldGb * 10) / 10,
      waiting: queue.stores.reduce((sum, store) => sum + store.waiting.length, 0),
    };
  } catch {
    // A broken jobs.json is `job status`'s and doctor's to report; the Overview still draws.
    return { budgetGb: 0, heldGb: 0, waiting: 0 };
  }
}

/** `/api/overview`: the Overview page, and the queue at a glance. */
export async function overviewAnswer(deps: PageDataDeps): Promise<OverviewAnswer> {
  if ("error" in deps.found) {
    return {
      ...notSetUp(deps),
      backends: [],
      dashboardUrl: null,
      fallbacks: [],
      fiveHour: planWindow(deps.action.portal),
      jobs: await jobsAtAGlance(deps),
      limits: [],
      limitsRead: false,
      // The page that would show these says the gateway is not set up, so no number is read:
      // counting the history to fill a field nobody draws would be work for nothing.
      requests: { perMinute: null, sinceRouterStart: null },
      router: NO_ROUTER,
      slots: [],
      switches: NO_SWITCHES,
      warnings: [],
    };
  }
  return {
    ...(await overviewData(deps, deps.found.config)),
    configured: true,
    error: null,
    fiveHour: planWindow(deps.action.portal),
    jobs: await jobsAtAGlance(deps),
  };
}

/**
 * `/api/history/rate`: the Overview's two request numbers, on their own, so that card can read
 * again with each routed request. The whole Overview answer cannot: it asks every backend for
 * its model list, and a `recent` event fires for every ping Claude Code sends as well
 * (`portal/src/api/refresh.ts`).
 */
export async function rateAnswer(deps: PageDataDeps): Promise<OverviewRequests> {
  const router =
    "config" in deps.found
      ? await routerFacts(deps.action.portal, deps.found.config.port)
      : NO_ROUTER;
  return overviewRequests(deps, router, deps.action.portal.now());
}

/** `/api/slots`: the Slots page, and each slot's switch. */
export async function slotsAnswer(deps: PageDataDeps): Promise<SlotsAnswer> {
  if ("error" in deps.found) {
    return {
      ...notSetUp(deps),
      backendNotes: [],
      breakers: {},
      chains: {},
      fallback: {},
      models: [],
      slots: [],
      switches: NO_SWITCHES,
      tested: {},
    };
  }
  return {
    ...(await slotsData(deps, deps.found.config)),
    configured: true,
    error: null,
    switches: switchFacts(deps.action.portal, deps.found.config),
  };
}

/** `/api/health`: the Health page. */
export async function healthAnswer(deps: PageDataDeps): Promise<HealthAnswer> {
  if ("error" in deps.found) {
    return {
      ...notSetUp(deps),
      backends: [],
      fallbacks: [] as FallbackRow[],
      limits: [],
      log: { lines: [], note: null },
      portHolder: null,
      router: NO_ROUTER,
    };
  }
  return {
    ...(await healthData(deps, deps.found.config)),
    configured: true,
    error: null,
    portHolder: portHolder(deps.action.portal, deps.found.config.port),
  };
}

/**
 * Whether the gateway has its own OmniRoute key, for the OmniRoute card's key field: read from
 * the same config read as the rest of the answer, and only ever as a word.
 */
export function gatewayKeyState(
  found: ConfigRead,
  fileThere: boolean,
): MachineAnswer["gatewayKey"] {
  if ("error" in found) return fileThere ? "unreadable" : "not-set-up";
  const omniroute = Object.hasOwn(found.config.backends, "omniroute")
    ? found.config.backends.omniroute
    : undefined;
  return omniroute !== undefined && omniroute.apiKey.trim() !== "" ? "set" : "none";
}

/** `/api/machine`: the Machine page. Needs no gateway config. */
export async function machineAnswer(deps: PageDataDeps): Promise<MachineAnswer> {
  const ctx = deps.action.portal;
  const [data, claudeCode] = await Promise.all([machineData(deps), claudeCodeFacts(ctx)]);
  const answer: MachineAnswer = {
    ...data,
    bun: bunFacts(ctx),
    claudeCode,
    claudeMem: readClaudeMemFacts(ctx.paths),
    gatewayKey: gatewayKeyState(deps.found, configExists(ctx)),
    mcp: mcpRows(ctx),
  };
  if ("error" in deps.found && configExists(ctx)) {
    return { ...answer, configError: deps.found.error };
  }
  return answer;
}

/** `/api/settings`: the Settings page. Needs no gateway config. */
export function settingsAnswer(deps: PageDataDeps): SettingsAnswer {
  return settingsPageData(deps);
}

/** `/api/projects`: every project the person works in, newest use first (B8, `projects.ts`). */
export async function projectsAnswer(deps: PageDataDeps): Promise<ProjectsAnswer> {
  return await projectsAnswerFor(deps);
}

/** `/api/update`: the version, the last check, and a held major with its notes. */
export function updateAnswer(deps: PageDataDeps): UpdateAnswer {
  const facts = updateFacts(deps.action);
  return {
    held: facts.held,
    heldSince: facts.heldSince,
    installed: facts.installed,
    last: facts.last,
    newest: facts.newest,
    summary: facts.summary,
  };
}

/** `/api/jobs`: the queue, from its one reader (`src/jobs/status.ts`). */
export async function jobsAnswerFor(deps: PageDataDeps): Promise<ApiError | JobsAnswer> {
  try {
    return jobsAnswer(await readJobs(jobContext(deps.action)));
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}
