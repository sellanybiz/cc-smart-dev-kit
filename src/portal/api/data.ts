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
import { jobContext } from "../actions";
import {
  configExists,
  type FallbackRow,
  projectCardData,
  projectFiles,
  type RouterFacts,
  type SwitchFacts,
  switchFacts,
} from "../facts";
import {
  healthData,
  machineData,
  overviewData,
  type PageDataDeps,
  settingsPageData,
  slotsData,
  updateFacts,
} from "../page-data";
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
      jobs: await jobsAtAGlance(deps),
      limits: [],
      limitsRead: false,
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
    jobs: await jobsAtAGlance(deps),
  };
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
      router: NO_ROUTER,
    };
  }
  return {
    ...(await healthData(deps, deps.found.config)),
    configured: true,
    error: null,
  };
}

/** `/api/machine`: the Machine page. Needs no gateway config. */
export async function machineAnswer(deps: PageDataDeps): Promise<MachineAnswer> {
  const data = await machineData(deps);
  if ("error" in deps.found && configExists(deps.action.portal)) {
    return { ...data, configError: deps.found.error };
  }
  return data;
}

/** `/api/settings`: the Settings page. Needs no gateway config. */
export function settingsAnswer(deps: PageDataDeps): SettingsAnswer {
  return settingsPageData(deps);
}

/** `/api/projects`: the project the portal runs in, and its row on the Projects page (B8). */
export function projectsAnswer(deps: PageDataDeps): ProjectsAnswer {
  const current = projectCardData(
    deps.action.portal,
    deps.action.cwd,
    deps.projectDefaults,
    deps.workflow,
  );
  return {
    current,
    note: "One project for now: the folder the portal was started in. Listing every repository arrives with the Projects page.",
    projects: [
      {
        configFile: current.root === null ? null : projectFiles(current.root).config,
        name: current.name,
        root: current.root,
        set: current.set,
      },
    ],
  };
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
