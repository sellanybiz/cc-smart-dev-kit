/**
 * The portal's HTTP server: the door, the pages, the actions, and the clock that closes it.
 *
 * Every request is checked before anything is read (`guard.ts`), and the shape of the answer
 * is fixed here:
 *
 *   - the page routes answer HTML, and only with a live session;
 *   - `/assets/…` answers the stylesheet and the two scripts — the only things that reach a
 *     browser without a session, because a page needs them to draw at all;
 *   - `/api/<action>` answers JSON, and only to a POST (a state change is never a GET);
 *   - anything else is 403 or 404, with one word and never a page.
 *
 * The server binds `127.0.0.1` and nothing else, and stops itself after `idleMs` with no
 * request (`session.ts`). Nothing about the machine — a key, a session cookie, a CSRF token —
 * is ever logged.
 */

import type { Check } from "../cli/doctor";
import { backendAddress } from "../gateway/settings";
import { isOlder } from "../update/check";
import {
  type ActionContext,
  type ActionResult,
  autoModeChange,
  type DoctorSource,
  jobLines,
  type PortalMemory,
  portalOmnirouteContext,
  readMemory,
  runAction,
  runDoctorPass,
  updateState,
} from "./actions";
import { PORTAL_CSS, PORTAL_ICON, PORTAL_JS, THEME_JS } from "./assets";
import type { PortalContext } from "./context";
import {
  backendRows,
  browserCardData,
  type ConfigRead,
  claudeModels,
  companionRows,
  configExists,
  limitFacts,
  type ModelRow,
  omnirouteRow,
  projectCardData,
  projectFileTexts,
  readConfig,
  routerFacts,
  routerLog,
  settingsData,
  shellFacts,
  slotRows,
  switchFacts,
  warpRow,
} from "./facts";
import {
  admit,
  CSRF_HEADER,
  cookieName,
  cookieValue,
  type FetchMetadata,
  networkAllowed,
  secretsMatch,
  securityHeaders,
  sessionCookie,
} from "./guard";
import type { Shell } from "./page";
import {
  createSession,
  exchangeToken,
  IDLE_MS,
  isIdle,
  type PortalSession,
  type Random,
  touch,
} from "./session";
import {
  expiredPage,
  healthPage,
  type MachineData,
  machinePage,
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

/** The page routes, and which screen each one draws. */
const PAGES = new Set(["/", "/health", "/machine", "/settings", "/slots"]);

/** How often the idle clock is looked at. Never longer than a quarter of the idle window. */
export function idleCheckMs(idleMs: number): number {
  return Math.max(50, Math.min(5_000, Math.floor(idleMs / 4)));
}

/** What a test needs to build a portal with fakes; the real values come from the entry. */
export interface PortalOptions {
  /** The folder the portal was started in: the project its auto-mode rules come from. */
  cwd: string;
  /**
   * Everything the doctor pass needs; the Machine page runs it. Built per pass (`DoctorSource`),
   * so the plugin's own files are read from the folder that is installed *now*.
   */
  doctor: DoctorSource;
  /** Thirty minutes in use; a test passes something short. */
  idleMs?: number;
  /** The port to bind; 0 takes a free one (what a test does). */
  port: number;
  /** The secrets; a test passes a fixed one. */
  random?: Random;
  /**
   * The workflow module, behind `workflow-adapter.ts`: the Settings page's values, the
   * personal writes, and the Project card's plan. A test passes a fake and never reads a real
   * workflow file, runs git, or writes anything.
   */
  workflow?: WorkflowAdapter;
}

/** The portal, running. */
export interface PortalServer {
  /** Resolves when it stops: `idle` when nothing asked it anything for long enough. */
  finished: Promise<"idle" | "stopped">;
  /** The port it really bound (the one the link names). */
  port: number;
  /** Stops it now: Ctrl+C in the terminal that started it. */
  stop: () => void;
  /** The link with its one-time token, exactly as printed. */
  url: string;
}

/** What the server keeps between requests. The session lives here and nowhere else. */
interface ServerState {
  /** The last doctor pass: the Machine page shows it instead of running one per load. */
  doctor: { at: number; checks: Check[] } | null;
  doctorRun: null | Promise<void>;
  memory: PortalMemory;
  session: PortalSession;
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

/**
 * The page for a request of the person's own that holds no session: a link already used, or a
 * cookie from a portal that stopped. It says what to run for a new one, and holds no fact
 * about this machine — no version, no port, no token — so it is safe without a session.
 */
function expiredLinkResponse(): Response {
  return respond(expiredPage(), { "content-type": "text/html; charset=utf-8" }, 403);
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

/** One line saying what the last background update check found, in `doctor`'s own words. */
export function summaryOf(last: ReturnType<typeof updateState>["last"]): string {
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

/**
 * Starts the portal. It binds `127.0.0.1:<port>` (0 takes a free one), answers the pages and
 * the actions, and stops itself after `idleMs` with no request.
 */
export async function startPortal(
  ctx: PortalContext,
  options: PortalOptions,
): Promise<PortalServer> {
  const random: Random =
    options.random ?? ((bytes) => Buffer.from(crypto.getRandomValues(new Uint8Array(bytes))));
  const idleMs = options.idleMs ?? IDLE_MS;
  const workflow = options.workflow ?? workflowAdapter;
  const state: ServerState = {
    doctor: null,
    doctorRun: null,
    memory: readMemory(ctx.paths),
    session: createSession(random, ctx.now()),
  };
  const server = Bun.serve({
    fetch: (request) => handle(request),
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

  let settle: (how: "idle" | "stopped") => void = () => undefined;
  const finished = new Promise<"idle" | "stopped">((resolve) => {
    settle = resolve;
  });
  const idleTimer = setInterval(() => {
    if (!isIdle(state.session, ctx.now(), idleMs)) return;
    clearInterval(idleTimer);
    server.stop(true);
    settle("idle");
  }, idleCheckMs(idleMs));

  /**
   * The project's own defaults, remembered for this run. Reading them runs git and, when `gh`
   * is on PATH, GitHub itself (`detectFacts`), so the answers for one file's text are computed
   * once and kept until that file changes: a form change on the Project card is a plan, not a
   * network read. The key is the file's text — the moment it changes, the next reader is fresh.
   */
  let remembered: { defaults: ProjectInitDefaults; key: string } | null = null;
  function projectDefaults(input: { env: Env; root: string }): ProjectInitDefaults {
    const key = `${input.root}\u0000${projectFileTexts(input.root).existing ?? ""}`;
    if (remembered === null || remembered.key !== key) {
      remembered = { defaults: workflow.projectInitDefaults(input), key };
    }
    return remembered.defaults;
  }

  function actionContext(): ActionContext {
    return {
      cwd: options.cwd,
      memory: state.memory,
      omniroute: portalOmnirouteContext(ctx),
      portal: ctx,
      projectDefaults,
      workflow,
    };
  }

  /**
   * One doctor pass, kept. Two requests at once wait for the same one. A pass that throws
   * clears the in-flight marker, so the next load tries again instead of waiting forever on a
   * rejected promise.
   */
  async function doctorOnce(): Promise<void> {
    if (state.doctor !== null) return;
    if (state.doctorRun === null) {
      state.doctorRun = runDoctorPass(actionContext(), options.doctor)
        .then((pass) => {
          state.doctor = { at: ctx.now(), checks: pass.checks };
        })
        .finally(() => {
          state.doctorRun = null;
        });
    }
    await state.doctorRun;
  }

  /**
   * The project's auto-mode change, for the Machine page: the `+` / `-` lines and the hash the
   * write sends back (`autoModeChange`). Null outside a project, and for a project that asks
   * for none and never did.
   */
  function autoMode(): MachineData["autoMode"] {
    try {
      const change = autoModeChange(actionContext());
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

  /** The Machine page's data. **No gateway config is needed for any of it**: updates, the
   *  doctor pass, the heavy-job queue, the companions, OmniRoute and Warp all work without
   *  one, and doctor matters most exactly then. */
  async function machineData(): Promise<MachineData> {
    await doctorOnce();
    const updates = updateState(actionContext());
    return {
      autoMode: autoMode(),
      browser: browserCardData(ctx),
      companions: companionRows(ctx),
      doctor: state.doctor,
      jobs: await jobLines(actionContext()),
      omniroute: await omnirouteRow(actionContext().omniroute, isOlder),
      project: projectCardData(ctx, options.cwd, projectDefaults, workflow),
      updates: {
        heldSince: updates.heldSince,
        installed: updates.installed,
        last: updates.last,
        newest: updates.last?.result === "up-to-date" ? updates.last.detail : null,
        summary: summaryOf(updates.last),
      },
      warp: warpRow(ctx),
    };
  }

  /**
   * The page route a path names, or null when no page lives there. `found` is the request's
   * one config read (`readConfig`), the same answer the shell's facts came from: reading it
   * twice could draw a page with both a router and a config error in it.
   */
  async function pageResponse(
    path: string,
    shell: Shell,
    extra: Record<string, string>,
    found: ConfigRead,
  ): Promise<Response> {
    if ("error" in found) {
      // No config, or one that cannot be read. The Machine page draws anyway: every card on
      // it works without the gateway, and `doctor` matters most on a machine that has none.
      // A config file that is there but unusable names its own problem; a missing one is
      // simply "not set up". Overview, Slots and Health need the config, so they keep the
      // page that says so and points at Machine.
      const error = configExists(ctx) ? { configError: found.error } : {};
      if (path === "/machine") {
        return html(machinePage(shell, { ...(await machineData()), ...error }), extra);
      }
      // The Settings page needs no gateway either: the workflow is a file of the person's
      // own and the project's, so it draws with the header's "Gateway not set up" line.
      if (path === "/settings") {
        return html(settingsPage(shell, settingsData(ctx, options.cwd, workflow)), extra);
      }
      return html(notSetUpPage(shell, { backends: [], ...error }), extra);
    }
    const config = found.config;
    const router = await routerFacts(ctx, config.port);
    if (path === "/slots") {
      const backends = await backendRows(ctx, config);
      const models: ModelRow[] = [
        ...backends.flatMap((backend) => backend.models),
        ...claudeModels(config).map((id) => ({
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
      return html(
        slotsPage(shell, {
          backendNotes: backends
            .filter((backend) => backend.state !== "answers")
            .map(
              (backend) =>
                `${backend.name} could not be listed (${backend.why}). Its models are missing from the table; ${backend.url} is what the config names.`,
            ),
          chains: Object.fromEntries(
            rows.map((row) => [row.name, row.targets.map((t) => t.target)]),
          ),
          fallback: Object.fromEntries(rows.map((row) => [row.name, row.fallback])),
          models,
          slots: rows,
          tested,
        }),
        extra,
      );
    }
    if (path === "/health") {
      const limits = limitFacts(ctx);
      return html(
        healthPage(shell, {
          backends: await backendRows(ctx, config),
          fallbacks: limits.fallbacks,
          limits: limits.limits,
          log: routerLog(ctx, 200),
          router,
        }),
        extra,
      );
    }
    if (path === "/machine") return html(machinePage(shell, await machineData()), extra);
    if (path === "/settings") {
      return html(settingsPage(shell, settingsData(ctx, options.cwd, workflow)), extra);
    }
    const limits = limitFacts(ctx);
    // The address with no credential in it: a `user:pass@` or a `?key=` would be in the page.
    const omniroute = config.backends.omniroute;
    const dashboard = omniroute === undefined ? null : backendAddress(omniroute.baseUrl);
    return html(
      overviewPage(shell, {
        backends: await backendRows(ctx, config),
        dashboardUrl: dashboard === null ? null : `${dashboard}/`,
        fallbacks: limits.fallbacks,
        limits: limits.limits,
        limitsRead: limits.read,
        router,
        slots: slotRows(config, router),
        switches: switchFacts(ctx, config),
        warnings: routerLog(ctx, 200).lines.filter((line) => line.level !== "INFO"),
      }),
      extra,
    );
  }

  async function handle(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const method = request.method.toUpperCase();
    const token = url.searchParams.get("t");
    const fetchMeta: FetchMetadata = {
      mode: request.headers.get("sec-fetch-mode"),
      site: request.headers.get("sec-fetch-site"),
    };

    // The rules that hold for every request. Then the stylesheet and the two scripts, which
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

    const gate = admit({
      cookie: cookieValue(request.headers.get("cookie"), cookieName(port)),
      csrf: request.headers.get(CSRF_HEADER),
      expectedCsrf: state.session.csrf,
      fetchMeta,
      host: request.headers.get("host"),
      method,
      origin: request.headers.get("origin"),
      port,
      session: state.session.cookie,
      // Compared without leaking where they differ, like the session and the CSRF token.
      tokenValid: secretsMatch(state.session.token, token),
    });
    if (gate.kind === "refused") {
      // A GET that passed the Host and Origin checks but holds no session is the person's own
      // browser with a dead link or an old cookie: it gets the page that says so. A Host or
      // Origin refusal stays the one word for a stranger, and so does a refused POST.
      if (method === "GET" && gate.reason === "session") return expiredLinkResponse();
      return refused();
    }

    // The Health page's five-second reload asks with `?auto=1`: it draws the page again and
    // is not the person doing anything, so it must not hold the idle clock open — a tab left
    // open would otherwise keep this portal alive forever.
    if (url.searchParams.get("auto") !== "1") touch(state.session, ctx.now());

    if (gate.kind === "exchange") {
      // The first load: the one-time token becomes the session cookie, and the page is
      // served in the same answer, so the URL can be cleaned by the page's own script.
      const value = exchangeToken(state.session, token, random, ctx.now());
      if (value === null) return refused();
      const found = readConfig(ctx);
      const shell: Shell = {
        bun: ctx.bunVersion,
        csrf: state.session.csrf,
        facts: await shellFacts(ctx, port, found),
      };
      const path = PAGES.has(url.pathname) ? url.pathname : "/";
      return pageResponse(
        path,
        shell,
        { "set-cookie": sessionCookie(cookieName(port), value) },
        found,
      );
    }

    if (url.pathname.startsWith("/api/")) {
      if (method !== "POST") return json({ lines: ["An action is a POST."], ok: false }, 405);
      const name = url.pathname.slice("/api/".length);
      try {
        if (name === "doctor.run") {
          await runDoctorPass(actionContext(), options.doctor).then((pass) => {
            state.doctor = { at: ctx.now(), checks: pass.checks };
            return pass;
          });
          const checks = state.doctor?.checks ?? [];
          return json(
            { lines: checks.map((check) => `${check.ok ? "✓" : "✗"} ${check.text}`), ok: true },
            200,
          );
        }
        const result: ActionResult = await runAction(
          name,
          await readBody(request),
          actionContext(),
        );
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
      csrf: state.session.csrf,
      facts: await shellFacts(ctx, port, found),
    };
    if (url.pathname === "/privacy") {
      return html(privacyPage(shell), {});
    }
    if (!PAGES.has(url.pathname)) return expiredPageResponse();
    return pageResponse(url.pathname, shell, {}, found);
  }

  /** A route that is not one of ours, with no session: the link is dead. */
  function expiredPageResponse(): Response {
    return respond(expiredPage(), { "content-type": "text/html; charset=utf-8" }, 404);
  }

  return {
    finished,
    port,
    stop: () => {
      clearInterval(idleTimer);
      server.stop(true);
      settle("stopped");
    },
    url: `http://127.0.0.1:${port}/?t=${state.session.token ?? ""}`,
  };
}
