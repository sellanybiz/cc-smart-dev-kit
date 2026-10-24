/**
 * The JSON API's routes: one read-only GET per answer, and which builder each one uses.
 *
 * The server checks the door before this module runs. Nothing here changes anything: an
 * unknown path, a range this version does not know, or a missing crew session is a typed
 * refusal, never a guess. The pages that act are POSTs to `/api/<action>`
 * (`src/portal/actions.ts`).
 */

import { historyKeys, RECENT_PAGE_DEFAULT, RECENT_PAGE_MAX } from "../../gateway/history-read";
import type { PageDataDeps } from "../page-data";
import {
  healthAnswer,
  jobsAnswerFor,
  machineAnswer,
  overviewAnswer,
  projectsAnswer,
  settingsAnswer,
  slotsAnswer,
  updateAnswer,
} from "./data";
import { projectGatewayAnswerFor } from "./project-gateway";
import { projectAnswerFor, projectWorkflowAnswerFor } from "./projects";
import { HISTORY_RANGES, type HistoryBy, type HistoryRange } from "./types";
import {
  crewAnswerFor,
  flowAnswer,
  GUARD_ASKS_DEFAULT,
  guardAsksAnswer,
  historyAnswer,
  historyFilters,
  needsAnswer,
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

/**
 * Every read route at a fixed path, and how it answers: the one list the server and the tests
 * read (a test that walks every route reads this, never a copy). The two routes with a name
 * in the path, `/api/projects/<id>` and `/api/crew/<id>`, follow in `answerApi`.
 */
export const API_READS: Readonly<
  Record<string, (deps: PageDataDeps, query: URLSearchParams) => ApiAnswer | Promise<ApiAnswer>>
> = {
  "/api/overview": async (deps) => ok(await overviewAnswer(deps)),
  "/api/slots": async (deps) => ok(await slotsAnswer(deps)),
  "/api/health": async (deps) => ok(await healthAnswer(deps)),
  "/api/machine": async (deps) => ok(await machineAnswer(deps)),
  "/api/settings": async (deps) => ok(await settingsAnswer(deps)),
  "/api/projects": async (deps) => ok(await projectsAnswer(deps)),
  "/api/work": async (deps) => ok(await workAnswer(deps)),
  "/api/needs": async (deps) => ok(await needsAnswer(deps)),
  "/api/worktrees": async (deps) => ok(await worktreesAnswer(deps)),
  "/api/update": (deps) => ok(updateAnswer(deps)),
  "/api/jobs": async (deps) => ok(await jobsAnswerFor(deps)),
  "/api/facts": async (deps) => ok(await deps.facts()),
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
    const status = query.get("status");
    const cursor = cursorOf(query.get("cursor"));
    if ((status !== null && status !== "error") || cursor === "bad") {
      return {
        body: {
          error: `requests takes cursor=<the id the page before ended at>, limit=1..${RECENT_PAGE_MAX}, slot, target, model, session and status=error`,
        },
        status: 400,
      };
    }
    try {
      return ok(
        requestsAnswer(deps, {
          filters: historyFilters(query),
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
const PROJECT_PARTS: Readonly<
  Record<string, (deps: PageDataDeps, id: string) => Promise<object | { error: string }>>
> = {
  gateway: projectGatewayAnswerFor,
  workflow: projectWorkflowAnswerFor,
};

/**
 * The answer for one GET under `/api/`, or null when no read route lives there (the server
 * then answers the path as it always did: an action is a POST).
 */
export async function answerApi(deps: PageDataDeps, url: URL): Promise<ApiAnswer | null> {
  const path = url.pathname;
  const read = Object.hasOwn(API_READS, path) ? API_READS[path] : undefined;
  if (read !== undefined) return await read(deps, url.searchParams);
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
      // its gateway state, the file that decides it, and its profile's chains.
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
  if (path.startsWith("/api/crew/")) {
    let ref: string;
    try {
      ref = decodeURIComponent(path.slice("/api/crew/".length));
    } catch {
      return { body: { error: "name a crew session" }, status: 400 };
    }
    if (ref === "" || ref.includes("/")) {
      return { body: { error: "name a crew session" }, status: 400 };
    }
    const answer = await crewAnswerFor(deps, ref);
    return "error" in answer ? { body: answer, status: 404 } : ok(answer);
  }
  return null;
}
