/**
 * cc-smart-dev-kit-router: the local AI gateway between Claude Code and the model providers.
 *
 * WHY IT EXISTS
 *   Routine subagents (search, reading, routine code) can run on affordable models; reviews
 *   and judgment stay on Claude. Claude Code points `ANTHROPIC_BASE_URL` here with NO
 *   gateway token, so every request carries the person's OWN Claude login: the pattern
 *   Anthropic documents for gateways. That login must only ever reach Anthropic.
 *
 * WHAT IT DOES, PER REQUEST
 *   - A path under `/p/<profile>` is split off first (`profileFromPath`), before every
 *     branch below, and the request answers with that profile's chains and switches
 *     (`profileView`); a name no profile holds answers as plain Claude, never an error
 *     (owner D29; § Profiles in docs/gateway.md). Claude Code keeps the whole path on
 *     every request, so this is the one place the prefix is known.
 *   - An old model name in the config's `aliases` is replaced by its slot or target
 *     first (`resolveAlias`), logged once per name.
 *   - `POST /v1/messages` (and `/count_tokens`) with a `claude-…` model whose family's slot
 *     is off, a model it does not know, and EVERY other path → Anthropic: method, path,
 *     query, body bytes and headers unchanged (only hop-by-hop headers, `host` and
 *     `content-length` are dropped). The answer streams back unbuffered, compressed bytes
 *     and all (`decompress: false`).
 *   - A `claude-…` model whose family's slot has a chain (`familySlotFor`: haiku → scout,
 *     sonnet → worker, opus → opus, fable → fable), and a slot key (`cc-smart-dev-kit-worker`)
 *     → the slot's targets in order (`targets.ts`), the same way for every slot. An
 *     affordable backend gets only an allow-list of headers plus its own key, and the body
 *     without `metadata` (it holds the account id). A `claude-…` target that is the model
 *     the request named gets the bytes as sent; another one goes to Anthropic with `model`
 *     changed, and only the fields that target refuses translated
 *     (`requestForClaudeFallback`). It moves to the next target only while the slot's
 *     fallback switch is on (`fallbackOn`), and only before an answer reaches Claude
 *     Code: a network error, a status `fallbackKind` names, or (on a streaming request to an
 *     affordable backend that is not the last target) no response headers or no first real
 *     event within `firstByteMs`, or an error event before the first real one. A target
 *     that answered 429 / 5xx rests a while (`cooldownSeconds`); the last target of a
 *     slot is always tried. A client that hangs up rests nothing. When the chain is used
 *     up, its last answer (or a 502) goes back: the router never adds a target of its
 *     own, Claude included. With the slot's breaker on (`breakerOn`) there is one
 *     exception: when every target failed for want of capacity and the last one is a
 *     backend, the request is held for a while (`./breaker.ts`) and then answered with a
 *     429 that Claude Code retries by itself; Anthropic's own answers always pass. A Claude
 *     target behind the first, resting at a plan limit the router knows, is not tried as the
 *     last target (the owner's D65, `chain`).
 *   - An explicit `<backend>:<model>` → that backend, no fallback.
 *   - Auto mode's safety check (`isAutoModeGuard`, on the request as it came, so an old
 *     name in `aliases` is seen too) → the `cc-smart-dev-kit-judge` slot's tested targets when
 *     it has a chain (`judgeTargetsOf`); with none, Claude: a `claude-…` check untouched,
 *     a slot-named one to that slot's Claude targets only, and one whose name leads to no
 *     Claude target (an affordable-only slot, or an alias to `<backend>:<model>`) to
 *     Anthropic as it was sent (`resolveRequestRoute`). Never to the slot of its model's
 *     family.
 *   - Every safety check is counted, by local day, in the router's state folder
 *     (`safety-checks.ts`): how many went through, who answered each, and the tokens its
 *     answer's `usage` reported. The answer passes to Claude Code byte for byte, and the
 *     count is read from a copy on the way; `cc-smart-dev-kit usage` shows the days.
 *   - Every Claude answer's headers (never its body) say whether the plan's usage limit
 *     was reached; the router writes that to its state file, for the status line and the
 *     StopFailure alert (`limit-state.ts`), with the slot whose next target answers while
 *     its first, a Claude model, is at that limit.
 *   - No prompt text is ever changed. An affordable backend gets only the named format
 *     translations below; a `claude-…` request reaches Anthropic as the bytes it came as,
 *     but for one named exception (the owner's D6): the thinking blocks a backend wrote,
 *     which the router marked in that backend's answer, leave every request to a Claude
 *     target (`forClaude`), because a Claude model refuses a signature it did not issue.
 *   - An affordable backend never sees Claude Code's tool search: `toolSearchForBackend`.
 *   - An affordable backend gets "no reasoning" in a form it reads: `reasoningOffForBackend`.
 *   - An affordable backend gets its own thinking blocks back as it wrote them, signature
 *     and all: `thinkingForBackend` (the router's mark carries that signature).
 *   - A redirect from an affordable backend becomes a 502: Claude Code must never follow a
 *     `Location` it chose. Anthropic's own redirects pass as they are.
 *   - Only this machine: it binds 127.0.0.1, refuses a foreign `Host` and any `Origin`
 *     (a web page in a browser), and on `/v1/messages` wants JSON and an
 *     `anthropic-version` header: a browser cannot send those without a CORS
 *     preflight, which this server never answers.
 *   - A slot's `claude-…` target, and an alias to a `claude-…` model, gets a body it
 *     accepts: Claude Code built it for another name, and Claude Sonnet 5.5 refuses some
 *     of its fields (`thinking: disabled`). A named translation,
 *     `requestForClaudeFallback`, changes only those; never `system` or a message. Never
 *     for auto mode's safety check, on any route: it reaches Claude with only `model`
 *     changed.
 *   - Its health page (`HEALTH_PATH`) answers what it holds, never a word of a request: the
 *     counts, the targets resting, the slots, the last `RECENT_MAX` requests it routed
 *     (`RecentRequest`: time, slot, target, status, milliseconds, whether a next target
 *     answered), and each Claude model id Claude Code sent (`seenClaude`, also in the state
 *     file, written only when an id is new).
 *   - One log line per request; never a header value, key or body. A WARN line when any
 *     target, Anthropic included, answers 4xx / 5xx to a model call carries the start of
 *     its error answer (its reason, never the request): 300 characters at most, keys and
 *     email addresses masked. It is written in the background: the client's answer never
 *     waits for the log.
 *   - On SIGTERM it stops taking requests and exits once the running ones finish.
 *     Under systemd, the socket unit holds the port meanwhile, so new connections wait
 *     for the next router instead of being refused (`startRouter`, `./listen.ts`).
 *
 * `createRouter` is the handler, with everything it touches passed in, so the tests
 * drive it with fake upstreams. `startRouter` serves it (`cc-smart-dev-kit gateway serve`, and
 * the systemd unit through `src/entries/router.ts`). The design: docs/gateway.md.
 */

import { mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
// From ./names, not the index: the index bakes in the version (bundles-and-releases.md).
import { COMMAND } from "../build-info/names";
import { atomicWrite } from "../setup/write";
import type { ListedModel } from "./backends";
import { listModels as listBackendModels } from "./backends";
import {
  BREAKER_HEARTBEAT_WAIT_MS,
  BREAKER_MAX_HELD,
  BREAKER_POLL_MS,
  BREAKER_RELEASED_RETRY_AFTER_SEC,
  BREAKER_REMINDER_MS,
  BREAKER_SHUTDOWN_RETRY_AFTER_SEC,
  type BreakerFailure,
  breakerAnswer,
  breakerChangeHint,
  capRetryAfter,
  clientRetryAfter,
  describeFailures,
  earliestRestSeconds,
  formatDuration,
  isCapacityFailure,
} from "./breaker";
import {
  BREAKER_HOLD_NON_STREAMING_MS,
  breakerHoldMs,
  breakerOn,
  effortPin,
  fallbackOn,
  type GatewayConfig,
  historyRetentionDays,
  judgeTargetUsable,
  messageOf,
  plainClaudeView,
  profileNames,
  profileView,
  watchConfig,
  workerJudgeTargets,
} from "./config";
import {
  cleanFallbackResponse,
  holdsRouterMark,
  thinkingForBackend,
  withoutRouterThinking,
} from "./fallback-answer";
import { createHistoryWriter, type HistoryRecorder, type HistoryRow } from "./history";
import { type BackendFetchOptions, backendFetch } from "./hosts";
import {
  currentBreakers,
  currentLimits,
  emptyLimitState,
  formatClock,
  formatLimitState,
  type LimitState,
  mergeSeenClaude,
  parseLimitState,
  scopeOfStateKey,
  stateKeyFor,
} from "./limit-state";
import { inheritedListenFd, innerSocketPath, LISTEN_VARS, listenOnFd, serveUnix } from "./listen";
import type { RouterPaths } from "./paths";
import { maskedLine, oneLine } from "./plain-text";
import { backendCost, claudeCost, type ModelPrice, priceFromModels } from "./prices";
import { backendRefusal, isRefusalStatus, REFUSAL_STATUS } from "./refusal";
import {
  AnswerUsageReader,
  addCheckTokens,
  type CheckSide,
  type CheckTokens,
  emptySafetyChecks,
  formatSafetyCheckState,
  localDay,
  parseSafetyCheckState,
  recordSafetyCheck,
  type SafetyCheckState,
} from "./safety-checks";
import {
  anthropicServerTool,
  claudeSearchNotice,
  claudeUnavailableWords,
  searchMessageAnswer,
  searchStreamAnswer,
} from "./server-tools";
import {
  type ClaudeFamily,
  type ClaudeVersion,
  capacityFailureStatus,
  claudeFamily,
  claudeVersion,
  cooldownSeconds,
  FAMILY_SLOTS,
  fallbackKind,
  familySlotFor,
  formatTarget,
  isAutoModeGuard,
  isClaudeModelId,
  JUDGE_SLOT,
  type PlanLimit,
  parseTarget,
  planUsageLimit,
  profileFromPath,
  resolveAlias,
  resolveRequestRoute,
  resolveRoute,
  type Target,
  targetsInUse,
  versionAtLeast,
  withoutContextSuffix,
} from "./targets";

/** What the router hands to `fetch` for one upstream call. */
export interface UpstreamInit {
  body: null | Uint8Array<ArrayBuffer>;
  /** Bun: keep the body compressed and `content-encoding` as sent — the client decodes. */
  decompress: false;
  headers: Headers;
  method: string;
  /**
   * `false` for a backend on this machine: its key goes straight there, never through a
   * proxy from the environment (`directIfLoopback`). Absent for any other upstream.
   */
  proxy?: false;
  /** A proxy passes a redirect on; it never follows one with the client's login. */
  redirect: "manual";
  signal: AbortSignal;
}

export type FetchLike = (url: string, init: UpstreamInit) => Promise<Response>;

export interface RouterDeps {
  /**
   * Where Claude traffic goes. Always Anthropic in use (the config allows nothing
   * else, so a config edit can never send the login elsewhere); a test passes a fake.
   */
  anthropicBaseUrl?: string;
  /**
   * Handed each piece of work the router does after an answer went to the client (the
   * error log lines). Each one handles its own errors; in use nothing waits for them. A
   * test passes a collector, to wait for every log line before it reads them.
   */
  background?: (task: Promise<void>) => void;
  /** Named in the error a request for an unknown slot gets. */
  configPath: string;
  /**
   * TESTS ONLY, never set in use: the answers a backend gives for a Claude model's request
   * reach Claude Code as that backend sent them, thinking blocks unmarked and all
   * (`cleanFallbackResponse` is skipped). It exists for the live proof that the marking is
   * needed (docs/claude-code-contract.md): an unmarked block is never removed on the way to
   * Claude.
   */
  fallbackAnswersAsIs?: boolean;
  fetch: FetchLike;
  getConfig: () => GatewayConfig;
  /**
   * Where each routed `/v1/messages` request's row goes (D51): `history.ts`'s writer in use,
   * a collector in a test. Absent: no history. `enabled()` false (the log is off) skips the
   * row and the reading of the answer's usage.
   */
  history?: HistoryRecorder;
  /**
   * A backend's model list, asked once per backend and refreshed rarely, for the price its
   * own list gives a history row (`prices.ts`). Called in the background, never on an
   * answer's path; absent: no backend price.
   */
  listModels?: (backend: { apiKey: string; baseUrl: string }) => Promise<ListedModel[]>;
  /**
   * The safety-check counts already on disk (`safety-checks.ts`), read once when the router
   * starts so a restart goes on counting the same days. Absent, or null: none yet.
   */
  loadSafetyChecks?: () => null | string;
  /**
   * The limit state file's text (`limit-state.ts`), read when the router starts, so a
   * restart (an update, a crash) keeps the plan limits and the fallbacks it saw, and its
   * next write keeps them too. Read again before a new Claude id is written (`seenClaude`),
   * which changes that one field of what the file holds. Absent, or null: none yet.
   */
  loadState?: () => null | string;
  log: (line: string) => void;
  /** Milliseconds since the epoch. */
  now: () => number;
  /** The port the server is bound to; the `Host` guard checks it. */
  port: number;
  /**
   * Writes the safety-check counts' text (`safety-checks.ts`). Called in the background,
   * never before an answer; it may throw, and the router logs that once. Absent: no file.
   */
  saveSafetyChecks?: (text: string) => void;
  /**
   * Writes the limit state file's text (`limit-state.ts`). Called in the background, never
   * before an answer; it may throw, and the router logs that once. Absent: no file.
   */
  saveState?: (text: string) => void;
  /**
   * Aborted when the router is told to stop (SIGTERM): every request the breaker holds is
   * answered at once with a short `retry-after`, so the drain stays short. Absent: never.
   */
  shutdown?: AbortSignal;
  /**
   * Waits `ms` milliseconds: how the breaker's hold passes its seconds. Absent: a timer. A test
   * passes one that moves its fake clock (`now`) instead of waiting.
   */
  sleep?: (ms: number) => Promise<void>;
}

/** How often a slot's fallback record's `lastAt` reaches the state file, at most: once a minute. */
const FALLBACK_SAVE_EVERY_MS = 60_000;

/** Words of an error answer that say a conversation was too long for a model. */
const TOO_LONG = /context|too long|too large|too many tokens|token limit|payload/i;

/** Words of an error answer that say a model refused a kind of content block. */
const UNSUPPORTED =
  /unsupported|not supported|unknown (?:content|block|type)|invalid (?:content|block) type|image|document|server_tool|web_search|web_fetch|tool_reference/i;

/** The words of Anthropic's 400 for a thinking block it cannot verify. */
const BAD_SIGNATURE = "Invalid `signature`";

/** Why an upstream call failed when it gave no headers by its deadline. */
const NO_HEADERS_IN_TIME = "no response headers in time";

/** Why a held stream failed when it gave no real event by its deadline. */
const NO_EVENT_IN_TIME = "no event in time (only heartbeats)";

/** Path of the router's own health check, answered before anything is forwarded. */
export const HEALTH_PATH = "/__cc-smart-dev-kit/health";

/**
 * What this router answers that a reader may rely on, as the health page's `features`. The
 * router carries no version, so a command or the portal tells a running router that knows a
 * feature from one that does not by this list, never by guessing. `profiles`: a project's
 * `…/p/<profile>` path names its own chains (owner D29, `docs/gateway.md` § Profiles).
 */
export const ROUTER_FEATURES = ["profiles"] as const;

/** How many routed requests the health answer lists (`recent`), the last ones first in. */
export const RECENT_MAX = 200;

/** How long a backend's model list (for a history row's price) is used before it is asked again. */
const PRICE_REFRESH_MS = 6 * 60 * 60 * 1000;

/**
 * A Claude Code session id as its header carries one (`x-claude-code-session-id`): letters,
 * digits, `.`, `_` and `-`, at most 128. Anything else is not stored: the history never
 * writes an arbitrary client header into its database.
 */
const SESSION_ID = /^[A-Za-z0-9._-]{1,128}$/;

/** The session id a request carried, or null. The one thing the history takes from a header. */
export function sessionIdOf(headers: Headers): null | string {
  const value = (headers.get("x-claude-code-session-id") ?? "").trim();
  return SESSION_ID.test(value) ? value : null;
}

/**
 * One request the router routed, as its health answer lists it (the portal's activity feed).
 * Metadata only: never a prompt, an answer, a key or a header.
 */
export interface RecentRequest {
  /** The effort actually sent when a pin applied; absent on an unpinned request. */
  effort?: string;
  effortPinned?: true;
  /** When it came in: milliseconds since the epoch. */
  at: number;
  /** How long until its answer started: milliseconds. */
  ms: number;
  /** A next target of the slot answered, or tried to: the first one did not. */
  nextTarget: boolean;
  /** The slot that answered it; null for a request no slot took (Anthropic as sent). */
  slot: null | string;
  /** The status Claude Code got. */
  status: number;
  /** Who answered, as the log names it: a target, `anthropic`, `none`, `refused`. */
  target: string;
}

const MESSAGES_PATH = "/v1/messages";
const COUNT_TOKENS_PATH = "/v1/messages/count_tokens";

/**
 * Headers that belong to one connection, not to the message (RFC 9110 § 7.6.1).
 * Every `proxy-…` header too, and any header the `connection` header names.
 */
const HOP_BY_HOP = new Set([
  "connection",
  "keep-alive",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

/**
 * The only client headers an affordable backend sees. Never `authorization`, `x-api-key`,
 * `cookie` or `anthropic-beta`: the first three carry the Claude login, the last
 * announces the OAuth capability.
 */
const BACKEND_HEADER_ALLOW_LIST = [
  "accept",
  "anthropic-version",
  "content-type",
  "user-agent",
  "x-claude-code-session-id",
];

/** A status whose response may not carry a body (the `Response` constructor refuses one). */
const NULL_BODY_STATUS = new Set([101, 103, 204, 205, 304]);

/** Anthropic's error shape — Claude Code reads its errors in this form. */
export function anthropicError(status: number, type: string, message: string): Response {
  return Response.json({ error: { message, type }, type: "error" }, { status });
}

/**
 * What Claude Code gets when the target that answers last is a backend refusing its own key
 * (401 or 403): an error in Anthropic's shape that names the backend and the check to run,
 * with `x-should-retry: false`. Never the 401 itself, which Claude Code reads as the person's
 * own login failing. A 400 is not retried (Claude Code 2.1.300), but since 2.1.304 it is sent
 * again without its deferred tools, so a model call gets `REFUSAL_STATUS` instead
 * (`./refusal.ts`); auto mode's safety check (`resendSafe` false) has no deferred tools and
 * keeps the 400. docs/claude-code-contract.md.
 */
export function backendKeyRefused(
  label: string,
  backend: string,
  status: number,
  resendSafe = true,
): Response {
  return Response.json(
    {
      error: {
        message: `cc-smart-dev-kit-router: ${label} refused the key the gateway config holds for ${backend} (HTTP ${status}${status === 403 ? ": the key, or what it may reach, such as a provider connection it is not allowed to use" : ""}). Your Claude login is not the problem. Check it: ${COMMAND} gateway check`,
        type: "invalid_request_error",
      },
      type: "error",
    },
    { headers: { "x-should-retry": "false" }, status: resendSafe ? REFUSAL_STATUS : 400 },
  );
}

function droppedHeaders(headers: Headers): Set<string> {
  const dropped = new Set(HOP_BY_HOP);
  for (const name of (headers.get("connection") ?? "").split(",")) {
    const trimmed = name.trim().toLowerCase();
    if (trimmed !== "") dropped.add(trimmed);
  }
  return dropped;
}

/** Every client header for Anthropic, but the hop-by-hop ones, `host` and `content-length`. */
export function anthropicRequestHeaders(client: Headers): Headers {
  const dropped = droppedHeaders(client);
  dropped.add("host");
  dropped.add("content-length");
  const out = new Headers();
  client.forEach((value, name) => {
    if (!dropped.has(name) && !name.startsWith("proxy-")) out.append(name, value);
  });
  return out;
}

/**
 * The allow-listed client headers and the backend's own key — nothing else — and
 * `accept-encoding: identity`. The router reads a backend's stream until its first real event
 * (`holdFirstEvent`) and passes the bytes on as they came (`decompress: false`): a gzip stream
 * would hold no event the scanner can read, and every target but the last would "fail".
 */
export function backendRequestHeaders(client: Headers, apiKey: string): Headers {
  const out = new Headers();
  for (const name of BACKEND_HEADER_ALLOW_LIST) {
    const value = client.get(name);
    if (value !== null) out.set(name, value);
  }
  if (!out.has("content-type")) out.set("content-type", "application/json");
  out.set("accept-encoding", "identity");
  out.set("authorization", `Bearer ${apiKey}`);
  return out;
}

/**
 * `retry-after` as whole seconds. Claude Code reads an integer; an affordable backend may
 * send a fraction or an HTTP date. Null when it is neither.
 */
export function retryAfterSeconds(value: null | string, nowMs: number): null | number {
  const trimmed = (value ?? "").trim();
  if (trimmed === "") return null;
  const seconds = Number(trimmed);
  if (Number.isFinite(seconds)) return seconds < 0 ? null : Math.ceil(seconds);
  const at = Date.parse(trimmed);
  if (Number.isNaN(at)) return null;
  return Math.max(0, Math.ceil((at - nowMs) / 1000));
}

/**
 * Response headers for the client; an affordable backend's `retry-after` made whole seconds
 * and capped at what Claude Code waits for (`capRetryAfter`): above 60 it ends the request at
 * once instead of retrying, even with the breaker off.
 */
function responseHeaders(upstream: Headers, normalizeRetryAfterAt: null | number): Headers {
  const dropped = droppedHeaders(upstream);
  const out = new Headers();
  upstream.forEach((value, name) => {
    if (dropped.has(name) || name.startsWith("proxy-")) return;
    if (name === "retry-after" && normalizeRetryAfterAt !== null) {
      const seconds = retryAfterSeconds(value, normalizeRetryAfterAt);
      if (seconds !== null) out.set(name, String(capRetryAfter(seconds)));
      return;
    }
    out.append(name, value);
  });
  return out;
}

/**
 * Reads a server-sent-events stream until its first real event, and says what it was.
 *
 * OmniRoute commits to `200 text/event-stream` after about a second, sends comment
 * lines (`: …`) as heartbeats, and reports a failure in-band as `event: error`. So
 * for an affordable backend "before the first byte" means "before the first real event":
 * comments are skipped; `ping` carries no content and decides nothing either.
 * `decidedData` is the data of the event that decided (its `data:` lines, joined): an error
 * event's reason, for the log.
 */
export function sseScanner(): {
  decidedData(): string;
  push(text: string): "error" | "event" | null;
} {
  let buffer = "";
  let event: null | string = null;
  let data: string[] = [];
  let fields = false;
  let decided = "";
  const decide = (): "error" | "event" | null => {
    const name = event ?? "message";
    decided = data.join("\n");
    if (name === "error") return "error";
    if (name === "ping") return null;
    try {
      const parsed: unknown = JSON.parse(data.join("\n"));
      if (
        typeof parsed === "object" &&
        parsed !== null &&
        "type" in parsed &&
        parsed.type === "error"
      ) {
        return "error";
      }
    } catch {
      // A data line that is not JSON is still an event the client may want.
    }
    return "event";
  };
  return {
    decidedData: () => decided,
    push(text) {
      buffer += text;
      for (;;) {
        const end = buffer.indexOf("\n");
        if (end === -1) return null;
        const line = buffer.slice(0, end).replace(/\r$/, "");
        buffer = buffer.slice(end + 1);
        if (line === "") {
          const verdict = fields ? decide() : null;
          if (verdict !== null) return verdict;
          event = null;
          data = [];
          fields = false;
          continue;
        }
        if (line.startsWith(":")) continue;
        fields = true;
        const colon = line.indexOf(":");
        const field = colon === -1 ? line : line.slice(0, colon);
        const value = colon === -1 ? "" : line.slice(colon + 1).replace(/^ /, "");
        if (field === "event") event = value;
        if (field === "data") data.push(value);
      }
    },
  };
}

/** Text safe for one log line: printable ASCII only, bounded length (`oneLine`). */
function printable(text: string, max = 120): string {
  return oneLine(text, max, { ascii: true });
}

/** How long an error snippet in the log may be. */
const SNIPPET_MAX = 300;

/**
 * How much of an error answer's first chunk is read for the log, in bytes. The chunk can
 * be half a megabyte (a gzip answer, decompressed); the log shows 300 characters of it.
 */
const SNIPPET_READ_BYTES = 2048;

/** A character a key's run is made of (the 32-character rule in `maskSecrets`). */
const KEY_CHARACTER = /[A-Za-z0-9_-]/;

/**
 * The start of an error answer as the log shows it: its first `SNIPPET_READ_BYTES`
 * decoded, keys masked (`maskSecrets`, with the secrets the router knows), made one
 * printable line of at most `SNIPPET_MAX` characters. When the bytes were cut, the run of
 * key characters the cut went through is dropped first: a key cut short there could be too
 * short for the 32-character rule.
 */
function snippetText(bytes: Uint8Array, known: readonly string[]): string {
  const cut = bytes.length > SNIPPET_READ_BYTES;
  let text = new TextDecoder().decode(cut ? bytes.subarray(0, SNIPPET_READ_BYTES) : bytes);
  if (cut) {
    let end = text.length;
    while (end > 0 && KEY_CHARACTER.test(text.charAt(end - 1))) end -= 1;
    text = text.slice(0, end);
  }
  return maskedLine(text, known, SNIPPET_MAX, { ascii: true });
}

/**
 * A `content-encoding` the router can read for the log, as `DecompressionStream` names it;
 * null for one it cannot (the log then names the encoding only).
 */
function decompressionFormat(encoding: string): Bun.CompressionFormat | null {
  switch (encoding.trim().toLowerCase()) {
    case "gzip":
    case "x-gzip":
      return "gzip";
    case "deflate":
      return "deflate";
    case "br":
      return "brotli";
    case "zstd":
      return "zstd";
    default:
      return null;
  }
}

/**
 * Claude Code's tool search, made plain for an affordable backend.
 *
 * With `ENABLE_TOOL_SEARCH=true` Claude Code marks most tools `defer_loading: true`
 * and, when its `ToolSearch` tool finds one, answers with a `tool_reference` block
 * inside the `tool_result` content: `{"type":"tool_reference","tool_name":"<name>"}`
 * (https://platform.claude.com/docs/en/agents-and-tools/tool-use/tool-search-tool,
 * § Custom tool search implementation). Anthropic expands those itself; OmniRoute and
 * Ollama know neither field. So, for a backend only:
 *   - a deferred tool no `tool_reference` names is dropped; a named one stays, without
 *     `defer_loading`; a tool that is not deferred stays as it is (`ToolSearch` too);
 *   - each `tool_reference` block becomes `{"type":"text","text":"Tool loaded: <name>"}`,
 *     the other blocks beside it kept.
 * The affordable model sees the core tools and `ToolSearch`; a tool it finds is a real
 * definition on its next turn — what Anthropic's server does. Nothing else changes.
 */
export function toolSearchForBackend(body: Record<string, unknown>): Record<string, unknown> {
  const referenced = new Set<string>();
  const out: Record<string, unknown> = { ...body };
  const messages = body.messages;
  if (Array.isArray(messages)) {
    out.messages = messages.map((message: unknown) => {
      if (!isJsonObject(message) || !Array.isArray(message.content)) return message;
      const content = message.content.map((block: unknown) => {
        if (!isJsonObject(block) || block.type !== "tool_result") return block;
        const inner = block.content;
        if (!Array.isArray(inner)) return block;
        return {
          ...block,
          content: inner.map((part: unknown) => {
            if (!isJsonObject(part) || part.type !== "tool_reference") return part;
            const name = part.tool_name;
            if (typeof name !== "string") return part;
            referenced.add(name);
            return { text: `Tool loaded: ${name}`, type: "text" };
          }),
        };
      });
      return { ...message, content };
    });
  }
  const tools = body.tools;
  if (Array.isArray(tools)) {
    out.tools = tools.flatMap((tool: unknown) => {
      if (!isJsonObject(tool) || tool.defer_loading !== true) return [tool];
      const name = tool.name;
      if (typeof name !== "string" || !referenced.has(name)) return [];
      const loaded: Record<string, unknown> = { ...tool };
      delete loaded.defer_loading;
      return [loaded];
    });
  }
  return out;
}

/**
 * "No reasoning", said so an affordable backend acts on it.
 *
 * Claude Code turns reasoning off with `thinking: {"type":"disabled"}` for short
 * background calls. OmniRoute translates that for an OpenAI-shaped provider such as
 * Ollama Cloud by leaving `reasoning_effort` out
 * (open-sse/translator/request/claude-to-openai.ts), and a model that reasons by
 * default (DeepSeek V4.1 Flash) then reasons anyway: measured with a 64-token request,
 * the whole budget went on reasoning and the answer came back empty. OmniRoute maps `output_config.effort` to `reasoning_effort`, and Ollama Cloud takes
 * `"none"` — the same request then answered in under a second. So, for a backend
 * only: thinking disabled and no effort named → effort `"none"`. An effort already
 * named stays.
 *
 * `absentIsOff` — for auto mode's safety check only: its newer form sends no `thinking`
 * at all, which on Anthropic also means no extended thinking. DeepSeek reasoned anyway
 * and took 20 s on the deeper check; with `"none"`, 1.5 s and the same verdict
 * (measured). Other requests without the field keep the backend's default.
 */
export function reasoningOffForBackend(
  body: Record<string, unknown>,
  options: { absentIsOff?: boolean } = {},
): Record<string, unknown> {
  const thinking = body.thinking;
  const off = isJsonObject(thinking)
    ? thinking.type === "disabled"
    : thinking === undefined && options.absentIsOff === true;
  if (!off) return body;
  const outputConfig = isJsonObject(body.output_config) ? body.output_config : {};
  if (outputConfig.effort !== undefined) return body;
  return { ...body, output_config: { ...outputConfig, effort: "none" } };
}

/** Apply the slot's backend-specific effort pin after the thinking-off translation. */
export function effortPinForBackend(
  body: Record<string, unknown>,
  pin: undefined | string,
): Record<string, unknown> {
  if (pin === undefined) return body;
  const outputConfig = isJsonObject(body.output_config) ? body.output_config : {};
  return { ...body, output_config: { ...outputConfig, effort: pin } };
}

/** What a Claude target refuses with a 400, from one version of its family on. */
interface ClaudeTargetRules {
  /** `thinking: {type: "enabled", budget_tokens}` → `{type: "adaptive"}`. */
  budgetToAdaptive: boolean;
  /**
   * What `thinking: {type: "disabled"}` becomes: `between_tools` (effort at most `high`),
   * `left out` (thinking is always on), `capped` (kept, effort at most `high`), or null
   * (the target takes it as it is).
   */
  thinkingOff: "between_tools" | "capped" | "left out" | null;
  /** A forced `tool_choice` (`any` / `tool`) → `auto`. */
  forcedToolChoice: boolean;
  /** A `temperature` other than 1, any `top_p`, any `top_k` → left out. */
  sampling: boolean;
}

/**
 * What a slot's `claude-…` target refuses with a 400, by the target's FAMILY (`claudeFamily`)
 * and the first VERSION a rule set holds for (`claudeVersion`). A target gets the row of its
 * family with the highest `since` at or below its own version, so a newer version needs no
 * change here; a version below every row of its family, an id with no version, and a family
 * with no row get the body as Claude Code built it (only `model` changes). Only what
 * Anthropic's docs state is here. Sources, read 2026-10-17:
 *   - platform.claude.com/docs/en/build-with-claude/thinking-troubleshooting (the per-model
 *     table: which `thinking.type` each model refuses; `between_tools` on Sonnet 5.5 only;
 *     `disabled` on Opus 5 and Haiku 5.5 only at effort `high` or below);
 *   - platform.claude.com/docs/en/build-with-claude/extended-thinking ("Claude 4.7 and later
 *     models ... reject" a budget; 4.5 and earlier refuse `adaptive`, so a budget stays there);
 *   - the migration guides of Sonnet 5.5, Opus 5.5 and Haiku 5.5 (the sampling fields; a
 *     forced `tool_choice` on Sonnet and Opus 5.5) and of Fable 5.1 (a forced `tool_choice`,
 *     which Fable 5 still takes).
 * A rule a newer version changes shows in the WARN line with Anthropic's reason; its row
 * changes then.
 */
const CLAUDE_TARGET_RULES: Readonly<
  Partial<Record<ClaudeFamily, readonly { rules: ClaudeTargetRules; since: ClaudeVersion }[]>>
> = {
  fable: [
    {
      rules: {
        budgetToAdaptive: true,
        forcedToolChoice: false,
        sampling: false,
        thinkingOff: "left out",
      },
      since: { major: 5, minor: 0 },
    },
    {
      rules: {
        budgetToAdaptive: true,
        forcedToolChoice: true,
        sampling: false,
        thinkingOff: "left out",
      },
      since: { major: 5, minor: 1 },
    },
  ],
  haiku: [
    {
      rules: {
        budgetToAdaptive: true,
        forcedToolChoice: false,
        sampling: false,
        thinkingOff: null,
      },
      since: { major: 4, minor: 7 },
    },
    {
      rules: {
        budgetToAdaptive: true,
        forcedToolChoice: false,
        sampling: true,
        thinkingOff: "capped",
      },
      since: { major: 5, minor: 5 },
    },
  ],
  opus: [
    {
      rules: {
        budgetToAdaptive: true,
        forcedToolChoice: false,
        sampling: false,
        thinkingOff: null,
      },
      since: { major: 4, minor: 7 },
    },
    {
      rules: {
        budgetToAdaptive: true,
        forcedToolChoice: false,
        sampling: false,
        thinkingOff: "capped",
      },
      since: { major: 5, minor: 0 },
    },
    {
      rules: {
        budgetToAdaptive: true,
        forcedToolChoice: true,
        sampling: true,
        thinkingOff: "left out",
      },
      since: { major: 5, minor: 5 },
    },
  ],
  sonnet: [
    {
      rules: {
        budgetToAdaptive: true,
        forcedToolChoice: false,
        sampling: false,
        thinkingOff: null,
      },
      since: { major: 4, minor: 7 },
    },
    {
      rules: {
        budgetToAdaptive: true,
        forcedToolChoice: true,
        sampling: true,
        thinkingOff: "between_tools",
      },
      since: { major: 5, minor: 5 },
    },
  ],
};

/** The rules for one Claude target (`CLAUDE_TARGET_RULES`); null when none apply. */
function claudeTargetRules(model: string): ClaudeTargetRules | null {
  const family = claudeFamily(model);
  const version = claudeVersion(model);
  if (family === null || version === null) return null;
  let found: ClaudeTargetRules | null = null;
  for (const row of CLAUDE_TARGET_RULES[family] ?? []) {
    if (versionAtLeast(version, row.since)) found = row.rules;
  }
  return found;
}

/** Efforts above `high`: refused with thinking off where a model takes it only up to `high`. */
const ABOVE_HIGH = new Set(["max", "xhigh"]);

/**
 * A slot request's body, made acceptable to the slot's `claude-…` target.
 *
 * Claude Code builds a request for the model name it sends. Under a slot name
 * (`cc-smart-dev-kit-worker`) it knows nothing of the model behind it, so the body can carry a
 * field the Claude target refuses: Claude Sonnet 5.5 answers 400 to
 * `thinking: {type: "disabled"}`, which Claude Code sends to turn reasoning off for short
 * background calls. Without this, a slot that falls back to Claude after its affordable targets
 * fail answers 400 instead. So, for a target with rules (`claudeTargetRules`) only, each
 * refused field gets the nearest value the target accepts:
 *   - `thinking: {type: "disabled"}` → `{type: "between_tools"}` (Sonnet 5.5; at effort
 *     `xhigh` / `max` the effort becomes `high`, the highest it takes with thinking off);
 *     or no `thinking` field (Opus 5.5, Fable: thinking is always on), and, with no effort
 *     named, `output_config.effort: "low"`, the nearest to no thinking; or kept, with an
 *     effort above `high` made `high` (Opus 5, Haiku 5.5);
 *   - `thinking: {type: "enabled", budget_tokens}` → `{type: "adaptive"}`, its `display`
 *     kept (4.7 and later);
 *   - `tool_choice` `any` or `tool` → `{type: "auto"}`, its `disable_parallel_tool_use`
 *     kept;
 *   - a `temperature` other than 1, any `top_p`, any `top_k` → left out (the default).
 * Nothing else changes: not `system`, not a message, not a tool, not the field order.
 * The router never calls it for auto mode's safety check (`guard`): the check stays as
 * Claude Code ships it.
 * `changes` names each change, for the log. The input is not changed in place.
 */
export function requestForClaudeFallback(
  body: Record<string, unknown>,
  model: string,
): { body: Record<string, unknown>; changes: string[] } {
  // The target's family and version decide (`[1m]` is ignored there).
  const rules = claudeTargetRules(model);
  if (rules === null) return { body, changes: [] };
  const out: Record<string, unknown> = { ...body };
  const changes: string[] = [];
  /** An effort above `high` made `high`; `why` follows the change's name in the log. */
  const capEffort = (why: string) => {
    const outputConfig = body.output_config;
    if (
      isJsonObject(outputConfig) &&
      typeof outputConfig.effort === "string" &&
      ABOVE_HIGH.has(outputConfig.effort)
    ) {
      out.output_config = { ...outputConfig, effort: "high" };
      changes.push(`effort ${outputConfig.effort} -> high${why}`);
    }
  };
  const thinking = body.thinking;
  if (isJsonObject(thinking) && thinking.type === "disabled") {
    if (rules.thinkingOff === "left out") {
      delete out.thinking;
      changes.push("thinking disabled -> left out (always on)");
      // Thinking cannot be off; effort is the one control of its depth. With none named,
      // `low` is the nearest to "off" (the Opus 5.5 migration guide's own before/after).
      const outputConfig = isJsonObject(body.output_config) ? body.output_config : undefined;
      if (outputConfig?.effort === undefined) {
        out.output_config = { ...outputConfig, effort: "low" };
        changes.push("effort low (nearest to thinking off)");
      }
    } else if (rules.thinkingOff === "between_tools") {
      out.thinking = { type: "between_tools" };
      changes.push("thinking disabled -> between_tools");
      capEffort("");
    } else if (rules.thinkingOff === "capped") {
      capEffort(" (thinking off)");
    }
  } else if (isJsonObject(thinking) && thinking.type === "enabled" && rules.budgetToAdaptive) {
    out.thinking =
      thinking.display === undefined
        ? { type: "adaptive" }
        : { display: thinking.display, type: "adaptive" };
    changes.push("thinking enabled (budget) -> adaptive");
  }
  const toolChoice = body.tool_choice;
  if (
    rules.forcedToolChoice &&
    isJsonObject(toolChoice) &&
    (toolChoice.type === "any" || toolChoice.type === "tool")
  ) {
    out.tool_choice =
      toolChoice.disable_parallel_tool_use === undefined
        ? { type: "auto" }
        : { disable_parallel_tool_use: toolChoice.disable_parallel_tool_use, type: "auto" };
    changes.push(`tool_choice ${toolChoice.type} -> auto`);
  }
  if (rules.sampling) {
    if (body.temperature !== undefined && body.temperature !== 1) {
      delete out.temperature;
      changes.push("temperature left out");
    }
    for (const field of ["top_p", "top_k"]) {
      if (body[field] !== undefined) {
        delete out[field];
        changes.push(`${field} left out`);
      }
    }
  }
  return changes.length > 0 ? { body: out, changes } : { body, changes };
}

const encoder = new TextEncoder();

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The request body as a JSON object; null when it is not one. */
function parseBody(bytes: Uint8Array): null | Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    // Not JSON — the caller answers 400, like Anthropic would.
    return null;
  }
  return isJsonObject(parsed) ? parsed : null;
}

/** A timer that resolves to "timeout" — raced against an upstream step, then cleared. */
function deadline(ms: number): { clear: () => void; done: Promise<"timeout"> } {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const done = new Promise<"timeout">((resolve) => {
    timer = setTimeout(() => resolve("timeout"), Math.max(0, ms));
  });
  return { clear: () => clearTimeout(timer), done };
}

/** One upstream call, ready to send. */
interface Upstream {
  body: null | Uint8Array<ArrayBuffer>;
  headers: Headers;
  method: string;
  url: string;
}

/**
 * The Claude model a request named, as it reached its family's slot (`familySlotFor`), and
 * the bytes Claude Code sent for it.
 */
interface Asked {
  model: string;
  sent: null | Uint8Array<ArrayBuffer>;
}

/** Do two Claude ids name the same model? `[1m]` says nothing about which one. */
function sameModel(a: string, b: string): boolean {
  return withoutContextSuffix(a) === withoutContextSuffix(b);
}

/** How one request ended — the log line and the response. */
interface Outcome {
  effort?: string;
  effortPinned?: true;
  /**
   * The breaker's own answer (`breaker(<slot>)` is the target): whether the request waited
   * in the hold, and how many upstream calls it made as a probe while the breaker was open.
   */
  breaker?: { held: boolean; probes: number };
  /**
   * Set when the breaker applies and every target in use failed for want of capacity (or
   * rests, or is being probed by another request): each one's failure. `response` is then the
   * answer that would go back, and the caller drops it when it holds the request instead.
   */
  capacity?: BreakerFailure[];
  fallbacks: number;
  response: Response;
  skipped: number;
  target: string;
}

type Attempt = { failure: string; status: null | number } | { response: Response };

/** A target's result in one pass over a chain; `capacity` says whether it is a capacity failure. */
interface AttemptRecord extends BreakerFailure {
  capacity: boolean;
}

/**
 * How a pass over a chain treats the breaker (`chain`'s `hold`); null where the breaker does
 * not apply (breaker off, the judge, `count_tokens`, an explicit `<backend>:<model>`).
 */
interface HoldMode {
  /**
   * The slot's breaker is open: a resting backend is not asked even when it is the last
   * target, and only one request at a time asks each target (the probe).
   */
  holding: boolean;
  /**
   * How long the last backend of a streaming request may take to give its headers and its
   * first real event (`BREAKER_HEARTBEAT_WAIT_MS`, less what is left of the hold). Null: no
   * deadline.
   */
  lastWaitMs: null | number;
  /**
   * Milliseconds left of the hold, from its start: a probe's wait is capped by it, so a hold
   * never outlasts its limit. `Infinity` when there is no hold to stay within (`0`).
   */
  leftMs: number;
  /** Upstream calls made as a probe, counted for the request's log line. */
  probes: { count: number };
}

/** A slot whose breaker is open now: what the router keeps in memory (`limitState.breakers`). */
interface OpenBreaker {
  /** Each target's last failure, from the last pass over the chain. */
  failures: BreakerFailure[];
  /** Requests held since it opened. */
  held: number;
  /** Requests waiting in the hold now. */
  heldNow: number;
  /** Milliseconds: the last reminder line, or when it opened. */
  reminderAt: number;
  /** Milliseconds: the last write of its record to the state file. */
  savedAt: number;
  /** Milliseconds: when it opened. */
  since: number;
}

/** An empty record is dropped from the state, so a file without breakers reads as none. */
function withoutEmptyBreakers(state: LimitState): void {
  if (state.breakers !== undefined && Object.keys(state.breakers).length === 0) {
    delete state.breakers;
  }
}

/**
 * A state file the router writes in the background: one write for any number of changes in
 * a row, after the answer went out (a timer, never a microtask). `what` names the file in a
 * failure line, which is logged once per distinct error. With no writer for it, every call
 * is a no-op.
 */
function stateWriter(deps: RouterDeps, what: string, save: undefined | (() => void)): () => void {
  if (save === undefined) return () => {};
  let queued = false;
  let lastError = "";
  return () => {
    if (queued) return;
    queued = true;
    const task = new Promise<void>((resolve) => {
      setTimeout(() => {
        queued = false;
        try {
          save();
          lastError = "";
        } catch (error) {
          const message = messageOf(error);
          if (message !== lastError) deps.log(`ERROR cannot write ${what}: ${message}`);
          lastError = message;
        }
        resolve();
      }, 0);
    });
    deps.background?.(task);
  };
}

/**
 * Who answered a safety check, from the target's text as the log names it: `anthropic`, or
 * a Claude model id, is Claude; any other target that answered is a fallback (the judge
 * slot, which never holds a `claude-…` target). `none`: no target answered it.
 */
function answeredSide(target: string): CheckSide | null {
  if (target === "none") return null;
  return target === "anthropic" || target.startsWith("claude-") ? "anthropic" : "fallback";
}

/**
 * What the error log and the cancel read from an answer. Structural, so a `clone()` fits
 * too: its type comes from another set of declarations than `Response`.
 */
interface UpstreamBody {
  body: Response["body"];
  headers: { get(name: string): null | string };
}

export function createRouter(deps: RouterDeps): (req: Request) => Promise<Response> {
  const startedAt = deps.now();
  const stats = { fallbacks: 0, requests: 0 };
  const allowedHosts = new Set([`127.0.0.1:${deps.port}`, `localhost:${deps.port}`]);
  /** Target text → the time (ms) until which it rests. In memory: a restart forgets. */
  const cooling = new Map<string, number>();
  /** Alias names already logged: each one is logged once, not on every request. */
  const aliasesLogged = new Set<string>();
  /** Claude-target translations already logged (target and changes): once each. */
  const translationsLogged = new Set<string>();
  /**
   * What the state file says: plan limits seen, slots answering from a next target. It starts
   * from the file, so a restart keeps them (`loadState`).
   */
  const limitState: LimitState = loadedState(deps.loadState, parseLimitState, emptyLimitState, {
    file: "the limit state file",
    name: "the limit state",
    after: "it starts over",
  });
  // A breaker record a stopped router left behind is dropped once it is no longer current.
  for (const slot of Object.keys(limitState.breakers ?? {})) {
    if (!currentBreakers(limitState, deps.now()).some(([key]) => key === slot)) {
      delete limitState.breakers?.[slot];
    }
  }
  withoutEmptyBreakers(limitState);
  /** Auto mode's safety checks counted so far, by local day (`safety-checks.ts`). */
  const safetyChecks: SafetyCheckState = loadedState(
    deps.loadSafetyChecks,
    parseSafetyCheckState,
    emptySafetyChecks,
    {
      file: "the safety-check file",
      name: "the safety-check counts",
      after: "counting starts over",
    },
  );
  /**
   * Claude model ids another target answered for since the router started. A 400 "Invalid
   * `signature`" for one of them gets a WARN that names the cause, also once its fallback
   * record is gone.
   */
  const fellBack = new Set<string>();
  /** Judge targets already named in a WARN as untested: once each. */
  const untestedLogged = new Set<string>();
  /** Profile names the config does not hold, already named in a WARN: once each. */
  const unknownProfiles = new Set<string>();
  /** What `cleanAnswer` changed, per slot and target: logged once each. */
  const cleanedLogged = new Set<string>();
  /** Claude models whose request lost the router's marked thinking blocks (`forClaude`): once each. */
  const markedLogged = new Set<string>();
  /** Backend targets whose request got the router's thinking blocks' own signatures back. */
  const restoredLogged = new Set<string>();
  /** The config the fallback records were last checked against (`dropRemovedFallbacks`). */
  let checkedConfig: GatewayConfig | null = null;
  /** Slots whose breaker is open now. In memory: a restart starts closed, the record stays. */
  const openBreakers = new Map<string, OpenBreaker>();
  /** Targets a request is probing now, while a breaker is open: one request at a time asks each. */
  const probing = new Set<string>();
  /** Why each resting target rests (its last failure), for the breaker's answer and record. */
  const restReasons = new Map<string, { reason: string; status: null | number }>();
  const sleep =
    deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));

  /** Write the state file in the background, once for any number of changes in a row. */
  const persist = stateWriter(
    deps,
    "the limit state",
    deps.saveState === undefined ? undefined : () => deps.saveState?.(formatLimitState(limitState)),
  );
  /** The same, for the safety-check counts (`safety-checks.ts`). */
  const persistChecks = stateWriter(
    deps,
    "the safety-check counts",
    deps.saveSafetyChecks === undefined
      ? undefined
      : () => deps.saveSafetyChecks?.(formatSafetyCheckState(safetyChecks)),
  );
  const loadState = deps.loadState;
  const saveState = deps.saveState;
  /**
   * A new Claude id reaches the state file in the background: the file is read first, and
   * only its `seenClaude` changes (merged with what the router saw). Its limits and
   * fallbacks stay as the file holds them, so a change another program made there (the
   * CLI's `dropFallbackRecord`) is never written over by this. With no readable state in
   * the file, the router's own is what there is to write.
   */
  const persistSeen = stateWriter(
    deps,
    "the seen Claude ids",
    loadState === undefined || saveState === undefined
      ? undefined
      : () => {
          const text = loadState();
          const there = text === null ? null : parseLimitState(text);
          const base = there ?? limitState;
          saveState(
            formatLimitState({
              ...base,
              seenClaude: mergeSeenClaude(there?.seenClaude ?? {}, limitState.seenClaude ?? {}),
            }),
          );
        },
  );
  /** The last requests routed, oldest first (`RecentRequest`). In memory: a restart forgets. */
  const recent: RecentRequest[] = [];

  /**
   * A Claude model id Claude Code sent: its last-seen time, for the health answer, and the
   * state file when the id is new (`persistSeen`). A name that is not a Claude id is not kept.
   */
  function noteSeenClaude(model: string): void {
    const id = withoutContextSuffix(model);
    if (!isClaudeModelId(id)) return;
    const seen = limitState.seenClaude ?? {};
    const isNew = !Object.hasOwn(seen, id);
    limitState.seenClaude = mergeSeenClaude(seen, { [id]: deps.now() });
    if (isNew) persistSeen();
  }

  /**
   * A state the router starts from: what its file holds (a restart goes on from there: the
   * same days counted, the same limits and fallbacks), or none. A file that cannot be read
   * or understood is said so once, and the state starts from none — an older or a
   * hand-edited file never stops the router. `words` name it in those lines.
   */
  function loadedState<T>(
    load: undefined | (() => null | string),
    parse: (text: string) => null | T,
    empty: () => T,
    words: { after: string; file: string; name: string },
  ): T {
    if (load === undefined) return empty();
    let text: null | string;
    try {
      text = load();
    } catch (error) {
      deps.log(`WARN cannot read ${words.name}: ${messageOf(error)}`);
      return empty();
    }
    if (text === null) return empty();
    const parsed = parse(text);
    if (parsed === null) {
      deps.log(`WARN ${words.file} is not one this version reads; ${words.after}`);
      return empty();
    }
    return parsed;
  }

  /**
   * Read a Claude answer's headers (never its body): a plan usage limit is noted for the
   * status line and the hook; any other answer below 400 ends the limit, and the fallback of
   * any model slot that used it. Only a `/v1/messages` answer counts: `count_tokens` is not
   * a model's answer, and a 200 to it during a rest says nothing about the limit. The answer
   * itself is not touched. Returns the limit, or null.
   */
  function observeClaude(model: string, response: Response, path: string): null | PlanLimit {
    if (path !== MESSAGES_PATH) return null;
    const id = withoutContextSuffix(model);
    const limit = planUsageLimit(response.status, (name) => response.headers.get(name));
    if (limit !== null) {
      const before = limitState.limits[id];
      limitState.limits[id] = { ...limit, seenAt: deps.now() };
      if (
        before === undefined ||
        before.resetsAt !== limit.resetsAt ||
        deps.now() - before.seenAt >= FALLBACK_SAVE_EVERY_MS
      ) {
        persist();
      } else {
        // The file keeps the older `seenAt`; less than a minute apart, it says the same.
        limitState.limits[id] = before;
      }
      return limit;
    }
    if (response.status >= 400 || !Object.hasOwn(limitState.limits, id)) return null;
    delete limitState.limits[id];
    for (const [key, record] of Object.entries(limitState.fallbacks)) {
      if (record.model !== id) continue;
      delete limitState.fallbacks[key];
      deps.log(`${key}: ${id} answers again; its fallback is over`);
    }
    persist();
    return null;
  }

  /**
   * The plan limit a chain's Claude target is known to be at now (D65): `limits` holds it,
   * with its reset still ahead. A limit with no reset time is not one, nor one whose reset no
   * date can hold (a header or a hand edit could say so): only the cooldown rules apply to it.
   * Null for a backend, and for a model with no such limit.
   */
  function knownLimit(
    target: Target,
    nowMs: number,
  ): null | { claim: null | string; resetsAt: number } {
    if (target.kind !== "anthropic") return null;
    const id = withoutContextSuffix(target.model);
    const limit = Object.hasOwn(limitState.limits, id) ? limitState.limits[id] : undefined;
    if (limit === undefined || limit.resetsAt === null || limit.resetsAt * 1000 <= nowMs)
      return null;
    if (Number.isNaN(new Date(limit.resetsAt * 1000).getTime())) return null;
    return { claim: limit.claim, resetsAt: limit.resetsAt };
  }

  /**
   * A slot whose first target is a Claude model at its plan limit was answered by a next
   * target: one WARN when it starts, and the state file (the status line, the alert). Only
   * an answer below 400 makes the fallback active: a fallback that failed answered nothing,
   * and its WARN says so. Observing the model answer again ends it (`observeClaude`).
   */
  function noteFallback(
    slot: string,
    model: string,
    limit: PlanLimit | null,
    outcome: Outcome,
    profile: null | string,
  ): void {
    const now = deps.now();
    // A profile's chain is its own, so its fallback record is its own record (`stateKeyFor`).
    const key = stateKeyFor(slot, profile);
    const before = limitState.fallbacks[key];
    const resetsAt = limit?.resetsAt ?? before?.resetsAt ?? null;
    const reset =
      resetsAt === null
        ? "no reset time given"
        : `resets ${new Date(resetsAt * 1000).toISOString()}`;
    const claim = printable(limit?.claim ?? "plan limit", 40);
    if (!outcome.response.ok) {
      if (before === undefined) {
        deps.log(
          `WARN ${key}: ${model} is at its plan usage limit (${claim}, ${reset}); its fallback ${outcome.target} answered ${outcome.response.status}`,
        );
      }
      return;
    }
    fellBack.add(model);
    if (before === undefined) {
      deps.log(
        `WARN ${key}: ${model} is at its plan usage limit (${claim}, ${reset}); answering from ${outcome.target} until ${model} answers again`,
      );
    }
    limitState.fallbacks[key] = {
      lastAt: now,
      model,
      resetsAt,
      since: before?.since ?? now,
      target: outcome.target,
    };
    if (
      before === undefined ||
      before.target !== outcome.target ||
      before.resetsAt !== resetsAt ||
      now - before.lastAt >= FALLBACK_SAVE_EVERY_MS
    ) {
      persist();
    }
  }

  /**
   * The config a request sees: the machine's when its path names no profile, and a profile's
   * view of it (`profileView`) when it does (`…/p/<profile>`, owner D29). A name that is no
   * profile — one the pattern refuses, or one the config does not hold — answers as plain
   * Claude (D29): every slot off, one WARN per name. Never an error a session cannot read.
   */
  function configFor(profile: null | string): GatewayConfig {
    const machine = deps.getConfig();
    if (profile === null) return machine;
    const view = profileView(machine, profile);
    if (view !== null) return view;
    if (!unknownProfiles.has(profile)) {
      unknownProfiles.add(profile);
      const names = profileNames(machine);
      deps.log(
        `WARN profile "${printable(profile, 64)}" is not in ${deps.configPath} (profiles: ${names.length > 0 ? names.join(", ") : "none"}); its requests answer as plain Claude`,
      );
    }
    return plainClaudeView(machine);
  }

  /**
   * A record for a slot a config no longer holds is dropped: `gateway slot opus off`, a hand
   * edit, a fallback switch turned off, or a profile removed from the file. Every scope is
   * checked against its own view — a profile's chain is not the machine's, so one can keep a
   * slot the other turned off. Checked once per config the router loads, before its first
   * request.
   */
  function dropRemovedFallbacks(config: GatewayConfig): void {
    if (config === checkedConfig) return;
    checkedConfig = config;
    const scopes = new Map<null | string, GatewayConfig>([[null, config]]);
    for (const name of profileNames(config)) {
      const view = profileView(config, name);
      if (view !== null) scopes.set(name, view);
    }
    let changed = false;
    for (const key of Object.keys(limitState.fallbacks)) {
      const { profile, slot } = scopeOfStateKey(key);
      const view = scopes.get(profile);
      if (view !== undefined && Object.hasOwn(view.slots, slot) && fallbackOn(view, slot)) continue;
      delete limitState.fallbacks[key];
      deps.log(`${key}: removed from the config; its fallback record is dropped`);
      changed = true;
    }
    if (changed) persist();
    // A breaker for a slot taken out of the config, or switched off, is over.
    for (const key of new Set([
      ...openBreakers.keys(),
      ...Object.keys(limitState.breakers ?? {}),
    ])) {
      const { profile, slot } = scopeOfStateKey(key);
      const view = scopes.get(profile);
      if (view !== undefined && Object.hasOwn(view.slots, slot) && breakerOn(view, slot)) continue;
      closeBreaker(slot, profile, "removed from the config or switched off");
    }
  }

  /**
   * The judge slot's targets the router may use, for a chain the person set: its chain, its
   * first target alone while its fallback switch is off (`targetsInUse`), and of those only
   * the ones that may judge (`judgeTargetUsable`: a `claude-…` target as it is, a backend
   * target once `gateway slot judge` tested it). An untested backend target (a hand edit, a
   * config from before 0.5.0) is ignored, with one WARN per target. None left: Claude judges.
   */
  function judgeTargetsOf(config: GatewayConfig): Target[] {
    const judge = resolveRoute(JUDGE_SLOT, config);
    if (judge.kind !== "slot") return [];
    return targetsInUse(judge.targets, fallbackOn(config, JUDGE_SLOT)).filter((target) => {
      const text = formatTarget(target);
      if (judgeTargetUsable(config, text)) return true;
      if (!untestedLogged.has(text)) {
        untestedLogged.add(text);
        deps.log(
          `WARN ${JUDGE_SLOT}: ${text} has not passed the judge test, so it judges nothing. Test and set it: ${COMMAND} gateway slot judge <targets>`,
        );
      }
      return false;
    });
  }

  /** Did another target answer for this Claude model since the router started? */
  function hadFallback(model: string): boolean {
    return fellBack.has(model);
  }

  /**
   * For a 400 from Anthropic to a Claude model another target answered for before: a WARN
   * that names a thinking block that model cannot verify, and the way out. Undefined when
   * there is nothing to name.
   */
  function signatureWarn(model: string, status: number): undefined | ((snippet: string) => void) {
    const id = withoutContextSuffix(model);
    if (status !== 400 || !hadFallback(id)) return undefined;
    return (snippet) => {
      if (!snippet.includes(BAD_SIGNATURE)) return;
      deps.log(
        `WARN ${id} refused a thinking block's signature: this conversation holds a thinking block another model wrote for ${id}. Claude Code 2.1.300 sent the request once more and was answered (seen live); if the session stays stuck, /rewind in Claude Code to the message before the other model answered, or start a new session`,
      );
    };
  }

  /** Cancel a response the client will never see, so its connection is freed. */
  async function discard(response: UpstreamBody): Promise<void> {
    try {
      await response.body?.cancel();
    } catch (error) {
      deps.log(`WARN could not cancel a discarded upstream body: ${messageOf(error)}`);
    }
  }

  /**
   * The first part of an error answer, for the log: an upstream's own reason
   * ("Input exceeds context window …", Anthropic's "… is not supported for this model")
   * is otherwise only in that upstream's log, or nowhere. One chunk, read within a second
   * (decompressed first when it is gzip, deflate, br or zstd); the rest is cancelled.
   * Its first 2 KB, anything like a key masked (`snippetText`, with the `known` secrets),
   * at most `SNIPPET_MAX` characters. Never request content. Pass a `clone()` when the
   * client still needs the body.
   */
  async function errorSnippet(response: UpstreamBody, known: readonly string[]): Promise<string> {
    const encoding = response.headers.get("content-encoding");
    const compressed = encoding !== null && encoding.trim().toLowerCase() !== "identity";
    const format = compressed ? decompressionFormat(encoding) : null;
    if (compressed && format === null) {
      // Not awaited, for the reason in `finally` below.
      void discard(response);
      return `(${printable(encoding, 40)} body)`;
    }
    const raw = response.body;
    if (raw === null) return "(no body)";
    const body = format === null ? raw : raw.pipeThrough(new DecompressionStream(format));
    const reader = body.getReader();
    const timer = deadline(1000);
    let readFailed = false;
    try {
      const step = await Promise.race([reader.read(), timer.done]);
      if (step === "timeout") return "(no body within 1 s)";
      if (step.done) return "(empty body)";
      return snippetText(step.value, known);
    } catch (error) {
      readFailed = true;
      return `(${format === null ? "" : `${printable(encoding ?? "", 40)} `}body unreadable: ${messageOf(error)})`;
    } finally {
      timer.clear();
      // Not awaited: on a `clone()` the cancel settles only once the client's copy is
      // read too, which happens after this returns. The rest of this copy is dropped
      // at once either way. After a failed read the stream is broken and its cancel
      // fails too: the WARN line above already says why, once is enough.
      reader.cancel().catch((error: unknown) => {
        if (!readFailed) {
          deps.log(`WARN could not cancel an upstream error body: ${messageOf(error)}`);
        }
      });
    }
  }

  /**
   * Logs `prefix — <the start of the error answer>` in the background: reading the answer
   * can take up to a second, and the client's answer must never wait for the log. Pass a
   * `clone()` when the client still needs the body.
   */
  function logErrorAnswer(
    response: UpstreamBody,
    known: readonly string[],
    prefix: string,
    /** Called with the snippet after its line: one more WARN that names a known cause. */
    follow?: (snippet: string) => void,
  ): void {
    const task = errorSnippet(response, known).then(
      (snippet) => {
        deps.log(`${prefix} — ${snippet}`);
        follow?.(snippet);
      },
      (error: unknown) => {
        deps.log(`${prefix} — (body unreadable: ${messageOf(error)})`);
      },
    );
    deps.background?.(task);
  }

  /**
   * The secrets the router knows exactly, masked by their text in any error answer it
   * logs: every backend's key, and the request's `x-api-key` and `authorization` (the
   * whole value, and the credential after its scheme).
   */
  function knownSecrets(req: Request, config: GatewayConfig): string[] {
    const known = Object.values(config.backends).map((backend) => backend.apiKey);
    for (const name of ["x-api-key", "authorization"]) {
      const value = req.headers.get(name);
      if (value === null) continue;
      known.push(value);
      const space = value.indexOf(" ");
      if (space !== -1) known.push(value.slice(space + 1).trim());
    }
    return known;
  }

  /**
   * Send one upstream call. Resolves to the response once its headers arrive, or to
   * the reason it failed: a network error, or no headers before `deadlineAt` (null:
   * no deadline). The call is aborted when the client goes away, and on the timeout.
   */
  async function send(
    req: Request,
    upstream: Upstream,
    deadlineAt: null | number,
  ): Promise<Attempt> {
    if (req.signal.aborted) return { failure: "client closed the request", status: null };
    const controller = new AbortController();
    req.signal.addEventListener("abort", () => controller.abort(req.signal.reason), { once: true });
    const timer = deadlineAt === null ? null : deadline(deadlineAt - deps.now());
    // `backendFetch` for every upstream: an affordable backend's key never goes through a
    // proxy to this machine, and no upstream's redirect is followed with a key or the login.
    const init: Omit<UpstreamInit, keyof BackendFetchOptions> = {
      body: upstream.body,
      decompress: false,
      headers: upstream.headers,
      method: upstream.method,
      signal: controller.signal,
    };
    const pending = backendFetch(upstream.url, init, deps.fetch);
    try {
      const first = await (timer === null ? pending : Promise.race([pending, timer.done]));
      if (first !== "timeout") return { response: first };
      controller.abort(new Error(NO_HEADERS_IN_TIME));
      // A fetch that ignores the abort may still answer later: free that answer too.
      // Its rejection is the abort just sent — the expected end, nothing to report.
      void pending.then(discard, () => undefined);
      return { failure: NO_HEADERS_IN_TIME, status: null };
    } catch (error) {
      return { failure: messageOf(error), status: null };
    } finally {
      timer?.clear();
    }
  }

  /**
   * Hold an affordable backend's stream until its first real event (`sseScanner`). An
   * error event (its reason in the failure, keys masked: `known`), the end of the stream,
   * or `deadlineAt` first → a failure, and the next target is tried; nothing has reached
   * the client yet. Otherwise the client gets a stream that replays every byte read so far,
   * then pipes the rest as it arrives — chunk by chunk, nothing buffered beyond the one
   * being handed over.
   *
   * The `last` target is held only for its deadline (the safety check's judge: a stream of
   * heartbeats must not hold every action): an error event or an early end there is the
   * answer, replayed as it came, because no target is left to try.
   *
   * Nothing is sent to the client while holding (no `ping`): any byte would commit
   * this target, and the wait is bounded by `firstByteMs` anyway. The connection
   * stays open meanwhile — the server's idle timeout is off.
   */
  async function holdFirstEvent(
    response: Response,
    deadlineAt: null | number,
    options: { known: readonly string[]; last: boolean },
  ): Promise<Attempt> {
    const body = response.body;
    if (body === null) return { failure: "an event stream with no body", status: response.status };
    const reader = body.getReader();
    const decoder = new TextDecoder();
    const scanner = sseScanner();
    const held: Uint8Array[] = [];
    /** `status` null on a timeout (the target rests), the 2xx otherwise (it does not). */
    const fail = (failure: string, status: null | number): Attempt => {
      // Not awaited: a stalled upstream may never settle its cancel, and the request must go
      // on to the next target (and the target rest) whatever the upstream does.
      reader.cancel().catch((error: unknown) => {
        deps.log(`WARN could not cancel a held upstream stream: ${messageOf(error)}`);
      });
      return { failure, status };
    };
    for (;;) {
      const timer = deadlineAt === null ? null : deadline(deadlineAt - deps.now());
      let step: "timeout" | Awaited<ReturnType<typeof reader.read>>;
      try {
        step = await (timer === null ? reader.read() : Promise.race([reader.read(), timer.done]));
      } catch (error) {
        return {
          failure: `the stream broke before its first event: ${messageOf(error)}`,
          status: null,
        };
      } finally {
        timer?.clear();
      }
      if (step === "timeout") return fail(NO_EVENT_IN_TIME, null);
      if (step.done) {
        if (options.last) break;
        return { failure: "the stream ended before its first event", status: response.status };
      }
      held.push(step.value);
      const verdict = scanner.push(decoder.decode(step.value, { stream: true }));
      if (verdict === "error" && !options.last) {
        const reason = maskedLine(scanner.decidedData(), options.known, SNIPPET_MAX, {
          ascii: true,
        });
        return fail(
          `an error event before the first real one${reason === "" ? "" : `: ${reason}`}`,
          response.status,
        );
      }
      if (verdict !== null) break;
    }
    const replay = new ReadableStream<Uint8Array>({
      cancel: (reason) => reader.cancel(reason),
      async pull(controller) {
        const next = held.shift();
        if (next !== undefined) {
          controller.enqueue(next);
          return;
        }
        const { done, value } = await reader.read();
        if (done) controller.close();
        else controller.enqueue(value);
      },
    });
    return {
      response: new Response(replay, {
        headers: response.headers,
        status: response.status,
        statusText: response.statusText,
      }),
    };
  }

  /**
   * Read a backend's whole non-streaming 2xx answer while another target can still answer:
   * a backend may report a failure in a 200 whose body is Anthropic's error shape
   * (`{"type":"error", …}`), and passed on, Claude Code would keep it as the answer. Such a
   * body is a failure (its reason in it, keys masked: `known`), and the next target is tried;
   * the 2xx status means the target does not rest, as for an error event in a stream. Any
   * other body comes back as the same bytes. An answer in an encoding the router does not
   * read (it asks for none: `backendRequestHeaders`) is passed on as it came. Only a
   * non-streaming answer: it is whole before Claude Code reads any of it anyway.
   */
  async function readJsonAnswer(response: Response, known: readonly string[]): Promise<Attempt> {
    const encoding = (response.headers.get("content-encoding") ?? "").trim().toLowerCase();
    if (encoding !== "" && encoding !== "identity") return { response };
    let bytes: Uint8Array<ArrayBuffer>;
    try {
      bytes = new Uint8Array(await response.arrayBuffer());
    } catch (error) {
      return { failure: `the answer broke off: ${messageOf(error)}`, status: null };
    }
    const parsed = parseBody(bytes);
    if (parsed !== null && parsed.type === "error") {
      const reason = snippetText(bytes, known);
      return {
        failure: `an error in its ${response.status} answer: ${reason}`,
        status: response.status,
      };
    }
    return {
      response: new Response(bytes, {
        headers: response.headers,
        status: response.status,
        statusText: response.statusText,
      }),
    };
  }

  /** The upstream response, as Claude Code gets it: status, headers, streamed body. */
  function relay(upstream: Response, target: null | Target): Response {
    const headers = responseHeaders(
      upstream.headers,
      target?.kind === "backend" ? deps.now() : null,
    );
    return new Response(NULL_BODY_STATUS.has(upstream.status) ? null : upstream.body, {
      headers,
      status: upstream.status,
      statusText: upstream.statusText,
    });
  }

  /**
   * The call to Anthropic: the one way every request reaches a Claude target (an off slot's
   * model, a chain's `claude-…` target, a safety check Claude judges). A model call's body
   * loses the router's own marked thinking blocks on the way (`forClaude`); every other
   * byte goes as it is.
   */
  function anthropicUpstream(
    req: Request,
    url: URL,
    config: GatewayConfig,
    body: null | Uint8Array<ArrayBuffer>,
  ): Upstream {
    return {
      body: forClaude(url, body),
      headers: anthropicRequestHeaders(req.headers),
      method: req.method,
      url: `${deps.anthropicBaseUrl ?? config.anthropicBaseUrl}${url.pathname}${url.search}`,
    };
  }

  /**
   * A model call's body for a Claude target, without the thinking blocks a backend wrote
   * (the owner's D6, 2026-10-17): exactly the blocks whose signature carries the router's
   * mark (`withoutRouterThinking`), which Anthropic would refuse with a 400. The one change a
   * request to Claude ever gets beyond the named translations. The same bytes when there is
   * none: the bytes are searched for the mark first, and parsed only on a hit. Logged once
   * per model.
   */
  function forClaude(
    url: URL,
    body: null | Uint8Array<ArrayBuffer>,
  ): null | Uint8Array<ArrayBuffer> {
    if (body === null || (url.pathname !== MESSAGES_PATH && url.pathname !== COUNT_TOKENS_PATH)) {
      return body;
    }
    if (!holdsRouterMark(body)) return body;
    const parsed = parseBody(body);
    if (parsed === null) return body;
    const out = withoutRouterThinking(parsed);
    if (out.removed === 0) return body;
    const model = typeof parsed.model === "string" ? parsed.model : "-";
    if (!markedLogged.has(model)) {
      markedLogged.add(model);
      deps.log(
        `removed ${out.removed} of the router's own thinking blocks for ${printable(model)} (a Claude model refuses a signature it did not issue; logged once per model)`,
      );
    }
    return encoder.encode(JSON.stringify(out.body));
  }

  /**
   * A body Claude Code built for another name (a slot, an alias), for the Claude model
   * `model`: only the fields that model refuses changed (`requestForClaudeFallback`), each
   * kind of change logged once. The spread keeps every other field, and its order. Never
   * for auto mode's safety check (`guard`): it stays exactly as Claude Code ships it.
   */
  function fitForClaude(
    body: Record<string, unknown>,
    model: string,
    guard: boolean,
  ): Record<string, unknown> {
    if (guard) return body;
    const fitted = requestForClaudeFallback(body, model);
    const text = `${model}: ${fitted.changes.join(", ")}`;
    if (fitted.changes.length > 0 && !translationsLogged.has(text)) {
      translationsLogged.add(text);
      deps.log(
        `translated for ${printable(text, 200)} (requestForClaudeFallback; logged once per kind)`,
      );
    }
    return fitted.body;
  }

  /**
   * A body for a backend, its router-marked thinking blocks given back the signature their
   * backend wrote (`thinkingForBackend`). Logged once per backend target.
   */
  function ownThinkingFor(body: Record<string, unknown>, target: Target): Record<string, unknown> {
    const out = thinkingForBackend(body);
    const label = formatTarget(target);
    if (out.restored + out.bare > 0 && !restoredLogged.has(label)) {
      restoredLogged.add(label);
      deps.log(
        `${printable(label)} got its own signature back on ${out.restored} of the router's thinking blocks, ${out.bare} sent with none (thinkingForBackend; logged once per target)`,
      );
    }
    return out.body;
  }

  /**
   * The upstream call for one target, or why there is none. `guard`: the safety check.
   * `asked`: the Claude model the request named, and its bytes: a target that is that same
   * model gets the bytes as Claude Code sent them, built for it.
   */
  function targetUpstream(
    req: Request,
    url: URL,
    config: GatewayConfig,
    body: Record<string, unknown>,
    target: Target,
    guard: boolean,
    asked: Asked | null,
    pin: undefined | string,
  ): { error: string } | { upstream: Upstream } {
    if (target.kind === "anthropic" && asked !== null && sameModel(target.model, asked.model)) {
      return { upstream: anthropicUpstream(req, url, config, asked.sent) };
    }
    if (target.kind === "anthropic") {
      // `[1m]` is Claude Code's own mark, which it strips before it sends an id; Anthropic
      // knows no model by that name.
      const bytes = encoder.encode(
        JSON.stringify({
          ...fitForClaude(body, target.model, guard),
          model: withoutContextSuffix(target.model),
        }),
      );
      return { upstream: anthropicUpstream(req, url, config, bytes) };
    }
    const backend = Object.hasOwn(config.backends, target.backend)
      ? config.backends[target.backend]
      : undefined;
    if (backend === undefined) return { error: `backend "${target.backend}" is not in the config` };
    // `metadata` carries the Claude account id; an affordable backend never sees it.
    const affordableBody: Record<string, unknown> = {
      ...effortPinForBackend(
        reasoningOffForBackend(toolSearchForBackend(ownThinkingFor(body, target)), {
          absentIsOff: guard,
        }),
        pin,
      ),
      model: target.model,
    };
    delete affordableBody.metadata;
    return {
      upstream: {
        body: encoder.encode(JSON.stringify(affordableBody)),
        headers: backendRequestHeaders(req.headers, backend.apiKey),
        // Only the path: a query like `?beta=true` is Anthropic's, not the backend's.
        method: "POST",
        url: `${backend.baseUrl}${url.pathname}`,
      },
    };
  }

  /**
   * Remember how long a target rests after this result; an answer ends its rest.
   * A stream that opened with 200 and then reported an error in-band does not rest
   * the target: that error may be about this one request (a 400 in disguise).
   */
  function noteCooldown(label: string, result: Attempt): void {
    if ("response" in result && result.response.ok) {
      cooling.delete(label);
      return;
    }
    const status = "response" in result ? result.response.status : result.status;
    if (status !== null && status >= 200 && status <= 299) return;
    const retryAfter =
      "response" in result
        ? retryAfterSeconds(result.response.headers.get("retry-after"), deps.now())
        : null;
    const seconds = cooldownSeconds(status, retryAfter);
    if (seconds === null) return;
    cooling.set(label, deps.now() + seconds * 1000);
    restReasons.set(label, {
      reason: printable("response" in result ? `HTTP ${status}` : result.failure, 120),
      status,
    });
  }

  /** The targets resting now, with the seconds left; expired ones are forgotten. */
  function coolingNow(): Record<string, number> {
    const now = deps.now();
    const out: Record<string, number> = {};
    for (const [label, until] of cooling) {
      if (until <= now) cooling.delete(label);
      else out[label] = Math.ceil((until - now) / 1000);
    }
    return out;
  }

  /** The client hung up: free any answer, rest nothing, count no fallback. */
  function closed(result: Attempt, label: string): Outcome {
    if ("response" in result) void discard(result.response);
    return {
      fallbacks: 0,
      response: anthropicError(499, "api_error", "client closed the request"),
      skipped: 0,
      target: label,
    };
  }

  /**
   * Try each target in order until one answers. A resting target is skipped unless
   * it is the last. The last target's answer is returned whatever it is; with no
   * answer at all, a 502 in Anthropic's error shape. The caller passes only the targets
   * in use (`targetsInUse`): with the fallback switch off, one.
   *
   * With `hold` (the slot's breaker applies), the outcome also says whether every target
   * failed for want of capacity (`Outcome.capacity`): the caller then holds the request. While
   * a breaker is open (`hold.holding`), a resting backend is not asked even as the last
   * target, and one request at a time asks each target. Anthropic's answer is always the
   * answer, however it failed, so the last target being Anthropic never sets `capacity`.
   *
   * The one exception (the owner's D65): a Claude target behind the first that is at its
   * known plan limit (`knownLimit`) is not the chain's last word. While it rests it is
   * skipped, the last one included, so the target before it is the last one asked, by that
   * target's rules (the breaker's hold, or its own answer). Once its rest is over it is asked
   * again, like any resting target (an early reset ends the limit); with a backend before it,
   * a capacity failure then counts for the breaker like a backend's.
   */
  async function chain(
    req: Request,
    url: URL,
    config: GatewayConfig,
    body: Record<string, unknown>,
    targets: Target[],
    name: string,
    guard: boolean,
    /** The Claude model the request named, and its bytes (`targetUpstream`); a size WARN names it. */
    asked: Asked | null = null,
    hold: HoldMode | null = null,
  ): Promise<Outcome> {
    const sentPins = new Map<string, string>();
    const outcome = await chainAttempt(
      req,
      url,
      config,
      body,
      targets,
      name,
      guard,
      asked,
      hold,
      sentPins,
    );
    const pin = sentPins.get(outcome.target);
    return pin === undefined ? outcome : { ...outcome, effort: pin, effortPinned: true };
  }

  async function chainAttempt(
    req: Request,
    url: URL,
    config: GatewayConfig,
    body: Record<string, unknown>,
    targets: Target[],
    name: string,
    guard: boolean,
    asked: Asked | null,
    hold: HoldMode | null,
    sentPins: Map<string, string>,
  ): Promise<Outcome> {
    // A safety check is no conversation: the hint below ("/compact it …") would mislead.
    const standsInFor = guard ? null : (asked?.model ?? null);
    const failures: string[] = [];
    /** Each target's result in this pass, for the breaker. */
    const records: AttemptRecord[] = [];
    const note = (
      label: string,
      status: null | number,
      reason: string,
      capacity: boolean,
      until: number = cooling.get(label) ?? deps.now(),
    ): void => {
      records.push({ capacity, reason: printable(reason, 120), status, target: label, until });
    };
    /** The Claude targets skipped at their plan limit after the last one asked (D65). */
    const tail: AttemptRecord[] = [];
    /** Every target failed for want of capacity: each one's failure; undefined otherwise. */
    const capacityOf = (): BreakerFailure[] | undefined => {
      const all = [...records, ...tail];
      return hold !== null && all.length > 0 && all.every((record) => record.capacity)
        ? all.map((record) => ({
            reason: record.reason,
            status: record.status,
            target: record.target,
            until: record.until,
          }))
        : undefined;
    };
    let fallbacks = 0;
    let skipped = 0;
    /** The last target gave no headers by its deadline (only a safety check's judge has one). */
    let lastTimedOut = false;
    // D65: the Claude targets at the chain's end that are at their known plan limit and rest
    // are not asked, the last one included: the target before them is the last one asked.
    // The first target never is one, so a chain that starts with Claude asks it.
    const passMs = deps.now();
    const atLimit = targets.map((target, index) => {
      const limit = index === 0 ? null : knownLimit(target, passMs);
      const until = cooling.get(formatTarget(target));
      return limit === null || until === undefined || until <= passMs ? null : { limit, until };
    });
    let lastIndex = targets.length - 1;
    while (lastIndex > 0 && atLimit[lastIndex] !== null) lastIndex -= 1;
    /** Skip the target at `index`, after the last one asked: one line says why (D65). */
    const skipAtLimit = (index: number): void => {
      const target = targets[index];
      const skip = atLimit[index];
      if (target === undefined || skip === null || skip === undefined) return;
      const label = formatTarget(target);
      const claim = printable(skip.limit.claim ?? "plan limit", 40);
      failures.push(`${label}: at its plan usage limit`);
      tail.push({
        capacity: true,
        reason: `at its plan usage limit (${claim})`,
        status: 429,
        target: label,
        until: skip.until,
      });
      skipped += 1;
      // While the breaker holds, its own lines name the target, once and not once a pass.
      if (hold?.holding === true) return;
      deps.log(
        `WARN ${name}: ${label} skipped: at its plan usage limit (${claim}, resets ${new Date(skip.limit.resetsAt * 1000).toISOString()}); asked again from ${new Date(skip.until).toISOString()}`,
      );
    };
    for (const [index, target] of targets.entries()) {
      if (index > lastIndex) {
        skipAtLimit(index);
        continue;
      }
      const last = index === lastIndex;
      const label = formatTarget(target);
      /**
       * A Claude target at its known plan limit, asked again, with a backend before it (D65):
       * the breaker holds that backend's hiccup. A chain of Claude targets alone never holds.
       */
      const askedAtLimit =
        targets.slice(0, index).some((before) => before.kind === "backend") &&
        knownLimit(target, deps.now()) !== null;
      const restsUntil = cooling.get(label);
      const resting = restsUntil !== undefined && restsUntil > deps.now();
      // While a breaker is open, a resting backend is not asked even as the last target: the
      // requests that wait would otherwise ask it all at once. An Anthropic last target is
      // always asked, and its answer is the answer.
      if (resting && (!last || (hold?.holding === true && target.kind === "backend"))) {
        failures.push(`${label}: resting after a failure`);
        const why = restReasons.get(label);
        note(
          label,
          why?.status ?? null,
          why?.reason ?? "resting after a failure",
          true,
          restsUntil,
        );
        skipped += 1;
        continue;
      }
      if (hold?.holding === true && probing.has(label)) {
        failures.push(`${label}: another request is asking it`);
        note(label, null, "another request is probing it", true);
        skipped += 1;
        continue;
      }
      // The header deadline guards only where it can help: a streaming request to an
      // affordable backend with another target behind it. Anthropic, the last target and
      // a non-streaming answer (which may take minutes) wait as long as it takes;
      // the client hanging up still cancels them.
      // An auto-mode check on a backend (the judge) gets the deadline on every target, the
      // last too, though it does not stream: a judge that hangs would hold every action, the
      // judge after it would never be asked, and a lone judge would never answer at all.
      // With the breaker on, the last backend of a streaming request gets one too, a long one:
      // a stream of heartbeats only would stall Claude Code for 5 minutes, and a target that
      // never gives a real event opens the breaker instead.
      const firstByteWait =
        target.kind === "backend" && (guard || (!last && body.stream === true))
          ? config.timeouts.firstByteMs
          : null;
      const lastWaitMs =
        hold !== null && last && target.kind === "backend" && body.stream === true
          ? hold.lastWaitMs
          : null;
      // While the breaker is open a call is a probe: one request at a time asks each target.
      // Its wait is capped by what is left of the hold, so a probe cannot outlive the hold (a
      // hold never exceeds its limit), keep its target blocked for every other request after
      // it, or rest a target that works because the router's own deadline cut it short. A
      // probe of a request that does not stream gets a deadline too (`firstByteMs`): with
      // none, a hung probe would block every other request's probe of that target for ever,
      // and the breaker could never close. Anthropic keeps its own wait: its answers always
      // pass unchanged.
      const budgetMs =
        last && target.kind === "backend" && body.stream === true && hold !== null
          ? BREAKER_HEARTBEAT_WAIT_MS
          : (firstByteWait ?? config.timeouts.firstByteMs);
      const probeWaitMs =
        hold?.holding === true && target.kind === "backend"
          ? Math.min(budgetMs, hold.leftMs)
          : null;
      const waitMs = probeWaitMs ?? lastWaitMs ?? firstByteWait;
      const deadlineAt = waitMs === null ? null : deps.now() + waitMs;
      /** The hold's end, not the target, set this wait: a timeout then says nothing of it. */
      const holdCutShort =
        hold?.holding === true && target.kind === "backend" && hold.leftMs < budgetMs;
      const pin = effortPin(config, name, label);
      const built = targetUpstream(req, url, config, body, target, guard, asked, pin);
      if (!("error" in built) && target.kind === "backend" && pin !== undefined)
        sentPins.set(label, pin);
      // A call made while a breaker is open is a probe: it is the only one for this target.
      const probe = hold?.holding === true && !("error" in built);
      if (probe) {
        probing.add(label);
        if (hold !== null) hold.probes.count += 1;
      }
      let result: Attempt;
      try {
        result =
          "error" in built
            ? { failure: built.error, status: null }
            : await send(req, built.upstream, deadlineAt);
        if (req.signal.aborted) return closed(result, label);
        if (target.kind === "anthropic" && "response" in result) {
          observeClaude(target.model, result.response, url.pathname);
        }
        // A backend's stream is held until its first real event while another target can
        // still answer, and for a safety check on every target, the last too: its deadline
        // holds after the headers as well (a stream of heartbeats would hold every action).
        if (
          "response" in result &&
          (!last || guard || lastWaitMs !== null) &&
          target.kind === "backend" &&
          result.response.ok &&
          (result.response.headers.get("content-type") ?? "").includes("text/event-stream")
        ) {
          result = await holdFirstEvent(result.response, deadlineAt, {
            known: knownSecrets(req, config),
            last,
          });
          // A hang-up during the hold breaks the read: the client's doing, not the
          // target's — it must not rest the target for every other session.
          if (req.signal.aborted) return closed(result, label);
        } else if (
          "response" in result &&
          !last &&
          target.kind === "backend" &&
          result.response.ok &&
          (result.response.headers.get("content-type") ?? "").includes("application/json")
        ) {
          result = await readJsonAnswer(result.response, knownSecrets(req, config));
          if (req.signal.aborted) return closed(result, label);
        }
      } finally {
        if (probe) probing.delete(label);
      }
      // Only a model's answer says whether a target can answer: a `count_tokens` answer
      // neither starts nor ends a rest (its 200 during a plan limit says nothing of it).
      // A probe whose wait the hold's end cut short timed out on the router's deadline, not
      // the target's: it must not rest a target that works for every other session.
      const timeoutCutShort =
        holdCutShort &&
        "failure" in result &&
        (result.failure === NO_HEADERS_IN_TIME || result.failure === NO_EVENT_IN_TIME);
      if (url.pathname === MESSAGES_PATH && !timeoutCutShort) noteCooldown(label, result);
      if ("failure" in result) {
        lastTimedOut =
          last && (result.failure === NO_HEADERS_IN_TIME || result.failure === NO_EVENT_IN_TIME);
        failures.push(`${label}: ${result.failure}`);
        // A target missing from the config is the person's to fix, never a want of capacity.
        note(
          label,
          result.status,
          result.failure,
          !("error" in built) && isCapacityFailure(result.status),
        );
        if (!last) {
          fallbacks += 1;
          deps.log(`WARN ${label} failed (${result.failure}); trying the next target`);
        }
        continue;
      }
      const status = result.response.status;
      const decision = fallbackKind(status, target);
      if (decision === "stay" || last) {
        // The chain would have moved on: the Claude targets after this one are skipped (D65).
        if (decision !== "stay") {
          for (let next = index + 1; next < targets.length; next += 1) skipAtLimit(next);
        }
        if (target.kind === "backend" && status >= 300 && status <= 399) {
          // Claude Code could follow the `Location` with the person's own login.
          logErrorAnswer(
            result.response,
            knownSecrets(req, config),
            `WARN ${label} answered a redirect (${status}); refused`,
          );
          return {
            fallbacks,
            response: anthropicError(
              502,
              "api_error",
              `cc-smart-dev-kit-router: ${label} answered a redirect (${status}); not passed on`,
            ),
            skipped,
            target: label,
          };
        }
        if (target.kind === "backend" && (status === 401 || status === 403)) {
          // A backend refusing its own key. Passed on, Claude Code would read it as its own
          // login failing ("Please run /login"), which cannot fix a backend key. A 5xx would
          // be retried up to 10 times, each one refused again. A 424 is neither retried nor
          // sent again (`./refusal.ts`), and `x-should-retry: false` says so to its API
          // client too; a safety check, which carries no deferred tools, keeps the 400.
          const refused = backendKeyRefused(label, target.backend, status, !guard);
          logErrorAnswer(
            result.response,
            knownSecrets(req, config),
            `WARN ${label} answered ${status}; returned as a ${refused.status} (the backend refused its key)`,
          );
          return {
            fallbacks,
            response: refused,
            skipped,
            target: label,
          };
        }
        if (status >= 400) {
          // Any target, Anthropic too: its reason is the only trace of why the slot
          // failed. Read from a copy: Claude Code still gets the whole answer, at once.
          const known = knownSecrets(req, config);
          const follow =
            target.kind === "anthropic"
              ? signatureWarn(target.model, status)
              : standsInFor === null || (status !== 400 && status !== 413)
                ? undefined
                : (snippet: string) => {
                    const kind = TOO_LONG.test(snippet)
                      ? "too long"
                      : UNSUPPORTED.test(snippet)
                        ? "a kind of content it does not take"
                        : null;
                    if (kind === null) return;
                    deps.log(
                      `WARN ${name}: ${label} refused this ${standsInFor} conversation (${kind}). A long ([1m], 200k+ tokens) or rich (images, documents, server tools) ${standsInFor} conversation may be more than ${label} takes: /compact it, start a new one, or put a target that takes it first in ${name}`,
                    );
                  };
          if (
            target.kind === "backend" &&
            !guard &&
            url.pathname === MESSAGES_PATH &&
            isRefusalStatus(status)
          ) {
            // Claude Code sends a 400 or 422 it does not know again without its deferred
            // tools, and the chain is walked twice: relay the refusal in a form it does not
            // send again (`./refusal.ts`). The reason is read here, so the answer waits for it
            // (one chunk, at most a second).
            const snippet = await errorSnippet(result.response, known);
            const refused = backendRefusal(label, status, snippet);
            deps.log(
              `WARN ${label} answered ${status}; returned as a ${refused.status} (Claude Code would send a ${status} again without its deferred tools) — ${snippet}`,
            );
            follow?.(snippet);
            return { fallbacks, response: refused, skipped, target: label };
          }
          logErrorAnswer(
            result.response.clone(),
            known,
            `WARN ${label} answered ${status}; returned as it is`,
            follow,
          );
        }
        const answer: Outcome = {
          fallbacks,
          response: relay(result.response, target),
          skipped,
          target: label,
        };
        // The last backend failed for want of capacity: when every other target did too, the
        // breaker decides what the request gets. Anthropic's answer is never held, but for a
        // Claude target asked again at its known plan limit (D65).
        if (
          last &&
          hold !== null &&
          (target.kind === "backend" || askedAtLimit) &&
          isCapacityFailure(status)
        ) {
          note(label, status, `HTTP ${status}`, true);
          const capacity = capacityOf();
          if (capacity !== undefined) answer.capacity = capacity;
        }
        return answer;
      }
      // Reading the snippet also cancels the rest of this discarded answer; the next
      // target is asked meanwhile.
      logErrorAnswer(
        result.response,
        knownSecrets(req, config),
        `WARN ${label} answered ${status}; trying the next target`,
      );
      failures.push(`${label}: HTTP ${status}`);
      note(label, status, `HTTP ${status}`, isCapacityFailure(status));
      fallbacks += 1;
    }
    // The last target that could be asked: a Claude target skipped after it answered nothing.
    const lastTarget = targets[lastIndex];
    const answered = failures.join("; ") || "no targets";
    const capacity = capacityOf();
    return {
      ...(capacity === undefined ? {} : { capacity }),
      fallbacks,
      // A judge that never answered: a timeout in Anthropic's shape, so Claude Code fails the
      // check (and asks the person, or tries another model) instead of waiting on it.
      response: lastTimedOut
        ? anthropicError(
            504,
            "timeout_error",
            `cc-smart-dev-kit-router: no target for ${name} answered within ${config.timeouts.firstByteMs} ms (${answered})`,
          )
        : anthropicError(
            502,
            "api_error",
            `cc-smart-dev-kit-router: no target for ${name} answered (${answered})`,
          ),
      skipped,
      target: lastTarget === undefined ? "none" : formatTarget(lastTarget),
    };
  }

  function refusal(message: string): Outcome {
    return {
      fallbacks: 0,
      response: anthropicError(403, "permission_error", message),
      skipped: 0,
      target: "refused",
    };
  }

  /** How long one request may be held, from its start: 60 s at most when it does not stream. */
  function holdLimitMs(config: GatewayConfig, body: Record<string, unknown>): number {
    const limit = breakerHoldMs(config);
    return body.stream === true ? limit : Math.min(limit, BREAKER_HOLD_NON_STREAMING_MS);
  }

  /** How a pass over the chain treats the breaker (`HoldMode`). */
  function holdMode(
    config: GatewayConfig,
    body: Record<string, unknown>,
    startMs: number,
    holding: boolean,
    probes: { count: number },
  ): HoldMode {
    const limit = holdLimitMs(config, body);
    // The wait counts from the request's start, so it and the hold stay under the ceiling.
    // With no hold (`0`) there is no limit to stay within: a probe gets its own wait.
    const left = limit === 0 ? Number.POSITIVE_INFINITY : Math.max(startMs + limit - deps.now(), 0);
    return {
      holding,
      lastWaitMs: limit === 0 ? null : Math.min(BREAKER_HEARTBEAT_WAIT_MS, Math.max(left, 1)),
      leftMs: left,
      probes,
    };
  }

  /** Put a slot's open breaker into the limit state and queue the write. */
  function recordBreaker(slot: string, open: OpenBreaker): void {
    const now = deps.now();
    open.savedAt = now;
    limitState.breakers = {
      ...limitState.breakers,
      [slot]: {
        held: open.held,
        lastAt: now,
        since: open.since,
        targets: open.failures.map((failure) => ({
          status: failure.status,
          target: failure.target,
          until: failure.until,
        })),
      },
    };
    persist();
  }

  /**
   * The slot's breaker, opened if it is not: one WARN and one write of its record when it
   * opens (a record a restart kept gives its start back), and the targets' failures kept
   * fresh after that. The record's `lastAt` reaches the file at most once a minute while
   * requests keep coming, so a router that stopped leaves a record that goes stale
   * (`currentBreakers`).
   */
  function breakerFor(
    slot: string,
    profile: null | string,
    failures: BreakerFailure[],
    holdMs: number,
  ): OpenBreaker {
    const now = deps.now();
    // A profile's chain is its own, so its breaker and its record are its own (`stateKeyFor`).
    const key = stateKeyFor(slot, profile);
    const existing = openBreakers.get(key);
    if (existing !== undefined) {
      existing.failures = failures;
      if (now - existing.savedAt >= FALLBACK_SAVE_EVERY_MS) recordBreaker(key, existing);
      return existing;
    }
    const before = currentBreakers(limitState, now).find(([stored]) => stored === key)?.[1];
    const open: OpenBreaker = {
      failures,
      held: before?.held ?? 0,
      heldNow: 0,
      reminderAt: now,
      savedAt: now,
      since: before?.since ?? now,
    };
    openBreakers.set(key, open);
    recordBreaker(key, open);
    const wait = clientRetryAfter(earliestRestSeconds(failures, now));
    deps.log(
      `WARN ${key}: every target limited or down (${describeFailures(failures, now)}); holding requests up to ${Math.round(holdMs / 1000)} s, then asking Claude Code to retry (retry-after ${wait})`,
    );
    return open;
  }

  /**
   * The breaker is over for this slot: a target answered, or the slot's switch went off or
   * the slot left the config. Its record leaves the state, with one line. A record a restart
   * kept, for a breaker this router never opened, goes the same way.
   */
  function closeBreaker(slot: string, profile: null | string, why: string): void {
    const key = stateKeyFor(slot, profile);
    const open = openBreakers.get(key);
    const stored =
      limitState.breakers !== undefined && Object.hasOwn(limitState.breakers, key)
        ? limitState.breakers[key]
        : undefined;
    if (open === undefined && stored === undefined) return;
    const since = open?.since ?? stored?.since ?? deps.now();
    const held = open?.held ?? stored?.held ?? 0;
    openBreakers.delete(key);
    delete limitState.breakers?.[key];
    withoutEmptyBreakers(limitState);
    persist();
    deps.log(`${key}: ${why} after ${formatDuration(deps.now() - since)}; ${held} requests held`);
  }

  /** The breakers open now, for the health page. */
  function breakersNow(): Record<string, unknown> {
    return Object.fromEntries(
      [...openBreakers].map(([slot, open]) => [
        slot,
        {
          held: open.held,
          heldNow: open.heldNow,
          since: open.since,
          targets: open.failures.map((failure) => ({
            status: failure.status,
            target: failure.target,
            until: failure.until,
          })),
        },
      ]),
    );
  }

  /**
   * Waits `ms` (`RouterDeps.sleep`), or less: it ends at once when a signal aborts (the
   * client hung up, the router is stopping).
   */
  function pause(ms: number, ...signals: (AbortSignal | undefined)[]): Promise<void> {
    return new Promise((resolve) => {
      const live = signals.filter((signal) => signal !== undefined);
      const finish = () => {
        for (const signal of live) signal.removeEventListener("abort", finish);
        resolve();
      };
      if (live.some((signal) => signal.aborted)) return finish();
      for (const signal of live) signal.addEventListener("abort", finish, { once: true });
      void sleep(ms).then(finish);
    });
  }

  /**
   * Holds a request whose slot has every target limited or down, up to its hold (from its
   * start), and answers a 429 Claude Code retries by itself (`breakerAnswer`).
   *
   * While it waits, the config is read once a second: a changed chain is served at once, a
   * slot taken out of the config releases the request (retry-after 1: the retry routes it
   * the way a new request goes), and a switch turned off serves it the normal way. Each pass
   * asks only a target that does not rest and that no other request is probing, so the
   * waiting requests are not a storm: a probe that answers closes the breaker and every
   * request goes on the normal chain. A hang-up rests nothing (499). At most
   * `BREAKER_MAX_HELD` requests wait per slot: the next one is answered at once. At SIGTERM
   * every waiting request is answered with a short `retry-after`.
   */
  async function holdRequest(
    ctx: {
      asked: Asked | null;
      body: Record<string, unknown>;
      profile: null | string;
      probes: { count: number };
      req: Request;
      slot: string;
      startMs: number;
      url: URL;
    },
    config0: GatewayConfig,
    targets0: Target[],
    first: Outcome,
  ): Promise<{ outcome: Outcome; targets: Target[] }> {
    const { asked, body, profile, probes, req, slot, startMs, url } = ctx;
    const key = stateKeyFor(slot, profile);
    let config = config0;
    let targets = targets0;
    let outcome = first;
    let open = breakerFor(slot, profile, first.capacity ?? [], holdLimitMs(config, body));
    let counted: OpenBreaker | null = null;
    /** The router was told to stop (SIGTERM). */
    const stopping = (): boolean => deps.shutdown?.aborted === true;
    const answer = (response: Response): { outcome: Outcome; targets: Target[] } => ({
      outcome: {
        breaker: { held: counted !== null, probes: probes.count },
        fallbacks: 0,
        response,
        skipped: 0,
        target: `breaker(${key})`,
      },
      targets,
    });
    /** The WARN that the slot is still limited, at most once every `BREAKER_REMINDER_MS`. */
    const remind = (nowMs: number): void => {
      if (nowMs - open.reminderAt < BREAKER_REMINDER_MS) return;
      open.reminderAt = nowMs;
      deps.log(
        `WARN ${key}: still limited or down since ${formatClock(Math.floor(open.since / 1000), nowMs)}; ${open.held} requests held so far. Change it: ${breakerChangeHint(slot, profile)}`,
      );
    };
    try {
      for (;;) {
        // The answer a pass would have given is not used: drop its body.
        void discard(outcome.response);
        const now = deps.now();
        const failures = outcome.capacity ?? [];
        const endsAt = startMs + holdLimitMs(config, body);
        const reply = (nowMs: number, retryAfterSec?: number, message?: string): Response =>
          breakerAnswer({
            failures,
            nowMs,
            profile,
            sinceMs: open.since,
            slot,
            ...(retryAfterSec === undefined ? {} : { retryAfterSec }),
            ...(message === undefined ? {} : { message }),
          });
        if (stopping()) {
          return answer(
            reply(
              now,
              BREAKER_SHUTDOWN_RETRY_AFTER_SEC,
              `cc-smart-dev-kit-router: the router is restarting; ${slot} had no target answering. Ask again`,
            ),
          );
        }
        if (now >= endsAt) {
          remind(now);
          return answer(reply(now));
        }
        if (counted === null) {
          if (open.heldNow >= BREAKER_MAX_HELD) return answer(reply(now));
          counted = open;
          open.heldNow += 1;
          open.held += 1;
        }
        await pause(Math.min(BREAKER_POLL_MS, endsAt - now), req.signal, deps.shutdown);
        // The client hung up: rest nothing, as for any hang-up.
        if (req.signal.aborted) {
          return answer(anthropicError(499, "api_error", "client closed the request"));
        }
        if (stopping()) continue;
        // The profile's view of the config, read again: a changed chain is served at once,
        // and a profile removed or turned off releases the request the same way.
        const next = configFor(profile);
        const route = resolveRoute(slot, next);
        if (route.kind !== "slot" || route.targets.length === 0) {
          return answer(
            reply(
              now,
              BREAKER_RELEASED_RETRY_AFTER_SEC,
              `cc-smart-dev-kit-router: ${slot} has no chain any more; ask again`,
            ),
          );
        }
        config = next;
        targets = targetsInUse(route.targets, fallbackOn(next, slot));
        const holds = breakerOn(next, slot);
        // What is left of the hold is under a target's first-byte time: a probe now could
        // only fail on the hold's own deadline, and rest a target that works. Answer the 429
        // now, as at the hold's end (its reminder included). A switch turned off is served
        // the normal way instead, below.
        const probingAt = deps.now();
        if (holds && startMs + holdLimitMs(next, body) - probingAt < next.timeouts.firstByteMs) {
          remind(probingAt);
          return answer(reply(probingAt));
        }
        outcome = await chain(
          req,
          url,
          config,
          body,
          targets,
          slot,
          false,
          asked,
          holds ? holdMode(config, body, startMs, openBreakers.has(key), probes) : null,
        );
        if (req.signal.aborted) return { outcome, targets };
        // A target answered (or the switch went off): the request goes on the normal way.
        if (outcome.capacity === undefined) return { outcome, targets };
        open = breakerFor(slot, profile, outcome.capacity, holdLimitMs(config, body));
      }
    } finally {
      if (counted !== null) counted.heldNow -= 1;
    }
  }

  /**
   * A slot's request, the same way for every slot: its targets in use (`targetsInUse`: the
   * whole chain while its fallback switch is on, the first alone while it is off), in order
   * (`chain`). `count_tokens` has no fallback: the first target answers, and a backend there
   * means a 404 (Claude Code estimates). `asked`: the Claude model the request named, when it
   * reached the slot by its family.
   *
   * Then, for a slot whose first target is a Claude model at its plan limit, a next target
   * that answered starts its fallback record (`noteFallback`). And an answer for `asked` that
   * a backend gave gets its thinking marked as the router's (`cleanAnswer`): Claude Code
   * keeps it in that model's conversation. Another Claude model's answer is left as it is.
   */
  async function slotRequest(
    req: Request,
    url: URL,
    config: GatewayConfig,
    body: Record<string, unknown>,
    slot: string,
    chained: Target[],
    guard: boolean,
    asked: Asked | null,
    /** The profile the path named; its chain, its rests and its records are its own. */
    profile: null | string,
  ): Promise<Outcome> {
    const startMs = deps.now();
    let targets = guard ? chained : targetsInUse(chained, fallbackOn(config, slot));
    if (url.pathname === COUNT_TOKENS_PATH) {
      const first = targets[0];
      // Token counting has no fallback: the first target answers, or no one does.
      if (first === undefined || first.kind === "backend") {
        return {
          fallbacks: 0,
          response: anthropicError(
            404,
            "not_found_error",
            `count_tokens is not available for ${slot}; Claude Code estimates instead`,
          ),
          skipped: 0,
          target: first === undefined ? "none" : formatTarget(first),
        };
      }
      return chain(req, url, config, body, [first], slot, guard, asked);
    }
    // The breaker applies to a model call of a slot whose switch is on, never to a safety
    // check (it has a deadline on every target and a 504; a held check would freeze every
    // action). An explicit `<backend>:<model>` does not come through here at all.
    const breaks = !guard && url.pathname === MESSAGES_PATH && breakerOn(config, slot);
    const probes = { count: 0 };
    let outcome = await chain(
      req,
      url,
      config,
      body,
      targets,
      slot,
      guard,
      asked,
      breaks
        ? holdMode(config, body, startMs, openBreakers.has(stateKeyFor(slot, profile)), probes)
        : null,
    );
    if (breaks && outcome.capacity !== undefined && !req.signal.aborted) {
      const held = await holdRequest(
        { asked, body, probes, profile, req, slot, startMs, url },
        config,
        targets,
        outcome,
      );
      outcome = held.outcome;
      targets = held.targets;
    }
    const first = targets[0];
    if (breaks && outcome.breaker === undefined && !req.signal.aborted && outcome.response.ok) {
      closeBreaker(slot, profile, "answers again");
    }
    if (req.signal.aborted || first === undefined || outcome.breaker !== undefined) return outcome;
    if (first.kind === "anthropic" && outcome.target !== formatTarget(first)) {
      const limited = withoutContextSuffix(first.model);
      const limit = currentLimits(limitState, deps.now()).find(([model]) => model === limited);
      if (limit !== undefined) noteFallback(slot, limited, limit[1], outcome, profile);
    }
    if (asked === null || sameModel(outcome.target, asked.model)) return outcome;
    if (outcome.response.ok) fellBack.add(asked.model);
    // Another Claude model's answer goes as Anthropic sent it: the API drops a thinking
    // block the next Claude model cannot read (`fallback-answer.ts`).
    const answered = targets.find((target) => formatTarget(target) === outcome.target);
    if (answered?.kind !== "backend") return outcome;
    return { ...outcome, response: cleanAnswer(slot, outcome) };
  }

  /**
   * A backend's answer for a Claude model's request (`cleanFallbackResponse`): its thinking
   * kept, each block's signature the router's mark, its `redacted_thinking` out, `tool_use`
   * ids Claude takes. Claude Code keeps it in the conversation; on the way to any Claude
   * target the marked blocks go again (`forClaude`), since a Claude model refuses a
   * signature it did not issue. `fallbackAnswersAsIs` (tests only) skips it.
   */
  function cleanAnswer(slot: string, outcome: Outcome): Response {
    if (deps.fallbackAnswersAsIs === true) return outcome.response;
    const cleaned = cleanFallbackResponse(outcome.response, (changes) => {
      const kinds = [
        changes.marked > 0
          ? "thinking blocks marked as the router's (removed on the way to a Claude model, their own signature given back on the way to a backend)"
          : "",
        changes.redacted > 0 ? "redacted_thinking blocks removed" : "",
        changes.ids > 0 ? "tool_use ids made safe" : "",
      ].filter((part) => part !== "");
      const text = `${slot}: ${outcome.target}'s answers: ${kinds.join(", ")}`;
      if (cleanedLogged.has(text)) return;
      cleanedLogged.add(text);
      deps.log(`${text}; logged once per kind`);
    });
    if (cleaned.note !== null) deps.log(`WARN ${slot}: ${outcome.target}: ${cleaned.note}`);
    return cleaned.response;
  }

  /**
   * Count one auto mode safety check (`safety-checks.ts`), and read the tokens its answer
   * reported. The check counts as soon as it has an answer; the tokens are read from a copy
   * of the bytes on their way to Claude Code (`observedAnswer`) and written in the
   * background, so the count never slows an answer and never changes a byte of it.
   */
  function countedCheck(judged: Promise<Outcome>): Promise<Outcome> {
    const day = localDay(deps.now());
    return judged.then((outcome) => {
      const side = answeredSide(outcome.target);
      recordSafetyCheck(safetyChecks, day, side);
      persistChecks();
      return {
        ...outcome,
        response: observedAnswer(outcome.response, (tokens) => {
          if (tokens === null || side === null) return;
          addCheckTokens(safetyChecks, day, side, tokens);
          persistChecks();
        }),
      };
    });
  }

  /**
   * An answer as Claude Code gets it: byte for byte, and its `usage` read on the way. Every
   * chunk is handed to the client first, so the client's own backpressure still holds the
   * upstream and nothing is held back; the reader sees the same bytes, decoded when the
   * answer came compressed, and `note` runs once the last of them is through — in the
   * background, never on the answer's path. A client that hangs up cancels the upstream
   * exactly as it did before, and the reader reports what it had read.
   *
   * The bytes are not kept (`AnswerUsageReader` reads each server-sent event as it ends), so
   * a long answer is read without growing the router's memory. An answer the reader cannot
   * make sense of (an encoding it cannot decode, a JSON body that is not JSON or is larger
   * than `CHECK_USAGE_MAX_BYTES`) reports null: the check is counted or the history row is
   * written, its tokens are not. That is what an answer with no `usage` says too, and
   * guessing one would be worse than not knowing.
   */
  function observedAnswer(
    response: Response,
    note: (tokens: null | CheckTokens) => void,
  ): Response {
    const body = response.body;
    if (body === null) {
      note(null);
      return response;
    }
    const streaming = (response.headers.get("content-type") ?? "").includes("text/event-stream");
    const encoding = (response.headers.get("content-encoding") ?? "").trim().toLowerCase();
    const format =
      encoding === "" || encoding === "identity" ? null : decompressionFormat(encoding);
    // An encoding the router cannot decode: the client may know it, the reader does not.
    const undecodable = encoding !== "" && encoding !== "identity" && format === null;
    const usage = new AnswerUsageReader(streaming);
    // A compressed answer is decompressed on a second branch, for the reader only: the
    // client still gets the compressed bytes exactly as they came.
    let decode: null | {
      done: Promise<void>;
      writer: { close(): Promise<void>; write(chunk: Uint8Array<ArrayBuffer>): Promise<void> };
    } = null;
    if (format !== null) {
      const decompressor = new DecompressionStream(format);
      const writer = decompressor.writable.getWriter();
      const done = (async () => {
        const decoded = decompressor.readable.getReader();
        for (;;) {
          const step = await decoded.read();
          if (step.done) return;
          usage.push(step.value);
        }
      })().catch(() => {
        // A compressed stream that cannot be decoded: what was read before it stands.
      });
      decode = { done, writer };
    }
    const reader = body.getReader();
    let ended = false;
    const finish = (): void => {
      if (ended) return;
      ended = true;
      const task = (async () => {
        if (undecodable) {
          note(null);
          return;
        }
        if (decode !== null) {
          try {
            await decode.writer.close();
          } catch {
            // The compressed stream was cut: what was decoded before it still counts.
          }
          // `done` never rejects: a decode that failed kept what it had read.
          await decode.done;
        }
        note(usage.tokens());
      })();
      deps.background?.(task);
    };
    const observed = new ReadableStream<Uint8Array>({
      cancel(reason) {
        finish();
        return reader.cancel(reason);
      },
      async pull(controller) {
        let step: Awaited<ReturnType<typeof reader.read>>;
        try {
          step = await reader.read();
        } catch (error) {
          // The client gets the same failure it got before the counting existed.
          controller.error(error);
          finish();
          return;
        }
        if (step.done) {
          controller.close();
          finish();
          return;
        }
        controller.enqueue(step.value);
        if (undecodable) return;
        if (decode !== null) {
          // The decoder reads alongside the client. A failed write ends its branch; the
          // answer is already on its way, and the client never waits for the reader.
          decode.writer.write(step.value as Uint8Array<ArrayBuffer>).catch(() => {});
          return;
        }
        usage.push(step.value);
      },
    });
    return new Response(observed, {
      headers: response.headers,
      status: response.status,
      statusText: response.statusText,
    });
  }

  async function route(
    req: Request,
    url: URL,
    model: { guard: boolean; name: string; slot: null | string },
    /** The profile the path named (`…/p/<profile>`), or null for the machine's default. */
    profile: null | string,
  ): Promise<Outcome> {
    const config = configFor(profile);
    dropRemovedFallbacks(deps.getConfig());
    const isMessages =
      req.method === "POST" &&
      (url.pathname === MESSAGES_PATH || url.pathname === COUNT_TOKENS_PATH);
    if (isMessages) {
      const type = (req.headers.get("content-type") ?? "").split(";")[0]?.trim().toLowerCase();
      if (type !== "application/json" || !req.headers.has("anthropic-version")) {
        return refusal(
          "cc-smart-dev-kit-router wants content-type: application/json and an anthropic-version header",
        );
      }
    }
    // No body when the client sent none: a DELETE must not gain `content-length: 0`.
    // `bytes` is replaced below when an alias changes the model; `sent` never is.
    const sent =
      req.method === "GET" || req.method === "HEAD" || req.body === null
        ? null
        : new Uint8Array(await req.arrayBuffer());
    let bytes = sent;

    /**
     * Anthropic's answer to the bytes sent, as Claude Code gets it. `observed`: the Claude
     * model the bytes name, whose answer's headers note or end a plan limit (`observeClaude`),
     * and whose bad-signature 400 names its cause (`signatureWarn`).
     */
    const answerDirect = (result: Attempt, observed: null | string): Outcome => {
      if (observed !== null && "response" in result) {
        observeClaude(observed, result.response, url.pathname);
      }
      // Only a model's answer: another path (`/v1/models`, a file, an account page) is
      // passed on as it is, and its errors are not the router's to log.
      if (isMessages && "response" in result && result.response.status >= 400) {
        logErrorAnswer(
          result.response.clone(),
          knownSecrets(req, config),
          `WARN anthropic answered ${result.response.status}`,
          observed === null ? undefined : signatureWarn(observed, result.response.status),
        );
      }
      const response =
        "response" in result
          ? relay(result.response, null)
          : anthropicError(
              502,
              "api_error",
              `cc-smart-dev-kit-router: Anthropic did not answer (${result.failure})`,
            );
      return { fallbacks: 0, response, skipped: 0, target: "anthropic" };
    };
    const direct = async (body = bytes, observed: null | string = null): Promise<Outcome> =>
      answerDirect(await send(req, anthropicUpstream(req, url, config, body), null), observed);

    if (!isMessages) return direct();

    const parsed = bytes === null ? null : parseBody(bytes);
    if (parsed === null) {
      return {
        fallbacks: 0,
        response: anthropicError(
          400,
          "invalid_request_error",
          "the request body is not a JSON object",
        ),
        skipped: 0,
        target: "none",
      };
    }
    if (typeof parsed.model === "string") {
      model.name = parsed.model;
      // The id as Claude Code sent it, before any alias: what the person's login can name.
      noteSeenClaude(parsed.model);
    }
    // The safety check is recognised on the request as it came, an old name included: an
    // alias may point at an affordable backend, and with the judge off the check stays on Claude.
    const guard = isAutoModeGuard(parsed, config.aliases);
    model.guard = guard;
    // Then the old name, so the rest routes on the name it stands for; even the safety
    // check, whose newer form is sent under the sonnet name.
    const alias = resolveAlias(parsed.model, config.aliases);
    let body = parsed;
    if (alias !== null) {
      if (!aliasesLogged.has(alias.from)) {
        aliasesLogged.add(alias.from);
        deps.log(
          `alias ${printable(alias.from)} → ${printable(alias.to)} (from the config's aliases; logged once per name)`,
        );
      }
      // `model` changes; the spread keeps every other field, and its order. An alias to a
      // `claude-…` target goes straight to Anthropic with a body Claude Code built for the
      // old name, so it gets what a slot's Claude target gets: only the fields that model
      // refuses translated (`fitForClaude`), never for the safety check.
      body = { ...parsed, model: alias.to };
      if (alias.to.startsWith("claude-")) body = fitForClaude(body, alias.to, guard);
      bytes = encoder.encode(JSON.stringify(body));
    }
    // Its newer form carries the sonnet slot's name; the log must still tell it apart.
    if (guard) model.name = `${model.name} (safety check)`;
    // An Anthropic server tool runs on Anthropic only (D41), so the request goes there as
    // Claude Code sent it, whatever slot its model's family has. A name the router owns (a
    // slot key, `<backend>:<model>`, an alias) keeps its route: Anthropic would refuse it.
    const serverTool =
      guard || alias !== null || resolveRoute(body.model, config).kind !== "anthropic"
        ? null
        : anthropicServerTool(body);
    if (serverTool !== null) return serverToolRoute(serverTool);
    // A check goes to the judge slot when the person gave it a chain, like any slot's
    // request; only a Claude target, or a target `gateway slot judge` tested (an untested one
    // is ignored, with one WARN). With none, Claude judges first (D44): then the worker
    // chain's tested targets while Claude cannot (`claudeFirstJudge`), else Claude alone.
    const judgeTargets = guard ? judgeTargetsOf(config) : [];
    if (judgeTargets.length > 0) model.slot = JUDGE_SLOT;
    const answered =
      judgeTargets.length > 0
        ? slotRequest(req, url, config, body, JUDGE_SLOT, judgeTargets, true, null, profile)
        : ((guard ? claudeFirstJudge() : null) ?? claudeRoute());
    // Auto mode's safety check, counted (`countedCheck`). A check is a `/v1/messages`
    // request: a `count_tokens` for one counts tokens, it judges nothing.
    return guard && url.pathname === MESSAGES_PATH ? countedCheck(answered) : answered;

    /**
     * A request that carries an Anthropic server tool (D41; `server-tools.ts`). Anthropic
     * gets it with the bytes Claude Code sent, on the person's own login, and its answer
     * goes back unchanged. The log line says why this request did not follow its model's slot.
     *
     * When Claude cannot answer a `/v1/messages` call (D44: a capacity failure, 429, 5xx or
     * no answer at all), the router answers instead, in Anthropic's message format with one
     * plain text block that says it is the router's, names the server tool that failed, and
     * points to the Tavily MCP server. Claude Code takes such an answer as the tool's result
     * at once; the failure itself would be retried for minutes. Any other status passes
     * unchanged. The breaker (BR1) never holds such a request: it is answered or refused at
     * once.
     */
    async function serverToolRoute(tool: string): Promise<Outcome> {
      const why = `server tool ${tool}`;
      const named =
        typeof body.model === "string" && body.model.startsWith("claude-") ? body.model : null;
      const result = await send(req, anthropicUpstream(req, url, config, sent), null);
      if (req.signal.aborted) return closed(result, `anthropic (${why})`);
      const status = "response" in result ? result.response.status : null;
      if (url.pathname !== MESSAGES_PATH || (status !== null && !capacityFailureStatus(status))) {
        return { ...answerDirect(result, named), target: `anthropic (${why})` };
      }
      let limit: null | PlanLimit = null;
      if ("response" in result) {
        const upstream = result.response;
        limit = planUsageLimit(upstream.status, (name) => upstream.headers.get(name));
        if (named !== null) observeClaude(named, upstream, url.pathname);
        logErrorAnswer(
          upstream,
          knownSecrets(req, config),
          `WARN anthropic answered ${upstream.status} to a ${tool} request; the router answered with a note naming Tavily instead`,
        );
      } else {
        const reason = maskedLine(result.failure, knownSecrets(req, config), SNIPPET_MAX);
        deps.log(
          `WARN anthropic did not answer a ${tool} request (${reason}); the router answered with a note naming Tavily instead`,
        );
      }
      const text = claudeSearchNotice(tool, claudeUnavailableWords(status, limit));
      const streamed = body.stream === true;
      return {
        fallbacks: 0,
        response: new Response(
          streamed ? searchStreamAnswer(body.model, text) : searchMessageAnswer(body.model, text),
          {
            headers: {
              "cache-control": "no-cache",
              "content-type": streamed ? "text/event-stream" : "application/json",
            },
            status: 200,
          },
        ),
        skipped: 0,
        target: `router (${why}; anthropic ${status ?? "did not answer"})`,
      };
    }

    /**
     * Auto mode's safety check when the person set no judge chain (D44): Claude judges
     * first, as it always did. While Claude is limited or down, the worker chain's targets
     * that passed the judge test judge in its place, in that chain's order, through the same
     * chain every slot uses: its failure kinds, its rests (a Claude that just failed rests,
     * and the checks after it go to the stand-in until the rest ends), its deadline on every
     * backend target. Claude's step is the check's own route (`resolveRequestRoute`), the
     * model the check named with the bytes as sent.
     *
     * Null when this does not apply, and the check takes `claudeRoute()` as before: a
     * `count_tokens`; a judge slot in the config (the person's chain wins, even one with no
     * usable target); the judge's fallback switch off (`gateway fallback judge off`: Claude
     * alone); no worker target that passed the test; or a check whose route is no Claude
     * model (a name with no Claude target behind it, which Anthropic refuses and Claude Code
     * retries on a real Claude model).
     */
    function claudeFirstJudge(): null | Promise<Outcome> {
      if (
        url.pathname !== MESSAGES_PATH ||
        Object.hasOwn(config.slots, JUDGE_SLOT) ||
        !fallbackOn(config, JUDGE_SLOT)
      ) {
        return null;
      }
      const standIns = workerJudgeTargets(config);
      if (standIns.length === 0) return null;
      const decided = resolveRequestRoute(body, config, true);
      if (decided.kind === "anthropic" && typeof body.model === "string") {
        const claude: Target = { kind: "anthropic", model: withoutContextSuffix(body.model) };
        return chain(req, url, config, body, [claude, ...standIns], JUDGE_SLOT, true, {
          model: body.model,
          sent: bytes,
        });
      }
      if (decided.kind === "slot") {
        return chain(
          req,
          url,
          config,
          body,
          [...decided.targets, ...standIns],
          JUDGE_SLOT,
          true,
          null,
        );
      }
      return null;
    }

    /** The request's way by its name: everything but a check the judge takes. */
    // Not `async`: it only hands back a promise, and an extra async step would reorder the
    // log lines a test reads.
    function claudeRoute(): Promise<Outcome> {
      // A Claude model goes to its family's slot while that slot has a chain: never the
      // safety check, never a name an alias changed (so `body` is the request as sent). A
      // slot with no chain is off: the request goes to Anthropic byte for byte.
      const found = guard || alias !== null ? null : familySlotFor(body.model);
      const familyRoute = found === null ? null : resolveRoute(found.slot, config);
      if (found !== null && familyRoute?.kind === "slot" && familyRoute.targets.length > 0) {
        model.slot = found.slot;
        return slotRequest(
          req,
          url,
          config,
          body,
          found.slot,
          familyRoute.targets,
          false,
          { model: found.model, sent },
          profile,
        );
      }
      const decided = resolveRequestRoute(body, config, guard);
      if (decided.kind === "anthropic") {
        const named = typeof body.model === "string" && body.model.startsWith("claude-");
        return direct(bytes, named ? String(body.model) : null);
      }
      // A check with no Claude target behind its name: Anthropic gets what Claude Code sent.
      if (decided.kind === "anthropic-as-sent") return direct(sent);
      if (decided.kind === "unknown-slot") {
        const slots = Object.keys(config.slots);
        const family = Object.hasOwn(FAMILY_SLOTS, decided.slot)
          ? FAMILY_SLOTS[decided.slot]
          : undefined;
        // A slot of a family with no chain is off: a Claude model's request would go to
        // Anthropic as sent. This one names the slot itself (Claude Code's settings from
        // before 0.5.0 map a family to it), and the router never picks a Claude model for it.
        const message =
          family === undefined
            ? `cc-smart-dev-kit-router: "${decided.slot}" is not a slot in ${deps.configPath} (slots: ${slots.length > 0 ? slots.join(", ") : `none — run ${COMMAND} gateway setup`})`
            : `cc-smart-dev-kit-router: ${decided.slot} is off (no chain in ${deps.configPath}), and this request names the slot, not a Claude model: Claude Code's settings still send ${family} work to it. Run: ${COMMAND} gateway on (it stops that), or give the slot a chain: ${COMMAND} gateway slot ${decided.slot.replace(/^cc-smart-dev-kit-/, "")} <targets>`;
        return Promise.resolve({
          fallbacks: 0,
          response: anthropicError(400, "invalid_request_error", message),
          skipped: 0,
          target: "none",
        });
      }
      if (decided.kind === "slot") {
        model.slot = decided.slot;
        return slotRequest(
          req,
          url,
          config,
          body,
          decided.slot,
          decided.targets,
          guard,
          null,
          profile,
        );
      }
      // An explicit `<backend>:<model>`: that backend alone.
      const target = decided.target;
      if (url.pathname === COUNT_TOKENS_PATH) {
        return Promise.resolve({
          fallbacks: 0,
          response: anthropicError(
            404,
            "not_found_error",
            `count_tokens is not available for ${model.name}; Claude Code estimates instead`,
          ),
          skipped: 0,
          target: formatTarget(target),
        });
      }
      return chain(req, url, config, body, [target], model.name, guard);
    }
  }

  /** Backend model lists, for the price a history row uses; asked in the background. */
  const backendListings = new Map<string, { at: number; models: ListedModel[] }>();
  const listingLoads = new Set<string>();
  const listingErrors = new Set<string>();

  /**
   * The price an affordable backend's own model list gives for one of its models (D51), or
   * null when it gives none. The list is asked once per backend and refreshed every few
   * hours, in the background through `RouterDeps.background`, never on an answer's path; a
   * failure is one WARN line and is not asked again until the next refresh.
   */
  function backendPrice(backend: string, model: string): ModelPrice | null {
    const cached = backendListings.get(backend);
    const stale = cached === undefined || deps.now() - cached.at >= PRICE_REFRESH_MS;
    if (stale && deps.listModels !== undefined && !listingLoads.has(backend)) {
      const entry = deps.getConfig().backends[backend];
      if (entry !== undefined) {
        listingLoads.add(backend);
        const load = deps.listModels;
        const task = load({ apiKey: entry.apiKey, baseUrl: entry.baseUrl })
          .then((models) => {
            backendListings.set(backend, { at: deps.now(), models });
          })
          .catch((error: unknown) => {
            const message = messageOf(error);
            if (!listingErrors.has(message)) {
              listingErrors.add(message);
              deps.log(`WARN cannot read ${backend}'s model list for history prices: ${message}`);
            }
            // The failure is remembered too: a backend that is down is not asked every row.
            backendListings.set(backend, { at: deps.now(), models: [] });
          })
          .finally(() => {
            listingLoads.delete(backend);
          });
        deps.background?.(task.then(() => {}));
      }
    }
    return cached === undefined ? null : priceFromModels(cached.models, model);
  }

  /**
   * What one history row's answer cost (D51): Claude's list price, estimated, for a Claude
   * target (the model that answered, or the model asked when Anthropic answered as sent); a
   * backend's own listed price for a backend target; null when neither has a price. Never a
   * guess.
   */
  function costOf(target: string, asked: string, tokens: CheckTokens | null): HistoryRow["cost"] {
    if (tokens === null) return null;
    if (target.startsWith("claude-")) return claudeCost(target, tokens);
    if (target === "anthropic" || target.startsWith("anthropic ")) return claudeCost(asked, tokens);
    const parsed = parseTarget(target);
    if ("target" in parsed && parsed.target.kind === "backend") {
      const price = backendPrice(parsed.target.backend, parsed.target.model);
      return price === null ? null : backendCost(price, tokens);
    }
    return null;
  }

  return async function handle(req: Request): Promise<Response> {
    const startMs = deps.now();
    // The strip happens once, here, before every branch (messages, `count_tokens`,
    // `HEAD /api/hello`, the health page, server tools, the judge): a project's base URL is
    // `…/p/<profile>`, and Claude Code keeps the whole path on every request (owner D29;
    // docs/claude-code-contract.md). Claude Code's own path is what the branches read and
    // what Anthropic gets; the log keeps the path as it came, so the profile shows there.
    const url = new URL(req.url);
    const profilePath = profileFromPath(url.pathname);
    const profile = profilePath.name;
    /** The path as it came, for the log: the request itself keeps the stripped one. */
    const requestedPath = url.pathname;
    // The path property, not a URL rebuilt from a string: a path that begins `//` stays a
    // path (never a host), and the search is the one that came.
    if (profile !== null) url.pathname = profilePath.path;
    const model: { guard: boolean; name: string; slot: null | string } = {
      guard: false,
      name: "-",
      slot: null,
    };
    const line = (outcome: Outcome) =>
      `${new Date(startMs).toISOString()} ${req.method} ${printable(requestedPath)} ${printable(model.name)} → ${outcome.target} ${outcome.response.status} ${deps.now() - startMs}ms ${
        outcome.breaker === undefined
          ? `fallbacks=${outcome.fallbacks}${outcome.skipped > 0 ? ` skipped=${outcome.skipped}` : ""}`
          : `${outcome.breaker.held ? "held" : "not-held"} probes=${outcome.breaker.probes}`
      }${outcome.effortPinned === true ? ` effort=${outcome.effort} pinned` : ""}`;

    const host = (req.headers.get("host") ?? "").toLowerCase();
    if (req.headers.has("origin") || !allowedHosts.has(host)) {
      const outcome = refusal("cc-smart-dev-kit-router accepts requests from this machine only");
      deps.log(line(outcome));
      return outcome.response;
    }

    if (req.method === "GET" && url.pathname === HEALTH_PATH) {
      const machine = deps.getConfig();
      return Response.json({
        breakers: breakersNow(),
        cooling: coolingNow(),
        fallbacks: stats.fallbacks,
        // What a reader can rely on (`ROUTER_FEATURES`), so an older running router is told
        // apart from this one without guessing from a version it does not carry.
        features: ROUTER_FEATURES,
        ok: true,
        port: deps.port,
        // The profile names a project's URL may carry (`…/p/<name>`); empty: none set.
        profiles: profileNames(machine),
        recent,
        requests: stats.requests,
        seenClaude: limitState.seenClaude ?? {},
        slots: machine.slots,
        uptimeSec: Math.floor((deps.now() - startedAt) / 1000),
      });
    }

    stats.requests += 1;
    let outcome: Outcome;
    try {
      outcome = await route(req, url, model, profile);
    } catch (error) {
      deps.log(`ERROR ${req.method} ${printable(requestedPath)}: ${messageOf(error)}`);
      outcome = {
        fallbacks: 0,
        response: anthropicError(
          500,
          "api_error",
          "cc-smart-dev-kit-router failed on this request; see its log",
        ),
        skipped: 0,
        target: "none",
      };
    }
    stats.fallbacks += outcome.fallbacks;
    deps.log(line(outcome));
    recent.push({
      ...(outcome.effortPinned === true
        ? { effort: outcome.effort, effortPinned: true as const }
        : {}),
      at: startMs,
      ms: deps.now() - startMs,
      nextTarget: outcome.fallbacks > 0,
      slot: model.slot,
      status: outcome.response.status,
      // As the log line names it, and as short: a target in the config, or a word of ours.
      target: printable(outcome.target),
    });
    if (recent.length > RECENT_MAX) recent.shift();
    // The request history (D51): one row per routed `/v1/messages` request, never a safety
    // check (those are counted by day in `safety-checks.json`), never `count_tokens` or
    // another path. The answer's `usage` is read from the bytes on their way to Claude Code,
    // which are neither changed nor waited for; the row is written when they are through.
    if (
      req.method === "POST" &&
      url.pathname === MESSAGES_PATH &&
      !model.guard &&
      deps.history?.enabled() === true
    ) {
      const answered = outcome;
      const row: Omit<HistoryRow, "cost" | "tokens"> = {
        at: startMs,
        breaker:
          answered.breaker === undefined ? null : answered.breaker.held ? "held" : "not-held",
        model: model.name,
        ms: deps.now() - startMs,
        nextTarget: answered.fallbacks > 0 ? printable(answered.target) : null,
        // The name the path carried, as it spelled it (an unknown one too): the row says
        // where the request came from, and its target says what answered.
        profile: profile === null ? null : printable(profile, 64),
        session: sessionIdOf(req.headers),
        slot: model.slot,
        status: answered.response.status,
        // As the log line names it: a target in the config, or a word of ours.
        target: printable(answered.target),
      };
      outcome = {
        ...answered,
        response: observedAnswer(answered.response, (tokens) => {
          deps.history?.record({
            ...row,
            cost: costOf(answered.target, model.name, tokens),
            tokens,
          });
        }),
      };
    }
    return outcome.response;
  };
}

/**
 * Serve the router on 127.0.0.1: `cc-smart-dev-kit gateway serve`, and the systemd unit.
 *
 * Under the unit, systemd's `cc-smart-dev-kit-router.socket` holds the port and passes it in
 * (socket activation, `./listen.ts`): the router accepts on that socket and relays each
 * connection to its own server on a private unix socket. Started any other way (a
 * terminal, a unit without the socket), it binds the config's port itself.
 *
 * `env` is the process's environment; the socket-activation variables are removed from
 * it once read, so a child process never takes the socket for its own.
 */
export async function startRouter(
  paths: RouterPaths,
  env: Record<string, string | undefined> = process.env,
): Promise<void> {
  const log = (line: string) => console.log(line);
  const configPath = paths.gatewayConfigFile;
  const statePath = paths.gatewayStateFile;
  // A missing or bad file at start does not stop the router: it runs `emptyConfig()`
  // (every slot off: each Claude model as sent) and picks the file up once it is fixed.
  const source = watchConfig(configPath, log);
  const configPort = source.get().port;
  // Mode 600 in an owner-only folder: they name models, times and counts, nothing secret,
  // but they are the person's own state.
  const writeState = (file: string, text: string) => {
    mkdirSync(dirname(file), { mode: 0o700, recursive: true });
    atomicWrite(file, text, 0o600);
  };
  // A state file's text, read when the router starts. A file that is not there yet is the
  // first run on this machine, not a failure (null); anything else (a mode, a folder that
  // is not one) throws, and the router says so once itself.
  const readState = (file: string): null | string => {
    try {
      return readFileSync(file, "utf8");
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") return null;
      throw error;
    }
  };
  // Aborted at SIGTERM: the requests the breaker holds are answered at once (retry-after 5),
  // so the drain below does not wait for their hold.
  const shutdown = new AbortController();
  // The request history (D51): rows are batched in the background by `history.ts`, and the
  // file is made only when a row is really written, so a log that is off leaves none.
  const history = createHistoryWriter({
    file: paths.historyDbFile,
    log,
    retentionDays: () => historyRetentionDays(source.get()),
  });
  const handlerFor = (port: number) =>
    createRouter({
      configPath,
      fetch: (url, init) => fetch(url, init),
      getConfig: () => source.get(),
      history,
      // A backend's own price for the history's cost, from its model list (D51), asked in
      // the background and only when its list gives one.
      listModels: (backend) =>
        listBackendModels(backend.baseUrl, backend.apiKey).then((listed) =>
          "models" in listed ? listed.models : [],
        ),
      // What the router counted and saw before it started, so a restart (an update, a crash)
      // goes on counting the same days, and keeps the plan limits and fallbacks it saw.
      loadSafetyChecks: () => readState(paths.safetyChecksFile),
      loadState: () => readState(statePath),
      log,
      now: () => Date.now(),
      port,
      saveSafetyChecks: (text) => writeState(paths.safetyChecksFile, text),
      saveState: (text) => writeState(statePath, text),
      shutdown: shutdown.signal,
    });

  const fd = inheritedListenFd(env, process.pid);
  for (const name of LISTEN_VARS) delete env[name];

  if (fd === null) {
    // `idleTimeout: 0` turns Bun's 10-second idle cut-off off: a model that thinks
    // for a minute sends nothing in between, and the stream must not be dropped.
    const server = Bun.serve({
      fetch: handlerFor(configPort),
      hostname: "127.0.0.1",
      idleTimeout: 0,
      port: configPort,
    });
    log(
      `cc-smart-dev-kit-router listening on http://127.0.0.1:${configPort} (config ${configPath})`,
    );
    // systemd stops (and restarts) with SIGTERM. `stop(false)` stops taking new
    // connections and lets every answer in flight finish; its promise resolves once
    // the last connection has closed. The unit's TimeoutStopSec bounds the wait.
    process.once("SIGTERM", () => {
      log(`SIGTERM: finishing ${server.pendingRequests} request(s), then exiting`);
      shutdown.abort();
      exitWhenDone(server.stop(false), log, () => history.close());
    });
    return;
  }

  // Socket activation. Connections that arrive before the inner server is up wait, paused.
  const inner = innerSocketPath(env, process.pid);
  let innerReady: (path: string) => void = () => {};
  const ready = new Promise<string>((resolve) => {
    innerReady = resolve;
  });
  const relay = await listenOnFd(fd, ready, log);
  // The Host check uses the port the socket really listens on. The config's port reaches
  // the socket only through `gateway setup`, which writes it into the socket unit.
  if (relay.port !== configPort) {
    log(
      `WARN the socket listens on port ${relay.port}, the config says ${configPort}: serving on ${relay.port}. Run: cc-smart-dev-kit gateway setup`,
    );
  }
  const server = serveUnix(inner.path, handlerFor(relay.port));
  innerReady(inner.path);
  log(
    `cc-smart-dev-kit-router listening on http://127.0.0.1:${relay.port} (the socket systemd holds; config ${configPath})`,
  );
  // On SIGTERM it stops accepting. systemd keeps the socket open, so a new connection
  // waits in its queue for the next router instead of being refused. A connection that
  // sent nothing is closed (`IDLE_GRACE_MS`); every answer in flight finishes. The inner
  // server stops only once every relayed request has reached it, and the router exits
  // once the last relayed connection has closed.
  process.once("SIGTERM", () => {
    log(
      `SIGTERM: finishing ${server.pendingRequests} request(s), then exiting; new connections wait in the socket for the next router`,
    );
    shutdown.abort();
    const drain = relay.drain();
    const stopped = drain.connected.then(() => server.stop(false));
    exitWhenDone(Promise.all([stopped, drain.closed]), log, () => {
      inner.cleanup();
      history.close();
    });
  });
}

/** Exits 0 once `done` resolves (1 when it fails), after `cleanup`. */
function exitWhenDone(
  done: Promise<unknown>,
  log: (line: string) => void,
  cleanup: () => void,
): void {
  done.then(
    () => {
      cleanup();
      process.exit(0);
    },
    (error: unknown) => {
      log(`ERROR while stopping: ${messageOf(error)}`);
      cleanup();
      process.exit(1);
    },
  );
}
