/**
 * anymodel-router: the local AI gateway between Claude Code and the model providers.
 *
 * WHY IT EXISTS
 *   Routine subagents (search, reading, routine code) can run on cheap models; reviews
 *   and judgment stay on Claude. Claude Code points `ANTHROPIC_BASE_URL` here with NO
 *   gateway token, so every request carries the person's OWN Claude login: the pattern
 *   Anthropic documents for gateways. That login must only ever reach Anthropic.
 *
 * WHAT IT DOES, PER REQUEST
 *   - An old model name in the config's `aliases` is replaced by its slot or target
 *     first (`resolveAlias`), logged once per name.
 *   - `POST /v1/messages` (and `/count_tokens`) with a `claude-…` model or a model it
 *     does not know, and EVERY other path → Anthropic: method, path, query, body bytes
 *     and headers unchanged (only hop-by-hop headers, `host` and `content-length` are
 *     dropped). The answer streams back unbuffered, compressed bytes and all
 *     (`decompress: false`).
 *   - A slot key (`anymodel-scout`, `anymodel-worker`) → the slot's targets in order
 *     (`targets.ts`). A cheap backend gets only an allow-list of headers plus its own
 *     key, and the body without `metadata` (it holds the account id). A `claude-…`
 *     target goes to Anthropic with `model` changed, and only the fields that target
 *     refuses translated (`requestForClaudeFallback`). It moves to the next target
 *     only before an answer reaches Claude Code: a network error, a status
 *     `fallbackKind` names, or (on a streaming request to a cheap backend that is not
 *     the last target) no response headers or no first real event within
 *     `firstByteMs`, or an error event before the first real one. A target that
 *     answered 429 / 5xx rests a while (`cooldownSeconds`); the last target of a slot is
 *     always tried. A client that hangs up rests nothing.
 *   - An explicit `<backend>:<model>` → that backend, no fallback.
 *   - Auto mode's safety check (`isAutoModeGuard`, on the request as it came, so an old
 *     name in `aliases` is seen too) → the `anymodel-judge` slot, only when the person
 *     turned it on (it is off by default). Without that slot it stays on Claude: a
 *     `claude-…` check untouched, a slot-named one to that slot's Claude targets only, and
 *     one whose name leads to no Claude target (a cheap-only slot, or an alias to
 *     `<backend>:<model>`) to Anthropic as it was sent (`resolveRequestRoute`).
 *   - No prompt text is ever changed. A cheap backend gets only the named format
 *     translations below; a `claude-…` request reaches Anthropic as the bytes it came as.
 *   - A cheap backend never sees Claude Code's tool search: `toolSearchForBackend`.
 *   - A cheap backend gets "no reasoning" in a form it reads: `reasoningOffForBackend`.
 *   - A redirect from a cheap backend becomes a 502: Claude Code must never follow a
 *     `Location` it chose. Anthropic's own redirects pass as they are.
 *   - Only this machine: it binds 127.0.0.1, refuses a foreign `Host` and any `Origin`
 *     (a web page in a browser), and on `/v1/messages` wants JSON and an
 *     `anthropic-version` header: a browser cannot send those without a CORS
 *     preflight, which this server never answers.
 *   - A slot's `claude-…` target gets a body it accepts: Claude Code built it for the slot
 *     name, and Claude Sonnet 5.5 refuses some of its fields (`thinking: disabled`). A
 *     named translation, `requestForClaudeFallback`, changes only those; never `system`
 *     or a message. Never for auto mode's safety check, on any route: it reaches Claude
 *     with only `model` changed.
 *   - One log line per request; never a header value, key or body. A WARN line when any
 *     target, Anthropic included, answers 4xx / 5xx carries the start of its error answer
 *     (its reason, never the request): 300 characters at most, keys masked.
 *   - On SIGTERM it stops taking requests and exits once the running ones finish.
 *
 * `createRouter` is the handler, with everything it touches passed in, so the tests
 * drive it with fake upstreams. `startRouter` serves it (`anymodel gateway serve`, and
 * the systemd unit through `src/entries/router.ts`). The design: docs/gateway.md.
 */

import { type GatewayConfig, messageOf, watchConfig } from "./config";
import {
  cooldownSeconds,
  fallbackKind,
  formatTarget,
  isAutoModeGuard,
  JUDGE_SLOT,
  resolveAlias,
  resolveRequestRoute,
  resolveRoute,
  type Target,
} from "./targets";

/** What the router hands to `fetch` for one upstream call. */
export interface UpstreamInit {
  body: null | Uint8Array<ArrayBuffer>;
  /** Bun: keep the body compressed and `content-encoding` as sent — the client decodes. */
  decompress: false;
  headers: Headers;
  method: string;
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
  /** Named in the error a request for an unknown slot gets. */
  configPath: string;
  fetch: FetchLike;
  getConfig: () => GatewayConfig;
  log: (line: string) => void;
  /** Milliseconds since the epoch. */
  now: () => number;
  /** The port the server is bound to; the `Host` guard checks it. */
  port: number;
}

/** Path of the router's own health check, answered before anything is forwarded. */
export const HEALTH_PATH = "/__anymodel/health";

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
 * The only client headers a cheap backend sees. Never `authorization`, `x-api-key`,
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

/** The allow-listed client headers and the backend's own key — nothing else. */
export function backendRequestHeaders(client: Headers, apiKey: string): Headers {
  const out = new Headers();
  for (const name of BACKEND_HEADER_ALLOW_LIST) {
    const value = client.get(name);
    if (value !== null) out.set(name, value);
  }
  if (!out.has("content-type")) out.set("content-type", "application/json");
  out.set("authorization", `Bearer ${apiKey}`);
  return out;
}

/**
 * `retry-after` as whole seconds. Claude Code reads an integer; a cheap backend may
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

/** Response headers for the client; a cheap backend's `retry-after` made whole seconds. */
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
 * for a cheap backend "before the first byte" means "before the first real event":
 * comments are skipped; `ping` carries no content and decides nothing either.
 */
export function sseScanner(): { push(text: string): "error" | "event" | null } {
  let buffer = "";
  let event: null | string = null;
  let data: string[] = [];
  let fields = false;
  const decide = (): "error" | "event" | null => {
    const name = event ?? "message";
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

/** Text safe for one log line: no control characters, bounded length. */
function printable(text: string, max = 120): string {
  return text
    .replace(/\s+/g, " ")
    .replace(/[^\x20-\x7e]/g, "?")
    .trim()
    .slice(0, max);
}

/** A secret as the log shows it: `****` and, for a long one, its last four characters. */
function maskedTail(secret: string): string {
  return secret.length >= 12 ? `****${secret.slice(-4)}` : "****";
}

/**
 * An upstream's error text with anything that looks like a key masked, before it goes to
 * the log. An upstream may echo a key back ("invalid x-api-key sk-…"). Masked: an
 * `sk-…` key, a `Bearer` / `Basic` credential, the value of a JSON field whose name says
 * key, token, secret, password or authorization, and any unbroken run of 32 or more
 * letters, digits, `_` or `-`. ASCII only, because the log line is (`printable`); so not
 * `maskKey` from settings.ts, whose `••••` the log would turn into `????` (and the router
 * bundle must not import settings.ts: it bakes in the plugin version).
 */
export function maskSecrets(text: string): string {
  return text
    .replace(
      /"([^"]*(?:key|token|secret|password|authorization)[^"]*)"(\s*):(\s*)"[^"]*"/gi,
      '"$1"$2:$3"****"',
    )
    .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi, "$1 ****")
    .replace(/\bsk-[A-Za-z0-9_-]+/g, (key) => `sk-${maskedTail(key)}`)
    .replace(/[A-Za-z0-9_-]{32,}/g, (token) => maskedTail(token));
}

/** How long an error snippet in the log may be. */
const SNIPPET_MAX = 300;

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
 * Claude Code's tool search, made plain for a cheap backend.
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
 * The cheap model sees the core tools and `ToolSearch`; a tool it finds is a real
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
 * "No reasoning", said so a cheap backend acts on it.
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

/**
 * What a slot's `claude-…` target refuses with a 400, by model. Only models whose rules
 * Anthropic's migration guides state are here; a target not in the table gets the body
 * as Claude Code built it (only `model` changes). Sources, read 2026-10-15:
 *   - platform.claude.com/docs/en/models/sonnet-5-5/migration-guide
 *   - platform.claude.com/docs/en/models/opus-5-5/migration-guide
 * Both models refuse `thinking: {type: "enabled", budget_tokens}`, a forced `tool_choice`
 * (`any` / `tool`, on `count_tokens` too) and a non-default `temperature` / `top_p` /
 * `top_k`. They differ on `thinking: {type: "disabled"}`: Sonnet 5.5 wants
 * `{type: "between_tools"}` instead (accepted at effort `high` or below, with no other
 * field in `thinking`); Opus 5.5 always thinks, so the field is left out.
 */
const CLAUDE_TARGET_RULES: Record<string, { thinkingOff: "between_tools" | "left out" }> = {
  "claude-opus-5-5": { thinkingOff: "left out" },
  "claude-sonnet-5-5": { thinkingOff: "between_tools" },
};

/** Efforts at which Sonnet 5.5 refuses `between_tools`. */
const ABOVE_HIGH = new Set(["max", "xhigh"]);

/**
 * A slot request's body, made acceptable to the slot's `claude-…` target.
 *
 * Claude Code builds a request for the model name it sends. Under a slot name
 * (`anymodel-worker`) it knows nothing of the model behind it, so the body can carry a
 * field the Claude target refuses: Claude Sonnet 5.5 answers 400 to
 * `thinking: {type: "disabled"}`, which Claude Code sends to turn reasoning off for short
 * background calls. Without this, a slot that falls back to Claude after its cheap targets
 * fail answers 400 instead. So, for a target in `CLAUDE_TARGET_RULES` only, each refused
 * field gets the nearest value the target accepts:
 *   - `thinking: {type: "disabled"}` → `{type: "between_tools"}` (Sonnet 5.5; at effort
 *     `xhigh` / `max` the effort becomes `high`, the highest it takes with thinking off),
 *     or no `thinking` field (Opus 5.5: thinking is always on);
 *   - `thinking: {type: "enabled", budget_tokens}` → `{type: "adaptive"}`, its `display`
 *     kept;
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
  const rules = Object.hasOwn(CLAUDE_TARGET_RULES, model) ? CLAUDE_TARGET_RULES[model] : undefined;
  if (rules === undefined) return { body, changes: [] };
  const out: Record<string, unknown> = { ...body };
  const changes: string[] = [];
  const thinking = body.thinking;
  if (isJsonObject(thinking) && thinking.type === "disabled") {
    if (rules.thinkingOff === "left out") {
      delete out.thinking;
      changes.push("thinking disabled -> left out (always on)");
    } else {
      out.thinking = { type: "between_tools" };
      changes.push("thinking disabled -> between_tools");
      const outputConfig = body.output_config;
      if (
        isJsonObject(outputConfig) &&
        typeof outputConfig.effort === "string" &&
        ABOVE_HIGH.has(outputConfig.effort)
      ) {
        out.output_config = { ...outputConfig, effort: "high" };
        changes.push(`effort ${outputConfig.effort} -> high`);
      }
    }
  } else if (isJsonObject(thinking) && thinking.type === "enabled") {
    out.thinking =
      thinking.display === undefined
        ? { type: "adaptive" }
        : { display: thinking.display, type: "adaptive" };
    changes.push("thinking enabled (budget) -> adaptive");
  }
  const toolChoice = body.tool_choice;
  if (isJsonObject(toolChoice) && (toolChoice.type === "any" || toolChoice.type === "tool")) {
    out.tool_choice =
      toolChoice.disable_parallel_tool_use === undefined
        ? { type: "auto" }
        : { disable_parallel_tool_use: toolChoice.disable_parallel_tool_use, type: "auto" };
    changes.push(`tool_choice ${toolChoice.type} -> auto`);
  }
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

/** How one request ended — the log line and the response. */
interface Outcome {
  fallbacks: number;
  response: Response;
  skipped: number;
  target: string;
}

type Attempt = { failure: string; status: null | number } | { response: Response };

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
   * At most `SNIPPET_MAX` characters, anything like a key masked (`maskSecrets`). Never
   * request content. Pass a `clone()` when the client still needs the body.
   */
  async function errorSnippet(response: UpstreamBody): Promise<string> {
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
    try {
      const step = await Promise.race([reader.read(), timer.done]);
      if (step === "timeout") return "(no body within 1 s)";
      if (step.done) return "(empty body)";
      return printable(maskSecrets(new TextDecoder().decode(step.value)), SNIPPET_MAX);
    } catch (error) {
      return `(${format === null ? "" : `${printable(encoding ?? "", 40)} `}body unreadable: ${messageOf(error)})`;
    } finally {
      timer.clear();
      // Not awaited: on a `clone()` the cancel settles only once the client's copy is
      // read too, which happens after this returns. The rest of this copy is dropped
      // at once either way.
      reader.cancel().catch((error: unknown) => {
        deps.log(`WARN could not cancel an upstream error body: ${messageOf(error)}`);
      });
    }
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
    const pending = deps.fetch(upstream.url, {
      body: upstream.body,
      decompress: false,
      headers: upstream.headers,
      method: upstream.method,
      redirect: "manual",
      signal: controller.signal,
    });
    try {
      const first = await (timer === null ? pending : Promise.race([pending, timer.done]));
      if (first !== "timeout") return { response: first };
      controller.abort(new Error("no response headers in time"));
      // A fetch that ignores the abort may still answer later: free that answer too.
      // Its rejection is the abort just sent — the expected end, nothing to report.
      void pending.then(discard, () => undefined);
      return { failure: "no response headers in time", status: null };
    } catch (error) {
      return { failure: messageOf(error), status: null };
    } finally {
      timer?.clear();
    }
  }

  /**
   * Hold a cheap backend's stream until its first real event (`sseScanner`). An
   * error event, the end of the stream, or `deadlineAt` first → a failure, and the
   * next target is tried; nothing has reached the client yet. Otherwise the client
   * gets a stream that replays every byte read so far, then pipes the rest as it
   * arrives — chunk by chunk, nothing buffered beyond the one being handed over.
   *
   * Nothing is sent to the client while holding (no `ping`): any byte would commit
   * this target, and the wait is bounded by `firstByteMs` anyway. The connection
   * stays open meanwhile — the server's idle timeout is off.
   */
  async function holdFirstEvent(response: Response, deadlineAt: null | number): Promise<Attempt> {
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
      if (step === "timeout") return fail("no event in time (only heartbeats)", null);
      if (step.done)
        return { failure: "the stream ended before its first event", status: response.status };
      held.push(step.value);
      const verdict = scanner.push(decoder.decode(step.value, { stream: true }));
      if (verdict === "error")
        return fail("an error event before the first real one", response.status);
      if (verdict === "event") break;
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

  function anthropicUpstream(
    req: Request,
    url: URL,
    config: GatewayConfig,
    body: null | Uint8Array<ArrayBuffer>,
  ): Upstream {
    return {
      body,
      headers: anthropicRequestHeaders(req.headers),
      method: req.method,
      url: `${deps.anthropicBaseUrl ?? config.anthropicBaseUrl}${url.pathname}${url.search}`,
    };
  }

  /** The upstream call for one target, or why there is none. `guard`: the safety check. */
  function targetUpstream(
    req: Request,
    url: URL,
    config: GatewayConfig,
    body: Record<string, unknown>,
    target: Target,
    guard: boolean,
  ): { error: string } | { upstream: Upstream } {
    if (target.kind === "anthropic") {
      // `model`, and only the fields this target refuses (`requestForClaudeFallback`); the
      // spread keeps every other field, and its order. Never for auto mode's safety
      // check: it stays exactly as Claude Code ships it, only `model` changes.
      const fitted = guard ? { body, changes: [] } : requestForClaudeFallback(body, target.model);
      const text = `${target.model}: ${fitted.changes.join(", ")}`;
      if (fitted.changes.length > 0 && !translationsLogged.has(text)) {
        translationsLogged.add(text);
        deps.log(
          `translated for ${printable(text, 200)} (requestForClaudeFallback; logged once per kind)`,
        );
      }
      const bytes = encoder.encode(JSON.stringify({ ...fitted.body, model: target.model }));
      return { upstream: anthropicUpstream(req, url, config, bytes) };
    }
    const backend = Object.hasOwn(config.backends, target.backend)
      ? config.backends[target.backend]
      : undefined;
    if (backend === undefined) return { error: `backend "${target.backend}" is not in the config` };
    // `metadata` carries the Claude account id; a cheap backend never sees it.
    const cheapBody: Record<string, unknown> = {
      ...reasoningOffForBackend(toolSearchForBackend(body), { absentIsOff: guard }),
      model: target.model,
    };
    delete cheapBody.metadata;
    return {
      upstream: {
        body: encoder.encode(JSON.stringify(cheapBody)),
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
   * answer at all, a 502 in Anthropic's error shape.
   */
  async function chain(
    req: Request,
    url: URL,
    config: GatewayConfig,
    body: Record<string, unknown>,
    targets: Target[],
    name: string,
    guard: boolean,
  ): Promise<Outcome> {
    const failures: string[] = [];
    let fallbacks = 0;
    let skipped = 0;
    for (const [index, target] of targets.entries()) {
      const last = index === targets.length - 1;
      const label = formatTarget(target);
      const restsUntil = cooling.get(label);
      if (!last && restsUntil !== undefined && restsUntil > deps.now()) {
        failures.push(`${label}: resting after a failure`);
        skipped += 1;
        continue;
      }
      // The header deadline guards only where it can help: a streaming request to a
      // cheap backend with another target behind it. Anthropic, the last target and
      // a non-streaming answer (which may take minutes) wait as long as it takes;
      // the client hanging up still cancels them.
      // An auto-mode check gets the same deadline though it does not stream: a judge that
      // hangs would hold every action, and the judge after it would never be asked.
      const deadlineAt =
        !last && target.kind === "backend" && (body.stream === true || guard)
          ? deps.now() + config.timeouts.firstByteMs
          : null;
      const built = targetUpstream(req, url, config, body, target, guard);
      let result: Attempt =
        "error" in built
          ? { failure: built.error, status: null }
          : await send(req, built.upstream, deadlineAt);
      if (req.signal.aborted) return closed(result, label);
      if (
        "response" in result &&
        !last &&
        target.kind === "backend" &&
        result.response.ok &&
        (result.response.headers.get("content-type") ?? "").includes("text/event-stream")
      ) {
        result = await holdFirstEvent(result.response, deadlineAt);
        // A hang-up during the hold breaks the read: the client's doing, not the
        // target's — it must not rest the target for every other session.
        if (req.signal.aborted) return closed(result, label);
      }
      noteCooldown(label, result);
      if ("failure" in result) {
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
          const snippet = await errorSnippet(result.response);
          deps.log(`WARN ${label} answered a redirect (${status}); refused — ${snippet}`);
          return {
            fallbacks,
            response: anthropicError(
              502,
              "api_error",
              `anymodel-router: ${label} answered a redirect (${status}); not passed on`,
            ),
            skipped,
            target: label,
          };
        }
        if (status >= 400) {
          // Any target, Anthropic too: its reason is the only trace of why the slot
          // failed. Read from a copy: Claude Code still gets the whole answer.
          const snippet = await errorSnippet(result.response.clone());
          deps.log(`WARN ${label} answered ${status}; returned as it is — ${snippet}`);
        }
        return { fallbacks, response: relay(result.response, target), skipped, target: label };
      }
      // Reading the snippet also cancels the rest of this discarded answer.
      const snippet = await errorSnippet(result.response);
      deps.log(`WARN ${label} answered ${status}; trying the next target — ${snippet}`);
      failures.push(`${label}: HTTP ${status}`);
      fallbacks += 1;
    }
    const lastTarget = targets.at(-1);
    return {
      fallbacks,
      response: anthropicError(
        502,
        "api_error",
        `anymodel-router: no target for ${name} answered (${failures.join("; ") || "no targets"})`,
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

  async function route(req: Request, url: URL, model: { name: string }): Promise<Outcome> {
    const config = deps.getConfig();
    const isMessages =
      req.method === "POST" &&
      (url.pathname === MESSAGES_PATH || url.pathname === COUNT_TOKENS_PATH);
    if (isMessages) {
      const type = (req.headers.get("content-type") ?? "").split(";")[0]?.trim().toLowerCase();
      if (type !== "application/json" || !req.headers.has("anthropic-version")) {
        return refusal(
          "anymodel-router wants content-type: application/json and an anthropic-version header",
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

    const direct = async (body = bytes): Promise<Outcome> => {
      const result = await send(req, anthropicUpstream(req, url, config, body), null);
      if ("response" in result && result.response.status >= 400) {
        const snippet = await errorSnippet(result.response.clone());
        deps.log(`WARN anthropic answered ${result.response.status} — ${snippet}`);
      }
      const response =
        "response" in result
          ? relay(result.response, null)
          : anthropicError(
              502,
              "api_error",
              `anymodel-router: Anthropic did not answer (${result.failure})`,
            );
      return { fallbacks: 0, response, skipped: 0, target: "anthropic" };
    };

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
    // alias may point at a cheap backend, and with the judge off the check stays on Claude.
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
      // Only `model` changes; the spread keeps every other field, and its order.
      body = { ...parsed, model: alias.to };
      bytes = encoder.encode(JSON.stringify(body));
    }
    // Its newer form carries the sonnet slot's name; the log must still tell it apart.
    if (guard) model.name = `${model.name} (safety check)`;
    const judge = guard ? resolveRoute(JUDGE_SLOT, config) : null;
    if (judge !== null && judge.kind === "slot" && judge.targets.length > 0) {
      model.name = `${model.name} [judge]`;
      if (url.pathname === COUNT_TOKENS_PATH) {
        // A check judged off Claude never reaches Claude, not even to count its tokens.
        return {
          fallbacks: 0,
          response: anthropicError(
            404,
            "not_found_error",
            "count_tokens is not available for the judge slot; Claude Code estimates instead",
          ),
          skipped: 0,
          target: "none",
        };
      }
      return chain(req, url, config, body, judge.targets, JUDGE_SLOT, true);
    }
    const decided = resolveRequestRoute(body, config, guard);
    if (decided.kind === "anthropic") return direct();
    // A check with no Claude target behind its name: Anthropic gets what Claude Code sent.
    if (decided.kind === "anthropic-as-sent") return direct(sent);
    if (decided.kind === "unknown-slot") {
      const slots = Object.keys(config.slots);
      return {
        fallbacks: 0,
        response: anthropicError(
          400,
          "invalid_request_error",
          `anymodel-router: "${decided.slot}" is not a slot in ${deps.configPath} (slots: ${slots.length > 0 ? slots.join(", ") : "none — run anymodel gateway setup"})`,
        ),
        skipped: 0,
        target: "none",
      };
    }

    const targets = decided.kind === "slot" ? decided.targets : [decided.target];
    const name = decided.kind === "slot" ? decided.slot : model.name;
    if (url.pathname === COUNT_TOKENS_PATH) {
      // Token counting has no fallback: the first target answers, or no one does.
      const first = targets[0];
      if (first === undefined || first.kind === "backend") {
        return {
          fallbacks: 0,
          response: anthropicError(
            404,
            "not_found_error",
            `count_tokens is not available for ${name}; Claude Code estimates instead`,
          ),
          skipped: 0,
          target: first === undefined ? "none" : formatTarget(first),
        };
      }
      // `first` is a Claude target here, so `guard` only keeps a check untranslated.
      return chain(req, url, config, body, [first], name, guard);
    }
    return chain(req, url, config, body, targets, name, guard);
  }

  return async function handle(req: Request): Promise<Response> {
    const startMs = deps.now();
    const url = new URL(req.url);
    const model = { name: "-" };
    const line = (outcome: Outcome) =>
      `${new Date(startMs).toISOString()} ${req.method} ${printable(url.pathname)} ${printable(model.name)} → ${outcome.target} ${outcome.response.status} ${deps.now() - startMs}ms fallbacks=${outcome.fallbacks}${outcome.skipped > 0 ? ` skipped=${outcome.skipped}` : ""}`;

    const host = (req.headers.get("host") ?? "").toLowerCase();
    if (req.headers.has("origin") || !allowedHosts.has(host)) {
      const outcome = refusal("anymodel-router accepts requests from this machine only");
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
          "anymodel-router failed on this request; see its log",
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

/** Serve the router on 127.0.0.1: `anymodel gateway serve`, and the systemd unit. */
export function startRouter(configPath: string) {
  const log = (line: string) => console.log(line);
  // A missing or bad file at start does not stop the router: it runs `emptyConfig()`
  // (both slots on Claude Sonnet 5.5) and picks the file up once it is fixed.
  const source = watchConfig(configPath, log);
  const { port } = source.get();
  const handler = createRouter({
    configPath,
    fetch: (url, init) => fetch(url, init),
    getConfig: () => source.get(),
    log,
    now: () => Date.now(),
    port,
  });
  // `idleTimeout: 0` turns Bun's 10-second idle cut-off off: a model that thinks
  // for a minute sends nothing in between, and the stream must not be dropped.
  const server = Bun.serve({ fetch: handler, hostname: "127.0.0.1", idleTimeout: 0, port });
  log(`anymodel-router listening on http://127.0.0.1:${port} (config ${configPath})`);
  // systemd stops (and restarts) with SIGTERM. `stop(false)` stops taking new
  // connections and lets every answer in flight finish; its promise resolves once
  // the last connection has closed. The unit's TimeoutStopSec bounds the wait.
  process.once("SIGTERM", () => {
    log(`SIGTERM: finishing ${server.pendingRequests} request(s), then exiting`);
    server.stop(false).then(
      () => process.exit(0),
      (error: unknown) => {
        log(`ERROR while stopping: ${messageOf(error)}`);
        process.exit(1);
      },
    );
  });
  return server;
}
