import { expect, it } from "bun:test";
import { createHistoryWriter } from "../gateway/history";
import type { LastAnswer } from "../gateway/history-read";
import { tempDir } from "../testing/temp";
import { cliPaths } from "./paths";
import { runStatusline, statuslineText } from "./statusline";
import { runSubagentStatusline, subagentRows } from "./subagent-statusline";

const answer: LastAnswer = {
  at: 1,
  model: "claude-sonnet-5-5",
  slot: "cc-smart-dev-kit-worker",
  target: "omniroute:openai/gpt-6.1-sol",
};
const input = { model: { display_name: "Sonnet 5.5", id: "claude-sonnet-5-5[1m]" } };

it("both commands read their own history identity only on the gateway", async () => {
  const home = tempDir("status-answer");
  const paths = cliPaths({ HOME: home, CLAUDE_CONFIG_DIR: home });
  const writer = createHistoryWriter({
    file: paths.historyDbFile,
    flushAfterMs: 60_000,
    log: () => {},
    retentionDays: () => 90,
  });
  for (const agent of [null, "a-1"])
    writer.record({
      agent,
      at: Date.now(),
      breaker: null,
      cost: null,
      model: answer.model,
      ms: 1,
      nextTarget: null,
      profile: null,
      session: "s-1",
      slot: answer.slot,
      status: 200,
      target: agent === null ? answer.target : "omniroute:glm",
      tokens: null,
    });
  writer.close();
  const lines: string[] = [];
  const log = console.log;
  console.log = (line: string) => {
    lines.push(line);
  };
  const on = { ANTHROPIC_BASE_URL: "http://127.0.0.1:47812" };
  try {
    await runStatusline(
      paths,
      async () => JSON.stringify({ ...input, session_id: "s-1" }),
      Date.now(),
      undefined,
      on,
    );
    await runSubagentStatusline(
      async () =>
        JSON.stringify({
          session_id: "s-1",
          tasks: [{ id: "a-1", model: answer.model, effort: "high" }],
        }),
      paths,
      on,
    );
    await runStatusline(
      paths,
      async () => JSON.stringify({ ...input, session_id: "s-1" }),
      Date.now(),
      undefined,
      { ANTHROPIC_BASE_URL: "https://api.anthropic.com" },
    );
  } finally {
    console.log = log;
  }
  expect(lines).toEqual([
    "Sonnet 5.5 → gpt-6.1-sol",
    '{"content":"worker → glm → high","id":"a-1"}',
    "Sonnet 5.5",
  ]);
});
it("names a backend or fallback, but not the same Claude or a stale model", () => {
  const text = (value: LastAnswer | null) =>
    statuslineText(
      input,
      null,
      10,
      "UTC",
      85,
      { gatewayOn: true, profile: null },
      undefined,
      value,
    );
  expect(text(answer)).toBe("Sonnet 5.5 → gpt-6.1-sol");
  expect(text({ ...answer, target: "claude-opus-5-5" })).toBe("Sonnet 5.5 → Opus 5.5");
  expect(text({ ...answer, target: "claude-sonnet-5-5" })).toBe("Sonnet 5.5");
  expect(text({ ...answer, model: "claude-opus-5-5" })).toBe("Sonnet 5.5");
  expect(text(null)).toBe("Sonnet 5.5");
  expect(
    statuslineText(
      input,
      null,
      10,
      "UTC",
      85,
      { gatewayOn: false, profile: null },
      undefined,
      answer,
    ),
  ).toBe("Sonnet 5.5");
});
it("a limit banner names the target only once", () => {
  const state = {
    version: 1 as const,
    limits: {},
    fallbacks: {
      "cc-smart-dev-kit-worker": {
        model: "claude-sonnet-5-5",
        target: answer.target,
        since: 0,
        lastAt: 0,
        resetsAt: null,
      },
    },
  };
  expect(
    statuslineText(
      input,
      state,
      10,
      "UTC",
      85,
      { gatewayOn: true, profile: null },
      undefined,
      answer,
    ),
  ).toBe("Sonnet 5.5 · ⚠ claude-sonnet-5-5 at its limit → omniroute:openai/gpt-6.1-sol");
});
it("subagent rows keep their slot and effort, before and after their first answer", () => {
  const data = {
    columns: 180,
    tasks: [
      { id: "a-1", model: "claude-sonnet-5-5", effort: "high" },
      { id: "a-2", model: "claude-haiku-5-5" },
    ],
  };
  expect(subagentRows(data, new Map([["a-1", answer]]))).toEqual([
    { id: "a-1", content: "worker → gpt-6.1-sol → high" },
    { id: "a-2", content: "scout → claude-haiku-5-5 → default effort" },
  ]);
});
