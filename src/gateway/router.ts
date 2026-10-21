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
 *     own, Claude included.
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
import {
  fallbackOn,
  type GatewayConfig,
  judgeTargetTested,
  messageOf,
  watchConfig,
} from "./config";
import {
  cleanFallbackResponse,
  holdsRouterMark,
  thinkingForBackend,
  withoutRouterThinking,
} from "./fallback-answer";
import { type BackendFetchOptions, backendFetch } from "./hosts";
import {
  currentLimits,
  emptyLimitState,
  formatLimitState,
  type LimitState,
  parseLimitState,
} from "./limit-state";
import { inheritedListenFd, innerSocketPath, LISTEN_VARS, listenOnFd, serveUnix } from "./listen";
import type { RouterPaths } from "./paths";
import { maskedLine, oneLine } from "./plain-text";
import {
  addCheckTokens,
  type CheckSide,
  type CheckTokens,
  checkUsageFromAnswer,
  emptySafetyChecks,
  formatSafetyCheckState,
  localDay,
  parseSafetyCheckState,
  recordSafetyCheck,
  type SafetyCheckState,
} from "./safety-checks";
import {
  type ClaudeFamily,
  type ClaudeVersion,
  claudeFamily,
  claudeVersion,
  cooldownSeconds,
  FAMILY_SLOTS,
  fallbackKind,
  familySlotFor,
  formatTarget,
  isAutoModeGuard,
  JUDGE_SLOT,
  type PlanLimit,
  planUsageLimit,
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
   * The safety-check counts already on disk (`safety-checks.ts`), read once when the router
   * starts so a restart goes on counting the same days. Absent, or null: none yet.
   */
  loadSafetyChecks?: () => null | string;
  /**
   * The limit state file's text (`limit-state.ts`), read once when the router starts, so a
   * restart (an update, a crash) keeps the plan limits and the fallbacks it saw, and its
   * next write keeps them too. Absent, or null: none yet.
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
 * (401 or 403): a 400 in Anthropic's error shape that names the backend and the check to run,
 * with `x-should-retry: false`. Never the 401 itself, which Claude Code reads as the person's
 * own login failing. The exact status Claude Code 2.1.300 shows and does not retry:
 * docs/claude-code-contract.md.
 */
export function backendKeyRefused(label: string, backend: string, status: number): Response {
  return Response.json(
    {
      error: {
        message: `cc-smart-dev-kit-router: ${label} refused the key the gateway config holds for ${backend} (HTTP ${status}${status === 403 ? ": the key, or what it may reach, such as a provider connection it is not allowed to use" : ""}). Your Claude login is not the problem. Check it: ${COMMAND} gateway check`,
        type: "invalid_request_error",
      },
      type: "error",
    },
    { headers: { "x-should-retry": "false" }, status: 400 },
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

/** Response headers for the client; an affordable backend's `retry-after` made whole seconds. */
function responseHeaders(upstream: Headers, normalizeRetryAfterAt: null | number): Headers {
  const dropped = droppedHeaders(upstream);
  const out = new Headers();
  upstream.forEach((value, name) => {
    if (dropped.has(name) || name.startsWith("proxy-")) return;
    if (name === "retry-after" && normalizeRetryAfterAt !== null) {
      const seconds = retryAfterSeconds(value, normalizeRetryAfterAt);
      if (seconds !== null) out.set(name, String(seconds));
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
  fallbacks: number;
  response: Response;
  skipped: number;
  target: string;
}

type Attempt = { failure: string; status: null | number } | { response: Response };

/**
 * How much of a safety check's answer is kept to read its `usage`. The answer to a check
 * that judges one action is a few hundred bytes; past this the check is still counted and
 * its tokens are not, so a surprising answer cannot grow the router's memory.
 */
const CHECK_USAGE_MAX_BYTES = 256 * 1024;

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
  /** What `cleanAnswer` changed, per slot and target: logged once each. */
  const cleanedLogged = new Set<string>();
  /** Claude models whose request lost the router's marked thinking blocks (`forClaude`): once each. */
  const markedLogged = new Set<string>();
  /** Backend targets whose request got the router's thinking blocks' own signatures back. */
  const restoredLogged = new Set<string>();
  /** The config the fallback records were last checked against (`dropRemovedFallbacks`). */
  let checkedConfig: GatewayConfig | null = null;

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
    for (const [slot, record] of Object.entries(limitState.fallbacks)) {
      if (record.model !== id) continue;
      delete limitState.fallbacks[slot];
      deps.log(`${slot}: ${id} answers again; its fallback is over`);
    }
    persist();
    return null;
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
  ): void {
    const now = deps.now();
    const before = limitState.fallbacks[slot];
    const resetsAt = limit?.resetsAt ?? before?.resetsAt ?? null;
    const reset =
      resetsAt === null
        ? "no reset time given"
        : `resets ${new Date(resetsAt * 1000).toISOString()}`;
    const claim = printable(limit?.claim ?? "plan limit", 40);
    if (!outcome.response.ok) {
      if (before === undefined) {
        deps.log(
          `WARN ${slot}: ${model} is at its plan usage limit (${claim}, ${reset}); its fallback ${outcome.target} answered ${outcome.response.status}`,
        );
      }
      return;
    }
    fellBack.add(model);
    if (before === undefined) {
      deps.log(
        `WARN ${slot}: ${model} is at its plan usage limit (${claim}, ${reset}); answering from ${outcome.target} until ${model} answers again`,
      );
    }
    limitState.fallbacks[slot] = {
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
   * A slot taken out of the config (`gateway slot opus off`, a hand edit), or whose fallback
   * switch went off, loses its fallback record, so the status line stops showing it.
   * Checked once per config the router loads, before its first request.
   */
  function dropRemovedFallbacks(config: GatewayConfig): void {
    if (config === checkedConfig) return;
    checkedConfig = config;
    let changed = false;
    for (const slot of Object.keys(limitState.fallbacks)) {
      if (Object.hasOwn(config.slots, slot) && fallbackOn(config, slot)) continue;
      delete limitState.fallbacks[slot];
      deps.log(`${slot}: removed from the config; its fallback record is dropped`);
      changed = true;
    }
    if (changed) persist();
  }

  /**
   * The judge's targets the router may use: its chain, its first target alone while its
   * fallback switch is off (`targetsInUse`), and of those only the ones `gateway slot judge`
   * tested (`judgeTargetTested`). An untested one (a hand edit, a config from before 0.5.0)
   * is ignored, with one WARN per target. None left: Claude judges.
   */
  function judgeTargetsOf(config: GatewayConfig): Target[] {
    const judge = resolveRoute(JUDGE_SLOT, config);
    if (judge.kind !== "slot") return [];
    return targetsInUse(judge.targets, fallbackOn(config, JUDGE_SLOT)).filter((target) => {
      const text = formatTarget(target);
      if (judgeTargetTested(config, text)) return true;
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
    const fail = async (failure: string, status: null | number): Promise<Attempt> => {
      try {
        await reader.cancel();
      } catch (error) {
        deps.log(`WARN could not cancel a held upstream stream: ${messageOf(error)}`);
      }
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
      ...reasoningOffForBackend(toolSearchForBackend(ownThinkingFor(body, target)), {
        absentIsOff: guard,
      }),
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
    if (seconds !== null) cooling.set(label, deps.now() + seconds * 1000);
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
  ): Promise<Outcome> {
    const standsInFor = asked?.model ?? null;
    const failures: string[] = [];
    let fallbacks = 0;
    let skipped = 0;
    /** The last target gave no headers by its deadline (only a safety check's judge has one). */
    let lastTimedOut = false;
    for (const [index, target] of targets.entries()) {
      const last = index === targets.length - 1;
      const label = formatTarget(target);
      const restsUntil = cooling.get(label);
      if (!last && restsUntil !== undefined && restsUntil > deps.now()) {
        failures.push(`${label}: resting after a failure`);
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
      const deadlineAt =
        target.kind === "backend" && (guard || (!last && body.stream === true))
          ? deps.now() + config.timeouts.firstByteMs
          : null;
      const built = targetUpstream(req, url, config, body, target, guard, asked);
      let result: Attempt =
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
        (!last || guard) &&
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
      // Only a model's answer says whether a target can answer: a `count_tokens` answer
      // neither starts nor ends a rest (its 200 during a plan limit says nothing of it).
      if (url.pathname === MESSAGES_PATH) noteCooldown(label, result);
      if ("failure" in result) {
        lastTimedOut =
          last && (result.failure === NO_HEADERS_IN_TIME || result.failure === NO_EVENT_IN_TIME);
        failures.push(`${label}: ${result.failure}`);
        if (!last) {
          fallbacks += 1;
          deps.log(`WARN ${label} failed (${result.failure}); trying the next target`);
        }
        continue;
      }
      const status = result.response.status;
      const decision = fallbackKind(status, target);
      if (decision === "stay" || last) {
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
          // be retried up to 10 times, each one refused again. A 400 is neither: Claude Code
          // shows its message and does not retry it (code.claude.com/docs/en/errors,
          // § Automatic retries), and `x-should-retry: false` says so to its API client too.
          logErrorAnswer(
            result.response,
            knownSecrets(req, config),
            `WARN ${label} answered ${status}; returned as a 400 (the backend refused its key)`,
          );
          return {
            fallbacks,
            response: backendKeyRefused(label, target.backend, status),
            skipped,
            target: label,
          };
        }
        if (status >= 400) {
          // Any target, Anthropic too: its reason is the only trace of why the slot
          // failed. Read from a copy: Claude Code still gets the whole answer, at once.
          logErrorAnswer(
            result.response.clone(),
            knownSecrets(req, config),
            `WARN ${label} answered ${status}; returned as it is`,
            target.kind === "anthropic"
              ? signatureWarn(target.model, status)
              : standsInFor === null || (status !== 400 && status !== 413)
                ? undefined
                : (snippet) => {
                    const kind = TOO_LONG.test(snippet)
                      ? "too long"
                      : UNSUPPORTED.test(snippet)
                        ? "a kind of content it does not take"
                        : null;
                    if (kind === null) return;
                    deps.log(
                      `WARN ${name}: ${label} refused this ${standsInFor} conversation (${kind}). A long ([1m], 200k+ tokens) or rich (images, documents, server tools) ${standsInFor} conversation may be more than ${label} takes: /compact it, start a new one, or put a target that takes it first in ${name}`,
                    );
                  },
          );
        }
        return { fallbacks, response: relay(result.response, target), skipped, target: label };
      }
      // Reading the snippet also cancels the rest of this discarded answer; the next
      // target is asked meanwhile.
      logErrorAnswer(
        result.response,
        knownSecrets(req, config),
        `WARN ${label} answered ${status}; trying the next target`,
      );
      failures.push(`${label}: HTTP ${status}`);
      fallbacks += 1;
    }
    const lastTarget = targets.at(-1);
    const answered = failures.join("; ") || "no targets";
    return {
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
  ): Promise<Outcome> {
    const targets = guard ? chained : targetsInUse(chained, fallbackOn(config, slot));
    const first = targets[0];
    if (url.pathname === COUNT_TOKENS_PATH) {
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
    const outcome = await chain(req, url, config, body, targets, slot, guard, asked);
    if (req.signal.aborted || first === undefined) return outcome;
    if (first.kind === "anthropic" && outcome.target !== formatTarget(first)) {
      const limited = withoutContextSuffix(first.model);
      const limit = currentLimits(limitState, deps.now()).find(([model]) => model === limited);
      if (limit !== undefined) noteFallback(slot, limited, limit[1], outcome);
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
   * An answer as Claude Code gets it: byte for byte, and counted on the way. Every chunk is
   * handed to the client first and a copy is kept for the reader, so the client's own
   * backpressure still holds the upstream, nothing is held back, and `note` runs only once
   * the client has the last byte — in the background, never on the answer's path. A client
   * that hangs up cancels the upstream exactly as it did before.
   *
   * An answer the reader cannot make sense of (an encoding the router does not decode, a
   * body that is not JSON or a stream, more than `CHECK_USAGE_MAX_BYTES`) reports null: the
   * check is counted, its tokens are not. That is what an answer with no `usage` says too,
   * and guessing one would be worse than not knowing.
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
    const reader = body.getReader();
    let chunks: Uint8Array[] = [];
    let kept = 0;
    let keep = true;
    let ended = false;
    /** The bytes the client got, as text: decompressed when the answer came compressed,
     * because the client decodes it and this reader must read what the client reads. Null
     * when the encoding is one the router cannot decode. */
    const answerText = async (): Promise<null | string> => {
      if (!keep) return null;
      const encoding = (response.headers.get("content-encoding") ?? "").trim().toLowerCase();
      const format =
        encoding === "" || encoding === "identity" ? null : decompressionFormat(encoding);
      if (format === null && encoding !== "" && encoding !== "identity") return null;
      const bytes = new Uint8Array(kept);
      let at = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, at);
        at += chunk.byteLength;
      }
      if (format === null) return new TextDecoder().decode(bytes);
      const decoded = new Response(bytes).body;
      if (decoded === null) return null;
      return await new Response(decoded.pipeThrough(new DecompressionStream(format))).text();
    };
    const finish = (): void => {
      if (ended) return;
      ended = true;
      const task = answerText().then(
        (answer) => note(answer === null ? null : checkUsageFromAnswer(answer, streaming)),
        // A decode that fails reads as an answer with no usage: the client got its bytes
        // either way, and the check is counted.
        () => note(null),
      );
      deps.background?.(task);
    };
    const counted = new ReadableStream<Uint8Array>({
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
        if (!keep) return;
        kept += step.value.byteLength;
        if (kept > CHECK_USAGE_MAX_BYTES) {
          // A surprising answer: the check is counted, its tokens are not.
          keep = false;
          chunks = [];
          return;
        }
        chunks.push(step.value);
      },
    });
    return new Response(counted, {
      headers: response.headers,
      status: response.status,
      statusText: response.statusText,
    });
  }

  async function route(req: Request, url: URL, model: { name: string }): Promise<Outcome> {
    const config = deps.getConfig();
    dropRemovedFallbacks(config);
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
    if (typeof parsed.model === "string") model.name = parsed.model;
    // The safety check is recognised on the request as it came, an old name included: an
    // alias may point at an affordable backend, and with the judge off the check stays on Claude.
    const guard = isAutoModeGuard(parsed, config.aliases);
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
    // A check goes to the judge slot when it has a tested chain, like any slot's request;
    // with none, to Claude. Only targets `gateway slot judge` tested; an untested one is
    // ignored, with one WARN.
    const judgeTargets = guard ? judgeTargetsOf(config) : [];
    const answered =
      judgeTargets.length > 0
        ? slotRequest(req, url, config, body, JUDGE_SLOT, judgeTargets, true, null)
        : claudeRoute();
    // Auto mode's safety check, counted (`countedCheck`). A check is a `/v1/messages`
    // request: a `count_tokens` for one counts tokens, it judges nothing.
    return guard && url.pathname === MESSAGES_PATH ? countedCheck(answered) : answered;

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
        return slotRequest(req, url, config, body, found.slot, familyRoute.targets, false, {
          model: found.model,
          sent,
        });
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
        return slotRequest(req, url, config, body, decided.slot, decided.targets, guard, null);
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

  return async function handle(req: Request): Promise<Response> {
    const startMs = deps.now();
    const url = new URL(req.url);
    const model = { name: "-" };
    const line = (outcome: Outcome) =>
      `${new Date(startMs).toISOString()} ${req.method} ${printable(url.pathname)} ${printable(model.name)} → ${outcome.target} ${outcome.response.status} ${deps.now() - startMs}ms fallbacks=${outcome.fallbacks}${outcome.skipped > 0 ? ` skipped=${outcome.skipped}` : ""}`;

    const host = (req.headers.get("host") ?? "").toLowerCase();
    if (req.headers.has("origin") || !allowedHosts.has(host)) {
      const outcome = refusal("cc-smart-dev-kit-router accepts requests from this machine only");
      deps.log(line(outcome));
      return outcome.response;
    }

    if (req.method === "GET" && url.pathname === HEALTH_PATH) {
      return Response.json({
        cooling: coolingNow(),
        fallbacks: stats.fallbacks,
        ok: true,
        port: deps.port,
        requests: stats.requests,
        slots: deps.getConfig().slots,
        uptimeSec: Math.floor((deps.now() - startedAt) / 1000),
      });
    }

    stats.requests += 1;
    let outcome: Outcome;
    try {
      outcome = await route(req, url, model);
    } catch (error) {
      deps.log(`ERROR ${req.method} ${printable(url.pathname)}: ${messageOf(error)}`);
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
  const handlerFor = (port: number) =>
    createRouter({
      configPath,
      fetch: (url, init) => fetch(url, init),
      getConfig: () => source.get(),
      // What the router counted and saw before it started, so a restart (an update, a crash)
      // goes on counting the same days, and keeps the plan limits and fallbacks it saw.
      loadSafetyChecks: () => readState(paths.safetyChecksFile),
      loadState: () => readState(statePath),
      log,
      now: () => Date.now(),
      port,
      saveSafetyChecks: (text) => writeState(paths.safetyChecksFile, text),
      saveState: (text) => writeState(statePath, text),
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
      exitWhenDone(server.stop(false), log, () => {});
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
    const drain = relay.drain();
    const stopped = drain.connected.then(() => server.stop(false));
    exitWhenDone(Promise.all([stopped, drain.closed]), log, inner.cleanup);
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
