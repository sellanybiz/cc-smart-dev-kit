/**
 * The JSON API's routes: one read-only GET per answer, and which builder each one uses.
 *
 * The server checks the door before this module runs. Nothing here changes anything: an
 * unknown path, a range this version does not know, or a missing crew session is a typed
 * refusal, never a guess. The pages that act are POSTs to `/api/<action>`
 * (`src/portal/actions.ts`).
 */

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
import { HISTORY_RANGES, type HistoryAnswer, type HistoryRange } from "./types";
import {
  crewAnswerFor,
  flowAnswer,
  GUARD_ASKS_DEFAULT,
  guardAsksAnswer,
  historyAnswer,
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
const HISTORY_BY: ReadonlySet<HistoryAnswer["by"]> = new Set([
  "target",
  "slot",
  "model",
  "session",
]);

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

/**
 * The answer for one GET under `/api/`, or null when no read route lives there (the server
 * then answers the path as it always did: an action is a POST).
 */
export async function answerApi(deps: PageDataDeps, url: URL): Promise<ApiAnswer | null> {
  const path = url.pathname;
  const query = url.searchParams;
  const ok = (body: unknown): ApiAnswer => ({ body, status: 200 });
  switch (path) {
    case "/api/overview":
      return ok(await overviewAnswer(deps));
    case "/api/slots":
      return ok(await slotsAnswer(deps));
    case "/api/health":
      return ok(await healthAnswer(deps));
    case "/api/machine":
      return ok(await machineAnswer(deps));
    case "/api/settings":
      return ok(settingsAnswer(deps));
    case "/api/projects":
      return ok(projectsAnswer(deps));
    case "/api/work":
      return ok(workAnswer(deps));
    case "/api/needs":
      return ok(await needsAnswer(deps));
    case "/api/worktrees":
      return ok(worktreesAnswer(deps));
    case "/api/update":
      return ok(updateAnswer(deps));
    case "/api/jobs":
      return ok(await jobsAnswerFor(deps));
    case "/api/flow": {
      const range = rangeOf(query.get("range"));
      if (range === null) {
        return {
          body: { error: `range must be one of ${Object.keys(HISTORY_RANGES).join(", ")}` },
          status: 400,
        };
      }
      return ok(flowAnswer(deps, range));
    }
    case "/api/history": {
      const range = rangeOf(query.get("range"));
      const by = query.get("by") ?? "target";
      if (range === null || !HISTORY_BY.has(by as HistoryAnswer["by"])) {
        return {
          body: {
            error: `history takes range=${Object.keys(HISTORY_RANGES).join("|")} and by=target|slot|model|session`,
          },
          status: 400,
        };
      }
      // The filters (`slot`, `target`, `model`, `session`, `status=error`) are accepted now and
      // used when phase H1's reader answers; today's answer is empty either way.
      return ok(historyAnswer(deps, range, by as HistoryAnswer["by"]));
    }
    case "/api/requests":
      // `cursor` and the same filters are accepted; phase H1 answers with rows.
      return ok(requestsAnswer());
    case "/api/guard-asks": {
      const limit = limitOf(query.get("limit"), GUARD_ASKS_DEFAULT);
      return ok(
        guardAsksAnswer(deps, {
          hook: wordOf(query.get("hook")),
          limit,
          q: wordOf(query.get("q")),
          session: wordOf(query.get("session")),
          tool: wordOf(query.get("tool")),
        }),
      );
    }
    default:
      break;
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
    const answer = crewAnswerFor(deps, ref);
    return "error" in answer ? { body: answer, status: 404 } : ok(answer);
  }
  return null;
}
