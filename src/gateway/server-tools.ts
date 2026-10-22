/**
 * Anthropic's server tools, and the answer the router gives when they cannot run
 * (owner decisions D41 and D44).
 *
 * A server tool runs on Anthropic's own servers. Claude Code sends a request of its own
 * for one: about 900 bytes, one user message, and one tool,
 * `{"name":"web_search","type":"web_search_20250305"}`, under the session's model name
 * (proved on Claude Code 2.1.306: docs/claude-code-contract.md, the P-WS rows). No
 * affordable backend can run such a tool, so the request goes to Anthropic as Claude Code
 * sent it, whatever its slot, on the person's own login (D41). This module is the one home
 * of the tool types and of the answer below.
 *
 * When Claude cannot answer it (the plan's usage limit, an overload, no answer at all), the
 * search would simply fail. The router answers instead, in Anthropic's message format with
 * one plain text block, naming the Tavily MCP server's search tool and saying the text comes
 * from the router. A plain answer to the search request becomes the tool result
 * `Web search results for query: <q>` and that text, at once and with no retry (proved; the
 * contract's P-WS rows). This is the one place the router writes words of its own to a
 * model: it is a whole answer in Claude's place, never an edit of Claude Code's text.
 *
 * Pure, so a test writes the expected words by hand. The router bundle imports this module,
 * so it imports nothing that carries the plugin version.
 */

import { randomUUID } from "node:crypto";
import { COMMAND } from "../build-info/names";
import { TAVILY_SERVER_NAME } from "../mcp/names";
import type { PlanLimit } from "./targets";

/**
 * The start of every Anthropic server-tool type, matched by prefix: Anthropic dates a
 * server tool's type (`web_search_20250305`), and a newer date is the same tool. Today only
 * web search is on Claude Code's wire; web fetch is named too, because it is the other
 * server tool of this kind (Claude Code fetches a page itself, with no server tool, so
 * WebFetch needs nothing here). Tool search's types are not in the list on purpose: a
 * conversation request carries them, and it must stay on its slot's chain.
 */
export const ANTHROPIC_SERVER_TOOL_PREFIXES = ["web_search_", "web_fetch_"] as const;

/**
 * The first Anthropic server tool a request offers, by the start of its type (`web_search`),
 * or null. An entry that is not an object with a string `type` is skipped, never guessed at.
 * The answer is one of this module's own words, so the log may print it as it is. Claude
 * Code's conversation request carries no server tool (it defers them); only the tool's own
 * request does.
 */
export function anthropicServerTool(body: Record<string, unknown>): null | string {
  if (!Array.isArray(body.tools)) return null;
  for (const tool of body.tools) {
    if (typeof tool !== "object" || tool === null || !("type" in tool)) continue;
    if (typeof tool.type !== "string") continue;
    const type = tool.type;
    const prefix = ANTHROPIC_SERVER_TOOL_PREFIXES.find((start) => type.startsWith(start));
    if (prefix !== undefined) return prefix.slice(0, -1);
  }
  return null;
}

/**
 * Why Claude could not answer, to finish the sentence "Claude …". The plan's usage limit
 * names the window and when it resets, when Anthropic's headers give them (`planUsageLimit`);
 * any other failure names its status, or says no answer came.
 */
export function claudeUnavailableWords(status: null | number, limit: null | PlanLimit): string {
  if (limit !== null) {
    const claim = limit.claim === null ? "" : ` (${limit.claim})`;
    const reset =
      limit.resetsAt === null
        ? "the reset time is not known"
        : `it resets at ${new Date(limit.resetsAt * 1000).toISOString().slice(0, 16).replace("T", " ")} UTC`;
    return `is at its usage limit${claim}; ${reset}`;
  }
  return status === null
    ? "could not be reached (no answer came)"
    : `could not answer now (HTTP ${status})`;
}

/**
 * The words that stand in for a search Claude could not run. `why` finishes "Claude …"
 * (`claudeUnavailableWords`). They say where the answer comes from, why web search needs
 * Claude, and what to use instead. The Tavily server's name is built from its one home
 * (`src/mcp/names.ts`), never typed; whether that server is set up is not read here (the
 * router stays a small, fast path), so the answer says "if it is set up". It names the
 * server's tool prefix, not one tool: the tool names are Tavily's.
 */
export function claudeSearchNotice(why: string): string {
  return `The ${COMMAND} router answered this search, not a search engine: web search runs on Claude, and Claude ${why}. Use the search tool of the Tavily MCP server instead (its tools are named mcp__${TAVILY_SERVER_NAME}__…), if it is set up.`;
}

/** A message id of the router's own, so a log of the session shows where the answer came from. */
function routerMessageId(): string {
  return `msg_router_${randomUUID().replaceAll("-", "")}`;
}

/**
 * Anthropic's message shape with one text block, for a request that did not ask for a
 * stream. `model` is the name Claude Code sent; `usage` is zero, nothing was generated.
 */
export function searchMessageAnswer(model: unknown, text: string): string {
  return JSON.stringify({
    content: [{ text, type: "text" }],
    id: routerMessageId(),
    model: typeof model === "string" ? model : "unknown",
    role: "assistant",
    stop_reason: "end_turn",
    stop_sequence: null,
    type: "message",
    usage: { input_tokens: 0, output_tokens: 0 },
  });
}

/**
 * The same answer as a server-sent event stream. The search request Claude Code 2.1.306
 * sends asks for a stream (`stream: true`), so this is the form it gets; the JSON answer
 * above is for a request that does not.
 */
export function searchStreamAnswer(model: unknown, text: string): string {
  const message = {
    content: [],
    id: routerMessageId(),
    model: typeof model === "string" ? model : "unknown",
    role: "assistant",
    stop_reason: null,
    stop_sequence: null,
    type: "message",
    usage: { input_tokens: 0, output_tokens: 0 },
  };
  const event = (name: string, data: unknown) =>
    `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`;
  return [
    event("message_start", { message, type: "message_start" }),
    event("content_block_start", {
      content_block: { text: "", type: "text" },
      index: 0,
      type: "content_block_start",
    }),
    event("content_block_delta", {
      delta: { text, type: "text_delta" },
      index: 0,
      type: "content_block_delta",
    }),
    event("content_block_stop", { index: 0, type: "content_block_stop" }),
    event("message_delta", {
      delta: { stop_reason: "end_turn", stop_sequence: null },
      type: "message_delta",
      usage: { output_tokens: 0 },
    }),
    event("message_stop", { type: "message_stop" }),
  ].join("");
}
