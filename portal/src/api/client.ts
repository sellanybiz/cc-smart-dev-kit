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
import { csrfToken, type Fetch, getJson, postAction } from "./http";
import { mockData } from "./mock";
import { type LiveMessage, type LiveStream, startLiveStream } from "./stream";
import type {
  Connection,
  CrewDetail,
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
  NeedsData,
  OverviewData,
  OverviewRequests,
  PortalFacts,
  ProjectData,
  ProjectList,
  RequestPage,
  RequestQuery,
  SettingsData,
  SlotsData,
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
  jobs(): Promise<JobsData>;
  /** The stream's `jobs` event: the queue's new state each time it changes. Returns the unsubscribe. */
  onJobs(listener: (jobs: JobsData) => void): () => void;
  needs(): Promise<NeedsData>;
  crew(id: string): Promise<CrewDetail>;
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
    jobs: () => answer(() => data.jobs),
    // The mock's stream sends no change: the page keeps what `jobs()` answered.
    onJobs: () => () => {},
    needs: () => answer(() => data.needs),
    crew: (id) => answer(() => data.crew(id)),
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
      const [answer, work] = await Promise.all([
        get<Wire.OverviewAnswer>("/api/overview"),
        get<Wire.WorkAnswer>("/api/work").catch(() => null),
      ]);
      return needingGateway(() => adapt.overviewOf(answer, work));
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
    project: async (id) => {
      const answer = await get<Wire.ProjectAnswer>(`/api/projects/${encodeURIComponent(id)}`);
      // `/api/settings` reads the portal's own folder: only that project's page shows it.
      return adapt.projectOf(answer, answer.project.current ? await settings() : null);
    },
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
    needs: async () => {
      const [answer, frame] = await Promise.all([get<Wire.NeedsAnswer>("/api/needs"), facts()]);
      return adapt.needsOf(answer, frame.version);
    },
    crew: async (id) =>
      adapt.crewOf(await get<Wire.CrewAnswer>(`/api/crew/${encodeURIComponent(id)}`)),
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
