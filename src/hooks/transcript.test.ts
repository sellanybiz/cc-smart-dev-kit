/**
 * What the hooks read from a transcript (`transcript.ts`): from its tail the session's own
 * model, its name, the turn's last answer, and who started the turn; from its head a subagent's
 * brief; from the whole file the prompts of a subagent's run.
 */
import { describe, expect, it } from "bun:test";
import { statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tempDir } from "../testing/temp";
import { isReviewRun } from "./review-record";
import {
  firstPromptText,
  lastAssistantText,
  lastClaudeModel,
  lastCustomTitle,
  runPrompts,
  startedByPeer,
} from "./transcript";

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

  it("a sidechain line (a subagent's own conversation) is passed over", () => {
    const path = write([
      { message: { content: [], model: "claude-sonnet-5-5" }, type: "assistant" },
      {
        isSidechain: true,
        message: { content: [], model: "claude-opus-5-5" },
        type: "assistant",
      },
    ]);
    expect(lastClaudeModel(path)).toBe("claude-sonnet-5-5");
    // Only sidechain lines: nothing is known about the session's own model.
    expect(
      lastClaudeModel(
        write([
          {
            isSidechain: true,
            message: { content: [], model: "claude-opus-5-5" },
            type: "assistant",
          },
        ]),
      ),
    ).toBeNull();
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

/** A `user` entry of a subagent's own transcript, shaped as Claude Code writes it. */
function user(content: unknown, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { type: "user", isSidechain: true, ...extra, message: { role: "user", content } };
}

describe("runPrompts", () => {
  it("the brief, then every later prompt in order; tool results and Claude Code's own skill and reminder entries are none", () => {
    const path = write([
      { type: "summary", note: "no user entry" },
      user("Brief"),
      user(
        [
          { type: "text", text: "<command-message>example:check</command-message>" },
          { type: "text", text: "Base directory for this skill: /tmp/skills/check" },
        ],
        { isMeta: true },
      ),
      user([{ type: "text", text: "<command-name>example:check</command-name>" }], {
        isMeta: true,
      }),
      user("<system-reminder>\nA reminder\n</system-reminder>", { isMeta: true }),
      {
        type: "assistant",
        message: { role: "assistant", content: [{ type: "text", text: "Ok" }] },
      },
      user([{ type: "tool_result", tool_use_id: "toolu_01", content: "Result" }]),
      user([{ type: "text", text: "Base directory for this skill: /tmp/skills/check" }], {
        isMeta: true,
        sourceToolUseID: "toolu_01",
      }),
      user("The coordinator sent a message while you were working:\nOne", {
        isMeta: true,
        origin: { kind: "coordinator" },
      }),
      user("Stop hook feedback:\nTwo", { isMeta: true }),
      user("Three, an unknown meta entry", { isMeta: true }),
      user("<system-reminder>\nFour\n</system-reminder>", {
        isMeta: true,
        origin: { kind: "coordinator" },
      }),
      user(
        [
          { type: "text", text: "<system-reminder>\nFive" },
          { type: "text", text: "Six" },
        ],
        { isMeta: true },
      ),
      user([
        { type: "tool_result", tool_use_id: "toolu_02", content: "Result" },
        { type: "text", text: "Seven" },
      ]),
      user([{ type: "image", source: { type: "base64", data: "" } }]),
      user([]),
      user("Eight, typed"),
    ]);
    expect(runPrompts(path)).toEqual({
      brief: "Brief",
      later: [
        "The coordinator sent a message while you were working:\nOne",
        "Stop hook feedback:\nTwo",
        "Three, an unknown meta entry",
        "<system-reminder>\nFour\n</system-reminder>",
        "<system-reminder>\nFive\nSix",
        "Seven",
        "",
        "",
        "Eight, typed",
      ],
    });
  });

  it("a line written with other spacing still counts; one that may be a user entry but does not parse is a prompt with no text", () => {
    const path = join(tempDir("transcript"), "agent.jsonl");
    writeFileSync(
      path,
      [
        "not json at all",
        '{"type":"user","message":{"content":"Cut bef',
        '{ "type": "user", "message": { "role": "user", "content": "Brief" } }',
        '{ "type": "user", "message": { "role": "user", "content": "Later" } }',
        '{"type":"user","message":{"content":"Cut',
        '{"type":"assistant","message":{"content":[{"type":"text","text":"said \\"user\\""}]}}',
        "",
      ].join("\n"),
    );
    expect(runPrompts(path)).toEqual({ brief: "Brief", later: ["Later", ""] });
  });

  it("an attachment that hands the agent a prompt counts after the brief; other attachments do not", () => {
    const attachment = (fields: Record<string, unknown>) => ({
      type: "attachment",
      isSidechain: true,
      attachment: fields,
    });
    const path = write([
      attachment({ type: "queued_command", prompt: "Before the brief", origin: { kind: "x" } }),
      user("Brief"),
      attachment({ type: "hook_success", hookName: "PostToolUse", stdout: "", exitCode: 0 }),
      attachment({ type: "skill_listing", content: "- example:check", skillCount: 1 }),
      attachment({ type: "prompt_snapshot", systemPrompt: "You are an agent" }),
      attachment({
        type: "queued_command",
        prompt: "The coordinator says one",
        origin: { kind: "coordinator" },
        isMeta: true,
        source_uuid: "00000000-0000-0000-0000-000000000001",
      }),
      attachment({
        type: "queued_command",
        prompt: "<task-notification>\nTwo\n</task-notification>",
        origin: { kind: "task-notification" },
        commandMode: "task-notification",
      }),
      attachment({ type: "queued_command", prompt: [{ type: "text", text: "Three" }] }),
      attachment({ type: "note", origin: { kind: "peer" } }),
      attachment({ type: "note", prompt: "Four" }),
      user("This session is being continued from a previous conversation.", {
        isCompactSummary: true,
      }),
    ]);
    expect(runPrompts(path)).toEqual({
      brief: "Brief",
      later: [
        "The coordinator says one",
        "<task-notification>\nTwo\n</task-notification>",
        "",
        "",
        "Four",
        "This session is being continued from a previous conversation.",
      ],
    });
  });

  it("an attachment line that may carry a prompt but does not parse is a prompt with no text", () => {
    const path = join(tempDir("transcript"), "agent.jsonl");
    writeFileSync(
      path,
      [
        JSON.stringify(user("Brief")),
        '{"type":"attachment","attachment":{"type":"queued_command","prompt":"Cut',
        '{"type":"attachment","attachment":{"type":"hook_success","stdout":"Cut',
        "",
      ].join("\n"),
    );
    expect(runPrompts(path)).toEqual({ brief: "Brief", later: [""] });
  });

  it("a system reminder is harmless only when it ends at its closing tag", () => {
    const path = write([
      user("Brief"),
      user("<system-reminder>\nOne\n</system-reminder>\n", { isMeta: true }),
      user("<system-reminder>\nTwo\n</system-reminder>\nAnswer a question", { isMeta: true }),
      user("<system-reminder>\nThree, never closed", { isMeta: true }),
      user(
        [
          { type: "text", text: "<system-reminder>\nFour\n</system-reminder>" },
          { type: "text", text: "<system-reminder>\nFive\n</system-reminder>Six" },
        ],
        { isMeta: true },
      ),
      user("<system-reminder>\nSeven\n</system-reminder><system-reminder>Eight</system-reminder>", {
        isMeta: true,
      }),
    ]);
    expect(runPrompts(path)?.later).toEqual([
      "<system-reminder>\nTwo\n</system-reminder>\nAnswer a question",
      "<system-reminder>\nThree, never closed",
      "<system-reminder>\nFour\n</system-reminder>\n<system-reminder>\nFive\n</system-reminder>Six",
      "<system-reminder>\nSeven\n</system-reminder><system-reminder>Eight</system-reminder>",
    ]);
  });

  it("the structured-output nudge Claude Code writes itself is no prompt; the same text from another agent, or another nudge, is one", () => {
    const nudge =
      "[structured-output-enforce] You MUST call the StructuredOutput tool to complete this request.";
    const path = write([
      user("Mode: review\n\nBrief"),
      user(nudge, { isMeta: true }),
      user([{ type: "text", text: nudge }], { isMeta: true }),
      user(nudge, { isMeta: true, origin: { kind: "coordinator" } }),
      user(nudge),
      user("[handback-send-enforce] Call SubagentHandback.", { isMeta: true }),
    ]);
    expect(runPrompts(path)).toEqual({
      brief: "Mode: review\n\nBrief",
      later: [nudge, nudge, "[handback-send-enforce] Call SubagentHandback."],
    });
    // What the review record makes of it: the nudge alone keeps the run a review; the same
    // nudge sent by another agent ends it.
    expect(isReviewRun(write([user("Mode: review\n\nBrief"), user(nudge, { isMeta: true })]))).toBe(
      true,
    );
    expect(
      isReviewRun(
        write([
          user("Mode: review\n\nBrief"),
          user(nudge, { isMeta: true, origin: { kind: "coordinator" } }),
        ]),
      ),
    ).toBe(false);
  });

  it("no user entry: no brief and no later prompt", () => {
    const path = write([{ type: "assistant", message: { role: "assistant", content: [] } }]);
    expect(runPrompts(path)).toEqual({ brief: null, later: [] });
  });

  it("reads the whole file up to the cap, and nothing above it", () => {
    const path = write([user("Brief"), user("x".repeat(600 * 1024)), user("Last")]);
    const size = statSync(path).size;
    expect(runPrompts(path, size)?.later.at(-1)).toBe("Last");
    expect(runPrompts(path, size - 1)).toBeNull();
    expect(runPrompts(join(tempDir("transcript"), "none.jsonl"))).toBeNull();
  });
});

describe("firstPromptText", () => {
  it("the first user entry's text from the head, past lines that are not JSON", () => {
    const path = join(tempDir("transcript"), "agent.jsonl");
    writeFileSync(
      path,
      [
        "not json at all",
        JSON.stringify({ type: "summary" }),
        JSON.stringify(
          user([
            { type: "text", text: "A" },
            { type: "text", text: "B" },
          ]),
        ),
        JSON.stringify(user("Later")),
      ].join("\n"),
    );
    expect(firstPromptText(path)).toBe("A\nB");
    expect(firstPromptText(join(tempDir("transcript"), "none.jsonl"))).toBeNull();
  });

  it("a brief longer than the head is not read: the next entry the head holds whole is taken", () => {
    const path = join(tempDir("transcript"), "agent.jsonl");
    writeFileSync(path, `${JSON.stringify(user("x".repeat(1024 * 1024)))}\n`);
    expect(firstPromptText(path)).toBeNull();
  });
});
