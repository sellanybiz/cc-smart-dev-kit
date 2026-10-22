/**
 * The portal's one data client. Every page reads through `PortalClient`, so the mock below and
 * the real client (same-origin JSON and `EventSource('/events')`, B6b) are one swap in
 * `portalClient()`.
 *
 * Until B6b, the mock answers. A `?mock=` word in the address shows the other states each page
 * must draw: `loading`, `error`, `empty`, `reconnecting`, `no-gateway`.
 */

import { mockData } from "./mock";
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
  PortalFacts,
  ProjectData,
  ProjectListRow,
  RequestPage,
  RequestQuery,
  SettingsData,
  SlotsData,
  UpdateData,
  WorkData,
  WorktreesData,
} from "./types";

export interface PortalClient {
  facts(): Promise<PortalFacts>;
  overview(): Promise<OverviewData>;
  /** `GET /api/history?range=…&by=…` and the filters (phase H1). */
  history(query: HistoryQuery): Promise<History>;
  /** `GET /api/history/keys`: the values a filter can take (phase H1). */
  historyKeys(): Promise<HistoryKeys>;
  /** `GET /api/requests?…&cursor=`: the request log, newest first (phase H1). */
  requests(query: RequestQuery): Promise<RequestPage>;
  work(): Promise<WorkData>;
  flow(window: FlowWindow): Promise<FlowReport>;
  slots(): Promise<SlotsData>;
  health(): Promise<HealthData>;
  machine(): Promise<MachineData>;
  settings(): Promise<SettingsData>;
  projects(): Promise<ProjectListRow[]>;
  project(id: string): Promise<ProjectData>;
  /** `GET /api/jobs`: the heavy-job queue. */
  jobs(): Promise<JobsData>;
  /** The stream's `jobs` event: the queue's new state each time it changes. Returns the unsubscribe. */
  onJobs(listener: (jobs: JobsData) => void): () => void;
  /** `GET /api/needs`: everything that waits for the person (D52). */
  needs(): Promise<NeedsData>;
  /** `GET /api/crew/<id>`: one crew session's page (D52). */
  crew(id: string): Promise<CrewDetail>;
  /** `GET /api/guard-asks?…`: the guard log (D52). */
  guardAsks(query: GuardQuery): Promise<GuardAsksPage>;
  /** `GET /api/worktrees` (D52). */
  worktrees(): Promise<WorktreesData>;
  /** `GET /api/update` (D52). */
  update(): Promise<UpdateData>;
  /**
   * A POST to one of the portal's actions (`/api/crew.answer`, `/api/update.install`,
   * `/api/worktrees.clean`), with the CSRF value the server put in the page's
   * `<meta name="ccsdk-csrf">` (`csrfToken`). The mock answers as the server will, and sends
   * nothing.
   */
  act(
    action: PortalAction,
    body: Record<string, unknown>,
  ): Promise<{ ok: boolean; message: string }>;
  /** Calls `listener` with the stream's state now and on every change; returns the unsubscribe. */
  connection(listener: (state: Connection) => void): () => void;
}

/** The actions a page may POST. */
export type PortalAction = "crew.answer" | "update.install" | "worktrees.clean";

/** The CSRF value the server writes into each page it serves; null on a page it did not. */
export function csrfToken(): null | string {
  if (typeof document === "undefined") return null;
  return document.querySelector('meta[name="ccsdk-csrf"]')?.getAttribute("content") ?? null;
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

function scenarioFromLocation(): MockScenario {
  if (typeof window === "undefined") return "normal";
  const word = new URLSearchParams(window.location.search).get("mock");
  return SCENARIOS.find((scenario) => scenario === word) ?? "normal";
}

/** How long the mock takes to answer: long enough that a loading state is seen at all. */
const MOCK_LATENCY_MS = 250;

function mockClient(scenario: MockScenario): PortalClient {
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
    facts: () =>
      answer(() => (scenario === "no-gateway" ? { ...data.facts, router: null } : data.facts)),
    overview: () => answer(() => data.overview, true),
    history: (query) => answer(() => data.history(query), true),
    historyKeys: () => answer(() => data.keys, true),
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
      answer(() => ({
        ok: true,
        message:
          action === "crew.answer"
            ? `Answer sent to ${String(body.name)}.`
            : action === "update.install"
              ? "The update is installing. Sessions load it when they start again."
              : "Finished worktrees are being cleared.",
      })),
    connection: (listener) => {
      listener(scenario === "reconnecting" ? "reconnecting" : "live");
      return () => {};
    },
  };
}

let client: PortalClient | null = null;

/** The client every page uses; made once, on the client side. */
export function portalClient(): PortalClient {
  if (client === null) client = mockClient(scenarioFromLocation());
  return client;
}
