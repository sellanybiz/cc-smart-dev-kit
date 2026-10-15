/**
 * What the hooks read from a transcript's tail (`transcript.ts`): the session's own model,
 * its name, the turn's last answer, and who started the turn.
 */
import { describe, expect, it } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { tempDir } from "../testing/temp";
import { lastAssistantText, lastClaudeModel, lastCustomTitle, startedByPeer } from "./transcript";

/** A transcript in a temp folder: one JSON entry per line. */
function write(lines: Array<Record<string, unknown>>): string {
  const path = join(tempDir("transcript"), "session.jsonl");
  writeFileSync(path, `${lines.map((line) => JSON.stringify(line)).join("\n")}\n`);
  return path;
}

describe("lastClaudeModel", () => {
  it("the last Claude model in the transcript, past fallback and error lines", () => {
    const folder = tempDir("transcript");
    const path = join(folder, "session.jsonl");
    const line = (model: string) =>
      JSON.stringify({ message: { content: [], model }, type: "assistant" });
    writeFileSync(
      path,
      [
        line("claude-opus-5-5"),
        line("claude-fable-5-1"),
        JSON.stringify({ message: { content: "go on" }, type: "user" }),
        line("glm-5.3-flash"),
        line("<synthetic>"),
        '{"type":"assistant","message":{"model":"claude-cut',
      ].join("\n"),
    );
    expect(lastClaudeModel(path)).toBe("claude-fable-5-1");
    expect(lastClaudeModel(join(folder, "none.jsonl"))).toBeNull();
  });
});

describe("lastCustomTitle", () => {
  it("the newest custom title, past a line half written at the transcript's end", () => {
    const path = write([
      { customTitle: "the first name", type: "user" },
      { message: { content: "go on" }, type: "user" },
      { customTitle: "the ssh alerts", type: "user" },
    ]);
    expect(lastCustomTitle(path)).toBe("the ssh alerts");
    expect(lastCustomTitle(join(path, "..", "none.jsonl"))).toBeNull();
    const empty = write([{ customTitle: "  ", type: "user" }]);
    expect(lastCustomTitle(empty)).toBeNull();
  });
});

describe("lastAssistantText", () => {
  it("the text blocks of the last answer, joined; tool calls and a user line passed over", () => {
    const path = write([
      { message: { content: [{ text: "an older answer", type: "text" }] }, type: "assistant" },
      { message: { content: [{ text: "go on", type: "text" }] }, type: "user" },
      {
        message: {
          content: [
            { text: "First part.", type: "text" },
            { id: "tool-1", name: "Bash", type: "tool_use" },
            { text: "Second part.", type: "text" },
          ],
        },
        type: "assistant",
      },
    ]);
    expect(lastAssistantText(path)).toBe("First part. Second part.");
    expect(lastAssistantText(join(path, "..", "none.jsonl"))).toBeNull();
  });

  it("an answer with no text at all: null", () => {
    const path = write([
      { message: { content: [{ text: "an answer", type: "text" }] }, type: "assistant" },
      { message: { content: [{ id: "t", name: "Bash", type: "tool_use" }] }, type: "assistant" },
    ]);
    expect(lastAssistantText(path)).toBe("");
  });
});

describe("startedByPeer", () => {
  it("a turn another session started; a human prompt into it and a helper agent alert as before", () => {
    expect(startedByPeer(write([{ type: "user", turnOrigin: "peer" }]))).toBe(true);
    expect(startedByPeer(write([{ origin: { senderTaskId: null }, turnOrigin: "peer" }]))).toBe(
      true,
    );
    expect(startedByPeer(write([{ origin: { senderTaskId: "abc" }, turnOrigin: "peer" }]))).toBe(
      false,
    );
    expect(startedByPeer(write([{ attachment: { humanTurn: true }, turnOrigin: "peer" }]))).toBe(
      false,
    );
    expect(startedByPeer(write([{ turnOrigin: "user" }]))).toBe(false);
    // Anything unclear (no such record, an unreadable file): the alert is shown.
    expect(startedByPeer(write([{ message: { content: "hi" }, type: "user" }]))).toBe(false);
    expect(startedByPeer(join(tempDir("transcript"), "none.jsonl"))).toBe(false);
  });

  it("a compaction summary is passed over: the record under it decides", () => {
    const path = write([{ isCompactSummary: true, turnOrigin: "peer" }, { turnOrigin: "user" }]);
    expect(startedByPeer(path)).toBe(false);
    const onlySummary = write([{ isCompactSummary: true, turnOrigin: "peer" }]);
    expect(startedByPeer(onlySummary)).toBe(false);
  });
});
