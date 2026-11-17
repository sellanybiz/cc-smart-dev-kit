/**
 * The portal's one data client. Every page reads through `PortalClient`; which one answers is
 * chosen in one place, `portalClient()`:
 *
 * - **live** (the page the kit's server serves): `GET /api/…` on the same origin, the actions
 *   as `POST /api/<action>` with the page's CSRF value, and the live stream `GET /events`
 *   (`stream.ts`). Each answer goes through `adapt.ts` into the shape its page draws.
 * - **mock**: `?mock=<state>` in the address, or `next dev` (no server behind it). It answers
 *   in the same shapes from `mock.ts`, sends nothing, and the header says "Mock data". The
 *   `?mock=` words show each page's other states: `loading`, `error`, `empty`, `no-gateway`,
 *   `reconnecting`.
 */

import * as adapt from "./adapt";
import { csrfToken, type Fetch, getJson, PortalRequestError, postAction } from "./http";
import { mockData } from "./mock";
import { mockTaskDetail } from "./mock-tasks";
import { type LiveMessage, type LiveStream, startLiveStream } from "./stream";
import type {
  Connection,
  FlowReport,
  FlowWindow,
  GuardAsksPage,
  GuardQuery,
  HealthData,
  History,
  HistoryKeys,
  HistoryQuery,
  JobsData,
  MachineData,
  OverviewData,
  OverviewRequests,
  PortalFacts,
  ProjectData,
  ProjectGatewayData,
  ProjectList,
  ProjectTasksData,
  ProjectWorkflowData,
  RequestPage,
  RequestQuery,
  SettingsData,
  SlotsData,
  TaskDetailAnswer,
  TasksData,
  UpdateData,
  WorkData,
  WorktreesData,
} from "./types";
import type * as Wire from "./wire";
import type { ActionName, ActionResult } from "./wire";

export type { ActionName, ActionResult };
export { csrfToken };

export interface PortalClient {
  /** `live` or `mock`: the header marks a page drawn from mock data. */
  kind: "live" | "mock";
  facts(): Promise<PortalFacts>;
  overview(): Promise<OverviewData>;
  history(query: HistoryQuery): Promise<History>;
  historyKeys(): Promise<HistoryKeys>;
  /** The Overview's request numbers, read again with each routed request. */
  historyRate(): Promise<OverviewRequests>;
  requests(query: RequestQuery): Promise<RequestPage>;
  work(): Promise<WorkData>;
  flow(window: FlowWindow): Promise<FlowReport>;
  slots(): Promise<SlotsData>;
  health(): Promise<HealthData>;
  machine(): Promise<MachineData>;
  settings(): Promise<SettingsData>;
  projects(): Promise<ProjectList>;
  project(id: string): Promise<ProjectData>;
  /** A project's Gateway card (GP4b): its own state, what its sessions get, its profile. */
  projectGateway(id: string): Promise<ProjectGatewayData>;
  /** A project's Workflow card (D57): its settings, the base a change goes into, gh's state. */
  projectWorkflow(id: string): Promise<ProjectWorkflowData>;
  /** One project's tasks (D75): its work tree on this machine and its deploy tasks. */
  projectTasks(id: string): Promise<ProjectTasksData>;
  /** The Tasks tab (D76): every project with its work tree and its deploy tasks. */
  tasks(): Promise<TasksData>;
  /** One work task as the store keeps it: its description, notes and history (the side panel). */
  taskDetail(id: string): Promise<TaskDetailAnswer>;
  jobs(): Promise<JobsData>;
  /** The stream's `jobs` event: the queue's new state each time it changes. Returns the unsubscribe. */
  onJobs(listener: (jobs: JobsData) => void): () => void;
  guardAsks(query: GuardQuery): Promise<GuardAsksPage>;
  worktrees(): Promise<WorktreesData>;
  update(): Promise<UpdateData>;
  /**
   * Runs one action: `POST /api/<action>` with the page's CSRF value. Its result is the
   * server's own lines; a refusal of the action's own (`ok: false`) is a result, not a throw.
   */
  act(action: ActionName, body: Record<string, unknown>): Promise<ActionResult>;
  /** Every event of the live stream; returns the unsubscribe. */
  onEvent(listener: (message: LiveMessage) => void): () => void;
  /** Calls `listener` with the stream's state now and on every change; returns the unsubscribe. */
  connection(listener: (state: Connection) => void): () => void;
}

/** Thrown when a page needs the gateway and there is no usable `gateway.json`. */
export class GatewayNotSetUpError extends Error {
  override name = "GatewayNotSetUpError";
}

export type MockScenario = "empty" | "error" | "loading" | "no-gateway" | "normal" | "reconnecting";

const SCENARIOS: readonly MockScenario[] = [
  "empty",
  "error",
  "loading",
  "no-gateway",
  "normal",
  "reconnecting",
];

/** The `?mock=` word in the address, or null when there is none. */
function scenarioFromLocation(): MockScenario | null {
  if (typeof window === "undefined") return null;
  const word = new URLSearchParams(window.location.search).get("mock");
  if (word === null) return null;
  return SCENARIOS.find((scenario) => scenario === word) ?? "normal";
}

/** How long the mock takes to answer: long enough that a loading state is seen at all. */
const MOCK_LATENCY_MS = 250;

export function mockClient(scenario: MockScenario): PortalClient {
  const data = mockData(scenario === "empty");
  function answer<T>(value: () => T, needsGateway = false): Promise<T> {
    if (scenario === "loading") return new Promise<T>(() => {});
    return new Promise<T>((resolve, reject) => {
      setTimeout(() => {
        if (scenario === "error") {
          reject(new Error("The portal did not answer: connection refused on 127.0.0.1."));
        } else if (needsGateway && scenario === "no-gateway") {
          reject(new GatewayNotSetUpError("The gateway is not set up."));
        } else {
          try {
            resolve(value());
          } catch (error) {
            reject(error);
          }
        }
      }, MOCK_LATENCY_MS);
    });
  }
  return {
    kind: "mock",
    facts: () =>
      answer(() => (scenario === "no-gateway" ? { ...data.facts, router: null } : data.facts)),
    overview: () => answer(() => data.overview, true),
    history: (query) => answer(() => data.history(query), true),
    historyKeys: () => answer(() => data.keys, true),
    historyRate: () => answer(() => data.historyRate, true),
    requests: (query) => answer(() => data.requests(query), true),
    work: () => answer(() => data.work),
    flow: (window) => answer(() => data.flow[window]),
    slots: () => answer(() => data.slots, true),
    health: () => answer(() => data.health, true),
    machine: () => answer(() => data.machine),
    settings: () => answer(() => data.settings),
    projects: () => answer(() => data.projects),
    project: (id) =>
      answer(() => {
        const found = data.projectPages[id];
        if (found === undefined) throw new Error(`No project "${id}" is known on this machine.`);
        return found;
      }),
    projectGateway: (id) =>
      answer(() => {
        const found = data.gatewayPages[id];
        if (found === undefined) throw new Error(`No project "${id}" is known on this machine.`);
        // A machine with no gateway: the card shows what a project can still be, off or default.
        return scenario === "no-gateway"
          ? {
              ...found,
              configured: false,
              notes: [
                ...found.notes,
                {
                  text: "This machine's gateway is not set up (~/.config/cc-smart-dev-kit/gateway.json does not exist), so a project can be off or default here, never on.",
                  tone: "info" as const,
                },
              ],
              refusals: {
                ...found.refusals,
                personal: {
                  ...found.refusals.personal,
                  on: "On needs this machine's gateway, and it is not set up: set it up on Machine first.",
                },
              },
              profile: null,
              profiles: [],
            }
          : found;
      }),
    projectWorkflow: (id) =>
      answer(() => {
        const found = data.workflowPages[id];
        if (found === undefined) throw new Error(`No project "${id}" is known on this machine.`);
        return adapt.projectWorkflowOf(found, data.settings.rows);
      }),
    projectTasks: (id) =>
      answer(() => {
        const found = data.tasksPages[id];
        if (found === undefined) throw new Error(`No project "${id}" is known on this machine.`);
        return found;
      }),
    tasks: () =>
      answer(() => ({
        note: data.projects.note,
        projects: data.projects.rows.flatMap((project) => {
          const tasks = data.tasksPages[project.id];
          return tasks === undefined ? [] : [{ project, tasks }];
        }),
      })),
    taskDetail: (id) =>
      answer(() => {
        const found = mockTaskDetail(data.tasksPages, id);
        if (found === null) throw new PortalRequestError("task not found", 404);
        return found;
      }),
    jobs: () => answer(() => data.jobs),
    // The mock's stream sends no change: the page keeps what `jobs()` answered.
    onJobs: () => () => {},
    guardAsks: (query) => answer(() => data.guardAsks(query)),
    worktrees: () => answer(() => data.worktrees),
    update: () => answer(() => data.update),
    act: (action, body) =>
      answer(
        () =>
          data.act(action, body) ?? {
            lines: [`Mock data: ${action} sent nothing. The real portal runs it.`],
            ok: true,
          },
      ),
    onEvent: () => () => {},
    connection: (listener) => {
      listener(scenario === "reconnecting" ? "reconnecting" : "live");
      return () => {};
    },
  };
}

/** The history's query string: the range, the grouping and each filter that is set. */
function historyQuery(query: HistoryQuery | RequestQuery): URLSearchParams {
  const params = new URLSearchParams({ range: query.range });
  if ("by" in query) params.set("by", query.by);
  if ("cursor" in query && query.cursor !== null) params.set("cursor", query.cursor);
  if (query.slot !== undefined) params.set("slot", query.slot);
  if (query.target !== undefined) params.set("target", query.target);
  if (query.model !== undefined) params.set("model", query.model);
  if (query.session !== undefined) params.set("session", query.session);
  if (query.errorsOnly === true) params.set("status", "error");
  return params;
}

/** How many guard-log rows one page holds: the server cuts the page, never the client. */
export const GUARD_PAGE_SIZE = 50;

/** The guard log's query string: the range, the page's cursor and size, and each filter set. */
export function guardQuery(query: GuardQuery): URLSearchParams {
  const params = new URLSearchParams({ limit: String(GUARD_PAGE_SIZE), range: query.range });
  if (query.cursor !== null) params.set("cursor", query.cursor);
  if (query.guard !== undefined) params.set("hook", query.guard);
  if (query.session !== undefined) params.set("session", query.session);
  return params;
}

/** A page that needs the gateway, on a machine with none, says so instead of drawing zeros. */
function needingGateway<T>(read: () => T): T {
  try {
    return read();
  } catch (error) {
    if (error instanceof adapt.NotSetUpError) throw new GatewayNotSetUpError(error.message);
    throw error;
  }
}

/** The client of a page the kit's own server serves. */
export function liveClient(world: { fetch: Fetch; stream: LiveStream }): PortalClient {
  const get = <T>(path: string): Promise<T> => getJson<T>(world.fetch, path);
  const facts = () => get<Wire.FactsAnswer>("/api/facts");
  const settings = () => get<Wire.SettingsAnswer>("/api/settings");
  return {
    kind: "live",
    facts,
    overview: async () => {
      const answer = await get<Wire.OverviewAnswer>("/api/overview");
      return needingGateway(() => adapt.overviewOf(answer));
    },
    history: (query) => get<Wire.HistoryAnswer>(`/api/history?${historyQuery(query)}`),
    historyKeys: async () =>
      adapt.historyKeysOf(await get<Wire.HistoryKeysAnswer>("/api/history/keys?range=90d")),
    // The shape is the server's own (`src/portal/views.ts` › `OverviewRequests`): no adapting.
    historyRate: () => get<Wire.OverviewRequests>("/api/history/rate"),
    requests: (query) => get<Wire.RequestsAnswer>(`/api/requests?${historyQuery(query)}`),
    work: async () => adapt.workOf(await get<Wire.WorkAnswer>("/api/work")),
    flow: async (window) =>
      adapt.flowOf(
        await get<Wire.FlowAnswer>(`/api/flow?range=${window === "24h" ? "1d" : "7d"}`),
        window,
      ),
    slots: async () => {
      const answer = await get<Wire.SlotsAnswer>("/api/slots");
      if (!answer.configured) {
        throw new GatewayNotSetUpError(answer.error ?? "The gateway is not set up.");
      }
      return answer;
    },
    health: async () => {
      const answer = await get<Wire.HealthAnswer>("/api/health");
      return needingGateway(() => adapt.healthOf(answer));
    },
    machine: async () => {
      const [answer, frame] = await Promise.all([get<Wire.MachineAnswer>("/api/machine"), facts()]);
      return adapt.machineOf(answer, frame);
    },
    settings: async () => adapt.settingsOf(await settings()),
    projects: async () => adapt.projectsOf(await get<Wire.ProjectsAnswer>("/api/projects")),
    project: async (id) =>
      adapt.projectOf(await get<Wire.ProjectAnswer>(`/api/projects/${encodeURIComponent(id)}`)),
    projectGateway: (id) =>
      get<Wire.ProjectGatewayAnswer>(`/api/projects/${encodeURIComponent(id)}/gateway`),
    projectWorkflow: async (id) => {
      // The rows' words and controls are the Settings table's (`/api/settings`), the values the
      // project's own answer. Both or neither: a card without its controls would not say why.
      const [answer, specs] = await Promise.all([
        get<Wire.ProjectWorkflowAnswer>(`/api/projects/${encodeURIComponent(id)}/workflow`),
        settings(),
      ]);
      return adapt.projectWorkflowOf(answer, specs.rows);
    },
    projectTasks: (id) =>
      get<Wire.ProjectTasksAnswer>(`/api/projects/${encodeURIComponent(id)}/tasks`),
    tasks: async () => adapt.tasksOf(await get<Wire.TasksAnswer>("/api/tasks")),
    taskDetail: (id) => get<Wire.TaskDetailAnswer>(`/api/tasks/${encodeURIComponent(id)}`),
    jobs: async () => {
      const answer = await get<Wire.ApiError | Wire.JobsAnswer>("/api/jobs");
      if ("error" in answer) throw new Error(answer.error);
      return adapt.jobsOf(answer);
    },
    onJobs: (listener) =>
      world.stream.on((message) => {
        if (message.name === "jobs" && !("error" in message.data)) {
          listener(adapt.jobsOf(message.data));
        }
      }),
    guardAsks: async (query) =>
      adapt.guardAsksOf(await get<Wire.GuardAsksAnswer>(`/api/guard-asks?${guardQuery(query)}`)),
    worktrees: async () => {
      const [answer, projects] = await Promise.all([
        get<Wire.WorktreesAnswer>("/api/worktrees"),
        get<Wire.ProjectsAnswer>("/api/projects"),
      ]);
      return adapt.worktreesOf(answer, projects.current.name ?? "");
    },
    update: async () => {
      const [answer, frame] = await Promise.all([get<Wire.UpdateAnswer>("/api/update"), facts()]);
      return adapt.updateOf(answer, frame);
    },
    act: (action, body) => postAction(world.fetch, action, body, csrfToken()),
    onEvent: (listener) => world.stream.on(listener),
    connection: (listener) => world.stream.connection(listener),
  };
}

let client: PortalClient | null = null;

/** The client every page uses; made once, on the client side. The one place the kind is chosen. */
export function portalClient(): PortalClient {
  if (client !== null) return client;
  const scenario = scenarioFromLocation();
  if (scenario !== null || process.env.NODE_ENV === "development") {
    client = mockClient(scenario ?? "normal");
    return client;
  }
  client = liveClient({
    fetch: (input, init) => window.fetch(input, init),
    stream: startLiveStream("/events", {
      BroadcastChannel: typeof BroadcastChannel === "undefined" ? undefined : BroadcastChannel,
      EventSource,
      clearTimeout: (handle) => window.clearTimeout(handle),
      locks: typeof navigator !== "undefined" && "locks" in navigator ? navigator.locks : undefined,
      reload: () => window.location.reload(),
      setTimeout: (run, ms) => window.setTimeout(run, ms),
    }),
  });
  return client;
}
