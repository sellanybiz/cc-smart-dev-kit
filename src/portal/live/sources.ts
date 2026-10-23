/**
 * What the live stream publishes: the facts that change while a page is open.
 *
 * One poller, on a timer, reads the small state files and the router's health page, and
 * publishes only what changed (`hub.ts` sends it). The sources are:
 *
 *   - **`recent`** — the router's last routed requests (metadata only: time, slot, target,
 *     status, ms), read from its own health answer. What the activity feed shows.
 *   - **`crew`** — the crew store's `events.jsonl`, one event per line, read from a byte
 *     offset per repository: a step, a state, a report, a question.
 *   - **`state`** — `gateway-state.json`: the plan limits, the slots on a fallback, an open
 *     breaker, and the Claude ids the router saw.
 *   - **`guard-ask`** — `guard-asks.jsonl`, by byte offset: what a guard asked, already masked
 *     when it was written.
 *   - **`update`** — the last background update check's record.
 *   - **`jobs`** — the heavy-job queue, built only when a lease or ticket file appears, changes
 *     or goes (`jobsFingerprint`), with a poll as the floor.
 *
 * The doctor pass and an action's result are not polled: the server publishes them itself,
 * at the moment it has them (`server.ts`).
 *
 * Everything published here is metadata or a short line the plugin already shows on a page:
 * never a key, an address with a credential, a prompt or an answer.
 */

import { readFileSync } from "node:fs";
import type { CliPaths } from "../../cli/paths";
import { eventsEndOffset, listAllCrew, readCrewEvents } from "../../crew/store";
import { type HealthFetch, routerHealth } from "../../gateway/health";
import { parseLimitState } from "../../gateway/limit-state";
import { askLogFile, type GuardAsk } from "../../hooks/ask-log";
import { type JobsAnswer, jobsFingerprint } from "../../jobs/status";
import { readLastCheck, updateFiles } from "../../update/state";
import type { ApiError, LivePublish } from "../api/types";
import { recentEntryOf } from "../facts";

/** How often the poller reads, by default: fast enough for a feed, cheap enough for a laptop. */
export const LIVE_POLL_MS = 2_000;

/** How long the poller trusts its list of repositories with a crew store: one walk, not one a poll. */
const REPOS_TTL_MS = 30_000;

/** What the poller needs: the portal's own context, the one reader per source, and a sink. */
export interface LiveSourcesDeps {
  fetch: HealthFetch;
  now: () => number;
  paths: CliPaths;
  /** Where the events go (the hub's `publish`), each with its own data (`LiveEvents`). */
  publish: LivePublish;
  /** The router's port now, or null when no config names one. Read fresh every poll. */
  routerPort: () => null | number;
  /** The heavy-job queue's answer (`/api/jobs`'s shape), built only when its files changed. */
  jobs: () => Promise<ApiError | JobsAnswer>;
  pollMs?: number | undefined;
}

/** The poller: `pollOnce` for a test, `start`/`stop` for the server. */
export interface LiveSources {
  pollOnce: () => Promise<void>;
  start: () => void;
  stop: () => void;
}

/** One entry of the router's `recent`: enough to tell a new request from an old one. */
function fingerprintOf(entry: Record<string, unknown>): string {
  return [entry.at, entry.slot, entry.status, entry.target, entry.ms].join("\u0000");
}

/** The recent requests of the router's health answer, defensively read. */
function recentOf(body: unknown): Record<string, unknown>[] {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return [];
  const recent = (body as Record<string, unknown>).recent;
  return Array.isArray(recent)
    ? recent.filter(
        (entry): entry is Record<string, unknown> =>
          typeof entry === "object" && entry !== null && !Array.isArray(entry),
      )
    : [];
}

/** One line of the ask log, or null when it is not one this version reads (never sent then). */
function guardAskOf(value: unknown): GuardAsk | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const { at, hook, reason, session, tool } = value as Record<string, unknown>;
  if (typeof at !== "number" || typeof hook !== "string" || typeof reason !== "string") return null;
  return {
    at,
    hook,
    reason,
    session: typeof session === "string" ? session : "",
    tool: typeof tool === "string" ? tool : "",
  };
}

/**
 * The poller. It holds only offsets, fingerprints and the last seen lists: no fact is kept
 * beyond what is needed to tell the next poll what changed.
 */
export function createLiveSources(deps: LiveSourcesDeps): LiveSources {
  let timer: null | ReturnType<typeof setInterval> = null;
  let running = false;
  let recent: null | string[] = null;
  let stateText: null | string = null;
  let updateText: null | string = null;
  let jobsText: null | string = null;
  /** The ask log's place, and whether the first poll has taken its baseline yet. */
  let guardOffset = 0;
  let guardSeeded = false;
  /** Each repository's crew log place; `seeded` says the first poll took every baseline. */
  const offsets = new Map<string, number>();
  let crewSeeded = false;
  let repos: { at: number; list: string[] } | null = null;

  /** A file's text, or null when it is not there or cannot be read. */
  function textOf(file: string): null | string {
    try {
      return readFileSync(file, "utf8");
    } catch {
      return null;
    }
  }

  async function pollRouter(): Promise<void> {
    const port = deps.routerPort();
    if (port === null) {
      recent = null;
      return;
    }
    const health = await routerHealth(port, deps.fetch);
    if ("error" in health) return;
    const entries = recentOf(health.body);
    const fingerprints = entries.map(fingerprintOf);
    if (recent === null) {
      // A page that connects now fetches its facts; the feed starts with the next request.
      recent = fingerprints;
      return;
    }
    const last = recent[recent.length - 1];
    const at = last === undefined ? -1 : fingerprints.lastIndexOf(last);
    const fresh = at >= 0 ? entries.slice(at + 1) : entries.slice(-Math.min(entries.length, 50));
    for (const entry of fresh) {
      const read = recentEntryOf(entry);
      if (read !== null) deps.publish("recent", read);
    }
    recent = fingerprints;
  }

  function pollState(): void {
    const text = textOf(deps.paths.gatewayStateFile);
    if (text === stateText) return;
    stateText = text;
    const state = text === null ? null : parseLimitState(text);
    deps.publish("state", {
      breakers: state?.breakers ?? {},
      fallbacks: state?.fallbacks ?? {},
      limits: state?.limits ?? {},
      seenClaude: state?.seenClaude ?? {},
    });
  }

  /** Every repository with a crew store, or null when the store cannot be read (not a "none"). */
  function crewRepos(): null | string[] {
    const now = deps.now();
    if (repos !== null && now - repos.at < REPOS_TTL_MS) return repos.list;
    let list: string[] = [];
    try {
      list = [...new Set(listAllCrew(deps.paths.stateDir).records.map((record) => record.repo))];
    } catch {
      // A store that cannot be read is doctor's to report: no crew events this poll, and the
      // first poll has not taken its baseline.
      return null;
    }
    repos = { at: now, list };
    return list;
  }

  /**
   * The crew logs, tailed by offset. **The first poll only records where each log ends**: the
   * history before the portal started is not news, and publishing it as a burst of live events
   * would make every page read the whole store again. A repository seen for the first time
   * *after* that baseline reads from its start, because its log is news (a new project's first
   * crew session); `pollRouter` seeds its own baseline the same way.
   */
  function pollCrew(): void {
    const list = crewRepos();
    if (list === null) return;
    const seeding = !crewSeeded;
    for (const repo of list) {
      try {
        // No log yet reads as 0, which is its end: the first event there is news.
        const offset = seeding
          ? eventsEndOffset(deps.paths.stateDir, repo)
          : (offsets.get(repo) ?? 0);
        offsets.set(repo, offset);
        if (seeding) continue;
        const read = readCrewEvents(deps.paths.stateDir, repo, offset);
        offsets.set(repo, read.offset);
        for (const event of read.events) deps.publish("crew", event);
      } catch {
        // One repository's log cannot be read: the next poll tries again.
      }
    }
    crewSeeded = true;
  }

  function pollGuard(): void {
    const file = askLogFile(deps.paths.stateDir);
    let bytes: Buffer;
    try {
      bytes = readFileSync(file);
    } catch {
      // No log yet: its first line is news when it appears, so the baseline is its start.
      if (!guardSeeded) {
        guardSeeded = true;
        guardOffset = 0;
      }
      return;
    }
    // The first read only records the place: a portal start publishes the asks from now on,
    // never the whole log.
    if (!guardSeeded) {
      guardSeeded = true;
      guardOffset = bytes.length;
      return;
    }
    // A cut-back log (the frame keeps its newer half) starts again: the offset would be past
    // the end of a smaller file, and the new lines are the file's own.
    if (bytes.length < guardOffset) guardOffset = 0;
    if (bytes.length === guardOffset) return;
    const fresh = bytes.subarray(guardOffset).toString("utf8");
    guardOffset = bytes.length;
    for (const line of fresh.split("\n")) {
      if (line.trim() === "") continue;
      try {
        const ask = guardAskOf(JSON.parse(line));
        if (ask !== null) deps.publish("guard-ask", ask);
      } catch {
        // A line the log cannot use is counted by the report, not sent to a page.
      }
    }
  }

  function pollUpdate(): void {
    const last = readLastCheck(updateFiles(deps.paths.stateDir));
    const text = last === null ? null : JSON.stringify(last);
    if (text === updateText) return;
    updateText = text;
    deps.publish("update", { last });
  }

  async function pollJobs(): Promise<void> {
    const text = jobsFingerprint(deps.paths.home);
    if (text === jobsText) return;
    jobsText = text;
    try {
      deps.publish("jobs", await deps.jobs());
    } catch (error) {
      deps.publish("jobs", { error: error instanceof Error ? error.message : String(error) });
    }
  }

  async function pollOnce(): Promise<void> {
    if (running) return;
    running = true;
    try {
      await pollRouter();
      pollState();
      pollCrew();
      pollGuard();
      pollUpdate();
      await pollJobs();
    } finally {
      running = false;
    }
  }

  return {
    pollOnce,
    start: () => {
      if (timer !== null) return;
      timer = setInterval(() => {
        void pollOnce();
      }, deps.pollMs ?? LIVE_POLL_MS);
      // A timer never keeps the process (or a test) alive by itself: the server does.
      timer.unref?.();
    },
    stop: () => {
      if (timer !== null) clearInterval(timer);
      timer = null;
    },
  };
}
