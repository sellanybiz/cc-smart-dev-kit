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
 *     reads it — **only when that Claude model answers the session first** (`claudeLimitHolds`:
 *     a session on Claude itself, or a slot whose chain in use starts with that model). On a
 *     slot whose chain starts with a backend, the Claude model is only a fallback — one empty
 *     answer from the backend can fall through to Claude's 429 — so the session waits for its
 *     slot (a `slot` wait from now), never for a Claude reset days away (the 2026-10-25 pause);
 *   - `unknown`: nothing the state file explains.
 *
 * **The safety-checks pause** (`crew-role`'s Stop answer, owner 2026-10-27): when auto mode's
 * safety checks get no verdict for the crew session's own gateway scope (the router's
 * `checksDown` record, `src/gateway/checks-down.ts`), Claude Code denies every tool call that
 * needs a check, `crew report` included, so a turn that ends with no report is not the session's
 * fault. It is marked `paused` with a `safety-checks` wait (`checksWait`) instead of being
 * blocked for its report, and its line is the checks' own reason (`checksPauseText`).
 *
 * The same write keeps the error on the record (`lastApiError`: class, text, time), and the
 * pause's line ends with its text (`pauseText`), so the lead can tell a provider that failed from
 * a plan that ran out. A stop whose class is a backend's refusal (`isBackendRefusal`) pauses
 * nothing: no limit or breaker explains it and the same request would be refused again, so the
 * watch tells the lead and stops the session instead (`src/crew/watch.ts`).
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
 *     its record (Anthropic answered the model again). A `claude-limit` wait an older kit
 *     recorded for a slot whose chain starts elsewhere is judged as that slot's wait;
 *   - a `safety-checks` wait: the router's record for its scope is gone (a check got a verdict)
 *     or no longer current (`currentChecksDown`: 15 minutes after the last check that failed);
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
import { checksDownText, type DownProfile } from "../gateway/checks-down";
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
  type ChecksDownRecord,
  currentBreakers,
  currentChecksDown,
  currentLimits,
  emptyLimitState,
  formatClock,
  type LimitRecord,
  type LimitState,
  parseLimitState,
  scopeOfStateKey,
  stateKeyFor,
} from "../gateway/limit-state";
import { familySlotFor, JUDGE_SLOT, targetsInUse, withoutContextSuffix } from "../gateway/targets";
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

/**
 * The StopFailure classes that are a backend's refusal, not a crash: `unknown` — what Claude Code
 * calls the answer of a router that refused the request (a 424, `src/gateway/refusal.ts`) — and
 * `model_not_found`. Agent view shows every class outside its fixed list as `failed` with the
 * words "API error" (read from the 2.1.310 binary), so the state alone cannot tell a refusal from
 * a dead session; the class the hook stored on the record (`lastApiError`) can. A refusal is
 * told to the lead with the router's own reason and leaves the session resumable
 * (`src/crew/watch.ts`); any other class stays a failure.
 */
export const BACKEND_REFUSAL_ERRORS = ["unknown", "model_not_found"] as const;

/** True when a stored API error class is a backend's refusal (`BACKEND_REFUSAL_ERRORS`). */
export function isBackendRefusal(errorClass: string): boolean {
  return (BACKEND_REFUSAL_ERRORS as readonly string[]).includes(errorClass);
}

/** The longest piece of an API error's text a pause's line carries. */
const PAUSE_DETAIL_CHARS = 100;

/** `text` on one line, cut to `max` characters with an ellipsis. */
function clipped(text: string, max: number): string {
  const one = text.replace(/\s+/g, " ").trim();
  return one.length <= max ? one : `${one.slice(0, max - 1)}…`;
}

/** What the gateway says now about the pauses a crew session waits out. */
export interface WaitFacts {
  /** The breakers current at the time read, by slot (`currentBreakers`, or the live health answer). */
  breakers: Record<string, BreakerRecord>;
  /** The plan limits current at the time read, by Claude model (`currentLimits`). */
  limits: Record<string, LimitRecord>;
  /**
   * Auto mode's safety checks failing at the time read, by the judge's state key
   * (`currentChecksDown`): what a `safety-checks` wait waits out.
   */
  checksDown: Record<string, ChecksDownRecord>;
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

/** The gateway's config, or null when there is none or it cannot be read. */
function readConfig(file: string): GatewayConfig | null {
  try {
    return loadConfigFile(file);
  } catch {
    // No gateway set up, or a config that cannot be read: no chain to judge, no port to ask.
    return null;
  }
}

/**
 * The pause's facts: what `crew-role` reads when a turn ends. The router's state file says what
 * failed; the config says which target each slot's chain starts with, so a Claude limit is not
 * read as the wait of a slot whose chain starts with a backend (`claudeLimitHolds`).
 */
export function readWaitFacts(
  paths: Pick<CliPaths, "gatewayConfigFile" | "gatewayStateFile">,
  nowMs: number,
): WaitFacts {
  const state = readState(paths.gatewayStateFile);
  const config = readConfig(paths.gatewayConfigFile);
  return {
    breakers: breakersBySlot(state, nowMs),
    checksDown: checksDownByKey(state, nowMs),
    inUse: config === null ? null : targetsNow(config),
    limits: limitsByModel(state, nowMs),
  };
}

/** The current safety-check records, keyed by the judge's state key. */
export function checksDownByKey(
  state: LimitState,
  nowMs: number,
): Record<string, ChecksDownRecord> {
  return Object.fromEntries(currentChecksDown(state, nowMs));
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
  const config = readConfig(paths.gatewayConfigFile);
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
    // The health page does not carry them: the state file is the one record of failing checks.
    checksDown: checksDownByKey(state, nowMs),
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
 * True when a plan limit of the Claude model `model` holds a session whose chain in use is under
 * `key` (its slot's state key: `<profile>/<slot>` in a profile, `stateKeyFor`): it runs on Claude
 * itself (no key), that chain is not known (no readable config, or the key is not in it), or the
 * chain starts with that model. A chain that starts with another target answers with that
 * target, and the Claude model is only its fallback: its limit says nothing about when the
 * session's own model answers again (the 2026-10-25 pause).
 */
export function claudeLimitHolds(
  key: null | string,
  model: string,
  inUse: WaitFacts["inUse"],
): boolean {
  const first = key === null ? undefined : inUse?.[key]?.[0];
  return first === undefined || withoutContextSuffix(first) === model;
}

/**
 * The waits a model limit ends a turn with (StopFailure): every kind but `safety-checks`, which
 * only the Stop answer records (`checksWait`).
 */
export type LimitWait = Exclude<WaitingFor, { kind: "safety-checks" }>;

/**
 * What a stop of `record` waits for, recorded on its pause: the slot's breaker first, then
 * Claude's plan limit when it holds the session (`claudeLimitHolds`), else `unknown`. A Claude
 * limit that does not hold it — its slot's chain starts with a backend — makes it wait for its
 * slot to answer again. Every wait starts now.
 *
 * `profile` is the profile the crew session's URL names (`…/p/<name>`), null for the machine's
 * chains: the router keeps a profile's breaker under `<profile>/<slot>` (`stateKeyFor`), so a
 * session in a profile project looks for that key and never takes the machine's breaker, or
 * another profile's, for its own. A `slot` wait's `slot` holds that key; `waitOver` and
 * `pauseText` read it back with `scopeOfStateKey`. The chain `claudeLimitHolds` reads is the one
 * under that key too: the profile's, when the session is in one.
 */
export function waitFor(
  record: CrewRecord,
  facts: WaitFacts,
  nowMs: number,
  profile: null | string = null,
): LimitWait {
  const slot = record.model.slot === null ? null : stateKeyFor(record.model.slot, profile);
  const breaker = slot === null ? undefined : facts.breakers[slot];
  if (slot !== null && breaker !== undefined) {
    return { kind: "slot", since: iso(breaker.since), slot };
  }
  const limit = limitForStop(record, facts.limits);
  if (limit !== undefined && claudeLimitHolds(slot, limit[0], facts.inUse)) {
    return {
      kind: "claude-limit",
      model: limit[0],
      resetsAt: limit[1].resetsAt === null ? null : iso(limit[1].resetsAt * 1000),
    };
  }
  if (slot !== null && limit !== undefined) return { kind: "slot", since: iso(nowMs), slot };
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
 * `worker slot limited since 21:05; goes on by itself when it answers`. `detail` is the text of
 * the error Claude Code showed (`lastApiError.text`): it ends the line as `· <error>: <text>`, so
 * the lead can tell a stall from a limit — an `unknown` wait that says "500 Internal Server
 * Error" is a provider that failed, not a plan that ran out.
 */
export function pauseText(
  waiting: LimitWait,
  error: string,
  nowMs: number,
  timeZone?: string,
  detail: null | string = null,
): string {
  const goesOn = "goes on by itself when it answers";
  const said = detail === null || detail === "" ? "" : clipped(detail, PAUSE_DETAIL_CHARS);
  const because = said === "" ? "" : ` · ${oneLine(error)}: ${said}`;
  switch (waiting.kind) {
    case "slot": {
      const { profile, slot } = scopeOfStateKey(waiting.slot);
      const where = profile === null ? "slot" : `slot in profile ${profile}`;
      return `${slotShortName(slot)} ${where} limited since ${formatClock(Math.floor(Date.parse(waiting.since) / 1000), nowMs, timeZone)}; ${goesOn}${because}`;
    }
    case "claude-limit": {
      const reset =
        waiting.resetsAt === null
          ? "at its limit, no reset time named"
          : `at its limit, resets ${formatClock(Math.floor(Date.parse(waiting.resetsAt) / 1000), nowMs, timeZone)}`;
      return `${waiting.model} is ${reset}; ${goesOn} once the limit lifts${because}`;
    }
    default:
      // The error is Claude Code's own word (`server_error`); one line of it at most.
      return `it stopped on ${oneLine(error)}${said === "" ? "" : `: ${said}`}; the watch goes on with it once a model answers`;
  }
}

/**
 * The failing safety checks of a crew session's own gateway scope, as `[state key, record]`, or
 * null. `profile` is the profile the session's URL names (null: the machine's chains): the router
 * keeps the record under the judge's state key for that scope (`stateKeyFor(JUDGE_SLOT, …)`), so
 * a profile's failing checks never pause a session on the machine's chains, nor the other way.
 */
export function checksDownFor(
  checksDown: Record<string, ChecksDownRecord>,
  profile: DownProfile,
): null | [string, ChecksDownRecord] {
  const key = stateKeyFor(JUDGE_SLOT, profile);
  const record = checksDown[key];
  return record === undefined ? null : [key, record];
}

/** The `safety-checks` wait of a crew session whose checks fail under `key`, since they began. */
export function checksWait(key: string, record: ChecksDownRecord): WaitingFor {
  return { kind: "safety-checks", scope: key, since: iso(record.since) };
}

/**
 * The line the watch shows when the safety checks pause a crew session (its `state` event's
 * text): the checks' own words (`checksDownText`, one home with the status line, `gateway status`
 * and `doctor`), then that it goes on by itself. The fix is not in it: the lead reads the fix in
 * `gateway status` or `doctor`, and the crew session waits either way.
 */
export function checksPauseText(
  record: ChecksDownRecord,
  key: string,
  nowMs: number,
  timeZone?: string,
): string {
  const { profile } = scopeOfStateKey(key);
  return `${checksDownText(record, profile, nowMs, timeZone)}; goes on by itself when they answer again`;
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
    (waiting === undefined || waiting.kind === "claude-limit" ? null : waiting.since);
  const at =
    since === null || since === undefined ? Date.parse(record.updatedAt) : Date.parse(since);
  return Number.isFinite(at) ? at : 0;
}

/**
 * True when `slot` answers again: it has no current breaker record (a target answered — the
 * breaker closes only on an answer — or the slot left the config or was switched off), or its
 * chain changed so its first target in use is not one the breaker rests.
 */
function slotAnswers(slot: string, facts: WaitFacts): boolean {
  const breaker = facts.breakers[slot];
  if (breaker === undefined) return true;
  const first = facts.inUse?.[slot]?.[0];
  return first !== undefined && !breaker.targets.some((one) => one.target === first);
}

/**
 * True when the watch may resume a paused crew session: the pause's hold-off is over, and the
 * gateway no longer says the wait goes on. Never true while the slot's breaker is open, a
 * Claude limit that holds it (`claudeLimitHolds`) is current, or its safety checks still fail.
 */
export function waitOver(record: CrewRecord, facts: WaitFacts, nowMs: number): boolean {
  const waiting: WaitingFor = record.waitingFor ?? { kind: "unknown", since: record.updatedAt };
  const backoff = record.lastPause?.backoffMs ?? 0;
  if (nowMs < pauseStartedAt(record) + backoff) return false;
  switch (waiting.kind) {
    case "slot":
      return slotAnswers(waiting.slot, facts);
    case "claude-limit": {
      // A wait an older kit recorded for a slot whose chain starts with a backend: the limit
      // never held it, so it is that slot's wait. Such a wait names no profile, so the machine's
      // chain is the one read.
      const slot = record.model.slot;
      if (slot !== null && !claudeLimitHolds(slot, waiting.model, facts.inUse)) {
        return slotAnswers(slot, facts);
      }
      if (facts.limits[waiting.model] !== undefined) return false;
      if (waiting.resetsAt === null) return true;
      const reset = Date.parse(waiting.resetsAt);
      return Number.isFinite(reset) && nowMs >= reset + LIMIT_RESET_JITTER_MS;
    }
    case "safety-checks":
      // The router deletes the record when a check gets a verdict, and a record nobody refreshed
      // for 15 minutes is no longer current (`currentChecksDown`): either way, try again. A check
      // that still fails then pauses the session once more, with the doubled hold-off.
      return facts.checksDown[waiting.scope] === undefined;
    case "unknown": {
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
 * breaker closes and a limit drops only when the router recorded an answer. (A safety-checks
 * record may also just go stale; with no page the watch cannot tell, and the hold-off a re-pause
 * doubles is what keeps that from a storm.)
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
  } else if (waiting?.kind === "safety-checks") {
    what = "auto mode's safety checks answer again";
  }
  return `The wait is over: ${what}. Go on with phase ${record.phase}, then hand it back as usual.`;
}
