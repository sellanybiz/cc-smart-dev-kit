/**
 * The server-tool list and the note the router gives in place of a search it could not run
 * (D41, D44). Every expected value is written by hand.
 */
import { describe, expect, it } from "bun:test";
import { TAVILY_SERVER_NAME } from "../mcp/names";
import { SERVER_NAMES } from "../mcp/servers";
import {
  ANTHROPIC_SERVER_TOOL_PREFIXES,
  anthropicServerTool,
  claudeSearchNotice,
  claudeUnavailableWords,
  searchMessageAnswer,
  searchStreamAnswer,
} from "./server-tools";

describe("anthropicServerTool", () => {
  it("names the first server tool a request offers, by the start of its type", () => {
    expect(
      anthropicServerTool({ tools: [{ name: "web_search", type: "web_search_20250305" }] }),
    ).toBe("web_search");
    expect(anthropicServerTool({ tools: [{ name: "x", type: "web_fetch_20250910" }] })).toBe(
      "web_fetch",
    );
    expect(
      anthropicServerTool({
        tools: [{ name: "Bash" }, { name: "web_search", type: "web_search_30000101" }],
      }),
    ).toBe("web_search");
  });

  it("names none for an ordinary request, tool search, or a tools field that is not a list of objects", () => {
    expect(anthropicServerTool({})).toBeNull();
    expect(anthropicServerTool({ tools: [] })).toBeNull();
    expect(anthropicServerTool({ tools: "web_search_20250305" })).toBeNull();
    expect(anthropicServerTool({ tools: [{ name: "Bash", type: "custom" }] })).toBeNull();
    expect(
      anthropicServerTool({ tools: [{ name: "t", type: "tool_search_tool_regex_20251119" }] }),
    ).toBeNull();
    // A type that merely contains the words, or an entry with the wrong shape, is skipped.
    expect(
      anthropicServerTool({ tools: [{ type: "my_web_search_20250305" }, null, 7, { type: 3 }] }),
    ).toBeNull();
  });

  it("holds one list of prefixes: web search and web fetch", () => {
    expect([...ANTHROPIC_SERVER_TOOL_PREFIXES]).toEqual(["web_search_", "web_fetch_"]);
  });
});

describe("the note that stands in for a server tool that could not run", () => {
  it("says it is the router's, names the tool that failed and why it needs Claude, and names the Tavily server's tools", () => {
    expect(claudeSearchNotice("web_search", "is down")).toBe(
      "The cc-smart-dev-kit router answered this web_search request, not Anthropic: web_search runs on Claude, and Claude is down. Use the Tavily MCP server instead (its tools are named mcp__tavily-websearch__…), if it is set up.",
    );
    // Never "this search" for a fetch: the note names the tool that failed.
    expect(claudeSearchNotice("web_fetch", "could not answer now (HTTP 529)")).toBe(
      "The cc-smart-dev-kit router answered this web_fetch request, not Anthropic: web_fetch runs on Claude, and Claude could not answer now (HTTP 529). Use the Tavily MCP server instead (its tools are named mcp__tavily-websearch__…), if it is set up.",
    );
  });

  it("takes the server's name from the one place that registers it", () => {
    expect(TAVILY_SERVER_NAME).toBe("tavily-websearch");
    expect(SERVER_NAMES).toContain(TAVILY_SERVER_NAME);
  });

  it("says a usage limit with its window and reset, a missing reset, a status, or no answer", () => {
    expect(claudeUnavailableWords(429, { claim: "five_hour", resetsAt: 1792090800 })).toBe(
      "is at its usage limit (five_hour); it resets at 2026-10-15 19:00 UTC",
    );
    expect(claudeUnavailableWords(429, { claim: null, resetsAt: null })).toBe(
      "is at its usage limit; the reset time is not known",
    );
    expect(claudeUnavailableWords(529, null)).toBe("could not answer now (HTTP 529)");
    expect(claudeUnavailableWords(null, null)).toBe("could not be reached (no answer came)");
  });
});

describe("the answer's two forms", () => {
  it("the JSON message holds one text block and no tokens", () => {
    const answer: unknown = JSON.parse(searchMessageAnswer("claude-sonnet-5-5", "hello"));
    expect(answer).toMatchObject({
      content: [{ text: "hello", type: "text" }],
      model: "claude-sonnet-5-5",
      role: "assistant",
      stop_reason: "end_turn",
      stop_sequence: null,
      type: "message",
      usage: { input_tokens: 0, output_tokens: 0 },
    });
  });

  it("the stream is the six events Claude Code reads, ending in message_stop", () => {
    const stream = searchStreamAnswer("claude-sonnet-5-5", "hello");
    expect([...stream.matchAll(/^event: (.+)$/gm)].map((match) => match[1])).toEqual([
      "message_start",
      "content_block_start",
      "content_block_delta",
      "content_block_stop",
      "message_delta",
      "message_stop",
    ]);
    expect(stream).toContain('"delta":{"text":"hello","type":"text_delta"}');
    expect(stream.endsWith('event: message_stop\ndata: {"type":"message_stop"}\n\n')).toBe(true);
  });

  it("a model that is not a string becomes 'unknown', never a crash", () => {
    expect(JSON.parse(searchMessageAnswer(undefined, "x"))).toMatchObject({ model: "unknown" });
    expect(searchStreamAnswer(7, "x")).toContain('"model":"unknown"');
  });
});
