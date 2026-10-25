/**
 * Waiting out a limit (D42): a crew session pauses when a model limit ends its turn, and the
 * lead's watch resumes it once the gateway answers again.
 *
 * **The pause** (`crew-role`'s StopFailure answer): in a crew session, a stop with `error`
 * `rate_limit`, `overloaded` or `server_error` marks the record `paused`, with `waitingFor`
 * taken from the router's state file (`src/gateway/limit-state.ts`), in this order:
 *   - `slot`: the slot the crew session's model reaches has a current breaker record — every
 *     target limited or down, the router holding its requests (`isCapacityFailure`);
 *   - `claude-limit`: a current plan limit — the session's own model first, else the freshest
 *     limit of a model whose family has a slot (`familySlotFor`), as the StopFailure alert
 *     reads it;
 *   - `unknown`: nothing the state file explains.
 *
 * **No time limit** (the owner): the watch never fails a paused crew session for waiting, and
 * the crew session's own settings turn Claude Code's retry watchdog on with no `…_MAX_WAIT_MS`
 * (`src/crew/start.ts`, the keys from `src/setup/retry-watchdog.ts`). What still ends waits
 * here, and no wait is given up on.
 *
 * **The resume** (`src/crew/watch.ts`), one crew session at a time:
 *   - never while the slot's breaker is open or the model's limit is current;
 *   - a slot's breaker record closed (a target answered), or the slot's first target in use is
 *     no longer a target that rests (the chain changed);
 *   - a Claude limit's reset time passed, plus `LIMIT_RESET_JITTER_MS`, and the router dropped
 *     its record (Anthropic answered the model again);
 *   - an `unknown` wait: the backoff alone, and no breaker or limit that would explain it now;
 *   - one first (the canary); the next no sooner than `RESUME_SPACING_MS` after it, and only
 *     after the router answered a request since — its health page's request count grew, and
 *     the state file's closed breaker or dropped limit is that answer when the page is not
 *     there;
 *   - a crew session that pauses again within `REPAUSE_WINDOW_MS` waits 5, then 10, then 20
 *     minutes (`lastPause.backoffMs`) before it may go again — no storm of resumes.
 *
 * **The transport is `crew answer`'s** (`resumeSession` and the watch's `resumeOne`, one home): a
 * message for a session whose process still lives (the CLI prints the `SendMessage` line, because
 * only a session holds that tool), and `claude --bg --resume <id> "<text>"` — in its worktree,
 * with the record's own settings and MCP files — for one whose session has no process. `crew
 * resume --paused` is the person's way at once — after `/login` on another account.
 */
import { readFileSync } from "node:fs";
import type { CliPaths } from "../cli/paths";
import { slotShortName } from "../gateway/breaker";
import {
  fallbackOn,
  type GatewayConfig,
  loadConfigFile,
  profileNames,
  profileView,
} from "../gateway/config";
import { type HealthFetch, routerHealth } from "../gateway/health";
import {
  type BreakerRecord,
  currentBreakers,
  currentLimits,
  emptyLimitState,
  formatClock,
  type LimitRecord,
  type LimitState,
  parseLimitState,
  scopeOfStateKey,
  stateKeyFor,
} from "../gateway/limit-state";
import { familySlotFor, targetsInUse, withoutContextSuffix } from "../gateway/targets";
import type { CrewRecord, WaitingFor } from "./store";

/**
 * The shortest gap between two crew sessions the watch resumes: the first is the canary, and
 * the next one waits this long and for the router's own answer.
 */
export const RESUME_SPACING_MS = 30_000;

/** What a re-pause within `REPAUSE_WINDOW_MS` waits, and how it doubles: 5 → 10 → 20 minutes. */
export const FIRST_BACKOFF_MS = 5 * 60_000;
export const MAX_BACKOFF_MS = 20 * 60_000;

/** A pause this soon after the one before it is the same trouble: its hold-off doubles. */
export const REPAUSE_WINDOW_MS = 15 * 60_000;

/**
 * How long after a Claude limit's reset time the watch waits before it resumes: Anthropic may
 * lift the limit a little late (the research asks for 1 to 2 minutes; this is their middle).
 */
export const LIMIT_RESET_JITTER_MS = 90_000;

/**
 * The StopFailure errors that pause a crew session: the plan's limit and a short rate limit
 * (`rate_limit`), an overloaded model, and a server error. `overloaded_error` is the longer
 * spelling Claude Code uses in its own words ("overloaded_error" in the StopFailure input of
 * the notifier's tests), and `overloaded` is the short one the breaker research lists; both
 * pause, so a change of spelling never loses the pause.
 */
export const CREW_PAUSE_ERRORS = [
  "rate_limit",
  "overloaded",
  "overloaded_error",
  "server_error",
] as const;

/** True when a StopFailure with this `error` pauses a crew session; false narrows `error` away. */
export function pausesCrew(error: null | string): error is string {
  return error !== null && (CREW_PAUSE_ERRORS as readonly string[]).includes(error);
}

/** What the gateway says now about the pauses a crew session waits out. */
export interface WaitFacts {
  /** The breakers current at the time read, by slot (`currentBreakers`, or the live health answer). */
  breakers: Record<string, BreakerRecord>;
  /** The plan limits current at the time read, by Claude model (`currentLimits`). */
  limits: Record<string, LimitRecord>;
  /**
   * Each slot's targets in use now — the whole chain while its fallback switch is on, its
   * first target alone while it is off (`targetsInUse`). Null when there is no readable
   * gateway config: the watch then cannot say a chain changed.
   */
  inUse: null | Record<string, string[]>;
}

/** What the watch reads from the gateway: the wait's facts, and the router's own request count. */
export interface GatewayNow extends WaitFacts {
  /**
   * The requests the router has handled since it started, from its health page; null when the
   * page did not answer (no router, no config). A count that grew is the router answering.
   */
  requests: null | number;
}

/** The state file, as it reads: a file that is missing or cannot be parsed says nothing. */
function readState(file: string): LimitState {
  try {
    return parseLimitState(readFileSync(file, "utf8")) ?? emptyLimitState();
  } catch {
    return emptyLimitState();
  }
}

/** The current breaker records, keyed by slot. */
export function breakersBySlot(state: LimitState, nowMs: number): Record<string, BreakerRecord> {
  return Object.fromEntries(currentBreakers(state, nowMs));
}

/** The current plan limits, keyed by model. */
export function limitsByModel(state: LimitState, nowMs: number): Record<string, LimitRecord> {
  return Object.fromEntries(currentLimits(state, nowMs));
}

/**
 * The pause's facts from the router's state file alone: what `crew-role` reads when a turn ends.
 * The config is not read — a pause follows a failure, and the failure is what the file records.
 */
export function readWaitFacts(paths: Pick<CliPaths, "gatewayStateFile">, nowMs: number): WaitFacts {
  const state = readState(paths.gatewayStateFile);
  return {
    breakers: breakersBySlot(state, nowMs),
    inUse: null,
    limits: limitsByModel(state, nowMs),
  };
}

/**
 * The targets each slot would use now, from the config, keyed like the breakers are (the
 * router's state key: `<slot>` for the machine's chain, `<profile>/<slot>` for a profile's —
 * a profile's view of the machine's config, so a slot it does not name shows the machine's
 * chain under its own key too).
 */
export function targetsNow(config: GatewayConfig): Record<string, string[]> {
  const inUse = (view: GatewayConfig, profile: null | string): [string, string[]][] =>
    Object.entries(view.slots).map(([slot, chain]) => [
      stateKeyFor(slot, profile),
      targetsInUse(chain, fallbackOn(view, slot)),
    ]);
  return Object.fromEntries([
    ...inUse(config, null),
    ...profileNames(config).flatMap((name) => {
      const view = profileView(config, name);
      return view === null ? [] : inUse(view, name);
    }),
  ]);
}

/** What the health page's answer says, when it is this router's; null for anything else. */
export function healthNow(
  body: unknown,
  nowMs: number,
): null | { breakers: Record<string, BreakerRecord>; requests: number } {
  if (typeof body !== "object" || body === null) return null;
  const page = body as Record<string, unknown>;
  const requests = page.requests;
  if (page.ok !== true || typeof requests !== "number" || !Number.isFinite(requests)) return null;
  const breakers: Record<string, BreakerRecord> = {};
  const listed = page.breakers;
  if (typeof listed === "object" && listed !== null) {
    for (const [slot, value] of Object.entries(listed as Record<string, unknown>)) {
      if (typeof value !== "object" || value === null) continue;
      const one = value as Record<string, unknown>;
      if (typeof one.since !== "number" || !Array.isArray(one.targets)) continue;
      const targets = one.targets.flatMap((target) => {
        if (typeof target !== "object" || target === null) return [];
        const t = target as Record<string, unknown>;
        if (typeof t.target !== "string" || typeof t.until !== "number") return [];
        return [
          {
            status: typeof t.status === "number" ? t.status : null,
            target: t.target,
            until: t.until,
          },
        ];
      });
      breakers[slot] = {
        held: typeof one.held === "number" ? one.held : 0,
        // The health page has no `lastAt`: it answered now, and the breaker is open now.
        lastAt: nowMs,
        since: one.since,
        targets,
      };
    }
  }
  return { breakers, requests: Math.max(0, Math.floor(requests)) };
}

/**
 * What the gateway says now: the state file, the slot chains the config holds, and — when the
 * config names a port — the router's live health page, whose breakers are fresher than the
 * file's and whose request count is how the watch knows a request was answered since.
 *
 * A test hands in its own `fetch`: no test reaches a real router's port
 * (`.claude/rules/testing.md` § Never the live router's port).
 */
export async function gatewayNow(
  paths: Pick<CliPaths, "gatewayConfigFile" | "gatewayStateFile">,
  nowMs: number,
  fetchImpl?: HealthFetch,
): Promise<GatewayNow> {
  const state = readState(paths.gatewayStateFile);
  let config: GatewayConfig | null = null;
  try {
    config = loadConfigFile(paths.gatewayConfigFile);
  } catch {
    // No gateway set up, or a config that cannot be read: no chain to judge, no port to ask.
    config = null;
  }
  let breakers = breakersBySlot(state, nowMs);
  let requests: null | number = null;
  if (config !== null) {
    const health = await routerHealth(config.port, fetchImpl);
    if ("body" in health) {
      const page = healthNow(health.body, nowMs);
      if (page !== null) {
        // The router's own memory is the truth while it answers: its record in the file is
        // written at most once a minute, and a record a stopped router left goes stale.
        breakers = page.breakers;
        requests = page.requests;
      }
    }
  }
  return {
    breakers,
    inUse: config === null ? null : targetsNow(config),
    limits: limitsByModel(state, nowMs),
    requests,
  };
}

/** An ISO 8601 time, as a record writes it. */
function iso(atMs: number): string {
  return new Date(atMs).toISOString();
}

/** `text` on one line, at most 40 characters: a record's line never carries more. */
function oneLine(text: string): string {
  const one = text.replace(/\s+/g, " ").trim();
  return one.length <= 40 ? one : `${one.slice(0, 39)}…`;
}

/**
 * The plan limit that explains the stop: the session's own model first (the model that
 * answered it, or the name it was launched with), else the freshest current limit of a model
 * whose family has a slot — the rule the StopFailure alert uses.
 */
export function limitForStop(
  record: CrewRecord,
  limits: Record<string, LimitRecord>,
): undefined | [string, LimitRecord] {
  for (const name of [record.model.resolved, record.model.named]) {
    const model = withoutContextSuffix(name);
    const found = limits[model];
    if (found !== undefined) return [model, found];
  }
  return Object.entries(limits)
    .filter(([model]) => familySlotFor(model) !== null)
    .sort(([, a], [, b]) => b.seenAt - a.seenAt)[0];
}

/**
 * What a stop of `record` waits for, recorded on its pause: the slot's breaker first, then
 * Claude's plan limit, else `unknown`. Every wait starts now.
 *
 * `profile` is the profile the crew session's URL names (`…/p/<name>`), null for the machine's
 * chains: the router keeps a profile's breaker under `<profile>/<slot>` (`stateKeyFor`), so a
 * session in a profile project looks for that key and never takes the machine's breaker, or
 * another profile's, for its own. A `slot` wait's `slot` holds that key; `waitOver` and
 * `pauseText` read it back with `scopeOfStateKey`.
 */
export function waitFor(
  record: CrewRecord,
  facts: WaitFacts,
  nowMs: number,
  profile: null | string = null,
): WaitingFor {
  const slot = record.model.slot === null ? null : stateKeyFor(record.model.slot, profile);
  const breaker = slot === null ? undefined : facts.breakers[slot];
  if (slot !== null && breaker !== undefined) {
    return { kind: "slot", since: iso(breaker.since), slot };
  }
  const limit = limitForStop(record, facts.limits);
  if (limit !== undefined) {
    return {
      kind: "claude-limit",
      model: limit[0],
      resetsAt: limit[1].resetsAt === null ? null : iso(limit[1].resetsAt * 1000),
    };
  }
  return { kind: "unknown", since: iso(nowMs), ...(slot === null ? {} : { slot }) };
}

/**
 * How long the watch holds off before it may resume a crew session that paused now: 0 on a
 * first pause, then 5, 10 and 20 minutes while pauses come within `REPAUSE_WINDOW_MS` of each
 * other. `previous` is the record's `lastPause`, from the pause before this one.
 */
export function pauseBackoff(
  previous: undefined | { backoffMs: number; since: string },
  nowMs: number,
): number {
  if (previous === undefined) return 0;
  const since = Date.parse(previous.since);
  if (!Number.isFinite(since) || nowMs - since >= REPAUSE_WINDOW_MS) return 0;
  if (previous.backoffMs <= 0) return FIRST_BACKOFF_MS;
  return Math.min(previous.backoffMs * 2, MAX_BACKOFF_MS);
}

/** The pause's `lastPause`: when it began, and the hold-off it carries. */
export function lastPauseOf(
  previous: undefined | { backoffMs: number; since: string },
  nowMs: number,
): {
  backoffMs: number;
  since: string;
} {
  return { backoffMs: pauseBackoff(previous, nowMs), since: iso(nowMs) };
}

/**
 * The line the watch shows when a crew session pauses (it is the `state` event's text):
 * `worker slot limited since 21:05; goes on by itself when it answers`.
 */
export function pauseText(
  waiting: WaitingFor,
  error: string,
  nowMs: number,
  timeZone?: string,
): string {
  const goesOn = "goes on by itself when it answers";
  switch (waiting.kind) {
    case "slot": {
      const { profile, slot } = scopeOfStateKey(waiting.slot);
      const where = profile === null ? "slot" : `slot in profile ${profile}`;
      return `${slotShortName(slot)} ${where} limited since ${formatClock(Math.floor(Date.parse(waiting.since) / 1000), nowMs, timeZone)}; ${goesOn}`;
    }
    case "claude-limit": {
      const reset =
        waiting.resetsAt === null
          ? "at its limit, no reset time named"
          : `at its limit, resets ${formatClock(Math.floor(Date.parse(waiting.resetsAt) / 1000), nowMs, timeZone)}`;
      return `${waiting.model} is ${reset}; ${goesOn} once the limit lifts`;
    }
    default:
      // The error is Claude Code's own word (`server_error`); one line of it at most.
      return `it stopped on ${oneLine(error)}; the watch goes on with it once a model answers`;
  }
}

/**
 * The moment the pause began (ms): its `lastPause`, else the wait's own `since`, else when the
 * record last changed (a `claude-limit` wait a kit wrote before `lastPause`). The watch resumes
 * the oldest wait first.
 */
export function pauseStartedAt(record: CrewRecord): number {
  const waiting = record.waitingFor;
  const since =
    record.lastPause?.since ??
    (waiting?.kind === "slot" || waiting?.kind === "unknown" ? waiting.since : null);
  const at =
    since === null || since === undefined ? Date.parse(record.updatedAt) : Date.parse(since);
  return Number.isFinite(at) ? at : 0;
}

/**
 * True when the watch may resume a paused crew session: the pause's hold-off is over, and the
 * gateway no longer says the wait goes on. Never true while the slot's breaker is open or the
 * model's limit is current.
 */
export function waitOver(record: CrewRecord, facts: WaitFacts, nowMs: number): boolean {
  const waiting: WaitingFor = record.waitingFor ?? { kind: "unknown", since: record.updatedAt };
  const backoff = record.lastPause?.backoffMs ?? 0;
  if (nowMs < pauseStartedAt(record) + backoff) return false;
  switch (waiting.kind) {
    case "slot": {
      const breaker = facts.breakers[waiting.slot];
      // No current record: a target answered (the breaker closes only on an answer), or the
      // slot left the config or was switched off. Either way its requests go somewhere now.
      if (breaker === undefined) return true;
      const inUse = facts.inUse?.[waiting.slot];
      if (inUse === undefined) return false;
      // The chain changed so its first target in use is not one that rests: the next request
      // does not meet a target the breaker recorded.
      const first = inUse[0];
      return first !== undefined && !breaker.targets.some((one) => one.target === first);
    }
    case "claude-limit": {
      if (facts.limits[waiting.model] !== undefined) return false;
      if (waiting.resetsAt === null) return true;
      const reset = Date.parse(waiting.resetsAt);
      return Number.isFinite(reset) && nowMs >= reset + LIMIT_RESET_JITTER_MS;
    }
    default: {
      // Nothing the pause named: no breaker on its slot, no limit on its model, and the
      // backoff has passed. The slot is the key the pause looked under (`<profile>/<slot>` in
      // a profile): the machine's breaker is another session's.
      const limited = [record.model.resolved, record.model.named].some(
        (name) => facts.limits[withoutContextSuffix(name)] !== undefined,
      );
      const key = waiting.slot ?? record.model.slot;
      return (key === null || facts.breakers[key] === undefined) && !limited;
    }
  }
}

/**
 * True when the router answered a request since the resume `before` (its health page's count
 * then): the count grew. With no page (no router, a test's own facts) the state file's own
 * record is the evidence — the watch reaches this only with a pause that is over, and a
 * breaker closes and a limit drops only when the router recorded an answer.
 */
export function routerAnsweredSince(now: GatewayNow, before: null | number): boolean {
  if (now.requests === null || before === null) return true;
  return now.requests > before;
}

/**
 * The text a resumed crew session gets as its next prompt: what changed, and that it goes on.
 * It names the phase, so a session resumed after a long wait reads what it was doing.
 */
export function resumeText(
  record: CrewRecord,
  waiting: undefined | WaitingFor,
  nowMs: number,
  timeZone?: string,
): string {
  let what = "a model answers again";
  if (waiting?.kind === "slot") {
    what = `${slotShortName(waiting.slot)} answers again`;
  } else if (waiting?.kind === "claude-limit") {
    what =
      waiting.resetsAt === null
        ? "Claude's limit lifted"
        : `Claude's limit reset at ${formatClock(Math.floor(Date.parse(waiting.resetsAt) / 1000), nowMs, timeZone)}`;
  }
  return `The wait is over: ${what}. Go on with phase ${record.phase}, then hand it back as usual.`;
}
