/**
 * MD-7: each subagent's usage on record. A hand-written SubagentStop input and transcript, in
 * Claude Code 2.1.308's shape (`docs/claude-code-contract.md` § Subagents): one assistant line
 * per content block, each carrying the reply's whole `usage`, so a reply is counted once.
 */
import { describe, expect, it } from "bun:test";
import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cliPaths } from "../cli/paths";
import { hookEnv } from "../testing/hooks";
import { tempDir } from "../testing/temp";
import { LOG_MAX_BYTES } from "../update/state";
import {
  AGENT_USAGE_FILE,
  agentUsageFile,
  parseAgentUsage,
  readAgentUsage,
  recordAgentUsage,
  repliesOfTranscript,
} from "./agent-usage";
import { handleHook } from "./run";
import { agentUsageHook } from "./specs";

const NOW = Date.UTC(2026, 9, 22, 12, 0, 0);
const SECRET_TEXT = "the private plan this agent read";

/** One assistant line: a reply's content block, with the reply's whole usage. */
function assistant(
  id: string,
  model: string,
  usage: Record<string, number>,
  text = SECRET_TEXT,
): string {
  return JSON.stringify({
    agentId: "a1",
    isSidechain: true,
    message: { content: [{ text, type: "text" }], id, model, usage },
    timestamp: new Date(NOW - 60_000).toISOString(),
    type: "assistant",
  });
}

const OPUS_TOKENS = {
  cache_creation_input_tokens: 100,
  cache_read_input_tokens: 2000,
  input_tokens: 1000,
  output_tokens: 500,
};

/** A transcript with an Opus reply written as two content-block lines, and an unpriced reply. */
function transcript(): string {
  return `${[
    assistant("msg_1", "claude-opus-5-5", OPUS_TOKENS, SECRET_TEXT),
    assistant("msg_1", "claude-opus-5-5", OPUS_TOKENS, "the same reply's second block"),
    assistant("msg_2", "claude-opus-5-5", {
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
      input_tokens: 0,
      output_tokens: 0,
    }),
    assistant("msg_3", "glm-5.3-flash", {
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
      input_tokens: 300,
      output_tokens: 100,
    }),
    JSON.stringify({
      agentId: "a1",
      isSidechain: true,
      message: { content: [{ text: SECRET_TEXT, type: "text" }] },
      type: "user",
    }),
    "{half a line",
  ].join("\n")}\n`;
}

function stopInput(transcriptPath: string): Record<string, unknown> {
  return {
    agent_id: "a1",
    agent_transcript_path: transcriptPath,
    agent_type: "general-purpose",
    cwd: tempDir("agent-usage-cwd"),
    hook_event_name: "SubagentStop",
    session_id: "11111111-2222-3333-4444-555555555555",
  };
}

/** A transcript file whose path the hook's input names. */
function transcriptFile(text = transcript()): string {
  const file = join(tempDir("agent-usage-transcript"), "agent-a1.jsonl");
  writeFileSync(file, text);
  return file;
}

/**
 * The exact line, written by hand: one Opus reply written twice (0.0149 USD: (1000×4 +
 * 500×20 + 2000×0.2 + 100×5) / 1,000,000), one Opus reply that cost nothing, and one unpriced
 * backend reply (glm-5.3-flash has no row in the Claude price table). Models by name.
 */
function expectedLine(at: number): string {
  return `${JSON.stringify({
    agent: "a1",
    agentType: "general-purpose",
    at,
    models: [
      {
        cacheRead: 2000,
        cacheWrite: 100,
        input: 1000,
        model: "claude-opus-5-5",
        output: 500,
        replies: 2,
        usd: 0.0149,
      },
      {
        cacheRead: 0,
        cacheWrite: 0,
        input: 300,
        model: "glm-5.3-flash",
        output: 100,
        replies: 1,
        usd: null,
      },
    ],
    session: "11111111-2222-3333-4444-555555555555",
    unpriced: 1,
    usd: 0.0149,
  })}\n`;
}

const EXPECTED_LINE = expectedLine(NOW);

describe("MD-7: a subagent's usage on record", () => {
  it("appends exactly one line at the stop: per model, replies, the four tokens, the estimated USD", async () => {
    const env = hookEnv();
    const transcriptPath = transcriptFile();
    const result = await handleHook(
      agentUsageHook,
      JSON.stringify(stopInput(transcriptPath)),
      env,
      NOW,
    );
    expect(result).toEqual({});
    const file = agentUsageFile(cliPaths(env).stateDir);
    expect(readFileSync(file, "utf8")).toBe(EXPECTED_LINE);
    // Never content: the record holds tokens and names, not a word the agent read or wrote.
    expect(readFileSync(file, "utf8")).not.toContain(SECRET_TEXT);
  });

  it("a machine-wide record: it is written with no cc-smart-dev-kit.json and outside git", async () => {
    const env = hookEnv();
    const input = stopInput(transcriptFile());
    input.cwd = tempDir("not-a-repo");
    expect(await handleHook(agentUsageHook, JSON.stringify(input), env, NOW)).toEqual({});
    expect(readFileSync(agentUsageFile(cliPaths(env).stateDir), "utf8")).toBe(EXPECTED_LINE);
  });

  it("an agent that answered nothing writes no line", async () => {
    const env = hookEnv();
    const transcriptPath = transcriptFile(
      `${JSON.stringify({
        agentId: "a1",
        message: { content: [{ text: SECRET_TEXT, type: "text" }] },
        type: "user",
      })}\n`,
    );
    expect(
      await handleHook(agentUsageHook, JSON.stringify(stopInput(transcriptPath)), env, NOW),
    ).toEqual({});
    expect(readAgentUsage(agentUsageFile(cliPaths(env).stateDir), 0)).toEqual([]);
  });

  it("a transcript that cannot be read: one stderr line, exit 0, and no record", async () => {
    const env = hookEnv();
    const result = await handleHook(
      agentUsageHook,
      JSON.stringify(stopInput(join(tempDir("agent-usage-missing"), "agent.jsonl"))),
      env,
      NOW,
    );
    expect(result.exitCode ?? 0).toBe(0);
    expect(result.stdout).toBeUndefined();
    expect(result.stderr).toBe(
      "cc-smart-dev-kit agent-usage: the agent's transcript cannot be read, so its usage is not recorded",
    );
  });

  it("a record that cannot be written: one stderr line, exit 0", async () => {
    const env = hookEnv();
    const paths = cliPaths(env);
    // A file where the state folder should be: the folder cannot be made.
    mkdirSync(paths.claudeConfigDir, { recursive: true });
    writeFileSync(paths.stateDir, "not a folder");
    const result = await handleHook(
      agentUsageHook,
      JSON.stringify(stopInput(transcriptFile())),
      env,
      NOW,
    );
    expect(result.exitCode ?? 0).toBe(0);
    expect(result.stdout).toBeUndefined();
    expect(result.stderr).toStartWith("cc-smart-dev-kit agent-usage: cannot write the record (");
  });

  it("no transcript named: one stderr line; any other event: nothing at all", () => {
    const paths = cliPaths(hookEnv());
    const input = stopInput(transcriptFile());
    delete input.agent_transcript_path;
    expect(recordAgentUsage(input, "SubagentStop", paths, NOW)).toEqual({
      stderr: "cc-smart-dev-kit agent-usage: the input names no agent transcript",
    });
    expect(recordAgentUsage(stopInput(transcriptFile()), "SubagentStart", paths, NOW)).toEqual({});
  });

  it("the record is kept small: past the size rule the newer half stays, on whole lines", async () => {
    const env = hookEnv();
    const file = agentUsageFile(cliPaths(env).stateDir);
    mkdirSync(cliPaths(env).stateDir, { recursive: true });
    // An old record longer than the size rule, then the new line: the cut keeps the new line.
    const filler = `${JSON.stringify({ at: 1, filler: "x".repeat(1024) })}\n`.repeat(
      Math.ceil(LOG_MAX_BYTES / 1024) + 4,
    );
    writeFileSync(file, filler);
    expect(statSync(file).size).toBeGreaterThan(LOG_MAX_BYTES);
    expect(
      await handleHook(agentUsageHook, JSON.stringify(stopInput(transcriptFile())), env, NOW),
    ).toEqual({});
    expect(statSync(file).size).toBeLessThanOrEqual(LOG_MAX_BYTES);
    // Whole lines only, and the new record is the one that survived the cut.
    const lines = readFileSync(file, "utf8")
      .split("\n")
      .filter((line) => line.trim() !== "");
    for (const line of lines) expect(() => JSON.parse(line)).not.toThrow();
    expect(lines.at(-1)).toBe(EXPECTED_LINE.trimEnd());
  });

  it("a second stop of one agent supersedes its first line: never a sum of two halves", () => {
    const file = agentUsageFile(tempDir("agent-usage-stops"));
    const first = parseAgentUsage(expectedLine(NOW - 1000).trimEnd());
    if (first === null) throw new Error("the first line did not read");
    writeFileSync(file, `${JSON.stringify(first)}\n${EXPECTED_LINE}`);
    const records = readAgentUsage(file, 0);
    expect(records).toHaveLength(1);
    expect(records[0]?.at).toBe(NOW);
    // A window that starts after the newer line holds nothing: the older one never stands in.
    expect(readAgentUsage(file, NOW + 1)).toEqual([]);
  });

  it("the transcript reader counts a reply once and skips anything but an assistant line", () => {
    const replies = repliesOfTranscript(transcript());
    expect([...replies.keys()]).toEqual(["msg_1", "msg_2", "msg_3"]);
    expect(replies.get("msg_1")?.model).toBe("claude-opus-5-5");
  });

  it("a nested launch's reply (another agentId) is not this agent's cost", () => {
    // A subagent that launched a subagent: the child's reply carries the child's own id, and
    // the child's own stop records it. Counting it here would charge it twice.
    const child = assistant("msg_child", "claude-sonnet-5-5", OPUS_TOKENS).replace(
      '"agentId":"a1"',
      '"agentId":"a2"',
    );
    const replies = repliesOfTranscript(`${transcript()}${child}\n`, "a1");
    expect([...replies.keys()]).toEqual(["msg_1", "msg_2", "msg_3"]);
  });

  it("the record's file name is one home", () => {
    expect(agentUsageFile("/state")).toBe(join("/state", AGENT_USAGE_FILE));
    expect(AGENT_USAGE_FILE).toBe("agent-usage.jsonl");
  });
});
