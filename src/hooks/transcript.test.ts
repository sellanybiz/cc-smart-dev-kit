/** The session's own model from a transcript's tail (`transcript.ts`). */
import { describe, expect, it } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { tempDir } from "../testing/temp";
import { lastClaudeModel } from "./transcript";

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
