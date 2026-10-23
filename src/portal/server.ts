/**
 * The portal's HTTP server: the door, the pages, the JSON API, the live stream, and the
 * actions.
 *
 * Every request is checked before anything is read (`guard.ts`), and the shape of the answer
 * is fixed here:
 *
 *   - the page routes answer HTML: the Next.js export when its folder is there (D49), else
 *     the server-rendered pages (they keep working until the switch-over);
 *   - `/assets/…` answers the server-rendered pages' stylesheet and scripts;
 *   - `/_next/static/…` answers the export's own files, like the assets: no machine facts in
 *     them;
 *   - `/healthz` answers the portal's own name, pid and version, so a start or a stop can tell
 *     this portal apart from every other program on the port;
 *   - `GET /events` is the live stream (Server-Sent Events, D51): pings, `Last-Event-ID`, at
 *     most 8 at once, and a `closing` event when the server stops for a new version;
 *   - `GET /api/…` answers JSON, read-only (`src/portal/api/`), and `POST /api/<action>`
 *     changes something (a state change is never a GET);
 *   - anything else is 403 or 404, with one word and never a page.
 *
 * The server binds `127.0.0.1` and nothing else, and stays up until it is stopped (D10): no
 * idle clock, so it is there whenever the person opens it. Nothing about the machine — a key,
 * the CSRF token — is ever logged.
 *
 * **One action never blocks the server.** An action runs the CLI's own code; every command it
 * starts with a child process is spawned asynchronously (`actions.ts`), so a page load, another
 * action and the live stream answer while a 300-second `claude plugin …` install runs.
 */

import { dirname, join } from "node:path";
import { VERSION } from "../build-info";
import { type Check, checkLine } from "../cli/doctor";
import { type JobsAnswer, jobsAnswer, readJobs } from "../jobs/status";
import {
  type ActionContext,
  type ActionResult,
  type DoctorSource,
  jobContext,
  portalOmnirouteContext,
  runAction,
  runDoctorPass,
  updateState,
} from "./actions";
import { answerApi } from "./api/routes";
import type { ApiError } from "./api/types";
import { PORTAL_CSS, PORTAL_ICON, PORTAL_JS, THEME_JS } from "./assets";
import type { PortalContext } from "./context";
import { configExists, projectFileTexts, readConfig, shellFacts } from "./facts";
import {
  admit,
  CSRF_HEADER,
  createCsrf,
  type FetchMetadata,
  networkAllowed,
  type Random,
  securityHeaders,
} from "./guard";
import { healthAnswer, PORTAL_HEALTH_PATH } from "./health";
import { LiveHub } from "./live/hub";
import { createLiveSources, type LiveSources } from "./live/sources";
import type { Shell } from "./page";
import {
  healthData,
  machineData,
  overviewData,
  type PageDataDeps,
  settingsPageData,
  slotsData,
} from "./page-data";
import { type ExportServer, exportResponse, exportServer, readExport } from "./static";
import {
  healthPage,
  machinePage,
  notFoundPage,
  notSetUpPage,
  overviewPage,
  privacyPage,
  settingsPage,
  slotsPage,
} from "./views";
import {
  type Env,
  type ProjectInitDefaults,
  type WorkflowAdapter,
  workflowAdapter,
} from "./workflow-adapter";

/** The page routes the server itself draws, and which screen each one is. */
const SERVED_PAGES = new Set(["/", "/health", "/machine", "/settings", "/slots"]);

/** What a test needs to build a portal with fakes; the real values come from the entry. */
export interface PortalOptions {
  /** The folder the portal was started in: the project its auto-mode rules come from. */
  cwd: string;
  /**
   * Everything the doctor pass needs; the Machine page runs it. Built per pass (`DoctorSource`),
   * so the plugin's own files are read from the folder that is installed *now*.
   */
  doctor: DoctorSource;
  /** The port to bind; 0 takes a free one (what a test does). */
  port: number;
  /** The CSRF token's bytes; a test passes a fixed one. */
  random?: Random;
  /**
   * The Next.js export's folder (D49), when it is there. Left out: the copy's `portal-ui/`
   * beside `portal.js`. With no export, the server-rendered pages answer.
   */
  staticFolder?: null | string;
  /** How often the live stream polls its sources; a test makes it long or drives `pollOnce`. */
  livePollMs?: number;
  /**
   * The workflow module, behind `workflow-adapter.ts`: the Settings page's values, the
   * personal writes, and the Project card's plan. A test passes a fake and never reads a real
   * workflow file, runs git, or writes anything.
   */
  workflow?: WorkflowAdapter;
}

/** The portal, running. */
export interface PortalServer {
  /** Resolves when it stops: `portal stop`, or Ctrl+C in a terminal that ran it by hand. */
  finished: Promise<void>;
  /** The live stream's hub: a test reads its count and publishes. */
  live: LiveHub;
  /** The port it really bound (the address every page and the health answer name). */
  port: number;
  /** Stops it now. */
  stop: () => void;
  /** Its address, with nothing secret in it: there is no token any more (D9). */
  url: string;
}

/** What the server keeps between requests. The CSRF token lives here and nowhere else. */
interface ServerState {
  /** The token a POST must carry, made once when the server starts and in every page. */
  csrf: string;
  /** The last doctor pass: the Machine page shows it instead of running one per load. */
  doctor: { at: number; checks: Check[] } | null;
  doctorRun: null | Promise<void>;
}

/** The export beside the running bundle: the portal copy's `portal-ui/` (`lifecycle.ts`). */
function defaultExportFolder(): string {
  return join(dirname(import.meta.path), "portal-ui");
}

function respond(body: string, headers: Record<string, string>, status: number): Response {
  return new Response(body, { headers: { ...securityHeaders(), ...headers }, status });
}

function json(body: unknown, status: number): Response {
  return respond(JSON.stringify(body), { "content-type": "application/json" }, status);
}

function html(body: string, extra: Record<string, string> = {}): Response {
  return respond(body, { "content-type": "text/html; charset=utf-8", ...extra }, 200);
}

/** The one-word body of a refusal: nothing for a stranger to read, and no page. */
function refused(): Response {
  return respond("Forbidden", { "content-type": "text/plain; charset=utf-8" }, 403);
}

/** The action's body, parsed; `{}` when it is not JSON, so the action refuses its own inputs. */
async function readBody(request: Request): Promise<Record<string, unknown>> {
  try {
    const text = await request.text();
    if (text.trim() === "") return {};
    const parsed: unknown = JSON.parse(text);
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

/**
 * Starts the portal. It binds `127.0.0.1:<port>` (0 takes a free one), answers the pages, the
 * API, the stream and the actions, and stays up until `stop()` (D10: no idle clock).
 */
export async function startPortal(
  ctx: PortalContext,
  options: PortalOptions,
): Promise<PortalServer> {
  const random: Random =
    options.random ?? ((bytes) => Buffer.from(crypto.getRandomValues(new Uint8Array(bytes))));
  const workflow = options.workflow ?? workflowAdapter;
  const state: ServerState = {
    csrf: createCsrf(random),
    doctor: null,
    doctorRun: null,
  };
  const hub = new LiveHub({ now: ctx.now });
  const exported = readExport(
    options.staticFolder === undefined ? defaultExportFolder() : options.staticFolder,
  );
  const source: ExportServer | null = exported === null ? null : exportServer(exported);
  const server = Bun.serve({
    fetch: (request, bunServer) => handle(request, bunServer),
    /**
     * A bug that throws inside a page (a page must never show a stack, and a machine's own
     * paths are in one), and `development: false` with it: the default error page names the
     * source file and the line. The one word goes out with the same headers as everything else.
     */
    error: () =>
      respond("Internal Server Error", { "content-type": "text/plain; charset=utf-8" }, 500),
    development: false,
    hostname: "127.0.0.1",
    port: options.port,
  });
  const port = server.port ?? options.port;

  let settle: () => void = () => undefined;
  const finished = new Promise<void>((resolve) => {
    settle = resolve;
  });

  /**
   * The project's own defaults, remembered for this run. Reading them runs git and, when `gh`
   * is on PATH, GitHub itself (`detectFacts`), so the answers for one file's text are computed
   * once and kept until that file changes: a form change on the Project card is a plan, not a
   * network read. The key is the file's text — the moment it changes, the next reader is fresh.
   */
  let remembered: { defaults: ProjectInitDefaults; key: string } | null = null;
  async function projectDefaults(input: { env: Env; root: string }): Promise<ProjectInitDefaults> {
    const key = `${input.root}\u0000${projectFileTexts(input.root).existing ?? ""}`;
    if (remembered === null || remembered.key !== key) {
      remembered = { defaults: await workflow.projectInitDefaults(input), key };
    }
    return remembered.defaults;
  }

  function actionContext(): ActionContext {
    return {
      cwd: options.cwd,
      omniroute: portalOmnirouteContext(ctx),
      portal: ctx,
      projectDefaults,
      // A long action's lines go to every open page while it runs (B6b: never a blocked
      // server, and its progress on the stream).
      publish: (event, data) => hub.publish(event, data),
      workflow,
    };
  }

  /**
   * One doctor pass, kept. Two requests at once wait for the same one. A pass that throws
   * clears the in-flight marker, so the next load tries again instead of waiting forever on a
   * rejected promise. The result goes out on the live stream too.
   */
  async function doctorOnce(): Promise<void> {
    if (state.doctor !== null) return;
    if (state.doctorRun === null) {
      state.doctorRun = runDoctorPass(actionContext(), options.doctor)
        .then((pass) => {
          state.doctor = { at: ctx.now(), checks: pass.checks };
          hub.publish("doctor", state.doctor);
        })
        .finally(() => {
          state.doctorRun = null;
        });
    }
    await state.doctorRun;
  }

  /** What the pages and the API build from: this request's config read, and the server's memory. */
  function pageDeps(found: ReturnType<typeof readConfig>): PageDataDeps {
    return {
      action: actionContext(),
      doctor: async () => {
        await doctorOnce();
        return state.doctor;
      },
      facts: () => shellFacts(ctx, port, found),
      found,
      projectDefaults,
      workflow,
    };
  }

  /** The queue's answer, for the `jobs` event: the same reader `/api/jobs` uses. */
  async function liveJobs(): Promise<ApiError | JobsAnswer> {
    try {
      return jobsAnswer(await readJobs(jobContext(actionContext())));
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) };
    }
  }

  const sources: LiveSources = createLiveSources({
    fetch: ctx.probe.fetch,
    jobs: liveJobs,
    now: ctx.now,
    paths: ctx.paths,
    pollMs: options.livePollMs,
    publish: (event, data) => hub.publish(event, data),
    routerPort: () => {
      const found = readConfig(ctx);
      return "config" in found ? found.config.port : null;
    },
  });

  /**
   * The page route a path names, or null when no page lives there. `found` is the request's
   * one config read (`readConfig`), the same answer the shell's facts came from: reading it
   * twice could draw a page with both a router and a config error in it.
   */
  async function pageResponse(
    path: string,
    shell: Shell,
    extra: Record<string, string>,
    found: ReturnType<typeof readConfig>,
  ): Promise<Response> {
    const deps = pageDeps(found);
    if ("error" in found) {
      // No config, or one that cannot be read. The Machine page draws anyway: every card on
      // it works without the gateway, and `doctor` matters most on a machine that has none.
      const error = configExists(ctx) ? { configError: found.error } : {};
      if (path === "/machine") {
        return html(machinePage(shell, { ...(await machineData(deps)), ...error }), extra);
      }
      // The Settings page needs no gateway either: the workflow is a file of the person's
      // own and the project's, so it draws with the header's "Gateway not set up" line.
      if (path === "/settings") {
        return html(settingsPage(shell, await settingsPageData(deps)), extra);
      }
      return html(notSetUpPage(shell, { backends: [], ...error }), extra);
    }
    const config = found.config;
    if (path === "/slots") return html(slotsPage(shell, await slotsData(deps, config)), extra);
    if (path === "/health") return html(healthPage(shell, await healthData(deps, config)), extra);
    if (path === "/machine") return html(machinePage(shell, await machineData(deps)), extra);
    if (path === "/settings") return html(settingsPage(shell, await settingsPageData(deps)), extra);
    return html(overviewPage(shell, await overviewData(deps, config)), extra);
  }

  async function handle(request: Request, bunServer: Bun.Server<undefined>): Promise<Response> {
    const url = new URL(request.url);
    const method = request.method.toUpperCase();
    const fetchMeta: FetchMetadata = {
      mode: request.headers.get("sec-fetch-mode"),
      site: request.headers.get("sec-fetch-site"),
    };

    // The rules that hold for every request. Then the stylesheet and the scripts, which
    // carry nothing of the machine and are what a page needs to draw at all — a browser asks
    // for them in the same breath as the page, and one of them sets the theme before the
    // first paint.
    const network = networkAllowed(
      request.headers.get("host"),
      request.headers.get("origin"),
      port,
      fetchMeta,
    );
    if (network !== null) return refused();
    if (method === "GET" && url.pathname.startsWith("/assets/")) {
      switch (url.pathname) {
        case "/assets/portal.css":
          return respond(PORTAL_CSS, { "content-type": "text/css; charset=utf-8" }, 200);
        case "/assets/portal.js":
          return respond(PORTAL_JS, { "content-type": "text/javascript; charset=utf-8" }, 200);
        case "/assets/theme.js":
          return respond(THEME_JS, { "content-type": "text/javascript; charset=utf-8" }, 200);
        // The page's own icon: the browser asks for it in the same breath as the page, and it
        // is what stops a request for `/favicon.ico`, which the portal does not answer.
        case "/assets/icon.svg":
          return respond(PORTAL_ICON, { "content-type": "image/svg+xml; charset=utf-8" }, 200);
        default:
          return refused();
      }
    }
    // The export's own build output: no machine facts in it, like the assets, so the network
    // rules alone judge it. Next's client navigation fetches its data here too.
    if (method === "GET" && source !== null) {
      const build = source.staticFile(url.pathname);
      if (build !== null) {
        const answer = exportResponse(source, build, state.csrf);
        if (answer !== null) return answer;
      }
    }

    // The portal's own name, pid and version: what `portal status`, `portal stop` and a
    // version hand-over read to tell this portal apart from every other program on the port.
    // It holds nothing of the machine, so the network rules alone judge it.
    if (url.pathname === PORTAL_HEALTH_PATH) {
      return method === "GET" ? json(healthAnswer(VERSION, process.pid), 200) : refused();
    }

    const gate = admit({
      csrf: request.headers.get(CSRF_HEADER),
      expectedCsrf: state.csrf,
      fetchMeta,
      host: request.headers.get("host"),
      method,
      origin: request.headers.get("origin"),
      port,
    });
    if (gate.kind === "refused") return refused();

    // The live stream: a GET, admitted by the network rules alone (D9: no sign-in, and this
    // changes nothing). `timeout(request, 0)` keeps Bun's own idle clock from closing a stream
    // that is quiet between pings.
    if (url.pathname === "/events") {
      if (method !== "GET") return refused();
      bunServer.timeout(request, 0);
      const opened = hub.open(request);
      if (opened.kind === "refused") {
        return json(
          { error: `the portal serves ${hub.streamsOpen} streams at once; close another tab` },
          429,
        );
      }
      return opened.response;
    }

    if (url.pathname.startsWith("/api/")) {
      if (method === "GET") {
        const answer = await answerApi(pageDeps(readConfig(ctx)), url);
        return answer === null
          ? json({ lines: ["An action is a POST."], ok: false }, 405)
          : json(answer.body, answer.status);
      }
      if (method !== "POST") return json({ lines: ["An action is a POST."], ok: false }, 405);
      const name = url.pathname.slice("/api/".length);
      try {
        if (name === "doctor.run") {
          await runDoctorPass(actionContext(), options.doctor).then((pass) => {
            state.doctor = { at: ctx.now(), checks: pass.checks };
            return pass;
          });
          const checks = state.doctor?.checks ?? [];
          hub.publish("doctor", state.doctor);
          return json({ lines: checks.map(checkLine), ok: true }, 200);
        }
        const result: ActionResult = await runAction(
          name,
          await readBody(request),
          actionContext(),
        );
        // The action's own result goes out on the stream, for every open page (B6b), and an
        // action that changed the update or the queue says so at once, so a page repaints
        // without waiting for the next poll.
        hub.publish("action", { action: name, ...result });
        if (name === "update.check" || name === "update.install" || name === "switch") {
          hub.publish("update", { last: updateState(actionContext()).last });
        }
        if (name === "worktrees.clean") hub.publish("jobs", await liveJobs());
        return json(result, result.ok ? 200 : 400);
      } catch (error) {
        // The message goes to the page that asked; it never leaves this machine.
        return json(
          { lines: [error instanceof Error ? error.message : String(error)], ok: false },
          400,
        );
      }
    }

    if (method !== "GET") return refused();
    // One read of the config for the whole request: the shell's facts and the page take the
    // same answer.
    const found = readConfig(ctx);
    const shell: Shell = {
      bun: ctx.bunVersion,
      csrf: state.csrf,
      facts: await shellFacts(ctx, port, found),
    };
    if (url.pathname === "/privacy") {
      return html(privacyPage(shell), {});
    }
    // The export's pages, when the folder is there. A route it does not have falls back to
    // the server-rendered page, so the switch-over costs nothing.
    if (source !== null) {
      const file = source.page(url.pathname);
      if (file !== null) {
        const answer = exportResponse(source, file, state.csrf);
        if (answer !== null) return answer;
      }
    }
    if (!SERVED_PAGES.has(url.pathname)) {
      return respond(notFoundPage(), { "content-type": "text/html; charset=utf-8" }, 404);
    }
    return pageResponse(url.pathname, shell, {}, found);
  }

  // The live sources start with the server and stop with it. A test drives `pollOnce`.
  if (options.livePollMs !== 0) sources.start();

  let stopping = false;
  return {
    finished,
    live: hub,
    port,
    stop: () => {
      if (stopping) return;
      stopping = true;
      // Every open stream is told the portal is going (a new version), then closed; the
      // server stops once those responses end, so the event reaches the page.
      hub.closing();
      sources.stop();
      void server.stop(false).then(settle);
    },
    url: `http://127.0.0.1:${port}/`,
  };
}
