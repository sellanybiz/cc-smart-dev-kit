import { historyKeys, RECENT_PAGE_DEFAULT, RECENT_PAGE_MAX } from "../../gateway/history-read";
import { taskDetail } from "../../tasks/work/read";
import type { PageDataDeps } from "../page-data";
import {
  healthAnswer,
  jobsAnswerFor,
  machineAnswer,
  overviewAnswer,
  projectsAnswer,
  rateAnswer,
  settingsAnswer,
  slotsAnswer,
  updateAnswer,
} from "./data";
import { projectGatewayAnswerFor } from "./project-gateway";
import { projectTasksAnswerFor, tasksAnswer } from "./project-tasks";
import { projectAnswerFor, projectWorkflowAnswerFor } from "./projects";
import { HISTORY_RANGES, type HistoryBy, type HistoryRange } from "./types";
import {
  flowAnswer,
  GUARD_ASKS_DEFAULT,
  guardAsksAnswer,
  historyAnswer,
  historyFilters,
  requestsAnswer,
  workAnswer,
  worktreesAnswer,
} from "./work";

/** One answer: the JSON value and its status. */
export interface ApiAnswer {
  body: unknown;
  status: number;
}

/** The `by` values `/api/history` accepts. */
const HISTORY_BY: ReadonlySet<HistoryBy> = new Set(["target", "slot", "model", "session"]);

/** A range this version knows, or null. */
function rangeOf(value: null | string): HistoryRange | null {
  if (value === null) return "1d";
  return Object.hasOwn(HISTORY_RANGES, value) ? (value as HistoryRange) : null;
}

/** One query word: trimmed, and never empty. */
function wordOf(value: null | string): null | string {
  const trimmed = value?.trim() ?? "";
  return trimmed === "" ? null : trimmed;
}

/** A positive whole number, or the fallback. */
function limitOf(value: null | string, fallback: number): number {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1) return fallback;
  return Math.min(number, 5_000);
}

/** `/api/requests`' cursor: the id the page before ended at, or null for the newest page. */
function cursorOf(value: null | string): "bad" | null | number {
  if (value === null) return null;
  const number = Number(value);
  return Number.isInteger(number) && number >= 1 ? number : "bad";
}

/**
 * `/api/guard-asks`' cursor: `<at>.<n>`, the time of the last row a page gave and how many of
 * that time it already gave; null for the newest page.
 */
function guardCursorOf(value: null | string): "bad" | null | { at: number; n: number } {
  if (value === null) return null;
  const found = /^(\d+)\.(\d+)$/.exec(value);
  if (found?.[1] === undefined || found[2] === undefined) return "bad";
  const at = Number(found[1]);
  const n = Number(found[2]);
  return Number.isSafeInteger(at) && Number.isSafeInteger(n) ? { at, n } : "bad";
}

/** One answer: 200 and the value. */
const ok = (body: unknown): ApiAnswer => ({ body, status: 200 });

/** The refusal of a range this version does not know. */
const badRange = (): ApiAnswer => ({
  body: { error: `range must be one of ${Object.keys(HISTORY_RANGES).join(", ")}` },
  status: 400,
});

export const API_READS: Readonly<
  Record<string, (deps: PageDataDeps, query: URLSearchParams) => ApiAnswer | Promise<ApiAnswer>>
> = {
  "/api/overview": async (deps) => ok(await overviewAnswer(deps)),
  "/api/slots": async (deps) => ok(await slotsAnswer(deps)),
  "/api/health": async (deps) => ok(await healthAnswer(deps)),
  "/api/machine": async (deps) => ok(await machineAnswer(deps)),
  "/api/settings": async (deps) => ok(await settingsAnswer(deps)),
  "/api/projects": async (deps) => ok(await projectsAnswer(deps)),
  // The Tasks tab (D76): every project's work tree and deploy tasks at once.
  "/api/tasks": async (deps) => ok(await tasksAnswer(deps)),
  "/api/work": async (deps) => ok(await workAnswer(deps)),
  "/api/worktrees": async (deps) => ok(await worktreesAnswer(deps)),
  "/api/update": (deps) => ok(updateAnswer(deps)),
  "/api/jobs": async (deps) => ok(await jobsAnswerFor(deps)),
  "/api/facts": async (deps) => ok(await deps.facts()),
  // The Overview's rate, on its own: the card reads again with each routed request, and the
  // whole Overview answer is too heavy to ask at that cadence (`src/portal/api/data.ts`).
  "/api/history/rate": async (deps) => ok(await rateAnswer(deps)),
  "/api/history/keys": (deps, query) => {
    const range = rangeOf(query.get("range"));
    if (range === null) return badRange();
    try {
      return ok(
        historyKeys(deps.action.portal.paths.historyDbFile, {
          now: deps.action.portal.now(),
          range,
        }),
      );
    } catch {
      return { body: { error: "the request history could not be read" }, status: 500 };
    }
  },
  "/api/flow": async (deps, query) => {
    const range = rangeOf(query.get("range"));
    if (range === null) return badRange();
    const answer = await flowAnswer(deps, range);
    return "error" in answer ? { body: answer, status: 500 } : ok(answer);
  },
  "/api/history": (deps, query) => {
    const range = rangeOf(query.get("range"));
    const by = query.get("by") ?? "target";
    const status = query.get("status");
    if (
      range === null ||
      !HISTORY_BY.has(by as HistoryBy) ||
      (status !== null && status !== "error")
    ) {
      return {
        body: {
          error: `history takes range=${Object.keys(HISTORY_RANGES).join("|")}, by=target|slot|model|session, slot, target, model, session and status=error`,
        },
        status: 400,
      };
    }
    try {
      return ok(historyAnswer(deps, range, by as HistoryBy, historyFilters(query)));
    } catch {
      // The database is there but cannot be read: a typed refusal, never the reader's own text.
      return { body: { error: "the request history could not be read" }, status: 500 };
    }
  },
  "/api/requests": (deps, query) => {
    const range = rangeOf(query.get("range"));
    const status = query.get("status");
    const cursor = cursorOf(query.get("cursor"));
    if (range === null) return badRange();
    if ((status !== null && status !== "error") || cursor === "bad") {
      return {
        body: {
          error: `requests takes range=${Object.keys(HISTORY_RANGES).join("|")}, cursor=<the id the page before ended at>, limit=1..${RECENT_PAGE_MAX}, slot, target, model, session and status=error`,
        },
        status: 400,
      };
    }
    try {
      return ok(
        requestsAnswer(deps, {
          filters: historyFilters(query),
          // The range bounds the rows, as it does the charts: the page's switch changes both.
          from: deps.action.portal.now() - HISTORY_RANGES[range],
          limit: limitOf(query.get("limit"), RECENT_PAGE_DEFAULT),
          ...(cursor === null ? {} : { cursor }),
        }),
      );
    } catch {
      return { body: { error: "the request history could not be read" }, status: 500 };
    }
  },
  "/api/guard-asks": (deps, query) => {
    const range = rangeOf(query.get("range"));
    const cursor = guardCursorOf(query.get("cursor"));
    if (range === null || cursor === "bad") {
      return {
        body: {
          error: `guard-asks takes range=${Object.keys(HISTORY_RANGES).join("|")}, cursor=<at>.<n>, limit, hook, session, tool and q`,
        },
        status: 400,
      };
    }
    return ok(
      guardAsksAnswer(deps, {
        cursor,
        hook: wordOf(query.get("hook")),
        limit: limitOf(query.get("limit"), GUARD_ASKS_DEFAULT),
        q: wordOf(query.get("q")),
        range,
        session: wordOf(query.get("session")),
        tool: wordOf(query.get("tool")),
      }),
    );
  },
};

/** The parts of one project a card reads on its own: `/api/projects/<id>/<part>`. */
export const PROJECT_PARTS: Readonly<
  Record<string, (deps: PageDataDeps, id: string) => Promise<object | { error: string }>>
> = {
  gateway: projectGatewayAnswerFor,
  tasks: projectTasksAnswerFor,
  workflow: projectWorkflowAnswerFor,
};

/**
 * The answer for one GET under `/api/`, or null when no read route lives there (the server
 * distinguishes known POST-only actions from unknown paths).
 */
export async function answerApi(deps: PageDataDeps, url: URL): Promise<ApiAnswer | null> {
  const path = url.pathname;
  const read = Object.hasOwn(API_READS, path) ? API_READS[path] : undefined;
  if (read !== undefined) return await read(deps, url.searchParams);
  if (path.startsWith("/api/tasks/")) {
    let id: string;
    try {
      id = decodeURIComponent(path.slice("/api/tasks/".length));
    } catch {
      return { body: { error: "name a task" }, status: 400 };
    }
    if (!/^w[a-z2-7]{10}$/.test(id)) return { body: { error: "name a task id" }, status: 400 };
    const detail = taskDetail(deps.action.portal.paths, id);
    return detail.state === "ready" && detail.value !== null
      ? ok(detail.value)
      : {
          body: { error: detail.state === "unreadable" ? detail.why : "task not found" },
          status: 404,
        };
  }
  if (path.startsWith("/api/projects/")) {
    let id: string;
    try {
      id = decodeURIComponent(path.slice("/api/projects/".length));
    } catch {
      return { body: { error: "name a project" }, status: 400 };
    }
    if (id === "" || id.includes("/")) {
      // `/api/projects/<id>/<part>`: one card's own read. `workflow` (D57): the project's
      // workflow settings, its base and whether gh can open a pull request; `gateway` (GP4b):
      // its gateway state, the file that decides it, and its profile's chains; `tasks` (D75):
      // its work tasks and its open deploy tasks.
      const slash = id.indexOf("/");
      const named = slash < 0 ? "" : id.slice(0, slash);
      const part = slash < 0 ? "" : id.slice(slash + 1);
      const read = Object.hasOwn(PROJECT_PARTS, part) ? PROJECT_PARTS[part] : undefined;
      if (named === "" || read === undefined) {
        return { body: { error: "name a project" }, status: 400 };
      }
      const answer = await read(deps, named);
      return "error" in answer ? { body: answer, status: 404 } : ok(answer);
    }
    const answer = await projectAnswerFor(deps, id);
    return "error" in answer ? { body: answer, status: 404 } : ok(answer);
  }
  return null;
}
